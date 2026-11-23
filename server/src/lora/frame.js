/**
 * Trame physique LoRaWAN 1.0.x (PHYPayload), liaison montante.
 *   MHDR(1) | DevAddr(4, LE) | FCtrl(1) | FCnt(2, LE) | FOpts(0-15) | FPort(1) | FRMPayload | MIC(4)
 * Module pur.
 */
import { LoraError } from "./errors.js"

export const MTYPE = { UNCONFIRMED_UP: 2, CONFIRMED_UP: 4 }

/** Découpe une trame montante. Lève LoraError si elle est mal formée. */
export function parsePhy(phy) {
  if (!(phy instanceof Uint8Array)) throw new LoraError("phy", "trame absente")
  const buf = Buffer.from(phy.buffer, phy.byteOffset, phy.byteLength)
  if (buf.length < 13) throw new LoraError("phy", `trame trop courte (${buf.length} o)`)
  const mhdr = buf[0]
  const mtype = mhdr >> 5
  if (mtype !== MTYPE.UNCONFIRMED_UP && mtype !== MTYPE.CONFIRMED_UP) {
    throw new LoraError("phy", `type de message non montant (MType ${mtype})`)
  }
  const devAddr = buf.readUInt32LE(1)
  const fctrl = buf[5]
  const fcnt = buf.readUInt16LE(6)
  const foptsLen = fctrl & 0x0f
  const portAt = 8 + foptsLen
  if (buf.length < portAt + 1 + 4) throw new LoraError("phy", "FPort absent")
  return {
    mhdr,
    mtype,
    confirmed: mtype === MTYPE.CONFIRMED_UP,
    devAddr,
    fctrl,
    fcnt,
    fport: buf[portAt],
    payload: buf.subarray(portAt + 1, buf.length - 4),
    mic: buf.subarray(buf.length - 4),
    headerBytes: portAt + 1,
    length: buf.length,
  }
}

/** Construit une trame montante (tests, outils). MIC à zéro. */
export function buildPhy({ devAddr, fcnt, fport, payload, confirmed = false }) {
  const head = Buffer.alloc(9)
  head[0] = (confirmed ? MTYPE.CONFIRMED_UP : MTYPE.UNCONFIRMED_UP) << 5
  head.writeUInt32LE(devAddr >>> 0, 1)
  head[5] = 0x80   // ADR
  head.writeUInt16LE(fcnt & 0xffff, 6)
  head[8] = fport
  return Buffer.concat([head, Buffer.from(payload), Buffer.alloc(4)])
}

/** DevAddr en hexadécimal (affichage, ordre réseau). */
export const devAddrHex = (a) => (a >>> 0).toString(16).toUpperCase().padStart(8, "0")
