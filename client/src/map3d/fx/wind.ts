/**
 * Champ de vent : traînées de particules qui suivent le relief et le vent du monde
 * (vitesse, direction, rafales), au rythme du temps simulé. Opacité légère.
 */
import * as THREE from "three"
import type { FxFrame, FxSystem } from "../fxTypes"
import { rand } from "../particles"

const H = 7               // points d'historique par traînée
const SAMPLE_S = 0.12     // intervalle entre deux points d'historique (s)

const VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vAlpha = aAlpha;
}
`
const FRAG = /* glsl */ `
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(1.0, 0.97, 0.93, vAlpha * uOpacity);
}
`

export class WindSystem implements FxSystem {
  readonly object: THREE.LineSegments
  private geo = new THREE.BufferGeometry()
  private pos: Float32Array
  private alpha: Float32Array
  private cap: number
  private hx: Float32Array      // historique x (cap × H)
  private hy: Float32Array
  private life: Float32Array
  private age: Float32Array
  private hOff: Float32Array
  private jit: Float32Array
  private sampleAcc = 0
  private hMean = 0
  private hRange = 1
  private elevVersion = -1
  private initialized = false

  constructor(cap: number) {
    this.cap = cap
    const verts = cap * (H - 1) * 2
    this.pos = new Float32Array(verts * 3)
    this.alpha = new Float32Array(verts)
    const pa = new THREE.BufferAttribute(this.pos, 3); pa.setUsage(THREE.DynamicDrawUsage)
    const aa = new THREE.BufferAttribute(this.alpha, 1); aa.setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute("position", pa)
    this.geo.setAttribute("aAlpha", aa)
    this.hx = new Float32Array(cap * H); this.hy = new Float32Array(cap * H)
    this.life = new Float32Array(cap); this.age = new Float32Array(cap)
    this.hOff = new Float32Array(cap); this.jit = new Float32Array(cap)
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    })
    this.object = new THREE.LineSegments(this.geo, mat)
    this.object.frustumCulled = false
    this.object.renderOrder = 3
  }

  private respawn(i: number, f: FxFrame, radius: number, randomAge: boolean) {
    const a = Math.random() * Math.PI * 2
    const r = radius * Math.sqrt(Math.random())
    const x = f.center[0] + Math.cos(a) * r
    const y = f.center[1] + Math.sin(a) * r
    for (let k = 0; k < H; k++) { this.hx[i * H + k] = x; this.hy[i * H + k] = y }
    this.life[i] = rand(4, 8)
    this.age[i] = randomAge ? Math.random() * this.life[i] : 0
    this.hOff[i] = rand(30, 70)
    this.jit[i] = rand(0.85, 1.15)
  }

  private terrainStats(f: FxFrame) {
    if (this.elevVersion === f.elev.version) return
    this.elevVersion = f.elev.version
    let s = 0, mn = Infinity, mx = -Infinity
    const n = 400
    for (let k = 0; k < n; k++) {
      const h = f.elev.at(rand(-4000, 4000), rand(-3500, 3500))
      s += h; mn = Math.min(mn, h); mx = Math.max(mx, h)
    }
    this.hMean = s / n
    this.hRange = Math.max(50, (mx - mn) / 2)
  }

  update(f: FxFrame) {
    const n = f.reduced ? Math.floor(this.cap / 2) : this.cap
    const show = f.windSpeed > 0.2
    this.object.visible = show
    if (!show) return
    this.terrainStats(f)
    const radius = Math.min(6500, Math.max(1800, 2700 * f.vis))
    if (!this.initialized) {
      for (let i = 0; i < this.cap; i++) this.respawn(i, f, radius, true)
      this.initialized = true
    }
    const dt = f.dt * (f.reduced ? 0.25 : 1)
    const [wx, wy] = f.windTo
    const baseSpeed = f.windSpeed * f.timeScale
    const gustRatio = Math.max(0, f.gust / Math.max(0.5, f.windSpeed) - 1)
    const t = f.t
    const cx = f.center[0], cy = f.center[1]
    const r2 = radius * radius * 1.1

    this.sampleAcc += dt
    const shift = this.sampleAcc >= SAMPLE_S
    if (shift) this.sampleAcc = 0

    const pos = this.pos, alpha = this.alpha
    const hx = this.hx, hy = this.hy
    let v = 0
    for (let i = 0; i < n; i++) {
      this.age[i] += dt
      const b = i * H
      let x = hx[b], y = hy[b]
      const dx = x - cx, dy = y - cy
      if (this.age[i] > this.life[i] || dx * dx + dy * dy > r2) {
        this.respawn(i, f, radius, false)
        x = hx[b]; y = hy[b]
      }
      // Champ : direction légèrement perturbée, accélération sur les crêtes, rafales
      const h = f.elev.at(x, y)
      const ang = 0.32 * Math.sin(x * 0.0009 + t * 0.11) * Math.cos(y * 0.0011 - t * 0.07)
      const ca = Math.cos(ang), sa = Math.sin(ang)
      const dirX = wx * ca - wy * sa
      const dirY = wx * sa + wy * ca
      const ridge = Math.max(-1, Math.min(1, (h - this.hMean) / this.hRange))
      const g = Math.sin(t * 0.6 + x * 0.0012 + y * 0.0009)
      const gust = 1 + gustRatio * (g > 0 ? g * g * g * g : 0)
      const sp = baseSpeed * (1 + 0.25 * ridge) * gust * this.jit[i]
      x += dirX * sp * dt
      y += dirY * sp * dt
      if (shift) {
        for (let k = H - 1; k > 0; k--) { hx[b + k] = hx[b + k - 1]; hy[b + k] = hy[b + k - 1] }
      }
      hx[b] = x; hy[b] = y

      const life = this.life[i], age = this.age[i]
      const fade = Math.min(1, age / 0.6) * Math.min(1, (life - age) / 0.8)
      const zOff = this.hOff[i] * f.vis
      for (let k = 0; k < H - 1; k++) {
        const ax = hx[b + k], ay = hy[b + k]
        const bx = hx[b + k + 1], by = hy[b + k + 1]
        pos[v * 3] = ax; pos[v * 3 + 1] = ay; pos[v * 3 + 2] = f.elev.at(ax, ay) + zOff
        alpha[v] = 0.42 * fade * (1 - k / (H - 1))
        v++
        pos[v * 3] = bx; pos[v * 3 + 1] = by; pos[v * 3 + 2] = f.elev.at(bx, by) + zOff
        alpha[v] = 0.42 * fade * (1 - (k + 1) / (H - 1))
        v++
      }
    }
    this.geo.setDrawRange(0, v)
    const pa = this.geo.getAttribute("position") as THREE.BufferAttribute
    const aa = this.geo.getAttribute("aAlpha") as THREE.BufferAttribute
    pa.clearUpdateRanges(); pa.addUpdateRange(0, v * 3); pa.needsUpdate = true
    aa.clearUpdateRanges(); aa.addUpdateRange(0, v); aa.needsUpdate = true
    ;(this.object.material as THREE.ShaderMaterial).uniforms.uOpacity.value = (f.reduced ? 0.6 : 1) * Math.min(1, Math.max(0.35, f.vis))
  }

  dispose() {
    this.geo.dispose()
    ;(this.object.material as THREE.Material).dispose()
  }
}
