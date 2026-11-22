/**
 * Appareils en modèles 3D (InstancedMesh par type) posés sur le relief :
 * LED qui clignote à chaque paquet émis, tête de caméra thermique qui pivote
 * vers son azimut (cône de vision 3D), pylône de passerelle (onde radio à chaque
 * paquet relayé, dôme de couverture), gyrophare et ondes de la sirène,
 * anémomètre et girouette pilotés par les mesures reçues.
 */
import * as THREE from "three"
import type { DeviceKind, FireNode, WorldDevice, WorldState } from "@/types"
import type { LocalFrame } from "../frame"
import type { FxFrame, FxSystem } from "../fxTypes"
import { ParticleBuffer, SPRITE_SIZE_GLSL } from "../particles"
import {
  buildKindModel, buildThermalHead, buildWindRotor, buildWindVane, buildBeacon, buildBeam, buildViewCone,
  THERMAL_PIVOT_Z, WIND_ROTOR_OFFSET, WIND_VANE_OFFSET, BEACON_Z, type KindModel,
} from "./models"

const KINDS: DeviceKind[] = ["station", "temp", "smoke", "co", "flame", "thermal", "wind", "fuel", "rain", "siren", "gateway"]
const CAP = 96                 // instances max par type
const CAMERA_RANGE_M = 800     // portée de la MLX90640
export const GATEWAY_RANGE_M = 4500

interface Dev {
  id: string
  kind: DeviceKind
  lon: number
  lat: number
  x: number
  y: number
  az: number            // azimut affiché (lissé)
  azTarget: number
  fault: string
  siren: boolean
  flash: number         // instant du dernier paquet (horloge d'animation)
  spin: number          // angle du moulinet
  windSpeed: number
  windDir: number
}

interface Wave { x: number; y: number; z: number; start: number; dur: number; radius: number; r: number; g: number; b: number }

const GLOW_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
${SPRITE_SIZE_GLSL}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = spritePx(aSize, gl_Position.w);
  vColor = aColor;
}
`
const GLOW_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float g = pow(1.0 - d, 2.4);
  gl_FragColor = vec4(vColor * g, g);
}
`

const DOME_VERT = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const DOME_FRAG = /* glsl */ `
uniform vec3 uView;
uniform float uOpacity;
varying vec3 vNormal;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), -uView)), 2.5);
  gl_FragColor = vec4(1.0, 0.353, 0.122, (0.008 + 0.13 * rim) * uOpacity);
}
`

export class DeviceSystem implements FxSystem {
  readonly object = new THREE.Group()
  private frame: LocalFrame | null = null
  private devs = new Map<string, Dev>()
  private order: Dev[] = []
  private overrides = new Map<string, { lon: number; lat: number; until: number }>()
  private models = new Map<DeviceKind, KindModel>()
  private bodies = new Map<DeviceKind, THREE.InstancedMesh>()
  private bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  private head: THREE.InstancedMesh
  private rotor: THREE.InstancedMesh
  private vane: THREE.InstancedMesh
  private beacon: THREE.InstancedMesh
  private beam: THREE.InstancedMesh
  private leds: THREE.InstancedMesh
  private cones: THREE.InstancedMesh
  private waves: THREE.InstancedMesh
  private waveList: Wave[] = []
  private glow: ParticleBuffer
  private domeGeo: THREE.SphereGeometry
  private domeMat: THREE.ShaderMaterial
  private domes: THREE.Mesh[] = []
  private nodes = new Map<string, FireNode>()
  private lastSirenWave = new Map<string, number>()
  private lastGatewayWave = new Map<string, number>()
  private clock = 0
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private c = new THREE.Color()

  constructor() {
    for (const k of KINDS) {
      const model = buildKindModel(k)
      this.models.set(k, model)
      const mesh = new THREE.InstancedMesh(model.body, this.bodyMat, CAP)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.bodies.set(k, mesh)
      this.object.add(mesh)
    }
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, cap = CAP) => {
      const mesh = new THREE.InstancedMesh(geo, mat, cap)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.object.add(mesh)
      return mesh
    }
    this.head = mk(buildThermalHead(), this.bodyMat)
    this.rotor = mk(buildWindRotor(), this.bodyMat)
    this.vane = mk(buildWindVane(), this.bodyMat)
    this.beacon = mk(buildBeacon(), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    this.beam = mk(buildBeam(), new THREE.MeshBasicMaterial({
      color: 0xe0260e, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }))
    this.leds = mk(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), CAP * 4)
    this.cones = mk(buildViewCone(), new THREE.MeshBasicMaterial({
      color: 0xff5a1f, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }), 32)
    this.cones.renderOrder = 2
    this.waves = mk(new THREE.RingGeometry(0.975, 1, 72), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }), 128)
    this.waves.renderOrder = 4
    this.glow = new ParticleBuffer(CAP * 4, { aSize: 1, aColor: 3 }, new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      uniforms: { uPxPerMeterW: { value: 1 }, uMinPx: { value: 0 }, uMaxPx: { value: 90 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    }))
    this.glow.points.renderOrder = 11
    this.object.add(this.glow.points)
    this.domeGeo = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    this.domeGeo.rotateX(Math.PI / 2)
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
      uniforms: { uView: { value: new THREE.Vector3(0, 1, -1).normalize() }, uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  }

  // ------------------------------------------------------------------ données
  setWorld(world: WorldState | null, f: { frame: LocalFrame }) {
    this.frame = f.frame
    const list: WorldDevice[] = world?.devices ?? []
    const seen = new Set<string>()
    const p: [number, number] = [0, 0]
    for (const d of list) {
      seen.add(d.id)
      let dev = this.devs.get(d.id)
      const ov = this.overrides.get(d.id)
      // déplacement optimiste : on garde la position glissée jusqu'à l'écho du simulateur
      let lon = d.lon, lat = d.lat
      if (ov) {
        const close = Math.abs(ov.lon - d.lon) < 2e-5 && Math.abs(ov.lat - d.lat) < 2e-5
        if (close || Date.now() > ov.until) this.overrides.delete(d.id)
        else { lon = ov.lon; lat = ov.lat }
      }
      f.frame.toLocal(lon, lat, p)
      if (!dev) {
        dev = {
          id: d.id, kind: d.kind, lon, lat, x: p[0], y: p[1],
          az: d.azimuth ?? 0, azTarget: d.azimuth ?? 0, fault: d.fault, siren: !!d.siren,
          flash: -10, spin: 0, windSpeed: 0, windDir: 0,
        }
        this.devs.set(d.id, dev)
      }
      dev.kind = d.kind
      dev.lon = lon; dev.lat = lat; dev.x = p[0]; dev.y = p[1]
      dev.azTarget = d.azimuth ?? 0
      dev.fault = d.fault
      dev.siren = !!d.siren
    }
    for (const id of [...this.devs.keys()]) if (!seen.has(id)) this.devs.delete(id)
    this.order = [...this.devs.values()]
    this.syncDomes()
  }

  setNodes(nodes: FireNode[]) {
    this.nodes.clear()
    for (const n of nodes) this.nodes.set(n.id, n)
    for (const d of this.order) {
      const r = this.nodes.get(d.id)?.readings
      if (r?.wind_speed !== undefined) d.windSpeed = r.wind_speed
      if (r?.wind_dir !== undefined) d.windDir = r.wind_dir
    }
  }

  /** Position glissée sur la carte (avant confirmation par le monde). */
  setOverride(id: string, lon: number, lat: number, holdMs = 4000) {
    this.overrides.set(id, { lon, lat, until: Date.now() + holdMs })
    const d = this.devs.get(id)
    if (d && this.frame) {
      const p = this.frame.toLocal(lon, lat)
      d.lon = lon; d.lat = lat; d.x = p[0]; d.y = p[1]
    }
  }

  private syncDomes() {
    const gws = this.order.filter((d) => d.kind === "gateway")
    while (this.domes.length < gws.length) {
      const m = new THREE.Mesh(this.domeGeo, this.domeMat)
      m.frustumCulled = false
      m.renderOrder = 1
      this.domes.push(m)
      this.object.add(m)
    }
    while (this.domes.length > gws.length) this.object.remove(this.domes.pop()!)
  }

  // ------------------------------------------------------------------ événements
  /** LED de l'émetteur au moment de l'envoi. */
  flashLed(id: string) {
    const d = this.devs.get(id)
    if (d) d.flash = this.clock
  }

  /** Onde radio de la passerelle qui reçoit le paquet. */
  flashGateway(id: string, f: FxFrame) {
    const d = this.devs.get(id)
    if (!d) return
    d.flash = this.clock
    if (!f.quality.waves || f.reduced) return
    const last = this.lastGatewayWave.get(id) ?? -10
    if (f.t - last < 0.45) return
    this.lastGatewayWave.set(id, f.t)
    const top = this.anchor(id, f)
    if (top) this.pushWave(top[0], top[1], top[2], 1.1, 300 * f.vis, 1, 0.353, 0.122)
  }

  private pushWave(x: number, y: number, z: number, dur: number, radius: number, r: number, g: number, b: number) {
    if (this.waveList.length >= 128) this.waveList.shift()
    this.waveList.push({ x, y, z, start: this.clock, dur, radius, r, g, b })
  }

  /** Point d'ancrage (haut du modèle) : étiquettes, liens radio, impulsions. */
  anchor(id: string, f: Pick<FxFrame, "elev" | "modelScale">): [number, number, number] | null {
    const d = this.devs.get(id)
    if (!d) return null
    const h = this.models.get(d.kind)?.height ?? 4
    return [d.x, d.y, f.elev.at(d.x, d.y) + h * f.modelScale]
  }

  base(id: string, f: Pick<FxFrame, "elev">): [number, number, number] | null {
    const d = this.devs.get(id)
    return d ? [d.x, d.y, f.elev.at(d.x, d.y)] : null
  }

  nearestGateway(id: string): string | null {
    const d = this.devs.get(id)
    if (!d) return null
    let best: Dev | null = null, bd = Infinity
    for (const g of this.order) {
      if (g.kind !== "gateway" || g.fault === "offline") continue
      const dd = (g.x - d.x) ** 2 + (g.y - d.y) ** 2
      if (dd < bd) { bd = dd; best = g }
    }
    return best?.id ?? null
  }

  get devices(): readonly Dev[] {
    return this.order
  }

  // ------------------------------------------------------------------ image
  update(f: FxFrame) {
    this.clock = f.t
    const s = f.modelScale
    const counts = new Map<DeviceKind, number>()
    let nHead = 0, nRotor = 0, nVane = 0, nBeacon = 0, nBeam = 0, nLed = 0, nCone = 0
    const gp = this.glow.pos, ga = this.glow.attr
    const up = new THREE.Vector3(0, 0, 1)
    let gi = 0

    for (const d of this.order) {
      const model = this.models.get(d.kind)
      const mesh = this.bodies.get(d.kind)
      if (!model || !mesh) continue
      const z = f.elev.at(d.x, d.y)
      const offline = d.fault === "offline"
      const k = counts.get(d.kind) ?? 0
      if (k >= CAP) continue
      counts.set(d.kind, k + 1)

      this.q.identity()
      this.m.compose(this.v.set(d.x, d.y, z), this.q, this.s.set(s, s, s))
      mesh.setMatrixAt(k, this.m)
      mesh.setColorAt(k, this.c.setScalar(offline ? 0.32 : 1))

      // LED : éclair orange à chaque paquet, rouge si en panne, éteinte hors ligne
      if (model.led && nLed < CAP * 4) {
        const since = f.t - d.flash
        const pulse = since >= 0 && since < 0.5 ? 1 - since / 0.5 : 0
        const faulty = d.fault !== "ok" && !offline
        const blink = faulty ? (Math.sin(f.t * 6.3) > 0 ? 1 : 0.15) : 0
        const [lx, ly, lz] = model.led
        this.v.set(d.x + lx * s, d.y + ly * s, z + lz * s)
        this.m.compose(this.v, this.q.identity(), this.s.setScalar(0.11 * s))
        this.leds.setMatrixAt(nLed, this.m)
        if (offline) this.c.setRGB(0.04, 0.04, 0.04)
        else if (faulty) this.c.setRGB(0.88 * blink + 0.1, 0.15 * blink, 0.05 * blink)
        else this.c.setRGB(0.25 + 0.75 * pulse, 0.08 + 0.5 * pulse, 0.03 + 0.25 * pulse)
        this.leds.setColorAt(nLed, this.c)
        nLed++
        const glowI = offline ? 0 : faulty ? blink * 0.7 : pulse
        if (glowI > 0.02 && gi < this.glow.capacity) {
          gp[gi * 3] = this.v.x; gp[gi * 3 + 1] = this.v.y; gp[gi * 3 + 2] = this.v.z
          ga.aSize[gi] = (34 + 50 * glowI) * f.vis
          ga.aColor[gi * 3] = glowI; ga.aColor[gi * 3 + 1] = (faulty ? 0.15 : 0.42) * glowI; ga.aColor[gi * 3 + 2] = 0.12 * glowI
          gi++
        }
      }

      if (d.kind === "thermal") {
        // pivot lissé vers l'azimut commandé
        const diff = ((d.azTarget - d.az + 540) % 360) - 180
        d.az = (d.az + diff * Math.min(1, f.dt * (f.reduced ? 10 : 2.5)) + 360) % 360
        const yaw = (-d.az * Math.PI) / 180
        this.q.setFromAxisAngle(up, yaw)
        this.m.compose(this.v.set(d.x, d.y, z + THERMAL_PIVOT_Z * s), this.q, this.s.setScalar(s))
        this.head.setMatrixAt(nHead++, this.m)
        if (!offline && nCone < 32) {
          const apexZ = z + Math.min(THERMAL_PIVOT_Z * s, 60)
          this.m.compose(this.v.set(d.x, d.y, apexZ), this.q, this.s.setScalar(CAMERA_RANGE_M))
          this.cones.setMatrixAt(nCone++, this.m)
        }
      } else if (d.kind === "wind") {
        const spd = offline ? 0 : d.windSpeed
        d.spin += f.dt * (f.reduced ? 0.3 : 1) * (0.6 + spd * 1.6)
        this.q.setFromAxisAngle(up, d.spin)
        this.m.compose(this.v.set(d.x + WIND_ROTOR_OFFSET[0] * s, d.y + WIND_ROTOR_OFFSET[1] * s, z + WIND_ROTOR_OFFSET[2] * s), this.q, this.s.setScalar(s))
        this.rotor.setMatrixAt(nRotor++, this.m)
        // la girouette pointe vers d'où vient le vent mesuré
        this.q.setFromAxisAngle(up, (-d.windDir * Math.PI) / 180)
        this.m.compose(this.v.set(d.x + WIND_VANE_OFFSET[0] * s, d.y + WIND_VANE_OFFSET[1] * s, z + WIND_VANE_OFFSET[2] * s), this.q, this.s.setScalar(s))
        this.vane.setMatrixAt(nVane++, this.m)
      }

      // Sirène : gyrophare tournant + ondes (stations équipées d'un relais et sirènes)
      const sounding = d.siren && !offline
      if (d.kind === "siren" || (d.kind === "station" && sounding)) {
        const bz = d.kind === "siren" ? z + BEACON_Z * s : z + (model.height + 0.25) * s
        const spin = sounding && !f.reduced ? f.t * 7 : 0
        this.q.setFromAxisAngle(up, spin)
        this.m.compose(this.v.set(d.x, d.y, bz), this.q, this.s.setScalar(s))
        this.beacon.setMatrixAt(nBeacon, this.m)
        const on = sounding ? 0.75 + 0.25 * Math.sin(f.t * 14) : 0
        this.beacon.setColorAt(nBeacon, sounding ? this.c.setRGB(0.88 + 0.12 * on, 0.15, 0.06) : this.c.setRGB(0.3, 0.06, 0.03))
        nBeacon++
        if (sounding) {
          this.beam.setMatrixAt(nBeam++, this.m)
          if (gi < this.glow.capacity) {
            gp[gi * 3] = d.x; gp[gi * 3 + 1] = d.y; gp[gi * 3 + 2] = bz
            ga.aSize[gi] = 90 * f.vis * on
            ga.aColor[gi * 3] = 0.88 * on; ga.aColor[gi * 3 + 1] = 0.15 * on; ga.aColor[gi * 3 + 2] = 0.06 * on
            gi++
          }
          const last = this.lastSirenWave.get(d.id) ?? -10
          if (f.quality.waves && !f.reduced && f.t - last > 0.75) {
            this.lastSirenWave.set(d.id, f.t)
            this.pushWave(d.x, d.y, bz, 1.4, 240 * f.vis, 0.88, 0.15, 0.055)
          }
        }
      }
    }
    const nGlow = gi

    for (const [kind, mesh] of this.bodies) {
      mesh.count = counts.get(kind) ?? 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    const finish = (mesh: THREE.InstancedMesh, n: number) => {
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    finish(this.head, nHead); finish(this.rotor, nRotor); finish(this.vane, nVane)
    finish(this.beacon, nBeacon); finish(this.beam, nBeam); finish(this.leds, nLed); finish(this.cones, nCone)

    // Ondes (passerelles et sirènes)
    let nWave = 0
    this.waveList = this.waveList.filter((w) => f.t - w.start < w.dur)
    for (const w of this.waveList) {
      const k = (f.t - w.start) / w.dur
      const r = Math.max(1, w.radius * (0.08 + 0.92 * k))
      this.m.compose(this.v.set(w.x, w.y, w.z), this.q.identity(), this.s.set(r, r, r))
      this.waves.setMatrixAt(nWave, this.m)
      const a = (1 - k) * (1 - k) * 0.55
      this.waves.setColorAt(nWave, this.c.setRGB(w.r * a, w.g * a, w.b * a))
      nWave++
    }
    finish(this.waves, nWave)

    this.glow.commit(nGlow)
    ;(this.glow.points.material as THREE.ShaderMaterial).uniforms.uPxPerMeterW.value = f.pxPerMeterW

    // Dômes de couverture des passerelles (aplatis, relief exagéré)
    const gws = this.order.filter((d) => d.kind === "gateway")
    gws.forEach((g, i) => {
      const dome = this.domes[i]
      if (!dome) return
      dome.visible = f.quality.dome && g.fault !== "offline"
      dome.position.set(g.x, g.y, f.elev.at(g.x, g.y))
      dome.scale.set(GATEWAY_RANGE_M, GATEWAY_RANGE_M, GATEWAY_RANGE_M * 0.2)
    })
    const b = (f.bearing * Math.PI) / 180, p = (f.pitch * Math.PI) / 180
    this.domeMat.uniforms.uView.value.set(Math.sin(b) * Math.sin(p), Math.cos(b) * Math.sin(p), -Math.cos(p)).normalize()
  }

  dispose() {
    for (const mesh of this.bodies.values()) mesh.geometry.dispose()
    for (const mesh of [this.head, this.rotor, this.vane, this.beacon, this.beam, this.leds, this.cones, this.waves]) {
      mesh.geometry.dispose()
      if (mesh.material !== this.bodyMat) (mesh.material as THREE.Material).dispose()
    }
    this.bodyMat.dispose()
    this.glow.dispose()
    this.domeGeo.dispose()
    this.domeMat.dispose()
  }
}
