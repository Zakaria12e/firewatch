/**
 * Schéma des charges utiles LoRaWAN, partagé avec le simulateur (shared/lora-schema.json).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
export const SCHEMA = JSON.parse(
  fs.readFileSync(path.resolve(here, "../../../shared/lora-schema.json"), "utf-8")
)

export const FPORT = SCHEMA.fport
export const OVERHEAD = SCHEMA.overheadBytes

/** Tables inverses : code → nom. */
export const KIND_BY_CODE = new Map(Object.entries(SCHEMA.kinds).map(([k, c]) => [c, k]))
export const UNIT_BY_CODE = new Map(Object.entries(SCHEMA.units).map(([u, c]) => [c, u]))
export const CHANNEL_BY_CODE = new Map(
  Object.entries(SCHEMA.channels).map(([name, ch]) => [ch.code, { name, ...ch }])
)

/** Charge utile applicative maximale (octets) selon le facteur d'étalement, EU868. */
export const maxPayload = (sf) => SCHEMA.maxPayload[String(sf)] ?? 51
