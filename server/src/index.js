import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import cors from "cors"
import { Server } from "socket.io"
import coap from "coap"
import { decode } from "cbor-x"

import { config, CENTER, PLACES } from "./config.js"
import { nodeStatus, riskIndex } from "./detect.js"
import { evaluate } from "./detection/index.js"
import { distance, inPolygon } from "./geo.js"
import { initStore, saveMeasurement, history, saveIncident, listIncidents, storeMode } from "./store.js"
import { notify, buildMessage } from "./alerts.js"
import { getWeather, getWeatherMode, setWeatherMode, setManualWeather, applyPreset } from "./weather.js"
import { createNetworkServer } from "./lora/network.js"
import { parseSenml, labelSenml, senmlSizes } from "./lora/codec.js"
import { encodeDownlink } from "./lora/downlink.js"
import {
  recordPacket, recordRejected, recordFireStart, recordSuspicion, recordConfirmation,
  recordFireReset, recordFalseAlertAvoided, getMetrics, resetMetrics,
} from "./metrics.js"
import { getSettings, getDefaults, updateSettings, resetSettings } from "./settings.js"

// ---------------------------------------------------------------------------
// État en mémoire
// ---------------------------------------------------------------------------
const nodes = new Map()          // id -> nœud
const healthById = new Map()     // id -> défaut de santé (pipeline §6.2), absent = ok
let incident = null              // incendie en cours
let sirenOverride = null         // true / false forcé depuis le dashboard, null = auto
let lastEval = 0
let lastSuspectAt = 0
let _prevLevel = "veille"
let _pendingTimeline = []   // événements de niveau avant confirmation

// Monde simulé (vérité terrain)
let worldState = null            // dernier snapshot reçu de /api/sim/world
let worldCommandQueue = []       // ordres en attente pour le moteur
let lastWorldAt = 0              // timestamp du dernier POST /api/sim/world
let resetAt = 0                  // réinitialisation : les mesures antérieures sont ignorées

const sirenFor = (node) => {
  if (sirenOverride !== null) return sirenOverride
  if (!incident || incident.status !== "actif") return false
  const nearFire = incident.position && distance(node, incident.position) < 1500
  const inZone30 = incident.zones?.[1]?.polygon && inPolygon(node, incident.zones[1].polygon)
  return nearFire || inZone30
}

const publicNode = (n) => {
  const online = Date.now() - n.ts < Math.max(30_000, n.period * 3000)
  return {
    ...n,
    online,
    health: online ? (healthById.get(n.id) ?? "ok") : "hors_ligne",
    siren: sirenFor(n),
  }
}

const publicState = async () => {
  const simConnected = Date.now() - lastWorldAt < 3000
  // Source de vérité météo : simulateur > manuel > Open-Meteo
  const weather = (simConnected && worldState?.weather)
    ? { ...worldState.weather, mode: getWeatherMode() }
    : await getWeather()
  return {
    nodes: [...nodes.values()].map(publicNode),
    incident,
    weather,
    weatherMode: getWeatherMode(),
    store: storeMode(),
    center: CENTER,
    places: PLACES,
    sirenOverride,
    simulatorConnected: simConnected,
  }
}

// ---------------------------------------------------------------------------
// HTTP + Socket.io
// ---------------------------------------------------------------------------
const app = express()
app.use(cors())
app.use(express.json())
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: "*" } })

io.on("connection", async (socket) => socket.emit("state", await publicState()))

app.get("/api/state", async (_req, res) => res.json(await publicState()))
app.get("/api/history/:id", async (req, res) => res.json(await history(req.params.id)))
app.get("/api/incidents", async (_req, res) => res.json(await listIncidents()))
app.get("/api/incidents/:id", async (req, res) => {
  const list = await listIncidents()
  const inc = list.find((i) => i.id === req.params.id)
  if (!inc) return res.status(404).json({ error: "incident introuvable" })
  res.json(inc)
})
app.get("/api/settings", (_req, res) => res.json(getSettings()))
app.get("/api/settings/defaults", (_req, res) => res.json(getDefaults()))
app.put("/api/settings", (req, res) => {
  if (!req.body) return res.status(400).json({ error: "body manquant" })
  res.json(updateSettings(req.body))
})
app.post("/api/settings/reset", (_req, res) => res.json(resetSettings()))

// Canaux d'alerte configurés dans .env (le jeton Pushover n'est jamais exposé)
app.get("/api/alerts/channels", (_req, res) => {
  const s = getSettings().alerts
  res.json({
    ntfy: { configured: !!config.ntfyTopic, topic: config.ntfyTopic || null, enabled: s.ntfyEnabled },
    pushover: { configured: !!(config.pushoverToken && config.pushoverUser), enabled: s.pushoverEnabled },
  })
})
app.get("/api/metrics", (_req, res) =>
  res.json(getMetrics([...nodes.values()].map(publicNode)))
)
app.post("/api/metrics/reset", (_req, res) => {
  resetMetrics()
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// API mode météo
// ---------------------------------------------------------------------------
app.get("/api/weather/mode", (_req, res) => res.json({ mode: getWeatherMode() }))

app.put("/api/weather/mode", (req, res) => {
  const { mode, preset, weather } = req.body || {}
  if (mode) setWeatherMode(mode)
  if (preset) {
    applyPreset(preset)
    worldCommandQueue.push({ type: "preset", name: preset })
  }
  if (weather) {
    setManualWeather(weather)
    worldCommandQueue.push({ type: "weather", ...weather })
  }
  res.json({ ok: true, mode: getWeatherMode() })
})

// ---------------------------------------------------------------------------
// API monde simulé
// ---------------------------------------------------------------------------
app.post("/api/sim/world", (req, res) => {
  const prev = worldState
  worldState = req.body
  lastWorldAt = Date.now()

  // Tracking métriques : nouveau feu détecté dans la vérité terrain
  const fires = worldState.fires || []
  const prevFires = prev?.fires || []
  if (fires.length > 0 && prevFires.length === 0) {
    const f = fires[0]
    recordFireStart(f.startEpochMs ?? Math.round(f.start * 1000))
  }
  // Feu terminé (toutes les cellules brûlées)
  if (fires.length === 0 && prevFires.length > 0) {
    recordFireReset()
  }

  const cmds = [...worldCommandQueue]
  worldCommandQueue = []
  io.emit("world", worldState)
  res.json({ commands: cmds })
})

app.get("/api/world", (_req, res) => res.json(worldState || {}))

app.post("/api/world/command", (req, res) => {
  const cmd = req.body
  if (!cmd || !cmd.type) return res.status(400).json({ error: "type manquant" })
  if (cmd.type === "reset") {
    resetAll()
    return res.json({ ok: true, queued: worldCommandQueue.length })
  }
  worldCommandQueue.push(cmd)
  res.json({ ok: true, queued: worldCommandQueue.length })
})

// Raccourcis conservés (compatibilité avec l'ancienne API)
app.post("/api/scenario/fire", (req, res) => {
  const { lat, lon } = req.body || {}
  worldCommandQueue.push({ type: "fire_start", ...(lat && lon ? { lat, lon } : { lat: CENTER.lat, lon: CENTER.lon }) })
  res.json({ ok: true })
})

/** Réinitialisation : monde, incident en cours et mesures antérieures ignorées. */
function resetAll() {
  worldCommandQueue.push({ type: "reset" })
  resetAt = Date.now()
  lastSuspectAt = 0
  sirenOverride = null
  if (incident?.status === "actif") closeIncident("réinitialisé")
  recordFireReset()
  _pendingTimeline = []
  _prevLevel = "veille"
}

app.post("/api/scenario/reset", (_req, res) => {
  resetAll()
  res.json({ ok: true })
})

app.post("/api/siren", (req, res) => {
  const on = req.body?.on
  sirenOverride = on === true || on === false ? on : null
  io.emit("siren", sirenOverride)
  res.json({ ok: true, sirenOverride })
})

app.post("/api/alert/test", async (_req, res) => {
  const sent = await notify({ title: "🔥 TEST FireWatch", message: "Ceci est une alerte de test." })
  res.json({ ok: sent.length > 0, sent })
})

// Dashboard compilé (client/dist) servi par le même serveur
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist")
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")))
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
function closeIncident(reason) {
  incident = { ...incident, status: "maîtrisé", endedAt: Date.now(), reason }
  saveIncident(incident)
  io.emit("incident", incident)
  console.log(`🧯 Incident ${incident.id} ${reason}`)
}

async function runDetection() {
  const now = Date.now()
  if (now - lastEval < 1000) return
  lastEval = now

  const settings = getSettings()
  const detContext = {
    worldWeather: worldState?.weather,
    timeScale: worldState?.timeScale ?? config.timeScale,
    // Zones de brûlage déclarées (page Paramètres) : polygones [[lat, lon], …]
    burnZones: (settings.burnZones || []).map((z) => z.polygon).filter((p) => Array.isArray(p) && p.length >= 3),
    settings: { thresholds: settings.thresholds, fusion: settings.fusion },
  }
  // Nœuds qui ont des mesures, reçues après la dernière réinitialisation (sinon les
  // dernières mesures du feu précédent rouvriraient aussitôt l'incident)
  const measured = [...nodes.values()].filter((n) =>
    n.readings && Object.keys(n.readings).length && n.ts > resetAt)
  const result = evaluate(measured, now, detContext)
  if (result.suspects.length) lastSuspectAt = now

  // Santé des appareils (§6.2) : exposée au dashboard (badge, inventaire)
  healthById.clear()
  for (const d of result.defects || []) healthById.set(d.id, d.fault)

  // Métriques de détection
  if (result.level === "suspicion" || result.level === "pré-alerte") recordSuspicion(now)
  if (result.confirmed) recordConfirmation(now)
  if (result.falseAlert) recordFalseAlertAvoided()

  // Émettre le niveau d'alerte courant + vent mesuré par les capteurs (dashboard)
  io.emit("alert_level", {
    level: result.level,
    score: result.score,
    riskIndex: result.riskIndex,
    wind: result.wind,
  })

  // Suivi des transitions de niveau (timeline)
  if (result.level !== _prevLevel && result.level !== "veille") {
    _pendingTimeline.push({ type: result.level, at: now })
  }
  _prevLevel = result.level

  if (result.confirmed) {
    const isNew = !incident || incident.status !== "actif"
    incident = {
      ...(isNew ? { id: `INC-${now}`, startedAt: now, alertsSent: [], timeline: [..._pendingTimeline] } : incident),
      ...result,
      position: result.position,
      heading: result.prediction?.heading,
      rosMPerMin: result.prediction?.rosMPerMin,
      zones: result.prediction?.zones,
      threatenedNodes: result.prediction?.threatenedNodes,
      threatenedPlaces: result.prediction?.threatenedPlaces,
      areaHa: result.prediction?.areaHa,
      status: "actif",
      updatedAt: now,
    }
    if (isNew) {
      _pendingTimeline = []
      console.log(`🔥 FEU CONFIRMÉ niveau=${result.level} score=${result.score} suspects=(${result.suspects.join(", ")})`)
      const payload = buildMessage(incident)
      io.emit("alert", { ...payload, incidentId: incident.id })
      notify(payload).then((sent) => {
        incident.alertsSent = sent
        saveIncident(incident)
        io.emit("incident", incident)
      })
    }
    saveIncident(incident)
    io.emit("incident", incident)
  } else if (incident?.status === "actif" && now - lastSuspectAt > 45_000) {
    closeIncident("maîtrisé (plus de fumée détectée)")
  }
}

// ---------------------------------------------------------------------------
// Serveur CoAP : réception des trames LoRaWAN relayées par les passerelles
// ---------------------------------------------------------------------------
const lora = createNetworkServer()

// Secondes simulées par seconde réelle : le duty cycle se compte en temps simulé
const timeFactor = () =>
  Math.max(1e-6, (worldState?.timeScale ?? config.timeScale) * (worldState?.speed ?? 1))

// Métadonnées radio/relais : hors des mesures physiques
const META_KEYS = new Set(["lat", "lon", "gw", "seq", "sf"])

/** Période d'envoi ordonnée : rapide en danger, jamais sous le minimum du duty cycle. */
function orderedPeriod(danger, minPeriodS = 0) {
  const wanted = danger ? config.periodAlert : config.periodNormal
  return Math.ceil(Math.max(wanted, minPeriodS) * 10) / 10
}

function replyCbor(res, code, body) {
  res.code = code
  res.setOption("Content-Format", "application/cbor")
  res.end(body)
  return body
}

/**
 * Intègre un paquet SenML (reconstruit ou reçu tel quel) : nœud, mesure, détection.
 * `extra` porte ce que le réseau sait de l'appareil (type, tailles, trame, duty cycle).
 */
function ingestSenml(pack, extra) {
  const msg = parseSenml(pack)
  const v = msg.values
  // Toutes les mesures du paquet, sans les métadonnées de position et de relais
  const readings = {}
  for (const [k, val] of Object.entries(v)) {
    if (!META_KEYS.has(k) && val !== undefined) readings[k] = val
  }
  if ("flame" in readings) readings.flame = !!readings.flame
  const status = nodeStatus(readings)
  const danger = status !== "ok" || incident?.status === "actif"
  const prev = nodes.get(msg.id)
  const node = {
    ...(prev?.inscription ? { inscription: prev.inscription } : {}),
    id: msg.id,
    kind: extra.kind ?? prev?.kind,
    lat: v.lat,
    lon: v.lon,
    ts: Date.now(),
    readings,
    status,
    risk: riskIndex(readings),
    // Passerelles : statistiques toutes les 30 s par leur backhaul (période fixe)
    period: extra.kind === "gateway" ? 30 : orderedPeriod(danger, extra.minPeriodS),
    bytes: extra.bytes,
    gw: typeof v.gw === "string" ? v.gw : null,   // passerelle qui a relayé le paquet
    seq: v.seq,
    sf: v.sf,
    lastPacket: extra.lastPacket,
  }
  nodes.set(node.id, node)
  saveMeasurement({ node: node.id, ts: new Date(msg.ts), lat: node.lat, lon: node.lon, status, ...readings })
  runDetection()
  return node
}

const coapServer = coap.createServer({ type: "udp4" })

coapServer.on("request", (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/fw/up")) {
    res.code = "4.04"
    return res.end()
  }
  let body
  try {
    body = decode(req.payload)
  } catch {
    recordRejected("cbor")
    res.code = "4.00"
    return res.end("CBOR invalide")
  }

  // Statistiques d'une passerelle : SenML complet par son backhaul filaire
  if (Array.isArray(body)) {
    let node
    try {
      const sizes = senmlSizes(body)
      node = ingestSenml(body, {
        kind: "gateway",
        bytes: req.payload.length,
        lastPacket: {
          type: "backhaul",
          hex: Buffer.from(req.payload).toString("hex"),
          senml: labelSenml(body),
          sizes: { senmlCbor: sizes.senmlCbor, json: sizes.json },
        },
      })
    } catch (e) {
      recordRejected(e.code || "format")
      res.code = "4.00"
      return res.end(`SenML invalide : ${e.message}`)
    }
    recordPacket({ id: node.id, seq: node.seq, type: "backhaul" })
    replyCbor(res, "2.04", encodeDownlink({ period: 30 }))
    io.emit("node", publicNode(node))
    return
  }

  // Trame LoRaWAN relayée : décodage par le serveur réseau
  let up
  try {
    up = lora.handleUplink(body, { now: Date.now(), timeFactor: timeFactor() })
  } catch (e) {
    recordRejected(e.code || "format")
    if (e.rejoin) return replyCbor(res, "4.01", encodeDownlink({ rejoin: true }))   // non inscrit
    res.code = "4.00"
    return res.end(`Trame LoRaWAN invalide : ${e.message}`)
  }
  recordPacket({
    id: up.id, seq: up.frame.fcnt, type: up.type, sizes: up.sizes,
    airtimeMs: up.airtimeMs, sf: up.radio.sf, oversize: up.oversize,
  })

  const frameInfo = {
    type: up.type,
    hex: up.phyHex,
    frame: up.frame,
    radio: up.radio,
    sizes: up.sizes,
    airtimeMs: up.airtimeMs,
    maxPayload: up.maxPayload,
    oversize: up.oversize,
    dutyPct: up.dutyPct,
    minPeriodS: Math.round(up.minPeriodS * 100) / 100,
    timeFactor: timeFactor(),
  }

  if (up.type === "inscription") {
    const reg = up.reg
    const prev = nodes.get(reg.id)
    const inscription = {
      ...frameInfo,
      version: reg.version, kind: reg.kind, lat: reg.lat, lon: reg.lon,
      fields: reg.fields, bits: reg.bits, at: reg.registeredAt,
    }
    // Position et type viennent de l'inscription ; les mesures suivront sur FPort 2
    const node = prev
      ? { ...prev, kind: reg.kind, lat: reg.lat, lon: reg.lon, ts: Date.now(), inscription }
      : {
          id: reg.id, kind: reg.kind, lat: reg.lat, lon: reg.lon, ts: Date.now(), readings: {},
          status: "ok", risk: riskIndex({}), period: orderedPeriod(false, up.minPeriodS),
          bytes: up.sizes.compact, gw: up.radio.gw, seq: up.frame.fcnt, sf: up.radio.sf, inscription,
        }
    nodes.set(reg.id, node)
    console.log(`📝 Inscription ${reg.id} (${reg.kind}, DevAddr ${up.frame.devAddr}, ${up.sizes.compact} o)`)
    replyCbor(res, "2.04", encodeDownlink({ period: node.period, siren: sirenFor(node) }))
    io.emit("node", publicNode(node))
    return
  }

  const node = ingestSenml(up.pack, {
    kind: up.reg?.kind,
    bytes: up.sizes.compact,
    minPeriodS: up.minPeriodS,
    lastPacket: { ...frameInfo, fields: up.fields, senml: up.senml },
  })
  const dl = { period: node.period, siren: sirenFor(node) }
  const dlBytes = replyCbor(res, "2.04", encodeDownlink(dl))
  node.lastPacket.downlink = { ...dl, hex: Buffer.from(dlBytes).toString("hex"), bytes: dlBytes.length }
  io.emit("node", publicNode(node))
})

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
await initStore(config.mongoUri)
coapServer.listen(config.coapPort, () => console.log(`📡 CoAP en écoute sur udp://0.0.0.0:${config.coapPort}/fw/up`))
server.listen(config.httpPort, () => console.log(`🖥️  API + dashboard sur http://localhost:${config.httpPort}`))
console.log(
  `🔔 Alertes : ntfy ${config.ntfyTopic ? `(${config.ntfyTopic})` : "désactivé"}, ` +
    `Pushover ${config.pushoverToken ? "activé" : "désactivé"}`
)
getWeather()
