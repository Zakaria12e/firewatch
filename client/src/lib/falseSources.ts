/** Sources de fausses alertes : libellés, icônes et effets (palette, carte, journal). */
import type { LucideIcon } from "lucide-react"
import { Wheat, Beef, Truck, CloudFog, Sun } from "lucide-react"
import type { FalseSourceKind } from "@/types"

export interface FalseSourceMeta { label: string; short: string; tooltip: string; Icon: LucideIcon }

export const FALSE_SOURCES: Record<FalseSourceKind, FalseSourceMeta> = {
  brulage: { label: "Brûlage agricole", short: "Brûlage", Icon: Wheat,
    tooltip: "Brûlage agricole déclaré : vraie fumée, zone déclarée automatiquement (200 m)" },
  barbecue: { label: "Barbecue", short: "Barbecue", Icon: Beef,
    tooltip: "Barbecue : petite fumée. Près du hameau, classé « barbecue probable »" },
  vehicule: { label: "Véhicule", short: "Véhicule", Icon: Truck,
    tooltip: "Véhicule moteur tournant : CO sans fumée, placé sur la piste la plus proche" },
  brouillard: { label: "Brouillard", short: "Brouillard", Icon: CloudFog,
    tooltip: "Brouillard sur 900 m : humidité > 85 %, les MQ-2 lisent une fausse fumée" },
  soleil: { label: "Soleil sur un capteur", short: "Soleil", Icon: Sun,
    tooltip: "Soleil direct sur le boîtier de l'appareil le plus proche : chaleur sans fumée" },
}

export const FALSE_KINDS = Object.keys(FALSE_SOURCES) as FalseSourceKind[]

/** Préfixe du glisser-déposer depuis la palette. */
export const FALSE_DRAG_PREFIX = "__false__:"
