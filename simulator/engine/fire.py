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

NEIGHBORS_8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


class FireModel:
    """
    Gère l'état du feu sur la grille ROWS × COLS.

    grid[r][c] :
      ('F', None)                   – fuel disponible
      ('B', float)                  – burning, temps restant en s simulées
      ('X', None)                   – burnt
      ('W', float)                  – wet, temps de séchage restant
      ('R', None)                   – rock / non combustible
    """

    def __init__(self, forest):
        from .forest import ROWS, COLS, CELL_M
        self._rows = ROWS
        self._cols = COLS
        self._cell_m = CELL_M
        self._forest = forest
        # Initialiser la grille depuis la densité de combustible
        self.grid = []
        for r in range(ROWS):
            row = []
            for c in range(COLS):
                if forest.fuel[r][c] < 0.05:
                    row.append(('R', None))
                else:
                    row.append(('F', None))
            self.grid.append(row)
        self.fires = {}      # id → {id, start_time, cells:[{r,c}]}
        self._fire_id_counter = 0
        self._rng = random.Random()

    # ------------------------------------------------------------------
    # API publique
    # ------------------------------------------------------------------
    def ignite(self, r, c):
        """Allume une cellule (si brûlable). Retourne True si réussi."""
        if not (0 <= r < self._rows and 0 <= c < self._cols):
            return False
        state, _ = self.grid[r][c]
        if state not in ('F', 'W'):
            return False
        self.grid[r][c] = ('B', BURN_TIME)
        fid = "F{:03d}".format(self._fire_id_counter)
        self._fire_id_counter += 1
        self.fires[fid] = {"id": fid, "start": time.time(), "cells": [{"r": r, "c": c}]}
        return True

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

    def reset(self):
        """Réinitialise toutes les cellules à leur état initial."""
        self.fires.clear()
        for r in range(self._rows):
            for c in range(self._cols):
                if self._forest.fuel[r][c] < 0.05:
                    self.grid[r][c] = ('R', None)
                else:
                    self.grid[r][c] = ('F', None)

    def burning_cells(self):
        """Liste de (r, c) actuellement en feu."""
        result = []
        for r in range(self._rows):
            for c in range(self._cols):
                if self.grid[r][c][0] == 'B':
                    result.append((r, c))
        return result

    def active_fire_count(self):
        return sum(1 for r in range(self._rows) for c in range(self._cols)
                   if self.grid[r][c][0] == 'B')

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
        to_ignite = {}   # (r,c) → proba cumulée (on appliquera une fois à la fin)
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
                            vec_n = (nr - r) / math.sqrt(dr * dr + dc * dc)
                            vec_e = (nc - c) / math.sqrt(dr * dr + dc * dc)
                            cos_theta = vec_n * wind_to_n + vec_e * wind_to_e
                            p = (BASE_PROB * dt_sim * neighbor_density * dryness
                                 * math.exp(K_WIND * wind_speed * cos_theta)
                                 * math.exp(K_SLOPE * slope))
                            p = min(0.95, p)
                            key = (nr, nc)
                            # On accumule : p_total = 1 - (1-p1)(1-p2)…
                            prev = to_ignite.get(key, 0.0)
                            to_ignite[key] = 1.0 - (1.0 - prev) * (1.0 - p)

                elif state == 'W':
                    new_dry = val - dt_sim
                    if new_dry <= 0:
                        to_dry.append((r, c))
                    else:
                        self.grid[r][c] = ('W', new_dry)

        # 2. Appliquer les allumages
        for (r, c), p in to_ignite.items():
            if self._rng.random() < p:
                self.grid[r][c] = ('B', BURN_TIME)

        # 3. Fin de combustion → calciné
        for r, c in to_expire:
            self.grid[r][c] = ('X', None)

        # 4. Cellules mouillées → sèches
        for r, c in to_dry:
            self.grid[r][c] = ('F', None)

        # 5. Sautes de feu (spotting) si vent fort
        if wind_speed > 8.0:
            self._do_spotting(dt_sim, wind_speed, wind_to_n, wind_to_e, dryness)

        # 6. Mettre à jour la liste des foyers
        self._refresh_fires()

    def _do_spotting(self, dt_sim, wind_speed, wind_to_n, wind_to_e, dryness):
        """Sautes de feu probabilistes sous vent fort."""
        burning = self.burning_cells()
        for r, c in burning:
            if self._rng.random() > SPOT_PROB * dt_sim * wind_speed:
                continue
            dist = self._rng.uniform(SPOT_MIN_M, SPOT_MAX_M) / self._cell_m
            angle = self._rng.gauss(0, 0.3)   # légère dispersion angulaire
            cos_a, sin_a = math.cos(angle), math.sin(angle)
            dn = dist * (cos_a * wind_to_n - sin_a * wind_to_e)
            de = dist * (sin_a * wind_to_n + cos_a * wind_to_e)
            nr = int(r + dn + 0.5)
            nc = int(c + de + 0.5)
            if not (0 <= nr < self._rows and 0 <= nc < self._cols):
                continue
            if self.grid[nr][nc][0] == 'F':
                self.grid[nr][nc] = ('B', BURN_TIME)

    def _refresh_fires(self):
        """Nettoie les foyers éteints ; associe les cellules en feu aux foyers connus."""
        burning = set(self.burning_cells())
        # Supprimer les foyers sans cellule active
        extinct = [fid for fid, f in self.fires.items()
                   if not any((cell["r"], cell["c"]) in burning for cell in f["cells"])]
        for fid in extinct:
            del self.fires[fid]

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

    def fires_snapshot(self):
        """Liste JSON-sérialisable des foyers actifs."""
        return [
            {"id": f["id"], "start": f["start"],
             "cells": [{"r": cell["r"], "c": cell["c"]} for cell in f["cells"]]}
            for f in self.fires.values()
        ]
