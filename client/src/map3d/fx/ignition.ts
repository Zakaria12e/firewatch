/**
 * Point de départ d'un feu en attente (outil Feu) : balise lumineuse plantée dans le
 * relief, qui se remplit pendant le compte à rebours. Pour une ligne de feu, une balise
 * jalonne la ligne tous les ~120 m. Aucun lien avec les capteurs : l'aperçu ne montre
 * que l'endroit où le feu va prendre.
 */
import * as THREE from "three"
import type { FxFrame, FxSystem } from "../fxTypes"

export interface IgnitionPreview {
  /** points [lon, lat] : un seul pour un départ ponctuel, plusieurs pour une ligne */
  points: [number, number][]
  /** 0 → 1 pendant le compte à rebours */
  progress: number
  /** compte à rebours suspendu (déplacement en cours) */
  held: boolean
}

const MAX_POSTS = 24
const POST_SPACING_M = 120
const HEIGHT = 9          // en unités de modèle (une station mesure 5,6)
const RADIUS = 0.32
const HEAD = 0.8

export class IgnitionSystem implements FxSystem {
  readonly object = new THREE.Group()
  private posts: { beam: THREE.Mesh; fill: THREE.Mesh; head: THREE.Mesh }[] = []
  private preview: IgnitionPreview | null = null
  private local: [number, number][] = []
  private beamMat: THREE.MeshBasicMaterial
  private fillMat: THREE.MeshBasicMaterial
  private headMat: THREE.MeshBasicMaterial
  private geoms: THREE.BufferGeometry[] = []

  constructor() {
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true)
    beamGeo.rotateX(Math.PI / 2)
    beamGeo.translate(0, 0, 0.5)   // de z = 0 (sol) à z = 1
    const headGeo = new THREE.SphereGeometry(1, 18, 12)
    this.geoms.push(beamGeo, headGeo)
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false })
    for (let i = 0; i < MAX_POSTS; i++) {
      const beam = new THREE.Mesh(beamGeo, this.beamMat)
      const fill = new THREE.Mesh(beamGeo, this.fillMat)
      const head = new THREE.Mesh(headGeo, this.headMat)
      for (const m of [beam, fill, head]) {
        m.visible = false
        m.renderOrder = 9
        m.frustumCulled = false
        this.object.add(m)
      }
      this.posts.push({ beam, fill, head })
    }
    this.object.visible = false
  }

  setPreview(p: IgnitionPreview | null) {
    this.preview = p
    this.local = []
  }

  /** Avancement du compte à rebours, sans recalculer les positions. */
  setProgress(progress: number, held: boolean) {
    if (this.preview) this.preview = { ...this.preview, progress, held }
  }

  /** Points de la ligne rééchantillonnés tous les ~120 m (repère local). */
  private resample(f: FxFrame): [number, number][] {
    const pts = this.preview!.points.map(([lon, lat]) => f.frame.toLocal(lon, lat, [0, 0]))
    if (pts.length < 2) return pts
    const out: [number, number][] = [pts[0]]
    let carry = 0
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
      const len = Math.hypot(bx - ax, by - ay)
      let d = POST_SPACING_M - carry
      while (d <= len) {
        out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len])
        d += POST_SPACING_M
      }
      carry = len - (d - POST_SPACING_M)
    }
    out.push(pts[pts.length - 1])
    if (out.length <= MAX_POSTS) return out
    const step = (out.length - 1) / (MAX_POSTS - 1)
    return Array.from({ length: MAX_POSTS }, (_, i) => out[Math.round(i * step)])
  }

  update(f: FxFrame) {
    const p = this.preview
    if (!p || !p.points.length) {
      this.object.visible = false
      return
    }
    if (!this.local.length) this.local = this.resample(f)
    this.object.visible = true
    const s = f.modelScale
    const pulse = f.reduced ? 1 : 0.75 + 0.25 * Math.sin(f.t * 6)
    this.beamMat.opacity = 0.18 + 0.12 * pulse
    this.fillMat.opacity = p.held ? 0.45 : 0.85
    const bob = f.reduced || p.held ? 0 : Math.sin(f.t * 4) * 0.25

    this.posts.forEach((post, i) => {
      const pt = this.local[i]
      const on = !!pt
      post.beam.visible = post.fill.visible = post.head.visible = on
      if (!on) return
      const z = f.elev.at(pt[0], pt[1])
      // la balise principale (premier point) est plus haute que les jalons d'une ligne
      const h = (i === 0 ? HEIGHT : HEIGHT * 0.55) * s
      post.beam.position.set(pt[0], pt[1], z)
      post.beam.scale.set(RADIUS * s, RADIUS * s, h)
      post.fill.position.set(pt[0], pt[1], z)
      post.fill.scale.set(RADIUS * 0.75 * s, RADIUS * 0.75 * s, Math.max(0.001, h * p.progress))
      post.head.position.set(pt[0], pt[1], z + h + (HEAD + bob) * s)
      const hs = (i === 0 ? HEAD : HEAD * 0.6) * s * (0.85 + 0.15 * pulse)
      post.head.scale.set(hs, hs, hs)
    })
  }

  dispose() {
    for (const g of this.geoms) g.dispose()
    this.beamMat.dispose()
    this.fillMat.dispose()
    this.headMat.dispose()
  }
}
