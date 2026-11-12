import { useEffect, useState } from "react"
import type { Incident, AlertLevel } from "@/types"

const LEVEL_COLOR: Record<AlertLevel, string> = {
  veille:        "text-muted-foreground",
  vigilance:     "text-yellow-400",
  suspicion:     "text-orange-400",
  "pré-alerte":  "text-orange-500",
  feu_confirmé:  "text-red-500",
  maîtrisé:      "text-green-400",
}

const LEVEL_BG: Record<AlertLevel, string> = {
  veille:        "bg-zinc-700",
  vigilance:     "bg-yellow-500",
  suspicion:     "bg-orange-500",
  "pré-alerte":  "bg-orange-600",
  feu_confirmé:  "bg-red-600",
  maîtrisé:      "bg-green-600",
}

function fmt(ms: number) {
  return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function duration(startMs: number, endMs?: number) {
  const s = Math.round(((endMs ?? Date.now()) - startMs) / 1000)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}

function IncidentTimeline({ incident }: { incident: Incident }) {
  const start = incident.startedAt
  const end = incident.endedAt ?? Date.now()
  const total = Math.max(1, end - start)
  const events = incident.timeline ?? []

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">Chronologie</div>
      <div className="relative">
        {/* Barre de fond */}
        <div className="h-2 rounded-full bg-zinc-800" />
        {/* Barre de progression */}
        <div
          className={`absolute top-0 left-0 h-2 rounded-full ${
            incident.status === "maîtrisé" ? "bg-green-600" : "bg-orange-500"
          }`}
          style={{ width: "100%" }}
        />
        {/* Marqueurs d'événements */}
        {events.map((ev, i) => {
          const pct = ((ev.at - start) / total) * 100
          return (
            <div
              key={i}
              className="absolute -top-1"
              style={{ left: `${Math.min(99, pct)}%` }}
              title={`${ev.type} – ${fmt(ev.at)}`}
            >
              <div className={`w-4 h-4 rounded-full border-2 border-background ${LEVEL_BG[ev.type]}`} />
            </div>
          )
        })}
      </div>
      {/* Légende */}
      <div className="flex flex-col gap-1 mt-4">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{fmt(start)}</span>
          <span>{incident.endedAt ? fmt(incident.endedAt) : "en cours"}</span>
        </div>
        {events.map((ev, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full shrink-0 ${LEVEL_BG[ev.type]}`} />
            <span className={LEVEL_COLOR[ev.type]}>{ev.type}</span>
            <span className="text-muted-foreground">{fmt(ev.at)}</span>
            <span className="text-muted-foreground">
              +{Math.round((ev.at - start) / 1000)} s depuis le début
            </span>
          </div>
        ))}
        {incident.endedAt && (
          <div className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full shrink-0 bg-green-600" />
            <span className="text-green-400">maîtrisé</span>
            <span className="text-muted-foreground">{fmt(incident.endedAt)}</span>
            {incident.reason && (
              <span className="text-muted-foreground">– {incident.reason}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function IncidentDetail({ incident }: { incident: Incident }) {
  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-3">
        <div className={`text-sm font-bold uppercase ${LEVEL_COLOR[incident.level]}`}>
          {incident.level}
        </div>
        <div className="text-xs font-mono text-muted-foreground">{incident.id}</div>
        <div
          className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
            incident.status === "actif"
              ? "bg-red-500/20 text-red-400"
              : "bg-green-500/20 text-green-400"
          }`}
        >
          {incident.status}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        <div>
          <span className="text-muted-foreground">Score </span>
          <span className="text-orange-400 font-bold">{incident.score}%</span>
        </div>
        <div>
          <span className="text-muted-foreground">Durée </span>
          {duration(incident.startedAt, incident.endedAt)}
        </div>
        {incident.position && (
          <>
            <div>
              <span className="text-muted-foreground">Lat </span>
              {incident.position.lat.toFixed(4)}
            </div>
            <div>
              <span className="text-muted-foreground">Lon </span>
              {incident.position.lon.toFixed(4)}
            </div>
          </>
        )}
        {incident.areaHa != null && (
          <div>
            <span className="text-muted-foreground">Surface </span>
            {incident.areaHa.toFixed(1)} ha
          </div>
        )}
        {incident.heading != null && (
          <div>
            <span className="text-muted-foreground">Direction </span>
            {incident.heading.toFixed(0)}°
          </div>
        )}
      </div>

      {incident.suspects.length > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">Capteurs suspects : </span>
          {incident.suspects.join(", ")}
        </div>
      )}

      {incident.alertsSent && incident.alertsSent.length > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">Alertes envoyées : </span>
          {incident.alertsSent.join(", ")}
        </div>
      )}

      <IncidentTimeline incident={incident} />
    </div>
  )
}

export function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selected, setSelected] = useState<Incident | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch("/api/incidents")
      .then((r) => r.json())
      .then((data) => { setIncidents(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Chargement…
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Liste */}
      <div className="w-72 shrink-0 border-r border-border overflow-y-auto">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-orange-400 uppercase tracking-widest">Incidents</h2>
          <div className="text-xs text-muted-foreground mt-0.5">{incidents.length} enregistré(s)</div>
        </div>
        {incidents.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Aucun incident enregistré.</div>
        ) : (
          incidents.map((inc) => (
            <button
              key={inc.id}
              onClick={() => setSelected(inc)}
              className={`w-full text-left p-3 border-b border-border/40 hover:bg-white/3 transition-colors ${
                selected?.id === inc.id ? "bg-orange-500/10" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    inc.status === "actif" ? "bg-red-500 animate-pulse" : "bg-zinc-600"
                  }`}
                />
                <span className="font-mono text-xs text-muted-foreground">{inc.id}</span>
              </div>
              <div className={`text-xs font-medium mt-0.5 ${LEVEL_COLOR[inc.level]}`}>
                {inc.level} · {inc.score}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {fmt(inc.startedAt)} · {duration(inc.startedAt, inc.endedAt)}
              </div>
            </button>
          ))
        )}
      </div>

      {/* Détail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <IncidentDetail incident={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sélectionner un incident
          </div>
        )}
      </div>
    </div>
  )
}
