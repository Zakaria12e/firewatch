/**
 * Carte statique de la zone (shared/terrain.json) : piste, hameau, parcelles agricoles.
 * C'est l'équivalent d'un SIG : le serveur la connaît comme n'importe quel centre
 * opérationnel connaît ses routes. Ce n'est pas la vérité terrain du feu.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
export const TERRAIN = JSON.parse(fs.readFileSync(path.resolve(here, "../../shared/terrain.json"), "utf-8"))

export const ROADS = TERRAIN.roads ?? []
export const VILLAGES = TERRAIN.villages ?? []
export const PARCELS = TERRAIN.parcels ?? []
