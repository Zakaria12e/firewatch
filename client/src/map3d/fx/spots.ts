/**
 * Sautes de feu (world.spots) : braises projetées en arc parabolique de la
 * cellule source jusqu'au nouveau foyer, puis éclat à l'allumage.
 */
import * as THREE from "three"
import type { WorldState } from "@/types"
import { cellCenter, type GridInfo, type LocalFrame } from "../frame"
import type { FxFrame, FxSystem } from "../fxTypes"
import { ParticleBuffer, SPRITE_SIZE_GLSL, rand } from "../particles"

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
${SPRITE_SIZE_GLSL}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = spritePx(aSize, gl_Position.w);
  vAlpha = aAlpha;
}
`
const FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float g = pow(1.0 - d, 2.0);
  gl_FragColor = vec4(mix(vec3(1.0, 0.353, 0.122), vec3(1.0, 0.86, 0.55), g), g * vAlpha);
}
`

interface Arc {
  ax: number; ay: number; bx: number; by: number
  start: number          // horloge d'animation
  embers: { delay: number; jx: number; jy: number; jz: number }[]
  apex: number
}

const FLIGHT_S = 1.7
const TRAIL = 5

export class SpotSystem implements FxSystem {
  readonly object = new THREE.Group()
  private buf: ParticleBuffer
  private arcs: Arc[] = []
  private seen = new Set<number>()
  private pending: { from: [number, number]; to: [number, number] }[] = []
  private grid: GridInfo | null = null
  private frame: LocalFrame | null = null

  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uPxPerMeterW: { value: 1 }, uMinPx: { value: 2 }, uMaxPx: { value: 200 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    })
    this.buf = new ParticleBuffer(1600, { aSize: 1, aAlpha: 1 }, mat)
    this.buf.points.renderOrder = 7
    this.object.add(this.buf.points)
  }

  setWorld(world: WorldState | null, f: { frame: LocalFrame; grid: GridInfo | null }) {
    this.grid = f.grid
    this.frame = f.frame
    for (const s of world?.spots ?? []) {
      if (this.seen.has(s.id)) continue
      this.seen.add(s.id)
      this.pending.push({ from: s.from, to: s.to })
    }
  }

  private bezier(arc: Arc, u: number, f: FxFrame, out: [number, number, number]) {
    const x = arc.ax + (arc.bx - arc.ax) * u
    const y = arc.ay + (arc.by - arc.ay) * u
    const za = f.elev.at(arc.ax, arc.ay) + 60 * f.vis
    const zb = f.elev.at(arc.bx, arc.by) + 8
    out[0] = x; out[1] = y
    out[2] = za + (zb - za) * u + 4 * arc.apex * u * (1 - u)
    return out
  }

  update(f: FxFrame) {
    if (this.grid && this.frame && this.pending.length) {
      for (const s of this.pending) {
        const [la, lo] = [cellCenter(this.grid, s.from[0], s.from[1]), cellCenter(this.grid, s.to[0], s.to[1])]
        const a = this.frame.toLocal(la[0], la[1])
        const b = this.frame.toLocal(lo[0], lo[1])
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1])
        this.arcs.push({
          ax: a[0], ay: a[1], bx: b[0], by: b[1], start: f.t,
          apex: (90 + dist * 0.45) * Math.max(0.7, Math.sqrt(f.vis)),
          embers: Array.from({ length: 14 }, () => ({
            delay: rand(0, 0.35), jx: rand(-25, 25), jy: rand(-25, 25), jz: rand(-20, 20),
          })),
        })
      }
      this.pending = []
    }
    const p = this.buf.pos
    const a = this.buf.attr
    let n = 0
    const pt: [number, number, number] = [0, 0, 0]
    for (let k = this.arcs.length - 1; k >= 0; k--) {
      const arc = this.arcs[k]
      const age = f.t - arc.start
      if (age > FLIGHT_S + 1.0 || !f.truth) { this.arcs.splice(k, 1); continue }
      for (const e of arc.embers) {
        for (let tr = 0; tr < TRAIL && n < this.buf.capacity; tr++) {
          const u = (age - e.delay - tr * 0.035) / FLIGHT_S
          if (u < 0 || u > 1) continue
          this.bezier(arc, u, f, pt)
          const w = Math.sin(Math.PI * u)
          p[n * 3] = pt[0] + e.jx * w; p[n * 3 + 1] = pt[1] + e.jy * w; p[n * 3 + 2] = pt[2] + e.jz * w
          a.aSize[n] = (13 - tr * 2) * f.vis
          a.aAlpha[n] = 1 - tr / TRAIL
          n++
        }
      }
      // éclat à l'allumage du nouveau foyer
      const land = age - FLIGHT_S
      if (land > 0 && land < 1.0 && n < this.buf.capacity) {
        p[n * 3] = arc.bx; p[n * 3 + 1] = arc.by; p[n * 3 + 2] = f.elev.at(arc.bx, arc.by) + 20 * f.vis
        a.aSize[n] = (60 + 160 * land) * f.vis
        a.aAlpha[n] = 1 - land
        n++
      }
    }
    this.buf.commit(n)
    ;(this.buf.points.material as THREE.ShaderMaterial).uniforms.uPxPerMeterW.value = f.pxPerMeterW
  }

  dispose() {
    this.buf.dispose()
  }
}
