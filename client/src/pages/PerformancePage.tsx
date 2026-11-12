import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts"
import type { Metrics } from "@/types"

interface Props {
  metrics: Metrics | null
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-card/50 border border-border rounded-lg p-4 flex flex-col gap-1">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-mono font-bold text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function PerformancePage({ metrics }: Props) {
  if (!metrics) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Chargement des métriques…
      </div>
    )
  }

  const { detection, falseAlerts, network, data, health, scenarios } = metrics

  const detTimes = detection.confirmTimes.map((t, i) => ({ name: `F${i + 1}`, s: t }))
  const suspTimes = detection.suspTimes.map((t, i) => ({ name: `F${i + 1}`, s: t }))

  const cborData = [{ name: "Économie", value: data.savingsPct, fill: "#f97316" }]

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      <h2 className="text-lg font-semibold text-orange-400 uppercase tracking-widest">
        Performance
      </h2>

      {/* Cartes résumé */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Temps de confirmation"
          value={detection.avgConfirmS != null ? `${detection.avgConfirmS} s` : "—"}
          sub={`${detection.count} incendie(s) traité(s)`}
        />
        <StatCard
          label="Temps jusqu'à suspicion"
          value={detection.avgSuspS != null ? `${detection.avgSuspS} s` : "—"}
          sub="depuis le début réel du feu"
        />
        <StatCard
          label="Fausses alertes évitées"
          value={falseAlerts.avoided}
        />
        <StatCard
          label="Paquets reçus"
          value={network.packetsReceived.toLocaleString()}
          sub={`PDR estimé : ${network.pdr} %`}
        />
      </div>

      {/* CBOR vs JSON */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="bg-card/50 border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Économie CBOR vs JSON
          </div>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={120} height={120}>
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="70%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                data={cborData}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={6} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div>
              <div className="text-3xl font-mono font-bold text-orange-400">
                {data.savingsPct} %
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                CBOR moyen&nbsp;: {data.avgPacketCbor} o
              </div>
              <div className="text-xs text-muted-foreground">
                JSON estimé&nbsp;: {data.jsonEstBytes > 0
                  ? Math.round(data.jsonEstBytes / Math.max(1, network.packetsReceived)) + " o/paquet"
                  : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card/50 border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Santé du réseau de capteurs
          </div>
          <div className="flex items-end gap-2 mt-2">
            <div className="text-3xl font-mono font-bold text-green-400">{health.online}</div>
            <div className="text-muted-foreground mb-1">/ {health.total} en ligne</div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-zinc-800">
            <div
              className="h-2 rounded-full bg-green-500 transition-all"
              style={{ width: health.total > 0 ? `${(health.online / health.total) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </div>

      {/* Graphiques des temps de détection */}
      {detTimes.length > 0 && (
        <div className="bg-card/50 border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
            Temps de détection par incendie (secondes)
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={detTimes} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#71717a" }} />
              <YAxis tick={{ fontSize: 11, fill: "#71717a" }} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
                labelStyle={{ color: "#f4f4f5" }}
                itemStyle={{ color: "#f97316" }}
                formatter={(v) => [`${v} s`, "Confirmation"]}
              />
              <Bar dataKey="s" fill="#f97316" radius={[3, 3, 0, 0]} name="Confirmation" />
            </BarChart>
          </ResponsiveContainer>
          {suspTimes.length > 0 && (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={suspTimes} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#71717a" }} />
                <YAxis tick={{ fontSize: 11, fill: "#71717a" }} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
                  formatter={(v) => [`${v} s`, "Suspicion"]}
                />
                <Bar dataKey="s" fill="#eab308" radius={[3, 3, 0, 0]} name="Suspicion" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Résultats banc d'essai */}
      {scenarios.length > 0 && (
        <div className="bg-card/50 border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Banc d'essai
          </div>
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-muted-foreground text-xs border-b border-border">
                <th className="text-left pb-2">Scénario</th>
                <th className="text-right pb-2">Taux détection</th>
                <th className="text-right pb-2">Temps moyen</th>
                <th className="text-right pb-2">Économie CBOR</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.scenario} className="border-b border-border/40">
                  <td className="py-1.5">{s.scenario}</td>
                  <td className="text-right py-1.5">{Math.round(s.detection_rate * 100)} %</td>
                  <td className="text-right py-1.5">
                    {s.avg_det_time_s != null ? `${s.avg_det_time_s} s` : "—"}
                  </td>
                  <td className="text-right py-1.5">{s.avg_cbor_savings_pct} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detection.count === 0 && scenarios.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-10">
          Aucun incident traité pour l'instant.
          Allumez un feu depuis la page Opérations ou lancez un scénario.
        </div>
      )}
    </div>
  )
}
