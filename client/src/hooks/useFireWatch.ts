import { useEffect, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import type {
  FireWatchState,
  FireNode,
  Incident,
  WorldState,
  AlertLevelPayload,
  Metrics,
  FwEvent,
} from "@/types"
import { packetBus } from "@/lib/packetBus"

const DEFAULT_STATE: FireWatchState = {
  nodes: [],
  incident: null,
  weather: null,
  weatherMode: "reel",
  store: "memory",
  center: { lat: 35.135, lon: -5.215 },
  places: [],
  sirenOverride: null,
  simulatorConnected: false,
}

/** Les mesures arrivent paquet par paquet : on les regroupe avant de toucher React. */
const NODE_FLUSH_MS = 1000
const EVENTS_KEPT = 200

export function useFireWatch() {
  const [state, setState] = useState<FireWatchState>(DEFAULT_STATE)
  const [world, setWorld] = useState<WorldState | null>(null)
  const [alertLevel, setAlertLevel] = useState<AlertLevelPayload>({
    level: "veille",
    score: 0,
    riskIndex: { value: 0 },
  })
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [events, setEvents] = useState<FwEvent[]>([])
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io()
    socketRef.current = socket
    const pending = new Map<string, FireNode>()
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      flushTimer = null
      if (!pending.size) return
      const batch = new Map(pending)
      pending.clear()
      setState((prev) => {
        const nodes = prev.nodes.map((x) => batch.get(x.id) ?? x)
        for (const [id, n] of batch) if (!prev.nodes.some((x) => x.id === id)) nodes.push(n)
        return { ...prev, nodes }
      })
    }

    socket.on("state", (s: FireWatchState) => {
      pending.clear()
      setState(s)
    })

    socket.on("node", (n: FireNode) => {
      // Effets 3D (LED, impulsion radio) : immédiat, sans re-rendu
      packetBus.emit({
        id: n.id,
        gw: n.gw ?? null,
        rssi: n.readings?.rssi,
        snr: n.readings?.snr,
        bytes: n.bytes,
        at: Date.now(),
      })
      pending.set(n.id, n)
      if (!flushTimer) flushTimer = setTimeout(flush, NODE_FLUSH_MS)
    })

    socket.on("incident", (inc: Incident) =>
      setState((prev) => ({ ...prev, incident: inc }))
    )

    socket.on("world", (w: WorldState) => setWorld(w))

    // Journal : historique à la connexion, puis événements en direct
    socket.on("connect", () => {
      fetch("/api/events").then((r) => r.json()).then((list: FwEvent[]) => setEvents(list.slice(-EVENTS_KEPT))).catch(() => {})
    })
    socket.on("event", (e: FwEvent) =>
      setEvents((prev) => (prev.some((x) => x.id === e.id) ? prev : [...prev, e].slice(-EVENTS_KEPT)))
    )

    socket.on("alert_level", (al: AlertLevelPayload) => setAlertLevel(al))

    socket.on("siren", (override: boolean | null) =>
      setState((prev) => ({ ...prev, sirenOverride: override }))
    )

    return () => {
      if (flushTimer) clearTimeout(flushTimer)
      socket.disconnect()
    }
  }, [])

  // Métriques : polling toutes les 5 s
  useEffect(() => {
    const fetchMetrics = () =>
      fetch("/api/metrics")
        .then((r) => r.json())
        .then(setMetrics)
        .catch(() => {})
    fetchMetrics()
    const id = setInterval(fetchMetrics, 5000)
    return () => clearInterval(id)
  }, [])

  const sendCommand = useCallback(
    async (type: string, payload: Record<string, unknown> = {}) => {
      await fetch("/api/world/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...payload }),
      })
    },
    []
  )

  return { state, world, alertLevel, metrics, events, sendCommand }
}
