/**
 * Calcule les indicateurs d'incendie par appareil.
 * Entrée : mesures brutes + z-scores + vitesses de montée.
 * Sortie : { flame, hotspot, smoke, co, tempRise, humDrop, coSmokeRatio, any }
 */

/** Seuils absolus */
const THRESH = {
  smoke_ppm:   300,
  co_ppm:      35,
  smoke_z:     4,
  co_z:        4,
  temp_rise:   3,     // °C/min
  hum_drop:    -5,    // %/min (négatif = chute)
  ir_hot:      0.6,
  tmax_hot:    60,    // °C caméra thermique
}

/**
 * Seuils effectifs : constantes par défaut, remplacées par ceux de la page
 * Paramètres ({ smokePpm, coPpm, tempRisePerMin, humDropPerMin, irHot, tmaxHot }).
 */
function effectiveThresholds(custom) {
  if (!custom) return THRESH
  const num = (v, d) => (Number.isFinite(v) ? v : d)
  return {
    ...THRESH,
    smoke_ppm: num(custom.smokePpm, THRESH.smoke_ppm),
    co_ppm:    num(custom.coPpm, THRESH.co_ppm),
    temp_rise: num(custom.tempRisePerMin, THRESH.temp_rise),
    hum_drop:  Number.isFinite(custom.humDropPerMin) ? -Math.abs(custom.humDropPerMin) : THRESH.hum_drop,
    ir_hot:    num(custom.irHot, THRESH.ir_hot),
    tmax_hot:  num(custom.tmaxHot, THRESH.tmax_hot),
  }
}

/**
 * @param {object} readings      – mesures brutes du nœud
 * @param {object} z             – { temp, hum, smoke, co, wind_speed, … }
 * @param {object} rates         – vitesses (unité/min) pour temp, hum, smoke, co
 * @param {object} [custom]      – seuils de la page Paramètres (optionnel)
 * @returns {object}             – indicateurs booléens + scores bruts
 */
export function computeIndicators(readings, z = {}, rates = {}, custom = undefined) {
  const r = readings || {}
  const THRESH = effectiveThresholds(custom)

  // Flamme directe (capteur IR KY-026)
  const flame = !!r.flame

  // Point chaud (caméra thermique ou IR)
  const hotspot = flame || (r.ir ?? 0) > THRESH.ir_hot || (r.tmax ?? 0) > THRESH.tmax_hot

  // Fumée (absolu ou z-score)
  const smoke = (r.smoke ?? 0) > THRESH.smoke_ppm || (z.smoke ?? 0) > THRESH.smoke_z

  // CO (absolu ou z-score)
  const co = (r.co ?? 0) > THRESH.co_ppm || (z.co ?? 0) > THRESH.co_z

  // Montée rapide de température
  const tempRise = (rates.temp ?? 0) > THRESH.temp_rise

  // Chute rapide d'humidité
  const humDrop = (rates.hum ?? 0) < THRESH.hum_drop

  // Rapport CO/fumée (élevé = combustion incomplète, feu de forêt)
  const smokeVal = Math.max(1, r.smoke ?? 1)
  const coSmokeRatio = (r.co ?? 0) / smokeVal

  return {
    flame,
    hotspot,
    smoke,
    co,
    tempRise,
    humDrop,
    coSmokeRatio,
    any: flame || hotspot || smoke || co || tempRise || humDrop,
  }
}
