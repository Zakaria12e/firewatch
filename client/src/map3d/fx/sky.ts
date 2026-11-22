/**
 * Canadair (largages du monde : world.drops) et pluie (world.weather.rain).
 * L'avion arrive face au vent, plonge, largue un rideau d'eau qui touche le sol
 * au moment de l'impact annoncé par le simulateur (impactIn), puis repart.
 */
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { WorldState } from "@/types"
import type { FxFrame, FxSystem } from "../fxTypes"
import { ParticleBuffer, SPRITE_SIZE_GLSL, rand } from "../particles"
import type { LocalFrame } from "../frame"

// ---------------------------------------------------------------------------
// Modèle low-poly du bombardier d'eau (axe avant = +Y, haut = +Z, mètres réels)
// ---------------------------------------------------------------------------
function colored(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  const c = new THREE.Color(hex)
  const n = g.getAttribute("position").count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3))
  g.deleteAttribute("uv")
  return g
}

function buildPlane(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const add = (g: THREE.BufferGeometry, hex: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z)
    parts.push(colored(g, hex))
  }
  const fuselage = new THREE.CylinderGeometry(1.25, 0.9, 18, 8)          // axe Y
  add(fuselage, "#e9e6e0")
  add(new THREE.ConeGeometry(1.25, 2.6, 8), "#e9e6e0", 0, 10.3, 0)       // nez
  add(new THREE.ConeGeometry(0.9, 4, 8), "#e9e6e0", 0, -11, 0.3, Math.PI, 0, 0) // queue
  add(new THREE.BoxGeometry(2.2, 18.5, 0.25), "#E0260E", 0, 0, -0.55)    // bande de coque
  add(new THREE.BoxGeometry(1.6, 1.6, 0.6), "#1c1d20", 0, 8.2, 0.85)     // cockpit
  add(new THREE.BoxGeometry(28.6, 3.2, 0.45), "#dcd8d1", 0, 1.5, 1.5)    // aile haute
  add(new THREE.BoxGeometry(5, 3.25, 0.5), "#FF5A1F", 12, 1.5, 1.5)      // bouts d'aile
  add(new THREE.BoxGeometry(5, 3.25, 0.5), "#FF5A1F", -12, 1.5, 1.5)
  for (const sx of [-4.6, 4.6]) {
    add(new THREE.CylinderGeometry(0.75, 0.6, 5.2, 8), "#474747", sx, 3.2, 1.1) // moteurs
    add(new THREE.BoxGeometry(3.6, 0.08, 0.35), "#2a2a2a", sx, 5.9, 1.1)         // hélices
  }
  for (const sx of [-11.5, 11.5]) {
    add(new THREE.BoxGeometry(0.6, 2.6, 0.6), "#e9e6e0", sx, 1.5, -0.6)  // flotteurs
  }
  add(new THREE.BoxGeometry(0.35, 3.4, 4.8), "#e9e6e0", 0, -11.2, 2.6)   // dérive
  add(new THREE.BoxGeometry(0.4, 1.6, 1.4), "#FF5A1F", 0, -12.1, 4.3)
  add(new THREE.BoxGeometry(9.5, 2, 0.3), "#dcd8d1", 0, -11.8, 5.0)      // empennage en T
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------------------
// Particules d'eau (rideau puis brume au sol) et de pluie
// ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */ `
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
const WATER_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(0.93, 0.95, 0.96, (1.0 - d) * vAlpha);
}
`

interface Flight {
  id: number
  tx: number; ty: number; tz: number   // cible (sol)
  dirX: number; dirY: number           // cap de vol
  impactAt: number                     // horloge d'animation (s)
  speed: number                        // m/s (visuel)
  mesh: THREE.Mesh
  releaseAcc: number
}

const APPROACH_M = 6000
const RELEASE_BEFORE_M = 520
const RELEASE_AFTER_M = 140

export class SkySystem implements FxSystem {
  readonly object = new THREE.Group()
  private planeGeo = buildPlane()
  private planeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  private flights: Flight[] = []
  private seen = new Set<number>()
  private pendingDrops: { id: number; lat: number; lon: number; impactIn: number; receivedAt: number }[] = []
  private clock = 0

  private water: ParticleBuffer
  private wCount = 0
  private wVx: Float32Array; private wVy: Float32Array; private wVz: Float32Array
  private wT: Float32Array; private wMist: Uint8Array

  private rainGeo = new THREE.BufferGeometry()
  private rain: THREE.LineSegments
  private rainPos: Float32Array
  private rainCap: number
  private rx: Float32Array; private ry: Float32Array; private rz: Float32Array
  private rainInit = false

  constructor(waterCap: number, rainCap: number) {
    const wm = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      uniforms: { uPxPerMeterW: { value: 1 }, uMinPx: { value: 1.4 }, uMaxPx: { value: 220 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    })
    this.water = new ParticleBuffer(waterCap, { aSize: 1, aAlpha: 1 }, wm)
    this.water.points.renderOrder = 9
    this.wVx = new Float32Array(waterCap); this.wVy = new Float32Array(waterCap); this.wVz = new Float32Array(waterCap)
    this.wT = new Float32Array(waterCap); this.wMist = new Uint8Array(waterCap)

    this.rainCap = rainCap
    this.rainPos = new Float32Array(rainCap * 6)
    const ra = new THREE.BufferAttribute(this.rainPos, 3); ra.setUsage(THREE.DynamicDrawUsage)
    this.rainGeo.setAttribute("position", ra)
    this.rx = new Float32Array(rainCap); this.ry = new Float32Array(rainCap); this.rz = new Float32Array(rainCap)
    this.rain = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({
      color: 0xd8dde2, transparent: true, opacity: 0.32, depthWrite: false,
    }))
    this.rain.frustumCulled = false
    this.rain.renderOrder = 10
    this.object.add(this.water.points, this.rain)
  }

  /** Nouveaux largages annoncés par le monde → vols programmés. */
  setWorld(world: WorldState | null) {
    for (const d of world?.drops ?? []) {
      if (this.seen.has(d.id) || d.impactIn < -1.5) continue
      this.seen.add(d.id)
      this.pendingDrops.push({ id: d.id, lat: d.lat, lon: d.lon, impactIn: d.impactIn, receivedAt: this.clock })
    }
  }

  private startFlight(d: { id: number; lat: number; lon: number; impactIn: number; receivedAt: number }, f: FxFrame, frame: LocalFrame) {
    const [tx, ty] = frame.toLocal(d.lon, d.lat)
    // Le bombardier largue face au vent : il vole vers d'où vient le vent
    let dirX = -f.windTo[0], dirY = -f.windTo[1]
    if (f.windSpeed < 0.5) { dirX = 0.6; dirY = 0.8 }
    const mesh = new THREE.Mesh(this.planeGeo, this.planeMat)
    mesh.frustumCulled = false
    this.object.add(mesh)
    this.flights.push({
      id: d.id, tx, ty, tz: f.elev.at(tx, ty),
      dirX, dirY, impactAt: d.receivedAt + d.impactIn, speed: 850, mesh, releaseAcc: 0,
    })
  }

  /** Position (x, y, z) et hauteur au-dessus de la cible pour l'abscisse s (m, 0 = cible). */
  private path(fl: Flight, s: number, f: FxFrame, out: THREE.Vector3) {
    const x = fl.tx + fl.dirX * s
    const y = fl.ty + fl.dirY * s
    const low = 110 * Math.max(0.6, Math.sqrt(f.vis))
    let h: number
    if (s < 0) h = low + Math.pow(Math.max(0, -s - 700) / (APPROACH_M - 700), 1.3) * 950
    else h = low + Math.pow(Math.max(0, s - 250) / 3500, 1.2) * 1300
    const ground = Math.max(f.elev.at(x, y), fl.tz)
    out.set(x, y, ground + h)
    return out
  }

  update(f: FxFrame) {
    this.clock = f.t
    const frame = f.frame
    for (const d of this.pendingDrops) this.startFlight(d, f, frame)
    this.pendingDrops = []

    const p = new THREE.Vector3()
    const q = new THREE.Vector3()
    const wp = this.water.pos
    const wa = this.water.attr
    const scale = Math.max(2, 13 * f.vis)

    for (let k = this.flights.length - 1; k >= 0; k--) {
      const fl = this.flights[k]
      const s = (f.t - fl.impactAt) * fl.speed
      if (s > APPROACH_M) {
        this.object.remove(fl.mesh)
        this.flights.splice(k, 1)
        continue
      }
      const sc = Math.max(-APPROACH_M, s)
      this.path(fl, sc, f, p)
      this.path(fl, sc + 40, f, q)
      fl.mesh.position.copy(p)
      fl.mesh.scale.setScalar(scale)
      // orientation : avant (+Y modèle) selon la tangente, tangage selon la pente
      const yaw = Math.atan2(fl.dirX, fl.dirY)
      const pitch = Math.atan2(q.z - p.z, 40)
      fl.mesh.rotation.set(pitch, 0, -yaw, "ZXY")
      fl.mesh.visible = s > -APPROACH_M - 1

      // Rideau d'eau : largage juste avant la cible pour qu'il touche à l'impact
      if (s > -RELEASE_BEFORE_M && s < RELEASE_AFTER_M) {
        fl.releaseAcc += (this.water.capacity / 1.1) * f.dt
        while (fl.releaseAcc >= 1 && this.wCount < this.water.capacity) {
          fl.releaseAcc -= 1
          const i = this.wCount++
          wp[i * 3] = p.x + rand(-6, 6) * scale; wp[i * 3 + 1] = p.y + rand(-6, 6) * scale
          wp[i * 3 + 2] = p.z - 2 * scale
          const fwd = fl.speed * 0.32
          this.wVx[i] = fl.dirX * fwd + rand(-30, 30)
          this.wVy[i] = fl.dirY * fwd + rand(-30, 30)
          this.wVz[i] = rand(-60, -20)
          this.wT[i] = 0
          this.wMist[i] = 0
          wa.aSize[i] = rand(7, 12) * f.vis
          wa.aAlpha[i] = 0.75
        }
      }
    }

    // Eau : chute, puis brume qui s'étale au contact du sol
    for (let i = 0; i < this.wCount; i++) {
      this.wT[i] += f.dt
      if ((this.wMist[i] && this.wT[i] > 1.8) || this.wT[i] > 6) {
        const j = --this.wCount
        wp[i * 3] = wp[j * 3]; wp[i * 3 + 1] = wp[j * 3 + 1]; wp[i * 3 + 2] = wp[j * 3 + 2]
        this.wVx[i] = this.wVx[j]; this.wVy[i] = this.wVy[j]; this.wVz[i] = this.wVz[j]
        this.wT[i] = this.wT[j]; this.wMist[i] = this.wMist[j]
        wa.aSize[i] = wa.aSize[j]; wa.aAlpha[i] = wa.aAlpha[j]
        i--
        continue
      }
      if (!this.wMist[i]) {
        this.wVz[i] -= 260 * f.dt
        this.wVx[i] *= 1 - 0.8 * f.dt
        this.wVy[i] *= 1 - 0.8 * f.dt
        wp[i * 3] += this.wVx[i] * f.dt
        wp[i * 3 + 1] += this.wVy[i] * f.dt
        wp[i * 3 + 2] += this.wVz[i] * f.dt
        const g = f.elev.at(wp[i * 3], wp[i * 3 + 1])
        if (wp[i * 3 + 2] <= g + 3) {
          wp[i * 3 + 2] = g + 6
          this.wMist[i] = 1
          this.wT[i] = 0
          this.wVx[i] = rand(-40, 40); this.wVy[i] = rand(-40, 40)
        }
      } else {
        const k = this.wT[i] / 1.8
        wp[i * 3] += this.wVx[i] * f.dt * (1 - k)
        wp[i * 3 + 1] += this.wVy[i] * f.dt * (1 - k)
        wp[i * 3 + 2] += 6 * f.dt
        wa.aSize[i] = (30 + 90 * k) * f.vis
        wa.aAlpha[i] = 0.32 * (1 - k)
      }
    }
    this.water.commit(this.wCount)
    const wm = this.water.points.material as THREE.ShaderMaterial
    wm.uniforms.uPxPerMeterW.value = f.pxPerMeterW

    this.updateRain(f)
  }

  private updateRain(f: FxFrame) {
    const mmh = f.world?.weather?.rain ?? 0
    const n = Math.min(this.rainCap, Math.floor(this.rainCap * Math.min(1, mmh / 6)))
    this.rain.visible = n > 0
    if (!n) return
    const box = Math.min(5000, Math.max(1500, 2600 * f.vis))
    const top = 1300
    const cx = f.center[0], cy = f.center[1]
    if (!this.rainInit) {
      for (let i = 0; i < this.rainCap; i++) {
        this.rx[i] = cx + rand(-box, box); this.ry[i] = cy + rand(-box, box)
        this.rz[i] = f.elev.at(this.rx[i], this.ry[i]) + Math.random() * top
      }
      this.rainInit = true
    }
    const fall = (f.reduced ? 90 : 330)
    const slantX = f.windTo[0] * f.windSpeed * 9
    const slantY = f.windTo[1] * f.windSpeed * 9
    const len = 0.11
    const pos = this.rainPos
    for (let i = 0; i < n; i++) {
      this.rx[i] += slantX * f.dt; this.ry[i] += slantY * f.dt; this.rz[i] -= fall * f.dt
      const g = f.elev.at(this.rx[i], this.ry[i])
      if (this.rz[i] < g || Math.abs(this.rx[i] - cx) > box || Math.abs(this.ry[i] - cy) > box) {
        this.rx[i] = cx + rand(-box, box); this.ry[i] = cy + rand(-box, box)
        this.rz[i] = f.elev.at(this.rx[i], this.ry[i]) + top * rand(0.6, 1)
      }
      pos[i * 6] = this.rx[i]; pos[i * 6 + 1] = this.ry[i]; pos[i * 6 + 2] = this.rz[i]
      pos[i * 6 + 3] = this.rx[i] - slantX * len; pos[i * 6 + 4] = this.ry[i] - slantY * len
      pos[i * 6 + 5] = this.rz[i] + fall * len
    }
    this.rainGeo.setDrawRange(0, n * 2)
    const a = this.rainGeo.getAttribute("position") as THREE.BufferAttribute
    a.clearUpdateRanges(); a.addUpdateRange(0, n * 6); a.needsUpdate = true
  }

  dispose() {
    this.planeGeo.dispose()
    this.planeMat.dispose()
    this.water.dispose()
    this.rainGeo.dispose()
    ;(this.rain.material as THREE.Material).dispose()
  }
}
