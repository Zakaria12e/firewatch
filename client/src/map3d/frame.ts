/**
 * Repère local de la scène 3D : mètres autour du centre de la forêt.
 * x = est, y = nord, z = altitude (m, exagération du relief incluse).
 *
 * L'origine est un MercatorCoordinate : la matrice de MapLibre (mercator 0..1)
 * est multipliée par translate(origine) · scale(s, −s, s) où s = mètres → mercator.
 * Les sommets restent ainsi de petits nombres (précision float32 à zoom élevé).
 */
import { MercatorCoordinate } from "maplibre-gl"
import type { WorldState } from "@/types"

export const CENTER = { lat: 35.135, lon: -5.215 }
const M_PER_DEG = 111_320

export class LocalFrame {
  readonly origin: MercatorCoordinate
  /** unités mercator par mètre à l'origine */
  readonly scale: number

  constructor(lat = CENTER.lat, lon = CENTER.lon) {
    this.origin = MercatorCoordinate.fromLngLat([lon, lat], 0)
    this.scale = this.origin.meterInMercatorCoordinateUnits()
  }

  /** lon/lat → (x est, y nord) en mètres */
  toLocal(lon: number, lat: number, out: [number, number] = [0, 0]): [number, number] {
    const m = MercatorCoordinate.fromLngLat([lon, lat], 0)
    out[0] = (m.x - this.origin.x) / this.scale
    out[1] = -(m.y - this.origin.y) / this.scale
    return out
  }

  /** (x, y) en mètres → [lon, lat] */
  toLngLat(x: number, y: number): [number, number] {
    const m = new MercatorCoordinate(this.origin.x + x * this.scale, this.origin.y - y * this.scale, 0)
    const ll = m.toLngLat()
    return [ll.lng, ll.lat]
  }
}

/**
 * Géométrie de la grille de l'automate cellulaire (identique au simulateur :
 * origine = coin nord-ouest, pas en longitude calculé avec cos(latitude du centre)).
 */
export interface GridInfo {
  originLat: number
  originLon: number
  cell: number
  rows: number
  cols: number
  latPerCell: number
  lonPerCell: number
}

export function gridInfo(world: WorldState | null): GridInfo | null {
  const g = world?.grid
  if (!g || !g.rows || !g.cols) return null
  const cell = g.cell || 50
  const latPerCell = cell / M_PER_DEG
  const lonPerCell = cell / (M_PER_DEG * Math.cos((CENTER.lat * Math.PI) / 180))
  // Anciennes versions du simulateur : origin = {lat: rows, lon: cols} → recalcul
  const o = g.origin
  const valid = o && Math.abs(o.lat - CENTER.lat) < 0.5 && Math.abs(o.lon - CENTER.lon) < 0.5
  return {
    originLat: valid ? o!.lat : CENTER.lat + (g.rows / 2) * latPerCell,
    originLon: valid ? o!.lon : CENTER.lon - (g.cols / 2) * lonPerCell,
    cell, rows: g.rows, cols: g.cols, latPerCell, lonPerCell,
  }
}

/** Centre d'une cellule → [lon, lat] */
export function cellCenter(g: GridInfo, r: number, c: number): [number, number] {
  return [g.originLon + (c + 0.5) * g.lonPerCell, g.originLat - (r + 0.5) * g.latPerCell]
}

/** Coins de la grille pour une source image MapLibre : [NO, NE, SE, SO] en [lon, lat] */
export function gridCorners(g: GridInfo): [[number, number], [number, number], [number, number], [number, number]] {
  const west = g.originLon
  const east = g.originLon + g.cols * g.lonPerCell
  const north = g.originLat
  const south = g.originLat - g.rows * g.latPerCell
  return [[west, north], [east, north], [east, south], [west, south]]
}

/** Vecteur unitaire (est, nord) vers lequel souffle un vent venant de `fromDeg`. */
export function windTo(fromDeg: number): [number, number] {
  const a = (fromDeg * Math.PI) / 180
  return [-Math.sin(a), -Math.cos(a)]
}
