import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import type { Metrics } from "@/types"
import { SizeLadder } from "@/components/LoraPacketPanel"

const FALSE_LABEL: Record<string, string> = {
  "brûlage_autorisé": "brûlage", "véhicule": "véhicule", "brouillard": "brouillard",
  "soleil": "soleil", "barbecue_probable": "barbecue",
}

interface Props {
  metrics: Metrics | null
}

function StatCard({ label, value, sub, color = "#FF5A1F", delay = 0 }: {
  label: string
  value: string | number
  sub?: string
  color?: string
  delay?: number
}) {
  return (
    <div
      className={`anim-up anim-d${delay as 1|2|3|4}`}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        padding: "12px 14px",
      }}
    >
      <div className="text-[9px] uppercase tracking-wider font-medium mb-1.5" style={{ color: "rgba(235,235,245,0.35)", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div className="text-[22px] font-semibold tabular leading-none" style={{ color, letterSpacing: "-0.5px" }}>{value}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color: "rgba(235,235,245,0.35)" }}>{sub}</div>}
    </div>
  )
}

function SectionCard({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) {
  return (
    <div className={`anim-up anim-d${delay as 1|2|3|4}`}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div className="text-[9px] uppercase tracking-wider font-medium mb-3" style={{ color: "rgba(235,235,245,0.3)", letterSpacing: "0.08em" }}>
        {title}
      </div>
      {children}
    </div>
  )
}

const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 11 },
  labelStyle: { color: "rgba(235,235,245,0.7)" },
  itemStyle: { color: "#FF5A1F" },
}

export function PerformancePage({ metrics }: Props) {
  if (!metrics) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: "rgba(235,235,245,0.35)" }}>
        Chargement des métriques…
      </div>
    )
  }

  const { detection, falseAlerts, network, data, health, scenarios } = metrics
  const detTimes  = detection.confirmTimes.map((t, i) => ({ name: `F${i + 1}`, s: t }))
  const suspTimes = detection.suspTimes.map((t, i) => ({ name: `F${i + 1}`, s: t }))
  const sfData = [7, 8, 9, 10, 11, 12].map((sf) => ({ sf: `SF${sf}`, n: network.sfHistogram?.[sf] ?? 0 }))
  const rejectedTotal = Object.values(network.rejected ?? {}).reduce((a, b) => a + b, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* En-tête */}
      <div className="shrink-0 px-5 pt-4 pb-3 anim-down" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="text-[13px] font-semibold text-white/90" style={{ letterSpacing: "-0.374px" }}>Performance</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto fw-scroll px-5 py-4 space-y-4">
        {/* Métriques résumé */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatCard delay={1}
            label="Confirmation"
            value={detection.avgConfirmS != null ? `${detection.avgConfirmS} s` : "—"}
            sub={`${detection.count} incendie(s)`}
            color="#FF5A1F"
          />
          <StatCard delay={2}
            label="Suspicion"
            value={detection.avgSuspS != null ? `${detection.avgSuspS} s` : "—"}
            sub="depuis le feu réel"
            color="#E0260E"
          />
          <StatCard delay={3}
            label="Fausses alertes évitées"
            value={falseAlerts.avoided}
            sub={Object.entries(falseAlerts.byKind ?? {}).map(([k, n]) => `${FALSE_LABEL[k] ?? k} ${n}`).join(" · ") || "aucune pour l'instant"}
            color="#ffffff"
          />
          <StatCard delay={4}
            label="Paquets reçus"
            value={network.packetsReceived.toLocaleString()}
            sub={`PDR : ${network.pdr} %`}
            color="#ffffff"
          />
        </div>

        {/* CBOR + Réseau */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
          <SectionCard title="Taille d'un paquet de mesures (moyenne)" delay={2}>
            {data.measureFrames > 0 ? (
              <>
                <SizeLadder sizes={{ json: data.avgJson, senmlCbor: data.avgSenmlCbor, compact: data.avgCompact }} maxPayload={51} sf={12} />
                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                  <div style={{ color: "rgba(235,235,245,0.4)" }}>Compact vs JSON<div className="text-[15px] font-semibold tabular" style={{ color: "#FF5A1F" }}>−{data.savingsPct} %</div></div>
                  <div style={{ color: "rgba(235,235,245,0.4)" }}>Compact vs SenML/CBOR<div className="text-[15px] font-semibold tabular text-white/80">−{Math.round(data.compactVsSenmlPct)} %</div></div>
                  <div style={{ color: "rgba(235,235,245,0.4)" }}>Trame complète<div className="text-[15px] font-semibold tabular text-white/80">{data.avgPhy} o</div></div>
                </div>
              </>
            ) : (
              <div className="text-[11px]" style={{ color: "rgba(235,235,245,0.35)" }}>Aucune trame de mesures reçue.</div>
            )}
          </SectionCard>

          <SectionCard title="Réseau LoRaWAN" delay={3}>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { l: "Airtime moyen", v: `${network.avgAirtimeMs.toLocaleString("fr-FR")} ms` },
                { l: "Duty cycle max", v: `${network.dutyCycle.maxPct.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} %`, sub: network.dutyCycle.maxId ? `${network.dutyCycle.maxId} · limite 1 %` : "limite 1 %" },
                { l: "Duty cycle moyen", v: `${network.dutyCycle.avgPct.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} %` },
                { l: "Inscriptions", v: String(network.inscriptions) },
                { l: "Hors charge utile", v: String(network.oversize), warn: network.oversize > 0 },
                { l: "Trames rejetées", v: String(rejectedTotal), sub: rejectedTotal ? Object.entries(network.rejected).map(([k, n]) => `${k} ${n}`).join(" · ") : undefined },
              ].map((x) => (
                <div key={x.l} className="px-2.5 py-1.5 rounded-lg min-w-0" style={{ background: x.warn ? "rgba(224,38,14,0.14)" : "rgba(255,255,255,0.04)" }}>
                  <div className="text-[9px]" style={{ color: "rgba(235,235,245,0.35)" }}>{x.l}</div>
                  <div className="text-[13px] font-semibold tabular text-white/85 truncate">{x.v}</div>
                  {x.sub && <div className="text-[9px] truncate" style={{ color: "rgba(235,235,245,0.3)" }}>{x.sub}</div>}
                </div>
              ))}
            </div>
            <div className="text-[9px] mb-1" style={{ color: "rgba(235,235,245,0.35)" }}>Trames par facteur d'étalement (ADR)</div>
            <ResponsiveContainer width="100%" height={92}>
              <BarChart data={sfData} margin={{ top: 4, right: 0, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="sf" tick={{ fontSize: 10, fill: "rgba(235,235,245,0.4)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(235,235,245,0.3)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v) => [`${v} trames`, "Reçues"]} />
                <Bar dataKey="n" fill="#FF5A1F" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard title="Santé réseau" delay={3}>
            <div className="flex items-end gap-2 mb-3">
              <div className="text-[28px] font-bold tabular leading-none" style={{ color: "#ffffff", letterSpacing: "-0.5px" }}>
                {health.online}
              </div>
              <div className="text-[11px] pb-1" style={{ color: "rgba(235,235,245,0.35)" }}>/ {health.total} appareils</div>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: health.total > 0 ? `${(health.online / health.total) * 100}%` : "0%",
                  background: "#FF5A1F",
                  transition: "width 0.6s cubic-bezier(0.34,1.56,0.64,1)",
                }}
              />
            </div>
            <div className="mt-2 text-[10px]" style={{ color: "rgba(235,235,245,0.3)" }}>
              PDR estimé : <span className="tabular text-white/50">{network.pdr} %</span>
            </div>
          </SectionCard>
        </div>

        {/* Graphiques détection */}
        {detTimes.length > 0 && (
          <SectionCard title="Temps de détection (secondes)" delay={3}>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={detTimes} margin={{ top: 0, right: 0, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "rgba(235,235,245,0.3)" }} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(235,235,245,0.3)" }} />
                <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => [`${v} s`, "Confirmation"]} />
                <Bar dataKey="s" fill="#FF5A1F" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {suspTimes.length > 0 && (
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={suspTimes} margin={{ top: 8, right: 0, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "rgba(235,235,245,0.3)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "rgba(235,235,245,0.3)" }} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => [`${v} s`, "Suspicion"]} />
                  <Bar dataKey="s" fill="#E0260E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        )}

        {/* Banc d'essai */}
        {scenarios.length > 0 && (
          <SectionCard title="Banc d'essai" delay={4}>
            <table className="w-full">
              <thead>
                <tr>
                  {["Scénario", "Détection", "Temps moy.", "CBOR"].map((h) => (
                    <th key={h} className="text-left pb-2 text-[9px] uppercase tracking-wider font-medium"
                      style={{ color: "rgba(235,235,245,0.3)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s, i) => (
                  <tr key={s.scenario}
                    className={`anim-up anim-d${Math.min(i + 1, 4) as 1|2|3|4}`}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td className="py-1.5 text-[11px] text-white/60 font-mono">{s.scenario}</td>
                    <td className="py-1.5 text-[11px] tabular" style={{ color: s.detection_rate >= 0.9 ? "#ffffff" : "#FF5A1F" }}>
                      {Math.round(s.detection_rate * 100)}%
                    </td>
                    <td className="py-1.5 text-[11px] tabular text-white/50">
                      {s.avg_det_time_s != null ? `${s.avg_det_time_s} s` : "—"}
                    </td>
                    <td className="py-1.5 text-[11px] tabular text-white/50">{s.avg_cbor_savings_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        )}

        {detection.count === 0 && scenarios.length === 0 && (
          <div className="flex items-center justify-center py-12 text-[12px]" style={{ color: "rgba(235,235,245,0.3)" }}>
            Aucun incident traité — allumez un feu ou lancez un scénario.
          </div>
        )}
      </div>
    </div>
  )
}
