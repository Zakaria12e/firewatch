"""
Automate cellulaire de propagation du feu.

États d'une cellule :
  'F'  fuel      – combustible, non brûlé
  'B'  burning   – en feu (temps restant en secondes simulées)
  'X'  burnt     – calciné
  'W'  wet       – mouillé (Canadair), avec temps de séchage
  'R'  rock      – non combustible (élévation trop haute ou fuel≈0)

Propagation (8-voisins) à chaque pas de temps :
  p = BASE · dt · density · dryness · exp(k_v · v · cos θ) · exp(k_p · slope)
  - θ   : angle entre le voisin et la direction vers laquelle souffle le vent
  - slope : pente en degrés (positif = montée = faveur le feu)

Chaque cellule en feu appartient à un foyer (`owner`) : une cellule allumée par
propagation hérite du foyer de la cellule source ; une saute de feu crée un
nouveau foyer. Un foyer reste actif tant qu'il lui reste au moins une cellule
en feu (et pas seulement sa cellule d'allumage).
"""
from __future__ import annotations

import math
import random
import time
from typing import Dict, List, Optional, Tuple

# Paramètres de propagation calibrés pour ~1 station/min de démo (900m en 900s sim)
# avec TIME_SCALE=15 (1s réelle = 15s sim), Chergui (vent 7m/s, hum 18%, fmc 8%)
BASE_PROB  = 0.018     # probabilité de base par seconde simulée
K_WIND     = 0.18      # facteur d'amplification du vent (par m/s dans le sens du vent)
K_SLOPE    = 0.07      # facteur d'amplification de la pente (par degré)
BURN_TIME  = 300.0     # secondes simulées qu'une cellule reste en feu
DRY_TIME   = 600.0     # secondes simulées avant qu'une cellule mouillée sèche

# Sautes de feu (spotting) : vent > 8 m/s → une cellule peut allumer loin
SPOT_MIN_M = 100.0
SPOT_MAX_M = 400.0
SPOT_PROB  = 0.00008   # par cellule en feu et par seconde simulée

MAX_SPOT_EVENTS = 50   # tampon d'événements entre deux snapshots

NEIGHBORS_8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def burn_profile(remaining):
    """
    Profil d'intensité d'une cellule selon son âge (0 → 1) :
    montée rapide, plateau, puis déclin vers les braises.
    """
    age = 1.0 - max(0.0, min(1.0, remaining / BURN_TIME))
    if age < 0.12:
        return 0.35 + 0.65 * age / 0.12
    if age < 0.55:
        return 1.0
    return 1.0 - 0.75 * (age - 0.55) / 0.45


class FireModel:
    """
    Gère l'état du feu sur la grille ROWS × COLS.

    grid[r][c] :
      ('F', None)                   – fuel disponible
      ('B', float)                  – burning, temps restant en s simulées
      ('X', None)                   – burnt
      ('W', float)                  – wet, temps de séchage restant
      ('R', None)                   – rock / non combustible
    owner[r][c] : id du foyer de la cellule (en feu ou calcinée), sinon None
    """

    def __init__(self, forest):
        from .forest import ROWS, COLS, CELL_M
        self._rows = ROWS
        self._cols = COLS
        self._cell_m = CELL_M
        self._forest = forest
        self.grid = []
        self.owner = []
        self._init_grid()
        self.fires = {}      # id → {id, start, startEpochMs, origin, parent, cells:[{r,c}]}
        self._fire_id_counter = 0
        self._spot_counter = 0
        self._spot_events = []   # sautes de feu depuis le dernier snapshot
        self._burning = []       # cache des cellules en feu [(r, c)]
        self._rng = random.Random()

    def _init_grid(self):
        self.grid = []
        self.owner = []
        for r in range(self._rows):
            row = []
            for c in range(self._cols):
                if self._forest.fuel[r][c] < 0.05:
                    row.append(('R', None))
                else:
                    row.append(('F', None))
            self.grid.append(row)
            self.owner.append([None] * self._cols)

    # ------------------------------------------------------------------
    # API publique
    # ------------------------------------------------------------------
    def _new_fire(self, r, c, parent=None):
        fid = "F{:03d}".format(self._fire_id_counter)
        self._fire_id_counter += 1
        now = time.time()
        self.fires[fid] = {
            "id": fid,
            "start": now,
            "startEpochMs": int(now * 1000),
            "origin": {"r": r, "c": c},
            "parent": parent,
            "cells": [{"r": r, "c": c}],
        }
        self.grid[r][c] = ('B', BURN_TIME)
        self.owner[r][c] = fid
        return fid

    def ignite(self, r, c):
        """Allume une cellule (si brûlable) et crée un foyer. Retourne True si réussi."""
        if not (0 <= r < self._rows and 0 <= c < self._cols):
            return False
        state, _ = self.grid[r][c]
        if state not in ('F', 'W'):
            return False
        self._new_fire(r, c)
        self._rebuild_cache()
        return True

    def ignite_cells(self, cells):
        """
        Allume un ensemble de cellules sous un même foyer (zone d'allumage, ligne de feu).
        La première cellule brûlable devient l'origine du foyer. Retourne l'id ou None.
        """
        burnable = []
        seen = set()
        for r, c in cells:
            if (r, c) in seen or not (0 <= r < self._rows and 0 <= c < self._cols):
                continue
            seen.add((r, c))
            if self.grid[r][c][0] in ('F', 'W'):
                burnable.append((r, c))
        if not burnable:
            return None
        fid = self._new_fire(*burnable[0])
        for r, c in burnable[1:]:
            self.grid[r][c] = ('B', BURN_TIME)
            self.owner[r][c] = fid
        self._rebuild_cache()
        self._refresh_fires()
        return fid

    def disk_cells(self, r, c, radius_m):
        """Cellules d'un disque de rayon radius_m centré sur (r, c), centre en premier."""
        rad = radius_m / self._cell_m
        n = int(math.ceil(rad))
        out = [(r, c)]
        for dr in range(-n, n + 1):
            for dc in range(-n, n + 1):
                if (dr or dc) and dr * dr + dc * dc <= rad * rad:
                    out.append((r + dr, c + dc))
        return out

    def fire_near(self, r, c, max_cells):
        """Foyer de la cellule en feu la plus proche de (r, c), à max_cells au plus."""
        best = None
        for br, bc in self._burning:
            d = (br - r) ** 2 + (bc - c) ** 2
            if d <= max_cells * max_cells and (best is None or d < best[0]):
                best = (d, self.owner[br][bc])
        return best[1] if best else None

    def put_out(self, fire_id=None):
        """
        Fin de scénario : les cellules en feu du foyer (ou de tous) deviennent calcinées.
        Retourne le nombre de cellules éteintes.
        """
        n = 0
        for r, c in list(self._burning):
            if fire_id is None or self.owner[r][c] == fire_id:
                self.grid[r][c] = ('X', None)
                n += 1
        self._rebuild_cache()
        self._refresh_fires()
        return n

    def extinguish(self, r, c, radius_m):
        """Canadair : éteint et mouille les cellules dans un rayon (mètres)."""
        radius_cells = max(1, int(radius_m / self._cell_m))
        for dr in range(-radius_cells, radius_cells + 1):
            for dc in range(-radius_cells, radius_cells + 1):
                if dr * dr + dc * dc > radius_cells * radius_cells:
                    continue
                nr, nc = r + dr, c + dc
                if not (0 <= nr < self._rows and 0 <= nc < self._cols):
                    continue
                state, _ = self.grid[nr][nc]
                if state in ('B', 'F'):
                    self.grid[nr][nc] = ('W', DRY_TIME)
                    self.owner[nr][nc] = None
        self._rebuild_cache()
        self._refresh_fires()

    def reset(self):
        """Réinitialise toutes les cellules à leur état initial."""
        self.fires.clear()
        self._spot_events = []
        self._init_grid()
        self._burning = []

    def burning_cells(self):
        """Liste de (r, c) actuellement en feu (cache mis à jour à chaque pas)."""
        return list(self._burning)

    def active_fire_count(self):
        return len(self._burning)

    # ------------------------------------------------------------------
    # Pas de simulation
    # ------------------------------------------------------------------
    def tick(self, dt_sim, weather):
        """
        Avance l'automate d'un pas de dt_sim secondes simulées.
        weather = {"wind_speed": m/s, "wind_dir": degrés (d'où vient le vent),
                   "hum": %, "fmc": %}.
        """
        wind_speed = weather.get("wind_speed", 0.0)
        wind_from = math.radians(weather.get("wind_dir", 0.0))
        # Direction vers laquelle souffle le vent (vecteur unitaire)
        wind_to_n = -math.cos(wind_from)
        wind_to_e = -math.sin(wind_from)

        hum = weather.get("hum", 50.0)
        fmc = weather.get("fmc", 20.0)
        dryness = max(0.2, (60 - hum) / 40) * max(0.3, (40 - fmc) / 40)

        # 1. Collecter les cellules en feu et celles qui peuvent brûler
        to_ignite = {}   # (r,c) → [proba cumulée, foyer, meilleure proba]
        to_expire = []
        to_dry   = []

        for r in range(self._rows):
            for c in range(self._cols):
                state, val = self.grid[r][c]

                if state == 'B':
                    new_time = val - dt_sim
                    if new_time <= 0:
                        to_expire.append((r, c))
                    else:
                        self.grid[r][c] = ('B', new_time)
                        fid = self.owner[r][c]
                        # Propagation aux 8 voisins
                        for dr, dc in NEIGHBORS_8:
                            nr, nc = r + dr, c + dc
                            if not (0 <= nr < self._rows and 0 <= nc < self._cols):
                                continue
                            ns, _ = self.grid[nr][nc]
                            if ns != 'F':
                                continue
                            neighbor_density = self._forest.fuel[nr][nc]
                            slope = self._forest.slope_between(r, c, nr, nc)
                            # Angle entre voisin et direction du vent (vecteur)
                            norm = math.sqrt(dr * dr + dc * dc)
                            vec_n = -dr / norm          # ligne croissante = vers le sud
                            vec_e = dc / norm
                            cos_theta = vec_n * wind_to_n + vec_e * wind_to_e
                            p = (BASE_PROB * dt_sim * neighbor_density * dryness
                                 * math.exp(K_WIND * wind_speed * cos_theta)
                                 * math.exp(K_SLOPE * slope))
                            p = min(0.95, p)
                            key = (nr, nc)
                            # On accumule : p_total = 1 - (1-p1)(1-p2)…
                            entry = to_ignite.get(key)
                            if entry is None:
                                to_ignite[key] = [p, fid, p]
                            else:
                                entry[0] = 1.0 - (1.0 - entry[0]) * (1.0 - p)
                                if p > entry[2]:
                                    entry[1] = fid
                                    entry[2] = p

                elif state == 'W':
                    new_dry = val - dt_sim
                    if new_dry <= 0:
                        to_dry.append((r, c))
                    else:
                        self.grid[r][c] = ('W', new_dry)

        # 2. Appliquer les allumages (la cellule hérite du foyer source)
        for (r, c), (p, fid, _) in to_ignite.items():
            if self._rng.random() < p:
                self.grid[r][c] = ('B', BURN_TIME)
                self.owner[r][c] = fid

        # 3. Fin de combustion → calciné (le foyer reste propriétaire)
        for r, c in to_expire:
            self.grid[r][c] = ('X', None)

        # 4. Cellules mouillées → sèches
        for r, c in to_dry:
            self.grid[r][c] = ('F', None)

        self._rebuild_cache()

        # 5. Sautes de feu (spotting) si vent fort
        if wind_speed > 8.0:
            self._do_spotting(dt_sim, wind_speed, wind_to_n, wind_to_e)

        # 6. Mettre à jour la liste des foyers
        self._refresh_fires()

    def _do_spotting(self, dt_sim, wind_speed, wind_to_n, wind_to_e):
        """Sautes de feu probabilistes sous vent fort : chaque saute crée un foyer."""
        for r, c in list(self._burning):
            if self._rng.random() > SPOT_PROB * dt_sim * wind_speed:
                continue
            dist = self._rng.uniform(SPOT_MIN_M, SPOT_MAX_M) / self._cell_m
            angle = self._rng.gauss(0, 0.3)   # légère dispersion angulaire
            cos_a, sin_a = math.cos(angle), math.sin(angle)
            # Vecteur (nord, est) sous le vent, tourné de `angle`
            dn = dist * (cos_a * wind_to_n - sin_a * wind_to_e)
            de = dist * (sin_a * wind_to_n + cos_a * wind_to_e)
            nr = int(round(r - dn))           # nord = ligne décroissante
            nc = int(round(c + de))
            if not (0 <= nr < self._rows and 0 <= nc < self._cols):
                continue
            if self.grid[nr][nc][0] != 'F':
                continue
            fid = self._new_fire(nr, nc, parent=self.owner[r][c])
            self._spot_counter += 1
            self._spot_events.append({
                "id": self._spot_counter,
                "from": [r, c],
                "to": [nr, nc],
                "fire": fid,
            })
            if len(self._spot_events) > MAX_SPOT_EVENTS:
                self._spot_events.pop(0)
        self._rebuild_cache()

    def _rebuild_cache(self):
        burning = []
        for r in range(self._rows):
            row = self.grid[r]
            for c in range(self._cols):
                if row[c][0] == 'B':
                    burning.append((r, c))
        self._burning = burning

    def _refresh_fires(self):
        """Associe les cellules en feu à leur foyer ; supprime les foyers éteints."""
        by_fire = {}
        for r, c in self._burning:
            fid = self.owner[r][c]
            if fid is None:
                continue
            by_fire.setdefault(fid, []).append({"r": r, "c": c})
        for fid in list(self.fires.keys()):
            cells = by_fire.get(fid)
            if not cells:
                del self.fires[fid]
            else:
                self.fires[fid]["cells"] = cells

    # ------------------------------------------------------------------
    # Serialisation compacte pour POST /api/sim/world
    # ------------------------------------------------------------------
    def compact_grid(self):
        """
        Chaîne de ROWS*COLS caractères : 'F','B','X','W','R'.
        """
        chars = []
        for r in range(self._rows):
            for c in range(self._cols):
                chars.append(self.grid[r][c][0])
        return "".join(chars)

    def burning_intensity(self):
        """
        Cellules en feu avec leur intensité (0-100) : densité du combustible ×
        profil de combustion. Format compact [[r, c, i], ...].
        """
        out = []
        for r, c in self._burning:
            remaining = self.grid[r][c][1] or 0.0
            density = self._forest.fuel[r][c]
            i = int(round(100 * max(0.05, min(1.0, density)) * burn_profile(remaining)))
            out.append([r, c, max(1, i)])
        return out

    def drain_spots(self):
        """Retourne et vide les sautes de feu survenues depuis le dernier appel."""
        events = self._spot_events
        self._spot_events = []
        return events

    def fires_snapshot(self):
        """Liste JSON-sérialisable des foyers actifs."""
        return [
            {
                "id": f["id"],
                "start": f["start"],
                "startEpochMs": f.get("startEpochMs", int(f["start"] * 1000)),
                "origin": dict(f["origin"]),
                "parent": f.get("parent"),
                "cells": [{"r": cell["r"], "c": cell["c"]} for cell in f["cells"]],
            }
            for f in self.fires.values()
        ]
