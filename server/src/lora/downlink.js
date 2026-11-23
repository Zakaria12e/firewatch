/**
 * Downlink (fenêtre RX1) renvoyé dans la réponse CoAP : map CBOR à clés entières.
 *   1 = période d'envoi (s), 2 = sirène (0/1), 4 = réinscription demandée.
 * Module pur.
 */
import { Encoder } from "cbor-x"

// Map CBOR standard : sans l'étiquette 259 que cbor-x ajoute par défaut aux Map JS
// (et un objet JS donnerait des clés texte « "1" » au lieu d'entiers)
const enc = new Encoder({ useTag259ForMaps: false })

export const DL = { period: 1, siren: 2, rejoin: 4 }

export function encodeDownlink({ period, siren = false, rejoin = false } = {}) {
  const m = new Map()
  if (period !== undefined) m.set(DL.period, period)
  if (!rejoin) m.set(DL.siren, siren ? 1 : 0)
  if (rejoin) m.set(DL.rejoin, 1)
  return enc.encode(m)
}
