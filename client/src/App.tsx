import { Toaster } from "@/components/ui/sonner"
import { TopBar } from "@/components/TopBar"
import { DevicePalette } from "@/components/DevicePalette"
import { FireMap } from "@/components/FireMap"
import { IncidentPanel } from "@/components/IncidentPanel"
import { useFireWatch } from "@/hooks/useFireWatch"

export default function App() {
  const { state, world, alertLevel, sendCommand } = useFireWatch()

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

      <Toaster richColors position="bottom-right" />
    </div>
  )
}
