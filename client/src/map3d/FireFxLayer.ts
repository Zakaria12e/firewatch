/**
 * Calque three.js dans MapLibre (CustomLayerInterface, rendu 3D, caméra partagée).
 *
 * Projection : matrice MapLibre (mercator → clip) × translate(origine) × scale(s, −s, s),
 * scène en mètres locaux (x est, y nord, z altitude). Chaque objet est posé à
 * l'altitude du terrain (map.queryTerrainElevation, exagération incluse) via un
 * cache échantillonné. Tous les effets sont pilotés par l'état du monde
 * (world.burning, vent, appareils, largages, sautes de feu) et par les paquets reçus.
 */
import * as THREE from "three"
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap, MapSourceDataEvent } from "maplibre-gl"
import type { FireNode, WorldState, Weather } from "@/types"
import { packetBus } from "@/lib/packetBus"
import { LocalFrame, gridInfo, windTo, type GridInfo } from "./frame"
import { ElevationGrid } from "./elevation"
import { QUALITY_PRESETS, type EffectsQuality } from "./quality"
import type { FxFrame, FxSystem } from "./fxTypes"
import { FireSystem } from "./fx/fire"
import { SmokeSystem } from "./fx/smoke"
import { WindSystem } from "./fx/wind"
import { SkySystem } from "./fx/sky"
import { SpotSystem } from "./fx/spots"
import { DeviceSystem } from "./fx/devices"
import { PacketSystem } from "./fx/packets"
import { IgnitionSystem, type IgnitionPreview } from "./fx/ignition"

export const FX_LAYER_ID = "fw-three"

export interface FxCallbacks {
  /** hauteur à l'écran (px CSS) du haut de chaque modèle au-dessus de son point au sol */
  onLabelOffsets?: (offsets: Map<string, number>) => void
  /** images par seconde mesurées (une fois par seconde) */
  onFps?: (fps: number) => void
}

export class FireFxLayer implements CustomLayerInterface {
  readonly id = FX_LAYER_ID
  readonly type = "custom" as const
  readonly renderingMode = "3d" as const

  private map: MapLibreMap | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private frame = new LocalFrame()
  private elev = new ElevationGrid(this.frame, 5200, 4600, 75)
  private systems: FxSystem[] = []
  private devices: DeviceSystem | null = null
  private packets: PacketSystem | null = null
  private ignition: IgnitionSystem | null = null
  private ignitionPreview: IgnitionPreview | null = null
  private unsubPackets: (() => void) | null = null

  private world: WorldState | null = null
  private grid: GridInfo | null = null
  private nodes: FireNode[] = []
  private weather: Weather | null = null
  private quality: EffectsQuality
  private truth = true
  private active = true
  private reduced = false
  private callbacks: FxCallbacks

  private t0 = performance.now()
  private last = 0
  private fpsFrames = 0
  private fpsSince = performance.now()
  private lastOffsets = new Map<string, number>()
  private matrix = new THREE.Matrix4()
  private local = new THREE.Matrix4()
  private tmp = new THREE.Vector4()
  private onTerrain = () => this.elev.invalidate()

  constructor(quality: EffectsQuality, callbacks: FxCallbacks = {}) {
    this.quality = quality
    this.callbacks = callbacks
    const hemi = new THREE.HemisphereLight(0xdfe6ee, 0x3a2a20, 1.7)
    const sun = new THREE.DirectionalLight(0xfff1e0, 1.6)
    sun.position.set(0.5, -0.6, 1)
    this.scene.add(hemi, sun)
  }

  // ------------------------------------------------------------------ cycle de vie
  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true })
    this.renderer.autoClear = false
    this.buildSystems()
    this.unsubPackets = packetBus.on((e) => this.packets?.push(e))
    map.on("sourcedata", this.onSourceData)
    map.on("terrain", this.onTerrain)
    this.elev.invalidate()
  }

  onRemove() {
    this.map?.off("sourcedata", this.onSourceData)
    this.map?.off("terrain", this.onTerrain)
    this.unsubPackets?.()
    this.unsubPackets = null
    this.disposeSystems()
    this.renderer?.dispose()
    this.renderer = null
    this.map = null
  }

  private onSourceData = (e: MapSourceDataEvent) => {
    if (e.sourceId === "terrain-dem" && e.isSourceLoaded) this.elev.invalidate()
  }

  private buildSystems() {
    const q = QUALITY_PRESETS[this.quality]
    this.devices = new DeviceSystem()
    this.packets = new PacketSystem(this.devices)
    this.ignition = new IgnitionSystem()
    this.ignition.setPreview(this.ignitionPreview)
    this.systems = [
      new WindSystem(q.wind),
      this.devices,
      new FireSystem(q.fire, q.embers),
      new SmokeSystem(q.smoke),
      new SpotSystem(),
      new SkySystem(q.water, q.rain),
      this.packets,
      this.ignition,
    ]
    for (const s of this.systems) this.scene.add(s.object)
    this.pushWorld()
    this.devices.setNodes(this.nodes)
  }

  private disposeSystems() {
    for (const s of this.systems) {
      this.scene.remove(s.object)
      s.dispose()
    }
    this.systems = []
    this.devices = null
    this.packets = null
    this.ignition = null
  }

  // ------------------------------------------------------------------ données
  setWorld(world: WorldState | null) {
    this.world = world
    this.grid = gridInfo(world)
    this.pushWorld()
  }

  private pushWorld() {
    for (const s of this.systems) s.setWorld?.(this.world, { frame: this.frame, grid: this.grid })
  }

  setNodes(nodes: FireNode[]) {
    this.nodes = nodes
    this.devices?.setNodes(nodes)
  }

  /** Météo de repli (mesurée / Open-Meteo) quand le simulateur n'est pas connecté. */
  setWeather(w: Weather | null) {
    this.weather = w
  }

  setTruthVisible(v: boolean) {
    this.truth = v
  }

  setQuality(q: EffectsQuality) {
    if (q === this.quality) return
    this.quality = q
    if (this.renderer) {
      this.disposeSystems()
      this.buildSystems()
    }
  }

  /** Rappels vers l'interface (étiquettes, FPS) : branchés après le montage. */
  setCallbacks(cb: FxCallbacks) {
    this.callbacks = cb
    this.lastOffsets = new Map()
  }

  setReducedMotion(v: boolean) {
    this.reduced = v
  }

  /** Carte masquée par une page : on arrête l'animation continue. */
  setActive(v: boolean) {
    this.active = v
    if (v) this.map?.triggerRepaint()
  }

  /** Glisser-déposer : le modèle suit l'étiquette avant la confirmation du monde. */
  moveDevice(id: string, lon: number, lat: number) {
    this.devices?.setOverride(id, lon, lat)
    this.map?.triggerRepaint()
  }

  /** Point de départ d'un feu en attente (balise 3D), null pour l'effacer. */
  setIgnition(p: IgnitionPreview | null) {
    const moved = !p || !this.ignitionPreview || p.points !== this.ignitionPreview.points
    this.ignitionPreview = p
    if (moved) this.ignition?.setPreview(p)
    else this.ignition?.setProgress(p!.progress, p!.held)
    this.map?.triggerRepaint()
  }

  // ------------------------------------------------------------------ rendu
  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const map = this.map
    const renderer = this.renderer
    if (!map || !renderer) return

    const now = performance.now()
    const t = (now - this.t0) / 1000
    const dt = this.last ? Math.min(0.05, Math.max(0, t - this.last)) : 1 / 60
    this.last = t

    this.elev.step(map)

    // Matrice locale (mètres) → clip
    const o = this.frame.origin
    const s = this.frame.scale
    this.local.makeTranslation(o.x, o.y, 0).scale(new THREE.Vector3(s, -s, s))
    this.matrix.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(this.local)
    this.camera.projectionMatrix.copy(this.matrix)
    this.camera.projectionMatrixInverse.copy(this.matrix).invert()

    // Centre de vue, échelle visuelle et facteur de taille des sprites
    const c = map.getCenter()
    const center = this.frame.toLocal(c.lng, c.lat)
    const zoom = map.getZoom()
    const mpp = (78271.517 * Math.cos((c.lat * Math.PI) / 180)) / Math.pow(2, zoom)
    const vis = Math.min(1.7, Math.max(0.35, Math.pow(mpp / 6, 0.7)))
    const modelScale = Math.min(90, Math.max(2, 7 * Math.pow(mpp, 0.85)))
    const bearing = map.getBearing()
    const pitch = map.getPitch()
    const zc = this.elev.at(center[0], center[1])
    const br = (bearing * Math.PI) / 180
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight
    const p0 = this.project(center[0], center[1], zc, W, H)
    const p1 = this.project(center[0] + Math.cos(br), center[1] - Math.sin(br), zc, W, H)
    const pxPerMeterW = p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * p0[2] : 1

    const w = this.world?.weather ?? this.weather
    const from = w?.wind_dir ?? 0
    const ts = this.world ? (this.world.timeScale ?? 15) * (this.world.speed ?? 1) : 15
    const f: FxFrame = {
      t, dt, frame: this.frame, elev: this.elev, grid: this.grid, world: this.world,
      windTo: windTo(from), windSpeed: w?.wind_speed ?? 0,
      gust: (this.world?.weather?.gust ?? (w?.wind_speed ?? 0) * 1.3),
      timeScale: Math.min(40, Math.max(1, ts)),
      vis, modelScale, pxPerMeterW, center, bearing, pitch,
      quality: QUALITY_PRESETS[this.quality], reduced: this.reduced, truth: this.truth,
    }
    for (const sys of this.systems) sys.update(f)

    renderer.resetState()
    renderer.setViewport(0, 0, W, H)
    renderer.render(this.scene, this.camera)

    this.updateLabels(f, W, H)
    this.countFps(now)
    if (this.active) map.triggerRepaint()
  }

  /** Projection d'un point local → [x px, y px, w] (pixels du tampon de dessin). */
  private project(x: number, y: number, z: number, W: number, H: number): [number, number, number] | null {
    const v = this.tmp.set(x, y, z, 1).applyMatrix4(this.matrix)
    if (v.w <= 0) return null
    return [((v.x / v.w) * 0.5 + 0.5) * W, ((-v.y / v.w) * 0.5 + 0.5) * H, v.w]
  }

  /** Décalage vertical des étiquettes DOM : haut du modèle projeté à l'écran. */
  private updateLabels(f: FxFrame, W: number, H: number) {
    const cb = this.callbacks.onLabelOffsets
    const devices = this.devices
    if (!cb || !devices) return
    const dpr = window.devicePixelRatio || 1
    const out = new Map<string, number>()
    let changed = false
    for (const d of devices.devices) {
      const base = devices.base(d.id, f)
      const top = devices.anchor(d.id, f)
      if (!base || !top) continue
      const a = this.project(base[0], base[1], base[2], W, H)
      const b = this.project(top[0], top[1], top[2], W, H)
      const px = a && b ? Math.max(0, (a[1] - b[1]) / dpr) : 0
      out.set(d.id, px)
      const prev = this.lastOffsets.get(d.id)
      if (prev === undefined || Math.abs(prev - px) > 0.6) changed = true
    }
    if (out.size !== this.lastOffsets.size) changed = true
    if (changed) {
      this.lastOffsets = out
      cb(out)
    }
  }

  private countFps(now: number) {
    this.fpsFrames++
    if (now - this.fpsSince >= 1000) {
      this.callbacks.onFps?.(Math.round((this.fpsFrames * 1000) / (now - this.fpsSince)))
      this.fpsFrames = 0
      this.fpsSince = now
    }
  }
}
