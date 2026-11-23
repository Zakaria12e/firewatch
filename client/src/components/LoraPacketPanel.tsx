/**
 * Trame LoRaWAN d'un appareil (tiroir Appareils) : comparaison des tailles
 * SenML JSON → SenML/CBOR → CBOR compact, airtime, duty cycle, octets de la trame,
 * décodage positionnel, SenML reconstruit par le serveur, inscription et downlink.
 */
import type { CSSProperties } from "react"
import type { FireNode, LastPacket, PacketSizes } from "@/types"
import { C, alpha } from "@/lib/palette"

const SECTION = "text-[10px] uppercase font-semibold"
const SECTION_STYLE: CSSProperties = { color: C.text4, letterSpacing: "0.09em" }

const fr = (v: number, d = 0) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d })

const TYPE_LABEL: Record<LastPacket["type"], string> = {
  inscription: "Inscription · FPort 1",
  mesures: "Mesures compactes · FPort 2",
  senml: "SenML complet · FPort 3",
  backhaul: "Backhaul filaire (passerelle)",
}

// ---------------------------------------------------------------------------
// Échelle des tailles
// ---------------------------------------------------------------------------
export function SizeLadder({ sizes, maxPayload, sf }: { sizes: PacketSizes; maxPayload?: number; sf?: number }) {
  const json = sizes.json ?? 0
  const steps = [
    { label: "SenML JSON", bytes: sizes.json, color: C.gray, note: "RFC 8428, labels texte" },
    { label: "SenML / CBOR", bytes: sizes.senmlCbor, color: alpha("#ffffff", 0.55), note: "labels entiers" },
    { label: "CBOR compact", bytes: sizes.compact, color: C.fire, note: "tableau positionnel" },
  ].filter((s) => s.bytes !== undefined) as { label: string; bytes: number; color: string; note: string }[]
  const ref = Math.max(json, ...steps.map((s) => s.bytes), 1)
  const limitAt = maxPayload ? Math.min(100, (maxPayload / ref) * 100) : null

  return (
    <div className="flex flex-col gap-2">
      {steps.map((s) => {
        const pct = json > 0 && s.bytes !== json ? Math.round((1 - s.bytes / json) * 100) : null
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-[11px] mb-1">
              <span style={{ color: C.text2 }}>{s.label} <span style={{ color: C.text4 }}>· {s.note}</span></span>
              <span className="tabular" style={{ color: C.text }}>
                <b>{s.bytes} o</b>
                {pct !== null && <span style={{ color: s.color === C.fire ? C.fire : C.text3 }}> −{pct} %</span>}
              </span>
            </div>
            <div className="relative h-[6px] rounded-full" style={{ background: C.fill }}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (s.bytes / ref) * 100)}%`, background: s.color, transition: "width 0.5s cubic-bezier(0.34,1.56,0.64,1)" }} />
              {limitAt !== null && (
                <div className="absolute -top-[3px] -bottom-[3px] w-px" style={{ left: `${limitAt}%`, background: C.red }} />
              )}
            </div>
          </div>
        )
      })}
      {limitAt !== null && (
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: C.text3 }}>
          <span className="inline-block w-px h-2.5" style={{ background: C.red }} />
          charge utile max {sf ? `SF${sf}` : ""} : {maxPayload} o (EU868)
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Octets de la trame, segment par segment
// ---------------------------------------------------------------------------
function frameSegments(pkt: LastPacket) {
  const hdr = pkt.frame?.headerBytes ?? 9
  const total = pkt.hex.length / 2
  return [
    { label: "MHDR", from: 0, to: 1, color: C.text3 },
    { label: "DevAddr", from: 1, to: 5, color: C.text },
    { label: "FCtrl", from: 5, to: 6, color: C.text3 },
    { label: "FCnt", from: 6, to: 8, color: C.text },
    { label: "FPort", from: hdr - 1, to: hdr, color: C.text3 },
    { label: "FRMPayload", from: hdr, to: total - 4, color: C.fire },
    { label: "MIC", from: total - 4, to: total, color: alpha(C.red, 0.85) },
  ]
}

function FrameHex({ pkt }: { pkt: LastPacket }) {
  const bytes = pkt.hex.match(/.{1,2}/g) ?? []
  const segs = frameSegments(pkt)
  const colorAt = (i: number) => segs.find((s) => i >= s.from && i < s.to)?.color ?? C.text2
  return (
    <div>
      <div className="text-[10px] leading-[1.7] font-mono p-3 rounded-xl break-all" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${C.line}` }}>
        {bytes.map((b, i) => (
          <span key={i} style={{ color: colorAt(i) }}>{b}{i < bytes.length - 1 ? " " : ""}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px]">
        {segs.filter((s) => s.to > s.from).map((s) => (
          <span key={s.label} className="flex items-center gap-1" style={{ color: C.text3 }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="tabular" style={{ color: C.text4 }}>{s.to - s.from} o</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panneau
// ---------------------------------------------------------------------------
function Cell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="px-2.5 py-1.5 rounded-lg min-w-0" style={{ background: warn ? alpha(C.red, 0.14) : C.fill }}>
      <div className="text-[9px]" style={{ color: C.text4 }}>{label}</div>
      <div className="text-[11px] font-medium tabular truncate" style={{ color: warn ? C.text : C.text }}>{value}</div>
    </div>
  )
}

const scaleLabel = (s: number) => (s === 1 ? "—" : s > 1 ? `÷ ${s}` : `× ${fr(1 / s)}`)

export function LoraPacketPanel({ node }: { node: FireNode }) {
  const pkt = node.lastPacket
  const insc = node.inscription
  if (!pkt && !insc) return null
  const lora = pkt && pkt.type !== "backhaul"
  const factor = pkt?.timeFactor ?? 1
  const dutyLimit = 1
  const dutyPct = pkt?.dutyPct ?? 0

  return (
    <>
      {pkt && (
        <section>
          <div className="flex items-baseline justify-between mb-2 gap-2">
            <h3 className={SECTION} style={SECTION_STYLE}>Dernière trame</h3>
            <span className="text-[10px] whitespace-nowrap" style={{ color: C.text3 }}>{TYPE_LABEL[pkt.type]}</span>
          </div>
          <SizeLadder sizes={pkt.sizes} maxPayload={lora ? pkt.maxPayload : undefined} sf={pkt.radio?.sf} />

          {lora && (
            <>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <Cell label={`Airtime SF${pkt.radio?.sf ?? "—"}`} value={pkt.airtimeMs !== undefined ? `${fr(pkt.airtimeMs, 1)} ms` : "—"} />
                <Cell label="Charge utile" value={`${pkt.sizes.compact ?? "—"} / ${pkt.maxPayload ?? "—"} o`} warn={pkt.oversize} />
                <Cell label="Trame" value={`${pkt.sizes.phy ?? "—"} o`} />
                <Cell label="DevAddr" value={pkt.frame?.devAddr ?? "—"} />
                <Cell label="FCnt" value={pkt.frame ? `#${pkt.frame.fcnt}` : "—"} />
                <Cell label="Canal" value={pkt.radio?.freq ? `${fr(pkt.radio.freq, 1)} MHz` : "—"} />
              </div>
              {pkt.oversize && (
                <div className="mt-2 text-[11px] px-3 py-2 rounded-lg" style={{ background: alpha(C.red, 0.12), color: C.text }}>
                  Hors norme LoRaWAN : {pkt.sizes.compact} o dépassent la charge utile maximale du SF{pkt.radio?.sf} ({pkt.maxPayload} o).
                </div>
              )}

              {/* Duty cycle */}
              <div className="mt-3">
                <div className="flex items-baseline justify-between text-[11px] mb-1">
                  <span style={{ color: C.text2 }}>Duty cycle utilisé <span style={{ color: C.text4 }}>· heure glissante simulée</span></span>
                  <span className="tabular" style={{ color: C.text }}><b>{fr(dutyPct, 3)} %</b><span style={{ color: C.text4 }}> / {dutyLimit} %</span></span>
                </div>
                <div className="h-[6px] rounded-full overflow-hidden" style={{ background: C.fill }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(1, Math.min(100, (dutyPct / dutyLimit) * 100))}%`, background: dutyPct > dutyLimit * 0.8 ? C.red : C.fire }} />
                </div>
                {pkt.minPeriodS !== undefined && (
                  <div className="text-[10px] mt-1.5" style={{ color: C.text3 }}>
                    Silence imposé après cette trame : <span className="tabular" style={{ color: C.text2 }}>{fr(pkt.minPeriodS * factor, 1)} s simulées</span>
                    {" "}(<span className="tabular">{fr(pkt.minPeriodS, 2)} s</span> réelles à ×{fr(factor)}) · période ordonnée {node.period} s
                  </div>
                )}
              </div>

              <div className={`mt-4 mb-1.5 ${SECTION}`} style={SECTION_STYLE}>Octets de la trame</div>
              <FrameHex pkt={pkt} />
            </>
          )}

          {/* Décodage positionnel */}
          {pkt.fields && pkt.fields.length > 0 && (
            <>
              <div className={`mt-4 mb-1.5 ${SECTION}`} style={SECTION_STYLE}>Décodage du tableau compact</div>
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ background: C.fill }}>
                      {["#", "canal", "brut", "échelle", "valeur"].map((h, i) => (
                        <th key={h} className={`font-medium px-2.5 py-1.5 ${i >= 2 ? "text-right" : "text-left"}`} style={{ color: C.text4 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pkt.fields.map((f) => (
                      <tr key={f.pos} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td className="px-2.5 py-1 font-mono tabular" style={{ color: C.text4 }}>{f.pos}</td>
                        <td className="px-2.5 py-1 font-mono" style={{ color: C.text }}>{f.n}</td>
                        <td className="px-2.5 py-1 font-mono tabular text-right" style={{ color: C.fire }}>{f.raw ?? "null"}</td>
                        <td className="px-2.5 py-1 font-mono tabular text-right" style={{ color: C.text3 }}>{scaleLabel(f.scale)}</td>
                        <td className="px-2.5 py-1 font-mono tabular text-right" style={{ color: C.text2 }}>
                          {f.v ?? "—"} <span style={{ color: C.text4 }}>{f.u}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* SenML reconstruit */}
          {pkt.senml && pkt.senml.length > 0 && (
            <>
              <div className={`mt-4 mb-1.5 ${SECTION}`} style={SECTION_STYLE}>
                {pkt.type === "mesures" ? "SenML reconstruit par le serveur" : "SenML reçu"}
              </div>
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ background: C.fill }}>
                      {["n", "u", "valeur"].map((h) => (
                        <th key={h} className="text-left font-medium px-3 py-1.5" style={{ color: C.text4 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pkt.senml.map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td className="px-3 py-1 font-mono" style={{ color: C.text }}>{r.n}</td>
                        <td className="px-3 py-1 font-mono" style={{ color: C.text3 }}>{r.u ?? ""}</td>
                        <td className="px-3 py-1 font-mono tabular" style={{ color: C.text2 }}>
                          {r.v ?? (r.vb !== undefined ? String(r.vb) : r.vs ?? "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] mt-1.5 font-mono truncate" style={{ color: C.text4 }}>bn = {pkt.senml[0]?.bn} · bt = {pkt.senml[0]?.bt}</div>
            </>
          )}

          {!lora && (
            <>
              <div className={`mt-4 mb-1.5 ${SECTION}`} style={SECTION_STYLE}>Hexadécimal CBOR</div>
              <div className="text-[10px] leading-[1.7] font-mono p-3 rounded-xl break-all" style={{ background: "rgba(0,0,0,0.5)", color: C.text2, border: `1px solid ${C.line}` }}>
                {(pkt.hex.match(/.{1,2}/g) ?? []).join(" ")}
              </div>
            </>
          )}

          {/* Réponse CoAP */}
          {pkt.downlink && (
            <div className="mt-3 flex items-center justify-between gap-3 text-[11px] px-3 py-2 rounded-xl" style={{ background: C.fill }}>
              <span style={{ color: C.text2 }}>
                Réponse CoAP 2.04 · période <b className="tabular" style={{ color: C.text }}>{pkt.downlink.period} s</b>,
                sirène <b style={{ color: pkt.downlink.siren ? C.fire : C.text }}>{pkt.downlink.siren ? "oui" : "non"}</b>
              </span>
              <span className="font-mono tabular whitespace-nowrap" style={{ color: C.text4 }}>{pkt.downlink.hex} · {pkt.downlink.bytes} o</span>
            </div>
          )}
        </section>
      )}

      {/* Inscription */}
      {insc && (
        <section>
          <div className="flex items-baseline justify-between mb-2 gap-2">
            <h3 className={SECTION} style={SECTION_STYLE}>Inscription LoRaWAN</h3>
            <span className="text-[10px] tabular whitespace-nowrap" style={{ color: C.text3 }}>
              {new Date(insc.at).toLocaleTimeString("fr-FR")} · {insc.sizes.compact} o
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Cell label="Schéma" value={`v${insc.version}`} />
            <Cell label="Type" value={insc.kind} />
            <Cell label="DevAddr" value={insc.frame?.devAddr ?? "—"} />
            <Cell label="Airtime" value={insc.airtimeMs !== undefined ? `${fr(insc.airtimeMs, 0)} ms` : "—"} />
          </div>
          <div className="text-[10px] mt-2 font-mono tabular" style={{ color: C.text3 }}>
            position {insc.lat.toFixed(5)}, {insc.lon.toFixed(5)} · envoyée une fois, puis à chaque déplacement
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {insc.fields.map((f, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded-md text-[10px] font-mono" style={{ background: C.fill, color: C.text2 }}>
                <span style={{ color: C.text4 }}>{i}·</span>{f.name} <span style={{ color: C.text4 }}>{f.u}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
