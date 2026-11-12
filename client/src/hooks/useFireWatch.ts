import { useEffect, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import type {
  FireWatchState,
  FireNode,
  Incident,
  WorldState,
  AlertLevelPayload,
} from "@/types"

const DEFAULT_STATE: FireWatchState = {
  nodes: [],
  incident: null,
  weather: null,
  store: "memory",
  center: { lat: 35.135, lon: -5.215 },
  places: [],
  sirenOverride: null,
  simulatorConnected: false,
}

export function useFireWatch() {
  const [state, setState] = useState<FireWatchState>(DEFAULT_STATE)
  const [world, setWorld] = useState<WorldState | null>(null)
  const [alertLevel, setAlertLevel] = useState<AlertLevelPayload>({
    level: "veille",
    score: 0,
    riskIndex: { value: 0 },
  })
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io()
    socketRef.current = socket

    socket.on("state", (s: FireWatchState) => setState(s))

    socket.on("node", (n: FireNode) => {
      setState((prev) => ({
        ...prev,
        nodes: prev.nodes.some((x) => x.id === n.id)
          ? prev.nodes.map((x) => (x.id === n.id ? n : x))
          : [...prev.nodes, n],
      }))
    })

    socket.on("incident", (inc: Incident) =>
      setState((prev) => ({ ...prev, incident: inc }))
    )

    socket.on("world", (w: WorldState) => setWorld(w))

    socket.on("alert_level", (al: AlertLevelPayload) => setAlertLevel(al))

    socket.on("siren", (override: boolean | null) =>
      setState((prev) => ({ ...prev, sirenOverride: override }))
    )

    return () => {
      socket.disconnect()
    }
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

  return { state, world, alertLevel, sendCommand }
}
