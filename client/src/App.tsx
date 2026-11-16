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

function PagePane({ children, pageKey }: { children: ReactNode; pageKey: string }) {
  return (
    <div
      key={pageKey}
      className="glass-solid anim-scale fixed top-16 bottom-3 z-20 overflow-hidden flex flex-col"
      style={{ left: 72, right: 12, borderRadius: 18 }}
    >
      {children}
    </div>
  )
}

export default function App() {
  const { state, world, alertLevel, metrics, sendCommand } = useFireWatch()
  const [page, setPage] = useState<Page>("ops")

  const handleToggleSiren = () => {
    const on = state.sirenOverride === true ? null : true
    fetch("/api/siren", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
    })
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Carte en fond plein écran */}
      <FireMap
        state={state}
        world={world}
        alertLevel={alertLevel}
        sendCommand={sendCommand}
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
            onWeatherModeChange={(mode) => {
              fetch("/api/weather/mode", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode }),
              })
            }}
            onWeatherPreset={(preset) => {
              fetch("/api/weather/mode", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "manuel", preset }),
              })
              sendCommand("preset", { name: preset })
            }}
          />
          <IncidentPanel
            incident={state.incident}
            alertLevel={alertLevel}
            sendCommand={sendCommand}
          />
        </>
      )}

      {/* Pages secondaires : panneau verre opaque sur la carte */}
      {page === "devices" && (
        <PagePane pageKey="devices"><DevicesPage nodes={state.nodes} sendCommand={sendCommand} /></PagePane>
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
        <PagePane pageKey="settings"><SettingsPage /></PagePane>
      )}

      <Toaster richColors position="bottom-right" />
    </div>
  )
}
