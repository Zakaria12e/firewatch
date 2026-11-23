/**
 * Ligne de base par canal (EWMA) et z-score.
 *
 * Chaque nœud dispose de son propre état EWMA pour chaque mesure.
 * La vitesse de montée est en unités par seconde.
 */

const ALPHA_MEAN = 0.1    // lissage EWMA pour la moyenne (faible = lent à bouger)
const ALPHA_VAR  = 0.05   // lissage EWMA pour la variance
const WARMUP     = 6      // mesures avant de calculer un z-score (ligne de base en chauffe)
// Vitesse de montée : sur au moins 30 s (entre deux paquets à 2 s d'intervalle, ±0,4 °C
// de bruit donneraient ±17 °C/min) ; historique gardé 90 s
const RATE_MIN_MS = 30_000
const RATE_KEEP_MS = 90_000

/** Vitesse (unités/min) entre la mesure et la plus récente des mesures d'au moins 30 s. */
function windowRate(hist, val, ts) {
  let ref = null
  for (const [t, v] of hist) if (ts - t >= RATE_MIN_MS) ref = [t, v]
  if (!ref) return 0
  return (val - ref[1]) / ((ts - ref[0]) / 60_000)
}

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
      state: { mean: val, var: minStd(key) ** 2, prevVal: val, prevTs: ts, n: 1, hist: [[ts, val]] },
      z: 0,
      ratePerMin: 0,
    }
  }

  const hist = (state.hist ?? [[state.prevTs, state.prevVal]]).filter(([t]) => ts - t <= RATE_KEEP_MS)
  const ratePerMin = windowRate(hist, val, ts)
  hist.push([ts, val])

  // EWMA : met à jour lentement quand la mesure monte vite
  // (si z > 3, on n'adapte pas la baseline : c'est peut-être un vrai feu)
  const std = Math.sqrt(Math.max(state.var, minStd(key) ** 2))
  const n = (state.n ?? WARMUP) + 1
  // En chauffe, la variance n'est pas encore apprise : pas de z-score (le bruit d'un
  // capteur dépasserait vite 4 σ) ; les seuils absolus restent actifs
  const zRaw = (val - state.mean) / std
  const z = n > WARMUP ? zRaw : 0
  const adapt = Math.abs(zRaw) < 3   // on n'adapte pas si valeur anormale

  const newMean = adapt
    ? state.mean * (1 - ALPHA_MEAN) + val * ALPHA_MEAN
    : state.mean
  const diff2 = (val - state.mean) ** 2
  const newVar = adapt
    ? state.var * (1 - ALPHA_VAR) + diff2 * ALPHA_VAR
    : state.var

  return {
    state: { mean: newMean, var: newVar, prevVal: val, prevTs: ts, n, hist },
    z,
    ratePerMin,
  }
}
