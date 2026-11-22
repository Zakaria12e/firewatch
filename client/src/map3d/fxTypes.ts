import type * as THREE from "three"
import type { WorldState, FireNode } from "@/types"
import type { LocalFrame, GridInfo } from "./frame"
import type { ElevationGrid } from "./elevation"
import type { QualityPreset } from "./quality"

/** État partagé par tous les systèmes d'effets pour une image. */
export interface FxFrame {
  /** horloge d'animation (s) et pas de temps borné (s) */
  t: number
  dt: number
  frame: LocalFrame
  elev: ElevationGrid
  grid: GridInfo | null
  world: WorldState | null
  /** vent du monde : direction vers laquelle il souffle (est, nord), vitesse et rafale (m/s) */
  windTo: [number, number]
  windSpeed: number
  gust: number
  /** facteur de temps du monde (1 s réelle = timeScale s simulées), borné pour l'affichage */
  timeScale: number
  /** échelle visuelle des effets (dépend du zoom : lisibles de loin, sobres de près) */
  vis: number
  /** échelle des modèles 3D d'appareils */
  modelScale: number
  /** facteur pixels × w par mètre (taille perspective des sprites) */
  pxPerMeterW: number
  /** centre de la vue en coordonnées locales */
  center: [number, number]
  bearing: number
  pitch: number
  quality: QualityPreset
  reduced: boolean
  truth: boolean
}

export interface FxSystem {
  readonly object: THREE.Object3D
  update(f: FxFrame): void
  setWorld?(world: WorldState | null, f: Pick<FxFrame, "frame" | "grid">): void
  setNodes?(nodes: FireNode[]): void
  dispose(): void
}
