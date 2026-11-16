import { useRef, useCallback, useMemo, useEffect, useState } from "react"
import ReactMap, { Marker, Source, Layer, NavigationControl, type MapRef } from "react-map-gl/maplibre"
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import type { FireWatchState, WorldState, AlertLevelPayload, FireNode, WorldDevice } from "@/types"
import type { Feature, FeatureCollection, Polygon } from "geojson"
import {
  Cpu, Thermometer, CloudFog, TriangleAlert, Flame, Camera,
  Wind, Leaf, CloudRain, Bell, Radio, Layers, Mountain, Eye, EyeOff,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// ---------------------------------------------------------------------------
// Constantes de tuiles
// ---------------------------------------------------------------------------
const TERRARIUM = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"]
const ESRI_SATELLITE = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"]
const EOX_CLOUDLESS  = ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"]
const OPENTOPO      = ["https://tile.opentopomap.org/{z}/{x}/{y}.png"]
const CARTO_DARK    = ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"]

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
      "terrain-dem": { type: "raster-dem", tiles: TERRARIUM, tileSize: 256, encoding: "terrarium", maxzoom: 14 },
      "hillshade-dem": { type: "raster-dem", tiles: TERRARIUM, tileSize: 256, encoding: "terrarium", maxzoom: 14 },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": bgColor } },
      { id: "basemap", type: "raster", source: "basemap",
        paint: { "raster-opacity": basemap === "satellite" ? 1 : basemap === "topo" ? 0.9 : 0.85 } },
      { id: "hillshade", type: "hillshade", source: "hillshade-dem",
        paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#000020", "hillshade-highlight-color": "#ffffff" } },
    ],
    fog: { range: [0.5, 15], color: "#000018", "horizon-blend": 0.08 },
    sky: { "sky-color": "#000020", "sky-horizon-blend": 0.4, "horizon-color": "#00001a", "horizon-fog-blend": 0.3 },
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
  ok:             1,
  batterie_faible: 0.8,
  figé:           0.6,
  aberrant:       0.9,
  dérive:         0.75,
  hors_ligne:     0.35,
  offline:        0.35,
}

function DeviceMarker({
  device, node, onClick,
}: {
  device: WorldDevice
  node?: FireNode
  onClick?: () => void
}) {
  const cfg = DEVICE_ICONS[device.kind] ?? DEVICE_ICONS.station
  const { Icon, color, bg } = cfg
  const fault = node?.status ?? (device.fault !== "ok" ? device.fault : "ok")
  const opacity = FAULT_OPACITY[fault] ?? 1
  const isSiren = node?.siren
  const isOnline = node ? node.online : device.fault !== "offline"

  return (
    <div
      className="relative cursor-pointer select-none"
      style={{ opacity }}
      title={`${device.id} · ${device.kind} · ${fault}${node ? ` · T=${node.readings?.temp?.toFixed(0)}°C smoke=${node.readings?.smoke?.toFixed(0)}ppm bat=${node.readings?.bat?.toFixed(0)}%` : ""}`}
      onClick={onClick}
    >
      {/* Anneau pulsé si sirène active */}
      {isSiren && (
        <div className="absolute inset-0 rounded-full border-2 border-red-500 animate-ping" style={{ margin: "-4px" }} />
      )}
      {/* Corps du marqueur */}
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center border border-black/40 shadow-lg"
        style={{ background: isOnline ? bg : "#374151" }}
      >
        <Icon className="w-3 h-3" style={{ color: isOnline ? color : "#9ca3af" }} />
      </div>
      {/* Point hors-ligne */}
      {!isOnline && (
        <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-zinc-600 border border-black/60" />
      )}
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
  const mapRef = useRef<MapRef>(null)
  const [basemap, setBasemap] = useState<Basemap>("satellite")
  const [is3D, setIs3D] = useState(true)
  const [showTruth, setShowTruth] = useState(true)
  const [esriOk, setEsriOk] = useState(true)
  const prevConfirmedRef = useRef(false)

  // -------------------------------------------------------------------------
  // Style de fond (reconstruit seulement si basemap ou esriOk change)
  // -------------------------------------------------------------------------
  const mapStyle = useMemo(() => buildStyle(basemap, esriOk), [basemap, esriOk])

  // -------------------------------------------------------------------------
  // Terrain : appliqué à chaque chargement/rechargement de style
  // -------------------------------------------------------------------------
  const applyTerrain = useCallback((map: MapLibreMap, enable: boolean) => {
    try {
      map.setTerrain(enable ? { source: "terrain-dem", exaggeration: 1.6 } : null)
    } catch { /* style pas encore prêt */ }
  }, [])

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    if (!map) return
    applyTerrain(map, is3D)
    map.on("style.load", () => applyTerrain(map, is3D))

    // Détection d'erreur Esri → bascule sur EOX
    map.on("error", (e) => {
      if (typeof e?.error?.message === "string" && e.error.message.includes("arcgisonline")) {
        setEsriOk(false)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // 2D / 3D toggle
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current?.getMap() as MapLibreMap | undefined
    if (!map || !map.isStyleLoaded()) return
    applyTerrain(map, is3D)
    map.easeTo({ pitch: is3D ? 62 : 0, duration: 600 })
  }, [is3D, applyTerrain])

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
  // Handlers
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

  const incident = state.incident

  return (
    <div
      className="flex-1 relative overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <ReactMap
        ref={mapRef}
        mapStyle={mapStyle as never}
        initialViewState={{ latitude: CENTER_LAT, longitude: CENTER_LON, zoom: 13, pitch: 62, bearing: -25 }}
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

        {/* ── Marqueurs : appareils du simulateur (draggables) ── */}
        {worldDevices.map((device) => (
          <Marker
            key={device.id}
            latitude={device.lat}
            longitude={device.lon}
            anchor="center"
            draggable
            onDragEnd={(e) => sendCommand("device_move", { id: device.id, lat: e.lngLat.lat, lon: e.lngLat.lng })}
          >
            <DeviceMarker device={device} node={nodeById.get(device.id)} />
          </Marker>
        ))}

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

      {/* ================================================================
          Contrôles overlay
      ================================================================ */}

      {/* Sélecteur de fond + toggle 2D/3D */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur border border-zinc-700 rounded-lg px-1.5 py-1">
        {(["satellite", "topo", "dark"] as Basemap[]).map((b) => (
          <button
            key={b}
            onClick={() => setBasemap(b)}
            title={b === "satellite" ? "Satellite Esri" : b === "topo" ? "OpenTopoMap" : "CARTO Sombre"}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors font-mono ${
              basemap === b
                ? "bg-orange-500/30 text-orange-300 border border-orange-500/50"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {b === "satellite" ? "Satellite" : b === "topo" ? "Topo" : "Sombre"}
          </button>
        ))}

        <div className="w-px h-4 bg-zinc-700 mx-0.5" />

        <button
          onClick={() => setIs3D(!is3D)}
          title={is3D ? "Basculer en vue 2D" : "Basculer en vue 3D"}
          className={`px-2 py-0.5 text-[10px] rounded transition-colors font-mono flex items-center gap-1 ${
            is3D ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Mountain className="w-3 h-3" />
          {is3D ? "3D" : "2D"}
        </button>

        <div className="w-px h-4 bg-zinc-700 mx-0.5" />

        <button
          onClick={() => setShowTruth(!showTruth)}
          title={showTruth ? "Masquer la vérité terrain" : "Afficher la vérité terrain"}
          className={`px-2 py-0.5 text-[10px] rounded transition-colors font-mono flex items-center gap-1 ${
            showTruth ? "bg-orange-500/20 text-orange-400 border border-orange-500/40" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {showTruth ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          Terrain
        </button>
      </div>

      {/* Légende des états capteurs */}
      <div className="absolute bottom-8 right-2 bg-black/70 backdrop-blur border border-zinc-700 rounded-lg p-2 text-[9px] text-zinc-400 font-mono flex flex-col gap-0.5">
        <div className="text-[8px] uppercase tracking-widest text-zinc-500 mb-0.5">États</div>
        {[
          { color: "#22c55e", label: "OK" },
          { color: "#eab308", label: "Batterie faible" },
          { color: "#3b82f6", label: "Figé" },
          { color: "#ef4444", label: "Aberrant" },
          { color: "#f97316", label: "Dérive" },
          { color: "#52525b", label: "Hors ligne" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Couches actives */}
      <div className="absolute bottom-8 left-2 bg-black/70 backdrop-blur border border-zinc-700 rounded-lg p-2 text-[9px] text-zinc-400 font-mono flex flex-col gap-0.5">
        <div className="text-[8px] uppercase tracking-widest text-zinc-500 mb-0.5">Couches</div>
        {[
          { color: "#10b981", label: "Couverture gateway" },
          { color: "#06b6d4", label: "Cônes caméras" },
          { color: "#ef4444", label: "Zone 15 min" },
          { color: "#f97316", label: "Zone 30 min" },
          { color: "#fbbf24", label: "Zone 60 min" },
          { color: "#ef4444", label: "Incertitude foyer", dashed: true },
        ].map(({ color, label, dashed }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-3 h-0.5 ${dashed ? "opacity-70" : ""}`} style={{ backgroundColor: color,
              backgroundImage: dashed ? `repeating-linear-gradient(90deg, ${color} 0, ${color} 2px, transparent 2px, transparent 4px)` : undefined,
              background: dashed ? undefined : color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Layers icon en bas à droite (indicateur visuel) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/50 select-none pointer-events-none flex items-center gap-1">
        <Layers className="w-3 h-3" />
        Glisser un appareil · Double-clic = feu
      </div>
    </div>
  )
}
