/**
 * Serveur réseau LoRaWAN simulé : reçoit l'enveloppe CoAP d'une passerelle
 * ({gw, rssi, snr, sf, freq, phy}), découpe la trame, décode la charge utile selon le FPort
 * et reconstruit le SenML complet que le reste du serveur consomme.
 *
 * État : appareils inscrits (DevAddr → inscription) et journal d'airtime par appareil
 * (duty cycle sur l'heure glissante, en temps simulé). Aucun accès réseau ni base.
 */
import { decode } from "cbor-x"
import { FPORT, maxPayload } from "./schema.js"
import { parsePhy, devAddrHex } from "./frame.js"
import { airtimeMs, minIntervalS } from "./airtime.js"
import { decodeInscription, decodeMeasures, buildSenml, senmlSizes, parseSenml, labelSenml } from "./codec.js"
import { LoraError } from "./errors.js"

const HOUR_S = 3600

export function createNetworkServer() {
  const byAddr = new Map()     // DevAddr → inscription
  const airLog = new Map()     // id → [{t (ms réels), air (ms)}]

  /** Part de l'heure glissante (temps simulé) passée à émettre, en %. */
  function dutyPct(id, now, air, timeFactor) {
    const windowMs = (HOUR_S / timeFactor) * 1000
    const log = (airLog.get(id) || []).filter((e) => now - e.t < windowMs)
    log.push({ t: now, air })
    airLog.set(id, log)
    const sum = log.reduce((s, e) => s + e.air, 0)
    return Math.round((sum / (HOUR_S * 1000)) * 100 * 1000) / 1000
  }

  function checkEnvelope(env) {
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      throw new LoraError("enveloppe", "enveloppe de passerelle attendue")
    }
    if (!(env.phy instanceof Uint8Array)) throw new LoraError("enveloppe", "champ phy absent")
    if (typeof env.gw !== "string" || !env.gw) throw new LoraError("enveloppe", "passerelle inconnue")
    if (!Number.isInteger(env.sf) || env.sf < 7 || env.sf > 12) {
      throw new LoraError("enveloppe", `facteur d'étalement invalide (${env.sf})`)
    }
  }

  /**
   * Traite un uplink relayé par une passerelle.
   * @param {object} env        enveloppe décodée
   * @param {object} opts       { now (ms), timeFactor (s simulées par s réelle) }
   * @returns {object}          { type, id, reg, readings?, fields?, pack?, frame, radio, sizes, … }
   * @throws {LoraError}        trame, enveloppe ou charge utile invalide ; rejoin si non inscrit
   */
  function handleUplink(env, { now = Date.now(), timeFactor = 1 } = {}) {
    checkEnvelope(env)
    const frame = parsePhy(env.phy)
    let obj
    try {
      obj = decode(frame.payload)
    } catch {
      throw new LoraError("cbor", "charge utile CBOR illisible")
    }

    const radio = { gw: env.gw, rssi: env.rssi, snr: env.snr, sf: env.sf, freq: env.freq }
    const air = airtimeMs(frame.length, env.sf)
    const common = {
      frame: {
        mhdr: frame.mhdr,
        confirmed: frame.confirmed,
        devAddr: devAddrHex(frame.devAddr),
        fctrl: frame.fctrl,
        fcnt: frame.fcnt,
        fport: frame.fport,
        headerBytes: frame.headerBytes,
        mic: Buffer.from(frame.mic).toString("hex"),
      },
      radio,
      phyHex: Buffer.from(env.phy).toString("hex"),
      airtimeMs: Math.round(air * 10) / 10,
      maxPayload: maxPayload(env.sf),
      oversize: frame.payload.length > maxPayload(env.sf),
      minPeriodS: minIntervalS(air) / timeFactor,
    }
    const sizes = { compact: frame.payload.length, phy: frame.length }

    if (frame.fport === FPORT.inscription) {
      const reg = { ...decodeInscription(obj), devAddr: frame.devAddr, registeredAt: now }
      byAddr.set(frame.devAddr, reg)
      return {
        ...common, type: "inscription", id: reg.id, reg, sizes,
        dutyPct: dutyPct(reg.id, now, air, timeFactor),
      }
    }

    if (frame.fport === FPORT.mesures) {
      const reg = byAddr.get(frame.devAddr)
      if (!reg) {
        throw new LoraError("inconnu", `appareil ${devAddrHex(frame.devAddr)} non inscrit`, { rejoin: true })
      }
      const { readings, fields } = decodeMeasures(reg, obj)
      const pack = buildSenml(reg, readings, { ts: now, ...radio, fcnt: frame.fcnt })
      // Comparaison à charge égale : le SenML que l'appareil aurait émis (sans les
      // métadonnées radio, ajoutées par la passerelle dans les deux cas)
      const deviceOnly = buildSenml(reg, readings, { ts: now })
      return {
        ...common, type: "mesures", id: reg.id, reg, readings, fields, pack,
        senml: labelSenml(pack),
        sizes: { ...sizes, ...senmlSizes(deviceOnly) },
        dutyPct: dutyPct(reg.id, now, air, timeFactor),
      }
    }

    if (frame.fport === FPORT.senml) {
      // SenML complet émis par l'appareil : autoportant (bn, position), sans inscription
      const msg = parseSenml(obj)
      const reg = byAddr.get(frame.devAddr) ?? null
      const pack = [...obj]
      for (const [n, u, v] of [["rssi", "dBm", radio.rssi], ["snr", "dB", radio.snr], ["sf", "1", radio.sf], ["seq", "1", frame.fcnt]]) {
        if (v !== undefined) pack.push({ 0: n, 1: u, 2: v })
      }
      pack.push({ 0: "gw", 3: radio.gw })
      const s = senmlSizes(obj)
      return {
        ...common, type: "senml", id: msg.id, reg, pack,
        senml: labelSenml(pack),
        sizes: { ...sizes, senmlCbor: s.senmlCbor, json: s.json },
        dutyPct: dutyPct(msg.id, now, air, timeFactor),
      }
    }

    throw new LoraError("fport", `FPort ${frame.fport} non géré`)
  }

  return {
    handleUplink,
    registration: (devAddr) => byAddr.get(devAddr),
    registrations: () => [...byAddr.values()],
    reset() {
      byAddr.clear()
      airLog.clear()
    },
  }
}
