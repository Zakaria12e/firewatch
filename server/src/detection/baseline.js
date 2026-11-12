/**
 * Ligne de base par canal (EWMA) et z-score.
 *
 * Chaque nœud dispose de son propre état EWMA pour chaque mesure.
 * La vitesse de montée est en unités par seconde.
 */

const ALPHA_MEAN = 0.1    // lissage EWMA pour la moyenne (faible = lent à bouger)
const ALPHA_VAR  = 0.05   // lissage EWMA pour la variance

/** Variance minimale pour éviter division par zéro. */
const MIN_STD = { temp: 0.3, hum: 0.5, smoke: 5, co: 0.5, wind_speed: 0.3, default: 1 }

function minStd(key) {
  return MIN_STD[key] ?? MIN_STD.default
}

/**
 * Met à jour l'état EWMA d'un canal et retourne le nouvel état + z-score.
 *
 * @param {object|null} state  – { mean, var, prevVal, prevTs }
 * @param {number}      val    – nouvelle valeur
 * @param {number}      ts     – timestamp (ms) de cette mesure
 * @param {string}      key    – nom de la mesure (pour MIN_STD)
 * @returns {{ state: object, z: number, ratePerMin: number }}
 */
export function updateBaseline(state, val, ts, key = "default") {
  if (!state) {
    // Initialisation : pas encore de baseline
    return {
      state: { mean: val, var: minStd(key) ** 2, prevVal: val, prevTs: ts },
      z: 0,
      ratePerMin: 0,
    }
  }

  const dtMin = Math.max(0.001, (ts - state.prevTs) / 60_000)   // delta en minutes
  const ratePerMin = (val - state.prevVal) / dtMin

  // EWMA : met à jour lentement quand la mesure monte vite
  // (si z > 3, on n'adapte pas la baseline : c'est peut-être un vrai feu)
  const std = Math.sqrt(Math.max(state.var, minStd(key) ** 2))
  const z = (val - state.mean) / std
  const adapt = Math.abs(z) < 3   // on n'adapte pas si valeur anormale

  const newMean = adapt
    ? state.mean * (1 - ALPHA_MEAN) + val * ALPHA_MEAN
    : state.mean
  const diff2 = (val - state.mean) ** 2
  const newVar = adapt
    ? state.var * (1 - ALPHA_VAR) + diff2 * ALPHA_VAR
    : state.var

  return {
    state: { mean: newMean, var: newVar, prevVal: val, prevTs: ts },
    z,
    ratePerMin,
  }
}
