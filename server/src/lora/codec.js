/**
 * Charges utiles FireWatch : inscription (FPort 1), mesures compactes (FPort 2),
 * reconstruction du SenML complet (RFC 8428, labels entiers). Module pur.
 */
import { encode } from "cbor-x"
import { SCHEMA, KIND_BY_CODE, UNIT_BY_CODE, CHANNEL_BY_CODE } from "./schema.js"
import { LoraError } from "./errors.js"

// Labels SenML entiers (RFC 8428 §6)
export const BN = -2, BT = -3, N = 0, U = 1, V = 2, VS = 3, VB = 4
const LABELS = [[BN, "bn"], [BT, "bt"], [N, "n"], [U, "u"], [V, "v"], [VS, "vs"], [VB, "vb"]]

const isInt = (x) => Number.isInteger(x)

/**
 * Inscription : [version, id, type, lat×1e5, lon×1e5, [codes canaux], [codes unités]].
 * Retourne l'enregistrement de l'appareil : { version, id, kind, lat, lon, fields, bits }.
 */
export function decodeInscription(obj) {
  if (!Array.isArray(obj) || obj.length !== 7) {
    throw new LoraError("format", "inscription : tableau de 7 éléments attendu")
  }
  const [version, id, kindCode, lat5, lon5, codes, units] = obj
  if (version !== SCHEMA.version) {
    throw new LoraError("version", `version de schéma ${version} inconnue (serveur : ${SCHEMA.version})`)
  }
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) {
    throw new LoraError("format", "inscription : identifiant invalide")
  }
  const kind = KIND_BY_CODE.get(kindCode)
  if (!kind) throw new LoraError("format", `type d'appareil ${kindCode} inconnu`)
  if (!isInt(lat5) || !isInt(lon5) || Math.abs(lat5) > 9_000_000 || Math.abs(lon5) > 18_000_000) {
    throw new LoraError("format", "inscription : position invalide")
  }
  if (!Array.isArray(codes) || !Array.isArray(units) || codes.length !== units.length) {
    throw new LoraError("format", "inscription : canaux et unités incohérents")
  }
  const fields = codes.map((code, i) => {
    const ch = CHANNEL_BY_CODE.get(code)
    if (!ch) throw new LoraError("format", `canal ${code} inconnu`)
    const unit = UNIT_BY_CODE.get(units[i])
    if (unit !== ch.u) {
      throw new LoraError("unité", `unité incompatible pour ${ch.name} : ${unit ?? units[i]} au lieu de ${ch.u}`)
    }
    return { name: ch.name, u: ch.u, scale: ch.scale }
  })
  return {
    version,
    id,
    kind,
    lat: lat5 / 1e5,
    lon: lon5 / 1e5,
    fields,
    bits: SCHEMA.layouts[kind]?.bits ?? [],
  }
}

/** Arrondi d'affichage : supprime le bruit binaire de la division par l'échelle. */
const unscale = (raw, scale) => Math.round((raw / scale) * 1000) / 1000

/**
 * Mesures compactes : tableau positionnel d'entiers défini par l'inscription.
 * Retourne { readings, fields } ; `fields` détaille le décodage de chaque position.
 */
export function decodeMeasures(reg, arr) {
  if (!Array.isArray(arr)) throw new LoraError("format", "mesures : tableau attendu")
  if (arr.length !== reg.fields.length) {
    throw new LoraError("format", `mesures : ${arr.length} valeurs au lieu de ${reg.fields.length} pour « ${reg.kind} »`)
  }
  const readings = {}
  const fields = []
  arr.forEach((raw, pos) => {
    const f = reg.fields[pos]
    if (raw === null || raw === undefined) {
      fields.push({ pos, n: f.name, raw: null, scale: f.scale, v: null, u: f.u })
      return
    }
    if (!isInt(raw)) throw new LoraError("format", `mesures : position ${pos} (${f.name}) non entière`)
    if (f.name === "flags") {
      reg.bits.forEach((bit, i) => { readings[bit] = ((raw >> i) & 1) === 1 })
      fields.push({ pos, n: "flags", raw, scale: 1, v: reg.bits.filter((_, i) => (raw >> i) & 1).join(",") || "—", u: "bits" })
      return
    }
    const v = unscale(raw, f.scale)
    readings[f.name] = v
    fields.push({ pos, n: f.name, raw, scale: f.scale, v, u: f.u })
  })
  return { readings, fields }
}

/**
 * Paquet SenML complet (labels entiers) reconstruit à partir de l'inscription, des mesures
 * et des métadonnées ajoutées par le réseau (passerelle, RSSI, SNR, SF, FCnt).
 */
export function buildSenml(reg, readings, { ts, rssi, snr, sf, fcnt, gw } = {}) {
  const pack = [
    { [BN]: `urn:dev:fw:${reg.id}:`, [BT]: Math.floor((ts ?? Date.now()) / 1000), [N]: "lat", [U]: "lat", [V]: reg.lat },
    { [N]: "lon", [U]: "lon", [V]: reg.lon },
  ]
  for (const f of reg.fields) {
    if (f.name === "flags") {
      for (const bit of reg.bits) if (bit in readings) pack.push({ [N]: bit, [VB]: readings[bit] })
      continue
    }
    if (readings[f.name] !== undefined) pack.push({ [N]: f.name, [U]: f.u, [V]: readings[f.name] })
  }
  if (rssi !== undefined) pack.push({ [N]: "rssi", [U]: "dBm", [V]: rssi })
  if (snr !== undefined) pack.push({ [N]: "snr", [U]: "dB", [V]: snr })
  if (sf !== undefined) pack.push({ [N]: "sf", [U]: "1", [V]: sf })
  if (fcnt !== undefined) pack.push({ [N]: "seq", [U]: "1", [V]: fcnt })
  if (gw !== undefined) pack.push({ [N]: "gw", [VS]: gw })
  return pack
}

/** SenML à labels entiers → labels texte (format JSON de la RFC 8428). */
export function labelSenml(pack) {
  return pack.map((rec) => {
    const out = {}
    for (const [k, label] of LABELS) if (rec[k] !== undefined) out[label] = rec[k]
    return out
  })
}

/** Tailles du même paquet en SenML/CBOR et en SenML JSON. */
export function senmlSizes(pack) {
  return {
    senmlCbor: encode(pack).length,
    json: Buffer.byteLength(JSON.stringify(labelSenml(pack))),
  }
}

/** Lecture d'un paquet SenML : identifiant (dernier segment de bn), horodatage, valeurs. */
export function parseSenml(pack) {
  if (!Array.isArray(pack) || !pack.length) throw new LoraError("format", "SenML : tableau attendu")
  let bn = "", bt = 0
  const values = {}
  for (const rec of pack) {
    if (!rec || typeof rec !== "object") throw new LoraError("format", "SenML : enregistrement invalide")
    if (rec[BN] !== undefined) bn = rec[BN]
    if (rec[BT] !== undefined) bt = rec[BT]
    values[rec[N]] = rec[V] ?? rec[VB] ?? rec[VS]
  }
  const id = String(bn).split(":").filter(Boolean).pop()
  if (!id) throw new LoraError("format", "SenML : bn manquant")
  return { id, ts: bt ? bt * 1000 : Date.now(), values }
}

/** Inscription (miroir de simulator/engine/lorawan.py) : tests et outils. */
export function encodeInscription(id, kind, lat, lon) {
  const lay = SCHEMA.layouts[kind] ?? { fields: [] }
  const ch = SCHEMA.channels
  return [
    SCHEMA.version, id, SCHEMA.kinds[kind], Math.round(lat * 1e5), Math.round(lon * 1e5),
    lay.fields.map((n) => ch[n].code),
    lay.fields.map((n) => SCHEMA.units[ch[n].u]),
  ]
}

/** Mesures compactes (miroir du simulateur) : valeur × échelle, arrondie, jamais bornée. */
export function encodeMeasures(kind, readings) {
  const lay = SCHEMA.layouts[kind]
  if (!lay) throw new LoraError("format", `type sans format compact : ${kind}`)
  return lay.fields.map((n) => {
    if (n === "flags") return (lay.bits ?? []).reduce((b, bit, i) => (readings[bit] ? b | (1 << i) : b), 0)
    const v = readings[n]
    return v === undefined || v === null ? null : Math.round(v * SCHEMA.channels[n].scale)
  })
}
