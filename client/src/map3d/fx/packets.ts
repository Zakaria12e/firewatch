/**
 * Paquets reçus : à chaque message CoAP, une impulsion lumineuse voyage de
 * l'appareil vers la passerelle qui l'a relayé (couleur selon le RSSI), puis la
 * passerelle émet son onde radio.
 */
import * as THREE from "three"
import type { PacketEvent } from "@/lib/packetBus"
import type { FxFrame, FxSystem } from "../fxTypes"
import { ParticleBuffer, SPRITE_SIZE_GLSL, rgb } from "../particles"
import type { DeviceSystem } from "./devices"

const VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
${SPRITE_SIZE_GLSL}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = spritePx(aSize, gl_Position.w);
  vColor = aColor; vAlpha = aAlpha;
}
`
const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float g = pow(1.0 - d, 2.0);
  vec3 col = mix(vColor, vec3(1.0, 0.92, 0.85), g * g * 0.7);
  gl_FragColor = vec4(col, g * vAlpha);
}
`

const STRONG = rgb("#FF5A1F")
const MEDIUM = rgb("#E0260E")
const WEAK = rgb("#6B2510")

/** Couleur du lien selon le RSSI (dBm). */
export function rssiColor(rssi: number | undefined): [number, number, number] {
  if (rssi === undefined) return STRONG
  if (rssi >= -105) return STRONG
  if (rssi >= -118) return MEDIUM
  return WEAK
}

interface Pulse {
  from: string
  to: string
  start: number
  dur: number
  color: [number, number, number]
  arrived: boolean
}

const TRAIL = 6

export class PacketSystem implements FxSystem {
  readonly object = new THREE.Group()
  private buf: ParticleBuffer
  private pulses: Pulse[] = []
  private queue: PacketEvent[] = []
  private devices: DeviceSystem

  constructor(devices: DeviceSystem) {
    this.devices = devices
    this.buf = new ParticleBuffer(1200, { aSize: 1, aColor: 3, aAlpha: 1 }, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uPxPerMeterW: { value: 1 }, uMinPx: { value: 2.5 }, uMaxPx: { value: 60 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }))
    this.buf.points.renderOrder = 20
    this.object.add(this.buf.points)
  }

  push(e: PacketEvent) {
    if (this.queue.length < 200) this.queue.push(e)
  }

  update(f: FxFrame) {
    for (const e of this.queue) {
      this.devices.flashLed(e.id)
      const gw = e.gw && e.gw !== e.id ? e.gw : e.gw === e.id ? null : this.devices.nearestGateway(e.id)
      if (!gw) continue
      if (f.reduced) { this.devices.flashGateway(gw, f); continue }
      this.pulses.push({ from: e.id, to: gw, start: f.t, dur: 0.85, color: rssiColor(e.rssi), arrived: false })
    }
    this.queue = []

    const p = this.buf.pos
    const a = this.buf.attr
    let n = 0
    for (let k = this.pulses.length - 1; k >= 0; k--) {
      const pl = this.pulses[k]
      const age = f.t - pl.start
      const A = this.devices.anchor(pl.from, f)
      const B = this.devices.anchor(pl.to, f)
      if (!A || !B || age > pl.dur + TRAIL * 0.03) { this.pulses.splice(k, 1); continue }
      if (!pl.arrived && age >= pl.dur) {
        pl.arrived = true
        this.devices.flashGateway(pl.to, f)
      }
      const dist = Math.hypot(B[0] - A[0], B[1] - A[1])
      const lift = 0.12 * dist
      for (let tr = 0; tr < TRAIL && n < this.buf.capacity; tr++) {
        let u = (age - tr * 0.03) / pl.dur
        if (u < 0 || u > 1) continue
        u = u * u * (3 - 2 * u)        // départ et arrivée en douceur
        p[n * 3] = A[0] + (B[0] - A[0]) * u
        p[n * 3 + 1] = A[1] + (B[1] - A[1]) * u
        p[n * 3 + 2] = A[2] + (B[2] - A[2]) * u + 4 * lift * u * (1 - u)
        a.aSize[n] = (46 - tr * 6) * f.vis
        a.aColor[n * 3] = pl.color[0]; a.aColor[n * 3 + 1] = pl.color[1]; a.aColor[n * 3 + 2] = pl.color[2]
        a.aAlpha[n] = 1 - tr / TRAIL
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
