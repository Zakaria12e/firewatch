/**
 * Cache d'altitude du relief rendu par MapLibre.
 *
 * map.queryTerrainElevation renvoie l'altitude (m) × exagération, mais ne marche que
 * pour les tuiles chargées et coûte trop cher pour des milliers de particules par image.
 * On échantillonne donc une grille régulière autour de la forêt (par tranches, sur
 * plusieurs images, au plus une passe toutes les MIN_PASS_MS), puis on interpole en
 * bilinéaire. En 2D (terrain désactivé), l'altitude vaut 0 : la carte est plate.
 */
import type { Map as MapLibreMap } from "maplibre-gl"
import type { LocalFrame } from "./frame"

const CHUNK = 700          // échantillons par image lors d'une passe
const MIN_PASS_MS = 2500   // délai minimal entre deux passes (tuiles qui arrivent)

export class ElevationGrid {
  readonly x0: number
  readonly y0: number
  readonly res: number
  readonly nx: number
  readonly ny: number
  private data: Float32Array
  private known: Uint8Array
  private lon: Float64Array
  private lat: Float64Array
  private cursor = -1          // -1 : pas de passe en cours
  private pending = false      // une nouvelle passe est demandée
  private lastPass = -Infinity
  private terrainOn: boolean | null = null
  /** incrémenté à chaque passe terminée (les systèmes recalent leurs objets) */
  version = 0

  constructor(frame: LocalFrame, halfWidth: number, halfHeight: number, res: number) {
    this.res = res
    this.x0 = -halfWidth
    this.y0 = -halfHeight
    this.nx = Math.ceil((2 * halfWidth) / res) + 1
    this.ny = Math.ceil((2 * halfHeight) / res) + 1
    const n = this.nx * this.ny
    this.data = new Float32Array(n)
    this.known = new Uint8Array(n)
    this.lon = new Float64Array(n)
    this.lat = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const [lo, la] = frame.toLngLat(this.x0 + (i % this.nx) * res, this.y0 + ((i / this.nx) | 0) * res)
      this.lon[i] = lo
      this.lat[i] = la
    }
  }

  /** Demande un nouvel échantillonnage (tuiles chargées, exagération, 2D/3D). */
  invalidate() {
    this.pending = true
  }

  /** Avance l'échantillonnage d'une tranche ; à appeler à chaque image. */
  step(map: MapLibreMap) {
    const terrainOn = !!map.getTerrain()
    if (terrainOn !== this.terrainOn) {
      // bascule 2D/3D : passe immédiate
      this.terrainOn = terrainOn
      this.pending = true
      this.lastPass = -Infinity
    }
    const now = performance.now()
    if (this.cursor < 0) {
      if (!this.pending || now - this.lastPass < MIN_PASS_MS) return
      this.pending = false
      this.lastPass = now
      this.cursor = 0
    }
    const total = this.nx * this.ny
    if (!terrainOn) {
      this.data.fill(0)
      this.known.fill(1)
      this.cursor = -1
      this.version++
      return
    }
    const end = Math.min(total, this.cursor + CHUNK)
    const ll: [number, number] = [0, 0]
    for (let i = this.cursor; i < end; i++) {
      ll[0] = this.lon[i]; ll[1] = this.lat[i]
      let h: number | null = null
      try { h = map.queryTerrainElevation(ll) } catch { h = null }
      // 0 = tuile pas encore chargée (la zone est entre 400 et 2000 m d'altitude)
      if (h !== null && Number.isFinite(h) && h > 1) {
        this.data[i] = h
        this.known[i] = 1
      }
    }
    this.cursor = end
    if (end >= total) {
      this.fillUnknown()
      this.cursor = -1
      this.version++
    }
  }

  /** Les échantillons inconnus prennent la valeur du voisin connu le plus proche (ligne). */
  private fillUnknown() {
    for (let iy = 0; iy < this.ny; iy++) {
      let last = -1
      for (let ix = 0; ix < this.nx; ix++) {
        const i = iy * this.nx + ix
        if (this.known[i]) last = this.data[i]
        else if (last >= 0) this.data[i] = last
      }
      last = -1
      for (let ix = this.nx - 1; ix >= 0; ix--) {
        const i = iy * this.nx + ix
        if (this.known[i]) last = this.data[i]
        else if (last >= 0 && this.data[i] === 0) this.data[i] = last
      }
    }
  }

  /** Altitude interpolée (m, exagération incluse) au point local (x, y). */
  at(x: number, y: number): number {
    let fx = (x - this.x0) / this.res
    let fy = (y - this.y0) / this.res
    if (fx < 0) fx = 0; else if (fx > this.nx - 1.001) fx = this.nx - 1.001
    if (fy < 0) fy = 0; else if (fy > this.ny - 1.001) fy = this.ny - 1.001
    const ix = fx | 0
    const iy = fy | 0
    const tx = fx - ix
    const ty = fy - iy
    const i = iy * this.nx + ix
    const d = this.data
    const a = d[i] + (d[i + 1] - d[i]) * tx
    const b = d[i + this.nx] + (d[i + this.nx + 1] - d[i + this.nx]) * tx
    return a + (b - a) * ty
  }
}
