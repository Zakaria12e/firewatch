import { PLACES, config } from "./config.js"
import { distance, offset, inPolygon, bearing } from "./geo.js"

export const THRESHOLDS = { smoke: 300, co: 35 }
const RECENT_MS = 60_000      // une mesure compte pendant 60 s
const CLUSTER_M = 2000        // deux capteurs suspects à moins de 2 km = confirmation
export const HORIZONS = [15, 30, 60] // minutes réelles

/** État d'un nœud à partir de ses capteurs. */
export function nodeStatus(r) {
  if (r.flame && r.smoke > THRESHOLDS.smoke) return "feu"
  if (r.smoke > THRESHOLDS.smoke || r.co > THRESHOLDS.co || r.flame) return "suspect"
  return "ok"
}

/** Indice de risque météo (0-100), inspiré des indices forêt-météo. */
export function riskIndex({ temp, hum, wind_speed }) {
  const score = (temp - 10) * 1.4 + (70 - hum) * 0.9 + wind_speed * 3.5
  const value = Math.round(Math.max(0, Math.min(100, score)))
  const level = value >= 80 ? "extrême" : value >= 60 ? "élevé" : value >= 35 ? "modéré" : "faible"
  return { value, level }
}

/** Vent moyen mesuré par les nœuds (moyenne vectorielle). */
function meanWind(nodes) {
  let n = 0, e = 0, s = 0
  for (const node of nodes) {
    const r = node.readings
    const rad = (r.wind_dir * Math.PI) / 180
    n += Math.cos(rad); e += Math.sin(rad); s += r.wind_speed
  }
  const dir = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360
  return { speed: s / nodes.length, from: dir }
}

/** Zone que le feu peut atteindre en `minutes` : ellipse allongée dans le sens du vent. */
function spreadZone(origin, heading, rosMPerMin, minutes) {
  const head = rosMPerMin * minutes + 80
  const back = head * 0.15
  const halfWidth = head * 0.32 + 80
  const a = (head + back) / 2
  const c = (head - back) / 2
  const h = (heading * Math.PI) / 180
  const poly = []
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * 2 * Math.PI
    const along = c + a * Math.cos(t)
    const cross = halfWidth * Math.sin(t)
    const north = along * Math.cos(h) - cross * Math.sin(h)
    const east = along * Math.sin(h) + cross * Math.cos(h)
    const p = offset(origin, north, east)
    poly.push([p.lat, p.lon])
  }
  return poly
}

/**
 * Analyse tous les nœuds et décide s'il y a un feu.
 * Règle : un nœud « feu » (flamme + fumée), ou au moins 2 nœuds suspects proches.
 */
export function evaluate(allNodes, now = Date.now()) {
  const recent = allNodes.filter((n) => now - n.ts < RECENT_MS)
  const suspects = recent.filter((n) => n.status !== "ok")
  const wind = recent.length ? meanWind(recent) : { speed: 0, from: 0 }

  let confirmed = suspects.some((n) => n.status === "feu")
  if (!confirmed) {
    for (let i = 0; i < suspects.length && !confirmed; i++)
      for (let j = i + 1; j < suspects.length; j++)
        if (distance(suspects[i], suspects[j]) < CLUSTER_M) { confirmed = true; break }
  }
  if (!confirmed) return { confirmed: false, suspects: suspects.map((n) => n.id), wind }

  // Position estimée : la fumée part loin sous le vent, la chaleur reste près du feu.
  // On pondère donc par la fumée × (hausse de température)².
  const temps = recent.map((n) => n.readings.temp).sort((a, b) => a - b)
  const baseTemp = temps[Math.floor(temps.length / 2)]
  let wsum = 0, lat = 0, lon = 0
  for (const n of suspects) {
    const rise = Math.max(1, n.readings.temp - baseTemp)
    const w = n.readings.smoke * rise ** 2 * (n.readings.flame ? 4 : 1)
    wsum += w; lat += n.lat * w; lon += n.lon * w
  }
  const position = { lat: lat / wsum, lon: lon / wsum }

  // Vitesse de propagation (règle simplifiée : vent + sécheresse)
  const hum = recent.reduce((s, n) => s + n.readings.hum, 0) / recent.length
  const dryness = Math.max(0.3, (60 - hum) / 40)
  const rosMPerMin = Math.round((2 + 3 * wind.speed) * dryness)
  const heading = (wind.from + 180) % 360

  const zones = HORIZONS.map((minutes) => ({ minutes, polygon: spreadZone(position, heading, rosMPerMin, minutes) }))
  const outer = zones.at(-1).polygon

  const threatenedNodes = allNodes.filter((n) => inPolygon(n, outer)).map((n) => n.id)
  const threatenedPlaces = PLACES.map((p) => {
    const d = distance(position, p)
    const ahead = Math.abs(((bearing(position, p) - heading + 540) % 360) - 180) < 50
    return { ...p, distance: Math.round(d), eta: ahead ? Math.round(d / rosMPerMin) : null }
  })
    .filter((p) => p.eta !== null && p.eta < 12 * 60)
    .sort((a, b) => a.eta - b.eta)

  return {
    confirmed: true,
    suspects: suspects.map((n) => n.id),
    wind,
    position,
    heading,
    rosMPerMin,
    zones,
    threatenedNodes,
    threatenedPlaces,
    timeScale: config.timeScale,
  }
}
