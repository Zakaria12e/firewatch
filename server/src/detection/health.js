/**
 * Santé des appareils.
 * Module pur : prend la liste des nœuds, retourne les statuts de santé.
 *
 * Statuts possibles : "ok" | "hors_ligne" | "figé" | "aberrant" | "batterie_faible"
 */

const HISTORY_SIZE = 10   // messages gardés par canal pour détecter le gel

/** Plages physiques valides par mesure. */
const RANGES = {
  temp:        { min: -20,  max: 80  },
  hum:         { min: 0,    max: 100 },
  smoke:       { min: 0,    max: 2000 },
  co:          { min: 0,    max: 1000 },
  wind_speed:  { min: 0,    max: 60  },
  wind_dir:    { min: 0,    max: 360 },
  bat:         { min: 0,    max: 100 },
  ir:          { min: 0,    max: 1   },
}

/**
 * Variance d'un tableau de nombres.
 * Retourne 0 si tableau trop court.
 */
function variance(arr) {
  if (arr.length < 2) return Infinity
  const m = arr.reduce((s, x) => s + x, 0) / arr.length
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length
}

/**
 * Vérifie la santé d'un nœud.
 *
 * @param {object} node        – nœud avec {id, ts, readings, period, _history?}
 * @param {number} now         – timestamp actuel (ms)
 * @returns {{ fault: string, reasons: string[] }}
 */
export function checkHealth(node, now = Date.now()) {
  const reasons = []

  // 1. Hors ligne : pas de message depuis 3 × la période
  const silence = (now - node.ts) / 1000   // en secondes
  if (silence > 3 * (node.period || 30)) {
    return { fault: "hors_ligne", reasons: [`silence ${Math.round(silence)}s`] }
  }

  // 2. Batterie faible
  if ((node.readings?.bat ?? 100) < 15) {
    reasons.push("batterie < 15 %")
    return { fault: "batterie_faible", reasons }
  }

  // 3. Valeurs aberrantes (hors plage physique)
  const r = node.readings || {}
  for (const [key, range] of Object.entries(RANGES)) {
    const v = r[key]
    if (v === undefined) continue
    if (v < range.min || v > range.max) {
      reasons.push(`${key}=${v} hors plage [${range.min}, ${range.max}]`)
    }
  }
  if (reasons.length) return { fault: "aberrant", reasons }

  // 4. Capteur figé : variance nulle sur ≥ 5 messages pour ≥ 2 canaux
  //    (un seul canal stable peut être un signal physique réel, ex. CO constant)
  const hist = node._history || {}
  const frozenKeys = []
  for (const key of ["temp", "smoke", "co", "hum"]) {
    const vals = (hist[key] || []).filter((v) => typeof v === "number")
    if (vals.length >= 5 && variance(vals) < 1e-6) frozenKeys.push(key)
  }
  if (frozenKeys.length >= 2) {
    return { fault: "figé", reasons: [`canaux figés : ${frozenKeys.join(", ")}`] }
  }

  return { fault: "ok", reasons: [] }
}

/**
 * Met à jour l'historique glissant d'un nœud.
 * Retourne le nouveau _history (sans muter l'entrée).
 */
export function updateHistory(existing, readings) {
  const h = { ...existing }
  for (const [key, val] of Object.entries(readings)) {
    if (typeof val !== "number") continue
    const arr = h[key] ? [...h[key]] : []
    arr.push(val)
    if (arr.length > HISTORY_SIZE) arr.shift()
    h[key] = arr
  }
  return h
}
