"""
Carte statique de la zone (shared/terrain.json) : piste forestière, hameau, parcelles.
Le serveur lit le même fichier, comme un SIG : ce n'est pas la vérité terrain du feu.
"""
from __future__ import annotations

import json
import math
import os

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "shared", "terrain.json")

try:
    with open(_PATH, encoding="utf-8") as _f:
        TERRAIN = json.load(_f)
except FileNotFoundError:
    raise SystemExit("Carte de la zone introuvable ({}) : copier aussi le dossier shared/ "
                     "à côté de simulator/.".format(os.path.normpath(_PATH)))

ROADS = TERRAIN.get("roads", [])
VILLAGES = TERRAIN.get("villages", [])
PARCELS = TERRAIN.get("parcels", [])


def _to_m(lat, lon, lat0, lon0):
    return ((lat - lat0) * 111_320,
            (lon - lon0) * 111_320 * math.cos(math.radians((lat + lat0) / 2)))


def nearest_road_point(lat, lon):
    """Point de la piste le plus proche de (lat, lon) : (lat, lon, distance m) ou None."""
    best = None
    for road in ROADS:
        pts = road["points"]
        for (a_lat, a_lon), (b_lat, b_lon) in zip(pts, pts[1:]):
            bn, be = _to_m(b_lat, b_lon, a_lat, a_lon)
            pn, pe = _to_m(lat, lon, a_lat, a_lon)
            seg2 = bn * bn + be * be
            t = 0.0 if seg2 == 0 else max(0.0, min(1.0, (pn * bn + pe * be) / seg2))
            q_lat = a_lat + (b_lat - a_lat) * t
            q_lon = a_lon + (b_lon - a_lon) * t
            dn, de = _to_m(lat, lon, q_lat, q_lon)
            d = math.hypot(dn, de)
            if best is None or d < best[2]:
                best = (q_lat, q_lon, d)
    return best


def parcel_center(parcel):
    pts = parcel["polygon"]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
