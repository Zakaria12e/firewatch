import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import cors from "cors"
import { Server } from "socket.io"
import coap from "coap"
import { decode, encode } from "cbor-x"

import { config, CENTER, PLACES } from "./config.js"
import { nodeStatus, riskIndex, evaluate } from "./detect.js"
import { distance, inPolygon } from "./geo.js"
import { initStore, saveMeasurement, history, saveIncident, listIncidents, storeMode } from "./store.js"
import { notify, buildMessage } from "./alerts.js"
import { getWeather } from "./weather.js"

// ---------------------------------------------------------------------------
// État en mémoire
// ---------------------------------------------------------------------------
const nodes = new Map()          // id -> nœud
let incident = null              // incendie en cours
let sirenOverride = null         // true / false forcé depuis le dashboard, null = auto
let lastEval = 0
let lastSuspectAt = 0

// Monde simulé (vérité terrain)
let worldState = null            // dernier snapshot reçu de /api/sim/world
let worldCommandQueue = []       // ordres en attente pour le moteur
let lastWorldAt = 0              // timestamp du dernier POST /api/sim/world

const sirenFor = (node) => {
  if (sirenOverride !== null) return sirenOverride
  if (!incident || incident.status !== "actif") return false
  const nearFire = incident.position && distance(node, incident.position) < 1500
  const inZone30 = incident.zones?.[1]?.polygon && inPolygon(node, incident.zones[1].polygon)
  return nearFire || inZone30
}

const publicNode = (n) => ({
  ...n,
  online: Date.now() - n.ts < Math.max(30_000, n.period * 3000),
  siren: sirenFor(n),
})

const publicState = async () => ({
  nodes: [...nodes.values()].map(publicNode),
  incident,
  weather: await getWeather(),
  store: storeMode(),
  center: CENTER,
  places: PLACES,
  sirenOverride,
  simulatorConnected: Date.now() - lastWorldAt < 3000,
})

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

// ---------------------------------------------------------------------------
// API monde simulé
// ---------------------------------------------------------------------------
app.post("/api/sim/world", (req, res) => {
  worldState = req.body
  lastWorldAt = Date.now()
  const cmds = [...worldCommandQueue]
  worldCommandQueue = []
  // Throttle : émettre world sur Socket.io max 1×/s
  io.emit("world", worldState)
  res.json({ commands: cmds })
})

app.get("/api/world", (_req, res) => res.json(worldState || {}))

app.post("/api/world/command", (req, res) => {
  const cmd = req.body
  if (!cmd || !cmd.type) return res.status(400).json({ error: "type manquant" })
  worldCommandQueue.push(cmd)
  res.json({ ok: true, queued: worldCommandQueue.length })
})

// Raccourcis conservés (compatibilité avec l'ancienne API)
app.post("/api/scenario/fire", (req, res) => {
  const { lat, lon } = req.body || {}
  worldCommandQueue.push({ type: "fire_start", ...(lat && lon ? { lat, lon } : { lat: CENTER.lat, lon: CENTER.lon }) })
  res.json({ ok: true })
})

app.post("/api/scenario/reset", (_req, res) => {
  worldCommandQueue.push({ type: "reset" })
  sirenOverride = null
  if (incident) closeIncident("réinitialisé")
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

  const result = evaluate([...nodes.values()], now)
  if (result.suspects.length) lastSuspectAt = now

  if (result.confirmed) {
    const isNew = !incident || incident.status !== "actif"
    incident = {
      ...(isNew ? { id: `INC-${now}`, startedAt: now, alertsSent: [] } : incident),
      ...result,
      status: "actif",
      updatedAt: now,
    }
    if (isNew) {
      console.log(`🔥 FEU CONFIRMÉ (${result.suspects.join(", ")}) → alertes`)
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
// Serveur CoAP : réception des mesures SenML/CBOR
// ---------------------------------------------------------------------------
function parseSenml(pack) {
  let bn = "", bt = 0
  const values = {}
  for (const rec of pack) {
    if (rec[-2] !== undefined) bn = rec[-2]       // nom de base
    if (rec[-3] !== undefined) bt = rec[-3]       // temps de base
    const name = rec[0]
    values[name] = rec[2] ?? rec[4] ?? rec[3]     // v, vb ou vs
  }
  const id = bn.split(":").filter(Boolean).pop()
  return { id, ts: bt ? bt * 1000 : Date.now(), values }
}

const coapServer = coap.createServer({ type: "udp4" })

coapServer.on("request", (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/fw/up")) {
    res.code = "4.04"
    return res.end()
  }
  let msg
  try {
    msg = parseSenml(decode(req.payload))
    if (!msg.id) throw new Error("bn manquant")
  } catch (e) {
    res.code = "4.00"
    return res.end(`SenML/CBOR invalide : ${e.message}`)
  }

  const v = msg.values
  const readings = {
    temp: v.temp, hum: v.hum, smoke: v.smoke, co: v.co, flame: !!v.flame,
    wind_speed: v.wind_speed, wind_dir: v.wind_dir, bat: v.bat,
  }
  const status = nodeStatus(readings)
  const danger = status !== "ok" || incident?.status === "actif"
  const node = {
    id: msg.id,
    lat: v.lat,
    lon: v.lon,
    ts: Date.now(),
    readings,
    status,
    risk: riskIndex(readings),
    period: danger ? config.periodAlert : config.periodNormal,
    bytes: req.payload.length,
  }
  nodes.set(node.id, node)
  saveMeasurement({ node: node.id, ts: new Date(msg.ts), lat: node.lat, lon: node.lon, status, ...readings })

  runDetection()

  // Réponse CoAP = ordres pour le nœud (comme une fenêtre de réception LoRaWAN)
  // Contient uniquement period et siren : les ordres du monde passent par /api/sim/world
  const reply = { period: node.period, siren: sirenFor(node) }
  res.code = "2.04"
  res.setOption("Content-Format", "application/cbor")
  res.end(encode(reply))

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
