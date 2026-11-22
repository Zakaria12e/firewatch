/**
 * Suivi des métriques de performance FireWatch (§7).
 * Module pur : aucun accès réseau, aucune dépendance vers detection/.
 */

const state = {
  packetsReceived: 0,
  cborBytesTotal: 0,
  jsonBytesTotal: 0,
  falseAlertsAvoided: 0,
  detectionEvents: [],     // [{fireStartMs, suspicionMs, confirmationMs}]
  _currentFire: null,      // {startMs, suspicionMs}
  scenarios: [],           // résultats banc d'essai (ajoutés par --bench)
}

// Compteurs SenML `seq` par appareil : PDR = reçus / émis (trous de séquence = pertes radio)
const seqById = new Map()   // id -> { first, last, received }

/**
 * Enregistre un paquet CoAP reçu.
 * @param {number} cborLen  taille du payload CBOR en octets
 * @param {number} jsonLen  taille JSON équivalente calculée côté appelant
 * @param {{id: string, seq?: number}} [meta]  compteur de trame de l'appareil
 */
export function recordPacket(cborLen, jsonLen, meta = undefined) {
  state.packetsReceived++
  state.cborBytesTotal += cborLen
  state.jsonBytesTotal += jsonLen
  if (meta?.id && Number.isFinite(meta.seq)) {
    const s = seqById.get(meta.id)
    if (!s || meta.seq <= s.last - 1000 || meta.seq < s.first) {
      // Nouvel appareil ou compteur remis à zéro (simulateur redémarré)
      seqById.set(meta.id, { first: meta.seq, last: meta.seq, received: 1 })
    } else if (meta.seq > s.last) {
      s.last = meta.seq
      s.received++
    }
  }
}

/** PDR (%) estimé à partir des numéros de séquence ; null si aucune donnée. */
function packetDeliveryRatio() {
  let received = 0
  let expected = 0
  for (const s of seqById.values()) {
    received += s.received
    expected += s.last - s.first + 1
  }
  return expected > 0 ? Math.round((received / expected) * 1000) / 10 : null
}

/**
 * Signale le démarrage d'un incendie réel (depuis vérité terrain).
 * Ne remplace pas un feu déjà en cours.
 */
export function recordFireStart(startMs) {
  if (!state._currentFire) {
    state._currentFire = { startMs, suspicionMs: null, confirmationMs: null }
  }
}

/** Enregistre la première suspicion pour le feu en cours. */
export function recordSuspicion(nowMs) {
  if (state._currentFire && !state._currentFire.suspicionMs) {
    state._currentFire.suspicionMs = nowMs
  }
}

/** Enregistre la confirmation du feu en cours et clôt l'événement. */
export function recordConfirmation(nowMs) {
  if (state._currentFire && !state._currentFire.confirmationMs) {
    state._currentFire.confirmationMs = nowMs
    state.detectionEvents.push({ ...state._currentFire })
  }
}

/** Réinitialise le tracking du feu courant (reset / maîtrisé). */
export function recordFireReset() {
  state._currentFire = null
}

/** Incrémente le compteur de fausses alertes évitées. */
export function recordFalseAlertAvoided() {
  state.falseAlertsAvoided++
}

/** Ajoute un résultat de banc d'essai. */
export function addBenchResult(result) {
  state.scenarios.push(result)
}

/** Remet toutes les métriques à zéro (utile entre deux runs du banc). */
export function resetMetrics() {
  state.packetsReceived = 0
  state.cborBytesTotal = 0
  state.jsonBytesTotal = 0
  state.falseAlertsAvoided = 0
  state.detectionEvents = []
  state._currentFire = null
  seqById.clear()
  // On garde state.scenarios (résultats cumulatifs du banc)
}

/**
 * Calcule et retourne le snapshot courant de toutes les métriques.
 * @param {object[]} nodes  nœuds publics (avec .online, .bytes)
 */
export function getMetrics(nodes) {
  const events = state.detectionEvents
  const confirmTimes = events
    .filter((e) => e.confirmationMs != null && e.startMs != null)
    .map((e) => Math.round((e.confirmationMs - e.startMs) / 1000))
  const suspTimes = events
    .filter((e) => e.suspicionMs != null && e.startMs != null)
    .map((e) => Math.round((e.suspicionMs - e.startMs) / 1000))

  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null)

  const cbor = state.cborBytesTotal
  const json = state.jsonBytesTotal
  const savingsPct = json > 0 ? Math.round((1 - cbor / json) * 100) : 0

  const online = nodes.filter((n) => n.online).length
  const total = nodes.length

  return {
    detection: {
      events,
      confirmTimes,
      suspTimes,
      avgConfirmS: avg(confirmTimes),
      avgSuspS: avg(suspTimes),
      count: events.length,
    },
    falseAlerts: {
      avoided: state.falseAlertsAvoided,
    },
    network: {
      packetsReceived: state.packetsReceived,
      pdr: packetDeliveryRatio() ?? 100,   // trous de séquence SenML = paquets perdus
    },
    data: {
      cborBytes: cbor,
      jsonEstBytes: json,
      savingsPct,
      avgPacketCbor: state.packetsReceived > 0 ? Math.round(cbor / state.packetsReceived) : 0,
    },
    health: {
      online,
      total,
    },
    scenarios: state.scenarios,
  }
}
