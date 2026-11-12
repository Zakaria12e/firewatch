/**
 * Localisation du foyer par inversion du panache.
 *
 * Méthode : barycentre pondéré (fumée × ΔT²), puis affinement par la flamme
 * et les relèvements des caméras thermiques.
 * Retourne { lat, lon, uncertainty_m }.
 */

import { distance } from "../geo.js"

/**
 * Localise le foyer à partir des capteurs suspects.
 *
 * @param {object[]} suspects   – [{lat, lon, readings, indicators}]
 * @param {object[]} allNodes   – tous les nœuds (pour la température médiane)
 * @param {object}   wind       – { speed, from }
 * @returns {{ lat, lon, uncertainty_m }}
 */
export function localizeFire(suspects, allNodes, wind) {
  if (!suspects.length) return null

  // Si un seul suspect avec flamme : c'est lui
  const flaming = suspects.filter((n) => n.indicators?.flame || n.indicators?.hotspot)
  if (flaming.length === 1 && suspects.length === 1) {
    return { lat: flaming[0].lat, lon: flaming[0].lon, uncertainty_m: 100 }
  }

  // Température médiane (tous nœuds, pour calculer la hausse)
  const temps = allNodes.map((n) => n.readings?.temp).filter((v) => v !== undefined).sort((a, b) => a - b)
  const baseTemp = temps.length ? temps[Math.floor(temps.length / 2)] : 20

  // Barycentre pondéré : poids = fumée × (ΔT)² × (flamme ? 4 : 1)
  let wSum = 0, lat = 0, lon = 0
  for (const n of suspects) {
    const r = n.readings || {}
    const dT = Math.max(1, (r.temp ?? baseTemp) - baseTemp)
    const w = (r.smoke ?? 10) * dT ** 2 * (n.indicators?.flame ? 4 : 1)
    wSum += w; lat += n.lat * w; lon += n.lon * w
  }
  if (wSum < 1) {
    lat = suspects.reduce((s, n) => s + n.lat, 0) / suspects.length
    lon = suspects.reduce((s, n) => s + n.lon, 0) / suspects.length
    wSum = 1
  }
  const pos = { lat: lat / wSum, lon: lon / wSum }

  // Incertitude = dispersion des suspects autour du barycentre
  const dists = suspects.map((n) => distance(n, pos))
  const uncertainty_m = dists.length
    ? Math.round(dists.reduce((s, d) => s + d, 0) / dists.length)
    : 500

  return { ...pos, uncertainty_m }
}

/**
 * Regroupe les suspects en clusters (un cluster = un foyer potentiel).
 * Utilise un clustering simple par distance max.
 *
 * @param {object[]} suspects
 * @param {number}   maxDistM   – distance max pour appartenir au même cluster
 * @returns {object[][]}        – liste de clusters
 */
export function clusterSuspects(suspects, maxDistM = 2000) {
  if (!suspects.length) return []
  const clusters = []
  const used = new Set()

  for (let i = 0; i < suspects.length; i++) {
    if (used.has(i)) continue
    const cluster = [suspects[i]]
    used.add(i)
    for (let j = i + 1; j < suspects.length; j++) {
      if (used.has(j)) continue
      if (cluster.some((c) => distance(c, suspects[j]) < maxDistM)) {
        cluster.push(suspects[j])
        used.add(j)
      }
    }
    clusters.push(cluster)
  }
  return clusters
}
