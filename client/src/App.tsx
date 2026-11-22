import { useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TopBar } from "@/components/TopBar"
import { Sidebar, type Page } from "@/components/Sidebar"
import { DevicePalette } from "@/components/DevicePalette"
import { FireMap } from "@/components/FireMap"
import { IncidentPanel } from "@/components/IncidentPanel"
import { PerformancePage } from "@/pages/PerformancePage"
import { ScenariosPage } from "@/pages/ScenariosPage"
import { DevicesPage } from "@/pages/DevicesPage"
import { IncidentsPage } from "@/pages/IncidentsPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { useFireWatch } from "@/hooks/useFireWatch"
import type { ReactNode } from "react"

/**
 * Page secondaire : grand panneau en verre à droite du dock (marge gauche =
 * dock + 16 px), le dock reste visible ; le contenu défile à l'intérieur.
 */
function PagePane({ children, pageKey }: { children: ReactNode; pageKey: string }) {
  return (
    <div
      key={pageKey}
      className="glass-solid anim-scale fixed z-20 overflow-hidden flex flex-col"
      style={{ left: "var(--dock-space)", right: 12, top: 64, bottom: 12, borderRadius: 18 }}
    >
      {children}
    </div>
  )
}

const setWeatherMode = (mode: string, preset?: string) =>
  fetch("/api/weather/mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preset ? { mode, preset } : { mode }),
  })

export default function App() {
  const { state, world, alertLevel, metrics, sendCommand } = useFireWatch()
  const [page, setPage] = useState<Page>("ops")
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null)

  const handleToggleSiren = () => {
    const on = state.sirenOverride === true ? null : true
    fetch("/api/siren", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
    })
  }

  const applyPreset = (preset: string) => {
    setWeatherMode("manuel", preset)
    sendCommand("preset", { name: preset })
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Carte en fond plein écran */}
      <FireMap
        state={state}
        world={world}
        alertLevel={alertLevel}
        sendCommand={sendCommand}
        active={page === "ops"}
        focus={focus}
      />

      {/* Chrome flottant */}
      <TopBar
        state={state}
        alertLevel={alertLevel}
        sirenOn={state.sirenOverride === true}
        onToggleSiren={handleToggleSiren}
      />
      <Sidebar page={page} onNavigate={setPage} />

      {/* Panneau Opérations : palette + incident */}
      {page === "ops" && (
        <>
          <DevicePalette
            weatherMode={state.weatherMode}
            onWeatherModeChange={(mode) => setWeatherMode(mode)}
            onWeatherPreset={applyPreset}
          />
          <IncidentPanel
            incident={state.incident}
            alertLevel={alertLevel}
            sendCommand={sendCommand}
          />
        </>
      )}

      {/* Pages secondaires */}
      {page === "devices" && (
        <PagePane pageKey="devices">
          <DevicesPage
            nodes={state.nodes}
            devices={world?.devices ?? []}
            sendCommand={sendCommand}
            onLocate={(lat, lon) => {
              setPage("ops")
              setFocus({ lat, lon, key: Date.now() })
            }}
          />
        </PagePane>
      )}
      {page === "perf" && (
        <PagePane pageKey="perf"><PerformancePage metrics={metrics} /></PagePane>
      )}
      {page === "scenarios" && (
        <PagePane pageKey="scenarios"><ScenariosPage sendCommand={sendCommand} /></PagePane>
      )}
      {page === "incidents" && (
        <PagePane pageKey="incidents"><IncidentsPage /></PagePane>
      )}
      {page === "settings" && (
        <PagePane pageKey="settings">
          <SettingsPage
            weatherMode={state.weatherMode}
            onWeatherModeChange={(mode) => setWeatherMode(mode)}
            onWeatherPreset={applyPreset}
          />
        </PagePane>
      )}

      <Toaster position="top-center" offset={64} />
    </div>
  )
}
