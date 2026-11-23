/**
 * Pipeline de détection FireWatch (§6).
 *
 * Entrée : liste de nœuds avec leurs mesures + état interne (baseline, history).
 * Sortie : { level, score, confirmed, suspects, falseAlert, position,
 *            prediction, wind, events[] }
 *
 * Chaque étape est un module pur et testé.
 */

import { checkHealth, updateHistory } from "./health.js"
import { updateBaseline } from "./baseline.js"
import { computeIndicators } from "./indicators.js"
import { classifyCluster, isFogSmoke } from "./classifier.js"
import { fusionScore, alertLevel } from "./fusion.js"
import { localizeFire, clusterSuspects } from "./localize.js"
import { predict } from "./predict.js"
import { cameraVerdict, CAMERA } from "./camera.js"
import { riskIndex } from "../detect.js"

// État interne mutable : partagé entre les appels à evaluate()
// { [nodeId]: { baseline: { [channel]: state }, history: { [channel]: number[] } } }
const nodeState = new Map()

// Variation régionale (météo) : dernier instant où chaque appareil a montré l'indicateur
const REGIONAL_WINDOW_MS = 45_000
const regionalHits = { tempRise: new Map(), humDrop: new Map() }

/** Vent moyen vectoriel mesuré par les nœuds. */
function meanWind(nodes) {
  let n = 0, e = 0, s = 0, cnt = 0
  for (const node of nodes) {
    const r = node.readings
    if (r?.wind_speed === undefined) continue
    const rad = ((r.wind_dir ?? 0) * Math.PI) / 180
    n += Math.cos(rad); e += Math.sin(rad); s += r.wind_speed; cnt++
  }
  if (!cnt) return { speed: 0, from: 0 }
  const from = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360
  return { speed: s / cnt, from }
}

/**
 * Point d'entrée principal du pipeline.
 *
 * @param {object[]} allNodes  – nœuds avec {id, lat, lon, ts, readings, period}
 * @param {number}   now       – Date.now()
 * @param {object}   context   – { burnZones, roads, villages, isDay?, timeScale, worldWeather?, settings? }
 *                               roads / villages : carte statique de la zone (SIG)
 *                               settings = { thresholds, fusion } (page Paramètres)
 * @returns {object}           – résultat de l'évaluation
 */
export function evaluate(allNodes, now = Date.now(), context = {}) {
  const events = []

  // ----------------------------------------------------------------
  // Étape 1 : santé et mise à jour des états internes
  // ----------------------------------------------------------------
  const annotated = allNodes.map((node) => {
    let st = nodeState.get(node.id) || { baseline: {}, history: {} }
    // evaluate() tourne à chaque paquet de n'importe quel appareil : l'historique et la
    // ligne de base d'un nœud ne bougent qu'à l'arrivée d'un NOUVEAU paquet de ce nœud
    // (sinon un appareil qui émet peu se remplit de copies identiques → faux « figé »)
    const isNew = st.lastTs === undefined || node.ts !== st.lastTs

    // Historique glissant
    const history = isNew ? updateHistory(st.history, node.readings || {}) : st.history

    // Santé
    const nodeWithHistory = { ...node, _history: history }
    const health = checkHealth(nodeWithHistory, now)
    if (health.fault !== "ok" && health.fault !== st._prevFault) {
      events.push({ type: "santé", nodeId: node.id, fault: health.fault, reasons: health.reasons })
    }

    // Baseline EWMA + z-scores (recalculés seulement sur nouveau paquet)
    let z = st.z || {}
    let rates = st.rates || {}
    let baseline = st.baseline
    if (isNew) {
      z = {}
      rates = {}
      baseline = { ...st.baseline }
      for (const key of ["temp", "hum", "smoke", "co", "wind_speed"]) {
        const val = node.readings?.[key]
        if (val === undefined) continue
        const { state, z: zi, ratePerMin } = updateBaseline(baseline[key], val, node.ts, key)
        baseline[key] = state
        z[key] = zi
        rates[key] = ratePerMin
      }
    }

    // Mémoriser l'état mis à jour
    nodeState.set(node.id, { baseline, history, z, rates, lastTs: node.ts, _prevFault: health.fault })

    return { ...node, health, z, rates, _history: history }
  })

  // ----------------------------------------------------------------
  // Étape 2 : filtrer les nœuds valides (hors défaillants)
  // ----------------------------------------------------------------
  const valid = annotated.filter(
    (n) => n.health.fault !== "hors_ligne" && n.health.fault !== "figé" && n.health.fault !== "aberrant"
  )
  const recent = valid.filter((n) => now - n.ts < 60_000)

  // ----------------------------------------------------------------
  // Étape 3 : indicateurs par nœud
  // ----------------------------------------------------------------
  const settings = context.settings || {}
  const withIndicators = recent.map((n) => ({
    ...n,
    indicators: computeIndicators(n.readings, n.z, n.rates, settings.thresholds),
    risk: riskIndex(n.readings || {}),
  }))

  // Variation régionale : une hausse de température ou une chute d'humidité vue par la
  // moitié du réseau en moins de 45 s vient de la météo (front, changement de masse
  // d'air), pas d'un feu, qui reste local. Les capteurs émettent à des instants
  // différents : on compte les appareils distincts touchés sur la fenêtre.
  const capable = withIndicators.filter((n) => Number.isFinite(n.readings?.temp))
  for (const key of ["tempRise", "humDrop"]) {
    const hits = regionalHits[key]
    for (const n of capable) if (n.indicators[key]) hits.set(n.id, now)
    for (const [id, t] of hits) if (now - t > REGIONAL_WINDOW_MS) hits.delete(id)
    if (capable.length >= 4 && hits.size / capable.length >= 0.5) {
      for (const n of capable) {
        if (!n.indicators[key]) continue
        const i = { ...n.indicators, [key]: false }
        i.any = i.flame || i.hotspot || i.smoke || i.co || i.tempRise || i.humDrop
        n.indicators = i
      }
    }
  }

  const wind = meanWind(recent)
  // Indice de risque : seulement les appareils qui mesurent la météo
  const riskNodes = withIndicators.filter((n) => Number.isFinite(n.risk.value))
  const avgRisk = riskNodes.length
    ? { value: Math.round(riskNodes.reduce((s, n) => s + n.risk.value, 0) / riskNodes.length) }
    : { value: 0 }

  // ----------------------------------------------------------------
  // Étape 4 : suspects (au moins un indicateur)
  // Capteurs « brouillard » (MQ-2 trompé par l'humidité > 85 %, fumée seule) :
  // exclus de la fusion, pour qu'un vrai feu voisin reste détectable (§6.5)
  // ----------------------------------------------------------------
  const rawSuspects = withIndicators.filter((n) => n.indicators.any)
  const isFogOnly = isFogSmoke
  const fogNodes = rawSuspects.filter(isFogOnly)
  const suspects = rawSuspects.filter((n) => !isFogOnly(n))

  const falseAlerts = []
  if (fogNodes.length) {
    const fa = classifyCluster(fogNodes, gisContext(context, null, wind))
    if (fa) falseAlerts.push({ ...fa, position: localizeFire(fogNodes, allNodes, wind) })
  }

  const defects = annotated.filter((n) => n.health.fault !== "ok").map((n) => ({ id: n.id, fault: n.health.fault }))
  const calm = () => ({
    level: alertLevel(0, [], avgRisk, settings.fusion),
    score: 0,
    confirmed: false,
    suspects: [],
    falseAlert: falseAlerts[0] ?? null,
    falseAlerts,
    position: null,
    prediction: null,
    wind,
    riskIndex: avgRisk,
    events,
    defects,
  })
  if (!suspects.length) return calm()

  // ----------------------------------------------------------------
  // Étape 5 : groupes de suspects (plusieurs foyers possibles). Chaque groupe est
  // classé à chaque évaluation : une cause bénigne l'écarte, sinon il est candidat
  // ----------------------------------------------------------------
  const clusters = clusterSuspects(suspects, 2000)

  let bestResult = null
  let bestCluster = null
  for (const cluster of clusters) {
    const score = fusionScore(cluster, wind, avgRisk, settings.fusion)
    const level = alertLevel(score, cluster, avgRisk, settings.fusion)
    const pos = localizeFire(cluster, allNodes, wind)

    const fa = classifyCluster(cluster, gisContext(context, pos, wind))
    if (fa) {
      falseAlerts.push({ ...fa, position: pos, score, wouldBe: level })
      continue
    }

    // Prédiction (si niveau suffisant)
    const prediction = level !== "veille" && level !== "vigilance" && pos
      ? predict(pos, wind, context.worldWeather || recent[0]?.readings, withIndicators, context.timeScale)
      : null

    const result = {
      level,
      score,
      confirmed: level === "feu_confirmé",
      suspects: cluster.map((n) => n.id),
      position: pos,
      prediction,
      wind,
      riskIndex: avgRisk,
      events,
      defects,
    }
    if (!bestResult || score > bestResult.score) { bestResult = result; bestCluster = cluster }
  }

  if (!bestResult) return calm()

  // ----------------------------------------------------------------
  // Étape 6 : caméra thermique assignée (context.cameraTask) : sa mesure renforce
  // (point chaud → indicateur thermique, déjà dans la fusion) ou infirme l'alerte
  // ----------------------------------------------------------------
  const task = context.cameraTask
  if (task?.camId && task.target) {
    const cam = annotated.find((n) => n.id === task.camId)
    if (cam && now - cam.ts < 60_000 && cam.health.fault === "ok") {
      const v = cameraVerdict(cam, task.target, { tmaxHot: settings.thresholds?.tmaxHot ?? 60, los: task.los !== false })
      bestResult.camera = { ...v, target: task.target }
      if (v.state === "infirme") {
        // Rien de chaud là où la caméra regarde : confiance réduite (une flamme
        // avec de la fumée reste une confirmation : la caméra peut être masquée)
        const score = Math.round(bestResult.score * CAMERA.infirmFactor)
        const level = alertLevel(score, bestCluster, avgRisk, settings.fusion)
        bestResult.camera.scoreBefore = bestResult.score
        bestResult = { ...bestResult, score, level, confirmed: level === "feu_confirmé" }
      }
    }
  }
  return { ...bestResult, falseAlert: falseAlerts[0] ?? null, falseAlerts }
}

/** Contexte de la classification : carte de la zone (SIG) + zones de brûlage déclarées. */
function gisContext(context, estimatedPos, wind) {
  return {
    estimatedPos,
    wind,
    burnZones: context.burnZones || [],
    roads: context.roads || [],
    villages: context.villages || [],
    isDay: context.isDay,
  }
}

/** Réinitialise l'état interne (pour les tests). */
export function resetState() {
  nodeState.clear()
  regionalHits.tempRise.clear()
  regionalHits.humDrop.clear()
}
