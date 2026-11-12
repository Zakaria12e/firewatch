/**
 * Fusion multi-capteurs et score de confiance (0-100).
 *
 * Score = Σ poids_indicateur × corroboration_voisins × cohérence_vent × prior_météo
 *
 * Poids par indicateur :
 *   flamme 40, thermique 45, fumée 25, CO 20, montée_temp 15, chute_hum 10
 */

import { distance, bearing } from "../geo.js"

const WEIGHTS = { flame: 40, hotspot: 45, smoke: 25, co: 20, tempRise: 15, humDrop: 10 }

/**
 * Calcule le score de confiance (0-100) pour un groupe de nœuds suspects.
 *
 * @param {object[]} suspects  – nœuds avec {lat, lon, indicators, readings, z}
 * @param {object}   wind      – { speed, from }   (from = d'où vient le vent, degrés)
 * @param {object}   riskIndex – { value: 0-100 } (indice météo)
 * @returns {number}           – score 0-100
 */
export function fusionScore(suspects, wind, riskIndex) {
  if (!suspects.length) return 0

  // 1. Score brut par indicateur (pondéré par le nombre de nœuds qui le voient)
  let raw = 0
  let total_weight = 0
  for (const [key, w] of Object.entries(WEIGHTS)) {
    total_weight += w
    const count = suspects.filter((n) => n.indicators?.[key]).length
    if (count > 0) raw += w * Math.min(1, count / suspects.length + 0.3)
  }
  const baseScore = (raw / total_weight) * 100

  // 2. Corroboration : bonus si plusieurs nœuds indépendants confirment
  const corroboration = suspects.length >= 3 ? 1.2 : suspects.length >= 2 ? 1.1 : 1.0

  // 3. Cohérence avec le vent :
  //    Les capteurs qui sentent la fumée doivent être sous le vent (downwind)
  //    d'une même source estimée.
  const windCoherence = computeWindCoherence(suspects, wind)

  // 4. Prior météo (risque élevé = plus probable que ce soit un vrai feu)
  const prior = 0.7 + 0.3 * (riskIndex?.value ?? 50) / 100

  const score = Math.round(baseScore * corroboration * windCoherence * prior)
  return Math.max(0, Math.min(100, score))
}

/**
 * Vérifie la cohérence de position par rapport au vent.
 * Si les suspects fument et sont alignés sous le vent d'une source estimée → bonus.
 */
function computeWindCoherence(suspects, wind) {
  if (!wind || suspects.length < 2) return 1.0

  // Source estimée = barycentre des suspects avec flamme ou plus haute fumée
  const anchors = suspects.filter((n) => n.indicators?.flame || n.indicators?.hotspot)
  if (!anchors.length) return 1.0

  const src = anchors.reduce(
    (acc, n) => ({ lat: acc.lat + n.lat / anchors.length, lon: acc.lon + n.lon / anchors.length }),
    { lat: 0, lon: 0 }
  )

  // Direction downwind depuis la source
  const downwind = (wind.from + 180) % 360

  // Les capteurs détectant de la fumée doivent être dans un cône ±60° de la direction downwind
  const smokers = suspects.filter((n) => n.indicators?.smoke || n.indicators?.co)
  if (!smokers.length) return 1.0

  let aligned = 0
  for (const s of smokers) {
    const b = bearing(src, s)
    const diff = Math.abs(((b - downwind + 540) % 360) - 180)
    if (diff < 60) aligned++
  }
  const ratio = aligned / smokers.length
  return 0.7 + 0.3 * ratio   // 0.7 … 1.0
}

/**
 * Détermine le niveau d'alerte selon le score et les indicateurs.
 *
 * @param {number}   score
 * @param {object[]} suspects
 * @returns {"veille"|"vigilance"|"suspicion"|"pré-alerte"|"feu_confirmé"}
 */
export function alertLevel(score, suspects, riskIndex) {
  // Feu confirmé immédiat : flamme + fumée, ou thermique + fumée
  const hasFlame = suspects.some((n) => n.indicators?.flame)
  const hasHot   = suspects.some((n) => n.indicators?.hotspot)
  const hasSmoke = suspects.some((n) => n.indicators?.smoke)
  if ((hasFlame && hasSmoke) || (hasHot && hasSmoke)) return "feu_confirmé"
  if (score >= 75) return "feu_confirmé"
  if (score >= 50) return "pré-alerte"
  if (score >= 20) return "suspicion"
  if ((riskIndex?.value ?? 0) >= 60) return "vigilance"
  return "veille"
}
