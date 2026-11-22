/**
 * Tampons de particules réutilisés (BufferGeometry allouée une fois, plage de
 * dessin et plages de mise à jour limitées aux particules vivantes).
 */
import * as THREE from "three"

export class ParticleBuffer {
  readonly geometry = new THREE.BufferGeometry()
  readonly points: THREE.Points
  readonly capacity: number
  readonly pos: Float32Array
  readonly attr: Record<string, Float32Array> = {}
  private sizes: Record<string, number> = {}

  constructor(capacity: number, extra: Record<string, number>, material: THREE.Material) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 3)
    const pa = new THREE.BufferAttribute(this.pos, 3)
    pa.setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute("position", pa)
    for (const [name, size] of Object.entries(extra)) {
      const arr = new Float32Array(capacity * size)
      const a = new THREE.BufferAttribute(arr, size)
      a.setUsage(THREE.DynamicDrawUsage)
      this.geometry.setAttribute(name, a)
      this.attr[name] = arr
      this.sizes[name] = size
    }
    this.geometry.setDrawRange(0, 0)
    this.points = new THREE.Points(this.geometry, material)
    this.points.frustumCulled = false
  }

  /** Publie les `count` premières particules vers le GPU. */
  commit(count: number) {
    this.geometry.setDrawRange(0, count)
    const upload = (name: string, size: number) => {
      const a = this.geometry.getAttribute(name) as THREE.BufferAttribute
      a.clearUpdateRanges()
      if (count > 0) a.addUpdateRange(0, count * size)
      a.needsUpdate = true
    }
    upload("position", 3)
    for (const [name, size] of Object.entries(this.sizes)) upload(name, size)
  }

  dispose() {
    this.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

/** Uniformes communs aux sprites dont la taille est donnée en mètres. */
export function spriteUniforms() {
  return {
    uPxPerMeterW: { value: 1 },
    uMinPx: { value: 1.5 },
    uMaxPx: { value: 160 },
    uTime: { value: 0 },
  }
}

/** En-tête GLSL : taille d'un sprite (mètres → pixels, perspective correcte). */
export const SPRITE_SIZE_GLSL = /* glsl */ `
uniform float uPxPerMeterW;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uTime;
float spritePx(float meters, float w) {
  return clamp(meters * uPxPerMeterW / max(w, 1e-6), uMinPx, uMaxPx);
}
`

/** Bruit de valeur 2D (fragment shaders). */
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

/** Générateur pseudo-aléatoire rapide (déterministe par graine). */
export function rand(a: number, b: number) {
  return a + Math.random() * (b - a)
}

/** Couleur hexadécimale → [r, g, b] 0..1 (espace sRGB, utilisée telle quelle par les shaders). */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Littéral GLSL vec3 d'une couleur hexadécimale. */
export function glslColor(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`
}
