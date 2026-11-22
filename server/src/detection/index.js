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
import { classifyFalseAlert } from "./classifier.js"
import { fusionScore, alertLevel } from "./fusion.js"
import { localizeFire, clusterSuspects } from "./localize.js"
import { predict } from "./predict.js"
import { riskIndex } from "../detect.js"

// État interne mutable : partagé entre les appels à evaluate()
// { [nodeId]: { baseline: { [channel]: state }, history: { [channel]: number[] } } }
const nodeState = new Map()

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
 * @param {object}   context   – { burnZones, timeScale, worldWeather?, settings? }
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

  const wind = meanWind(recent)
  // Indice de risque : seulement les appareils qui mesurent la météo
  const riskNodes = withIndicators.filter((n) => Number.isFinite(n.risk.value))
  const avgRisk = riskNodes.length
    ? { value: Math.round(riskNodes.reduce((s, n) => s + n.risk.value, 0) / riskNodes.length) }
    : { value: 0 }

  // ----------------------------------------------------------------
  // Étape 4 : suspects (au moins un indicateur)
  // Pré-filtrer les nœuds brouillard : MQ-2 trompé par humidité > 85 %
  // Ces capteurs sont exclus de la fusion (§6.5)
  // ----------------------------------------------------------------
  const rawSuspects = withIndicators.filter((n) => n.indicators.any)

  const fogExcluded = rawSuspects.filter((n) => {
    const hum = n.readings?.hum ?? 50
    return n.indicators.smoke && hum > 85 && !n.indicators.co && !n.indicators.flame
  })
  if (fogExcluded.length) {
    fogExcluded.forEach((n) =>
      events.push({ type: "fausse_alerte", nodeId: n.id, kind: "brouillard" })
    )
  }

  const suspects = rawSuspects.filter((n) => !fogExcluded.includes(n))

  if (!suspects.length) {
    const falseAlert = fogExcluded.length
      ? { kind: "brouillard", label: "Fausse fumée – humidité > 85 % (brouillard/condensation)" }
      : null
    return {
      level: alertLevel(0, [], avgRisk, settings.fusion),
      score: 0,
      confirmed: false,
      suspects: [],
      falseAlert,
      position: null,
      prediction: null,
      wind,
      riskIndex: avgRisk,
      events,
      defects: annotated.filter((n) => n.health.fault !== "ok").map((n) => ({
        id: n.id, fault: n.health.fault,
      })),
    }
  }

  // ----------------------------------------------------------------
  // Étape 5 : clusters de suspects (plusieurs foyers possibles)
  // ----------------------------------------------------------------
  const clusters = clusterSuspects(suspects, 2000)

  // Traiter chaque cluster indépendamment ; prendre le plus dangereux
  let bestResult = null
  for (const cluster of clusters) {
    const score = fusionScore(cluster, wind, avgRisk, settings.fusion)
    const level = alertLevel(score, cluster, avgRisk, settings.fusion)

    // Position estimée
    const pos = localizeFire(cluster, allNodes, wind)

    // Classification fausse alerte
    const context2 = {
      nearRoad: cluster.some((n) => n._nearRoad),
      burnZones: context.burnZones || [],
      villages: [
        { name: "Chefchaouen", lat: 35.1714, lon: -5.2697 },
        { name: "Akchour",     lat: 35.237,  lon: -5.175 },
        { name: "Bab Taza",    lat: 35.0547, lon: -5.1981 },
      ],
      estimatedPos: pos,
      confidence: score,
      isolated: cluster.length === 1,
    }
    const firstInd = cluster[0]?.indicators || {}
    const firstR   = cluster[0]?.readings || {}
    const falseAlert = classifyFalseAlert(firstInd, firstR, context2)

    // Prédiction (si niveau suffisant)
    const prediction = level !== "veille" && level !== "vigilance" && pos
      ? predict(pos, wind, context.worldWeather || recent[0]?.readings, withIndicators, context.timeScale)
      : null

    const result = {
      level,
      score,
      confirmed: level === "feu_confirmé",
      suspects: cluster.map((n) => n.id),
      falseAlert: falseAlert.kind ? falseAlert : null,
      position: pos,
      prediction,
      wind,
      riskIndex: avgRisk,
      events: [...events],
      defects: annotated.filter((n) => n.health.fault !== "ok").map((n) => ({
        id: n.id, fault: n.health.fault,
      })),
    }
    if (!bestResult || score > bestResult.score) bestResult = result
  }

  return bestResult
}

/** Réinitialise l'état interne (pour les tests). */
export function resetState() {
  nodeState.clear()
}
