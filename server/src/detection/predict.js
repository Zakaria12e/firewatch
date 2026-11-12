/**
 * Prédiction de propagation : zones atteintes à 15/30/60 min réelles.
 * Entrée : position du foyer, vent mesuré, humidité, fmc, relief optionnel.
 * Sortie : { rosMPerMin, heading, zones, threatenedNodes, threatenedPlaces }
 */

import { offset, inPolygon, bearing, distance } from "../geo.js"
import { PLACES } from "../config.js"

export const HORIZONS = [15, 30, 60]   // minutes réelles

/**
 * Vitesse de propagation (m/min réelles) selon le modèle simplifié.
 * Inclut la pente si disponible (pente en degrés, positif = montée).
 */
export function rateOfSpread(wind_speed, hum, fmc = 20, slope_deg = 0) {
  const dryness = Math.max(0.3, (60 - hum) / 40) * Math.max(0.3, (40 - fmc) / 40)
  const slopeFactor = Math.exp(0.07 * Math.max(0, slope_deg))   // pente accélère le feu
  return Math.round((2 + 3 * wind_speed) * dryness * slopeFactor)
}

/**
 * Ellipse de propagation en minutes (polygone 32 points).
 */
export function spreadZone(origin, headingDeg, rosMPerMin, minutes) {
  const timeScale = 1   // minutes réelles directement
  const head = rosMPerMin * minutes * timeScale + 80
  const back = head * 0.15
  const halfW = head * 0.32 + 80
  const a = (head + back) / 2
  const c = (head - back) / 2
  const h = (headingDeg * Math.PI) / 180
  const poly = []
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * 2 * Math.PI
    const along = c + a * Math.cos(t)
    const cross = halfW * Math.sin(t)
    const north = along * Math.cos(h) - cross * Math.sin(h)
    const east = along * Math.sin(h) + cross * Math.cos(h)
    const p = offset(origin, north, east)
    poly.push([p.lat, p.lon])
  }
  return poly
}

/**
 * Calcule la prédiction complète.
 *
 * @param {object}   pos        – { lat, lon }
 * @param {object}   wind       – { speed, from }
 * @param {object}   weather    – { hum, fmc? }
 * @param {object[]} allNodes   – tous les nœuds
 * @param {number}   timeScale  – accélération démo (non utilisé ici : min réelles)
 * @returns {object}
 */
export function predict(pos, wind, weather, allNodes, timeScale = 15) {
  const hum = weather?.hum ?? 50
  const fmc = weather?.fmc ?? 20
  const ros = rateOfSpread(wind.speed, hum, fmc)
  const heading = (wind.from + 180) % 360

  const zones = HORIZONS.map((minutes) => ({
    minutes,
    polygon: spreadZone(pos, heading, ros, minutes),
  }))
  const outer = zones.at(-1).polygon

  const threatenedNodes = allNodes
    .filter((n) => inPolygon(n, outer))
    .map((n) => n.id)

  const threatenedPlaces = PLACES.map((p) => {
    const d = distance(pos, p)
    const b = bearing(pos, p)
    const diff = Math.abs(((b - heading + 540) % 360) - 180)
    if (diff > 60) return null   // pas dans le couloir de propagation
    const eta = ros > 0 ? Math.round(d / ros) : null
    return eta !== null && eta < 12 * 60 ? { ...p, distance: Math.round(d), eta } : null
  })
    .filter(Boolean)
    .sort((a, b) => a.eta - b.eta)

  // Surface estimée (approximation ellipse 30 min)
  const zone30 = zones[1].polygon
  const areaHa = estimateArea(zone30)

  return { rosMPerMin: ros, heading, zones, threatenedNodes, threatenedPlaces, areaHa, timeScale }
}

/** Surface approximée d'un polygone (formule du lacet, en ha). */
function estimateArea(poly) {
  let area = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[j]
    area += (x2 - x1) * (y2 + y1)
  }
  // Conversion en m² puis ha (approximation : 1° lat ≈ 111 320 m)
  const areaM2 = Math.abs(area) * 0.5 * 111_320 * 111_320 * Math.cos(35.135 * Math.PI / 180)
  return Math.round(areaM2 / 10_000)
}
