/**
 * Modèle numérique de terrain (MNT) de la zone : grille 120 × 96 de 50 m, la même que
 * celle du simulateur (simulator/cache/elevation.json, issue d'Open-Meteo Elevation).
 * Comme la carte de la zone, c'est une donnée SIG statique (le relief), pas la vérité
 * terrain du feu. Sans fichier : terrain inconnu, toute ligne de vue est supposée dégagée.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CENTER } from "./config.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(here, "../../simulator/cache/elevation.json")
const CELL_M = 50
const M_PER_DEG = 111_320

let grid = null   // { rows, cols, elev: number[], originLat, originLon, lonPerCell, latPerCell }

function load() {
  if (grid !== null) return grid
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf-8"))
    const latPerCell = CELL_M / M_PER_DEG
    const lonPerCell = CELL_M / (M_PER_DEG * Math.cos((CENTER.lat * Math.PI) / 180))
    grid = {
      rows: d.rows, cols: d.cols, elev: d.elev, latPerCell, lonPerCell,
      originLat: CENTER.lat + (d.rows / 2) * latPerCell,
      originLon: CENTER.lon - (d.cols / 2) * lonPerCell,
    }
  } catch {
    grid = false
  }
  return grid
}

/** Altitude (m) au point, ou null si le relief est inconnu. */
export function elevationAt(lat, lon) {
  const g = load()
  if (!g) return null
  const r = Math.min(g.rows - 1, Math.max(0, Math.floor((g.originLat - lat) / g.latPerCell)))
  const c = Math.min(g.cols - 1, Math.max(0, Math.floor((lon - g.originLon) / g.lonPerCell)))
  return g.elev[r * g.cols + c]
}

/**
 * Ligne de vue caméra → cible (même règle que la caméra simulée) : caméra sur un mât de
 * 8 m, cible 6 m au-dessus du sol (flammes), relief + 4 m de canopée sur le trajet.
 */
export function lineOfSight(cam, target, { mastM = 8, targetM = 6, canopyM = 4, samples = 10 } = {}) {
  const h0 = elevationAt(cam.lat, cam.lon)
  const h1 = elevationAt(target.lat, target.lon)
  if (h0 === null || h1 === null) return true
  const a = h0 + mastM
  const b = h1 + targetM
  for (let i = 1; i < samples; i++) {
    const t = i / samples
    const ground = elevationAt(cam.lat + (target.lat - cam.lat) * t, cam.lon + (target.lon - cam.lon) * t)
    if (ground + canopyM > a + (b - a) * t) return false
  }
  return true
}

export const demAvailable = () => !!load()
