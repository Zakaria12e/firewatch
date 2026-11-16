import { useRef, useCallback, useMemo, useEffect, useState } from "react"
import ReactMap, { Marker, Source, Layer, NavigationControl, type MapRef } from "react-map-gl/maplibre"
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import type { FireWatchState, WorldState, AlertLevelPayload, FireNode, WorldDevice, NodeReadings } from "@/types"
import type { Feature, FeatureCollection, Polygon } from "geojson"
import {
  Cpu, Thermometer, CloudFog, TriangleAlert, Flame, Camera,
  Wind, Leaf, CloudRain, Bell, Radio, Mountain, Eye, EyeOff, X,
  Battery, Signal,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// ---------------------------------------------------------------------------
// Constantes de tuiles
// ---------------------------------------------------------------------------
const TERRARIUM      = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"]
const ESRI_SATELLITE = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"]
const EOX_CLOUDLESS  = ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"]
const OPENTOPO       = ["https://tile.opentopomap.org/{z}/{x}/{y}.png"]
const CARTO_DARK     = ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"]

type Basemap = "satellite" | "topo" | "dark"

// ---------------------------------------------------------------------------
// Constructeur de style MapLibre complet
// ---------------------------------------------------------------------------
function buildStyle(basemap: Basemap, esriOk: boolean): object {
  const baseSource = basemap === "satellite"
    ? { type: "raster", tiles: esriOk ? ESRI_SATELLITE : EOX_CLOUDLESS, tileSize: 256,
        attribution: esriOk ? "Imagerie © Esri, Maxar, Earthstar Geographics" : "© EOX Sentinel-2", maxzoom: 19 }
    : basemap === "topo"
    ? { type: "raster", tiles: OPENTOPO, tileSize: 256, attribution: "© OpenTopoMap", maxzoom: 17 }
    : { type: "raster", tiles: CARTO_DARK, tileSize: 512, attribution: "© CARTO © OpenStreetMap", maxzoom: 19 }

  const bgColor = basemap === "satellite" ? "#000011" : basemap === "topo" ? "#1a1a1a" : "#0d0d0d"

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
        paint: { "raster-opacity": basemap === "satellite" ? 1 : basemap === "topo" ? 0.9 : 0.85 } },
      { id: "hillshade", type: "hillshade", source: "hillshade-dem",
        paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#000020", "hillshade-highlight-color": "#ffffff" } },
    ],
    // Brume ambrée horizon (Chergui / forêt sèche du Rif)
    fog: {
      "range": [0.5, 12],
      "color": "#0d0502",
      "high-color": "#1c0905",
      "horizon-blend": 0.08,
      "space-color": "#010203",
      "star-intensity": 0.05,
    },
  }
}

// ---------------------------------------------------------------------------
// Utilitaires GeoJSON
// ---------------------------------------------------------------------------
const CENTER_LAT = 35.135
const CENTER_LON = -5.215

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

function fireCellsGeoJSON(world: WorldState | null): FeatureCollection {
  const fires = world?.fires ?? []
  const grid  = world?.grid
  if (!fires.length || !grid) return { type: "FeatureCollection", features: [] }

  const { rows, cols, cell: cellM, origin } = grid
  const latPerCell = cellM / 111_320
  const lonPerCell = cellM / (111_320 * Math.cos(CENTER_LAT * Math.PI / 180))
  const originLat = origin?.lat ?? (CENTER_LAT + (rows / 2) * latPerCell)
  const originLon = origin?.lon ?? (CENTER_LON - (cols / 2) * lonPerCell)

  const features: Feature[] = []
  for (const fire of fires) {
    for (const [row, col] of fire.cells ?? []) {
      const lat = originLat - row * latPerCell
      const lon = originLon + col * lonPerCell
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[
          [lon,              lat],
          [lon + lonPerCell, lat],
          [lon + lonPerCell, lat - latPerCell],
          [lon,              lat - latPerCell],
          [lon,              lat],
        ]] },
        properties: { height: 40 + Math.random() * 60 },
      })
    }
  }
  return { type: "FeatureCollection", features }
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

function gatewayGeoJSON(devices: WorldDevice[] | undefined): FeatureCollection {
  const gws = devices?.filter((d) => d.kind === "gateway") ?? []
  return {
    type: "FeatureCollection",
    features: gws.map((gw) => ({ ...circlePolygon(gw.lat, gw.lon, 3500), properties: { id: gw.id } })),
  }
}

function cameraGeoJSON(devices: WorldDevice[] | undefined): FeatureCollection {
  const cams = devices?.filter((d) => d.kind === "thermal") ?? []
  return {
    type: "FeatureCollection",
    features: cams.map((c) => ({ ...conePolygon(c.lat, c.lon, c.azimuth ?? 0), properties: { id: c.id } })),
  }
}

function radioLinksGeoJSON(devices: WorldDevice[] | undefined): FeatureCollection {
  if (!devices?.length) return { type: "FeatureCollection", features: [] }
  const gws = devices.filter((d) => d.kind === "gateway")
  if (!gws.length) return { type: "FeatureCollection", features: [] }
  const others = devices.filter((d) => d.kind !== "gateway")
  const features: Feature[] = []
  for (const dev of others) {
    const nearest = gws.reduce<WorldDevice | null>((best, gw) => {
      const d = Math.hypot(gw.lat - dev.lat, gw.lon - dev.lon)
      if (!best) return gw
      return d < Math.hypot(best.lat - dev.lat, best.lon - dev.lon) ? gw : best
    }, null)
    if (nearest) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[dev.lon, dev.lat], [nearest.lon, nearest.lat]] },
        properties: { fault: dev.fault },
      })
    }
  }
  return { type: "FeatureCollection", features }
}

// ---------------------------------------------------------------------------
// Icônes par type d'appareil
// ---------------------------------------------------------------------------
const DEVICE_ICONS: Record<string, { Icon: LucideIcon; color: string; bg: string }> = {
  station:  { Icon: Cpu,           color: "#93c5fd", bg: "#1d4ed8" },
  temp:     { Icon: Thermometer,   color: "#fdba74", bg: "#c2410c" },
  smoke:    { Icon: CloudFog,      color: "#c4b5fd", bg: "#7c3aed" },
  co:       { Icon: TriangleAlert, color: "#fde047", bg: "#a16207" },
  flame:    { Icon: Flame,         color: "#fca5a5", bg: "#b91c1c" },
  thermal:  { Icon: Camera,        color: "#67e8f9", bg: "#0e7490" },
  wind:     { Icon: Wind,          color: "#d4d4d4", bg: "#525252" },
  fuel:     { Icon: Leaf,          color: "#86efac", bg: "#166534" },
  rain:     { Icon: CloudRain,     color: "#93c5fd", bg: "#1d4ed8" },
  siren:    { Icon: Bell,          color: "#fda4af", bg: "#be123c" },
  gateway:  { Icon: Radio,         color: "#6ee7b7", bg: "#065f46" },
}

const FAULT_OPACITY: Record<string, number> = {
  ok:              1,
  batterie_faible: 0.8,
  figé:            0.6,
  aberrant:        0.9,
  dérive:          0.75,
  hors_ligne:      0.35,
  offline:         0.35,
}

// ---------------------------------------------------------------------------
// Tooltip appareil (style iOS)
// ---------------------------------------------------------------------------
const DEVICE_LABELS: Record<string, string> = {
  station: "Station",   temp: "Température",  smoke: "Fumée",
  co: "CO",             flame: "Flamme",       thermal: "Thermique",
  wind: "Vent",         fuel: "Fuel",          rain: "Pluie",
  siren: "Sirène",      gateway: "Passerelle",
}

const DEVICE_MODELS: Record<string, string> = {
  station: "ESP32+LoRa", temp: "DHT22",    smoke: "MQ-2",       co: "MQ-7",
  flame: "KY-026",       thermal: "MLX90640", wind: "Anémomètre", fuel: "Sonde FMC",
  rain: "Pluviomètre",   siren: "Sirène+Relais", gateway: "LoRaWAN GW",
}

type Measurement = { label: string; value: string; unit: string }

function getReadings(kind: string, r: NodeReadings): Measurement[] {
  const m: Measurement[] = []
  const add = (label: string, v: number | undefined, unit: string, digits = 1) => {
    if (v !== undefined) m.push({ label, value: v.toFixed(digits), unit })
  }
  switch (kind) {
    case "station":
      add("Température", r.temp, "°C", 1); add("Humidité", r.hum, "%", 0)
      add("Fumée", r.smoke, "ppm", 0); add("CO", r.co, "ppm", 0); break
    case "temp":
      add("Température", r.temp, "°C", 1); add("Humidité", r.hum, "%", 0); break
    case "smoke":
      add("Fumée", r.smoke, "ppm", 0); add("Humidité", r.hum, "%", 0); break
    case "co":
      add("CO", r.co, "ppm", 0); break
    case "flame":
      if (r.ir !== undefined) m.push({ label: "IR", value: r.ir.toFixed(2), unit: "" })
      if (r.flame !== undefined) m.push({ label: "Flamme", value: r.flame ? "Oui" : "Non", unit: "" }); break
    case "thermal":
      add("T. max", r.tmax, "°C", 1)
      if (r.ir !== undefined) m.push({ label: "Cap. chaud", value: r.ir.toFixed(0), unit: "°" }); break
    case "wind":
      add("Vitesse", r.wind_speed, "m/s"); add("Direction", r.wind_dir, "°", 0)
      add("Rafale", r.gust, "m/s"); break
    case "fuel":
      add("FMC", r.fmc, "%", 1); break
    case "rain":
      add("Pluie", r.rain, "mm/h"); break
  }
  return m
}

const FAULT_LABEL: Record<string, string> = {
  ok: "En ligne", hors_ligne: "Hors ligne", figé: "Figé",
  aberrant: "Aberrant", dérive: "Dérive", batterie_faible: "Batterie faible",
  offline: "Hors ligne",
}

const FAULT_COLOR: Record<string, string> = {
  ok: "#30d158", hors_ligne: "#636366", figé: "#0a84ff", aberrant: "#ff3b30",
  dérive: "#ff9f0a", batterie_faible: "#ffd60a", offline: "#636366",
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
  const cfg = DEVICE_ICONS[device.kind] ?? DEVICE_ICONS.station
  const { Icon, color } = cfg
  const fault = node?.status ?? (device.fault !== "ok" ? device.fault : "ok")
  const faultColor = FAULT_COLOR[fault] ?? "#ffffff"
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
      style={{
        left: cx, top: cy, width: W,
        background: "rgba(28,28,30,0.90)",
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
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${color}20` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-white/90 leading-none truncate" style={{ letterSpacing: "-0.374px" }}>
            {DEVICE_LABELS[device.kind] ?? device.kind}
          </div>
          <div className="text-[10px] text-white/35 font-mono mt-0.5">{DEVICE_MODELS[device.kind]}</div>
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
            {FAULT_LABEL[fault] ?? fault}
          </span>
          {bat !== undefined && (
            <div className="flex items-center gap-1.5">
              <Battery className="w-3 h-3" style={{ color: bat < 15 ? "#ff3b30" : bat < 40 ? "#ffd60a" : "#30d158" }} />
              <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.10)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${bat}%`,
                    background: bat < 15 ? "#ff3b30" : bat < 40 ? "#ffd60a" : "#30d158",
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
// Marqueur d'appareil avec mât vertical et ombre au sol
// ---------------------------------------------------------------------------
function DeviceMarker({
  device, node, onClick,
}: {
  device: WorldDevice
  node?: FireNode
  onClick?: (e: React.MouseEvent) => void
}) {
  const cfg = DEVICE_ICONS[device.kind] ?? DEVICE_ICONS.station
  const { Icon, color, bg } = cfg
  const fault = node?.status ?? (device.fault !== "ok" ? device.fault : "ok")
  const opacity = FAULT_OPACITY[fault] ?? 1
  const isSiren = node?.siren
  const isOnline = node ? node.online : device.fault !== "offline"

  return (
    <div
      className="relative flex flex-col items-center select-none cursor-pointer"
      style={{ opacity }}
      title={`${device.id} · ${device.kind} · ${fault}${node ? ` · T=${node.readings?.temp?.toFixed(0)}°C smoke=${node.readings?.smoke?.toFixed(0)}ppm bat=${node.readings?.bat?.toFixed(0)}%` : ""}`}
      onClick={onClick}
    >
      {/* Anneau pulsé si sirène active */}
      {isSiren && (
        <div
          className="absolute rounded-full border-2 border-red-500 animate-ping"
          style={{ width: 36, height: 36, top: -6, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}
        />
      )}

      {/* Corps du marqueur */}
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center border border-black/40 shadow-lg"
        style={{ background: isOnline ? bg : "#374151", position: "relative", zIndex: 5 }}
      >
        <Icon className="w-3 h-3" style={{ color: isOnline ? color : "#9ca3af" }} />
      </div>

      {/* Mât vertical */}
      <div
        style={{
          width: 2,
          height: 36,
          borderRadius: 1,
          background: "linear-gradient(to bottom, rgba(255,255,255,0.28), rgba(255,255,255,0.03))",
        }}
      />

      {/* Disque d'ombre au sol */}
      <div
        style={{
          width: 14,
          height: 5,
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.65) 0%, transparent 70%)",
          marginTop: -1,
        }}
      />
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
}

export function FireMap({ state, world, alertLevel, sendCommand }: Props) {
  const mapRef        = useRef<MapRef>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const is3DRef       = useRef(true)
  const diagLoggedRef = useRef(false)   // log diagnostic une seule fois

  const [basemap, setBasemap] = useState<Basemap>("satellite")
  const [is3D, setIs3D]       = useState(true)
  const [showTruth, setShowTruth] = useState(true)
  const [esriOk, setEsriOk]   = useState(true)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [selectedMarker, setSelectedMarker] = useState<{
    device: WorldDevice; node?: FireNode; x: number; y: number
  } | null>(null)

  const prevConfirmedRef = useRef(false)

  // -------------------------------------------------------------------------
  // Style de fond (reconstruit seulement si basemap ou esriOk change)
  // -------------------------------------------------------------------------
  const mapStyle = useMemo(() => buildStyle(basemap, esriOk), [basemap, esriOk])

  // -------------------------------------------------------------------------
  // Terrain : exagération 2.2 pour relief très visible
  // -------------------------------------------------------------------------
  const applyTerrain = useCallback((map: MapLibreMap, enable: boolean) => {
    try {
      map.setTerrain(enable ? { source: "terrain-dem", exaggeration: 2.2 } : null)
    } catch { /* style pas encore prêt */ }
  }, [])

  // -------------------------------------------------------------------------
  // Chargement initial + listener style.load persistant
  // -------------------------------------------------------------------------
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    if (!map) return

    setMapLoaded(true)
    applyTerrain(map, is3DRef.current)

    // Réappliquer le terrain à chaque changement de fond de carte
    map.on("style.load", () => {
      applyTerrain(map, is3DRef.current)

      // Diagnostic affiché une seule fois en console
      if (!diagLoggedRef.current) {
        diagLoggedRef.current = true
        console.log("[FireMap 3D] terrain:", JSON.stringify(map.getTerrain()))
        try {
          const elev = map.queryTerrainElevation([CENTER_LON, CENTER_LAT])
          console.log("[FireMap 3D] altitude centre:", elev?.toFixed(0), "m")
        } catch { /* tuiles pas encore chargées */ }
      }
    })

    // Fallback Esri → EOX si erreur 403/CORS
    map.on("error", (e) => {
      if (typeof e?.error?.message === "string" && e.error.message.includes("arcgisonline")) {
        setEsriOk(false)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyTerrain])

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
    map.easeTo(next
      ? { pitch: 72, bearing: -30, duration: 1200 }
      : { pitch: 0,  bearing: 0,   duration: 1200 }
    )
  }, [applyTerrain])

  // -------------------------------------------------------------------------
  // flyTo cinématique à la confirmation du feu
  // -------------------------------------------------------------------------
  useEffect(() => {
    const confirmed = alertLevel.level === "feu_confirmé"
    if (confirmed && !prevConfirmedRef.current && state.incident?.position) {
      const { lat, lon } = state.incident.position
      const wind = alertLevel.wind
      mapRef.current?.flyTo({
        center: [lon, lat],
        zoom: 14.5,
        pitch: 70,
        bearing: wind ? -(wind.from) % 360 : -25,
        duration: 2500,
        essential: true,
      })
    }
    prevConfirmedRef.current = confirmed
  }, [alertLevel.level, alertLevel.wind, state.incident?.position])

  // -------------------------------------------------------------------------
  // Rotation lente automatique (s'arrête dès interaction)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded) return
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    const container = containerRef.current
    if (!map || !container) return

    let frameId: number
    let lastInteraction = Date.now()

    // Écouter sur le conteneur DOM (capte aussi les clics sur les marqueurs)
    const onInteract = () => { lastInteraction = Date.now() }
    container.addEventListener("mousedown", onInteract, { passive: true })
    container.addEventListener("touchstart", onInteract, { passive: true })
    map.on("wheel", onInteract)

    const tick = () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (is3DRef.current && Date.now() - lastInteraction > 5000) {
        map.setBearing((map.getBearing() + 0.015) % 360)
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameId)
      container.removeEventListener("mousedown", onInteract)
      container.removeEventListener("touchstart", onInteract)
      map.off("wheel", onInteract)
    }
  }, [mapLoaded])

  // -------------------------------------------------------------------------
  // GeoJSON (recalculé uniquement si les données changent)
  // -------------------------------------------------------------------------
  const fireGeoJSON   = useMemo(() => fireCellsGeoJSON(world),               [world])
  const zonesGJ       = useMemo(() => zonesGeoJSON(state.incident?.zones),   [state.incident?.zones])
  const uncertaintyGJ = useMemo(() => uncertaintyGeoJSON(state.incident?.position), [state.incident?.position])
  const gatewayGJ     = useMemo(() => gatewayGeoJSON(world?.devices),        [world?.devices])
  const cameraGJ      = useMemo(() => cameraGeoJSON(world?.devices),         [world?.devices])
  const radioGJ       = useMemo(() => radioLinksGeoJSON(world?.devices),     [world?.devices])

  // Nœud par ID pour enrichir les marqueurs
  const nodeById = useMemo(() => {
    const m = new Map<string, FireNode>()
    state.nodes.forEach((n) => m.set(n.id, n))
    return m
  }, [state.nodes])

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

  // -------------------------------------------------------------------------
  // Devices à afficher (world.devices prioritaire, sinon state.nodes)
  // -------------------------------------------------------------------------
  const worldDevices = world?.devices ?? []
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
        style={{ width: "100%", height: "100%" }}
        onLoad={handleMapLoad}
        onDblClick={handleDblClick}
      >
        <NavigationControl position="top-right" visualizePitch />

        {/* ── Couverture passerelles ── */}
        <Source id="gateways" type="geojson" data={gatewayGJ}>
          <Layer id="gateways-fill" type="fill"
            paint={{ "fill-color": "#10b981", "fill-opacity": 0.07 }} />
          <Layer id="gateways-outline" type="line"
            paint={{ "line-color": "#10b981", "line-opacity": 0.4, "line-width": 1, "line-dasharray": [4, 3] }} />
        </Source>

        {/* ── Cônes caméras thermiques ── */}
        <Source id="cameras" type="geojson" data={cameraGJ}>
          <Layer id="cameras-fill" type="fill"
            paint={{ "fill-color": "#06b6d4", "fill-opacity": 0.1 }} />
          <Layer id="cameras-outline" type="line"
            paint={{ "line-color": "#06b6d4", "line-opacity": 0.5, "line-width": 1 }} />
        </Source>

        {/* ── Liens radio capteur → passerelle ── */}
        <Source id="radio" type="geojson" data={radioGJ}>
          <Layer id="radio-lines" type="line"
            paint={{
              "line-color": ["case",
                ["==", ["get", "fault"], "ok"],        "#22c55e",
                ["==", ["get", "fault"], "hors_ligne"], "#52525b",
                "#eab308"],
              "line-opacity": 0.4,
              "line-width": 0.8,
              "line-dasharray": [2, 2],
            }} />
        </Source>

        {/* ── Vérité terrain : cellules en feu ── */}
        {showTruth && world?.fires?.length ? (
          <Source id="fire-cells" type="geojson" data={fireGeoJSON}>
            <Layer id="fire-cells-extrusion" type="fill-extrusion"
              paint={{
                "fill-extrusion-color": ["interpolate", ["linear"], ["get", "height"],
                  40, "#f97316", 80, "#ef4444", 100, "#fbbf24"],
                "fill-extrusion-height": ["get", "height"],
                "fill-extrusion-base": 0,
                "fill-extrusion-opacity": 0.85,
              }} />
          </Source>
        ) : null}

        {/* ── Zones de propagation 15/30/60 min ── */}
        <Source id="zones" type="geojson" data={zonesGJ}>
          <Layer id="zones-fill" type="fill"
            paint={{
              "fill-color": ["interpolate", ["linear"], ["get", "minutes"],
                15, "#ef4444", 30, "#f97316", 60, "#fbbf24"],
              "fill-opacity": 0.12,
            }} />
          <Layer id="zones-outline" type="line"
            paint={{
              "line-color": ["interpolate", ["linear"], ["get", "minutes"],
                15, "#ef4444", 30, "#f97316", 60, "#fbbf24"],
              "line-width": 1.5,
              "line-dasharray": [4, 3],
            }} />
        </Source>

        {/* ── Cercle d'incertitude du foyer estimé ── */}
        <Source id="uncertainty" type="geojson" data={uncertaintyGJ}>
          <Layer id="uncertainty-fill" type="fill"
            paint={{ "fill-color": "#ef4444", "fill-opacity": 0.08 }} />
          <Layer id="uncertainty-outline" type="line"
            paint={{ "line-color": "#ef4444", "line-opacity": 0.5, "line-width": 1.5, "line-dasharray": [3, 2] }} />
        </Source>

        {/* ── Marqueurs : appareils du simulateur (mât + ombre) ── */}
        {worldDevices.map((device) => {
          const node = nodeById.get(device.id)
          return (
            <Marker
              key={device.id}
              latitude={device.lat}
              longitude={device.lon}
              anchor="top"
              draggable
              onDragEnd={(e) => sendCommand("device_move", { id: device.id, lat: e.lngLat.lat, lon: e.lngLat.lng })}
            >
              <DeviceMarker
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
              className={`w-2.5 h-2.5 rounded-full border border-black/60 ${node.siren ? "ring-2 ring-red-500 animate-pulse" : ""}`}
              style={{ backgroundColor: node.online ? "#22c55e" : "#52525b" }}
              title={`${node.id} · T=${node.readings?.temp?.toFixed(0)}°C smoke=${node.readings?.smoke?.toFixed(0)}ppm`}
            />
          </Marker>
        ))}

        {/* ── Foyer estimé ── */}
        {incident?.position && (
          <Marker latitude={incident.position.lat} longitude={incident.position.lon} anchor="center">
            <div
              style={{
                fontSize: "1.5rem",
                lineHeight: 1,
                filter: "drop-shadow(0 0 8px #ef4444) drop-shadow(0 0 3px #ff6600)",
                animation: incident.status === "actif" ? "pulse 0.8s ease-in-out infinite alternate" : "none",
              }}
              title="Foyer estimé par le serveur"
            >
              🔥
            </div>
          </Marker>
        )}
      </ReactMap>

      {/* Tooltip appareil au clic */}
      {selectedMarker && (
        <DeviceTooltip
          device={selectedMarker.device}
          node={selectedMarker.node}
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
          background: "rgba(28,28,30,0.72)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
        }}
      >
        {(["satellite", "topo", "dark"] as Basemap[]).map((b) => (
          <button
            key={b}
            onClick={() => setBasemap(b)}
            title={b === "satellite" ? "Satellite Esri" : b === "topo" ? "OpenTopoMap" : "CARTO Sombre"}
            className="px-2.5 py-1 text-[10px] rounded-[8px] transition-all font-medium"
            style={{
              background: basemap === b ? "rgba(255,255,255,0.14)" : "transparent",
              color: basemap === b ? "#ffffff" : "rgba(235,235,245,0.4)",
            }}
          >
            {b === "satellite" ? "Satellite" : b === "topo" ? "Topo" : "Sombre"}
          </button>
        ))}

        <div className="w-px h-4 mx-0.5" style={{ background: "rgba(255,255,255,0.10)" }} />

        <button
          onClick={handleToggle3D}
          title={is3D ? "Vue 2D" : "Vue 3D terrain"}
          className="px-2.5 py-1 text-[10px] rounded-[8px] transition-all font-medium flex items-center gap-1"
          style={{
            background: is3D ? "rgba(100,210,255,0.15)" : "transparent",
            color: is3D ? "#64d2ff" : "rgba(235,235,245,0.4)",
          }}
        >
          <Mountain className="w-3 h-3" />
          {is3D ? "3D" : "2D"}
        </button>

        <div className="w-px h-4 mx-0.5" style={{ background: "rgba(255,255,255,0.10)" }} />

        <button
          onClick={() => setShowTruth(!showTruth)}
          title={showTruth ? "Masquer la vérité terrain" : "Afficher la vérité terrain"}
          className="px-2.5 py-1 text-[10px] rounded-[8px] transition-all font-medium flex items-center gap-1"
          style={{
            background: showTruth ? "rgba(255,90,31,0.15)" : "transparent",
            color: showTruth ? "#ff9f0a" : "rgba(235,235,245,0.4)",
          }}
        >
          {showTruth ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          Terrain
        </button>
      </div>

      {/* Légende compacte – coin bas droit */}
      <div
        className="absolute bottom-6 right-4 flex flex-col gap-1 text-[9px] font-mono px-3 py-2.5"
        style={{
          background: "rgba(18,18,20,0.70)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 10,
        }}
      >
        {[
          { color: "#30d158", label: "OK" },
          { color: "#ffd60a", label: "Batterie" },
          { color: "#0a84ff", label: "Figé" },
          { color: "#ff3b30", label: "Aberrant" },
          { color: "#ff9f0a", label: "Dérive" },
          { color: "#636366", label: "Hors ligne" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
            <span style={{ color: "rgba(235,235,245,0.4)" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Hint bas de carte */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] select-none pointer-events-none px-3 py-1 rounded-full"
        style={{
          color: "rgba(235,235,245,0.25)",
          background: "rgba(0,0,0,0.30)",
        }}
      >
        Glisser un appareil · Double-clic = feu
      </div>
    </div>
  )
}

/* Animation d'entrée du tooltip */
const _tooltipKeyframe = `
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
