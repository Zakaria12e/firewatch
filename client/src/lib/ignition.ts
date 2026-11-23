/**
 * Départ de feu en attente : géométrie (cercle d'allumage, ligne de feu), tracé à main
 * levée et proximité d'un feu pour le menu contextuel. Fonctions pures.
 */
import type { FeatureCollection } from "geojson"
import type { WorldState } from "@/types"
import { displayRadius } from "@/lib/fireTool"
import { cellCenter, gridInfo } from "@/map3d/frame"

/** Départ en attente. Positions en [lat, lon]. */
export type PendingFire =
  | { id: number; kind: "point"; lat: number; lon: number; radius: number }
  | { id: number; kind: "line"; points: [number, number][] }

const M_PER_DEG = 111_320

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dn = (lat2 - lat1) * M_PER_DEG
  const de = (lon2 - lon1) * M_PER_DEG * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot(dn, de)
}

export function lineLengthM(pts: [number, number][]) {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += distanceM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
  return d
}

/** Point d'ancrage du marqueur (départ ponctuel, ou premier point de la ligne). */
export const anchorOf = (p: PendingFire): [number, number] => (p.kind === "point" ? [p.lat, p.lon] : p.points[0])

/** Translate un départ en attente pour que son ancre arrive en (lat, lon). */
export function movePending(p: PendingFire, lat: number, lon: number): PendingFire {
  if (p.kind === "point") return { ...p, lat, lon }
  const [lat0, lon0] = p.points[0]
  return { ...p, points: p.points.map(([a, b]) => [a + lat - lat0, b + lon - lon0]) }
}

function circle(lat: number, lon: number, radiusM: number, n = 48): [number, number][] {
  const out: [number, number][] = []
  const k = Math.cos((lat * Math.PI) / 180)
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI
    out.push([lon + (radiusM * Math.sin(a)) / (M_PER_DEG * k), lat + (radiusM * Math.cos(a)) / M_PER_DEG])
  }
  return out
}

/** Cercle d'allumage ou ligne de feu (et tracé en cours) pour la source GeoJSON. */
export function ignitionGeoJSON(pending: PendingFire | null, draft: [number, number][] | null): FeatureCollection {
  const features: FeatureCollection["features"] = []
  if (pending?.kind === "point") {
    features.push({ type: "Feature", properties: { part: "area" }, geometry: { type: "Polygon", coordinates: [circle(pending.lat, pending.lon, displayRadius(pending.radius))] } })
  } else if (pending?.kind === "line") {
    features.push({ type: "Feature", properties: { part: "line" }, geometry: { type: "LineString", coordinates: pending.points.map(([la, lo]) => [lo, la]) } })
  }
  if (draft && draft.length > 1) {
    features.push({ type: "Feature", properties: { part: "draft" }, geometry: { type: "LineString", coordinates: draft.map(([la, lo]) => [lo, la]) } })
  }
  return { type: "FeatureCollection", features }
}

/** Simplifie un tracé à main levée : un point tous les ~40 m au plus. */
export function simplifyLine(pts: [number, number][], stepM = 40): [number, number][] {
  if (pts.length < 3) return pts
  const out: [number, number][] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1]
    if (distanceM(last[0], last[1], pts[i][0], pts[i][1]) >= stepM) out.push(pts[i])
  }
  out.push(pts[pts.length - 1])
  return out
}

/** Position et dimensions du menu contextuel (relatives au conteneur de la carte). */
export interface MapMenuState { x: number; y: number; w: number; h: number; lat: number; lon: number; onFire: boolean }

/**
 * Une cellule en feu du monde simulé est-elle à moins de `maxM` du point ?
 * Sert uniquement à proposer les actions « Canadair » / « Éteindre » (outil du monde,
 * jamais la détection).
 */
export function fireNear(world: WorldState | null, lat: number, lon: number, maxM = 250): boolean {
  const g = gridInfo(world)
  if (!g || !world?.burning?.length) return false
  for (const [r, c] of world.burning) {
    const [clon, clat] = cellCenter(g, r, c)
    if (distanceM(lat, lon, clat, clon) <= maxM) return true
  }
  return false
}

/**
 * Même question, à l'écran : en vue 3D inclinée, les flammes s'élèvent au-dessus de leur
 * cellule et un clic « sur le feu » touche le relief derrière. Une cellule compte si sa
 * base projetée est à moins de 48 px du clic, ou si le clic tombe dans la colonne de
 * flammes au-dessus d'elle (jusqu'à 140 px plus haut).
 */
export function fireNearScreen(
  map: { project(ll: [number, number]): { x: number; y: number } },
  world: WorldState | null, x: number, y: number,
): boolean {
  const g = gridInfo(world)
  if (!g || !world?.burning?.length) return false
  for (const [r, c] of world.burning) {
    const p = map.project(cellCenter(g, r, c))
    const dx = Math.abs(p.x - x)
    if (Math.hypot(dx, p.y - y) <= 48) return true
    if (dx <= 36 && y <= p.y && p.y - y <= 140) return true
  }
  return false
}
