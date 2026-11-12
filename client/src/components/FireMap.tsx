import { useRef, useCallback, useMemo } from "react"
import Map, {
  Marker,
  Source,
  Layer,
  type MapRef,
} from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl"
import type { FireWatchState, WorldState, AlertLevelPayload, FireNode } from "@/types"

const CARTO_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
const TERRARIUM_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"]

const NODE_STATUS_COLOR: Record<string, string> = {
  ok:              "#22c55e",
  batterie_faible: "#eab308",
  figé:            "#3b82f6",
  aberrant:        "#ef4444",
  dérive:          "#f97316",
  hors_ligne:      "#52525b",
}

function NodeMarker({ node }: { node: FireNode }) {
  const color = node.online ? (NODE_STATUS_COLOR[node.status] ?? "#a3a3a3") : "#52525b"
  return (
    <div
      className={`w-2.5 h-2.5 rounded-full border border-black/60 ${node.siren ? "ring-2 ring-red-500 animate-pulse" : ""}`}
      style={{ backgroundColor: color }}
      title={`${node.id} · ${node.status} · T=${node.readings?.temp?.toFixed(0)}°C fumée=${node.readings?.smoke?.toFixed(0)}ppm`}
    />
  )
}

interface Props {
  state: FireWatchState
  world: WorldState | null
  alertLevel: AlertLevelPayload
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
}

export function FireMap({ state, sendCommand }: Props) {
  const mapRef = useRef<MapRef>(null)

  const handleMapLoad = useCallback(() => {
    const nativeMap = mapRef.current?.getMap() as MapLibreMap | undefined
    if (!nativeMap) return
    if (!nativeMap.getSource("terrarium")) {
      nativeMap.addSource("terrarium", {
        type: "raster-dem",
        tiles: TERRARIUM_TILES,
        tileSize: 256,
        encoding: "terrarium",
      })
    }
    nativeMap.setTerrain({ source: "terrarium", exaggeration: 1.5 })
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const kind = e.dataTransfer.getData("kind")
      if (!kind || !mapRef.current) return
      const rect = e.currentTarget.getBoundingClientRect()
      const lngLat = mapRef.current.unproject([
        e.clientX - rect.left,
        e.clientY - rect.top,
      ])
      if (kind === "__fire__") {
        sendCommand("fire_start", { lat: lngLat.lat, lon: lngLat.lng })
      } else if (kind === "__water__") {
        sendCommand("water", { lat: lngLat.lat, lon: lngLat.lng, radius: 150 })
      } else {
        sendCommand("device_add", { kind, lat: lngLat.lat, lon: lngLat.lng })
      }
    },
    [sendCommand]
  )

  const handleMapDblClick = useCallback(
    (e: MapLayerMouseEvent) => {
      sendCommand("fire_start", { lat: e.lngLat.lat, lon: e.lngLat.lng })
    },
    [sendCommand]
  )

  const zonesData = useMemo(() => {
    const zones = state.incident?.zones
    if (!zones?.length) return null
    return {
      type: "FeatureCollection" as const,
      features: zones.map((z) => ({
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [z.polygon.map(([lat, lon]) => [lon, lat])],
        },
        properties: { minutes: z.minutes },
      })),
    }
  }, [state.incident?.zones])

  const incident = state.incident

  return (
    <div
      className="flex-1 relative overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <Map
        ref={mapRef}
        mapStyle={CARTO_DARK}
        initialViewState={{
          latitude: 35.135,
          longitude: -5.215,
          zoom: 11,
          pitch: 50,
          bearing: -20,
        }}
        style={{ width: "100%", height: "100%" }}
        onLoad={handleMapLoad}
        onDblClick={handleMapDblClick}
      >
        {/* Zones de propagation */}
        {zonesData && (
          <Source id="zones" type="geojson" data={zonesData}>
            <Layer
              id="zones-fill"
              type="fill"
              paint={{
                "fill-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "minutes"],
                  15, "#ef4444",
                  30, "#f97316",
                  60, "#fbbf24",
                ],
                "fill-opacity": 0.2,
              }}
            />
            <Layer
              id="zones-outline"
              type="line"
              paint={{
                "line-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "minutes"],
                  15, "#ef4444",
                  30, "#f97316",
                  60, "#fbbf24",
                ],
                "line-width": 1.5,
                "line-dasharray": [3, 2],
              }}
            />
          </Source>
        )}

        {/* Nœuds IoT */}
        {state.nodes.map((node) => (
          <Marker
            key={node.id}
            latitude={node.lat}
            longitude={node.lon}
            anchor="center"
          >
            <NodeMarker node={node} />
          </Marker>
        ))}

        {/* Position estimée de l'incendie */}
        {incident?.position && (
          <Marker
            latitude={incident.position.lat}
            longitude={incident.position.lon}
            anchor="center"
          >
            <div
              className="text-xl select-none"
              style={{
                animation: incident.status === "actif" ? "pulse 1s ease-in-out infinite" : "none",
                filter: "drop-shadow(0 0 6px #ef4444)",
              }}
            >
              🔥
            </div>
          </Marker>
        )}
      </Map>

      {/* Hint */}
      <div className="absolute bottom-3 left-3 text-[10px] text-muted-foreground/60 select-none pointer-events-none">
        Glisser un appareil · Double-clic = feu
      </div>
    </div>
  )
}
