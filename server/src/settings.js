/**
 * Paramètres de détection configurables depuis /api/settings.
 * Les valeurs par défaut correspondent aux constantes dures dans indicators.js / fusion.js.
 * Lorsqu'on les modifie ici, le pipeline les lira au prochain appel via getSettings().
 */

const defaults = {
  thresholds: {
    smokePpm: 300,
    coPpm: 35,
    tempRisePerMin: 3,
    humDropPerMin: 5,
    irHot: 0.6,
    tmaxHot: 60,
  },
  fusion: {
    weightFlame: 40,
    weightThermal: 45,
    weightSmoke: 25,
    weightCO: 20,
    weightTempRise: 15,
    weightHumDrop: 10,
    minConfirmScore: 75,
    minPreAlertScore: 50,
    minSuspicionScore: 20,
  },
  alerts: {
    ntfyEnabled: true,
    pushoverEnabled: true,
  },
  burnZones: [],   // [{id, name, polygon:[[lat,lon]…]}]
}

let current = JSON.parse(JSON.stringify(defaults))

export const getSettings = () => JSON.parse(JSON.stringify(current))

export function updateSettings(patch) {
  if (patch.thresholds) Object.assign(current.thresholds, patch.thresholds)
  if (patch.fusion)     Object.assign(current.fusion,     patch.fusion)
  if (patch.alerts)     Object.assign(current.alerts,     patch.alerts)
  if (Array.isArray(patch.burnZones)) current.burnZones = patch.burnZones
  return getSettings()
}

export function resetSettings() {
  current = JSON.parse(JSON.stringify(defaults))
  return getSettings()
}
