import { useRef, useCallback, useMemo, useEffect, useState } from "react"
import ReactMap, { Marker, Source, Layer, type MapRef } from "react-map-gl/maplibre"
import type { Map as MapLibreMap, MapLayerMouseEvent, Marker as MarkerInstance } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import type { FireWatchState, WorldState, AlertLevelPayload, FireNode, WorldDevice } from "@/types"
import type { Feature, FeatureCollection, Polygon } from "geojson"
import { Mountain, Eye, EyeOff, X, Battery, Signal, Plus, Minus, Navigation } from "lucide-react"
import { C, alpha, healthColor, healthLabel, kindMeta } from "@/lib/palette"
import { getReadings } from "@/lib/deviceReadings"
import { FireFxLayer, FX_LAYER_ID } from "@/map3d/FireFxLayer"
import { GroundOverlay, GROUND_LAYER } from "@/map3d/groundOverlay"
import { useEffectsQuality, useReducedMotion, useShowFps } from "@/map3d/quality"
import { GATEWAY_RANGE_M } from "@/map3d/fx/devices"

// ---------------------------------------------------------------------------
// Constantes de tuiles
// ---------------------------------------------------------------------------
const TERRARIUM      = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"]
const ESRI_SATELLITE = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"]
const EOX_CLOUDLESS  = ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"]
const OPENTOPO       = ["https://tile.opentopomap.org/{z}/{x}/{y}.png"]
// CARTO requiert une API key depuis 2024 → OSM en fantôme sur fond noir (look "ops nocturne")
const OSM_BASE       = [
  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
]

const TERRAIN_EXAGGERATION = 2.2

type Basemap = "satellite" | "topo" | "dark"

// ---------------------------------------------------------------------------
// Constructeur de style MapLibre complet
// ---------------------------------------------------------------------------
function buildStyle(basemap: Basemap, esriOk: boolean): object {
  const baseSource = basemap === "satellite"
    ? { type: "raster", tiles: esriOk ? ESRI_SATELLITE : EOX_CLOUDLESS, tileSize: 256,
        attribution: esriOk ? "Imagerie © Esri, Maxar, Earthstar Geographics" : "© EOX Sentinel-2",
        // Zoom max réel de l'imagerie sur le Rif : Esri renvoie une tuile grise « Map data not
        // yet available » au zoom 19, EOX (Sentinel-2, 10 m) n'apporte rien après 15.
        // Au-delà, MapLibre agrandit la dernière tuile disponible au lieu de l'afficher en gris.
        maxzoom: esriOk ? 18 : 15 }
    : basemap === "topo"
    ? { type: "raster", tiles: OPENTOPO, tileSize: 256, attribution: "© OpenTopoMap", maxzoom: 17 }
    // Dark : OSM en fantôme sur fond #030303 → "ops nocturne" sans API key
    : { type: "raster", tiles: OSM_BASE, tileSize: 256, attribution: "© OpenStreetMap contributors", maxzoom: 19 }

  const bgColor = basemap === "satellite" ? "#000000" : basemap === "topo" ? "#1a1a1a" : "#030303"

  return {
    version: 8,
    sources: {
      basemap: baseSource,
      "terrain-dem":   { type: "raster-dem", tiles: TERRARIUM, tileSize: 256, encoding: "terrarium", maxzoom: 14 },
      "hillshade-dem": { type: "raster-dem", tiles: TERRARIUM, tileSize: 256, encoding: "terrarium", maxzoom: 14 },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": bgColor } },
      { id: "basemap", type: "raster", source: "basemap",
        // Dark : opacité fantôme pour garder les contours géographiques sans fond clair
        paint: { "raster-opacity": basemap === "dark" ? 0.07 : basemap === "topo" ? 0.90 : 1 } },
      { id: "hillshade", type: "hillshade", source: "hillshade-dem",
        paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#ffffff" } },
    ],
    // Ciel et brume d'horizon (spécification MapLibre « sky »)
    sky: {
      "sky-color": "#000000",
      "horizon-color": "#1a0c06",
      "fog-color": "#0d0604",
      "fog-ground-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "sky-horizon-blend": 0.5,
      "atmosphere-blend": 0.4,
    },
  }
}

// ---------------------------------------------------------------------------
// Utilitaires GeoJSON
// ---------------------------------------------------------------------------
function circlePolygon(lat: number, lon: number, radiusM: number, steps = 48): Feature<Polygon> {
  const latR = radiusM / 111_320
  const lonR = radiusM / (111_320 * Math.cos(lat * Math.PI / 180))
  const coords: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    coords.push([lon + lonR * Math.sin(a), lat + latR * Math.cos(a)])
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} }
}

function conePolygon(lat: number, lon: number, azDeg: number, rangeM = 800, halfDeg = 55): Feature<Polygon> {
  const latR = rangeM / 111_320
  const lonR = rangeM / (111_320 * Math.cos(lat * Math.PI / 180))
  const az = azDeg * Math.PI / 180
  const half = halfDeg * Math.PI / 180
  const coords: [number, number][] = [[lon, lat]]
  const steps = Math.ceil((2 * half) / 0.07)
  for (let i = 0; i <= steps; i++) {
    const a = az - half + (i / steps) * 2 * half
    coords.push([lon + lonR * Math.sin(a), lat + latR * Math.cos(a)])
  }
  coords.push([lon, lat])
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} }
}

function zonesGeoJSON(zones: { minutes: number; polygon: [number, number][] }[] | undefined): FeatureCollection {
  if (!zones?.length) return { type: "FeatureCollection", features: [] }
  return {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [z.polygon.map(([lat, lon]) => [lon, lat] as [number, number])] },
      properties: { minutes: z.minutes },
    })),
  }
}

function uncertaintyGeoJSON(pos: { lat: number; lon: number; uncertainty_m?: number } | undefined): FeatureCollection {
  if (!pos) return { type: "FeatureCollection", features: [] }
  return { type: "FeatureCollection", features: [circlePolygon(pos.lat, pos.lon, pos.uncertainty_m ?? 500)] }
}

function gatewayGeoJSON(devices: WorldDevice[]): FeatureCollection {
  const gws = devices.filter((d) => d.kind === "gateway" && d.fault !== "offline")
  return {
    type: "FeatureCollection",
    features: gws.map((gw) => ({ ...circlePolygon(gw.lat, gw.lon, GATEWAY_RANGE_M, 72), properties: { id: gw.id } })),
  }
}

function cameraGeoJSON(devices: WorldDevice[]): FeatureCollection {
  const cams = devices.filter((d) => d.kind === "thermal" && d.fault !== "offline")
  return {
    type: "FeatureCollection",
    features: cams.map((c) => ({ ...conePolygon(c.lat, c.lon, c.azimuth ?? 0), properties: { id: c.id } })),
  }
}

/** Liens radio : appareil → passerelle qui a relayé son dernier paquet (sinon la plus proche). */
function radioLinksGeoJSON(devices: WorldDevice[], nodeById: Map<string, FireNode>): FeatureCollection {
  const gws = devices.filter((d) => d.kind === "gateway")
  if (!gws.length) return { type: "FeatureCollection", features: [] }
  const gwById = new Map(gws.map((g) => [g.id, g]))
  const features: Feature[] = []
  for (const dev of devices) {
    if (dev.kind === "gateway") continue
    const node = nodeById.get(dev.id)
    let gw = node?.gw ? gwById.get(node.gw) : undefined
    if (!gw) {
      gw = gws.reduce((best, g) =>
        Math.hypot(g.lat - dev.lat, g.lon - dev.lon) < Math.hypot(best.lat - dev.lat, best.lon - dev.lon) ? g : best)
    }
    const rssi = node?.readings?.rssi
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[dev.lon, dev.lat], [gw.lon, gw.lat]] },
      properties: { rssi: rssi ?? -200, live: node?.online && node.gw ? 1 : 0 },
    })
  }
  return { type: "FeatureCollection", features }
}

/** État affiché : santé calculée par le serveur, sinon panne injectée dans le monde. */
function deviceState(device: WorldDevice, node?: FireNode): string {
  if (node) return node.online ? (node.health ?? "ok") : "hors_ligne"
  return device.fault === "offline" ? "hors_ligne" : "ok"
}

function DeviceTooltip({
  device, node, onClose, x, y,
}: {
  device: WorldDevice
  node?: FireNode
  onClose: () => void
  x: number
  y: number
}) {
  const meta = kindMeta(device.kind)
  const Icon = meta.Icon
  const fault = deviceState(device, node)
  const faultColor = healthColor(fault)
  const bat = node?.readings?.bat
  const rssi = node?.readings?.rssi
  const snr = node?.readings?.snr
  const readings = node ? getReadings(device.kind, node.readings) : []
  const ts = node?.ts ? new Date(node.ts) : null
  const timeStr = ts ? `${ts.getHours().toString().padStart(2, "0")}:${ts.getMinutes().toString().padStart(2, "0")}:${ts.getSeconds().toString().padStart(2, "0")}` : null

  const W = 232
  const H = 300
  const cx = Math.max(12, Math.min(x - W / 2, window.innerWidth - W - 12))
  const cy = Math.max(72, Math.min(y - H - 16, window.innerHeight - H - 12))

  return (
    <div
      className="fixed z-[200] flex flex-col overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      style={{
        left: cx, top: cy, width: W,
        background: "rgba(12,12,12,0.92)",
        backdropFilter: "blur(32px) saturate(160%)",
        WebkitBackdropFilter: "blur(32px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        boxShadow: "0 8px 40px rgba(0,0,0,0.50)",
        animation: "tooltipIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both",
      }}
    >
      {/* En-tête */}
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.08)" }}>
          <Icon className="w-5 h-5" style={{ color: C.text }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-white/90 leading-none truncate" style={{ letterSpacing: "-0.374px" }}>
            {meta.label}
          </div>
          <div className="text-[10px] text-white/35 font-mono mt-0.5">{meta.model}</div>
          <div className="text-[9px] text-white/25 font-mono mt-0.5 truncate">{device.id}</div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full shrink-0 transition-colors"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <X className="w-3.5 h-3.5 text-white/50" />
        </button>
      </div>

      <div className="px-4 py-3 flex flex-col gap-2.5">
        {/* Status + batterie */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="px-2 py-0.5 text-[10px] font-medium rounded-full"
            style={{ background: `${faultColor}18`, color: faultColor, border: `1px solid ${faultColor}28` }}
          >
            {healthLabel(fault)}
          </span>
          {bat !== undefined && (
            <div className="flex items-center gap-1.5">
              <Battery className="w-3 h-3" style={{ color: bat < 15 ? C.red : C.text3 }} />
              <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.10)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${bat}%`,
                    background: bat < 15 ? C.red : C.fire,
                  }}
                />
              </div>
              <span className="text-[9px] tabular" style={{ color: "rgba(235,235,245,0.4)" }}>{bat.toFixed(0)}%</span>
            </div>
          )}
        </div>

        {/* Mesures */}
        {readings.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {readings.map((m) => (
              <div key={m.label}>
                <div className="text-[9px] text-white/35">{m.label}</div>
                <div className="text-[12px] font-semibold tabular text-white/85 leading-tight">
                  {m.value}<span className="text-[9px] text-white/35 font-normal ml-0.5">{m.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* RSSI / SNR */}
        {(rssi !== undefined || snr !== undefined) && (
          <div className="flex items-center gap-3 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <Signal className="w-3 h-3 text-white/30" />
            {rssi !== undefined && (
              <span className="text-[10px] tabular" style={{ color: "rgba(235,235,245,0.4)" }}>
                RSSI <span className="text-white/60">{rssi.toFixed(0)}</span> dBm
              </span>
            )}
            {snr !== undefined && (
              <span className="text-[10px] tabular" style={{ color: "rgba(235,235,245,0.4)" }}>
                SNR <span className="text-white/60">{snr.toFixed(1)}</span> dB
              </span>
            )}
            {node?.gw && (
              <span className="text-[10px] font-mono ml-auto" style={{ color: "rgba(235,235,245,0.4)" }}>{node.gw}</span>
            )}
          </div>
        )}

        {/* Dernière mise à jour */}
        {timeStr && (
          <div className="text-[9px] tabular" style={{ color: "rgba(235,235,245,0.25)" }}>
            Dernière mesure : {timeStr}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Étiquette DOM au-dessus du modèle 3D (ID + état), glissable
// ---------------------------------------------------------------------------
function DeviceLabel({ device, node, onClick }: {
  device: WorldDevice
  node?: FireNode
  onClick?: (e: React.MouseEvent) => void
}) {
  const state = deviceState(device, node)
  const dim = state === "hors_ligne"
  const sounding = device.siren || node?.siren
  return (
    <div
      onClick={onClick}
      title={`${kindMeta(device.kind).label} ${device.id} · ${healthLabel(state)}`}
      className="flex items-center gap-1 select-none cursor-grab active:cursor-grabbing"
      style={{
        padding: "2px 6px 2px 5px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.62)",
        border: `1px solid ${sounding ? "rgba(224,38,14,0.7)" : "rgba(255,255,255,0.14)"}`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        opacity: dim ? 0.55 : 1,
        whiteSpace: "nowrap",
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: healthColor(state) }} />
      <span className="text-[9px] font-mono font-semibold tabular" style={{ color: "rgba(255,255,255,0.88)", letterSpacing: "0.02em" }}>
        {device.id}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------
interface Props {
  state: FireWatchState
  world: WorldState | null
  alertLevel: AlertLevelPayload
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
  /** false quand une page couvre la carte : animations suspendues */
  active?: boolean
  /** « Voir sur la carte » : vol vers un appareil (key change à chaque demande) */
  focus?: { lat: number; lon: number; key: number } | null
}

export function FireMap({ state, world, alertLevel, sendCommand, active = true, focus = null }: Props) {
  const mapRef        = useRef<MapRef>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const is3DRef       = useRef(true)
  const markersRef    = useRef(new Map<string, MarkerInstance>())
  const compassRef    = useRef<HTMLSpanElement>(null)
  const offsetsRef    = useRef(new Map<string, number>())

  const quality       = useEffectsQuality()
  const reducedMotion = useReducedMotion()
  const showFps       = useShowFps()
  const [fps, setFps] = useState<number | null>(null)

  // Calque three.js + sol drapé : créés une fois, réinstallés à chaque changement de style
  const [fx] = useState(() => new FireFxLayer(quality))
  const [ground] = useState(() => new GroundOverlay())
  useEffect(() => {
    fx.setCallbacks({
      onLabelOffsets: (offsets) => {
        offsetsRef.current = offsets
        for (const [id, px] of offsets) markersRef.current.get(id)?.setOffset([0, -Math.round(px) - 4])
      },
      onFps: (v) => setFps(v),
    })
  }, [fx])

  const [basemap, setBasemap]     = useState<Basemap>("satellite")
  const [pressedBtn, setPressedBtn] = useState<string | null>(null)

  const pressSpring = (key: string, action: () => void) => {
    action()
    setPressedBtn(key)
    setTimeout(() => setPressedBtn(null), 60)
  }
  const [is3D, setIs3D]             = useState(true)
  const [showTruth, setShowTruth]   = useState(true)
  const [esriOk, setEsriOk]         = useState(true)
  const [mapLoaded, setMapLoaded]   = useState(false)
  const [selectedMarker, setSelectedMarker] = useState<{
    device: WorldDevice; node?: FireNode; x: number; y: number
  } | null>(null)
  // Déplacements en attente de l'écho du simulateur (glisser-déposer optimiste)
  const [moves, setMoves] = useState<Record<string, { lon: number; lat: number }>>({})
  const [drag, setDrag] = useState<{ id: string; lon: number; lat: number } | null>(null)

  const prevConfirmedRef = useRef(false)

  // -------------------------------------------------------------------------
  // Style de fond (reconstruit seulement si basemap ou esriOk change)
  // -------------------------------------------------------------------------
  const mapStyle = useMemo(() => buildStyle(basemap, esriOk), [basemap, esriOk])

  const applyTerrain = useCallback((map: MapLibreMap, enable: boolean) => {
    try {
      map.setTerrain(enable ? { source: "terrain-dem", exaggeration: TERRAIN_EXAGGERATION } : null)
    } catch { /* style pas encore prêt */ }
  }, [])

  /**
   * (Ré)installe les calques impératifs (three.js, sol drapé) ; idempotent.
   * Le calque 3D doit rester le dernier : avec le relief, un calque drapé placé
   * après lui serait redessiné par-dessus les effets.
   */
  const ensureFxLayers = useCallback((map: MapLibreMap) => {
    // isStyleLoaded() reste faux tant que des tuiles chargent : on tente, le style
    // lève une exception s'il n'est pas encore analysé (prochain styledata)
    try {
      ground.attach(map, "gateways-fill")
      if (!map.getLayer(FX_LAYER_ID)) map.addLayer(fx)
      const order = map.getLayersOrder()
      const gi = order.indexOf(GROUND_LAYER)
      const bi = order.indexOf("gateways-fill")
      if (gi >= 0 && bi >= 0 && gi > bi) map.moveLayer(GROUND_LAYER, "gateways-fill")
      if (order.length && order[order.length - 1] !== FX_LAYER_ID && map.getLayer(FX_LAYER_ID)) map.moveLayer(FX_LAYER_ID)
    } catch { /* style en cours de chargement */ }
  }, [fx, ground])

  // -------------------------------------------------------------------------
  // Chargement initial + listener style.load persistant
  // -------------------------------------------------------------------------
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    if (!map) return

    setMapLoaded(true)
    applyTerrain(map, is3DRef.current)
    ensureFxLayers(map)

    // Réappliquer le terrain et les calques à chaque changement de fond de carte
    map.on("style.load", () => {
      applyTerrain(map, is3DRef.current)
      ensureFxLayers(map)
    })
    map.on("styledata", () => ensureFxLayers(map))

    // Fallback Esri → EOX si erreur 403/CORS
    map.on("error", (e) => {
      if (typeof e?.error?.message === "string" && e.error.message.includes("arcgisonline")) {
        setEsriOk(false)
      }
    })
  }, [applyTerrain, ensureFxLayers])

  // -------------------------------------------------------------------------
  // Données → calque 3D (aucune animation sans donnée du monde)
  // -------------------------------------------------------------------------
  useEffect(() => {
    fx.setWorld(world)
    ground.update(world)
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    if (map) ensureFxLayers(map)
  }, [world, ensureFxLayers, fx, ground])
  useEffect(() => { fx.setNodes(state.nodes) }, [fx, state.nodes])
  useEffect(() => { fx.setWeather(state.weather) }, [fx, state.weather])
  useEffect(() => {
    fx.setTruthVisible(showTruth)
    ground.setVisible(showTruth)
  }, [fx, ground, showTruth])
  useEffect(() => { fx.setQuality(quality) }, [fx, quality])
  useEffect(() => { fx.setReducedMotion(reducedMotion) }, [fx, reducedMotion])
  useEffect(() => { fx.setActive(active) }, [fx, active])
  useEffect(() => () => ground.detach(), [ground])

  // -------------------------------------------------------------------------
  // 2D / 3D toggle — animation 1,2 s, désactive le terrain en 2D
  // -------------------------------------------------------------------------
  const handleToggle3D = useCallback(() => {
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    if (!map) return
    const next = !is3DRef.current
    is3DRef.current = next
    setIs3D(next)
    applyTerrain(map, next)
    const duration = reducedMotion ? 0 : 1200
    map.easeTo(next
      ? { pitch: 72, bearing: -30, duration }
      : { pitch: 0,  bearing: 0,   duration }
    )
  }, [applyTerrain, reducedMotion])

  // -------------------------------------------------------------------------
  // Boussole : suit le cap de la carte sans re-rendu React
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded) return
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    if (!map) return
    const onRotate = () => {
      if (compassRef.current) compassRef.current.style.transform = `rotate(${-map.getBearing()}deg)`
    }
    onRotate()
    map.on("rotate", onRotate)
    return () => { map.off("rotate", onRotate) }
  }, [mapLoaded])

  // -------------------------------------------------------------------------
  // « Voir sur la carte » depuis la page Appareils
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!focus || !mapLoaded) return
    mapRef.current?.flyTo({
      center: [focus.lon, focus.lat],
      zoom: 15.2,
      pitch: is3DRef.current ? 62 : 0,
      duration: reducedMotion ? 0 : 1800,
      essential: true,
    })
  }, [focus, mapLoaded, reducedMotion])

  // -------------------------------------------------------------------------
  // flyTo cinématique à la confirmation du feu
  // -------------------------------------------------------------------------
  useEffect(() => {
    const confirmed = alertLevel.level === "feu_confirmé"
    if (confirmed && !prevConfirmedRef.current && state.incident?.position) {
      const { lat, lon } = state.incident.position
      const wind = alertLevel.wind
      // Vue perpendiculaire au vent (le panache et le front se couchent à l'écran),
      // du côté où le relief derrière la caméra est le plus bas (crête masquante évitée)
      let bearing = -25
      if (wind) {
        const map = mapRef.current?.getMap() as MapLibreMap | undefined
        const behind = (b: number) => {
          const r = (b * Math.PI) / 180, d = 2200
          const pLat = lat - (d * Math.cos(r)) / 111_320
          const pLon = lon - (d * Math.sin(r)) / (111_320 * Math.cos((lat * Math.PI) / 180))
          return map?.queryTerrainElevation([pLon, pLat]) ?? 0
        }
        const a = (wind.from + 90) % 360, b = (wind.from + 270) % 360
        bearing = behind(a) <= behind(b) ? a : b
      }
      mapRef.current?.flyTo({
        center: [lon, lat],
        zoom: 14,
        pitch: 60,
        bearing,
        duration: reducedMotion ? 0 : 2500,
        essential: true,
      })
    }
    prevConfirmedRef.current = confirmed
  }, [alertLevel.level, alertLevel.wind, state.incident?.position, reducedMotion])

  // -------------------------------------------------------------------------
  // Rotation lente automatique (s'arrête dès interaction, jamais pendant un vol)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || reducedMotion || !active) return
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    const container = containerRef.current
    if (!map || !container) return

    let frameId: number
    let lastInteraction = Date.now()

    const onInteract = () => { lastInteraction = Date.now() }
    container.addEventListener("mousedown", onInteract, { passive: true })
    container.addEventListener("touchstart", onInteract, { passive: true })
    map.on("wheel", onInteract)
    map.on("movestart", onInteract)

    const tick = () => {
      // setBearing interrompt les animations en cours (flyTo, easeTo) : on attend qu'elles finissent
      if (is3DRef.current && !map.isMoving() && Date.now() - lastInteraction > 5000) {
        map.setBearing((map.getBearing() + 0.015) % 360)
        lastInteraction = Date.now() - 5001
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameId)
      container.removeEventListener("mousedown", onInteract)
      container.removeEventListener("touchstart", onInteract)
      map.off("wheel", onInteract)
      map.off("movestart", onInteract)
    }
  }, [mapLoaded, reducedMotion, active])

  // -------------------------------------------------------------------------
  // GeoJSON (recalculé uniquement si les données changent)
  // -------------------------------------------------------------------------
  const nodeById = useMemo(() => {
    const m = new Map<string, FireNode>()
    state.nodes.forEach((n) => m.set(n.id, n))
    return m
  }, [state.nodes])

  // Appareils affichés : positions glissées en attente de confirmation
  const worldDevices = useMemo(() => {
    return (world?.devices ?? []).map((d) => {
      if (drag?.id === d.id) return { ...d, lon: drag.lon, lat: drag.lat }
      const mv = moves[d.id]
      if (!mv) return d
      const confirmed = Math.abs(mv.lon - d.lon) < 2e-5 && Math.abs(mv.lat - d.lat) < 2e-5
      return confirmed ? d : { ...d, lon: mv.lon, lat: mv.lat }
    })
  }, [world?.devices, moves, drag])

  const zonesGJ       = useMemo(() => zonesGeoJSON(state.incident?.zones),   [state.incident?.zones])
  const uncertaintyGJ = useMemo(() => uncertaintyGeoJSON(state.incident?.position), [state.incident?.position])
  const gatewayGJ     = useMemo(() => gatewayGeoJSON(worldDevices),        [worldDevices])
  const cameraGJ      = useMemo(() => cameraGeoJSON(worldDevices),         [worldDevices])
  const radioGJ       = useMemo(() => radioLinksGeoJSON(worldDevices, nodeById), [worldDevices, nodeById])

  // -------------------------------------------------------------------------
  // Handlers drag-and-drop depuis la palette
  // -------------------------------------------------------------------------
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const kind = e.dataTransfer.getData("kind")
    if (!kind || !mapRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const lngLat = mapRef.current.unproject([e.clientX - rect.left, e.clientY - rect.top])
    if (kind === "__fire__") {
      sendCommand("fire_start", { lat: lngLat.lat, lon: lngLat.lng })
    } else if (kind === "__water__") {
      sendCommand("water", { lat: lngLat.lat, lon: lngLat.lng, radius: 150 })
    } else {
      sendCommand("device_add", { kind, lat: lngLat.lat, lon: lngLat.lng })
    }
  }, [sendCommand])

  const handleDblClick = useCallback((e: MapLayerMouseEvent) => {
    sendCommand("fire_start", { lat: e.lngLat.lat, lon: e.lngLat.lng })
  }, [sendCommand])

  const orphanNodes  = state.nodes.filter((n) => !worldDevices.find((d) => d.id === n.id))
  const incident     = state.incident

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => setSelectedMarker(null)}
    >
      <ReactMap
        ref={mapRef}
        mapStyle={mapStyle as never}
        initialViewState={{
          latitude:  35.14,
          longitude: -5.235,
          zoom:      12.6,
          pitch:     72,
          bearing:   -30,
        }}
        maxPitch={85}
        maxZoom={17.5}
        style={{ width: "100%", height: "100%" }}
        onLoad={handleMapLoad}
        onDblClick={handleDblClick}
      >
        {/* ── Couverture passerelles ── */}
        <Source id="gateways" type="geojson" data={gatewayGJ}>
          <Layer id="gateways-fill" type="fill"
            paint={{ "fill-color": "#FF5A1F", "fill-opacity": 0.018 }} />
          <Layer id="gateways-outline" type="line"
            paint={{ "line-color": "#FF5A1F", "line-opacity": 0.35, "line-width": 1, "line-dasharray": [4, 3] }} />
        </Source>

        {/* ── Cônes caméras thermiques ── */}
        <Source id="cameras" type="geojson" data={cameraGJ}>
          <Layer id="cameras-fill" type="fill"
            paint={{ "fill-color": "#FF5A1F", "fill-opacity": 0.08 }} />
          <Layer id="cameras-outline" type="line"
            paint={{ "line-color": "#FF5A1F", "line-opacity": 0.45, "line-width": 1 }} />
        </Source>

        {/* ── Liens radio capteur → passerelle (couleur selon le RSSI) ── */}
        <Source id="radio" type="geojson" data={radioGJ}>
          <Layer id="radio-lines" type="line"
            paint={{
              "line-color": ["step", ["get", "rssi"], "#6B2510", -118, "#E0260E", -105, "#FF5A1F"],
              "line-opacity": ["case", ["==", ["get", "live"], 1], 0.45, 0.15],
              "line-width": 0.8,
              "line-dasharray": [2, 2],
            }} />
        </Source>

        {/* ── Zones de propagation 15/30/60 min ── */}
        <Source id="zones" type="geojson" data={zonesGJ}>
          <Layer id="zones-fill" type="fill"
            paint={{
              "fill-color": ["interpolate", ["linear"], ["get", "minutes"],
                15, "#E0260E", 30, "#FF5A1F", 60, "#6B2510"],
              "fill-opacity": 0.12,
            }} />
          <Layer id="zones-outline" type="line"
            paint={{
              "line-color": ["interpolate", ["linear"], ["get", "minutes"],
                15, "#E0260E", 30, "#FF5A1F", 60, "#6B2510"],
              "line-width": 1.5,
              "line-dasharray": [4, 3],
            }} />
        </Source>

        {/* ── Cercle d'incertitude du foyer estimé ── */}
        <Source id="uncertainty" type="geojson" data={uncertaintyGJ}>
          <Layer id="uncertainty-fill" type="fill"
            paint={{ "fill-color": "#FF5A1F", "fill-opacity": 0.06 }} />
          <Layer id="uncertainty-outline" type="line"
            paint={{ "line-color": "#FF5A1F", "line-opacity": 0.7, "line-width": 1.5, "line-dasharray": [3, 2] }} />
        </Source>

        {/* ── Étiquettes des modèles 3D (glissables) ── */}
        {worldDevices.map((device) => {
          const node = nodeById.get(device.id)
          return (
            <Marker
              key={device.id}
              ref={(m) => {
                if (m) {
                  markersRef.current.set(device.id, m)
                  const px = offsetsRef.current.get(device.id)
                  if (px !== undefined) m.setOffset([0, -Math.round(px) - 4])
                } else markersRef.current.delete(device.id)
              }}
              latitude={device.lat}
              longitude={device.lon}
              anchor="bottom"
              draggable
              onDrag={(e) => {
                fx.moveDevice(device.id, e.lngLat.lng, e.lngLat.lat)
                setDrag({ id: device.id, lon: e.lngLat.lng, lat: e.lngLat.lat })
              }}
              onDragEnd={(e) => {
                const { lng, lat } = e.lngLat
                fx.moveDevice(device.id, lng, lat)
                setDrag(null)
                setMoves((m) => ({ ...m, [device.id]: { lon: lng, lat } }))
                // sans écho du simulateur sous 4 s, on revient à la position du monde
                window.setTimeout(() => setMoves((m) => {
                  const next = { ...m }
                  delete next[device.id]
                  return next
                }), 4000)
                sendCommand("device_move", { id: device.id, lat, lon: lng })
              }}
            >
              <DeviceLabel
                device={device}
                node={node}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedMarker({ device, node, x: e.clientX, y: e.clientY })
                }}
              />
            </Marker>
          )
        })}

        {/* ── Marqueurs : nœuds CoAP non présents dans world.devices ── */}
        {orphanNodes.map((node) => (
          <Marker key={node.id} latitude={node.lat} longitude={node.lon} anchor="center">
            <div
              className={`w-2.5 h-2.5 rounded-full border border-black/60 ${node.siren ? "animate-pulse" : ""}`}
              style={{ backgroundColor: node.online ? C.ok : C.gray }}
              title={`${node.id} · T=${node.readings?.temp?.toFixed(0)}°C smoke=${node.readings?.smoke?.toFixed(0)}ppm`}
            />
          </Marker>
        ))}

        {/* ── Foyer estimé par le serveur (résultat de la détection) ── */}
        {incident?.position && (
          <Marker latitude={incident.position.lat} longitude={incident.position.lon} anchor="center">
            <div
              className="relative w-7 h-7 flex items-center justify-center pointer-events-none"
              title={`Foyer estimé ±${incident.position.uncertainty_m ?? "?"} m`}
            >
              <span className="absolute inset-0 rounded-full"
                style={{ border: `2px solid ${C.fire}`, boxShadow: `0 0 12px ${alpha(C.fire, 0.6)}`,
                  animation: incident.status === "actif" && !reducedMotion ? "fwFocus 1.4s ease-out infinite" : "none" }} />
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.fire }} />
            </div>
          </Marker>
        )}
      </ReactMap>

      {/* Tooltip appareil au clic */}
      {selectedMarker && (
        <DeviceTooltip
          device={selectedMarker.device}
          node={nodeById.get(selectedMarker.device.id) ?? selectedMarker.node}
          onClose={() => setSelectedMarker(null)}
          x={selectedMarker.x}
          y={selectedMarker.y}
        />
      )}

      {/* ================================================================
          Contrôles carte – style verre iOS
      ================================================================ */}

      {/* Barre centré haut : basemap + 3D + terrain */}
      <div
        className="absolute flex items-center gap-0.5 px-1 py-1"
        style={{
          top: 68, left: "50%", transform: "translateX(-50%)",
          background: "rgba(14,14,14,0.72)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
        }}
      >
        {(["satellite", "topo", "dark"] as Basemap[]).map((b) => {
          const pressing = pressedBtn === b
          return (
            <button
              key={b}
              onPointerDown={() => pressSpring(b, () => setBasemap(b))}
              title={b === "satellite" ? "Satellite Esri" : b === "topo" ? "OpenTopoMap" : "OSM sombre"}
              className="px-2.5 py-1 text-[10px] rounded-[8px] font-medium"
              style={{
                background: basemap === b ? "rgba(255,255,255,0.14)" : "transparent",
                color: basemap === b ? "#ffffff" : "rgba(235,235,245,0.4)",
                transform: pressing ? "scale(0.78)" : "scale(1)",
                transition: pressing
                  ? "transform 55ms ease-in, background 0.15s ease, color 0.15s ease"
                  : "transform 480ms cubic-bezier(0.34,1.56,0.64,1), background 0.2s ease, color 0.2s ease",
              }}
            >
              {b === "satellite" ? "Satellite" : b === "topo" ? "Topo" : "Sombre"}
            </button>
          )
        })}

        <div className="w-px h-4 mx-0.5" style={{ background: "rgba(255,255,255,0.10)" }} />

        <button
          onPointerDown={() => pressSpring("3d", handleToggle3D)}
          title={is3D ? "Vue 2D" : "Vue 3D terrain"}
          className="px-2.5 py-1 text-[10px] rounded-[8px] font-medium flex items-center gap-1"
          style={{
            background: is3D ? "rgba(255,255,255,0.14)" : "transparent",
            color: is3D ? "#ffffff" : "rgba(235,235,245,0.4)",
            transform: pressedBtn === "3d" ? "scale(0.78)" : "scale(1)",
            transition: pressedBtn === "3d"
              ? "transform 55ms ease-in, background 0.15s ease, color 0.15s ease"
              : "transform 480ms cubic-bezier(0.34,1.56,0.64,1), background 0.2s ease, color 0.2s ease",
          }}
        >
          <Mountain className="w-3 h-3" />
          {is3D ? "3D" : "2D"}
        </button>

        <div className="w-px h-4 mx-0.5" style={{ background: "rgba(255,255,255,0.10)" }} />

        <button
          onPointerDown={() => pressSpring("terrain", () => setShowTruth((v) => !v))}
          title={showTruth ? "Masquer la vérité terrain (feu, fumée, sol brûlé)" : "Afficher la vérité terrain"}
          className="px-2.5 py-1 text-[10px] rounded-[8px] font-medium flex items-center gap-1"
          style={{
            background: showTruth ? alpha(C.fire, 0.16) : "transparent",
            color: showTruth ? C.fire : "rgba(235,235,245,0.4)",
            transform: pressedBtn === "terrain" ? "scale(0.78)" : "scale(1)",
            transition: pressedBtn === "terrain"
              ? "transform 55ms ease-in, background 0.15s ease, color 0.15s ease"
              : "transform 480ms cubic-bezier(0.34,1.56,0.64,1), background 0.2s ease, color 0.2s ease",
          }}
        >
          {showTruth ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          Vérité terrain
        </button>
      </div>

      {/* Pilule de contrôles (bas droite, à gauche du panneau d'incident) */}
      <div
        className="absolute flex items-center gap-1 pl-3 pr-1 py-1 z-10"
        style={{
          bottom: 12,
          right: active ? "min(296px, calc(100vw - 180px))" : 12,
          maxWidth: "calc(100vw - 24px)",
          background: "rgba(14,14,14,0.72)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          border: `1px solid ${C.line}`,
          borderRadius: 999,
          boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden lg:flex items-center gap-2.5 pr-2 text-[9px]" style={{ color: C.text3 }}>
          {[
            { color: C.ok, label: "OK" },
            { color: C.low, label: "Batterie" },
            { color: C.fire, label: "Figé/Dérive" },
            { color: C.red, label: "Aberrant" },
            { color: C.gray, label: "Hors ligne" },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{label}
            </span>
          ))}
        </div>
        {showFps && fps !== null && (
          <span className="px-2 text-[10px] font-mono tabular whitespace-nowrap" data-testid="fps"
            style={{ color: fps >= 50 ? C.text : C.fire, borderLeft: `1px solid ${C.line}` }}>
            {fps} FPS
          </span>
        )}
        <div className="flex items-center" style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 4 }}>
          <button onClick={() => mapRef.current?.zoomOut()} title="Dézoomer" aria-label="Dézoomer"
            className="w-8 h-8 flex items-center justify-center rounded-full spring-hover" style={{ color: C.text2 }}>
            <Minus className="w-4 h-4" />
          </button>
          <button onClick={() => mapRef.current?.zoomIn()} title="Zoomer" aria-label="Zoomer"
            className="w-8 h-8 flex items-center justify-center rounded-full spring-hover" style={{ color: C.text2 }}>
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: reducedMotion ? 0 : 600 })}
            title="Boussole : remettre le nord en haut" aria-label="Nord en haut"
            className="w-8 h-8 flex items-center justify-center rounded-full spring-hover"
            style={{ background: C.fill }}
          >
            <span ref={compassRef} className="flex items-center justify-center" style={{ transform: "rotate(30deg)" }}>
              <Navigation className="w-4 h-4" style={{ color: C.fire, fill: alpha(C.fire, 0.35) }} />
            </span>
          </button>
        </div>
      </div>

      {/* Aide bas de carte */}
      <div
        className="absolute text-[10px] select-none pointer-events-none px-3 py-1 rounded-full hidden xl:block"
        style={{ bottom: 18, left: active ? "calc(var(--dock-space) + 202px)" : "calc(var(--dock-space) + 12px)", color: C.text4, background: "rgba(0,0,0,0.35)" }}
      >
        Glisser un appareil · Double-clic = feu
      </div>
    </div>
  )
}

/* Animation d'entrée du tooltip */
const _tooltipKeyframe = `
@keyframes fwFocus {
  from { transform: scale(0.7); opacity: 1; }
  to   { transform: scale(1.9); opacity: 0; }
}
@keyframes tooltipIn {
  from { opacity: 0; transform: scale(0.90) translateY(6px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   }
}
`
if (typeof document !== "undefined" && !document.getElementById("fw-tooltip-anim")) {
  const s = document.createElement("style")
  s.id = "fw-tooltip-anim"
  s.textContent = _tooltipKeyframe
  document.head.appendChild(s)
}
