/**
 * Flammes, braises et lumière du front de feu (vérité terrain).
 * Émetteurs = cellules en feu du monde (world.burning, intensité 0-100) :
 * hauteur et densité des flammes suivent l'intensité, inclinaison selon le vent.
 */
import * as THREE from "three"
import type { WorldState } from "@/types"
import { cellCenter, type GridInfo, type LocalFrame } from "../frame"
import type { FxFrame, FxSystem } from "../fxTypes"
import { ParticleBuffer, SPRITE_SIZE_GLSL, rand } from "../particles"

const FLAME_VERT = /* glsl */ `
attribute float aSize;
attribute float aAge;
attribute float aHeat;
attribute float aSeed;
varying float vAge;
varying float vHeat;
varying float vSeed;
${SPRITE_SIZE_GLSL}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float grow = sin(3.14159 * clamp(aAge * 1.05, 0.0, 1.0));
  float flick = 0.86 + 0.14 * sin(uTime * 23.0 + aSeed * 40.0);
  gl_PointSize = spritePx(aSize * (0.45 + 0.75 * grow) * flick, gl_Position.w);
  vAge = aAge; vHeat = aHeat; vSeed = aSeed;
}
`

// Rampe : jaune → orange #FF5A1F → rouge #E0260E → braise sombre
const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlicker;
varying float vAge;
varying float vHeat;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float core = pow(1.0 - d, 1.7);
  vec3 Y = vec3(1.0, 0.84, 0.40);
  vec3 O = vec3(1.0, 0.353, 0.122);
  vec3 R = vec3(0.878, 0.149, 0.055);
  vec3 E = vec3(0.22, 0.05, 0.02);
  vec3 col = vAge < 0.22 ? mix(Y, O, vAge / 0.22)
           : vAge < 0.62 ? mix(O, R, (vAge - 0.22) / 0.40)
           : mix(R, E, (vAge - 0.62) / 0.38);
  col = mix(col, vec3(1.0, 0.96, 0.82), core * core * 0.45 * (1.0 - vAge) * vHeat);
  float fade = smoothstep(0.0, 0.08, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
  float flick = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 31.0 + vSeed * 57.0));
  float a = core * fade * (0.5 + 0.5 * vHeat) * flick;
  gl_FragColor = vec4(col, a);
}
`

const EMBER_VERT = /* glsl */ `
attribute float aSize;
attribute float aAge;
attribute float aSeed;
varying float vAge;
varying float vSeed;
${SPRITE_SIZE_GLSL}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = spritePx(aSize, gl_Position.w);
  vAge = aAge; vSeed = aSeed;
}
`

const EMBER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlicker;
varying float vAge;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 2.2);
  float tw = 1.0 - uFlicker * 0.6 * (0.5 + 0.5 * sin(uTime * 19.0 + vSeed * 91.0));
  vec3 col = mix(vec3(1.0, 0.78, 0.35), vec3(1.0, 0.353, 0.122), vAge);
  float a = glow * tw * (1.0 - smoothstep(0.7, 1.0, vAge)) * smoothstep(0.0, 0.05, vAge);
  gl_FragColor = vec4(col, a);
}
`

function additive(vert: string, frag: string) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uPxPerMeterW: { value: 1 }, uMinPx: { value: 2.5 }, uMaxPx: { value: 110 },
      uTime: { value: 0 }, uFlicker: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  })
}

export class FireSystem implements FxSystem {
  readonly object = new THREE.Group()
  private flames: ParticleBuffer
  private embers: ParticleBuffer
  private light = new THREE.PointLight(0xff5a1f, 0, 3200, 0)

  // Émetteurs (cellules en feu)
  private ex = new Float32Array(0)
  private ey = new Float32Array(0)
  private ei = new Float32Array(0)
  private cw = new Float32Array(0)
  private nEmit = 0
  private centroid: [number, number] = [0, 0]

  // État des flammes
  private fCount = 0
  private fVx: Float32Array; private fVy: Float32Array; private fVz: Float32Array
  private fLife: Float32Array; private fT: Float32Array; private fSize0: Float32Array
  private fAcc = 0
  // État des braises
  private bCount = 0
  private bVx: Float32Array; private bVy: Float32Array; private bVz: Float32Array
  private bLife: Float32Array; private bT: Float32Array
  private bAcc = 0

  constructor(flameCap: number, emberCap: number) {
    this.flames = new ParticleBuffer(flameCap, { aSize: 1, aAge: 1, aHeat: 1, aSeed: 1 }, additive(FLAME_VERT, FLAME_FRAG))
    this.embers = new ParticleBuffer(emberCap, { aSize: 1, aAge: 1, aSeed: 1 }, additive(EMBER_VERT, EMBER_FRAG))
    this.flames.points.renderOrder = 5
    this.embers.points.renderOrder = 6
    this.fVx = new Float32Array(flameCap); this.fVy = new Float32Array(flameCap); this.fVz = new Float32Array(flameCap)
    this.fLife = new Float32Array(flameCap); this.fT = new Float32Array(flameCap); this.fSize0 = new Float32Array(flameCap)
    this.bVx = new Float32Array(emberCap); this.bVy = new Float32Array(emberCap); this.bVz = new Float32Array(emberCap)
    this.bLife = new Float32Array(emberCap); this.bT = new Float32Array(emberCap)
    this.object.add(this.flames.points, this.embers.points, this.light)
  }

  setWorld(world: WorldState | null, f: { frame: LocalFrame; grid: GridInfo | null }) {
    const burning = world?.burning ?? []
    const g = f.grid
    if (!g || !burning.length) { this.nEmit = 0; return }
    const n = burning.length
    if (this.ex.length < n) {
      const cap = Math.ceil(n * 1.5)
      this.ex = new Float32Array(cap); this.ey = new Float32Array(cap)
      this.ei = new Float32Array(cap); this.cw = new Float32Array(cap)
    }
    const p: [number, number] = [0, 0]
    let acc = 0, sx = 0, sy = 0
    for (let k = 0; k < n; k++) {
      const [r, c, i] = burning[k]
      const [lon, lat] = cellCenter(g, r, c)
      f.frame.toLocal(lon, lat, p)
      const w = Math.max(0.05, i / 100)
      this.ex[k] = p[0]; this.ey[k] = p[1]; this.ei[k] = w
      acc += w
      this.cw[k] = acc
      sx += p[0] * w; sy += p[1] * w
    }
    this.nEmit = n
    this.centroid = [sx / acc, sy / acc]
  }

  private pickEmitter(): number {
    const total = this.cw[this.nEmit - 1]
    const r = Math.random() * total
    let lo = 0, hi = this.nEmit - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.cw[mid] < r) lo = mid + 1; else hi = mid
    }
    return lo
  }

  update(f: FxFrame) {
    const active = f.truth && this.nEmit > 0
    const dt = f.dt
    const vis = f.vis
    const motion = f.reduced ? 0.35 : 1
    const [wx, wy] = f.windTo
    const ws = f.windSpeed
    const half = (f.grid?.cell ?? 50) * 0.48

    // ---------------------------------------------------------- flammes
    const fp = this.flames.pos
    const fa = this.flames.attr
    if (active) {
      const target = Math.min(this.flames.capacity, this.nEmit * 12 + 24)
      this.fAcc += (target / 0.8) * dt
      while (this.fAcc >= 1 && this.fCount < this.flames.capacity) {
        this.fAcc -= 1
        const e = this.pickEmitter()
        const i = this.fCount++
        const heat = this.ei[e]
        const x = this.ex[e] + rand(-half, half)
        const y = this.ey[e] + rand(-half, half)
        fp[i * 3] = x; fp[i * 3 + 1] = y; fp[i * 3 + 2] = f.elev.at(x, y) + 8 * vis
        const lean = ws * 6.5 * vis
        this.fVx[i] = wx * lean + rand(-8, 8) * vis
        this.fVy[i] = wy * lean + rand(-8, 8) * vis
        this.fVz[i] = (110 + 150 * heat) * vis * rand(0.75, 1.15)
        this.fLife[i] = rand(0.55, 1.0) * (0.75 + 0.5 * heat)
        this.fT[i] = 0
        this.fSize0[i] = (36 + 48 * heat) * vis * rand(0.8, 1.2)
        fa.aHeat[i] = heat
        fa.aSeed[i] = Math.random()
      }
      if (this.fAcc > 1) this.fAcc = 0
    }
    for (let i = 0; i < this.fCount; i++) {
      this.fT[i] += dt * motion
      if (this.fT[i] >= this.fLife[i] || !f.truth) {
        // suppression par échange avec la dernière particule
        const j = --this.fCount
        fp[i * 3] = fp[j * 3]; fp[i * 3 + 1] = fp[j * 3 + 1]; fp[i * 3 + 2] = fp[j * 3 + 2]
        this.fVx[i] = this.fVx[j]; this.fVy[i] = this.fVy[j]; this.fVz[i] = this.fVz[j]
        this.fLife[i] = this.fLife[j]; this.fT[i] = this.fT[j]; this.fSize0[i] = this.fSize0[j]
        fa.aHeat[i] = fa.aHeat[j]; fa.aSeed[i] = fa.aSeed[j]
        i--
        continue
      }
      const s = dt * motion
      fp[i * 3] += this.fVx[i] * s
      fp[i * 3 + 1] += this.fVy[i] * s
      fp[i * 3 + 2] += this.fVz[i] * s
      this.fVz[i] *= 1 - 0.6 * s
      fa.aAge[i] = this.fT[i] / this.fLife[i]
      fa.aSize[i] = this.fSize0[i]
    }
    this.flames.commit(this.fCount)

    // ---------------------------------------------------------- braises
    const bp = this.embers.pos
    const ba = this.embers.attr
    if (active) {
      const target = Math.min(this.embers.capacity, this.nEmit * 2 + 16)
      this.bAcc += (target / 2.6) * dt
      while (this.bAcc >= 1 && this.bCount < this.embers.capacity) {
        this.bAcc -= 1
        const e = this.pickEmitter()
        const i = this.bCount++
        const x = this.ex[e] + rand(-half, half)
        const y = this.ey[e] + rand(-half, half)
        bp[i * 3] = x; bp[i * 3 + 1] = y; bp[i * 3 + 2] = f.elev.at(x, y) + 30 * vis
        const drift = ws * rand(10, 22) * vis
        this.bVx[i] = wx * drift + rand(-25, 25) * vis
        this.bVy[i] = wy * drift + rand(-25, 25) * vis
        this.bVz[i] = rand(110, 260) * vis * (0.6 + 0.6 * this.ei[e])
        this.bLife[i] = rand(1.4, 3.6)
        this.bT[i] = 0
        ba.aSize[i] = rand(6, 11) * vis
        ba.aSeed[i] = Math.random()
      }
      if (this.bAcc > 1) this.bAcc = 0
    }
    for (let i = 0; i < this.bCount; i++) {
      this.bT[i] += dt * motion
      if (this.bT[i] >= this.bLife[i] || !f.truth) {
        const j = --this.bCount
        bp[i * 3] = bp[j * 3]; bp[i * 3 + 1] = bp[j * 3 + 1]; bp[i * 3 + 2] = bp[j * 3 + 2]
        this.bVx[i] = this.bVx[j]; this.bVy[i] = this.bVy[j]; this.bVz[i] = this.bVz[j]
        this.bLife[i] = this.bLife[j]; this.bT[i] = this.bT[j]
        ba.aSize[i] = ba.aSize[j]; ba.aSeed[i] = ba.aSeed[j]
        i--
        continue
      }
      const s = dt * motion
      // tourbillon léger + gravité : les braises montent, dérivent puis retombent
      const swirl = Math.sin(f.t * 3 + ba.aSeed[i] * 30) * 18 * vis
      bp[i * 3] += (this.bVx[i] + swirl * -wy) * s
      bp[i * 3 + 1] += (this.bVy[i] + swirl * wx) * s
      bp[i * 3 + 2] += this.bVz[i] * s
      this.bVz[i] -= 70 * vis * s
      ba.aAge[i] = this.bT[i] / this.bLife[i]
    }
    this.embers.commit(this.bCount)

    // ---------------------------------------------------------- uniformes + lumière
    for (const m of [this.flames.points.material, this.embers.points.material] as THREE.ShaderMaterial[]) {
      m.uniforms.uTime.value = f.t
      m.uniforms.uPxPerMeterW.value = f.pxPerMeterW
      m.uniforms.uFlicker.value = f.reduced ? 0.15 : 1
    }
    if (active) {
      const [cx, cy] = this.centroid
      const flick = f.reduced ? 1 : 0.82 + 0.1 * Math.sin(f.t * 13.1) + 0.08 * Math.sin(f.t * 29.7)
      this.light.position.set(cx, cy, f.elev.at(cx, cy) + 220 * vis)
      this.light.intensity = (1.2 + 2.6 * Math.min(1, this.nEmit / 60)) * flick
      this.light.distance = 1800 + 2400 * Math.min(1, this.nEmit / 200)
    } else {
      this.light.intensity = 0
    }
  }

  dispose() {
    this.flames.dispose()
    this.embers.dispose()
    this.light.dispose()
  }
}
