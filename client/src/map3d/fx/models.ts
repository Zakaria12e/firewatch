/**
 * Modèles 3D low-poly procéduraux des appareils (mètres réels, construits Y-haut
 * puis basculés Z-haut). Chaque modèle = une BufferGeometry fusionnée à couleurs
 * de sommets, partagée par toutes les instances (InstancedMesh).
 */
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { DeviceKind } from "@/types"

const WHITE = "#ecebe7"
const LIGHT = "#d6d4cf"
const METAL = "#a3a3a3"
const DARK = "#474747"
const FIRE = "#FF5A1F"
const RED = "#E0260E"

type Part = THREE.BufferGeometry

function paint(geo: THREE.BufferGeometry, hex: string): Part {
  const g = geo.index ? geo.toNonIndexed() : geo
  const c = new THREE.Color(hex)
  const n = g.getAttribute("position").count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3))
  if (g.getAttribute("uv")) g.deleteAttribute("uv")
  return g
}

class Builder {
  parts: Part[] = []
  add(geo: THREE.BufferGeometry, hex: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (rx) geo.rotateX(rx)
    if (ry) geo.rotateY(ry)
    if (rz) geo.rotateZ(rz)
    geo.translate(x, y, z)
    this.parts.push(paint(geo, hex))
    return this
  }
  /** Poutre (boîte) entre deux points. */
  beam(a: THREE.Vector3, b: THREE.Vector3, t: number, hex: string) {
    const len = a.distanceTo(b)
    const g = new THREE.BoxGeometry(t, len, t)
    const dir = b.clone().sub(a).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    g.applyQuaternion(q)
    const mid = a.clone().add(b).multiplyScalar(0.5)
    g.translate(mid.x, mid.y, mid.z)
    this.parts.push(paint(g, hex))
    return this
  }
  /** Fusionne et bascule Y-haut → Z-haut (l'avant −Z devient le nord +Y). */
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts)!
    g.rotateX(Math.PI / 2)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    this.parts.forEach((p) => p.dispose())
    return g
  }
}

/** Décalage Y-haut → Z-haut d'un point (même bascule que les géométries). */
export const zUp = (x: number, y: number, z: number): [number, number, number] => [x, -z, y]

function baseAndStake(b: Builder, h = 1.5) {
  b.add(new THREE.CylinderGeometry(0.24, 0.3, 0.1, 8), DARK, 0, 0.05, 0)
  b.add(new THREE.CylinderGeometry(0.045, 0.05, h, 6), METAL, 0, h / 2, 0)
}

export interface KindModel {
  body: THREE.BufferGeometry
  /** hauteur totale (m réels) : ancrage des étiquettes et des liens radio */
  height: number
  /** position de la LED (Z-haut, m réels), null = pas de LED */
  led: [number, number, number] | null
}

export function buildKindModel(kind: DeviceKind): KindModel {
  const b = new Builder()
  switch (kind) {
    case "station": {
      b.add(new THREE.CylinderGeometry(0.45, 0.55, 0.2, 8), DARK, 0, 0.1, 0)
      b.add(new THREE.CylinderGeometry(0.06, 0.075, 4.2, 6), METAL, 0, 2.1, 0)
      b.add(new THREE.BoxGeometry(0.62, 0.78, 0.36), WHITE, 0, 2.3, -0.22)
      b.add(new THREE.BoxGeometry(0.64, 0.08, 0.38), FIRE, 0, 2.55, -0.22)
      b.add(new THREE.BoxGeometry(1.04, 0.03, 0.72), "#8a8a8a", 0, 3.26, 0.26, -0.6)
      b.add(new THREE.BoxGeometry(1.0, 0.04, 0.68), "#16181c", 0, 3.29, 0.25, -0.6)
      b.add(new THREE.CylinderGeometry(0.022, 0.022, 1.3, 5), LIGHT, 0, 4.85, 0)
      b.add(new THREE.SphereGeometry(0.07, 6, 4), FIRE, 0, 5.5, 0)
      return { body: b.build(), height: 5.6, led: zUp(0.18, 2.62, -0.42) }
    }
    case "temp": {
      baseAndStake(b, 1.4)
      for (let k = 0; k < 5; k++) b.add(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 10), WHITE, 0, 1.42 + k * 0.075, 0)
      b.add(new THREE.CylinderGeometry(0.07, 0.2, 0.08, 10), LIGHT, 0, 1.8, 0)
      return { body: b.build(), height: 1.9, led: zUp(0, 1.5, -0.25) }
    }
    case "smoke":
    case "co": {
      baseAndStake(b, 1.45)
      b.add(new THREE.BoxGeometry(0.36, 0.26, 0.24), kind === "co" ? LIGHT : WHITE, 0, 1.6, 0)
      if (kind === "co") b.add(new THREE.BoxGeometry(0.37, 0.05, 0.25), RED, 0, 1.52, 0)
      b.add(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10), DARK, 0, 1.76, 0)
      return { body: b.build(), height: 1.85, led: zUp(0.12, 1.64, -0.13) }
    }
    case "flame": {
      baseAndStake(b, 1.45)
      b.add(new THREE.BoxGeometry(0.3, 0.2, 0.2), LIGHT, 0, 1.58, 0)
      b.add(new THREE.SphereGeometry(0.08, 8, 6), FIRE, 0, 1.58, -0.12)
      return { body: b.build(), height: 1.75, led: zUp(0.1, 1.65, -0.11) }
    }
    case "fuel": {
      baseAndStake(b, 1.2)
      b.add(new THREE.BoxGeometry(0.22, 0.3, 0.16), WHITE, 0, 1.3, 0)
      b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), "#8b6a45", 0.42, 0.35, 0, 0, 0, Math.PI / 2)
      return { body: b.build(), height: 1.5, led: zUp(0.06, 1.36, -0.09) }
    }
    case "rain": {
      baseAndStake(b, 1.5)
      b.add(new THREE.CylinderGeometry(0.21, 0.15, 0.34, 12), WHITE, 0, 1.67, 0)
      b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 12), DARK, 0, 1.845, 0)
      return { body: b.build(), height: 1.9, led: zUp(0.16, 1.6, -0.1) }
    }
    case "wind": {
      b.add(new THREE.CylinderGeometry(0.24, 0.3, 0.1, 8), DARK, 0, 0.05, 0)
      b.add(new THREE.CylinderGeometry(0.04, 0.05, 2.8, 6), METAL, 0, 1.4, 0)
      b.add(new THREE.BoxGeometry(0.95, 0.04, 0.04), METAL, 0, 2.8, 0)
      b.add(new THREE.BoxGeometry(0.2, 0.18, 0.12), WHITE, 0, 1.2, -0.08)
      return { body: b.build(), height: 3.15, led: zUp(0.06, 1.24, -0.15) }
    }
    case "thermal": {
      b.add(new THREE.CylinderGeometry(0.42, 0.5, 0.2, 8), DARK, 0, 0.1, 0)
      b.add(new THREE.CylinderGeometry(0.07, 0.085, 3.3, 6), METAL, 0, 1.65, 0)
      b.add(new THREE.BoxGeometry(0.2, 0.26, 0.2), DARK, 0, 3.32, 0)
      b.add(new THREE.BoxGeometry(0.4, 0.5, 0.22), WHITE, 0, 1.6, -0.15)
      return { body: b.build(), height: 4.0, led: zUp(0.12, 1.7, -0.27) }
    }
    case "gateway": {
      const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      const at = (sx: number, sz: number, y: number) => {
        const w = 0.85 - (0.85 - 0.22) * (y / 9)
        return new THREE.Vector3(sx * w, y, sz * w)
      }
      for (const [sx, sz] of legs) b.beam(at(sx, sz, 0), at(sx, sz, 9), 0.09, METAL)
      for (const y of [2.5, 5, 7.3, 9]) {
        for (let k = 0; k < 4; k++) {
          const [ax, az] = legs[k], [bx, bz] = legs[(k + 1) % 4]
          b.beam(at(ax, az, y), at(bx, bz, y), 0.06, METAL)
        }
      }
      for (const [y0, y1] of [[0, 2.5], [2.5, 5], [5, 7.3], [7.3, 9]]) {
        for (let k = 0; k < 4; k++) {
          const [ax, az] = legs[k], [bx, bz] = legs[(k + 1) % 4]
          b.beam(at(ax, az, y0), at(bx, bz, y1), 0.04, LIGHT)
        }
      }
      b.add(new THREE.BoxGeometry(0.7, 0.06, 0.7), DARK, 0, 9.03, 0)
      b.add(new THREE.CylinderGeometry(0.035, 0.05, 2.6, 6), LIGHT, 0, 10.35, 0)
      b.add(new THREE.SphereGeometry(0.09, 6, 4), FIRE, 0, 11.7, 0)
      b.add(new THREE.BoxGeometry(0.42, 0.52, 0.26), WHITE, 0, 2.0, -0.62)
      b.add(new THREE.BoxGeometry(0.44, 0.06, 0.28), FIRE, 0, 2.2, -0.62)
      return { body: b.build(), height: 11.8, led: zUp(0.13, 2.02, -0.76) }
    }
    case "siren": {
      b.add(new THREE.CylinderGeometry(0.3, 0.36, 0.12, 8), DARK, 0, 0.06, 0)
      b.add(new THREE.CylinderGeometry(0.07, 0.085, 4, 6), METAL, 0, 2, 0)
      b.add(new THREE.BoxGeometry(0.3, 0.3, 0.3), DARK, 0, 3.55, 0)
      b.add(new THREE.ConeGeometry(0.3, 0.62, 10, 1, true), WHITE, 0.42, 3.55, 0, 0, 0, Math.PI / 2)
      b.add(new THREE.ConeGeometry(0.3, 0.62, 10, 1, true), WHITE, -0.42, 3.55, 0, 0, 0, -Math.PI / 2)
      b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 6), METAL, 0, 3.85, 0)
      return { body: b.build(), height: 4.45, led: null }
    }
  }
}

/** Tête orientable de la caméra thermique (pivot à l'origine, objectif vers −Z). */
export function buildThermalHead(): THREE.BufferGeometry {
  const b = new Builder()
  b.add(new THREE.BoxGeometry(0.42, 0.32, 0.62), WHITE, 0, 0, 0.05)
  b.add(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 12), "#111214", 0, 0, -0.31, Math.PI / 2)
  b.add(new THREE.CylinderGeometry(0.135, 0.135, 0.03, 12), FIRE, 0, 0, -0.37, Math.PI / 2)
  b.add(new THREE.BoxGeometry(0.5, 0.03, 0.78), LIGHT, 0, 0.2, 0)
  return b.build()
}
export const THERMAL_PIVOT_Z = 3.55

/** Moulinet de l'anémomètre (3 coupelles) et girouette (pointe vers −Z). */
export function buildWindRotor(): THREE.BufferGeometry {
  const b = new Builder()
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), DARK, 0, 0, 0)
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2
    b.add(new THREE.BoxGeometry(0.3, 0.02, 0.02), METAL, Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15, 0, -a, 0)
    b.add(new THREE.SphereGeometry(0.06, 6, 4, 0, Math.PI), WHITE, Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3, 0, -a, 0)
  }
  return b.build()
}
export function buildWindVane(): THREE.BufferGeometry {
  const b = new Builder()
  b.add(new THREE.BoxGeometry(0.03, 0.03, 0.75), METAL, 0, 0, 0)
  b.add(new THREE.ConeGeometry(0.05, 0.14, 6), FIRE, 0, 0, -0.42, -Math.PI / 2)
  b.add(new THREE.BoxGeometry(0.02, 0.2, 0.24), WHITE, 0, 0.02, 0.33)
  return b.build()
}
export const WIND_ROTOR_OFFSET = zUp(-0.45, 2.95, 0)
export const WIND_VANE_OFFSET = zUp(0.45, 2.9, 0)

/** Gyrophare (cylindre) et faisceaux de la sirène. */
export function buildBeacon(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.15, 0.17, 0.3, 12)
  g.rotateX(Math.PI / 2)
  return g
}
export function buildBeam(): THREE.BufferGeometry {
  // deux cônes ouverts opposés, horizontaux
  const parts: THREE.BufferGeometry[] = []
  for (const s of [1, -1]) {
    const c = new THREE.ConeGeometry(0.32, 2.2, 10, 1, true)
    c.translate(0, -1.1, 0)
    c.rotateZ(s > 0 ? Math.PI / 2 : -Math.PI / 2)
    if (c.getAttribute("uv")) c.deleteAttribute("uv")
    parts.push(c)
  }
  const g = mergeGeometries(parts)!
  g.rotateX(Math.PI / 2)
  return g
}
export const BEACON_Z = 4.15

/**
 * Cône de vision de la caméra (apex à l'origine, avant +Y, Z haut) : 110° en
 * azimut, de −20° à 0° en site, longueur 1 (mise à l'échelle par la portée).
 */
export function buildViewCone(halfDeg = 55, downDeg = 20, upDeg = 0, steps = 22): THREE.BufferGeometry {
  const pos: number[] = []
  const dir = (az: number, el: number): [number, number, number] => {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180
    return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]
  }
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c)
  const O = [0, 0, 0]
  for (let i = 0; i < steps; i++) {
    const a0 = -halfDeg + (2 * halfDeg * i) / steps
    const a1 = -halfDeg + (2 * halfDeg * (i + 1)) / steps
    const t0 = dir(a0, upDeg), t1 = dir(a1, upDeg), b0 = dir(a0, -downDeg), b1 = dir(a1, -downDeg)
    tri(O, t0, t1)          // face haute
    tri(O, b1, b0)          // face basse
    tri(t0, b0, b1)         // face lointaine
    tri(t0, b1, t1)
  }
  const l0 = dir(-halfDeg, upDeg), l1 = dir(-halfDeg, -downDeg)
  const r0 = dir(halfDeg, upDeg), r1 = dir(halfDeg, -downDeg)
  tri(O, l1, l0)
  tri(O, r0, r1)
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}
