/**
 * Palette stricte du centre opérationnel : noir, gris #474747, orange feu #FF5A1F,
 * rouge #E0260E, braise #6B2510. Seules exceptions : petites pastilles d'état
 * OK (#30D158) et batterie faible (#FFD60A). Le texte est blanc à opacité variable.
 */
import type { LucideIcon } from "lucide-react"
import {
  Cpu, Thermometer, CloudFog, TriangleAlert, Flame, Camera,
  Wind, Leaf, CloudRain, Bell, Radio,
} from "lucide-react"
import type { AlertLevel, DeviceKind, NodeFault } from "@/types"

export const C = {
  black: "#000000",
  gray: "#474747",
  fire: "#FF5A1F",
  red: "#E0260E",
  ember: "#6B2510",
  ok: "#30D158",
  low: "#FFD60A",
  text: "rgba(255,255,255,0.92)",
  text2: "rgba(255,255,255,0.62)",
  text3: "rgba(255,255,255,0.40)",
  text4: "rgba(255,255,255,0.24)",
  line: "rgba(255,255,255,0.08)",
  fill: "rgba(255,255,255,0.05)",
} as const

/** Couleur hexadécimale avec opacité (#RRGGBB + alpha 0-1). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export const LEVEL_LABEL: Record<AlertLevel, string> = {
  veille: "Veille",
  vigilance: "Vigilance",
  suspicion: "Suspicion",
  "pré-alerte": "Pré-alerte",
  feu_confirmé: "Feu confirmé",
  maîtrisé: "Maîtrisé",
}

export const LEVEL_COLOR: Record<AlertLevel, string> = {
  veille: C.text3,
  vigilance: C.fire,
  suspicion: C.fire,
  "pré-alerte": C.fire,
  feu_confirmé: C.red,
  maîtrisé: C.text2,
}

export const levelColor = (l: string) => LEVEL_COLOR[l as AlertLevel] ?? C.text2
export const levelLabel = (l: string) => LEVEL_LABEL[l as AlertLevel] ?? l

/** Santé d'un appareil (§6.2) */
export const HEALTH_COLOR: Record<NodeFault, string> = {
  ok: C.ok,
  batterie_faible: C.low,
  hors_ligne: C.gray,
  figé: C.fire,
  dérive: C.fire,
  aberrant: C.red,
}

export const HEALTH_LABEL: Record<NodeFault, string> = {
  ok: "En ligne",
  batterie_faible: "Batterie faible",
  hors_ligne: "Hors ligne",
  figé: "Figé",
  dérive: "Dérive",
  aberrant: "Aberrant",
}

export const healthColor = (h: string) => HEALTH_COLOR[h as NodeFault] ?? C.gray
export const healthLabel = (h: string) => HEALTH_LABEL[h as NodeFault] ?? h

export interface KindMeta { label: string; model: string; Icon: LucideIcon }

export const KIND_META: Record<DeviceKind, KindMeta> = {
  station: { label: "Station", model: "ESP32 + LoRa", Icon: Cpu },
  temp:    { label: "Température", model: "DHT22", Icon: Thermometer },
  smoke:   { label: "Fumée", model: "MQ-2", Icon: CloudFog },
  co:      { label: "CO", model: "MQ-7", Icon: TriangleAlert },
  flame:   { label: "Flamme", model: "KY-026", Icon: Flame },
  thermal: { label: "Thermique", model: "MLX90640", Icon: Camera },
  wind:    { label: "Vent", model: "Anémomètre", Icon: Wind },
  fuel:    { label: "Combustible", model: "Sonde FMC", Icon: Leaf },
  rain:    { label: "Pluie", model: "Pluviomètre", Icon: CloudRain },
  siren:   { label: "Sirène", model: "Sirène + relais", Icon: Bell },
  gateway: { label: "Passerelle", model: "LoRaWAN", Icon: Radio },
}

export const kindMeta = (k: string): KindMeta => KIND_META[k as DeviceKind] ?? KIND_META.station

/** Couleur d'un lien radio selon le RSSI (dBm). */
export function rssiColor(rssi: number | undefined | null): string {
  if (rssi === undefined || rssi === null) return C.gray
  if (rssi >= -105) return C.fire
  if (rssi >= -118) return C.red
  return C.ember
}
