"""
Grille de la forêt : élévation, couverture, densité du combustible.
Grille 120 × 96 cellules de 50 m ≈ 6 km × 4,8 km, centrée sur Talassemtane.
"""
from __future__ import annotations

import json
import math
import os
import random
import urllib.request

CENTER_LAT = 35.135
CENTER_LON = -5.215
ROWS = 96
COLS = 120
CELL_M = 50          # taille d'une cellule en mètres

# Coin nord-ouest de la grille (origine)
_half_ns = (ROWS / 2) * CELL_M
_half_ew = (COLS / 2) * CELL_M
ORIGIN_LAT = CENTER_LAT + _half_ns / 111_320
ORIGIN_LON = CENTER_LON - _half_ew / (111_320 * math.cos(math.radians(CENTER_LAT)))

CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "cache", "elevation.json")


# ---------------------------------------------------------------------------
# Géométrie
# ---------------------------------------------------------------------------
def latlon_to_cell(lat, lon):
    """Coordonnées GPS → (row, col) dans la grille (peut être hors-grille)."""
    north = (ORIGIN_LAT - lat) * 111_320
    east  = (lon - ORIGIN_LON) * 111_320 * math.cos(math.radians(CENTER_LAT))
    row = int(north / CELL_M)
    col = int(east / CELL_M)
    return row, col


def cell_to_latlon(row, col):
    """Centre d'une cellule → coordonnées GPS."""
    lat = ORIGIN_LAT - (row + 0.5) * CELL_M / 111_320
    lon = ORIGIN_LON + (col + 0.5) * CELL_M / (111_320 * math.cos(math.radians(CENTER_LAT)))
    return lat, lon


# ---------------------------------------------------------------------------
# Élévation
# ---------------------------------------------------------------------------
def _fetch_elevation_batch(lats, lons):
    """Appel Open-Meteo Elevation API pour un lot de points."""
    lat_str = ",".join("{:.5f}".format(la) for la in lats)
    lon_str = ",".join("{:.5f}".format(lo) for lo in lons)
    url = "https://api.open-meteo.com/v1/elevation?latitude={}&longitude={}".format(lat_str, lon_str)
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.load(r)["elevation"]


def load_elevation():
    """
    Charge (ou calcule) la matrice d'élévation ROWS×COLS (en mètres).
    Mise en cache dans simulator/cache/elevation.json.
    Repli procédural si Open-Meteo indisponible.
    """
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, "r") as f:
            data = json.load(f)
        if data.get("rows") == ROWS and data.get("cols") == COLS:
            flat = data["elev"]
            return [[flat[r * COLS + c] for c in range(COLS)] for r in range(ROWS)]

    print("🗺️  Téléchargement du relief (Open-Meteo Elevation)…")
    elev = _make_procedural_elevation()   # valeur par défaut si API échoue
    try:
        # API supporte max 1000 points par requête → on découpe
        all_lats, all_lons = [], []
        for r in range(ROWS):
            for c in range(COLS):
                la, lo = cell_to_latlon(r, c)
                all_lats.append(la)
                all_lons.append(lo)

        BATCH = 900
        flat = []
        for start in range(0, ROWS * COLS, BATCH):
            end = min(start + BATCH, ROWS * COLS)
            flat.extend(_fetch_elevation_batch(all_lats[start:end], all_lons[start:end]))
            # petite pause pour ne pas spammer l'API
            if end < ROWS * COLS:
                import time; time.sleep(0.3)

        elev = [[flat[r * COLS + c] for c in range(COLS)] for r in range(ROWS)]
        print("✅  Relief chargé ({} cellules).".format(ROWS * COLS))
    except Exception as exc:
        print("⚠️  Open-Meteo Elevation indisponible ({}) → relief procédural.".format(exc.__class__.__name__))

    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    flat2 = [elev[r][c] for r in range(ROWS) for c in range(COLS)]
    with open(CACHE_PATH, "w") as f:
        json.dump({"rows": ROWS, "cols": COLS, "elev": flat2}, f)
    return elev


def _make_procedural_elevation():
    """Relief procédural si Open-Meteo indisponible : crêtes, vallée centrale."""
    rng = random.Random(42)
    elev = [[0.0] * COLS for _ in range(ROWS)]
    # Crête nord-sud à l'ouest + vallée centrale
    for r in range(ROWS):
        for c in range(COLS):
            x = c / COLS - 0.5    # -0.5 … 0.5
            y = r / ROWS - 0.5
            # Relief de base : crête à l'est
            base = 800 + 600 * math.exp(-((x - 0.3) ** 2) / 0.04) \
                       + 400 * math.exp(-((x + 0.2) ** 2) / 0.08) \
                       - 200 * math.exp(-(y ** 2) / 0.1)   # vallée au centre
            # Bruit haute fréquence
            noise = rng.gauss(0, 30)
            elev[r][c] = max(200.0, base + noise)
    return elev


# ---------------------------------------------------------------------------
# Couverture et densité du combustible
# ---------------------------------------------------------------------------
def make_fuel_density(elev, seed=42):
    """
    Densité de combustible [0-1] pour chaque cellule.
    0 = rocher / zone non brûlable, >0 = forêt / végétation.
    """
    rng = random.Random(seed)
    fuel = [[0.0] * COLS for _ in range(ROWS)]
    for r in range(ROWS):
        for c in range(COLS):
            alt = elev[r][c]
            # Rochers au-dessus de 1400 m
            if alt > 1400:
                fuel[r][c] = 0.0
                continue
            # Base : densité diminue avec l'altitude
            base = max(0.0, 1.0 - (alt - 400) / 1200)
            # Clairières (bruit de Perlin simplifié avec cosinus)
            nx = c / COLS * 6
            ny = r / ROWS * 6
            clearings = (
                math.cos(nx * 1.3) * math.cos(ny * 0.9) * 0.3
                + math.cos(nx * 2.7 + 1.1) * math.cos(ny * 2.1) * 0.15
            )
            # Vallée / oued (humide) : combustible plus faible
            dist_valley = abs(c / COLS - 0.5) * COLS * CELL_M   # distance au centre en m
            valley_factor = 1.0 - 0.4 * math.exp(-dist_valley ** 2 / (500 ** 2))
            d = max(0.0, min(1.0, (base + clearings) * valley_factor + rng.gauss(0, 0.05)))
            fuel[r][c] = d
    return fuel


class Forest:
    """Grille de la forêt avec élévation et densité de combustible."""

    def __init__(self):
        self.rows = ROWS
        self.cols = COLS
        self.cell_m = CELL_M
        self.elev = load_elevation()
        self.fuel = make_fuel_density(self.elev)

    def slope_between(self, r1, c1, r2, c2):
        """Pente en degrés du centre (r1,c1) vers le centre (r2,c2)."""
        dh = self.elev[r2][c2] - self.elev[r1][c1]
        dist = math.sqrt((r2 - r1) ** 2 + (c2 - c1) ** 2) * CELL_M
        return math.degrees(math.atan2(dh, dist)) if dist > 0 else 0.0

    def is_burnable(self, r, c):
        return 0 <= r < ROWS and 0 <= c < COLS and self.fuel[r][c] > 0.05
