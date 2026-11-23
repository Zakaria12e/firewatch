/**
 * Outil Feu : intensité du départ choisie dans la palette, partagée avec la carte
 * (dépôt, double-clic, menu contextuel). Hors React pour éviter les re-rendus.
 */
import { useSyncExternalStore } from "react"

export type FireSize = "petit" | "moyen" | "grand"

/** Rayon d'allumage (m) : une cellule de 50 m pour un petit départ. */
export const FIRE_RADIUS: Record<FireSize, number> = { petit: 0, moyen: 75, grand: 150 }
export const FIRE_SIZE_LABEL: Record<FireSize, string> = { petit: "Petit", moyen: "Moyen", grand: "Grand" }

/** Rayon affiché du cercle d'allumage (le petit départ couvre une cellule). */
export const displayRadius = (radius: number) => Math.max(radius, 28)

/** Compte à rebours avant l'allumage (ms). */
export const IGNITION_DELAY_MS = 3000

let size: FireSize = "moyen"
const listeners = new Set<() => void>()

export const fireTool = {
  get size() { return size },
  get radius() { return FIRE_RADIUS[size] },
  setSize(s: FireSize) {
    size = s
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
}

export function useFireSize(): FireSize {
  return useSyncExternalStore(fireTool.subscribe, () => size)
}
