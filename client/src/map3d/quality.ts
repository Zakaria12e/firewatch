/**
 * Réglage « Qualité des effets 3D » (Bas / Moyen / Haut) et préférence système
 * prefers-reduced-motion. Réglage local au navigateur (localStorage), partagé
 * entre la page Paramètres et la carte via useSyncExternalStore.
 */
import { useSyncExternalStore } from "react"

export type EffectsQuality = "bas" | "moyen" | "haut"

export interface QualityPreset {
  fire: number        // particules de flammes
  embers: number      // braises
  smoke: number       // sprites de fumée
  wind: number        // traînées de vent
  water: number       // gouttes du Canadair
  rain: number        // gouttes de pluie
  dome: boolean       // dôme de couverture des passerelles
  waves: boolean      // ondes radio / sirène
}

export const QUALITY_PRESETS: Record<EffectsQuality, QualityPreset> = {
  bas:   { fire: 1000, embers: 140, smoke: 220,  wind: 600,  water: 1200, rain: 1200, dome: false, waves: true },
  moyen: { fire: 2200, embers: 360, smoke: 520,  wind: 1100, water: 2400, rain: 2600, dome: true,  waves: true },
  haut:  { fire: 3600, embers: 700, smoke: 900,  wind: 1500, water: 3600, rain: 4000, dome: true,  waves: true },
}

export const QUALITY_LABEL: Record<EffectsQuality, string> = { bas: "Bas", moyen: "Moyen", haut: "Haut" }

const KEY_QUALITY = "fw.effectsQuality"
const KEY_FPS = "fw.showFps"

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* navigation privée */ }
}

function initialQuality(): EffectsQuality {
  const v = readStorage(KEY_QUALITY)
  return v === "bas" || v === "moyen" || v === "haut" ? v : "haut"
}

let quality: EffectsQuality = typeof window === "undefined" ? "haut" : initialQuality()
let showFps = typeof window === "undefined" ? false : readStorage(KEY_FPS) === "1"
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export const getEffectsQuality = () => quality
export function setEffectsQuality(q: EffectsQuality) {
  quality = q
  writeStorage(KEY_QUALITY, q)
  notify()
}
export const getShowFps = () => showFps
export function setShowFps(v: boolean) {
  showFps = v
  writeStorage(KEY_FPS, v ? "1" : "0")
  notify()
}

export function useEffectsQuality(): EffectsQuality {
  return useSyncExternalStore(subscribe, getEffectsQuality, () => "haut" as EffectsQuality)
}
export function useShowFps(): boolean {
  return useSyncExternalStore(subscribe, getShowFps, () => false)
}

// ---------------------------------------------------------------------------
// prefers-reduced-motion
// ---------------------------------------------------------------------------
const mq = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null

export const prefersReducedMotion = () => !!mq?.matches

function subscribeMotion(l: () => void) {
  mq?.addEventListener("change", l)
  return () => mq?.removeEventListener("change", l)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false)
}
