/**
 * Panache de fumée (vérité terrain) : sprites en mélange normal qui montent,
 * puis se couchent dans la direction du vent, s'élargissent et s'assombrissent
 * en s'éloignant. Densité selon le nombre de cellules en feu.
 */
import * as THREE from "three"
import type { WorldState } from "@/types"
import { cellCenter, type GridInfo, type LocalFrame } from "../frame"
import type { FxFrame, FxSystem } from "../fxTypes"
import { NOISE_GLSL, ParticleBuffer, SPRITE_SIZE_GLSL, rand } from "../particles"

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aShade;
attribute float aSeed;
varying float vAlpha;
varying float vShade;
varying float vSeed;
${SPRITE_SIZE_GLSL}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = spritePx(aSize, gl_Position.w);
  vAlpha = aAlpha; vShade = aShade; vSeed = aSeed;
}
`

const FRAG = /* glsl */ `
uniform float uTime;
varying float vAlpha;
varying float vShade;
varying float vSeed;
${NOISE_GLSL}
void main() {
  vec2 uv = gl_PointCoord;
  float a0 = vSeed * 6.2831;
  mat2 rot = mat2(cos(a0), -sin(a0), sin(a0), cos(a0));
  vec2 c = rot * (uv * 2.0 - 1.0);
  float d = length(c);
  if (d > 1.0) discard;
  vec2 q = c * 1.6 + vec2(vSeed * 13.0, uTime * 0.05 + vSeed * 7.0);
  float n = vnoise(q * 1.7) * 0.6 + vnoise(q * 4.3) * 0.4;
  float a = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.45) * vAlpha;
  vec3 light = vec3(0.56, 0.53, 0.50);
  vec3 dark = vec3(0.13, 0.12, 0.115);
  vec3 col = mix(light, dark, vShade) * (0.82 + 0.36 * n);
  gl_FragColor = vec4(col, a);
}
`

export class SmokeSystem implements FxSystem {
  readonly object = new THREE.Group()
  private buf: ParticleBuffer
  private ex = new Float32Array(0)
  private ey = new Float32Array(0)
  private nEmit = 0
  private count = 0
  private acc = 0
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array
  private life: Float32Array; private t: Float32Array; private size0: Float32Array
  private alphaMax = 0.25

  constructor(cap: number) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uPxPerMeterW: { value: 1 }, uMinPx: { value: 3 }, uMaxPx: { value: 300 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    })
    this.buf = new ParticleBuffer(cap, { aSize: 1, aAlpha: 1, aShade: 1, aSeed: 1 }, mat)
    this.buf.points.renderOrder = 8
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.vz = new Float32Array(cap)
    this.life = new Float32Array(cap); this.t = new Float32Array(cap); this.size0 = new Float32Array(cap)
    this.object.add(this.buf.points)
  }

  setWorld(world: WorldState | null, f: { frame: LocalFrame; grid: GridInfo | null }) {
    const burning = world?.burning ?? []
    const g = f.grid
    if (!g || !burning.length) { this.nEmit = 0; return }
    const n = burning.length
    if (this.ex.length < n) { this.ex = new Float32Array(n * 2); this.ey = new Float32Array(n * 2) }
    const p: [number, number] = [0, 0]
    for (let k = 0; k < n; k++) {
      const [lon, lat] = cellCenter(g, burning[k][0], burning[k][1])
      f.frame.toLocal(lon, lat, p)
      this.ex[k] = p[0]; this.ey[k] = p[1]
    }
    this.nEmit = n
    this.alphaMax = 0.16 + 0.2 * Math.min(1, n / 160)
  }

  update(f: FxFrame) {
    const active = f.truth && this.nEmit > 0
    const dt = f.dt * (f.reduced ? 0.4 : 1)
    const vis = f.vis
    const [wx, wy] = f.windTo
    // Dérive au rythme du monde simulé (1 s réelle = timeScale s simulées)
    const drift = Math.max(0.8, f.windSpeed) * f.timeScale
    const p = this.buf.pos
    const a = this.buf.attr
    const cap = this.buf.capacity

    if (active) {
      const rate = Math.min(cap / 16, 4 + Math.sqrt(this.nEmit) * 7)
      this.acc += rate * f.dt
      while (this.acc >= 1 && this.count < cap) {
        this.acc -= 1
        const e = (Math.random() * this.nEmit) | 0
        const i = this.count++
        const x = this.ex[e] + rand(-25, 25)
        const y = this.ey[e] + rand(-25, 25)
        p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = f.elev.at(x, y) + 70 * vis
        this.vx[i] = rand(-6, 6); this.vy[i] = rand(-6, 6)
        this.vz[i] = rand(70, 120) * vis
        this.life[i] = rand(13, 24)
        this.t[i] = 0
        this.size0[i] = rand(80, 130) * vis
        a.aSeed[i] = Math.random()
      }
      if (this.acc > 1) this.acc = 0
    }

    for (let i = 0; i < this.count; i++) {
      this.t[i] += dt
      if (this.t[i] >= this.life[i] || !f.truth) {
        const j = --this.count
        p[i * 3] = p[j * 3]; p[i * 3 + 1] = p[j * 3 + 1]; p[i * 3 + 2] = p[j * 3 + 2]
        this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j]
        this.life[i] = this.life[j]; this.t[i] = this.t[j]; this.size0[i] = this.size0[j]
        a.aSeed[i] = a.aSeed[j]
        i--
        continue
      }
      const age = this.t[i]
      const k = age / this.life[i]
      // le panache monte (flottabilité qui s'épuise) puis se couche sous le vent
      const bend = 1 - Math.exp(-age / 2.6)
      const turb = Math.sin(age * 0.9 + a.aSeed[i] * 20) * 0.25
      p[i * 3] += (wx * drift * bend + this.vx[i] - wy * drift * turb * 0.3) * dt
      p[i * 3 + 1] += (wy * drift * bend + this.vy[i] + wx * drift * turb * 0.3) * dt
      p[i * 3 + 2] += this.vz[i] * Math.exp(-age / 3.2) * dt + 4 * vis * dt
      a.aSize[i] = this.size0[i] + (40 + drift * 0.25) * age * vis
      a.aAlpha[i] = this.alphaMax * Math.min(1, age / 1.2) * Math.pow(1 - k, 1.4)
      a.aShade[i] = Math.min(1, k * 1.15)
    }
    this.buf.commit(this.count)
    const m = this.buf.points.material as THREE.ShaderMaterial
    m.uniforms.uTime.value = f.t
    m.uniforms.uPxPerMeterW.value = f.pxPerMeterW
  }

  dispose() {
    this.buf.dispose()
  }
}
