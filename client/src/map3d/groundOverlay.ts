/**
 * Sol de la vérité terrain, drapé sur le relief par MapLibre (source canvas) :
 * cellules calcinées (sol carbonisé), cellules en feu (braises), cellules mouillées
 * par le Canadair, et halo orange qui « éclaire » le relief autour du front.
 *
 * Une PointLight three.js n'éclaire que les modèles 3D de la scène three.js :
 * le relief est rendu par MapLibre, d'où ce halo drapé.
 */
import type { Map as MapLibreMap, CanvasSource } from "maplibre-gl"
import type { WorldState } from "@/types"
import { gridCorners, gridInfo, type GridInfo } from "./frame"

export const GROUND_SOURCE = "fw-ground"
export const GROUND_LAYER = "fw-ground-layer"
const PX = 4   // pixels par cellule

/** Bruit déterministe par pixel (texture du sol brûlé, stable d'une image à l'autre). */
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

export class GroundOverlay {
  private canvas = document.createElement("canvas")
  private cells = document.createElement("canvas")
  private grid: GridInfo | null = null
  private lastKey = ""
  private map: MapLibreMap | null = null
  private visible = true
  private pauseTimer = 0

  /** (Ré)installe la source et la couche ; idempotent (changement de fond de carte). */
  attach(map: MapLibreMap, beforeId?: string) {
    this.map = map
    if (!this.grid) return
    if (!map.getSource(GROUND_SOURCE)) {
      map.addSource(GROUND_SOURCE, {
        type: "canvas",
        canvas: this.canvas,
        coordinates: gridCorners(this.grid),
        animate: false,
      })
    }
    if (!map.getLayer(GROUND_LAYER)) {
      map.addLayer({
        id: GROUND_LAYER,
        type: "raster",
        source: GROUND_SOURCE,
        paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" },
        layout: { visibility: this.visible ? "visible" : "none" },
      }, beforeId && map.getLayer(beforeId) ? beforeId : undefined)
    }
    this.refreshTexture()
  }

  setVisible(v: boolean) {
    this.visible = v
    const map = this.map
    if (map?.getLayer(GROUND_LAYER)) map.setLayoutProperty(GROUND_LAYER, "visibility", v ? "visible" : "none")
  }

  update(world: WorldState | null) {
    const g = gridInfo(world)
    const cellsStr = world?.grid?.cells
    if (!g || !cellsStr || cellsStr.length < g.rows * g.cols) return
    const key = cellsStr.length + ":" + hashString(cellsStr) + ":" + (world?.burning?.length ?? 0)
    const firstGrid = !this.grid
    this.grid = g
    if (firstGrid && this.map) this.attach(this.map)
    if (key === this.lastKey) return
    this.lastKey = key
    this.draw(g, cellsStr, world?.burning ?? [])
    this.refreshTexture()
  }

  private draw(g: GridInfo, cells: string, burning: [number, number, number][]) {
    const W = g.cols * PX, H = g.rows * PX
    if (this.canvas.width !== W) { this.canvas.width = W; this.canvas.height = H }
    if (this.cells.width !== W) { this.cells.width = W; this.cells.height = H }

    // 1. États des cellules (pixel par pixel)
    const cctx = this.cells.getContext("2d")!
    const img = cctx.createImageData(W, H)
    const d = img.data
    const heat = new Map<number, number>()
    for (const [r, c, i] of burning) heat.set(r * g.cols + c, i / 100)
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const s = cells.charCodeAt(r * g.cols + c)
        if (s !== 88 && s !== 66 && s !== 87) continue   // X, B, W
        for (let py = 0; py < PX; py++) {
          for (let px = 0; px < PX; px++) {
            const x = c * PX + px, y = r * PX + py
            const n = hash(x, y)
            const o = (y * W + x) * 4
            if (s === 88) {            // calciné : sol carbonisé, grain de cendre
              const v = 10 + n * 16
              d[o] = v + 4; d[o + 1] = v; d[o + 2] = v - 2; d[o + 3] = 214 + n * 30
            } else if (s === 66) {     // en feu : braises (#6B2510 → #FF5A1F selon l'intensité)
              const k = Math.min(1, (heat.get(r * g.cols + c) ?? 0.6) * (0.75 + 0.5 * n))
              d[o] = 107 + (255 - 107) * k; d[o + 1] = 37 + (90 - 37) * k; d[o + 2] = 16 + (31 - 16) * k
              d[o + 3] = 150 + 70 * k
            } else {                   // mouillé : sol sombre et luisant
              d[o] = 28; d[o + 1] = 31; d[o + 2] = 33; d[o + 3] = 120 + n * 40
            }
          }
        }
      }
    }
    cctx.putImageData(img, 0, 0)

    // 2. Halo du front (relief éclairé), puis états des cellules par-dessus
    const ctx = this.canvas.getContext("2d")!
    ctx.clearRect(0, 0, W, H)
    if (burning.length) {
      ctx.globalCompositeOperation = "lighter"
      const step = Math.max(1, Math.floor(burning.length / 400))
      const radius = 6 * PX
      for (let k = 0; k < burning.length; k += step) {
        const [r, c, i] = burning[k]
        const x = (c + 0.5) * PX, y = (r + 0.5) * PX
        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
        const a = 0.025 + 0.07 * (i / 100) * Math.min(3, step)
        grad.addColorStop(0, `rgba(255, 90, 31, ${a.toFixed(3)})`)
        grad.addColorStop(0.5, `rgba(224, 38, 14, ${(a * 0.45).toFixed(3)})`)
        grad.addColorStop(1, "rgba(107, 37, 16, 0)")
        ctx.fillStyle = grad
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
      }
      ctx.globalCompositeOperation = "source-over"
    }
    ctx.drawImage(this.cells, 0, 0)
  }

  /** La source canvas n'est relue que pendant la lecture : on joue deux images. */
  private refreshTexture() {
    const src = this.map?.getSource(GROUND_SOURCE) as CanvasSource | undefined
    if (!src) return
    src.play()
    window.clearTimeout(this.pauseTimer)
    this.pauseTimer = window.setTimeout(() => {
      const s = this.map?.getSource(GROUND_SOURCE) as CanvasSource | undefined
      s?.pause()
    }, 120)
  }

  detach() {
    window.clearTimeout(this.pauseTimer)
    this.map = null
  }
}

function hashString(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
