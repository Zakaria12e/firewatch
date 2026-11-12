import { useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TopBar } from "@/components/TopBar"
import { Sidebar, type Page } from "@/components/Sidebar"
import { DevicePalette } from "@/components/DevicePalette"
import { FireMap } from "@/components/FireMap"
import { IncidentPanel } from "@/components/IncidentPanel"
import { PerformancePage } from "@/pages/PerformancePage"
import { ScenariosPage } from "@/pages/ScenariosPage"
import { useFireWatch } from "@/hooks/useFireWatch"

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
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <TopBar
        state={state}
        alertLevel={alertLevel}
        sirenOn={state.sirenOverride === true}
        onToggleSiren={handleToggleSiren}
      />

      <div className="flex flex-1 overflow-hidden pt-12">
        <Sidebar page={page} onNavigate={setPage} />

        {page === "ops" && (
          <div className="flex flex-1 overflow-hidden">
            {/* Panneau gauche – palette */}
            <div className="w-44 shrink-0 border-r border-border overflow-y-auto bg-card/30">
              <DevicePalette />
            </div>

            {/* Carte 3D */}
            <FireMap
              state={state}
              world={world}
              alertLevel={alertLevel}
              sendCommand={sendCommand}
            />

            {/* Panneau droit – incident */}
            <IncidentPanel
              incident={state.incident}
              alertLevel={alertLevel}
              sendCommand={sendCommand}
            />
          </div>
        )}

        {page === "perf" && (
          <PerformancePage metrics={metrics} />
        )}

        {page === "scenarios" && (
          <ScenariosPage sendCommand={sendCommand} />
        )}
      </div>

      <Toaster richColors position="bottom-right" />
    </div>
  )
}
