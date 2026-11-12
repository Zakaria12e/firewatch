import { RotateCcw } from "lucide-react"

const SCENARIOS = [
  {
    name: "chergui",
    label: "Chergui",
    desc: "Feu à l'est, vent fort d'est – détection rapide sous le vent.",
    color: "border-red-500/50 hover:border-red-500",
  },
  {
    name: "au-vent",
    label: "Au vent",
    desc: "Feu à l'ouest, vent d'est – fumée s'éloigne, détection plus lente.",
    color: "border-orange-500/50 hover:border-orange-500",
  },
  {
    name: "nuit",
    label: "Nuit",
    desc: "Feu de nuit, faible vent.",
    color: "border-blue-500/50 hover:border-blue-500",
  },
  {
    name: "deux-foyers",
    label: "Deux foyers",
    desc: "Sautes de feu – deux incidents séparés.",
    color: "border-red-500/50 hover:border-red-500",
  },
  {
    name: "changement-vent",
    label: "Changement de vent",
    desc: "Vent tourne de 90° pendant le feu – prédiction pivote.",
    color: "border-yellow-500/50 hover:border-yellow-500",
  },
  {
    name: "pluie",
    label: "Pluie",
    desc: "Feu démarre, pluie arrive et l'éteint – incident maîtrisé.",
    color: "border-cyan-500/50 hover:border-cyan-500",
  },
]

interface Props {
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
}

export function ScenariosPage({ sendCommand }: Props) {
  const launch = (name: string) => sendCommand("scenario", { name })
  const reset = () => {
    fetch("/api/scenario/reset", { method: "POST" }).catch(() => {})
    fetch("/api/metrics/reset", { method: "POST" }).catch(() => {})
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-orange-400 uppercase tracking-widest">
          Scénarios
        </h2>
        <button
          onClick={reset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Réinitialiser
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SCENARIOS.map((sc) => (
          <button
            key={sc.name}
            onClick={() => launch(sc.name)}
            className={`text-left p-4 rounded-lg bg-card/40 border transition-colors ${sc.color}`}
          >
            <div className="font-semibold text-sm text-foreground mb-1">{sc.label}</div>
            <div className="text-xs text-muted-foreground leading-relaxed">{sc.desc}</div>
          </button>
        ))}
      </div>

      <div className="bg-card/30 border border-border rounded-lg p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-2">Banc d'essai automatique</p>
        <p>
          Lance le banc d'essai depuis le terminal du simulateur :{" "}
          <code className="font-mono text-xs bg-black/40 px-1.5 py-0.5 rounded">
            python firewatch_sim.py --bench 5
          </code>
        </p>
        <p className="mt-1">
          Les résultats apparaissent automatiquement dans la page{" "}
          <span className="text-orange-400">Performance</span> une fois le banc terminé.
        </p>
      </div>
    </div>
  )
}
