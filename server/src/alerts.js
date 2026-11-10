import { config } from "./config.js"
import { compass } from "./geo.js"

export function buildMessage(incident) {
  const dir = compass(incident.heading)
  const places = incident.threatenedPlaces
    .map((p) => `${p.name} (≈ ${p.eta} min)`)
    .join(", ")
  return {
    title: "🔥 ALERTE FEU DE FORÊT",
    message:
      `Feu confirmé par ${incident.suspects.length} capteur(s) (${incident.suspects.join(", ")}). ` +
      `Propagation vers le ${dir} à ~${incident.rosMPerMin} m/min.` +
      (places ? ` Menacé : ${places}.` : ""),
  }
}

async function sendNtfy({ title, message }) {
  if (!config.ntfyTopic) return null
  // Publication JSON : accepte les accents et les emojis (pas les en-têtes HTTP)
  const res = await fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: config.ntfyTopic,
      title,
      message,
      priority: 5,
      tags: ["fire", "rotating_light"],
    }),
  })
  return res.ok ? "ntfy" : null
}

async function sendPushover({ title, message }) {
  if (!config.pushoverToken || !config.pushoverUser) return null
  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body: new URLSearchParams({
      token: config.pushoverToken,
      user: config.pushoverUser,
      title,
      message,
      priority: "2",   // urgence : répété jusqu'à confirmation
      retry: "30",
      expire: "300",
      sound: "siren",
    }),
  })
  return res.ok ? "pushover" : null
}

/** Envoie l'alerte sur tous les canaux configurés, retourne ceux qui ont réussi. */
export async function notify(payload) {
  const results = await Promise.allSettled([sendNtfy(payload), sendPushover(payload)])
  const sent = results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value)
  results
    .filter((r) => r.status === "rejected")
    .forEach((r) => console.error("Alerte non envoyée :", r.reason?.message))
  return sent
}
