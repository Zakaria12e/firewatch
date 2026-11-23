/**
 * Suivi des métriques de performance FireWatch (§7).
 * Module pur : aucun accès réseau, aucune dépendance vers detection/.
 */

const newLora = () => ({
  measureFrames: 0,       // trames de mesures (FPort 2 ou 3) : base des comparaisons de taille
  compactBytes: 0,        // charge utile réellement émise (FRMPayload)
  senmlCborBytes: 0,      // même contenu en SenML/CBOR
  jsonBytes: 0,           // même contenu en SenML JSON (RFC 8428, labels texte)
  phyBytes: 0,            // trame complète (en-tête LoRaWAN + MIC)
  airtimeMs: 0,
  frames: 0,
  inscriptions: 0,
  oversize: 0,            // charge utile > maximum du SF (mode --senml-full)
  backhaul: 0,            // statistiques de passerelle par liaison filaire
  sf: {},                 // histogramme des facteurs d'étalement
  rejected: {},           // cause → nombre de trames rejetées
})

const state = {
  packetsReceived: 0,
  lora: newLora(),
  falseAlertsAvoided: 0,
  detectionEvents: [],     // [{fireStartMs, suspicionMs, confirmationMs}]
  _currentFire: null,      // {startMs, suspicionMs}
  scenarios: [],           // résultats banc d'essai (ajoutés par --bench)
}

// Compteurs SenML `seq` par appareil : PDR = reçus / émis (trous de séquence = pertes radio)
const seqById = new Map()   // id -> { first, last, received }

/**
 * Enregistre un paquet reçu.
 * @param {object} info
 *   { id, seq, type: "inscription"|"mesures"|"senml"|"backhaul",
 *     sizes?: {compact, senmlCbor, json, phy}, airtimeMs?, sf?, oversize? }
 */
export function recordPacket(info = {}) {
  state.packetsReceived++
  const L = state.lora
  if (info.type === "backhaul") {
    L.backhaul++
  } else {
    L.frames++
    L.airtimeMs += info.airtimeMs || 0
    if (info.sf) L.sf[info.sf] = (L.sf[info.sf] || 0) + 1
    if (info.oversize) L.oversize++
    if (info.type === "inscription") L.inscriptions++
    if ((info.type === "mesures" || info.type === "senml") && info.sizes) {
      L.measureFrames++
      L.compactBytes += info.sizes.compact || 0
      L.senmlCborBytes += info.sizes.senmlCbor || 0
      L.jsonBytes += info.sizes.json || 0
      L.phyBytes += info.sizes.phy || 0
    }
  }
  const { id, seq } = info
  if (id && Number.isFinite(seq)) {
    const s = seqById.get(id)
    if (!s || seq <= s.last - 1000 || seq < s.first) {
      // Nouvel appareil ou compteur remis à zéro (simulateur redémarré)
      seqById.set(id, { first: seq, last: seq, received: 1 })
    } else if (seq > s.last) {
      s.last = seq
      s.received++
    }
  }
}

/** Trame rejetée à la réception (cause = code de LoraError). */
export function recordRejected(cause) {
  state.lora.rejected[cause] = (state.lora.rejected[cause] || 0) + 1
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
  state.lora = newLora()
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

  const L = state.lora
  const pct = (part, whole) => (whole > 0 ? Math.round((1 - part / whole) * 1000) / 10 : 0)
  const per = (total) => (L.measureFrames > 0 ? Math.round(total / L.measureFrames) : 0)

  // Duty cycle utilisé par appareil (heure glissante, temps simulé), calculé à la réception
  const duties = nodes
    .filter((n) => Number.isFinite(n.lastPacket?.dutyPct))
    .map((n) => ({ id: n.id, pct: n.lastPacket.dutyPct }))
  const maxDuty = duties.reduce((m, d) => (d.pct > (m?.pct ?? -1) ? d : m), null)

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
      pdr: packetDeliveryRatio() ?? 100,   // trous de FCnt = trames perdues
      frames: L.frames,
      inscriptions: L.inscriptions,
      backhaul: L.backhaul,
      airtimeMsTotal: Math.round(L.airtimeMs),
      avgAirtimeMs: L.frames > 0 ? Math.round((L.airtimeMs / L.frames) * 10) / 10 : 0,
      sfHistogram: L.sf,
      oversize: L.oversize,
      rejected: L.rejected,
      dutyCycle: {
        limitPct: 1,
        avgPct: duties.length ? Math.round((duties.reduce((s, d) => s + d.pct, 0) / duties.length) * 1000) / 1000 : 0,
        maxPct: maxDuty?.pct ?? 0,
        maxId: maxDuty?.id ?? null,
      },
    },
    data: {
      // Ce qui part réellement sur l'air (CBOR compact) comparé au SenML JSON
      savingsPct: Math.round(pct(L.compactBytes, L.jsonBytes)),
      cborSavingsPct: pct(L.senmlCborBytes, L.jsonBytes),     // SenML/CBOR vs JSON
      compactVsSenmlPct: pct(L.compactBytes, L.senmlCborBytes), // compact vs SenML/CBOR
      measureFrames: L.measureFrames,
      avgJson: per(L.jsonBytes),
      avgSenmlCbor: per(L.senmlCborBytes),
      avgCompact: per(L.compactBytes),
      avgPhy: per(L.phyBytes),
      // compatibilité (banc d'essai, anciens écrans)
      cborBytes: L.compactBytes,
      jsonEstBytes: L.jsonBytes,
      avgPacketCbor: per(L.compactBytes),
    },
    health: {
      online,
      total,
    },
    scenarios: state.scenarios,
  }
}
