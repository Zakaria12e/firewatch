/**
 * Temps d'antenne LoRa et duty cycle EU868. Module pur.
 */
import { SCHEMA } from "./schema.js"

/** Temps d'antenne (ms) d'une trame de `phyBytes` octets (Semtech AN1200.13, BW 125 kHz, CR 4/5). */
export function airtimeMs(phyBytes, sf, { bw = 125_000, cr = 1, preamble = 8 } = {}) {
  const tSym = (2 ** sf / bw) * 1000
  const de = sf >= 11 ? 1 : 0
  const num = 8 * phyBytes - 4 * sf + 28 + 16
  const nPayload = 8 + Math.max(Math.ceil(num / (4 * (sf - 2 * de))) * (cr + 4), 0)
  return (preamble + 4.25) * tSym + nPayload * tSym
}

/** Silence minimal (s) après une émission pour respecter le duty cycle (1 % en EU868). */
export const minIntervalS = (airtime, duty = SCHEMA.dutyCycle) => (airtime / 1000) * (1 / duty - 1)
