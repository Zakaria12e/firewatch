"""
Monde simulé : état global, file d'ordres, tick(dt).
Fait le lien entre la forêt, le feu, la météo et les appareils.
"""
from __future__ import annotations

import math
import time
from typing import Any, Dict, List, Optional

from .forest import (Forest, latlon_to_cell, cell_to_latlon, ROWS, COLS, CELL_M,
                     ORIGIN_LAT, ORIGIN_LON)
from .fire import FireModel
from .weather import PRESETS, default_weather
from . import gis

# Canadair : délai (secondes réelles) entre l'ordre et l'impact de l'eau, le temps
# que l'avion arrive sur zone (le dashboard anime l'approche à partir de impactIn).
DROP_DELAY_S = 6.0
DROP_KEEP_S = 8.0     # durée pendant laquelle un largage reste dans le snapshot

# Diffusion de la fumée autour de la source (toutes directions) : poids par cellule en
# feu, majoré par vent faible, décroissance sur DIFFUSION_M mètres
DIFFUSION_BASE = 0.12
DIFFUSION_CALM = 0.16
DIFFUSION_M = 250.0

# Sources de fausses alertes (§5.3) : durée (s réelles), montée en puissance (s),
# et effet physique sur les capteurs. Elles ne passent jamais par le serveur autrement
# que par les mesures des capteurs.
#   smoke/heat : poids du panache équivalent (1 = une cellule en feu)
#   co_ppm     : CO local (moteur au ralenti), décroissance sur co_scale m
#   hum/radius : humidité plancher dans un rayon (brouillard)
#   temp_c     : échauffement d'un capteur (soleil direct sur le boîtier)
#   thermal_c  : température vue par une caméra thermique
FALSE_SOURCES = {
    "brulage":    {"duration": 180.0, "ramp": 15.0, "smoke": 1.6, "heat": 0.35, "thermal_c": 220.0},
    "barbecue":   {"duration": 150.0, "ramp": 10.0, "smoke": 0.3, "heat": 0.1, "thermal_c": 140.0},
    "vehicule":   {"duration": 120.0, "ramp": 5.0, "co_ppm": 160.0, "co_scale": 90.0},
    "brouillard": {"duration": 180.0, "ramp": 25.0, "hum": 94.0, "radius": 900.0},
    "soleil":     {"duration": 120.0, "ramp": 40.0, "temp_c": 18.0, "radius": 60.0},
}


class World:
    def __init__(self, speed=1.0, real_weather=False, device_factory=None, default_period=10.0):
        """
        speed          : facteur de vitesse de simulation (1 = temps réel, >1 = accéléré).
        real_weather   : si True, tentera Open-Meteo au démarrage.
        device_factory : create_device(kind, id, lat, lon, period, azimuth) → Device.
        """
        self.speed = speed
        self.forest = Forest()
        self.fire = FireModel(self.forest)
        self.weather = default_weather()
        if real_weather:
            from .weather import fetch_real_weather
            w = fetch_real_weather()
            if w:
                self.weather = w
        self.devices = {}       # id → Device (objet appareil)
        self.device_factory = device_factory
        self.default_period = default_period
        self.time_scale = 15    # 1 min réelle = time_scale min simulées (pour affichage)
        self.sim_time = 0.0     # secondes simulées depuis le début
        self.drops = []         # largages Canadair [{id, lat, lon, radius, impact_at, done}]
        self.radio_stats = {"sent": 0, "lost": 0, "airtime_ms": 0.0, "oversize": 0}
        self._command_queue = []
        self._last_tick = time.time()
        self._device_id_counter = 0
        self._drop_counter = 0
        self._scheduled_commands = []   # [(sim_time_trigger, cmd)]
        self.false_sources = []         # [{id, kind, lat, lon, start, until}]
        self._false_counter = 0

    # ------------------------------------------------------------------
    # Géométrie
    # ------------------------------------------------------------------
    def elevation_at(self, lat, lon):
        """Altitude (m) de la cellule qui contient (lat, lon), bornée à la grille."""
        r, c = latlon_to_cell(lat, lon)
        r = min(ROWS - 1, max(0, r))
        c = min(COLS - 1, max(0, c))
        return self.forest.elev[r][c]

    @staticmethod
    def cell_center(r, c):
        return cell_to_latlon(r, c)

    def active_gateways(self):
        return [d for d in self.devices.values()
                if d.kind == "gateway" and getattr(d, "active", lambda: True)()]

    # ------------------------------------------------------------------
    # Tick
    # ------------------------------------------------------------------
    def tick(self):
        """Avance la simulation d'un pas de temps depuis le dernier appel."""
        now = time.time()
        dt_real = now - self._last_tick
        self._last_tick = now
        dt_sim = dt_real * self.speed * self.time_scale
        self.sim_time += dt_sim
        self.fire.tick(dt_sim, self.weather)
        # Commandes programmées (scénarios avec délai)
        due = [(t, c) for (t, c) in self._scheduled_commands if self.sim_time >= t]
        for item in due:
            self._scheduled_commands.remove(item)
            self.apply_command(item[1])
        # Largages Canadair arrivés sur zone
        for d in self.drops:
            if not d["done"] and now >= d["impact_at"]:
                r, c = latlon_to_cell(d["lat"], d["lon"])
                self.fire.extinguish(r, c, d["radius"])
                d["done"] = True
        self.drops = [d for d in self.drops if now - d["impact_at"] < DROP_KEEP_S]
        self.false_sources = [f for f in self.false_sources if now < f["until"]]

    # ------------------------------------------------------------------
    # Ordres
    # ------------------------------------------------------------------
    def enqueue(self, cmd):
        """Ajoute un ordre dans la file (depuis /api/world/command)."""
        self._command_queue.append(cmd)

    def drain_commands(self):
        """Vide la file et retourne les ordres ; appelé lors de la réponse à /api/sim/world."""
        cmds = list(self._command_queue)
        self._command_queue.clear()
        return cmds

    def apply_command(self, cmd):
        """Applique un ordre reçu du serveur dans la réponse à /api/sim/world."""
        t = cmd.get("type") or cmd.get("t")
        if t == "fire_start":
            # Départ de feu : une cellule (petit) ou un disque de rayon donné (75 / 150 m).
            # Un feu allumé ne se déplace pas : on agit ensuite par le vent, l'eau ou la pluie.
            radius = max(0.0, min(400.0, float(cmd.get("radius", 0) or 0)))
            r, c = latlon_to_cell(cmd["lat"], cmd["lon"])
            if self.fire.ignite_cells(self.fire.disk_cells(r, c, radius)) is None:
                self._ignite_near(cmd["lat"], cmd["lon"])
        elif t == "fire_line":
            # Ligne de feu (foudre sur une crête, bord de route) : un seul foyer
            self.fire.ignite_cells(self._line_cells(cmd.get("points") or []))
        elif t == "fire_out":
            # Fin de scénario : éteint le foyer le plus proche du point, ou tous les foyers
            if "lat" in cmd and "lon" in cmd:
                r, c = latlon_to_cell(cmd["lat"], cmd["lon"])
                fid = self.fire.fire_near(r, c, max_cells=int(300 / CELL_M))
                if fid is not None:
                    self.fire.put_out(fid)
            else:
                self.fire.put_out()
        elif t == "wind":
            self.weather["wind_speed"] = float(cmd.get("speed", self.weather["wind_speed"]))
            self.weather["wind_dir"]   = float(cmd.get("dir",   self.weather["wind_dir"]))
        elif t == "weather":
            for key in ("temp", "hum", "fmc", "rain"):
                if key in cmd:
                    self.weather[key] = float(cmd[key])
        elif t == "preset":
            name = cmd.get("name", "chergui")
            if name in PRESETS:
                self.weather = dict(PRESETS[name])
        elif t == "water":
            self._schedule_drop(float(cmd["lat"]), float(cmd["lon"]), float(cmd.get("radius", 150)))
        elif t == "device_add":
            self._add_device(cmd)
        elif t == "device_move":
            dev = self.devices.get(cmd.get("id"))
            if dev:
                dev.lat = float(cmd["lat"])
                dev.lon = float(cmd["lon"])
                dev.needs_inscription = True   # la nouvelle position part dans l'inscription
        elif t == "device_rotate":
            dev = self.devices.get(cmd.get("id"))
            if dev:
                dev.azimuth = float(cmd.get("azimuth", 0)) % 360.0
        elif t == "device_remove":
            self.devices.pop(cmd.get("id"), None)
        elif t == "device_fault":
            dev = self.devices.get(cmd.get("id"))
            if dev:
                dev.set_fault(cmd.get("mode", "ok"))
        elif t == "false_source":
            self.add_false_source(cmd.get("kind", ""), cmd.get("lat"), cmd.get("lon"),
                                  cmd.get("duration"))
        elif t == "false_source_clear":
            self.false_sources = []
        elif t == "time_scale":
            self.time_scale = max(1, int(cmd.get("x", 15)))
        elif t == "reset":
            self.fire.reset()
            self.weather = default_weather()
            self.drops = []
            self.false_sources = []
            self._scheduled_commands.clear()
        elif t == "scenario":
            self._run_scenario(cmd.get("name", "chergui"))

    @staticmethod
    def _line_cells(points, max_cells=600):
        """Cellules traversées par une polyligne [[lat, lon], …] (pas d'une demi-cellule)."""
        cells = []
        seen = set()
        pts = [(float(p[0]), float(p[1])) for p in points[:200]
               if isinstance(p, (list, tuple)) and len(p) >= 2]
        if len(pts) == 1:
            pts.append(pts[0])
        for (lat1, lon1), (lat2, lon2) in zip(pts, pts[1:]):
            dn = (lat2 - lat1) * 111_320
            de = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
            steps = max(1, int(math.hypot(dn, de) / (CELL_M / 2)))
            for i in range(steps + 1):
                t = i / steps
                rc = latlon_to_cell(lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t)
                if rc not in seen:
                    seen.add(rc)
                    cells.append(rc)
                    if len(cells) >= max_cells:
                        return cells
        return cells

    # ------------------------------------------------------------------
    # Fausses sources
    # ------------------------------------------------------------------
    def add_false_source(self, kind, lat=None, lon=None, duration=None):
        """
        Ajoute une source de fausse alerte. Le véhicule se place sur la piste la plus
        proche ; le soleil chauffe l'appareil le plus proche (dans 400 m). Retourne l'id.
        """
        spec = FALSE_SOURCES.get(kind)
        if spec is None:
            return None
        if lat is None or lon is None:
            lat, lon = self._default_false_position(kind)
        lat, lon = float(lat), float(lon)
        if kind == "vehicule":
            q = gis.nearest_road_point(lat, lon)
            if q is not None:
                lat, lon = q[0], q[1]
        elif kind == "soleil":
            best = None
            for d in self.devices.values():
                if d.kind == "gateway":
                    continue
                dist = _dist_m(lat, lon, d.lat, d.lon)
                if dist < 400 and (best is None or dist < best[0]):
                    best = (dist, d.lat, d.lon)
            if best is not None:
                lat, lon = best[1], best[2]
        now = time.time()
        self._false_counter += 1
        self.false_sources.append({
            "id": self._false_counter, "kind": kind, "lat": lat, "lon": lon, "start": now,
            "until": now + float(duration or spec["duration"]),
        })
        return self._false_counter

    def _default_false_position(self, kind):
        """Position par défaut des scénarios : près d'un capteur réel, sur la carte de la zone."""
        if kind == "barbecue" and gis.VILLAGES:
            v = gis.VILLAGES[0]
            return v["lat"], v["lon"]
        if kind == "brulage" and gis.PARCELS:
            return gis.parcel_center(gis.PARCELS[0])
        if kind == "vehicule":
            # point de la piste le plus proche d'une station
            best = None
            for d in self.devices.values():
                if d.kind != "station":
                    continue
                q = gis.nearest_road_point(d.lat, d.lon)
                if q is not None and (best is None or q[2] < best[2]):
                    best = q
            if best is not None:
                return best[0], best[1]
        return 35.135, -5.215

    def false_exposure(self, lat, lon):
        """
        Effet des fausses sources sur un capteur en (lat, lon) :
        {heat, smoke (0-1, comme fire_exposure), co_ppm, hum_floor, temp_c}.
        """
        out = {"heat": 0.0, "smoke": 0.0, "co_ppm": 0.0, "hum_floor": 0.0, "temp_c": 0.0}
        if not self.false_sources:
            return out
        now = time.time()
        wind_to_n, wind_to_e = self._wind_to()
        ws = self.weather.get("wind_speed", 5.0)
        for f in self.false_sources:
            spec = FALSE_SOURCES[f["kind"]]
            ramp = max(0.0, min(1.0, (now - f["start"]) / spec["ramp"]))
            if "smoke" in spec:
                h, sm = self._plume(lat, lon, f["lat"], f["lon"], wind_to_n, wind_to_e, ws)
                out["heat"] += h * spec["heat"] * ramp
                out["smoke"] += sm * spec["smoke"] * ramp
            if "co_ppm" in spec:
                d = _dist_m(lat, lon, f["lat"], f["lon"])
                out["co_ppm"] += spec["co_ppm"] * math.exp(-d / spec["co_scale"]) * ramp
            if "hum" in spec:
                d = _dist_m(lat, lon, f["lat"], f["lon"])
                if d < spec["radius"]:
                    floor = spec["hum"] - 6.0 * d / spec["radius"]
                    out["hum_floor"] = max(out["hum_floor"], floor * ramp)
            if "temp_c" in spec:
                if _dist_m(lat, lon, f["lat"], f["lon"]) < spec["radius"]:
                    out["temp_c"] += spec["temp_c"] * ramp
        out["heat"] = min(1.0, out["heat"])
        out["smoke"] = min(1.0, out["smoke"])
        return out

    def false_hotspots(self):
        """Sources chaudes visibles par une caméra thermique : [(lat, lon, °C au-dessus de l'ambiante)]."""
        now = time.time()
        out = []
        for f in self.false_sources:
            spec = FALSE_SOURCES[f["kind"]]
            if "thermal_c" in spec:
                ramp = max(0.0, min(1.0, (now - f["start"]) / spec["ramp"]))
                out.append((f["lat"], f["lon"], spec["thermal_c"] * ramp))
        return out

    def _schedule_drop(self, lat, lon, radius):
        """Canadair : l'eau touche le sol DROP_DELAY_S secondes après l'ordre."""
        self._drop_counter += 1
        self.drops.append({
            "id": self._drop_counter,
            "lat": lat,
            "lon": lon,
            "radius": radius,
            "impact_at": time.time() + DROP_DELAY_S,
            "done": False,
        })

    def add_device(self, kind, lat, lon, azimuth=0.0, device_id=None, period=None):
        """Crée et enregistre un appareil ; retourne son id (None sans fabrique)."""
        if self.device_factory is None:
            return None
        did = device_id
        if did is None:
            self._device_id_counter += 1
            did = "D{:03d}".format(self._device_id_counter)
            while did in self.devices:
                self._device_id_counter += 1
                did = "D{:03d}".format(self._device_id_counter)
        dev = self.device_factory(kind, did, float(lat), float(lon),
                                  period or self.default_period, float(azimuth))
        self.devices[did] = dev
        return did

    def _add_device(self, cmd):
        return self.add_device(cmd.get("kind", "station"), cmd["lat"], cmd["lon"],
                               cmd.get("azimuth", 0) or 0)

    def _ignite_near(self, lat, lon):
        """Allume la cellule la plus proche de (lat, lon) qui soit combustible."""
        r0, c0 = latlon_to_cell(lat, lon)
        for d in range(15):
            for dr in range(-d, d + 1):
                for dc in range(-d, d + 1):
                    if abs(dr) != d and abs(dc) != d:
                        continue
                    if self.fire.ignite(r0 + dr, c0 + dc):
                        return True
        return False

    def _run_scenario(self, name):
        """Préréglages de scénario de démo (météo + feu + commandes programmées)."""
        self._scheduled_commands.clear()
        if name == "chergui":
            # Feu à l'est, vent fort d'est → détection rapide sous le vent
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.135, -5.175)
        elif name == "au-vent":
            # Feu à ~1 km à l'ouest des capteurs, vent d'est → la fumée s'éloigne :
            # détection plus lente (diffusion, chaleur, puis capteurs atteints)
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.131, -5.2415)
        elif name == "nuit":
            # Feu de nuit d'été (sec, vent faible) : départ de 100 m au centre ; il progresse
            # lentement et la fumée diffuse autour (peu de panache sous un vent faible)
            self.apply_command({"type": "preset", "name": "nuit"})
            self.apply_command({"type": "weather", "hum": 38.0, "fmc": 10.0})
            r, c = latlon_to_cell(35.135, -5.215)
            if self.fire.ignite_cells(self.fire.disk_cells(r, c, 100.0)) is None:
                self._ignite_near(35.135, -5.215)
        elif name == "deux-foyers":
            # Deux foyers simultanés (sautes de feu)
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.147, -5.195)
            self._ignite_near(35.120, -5.237)
        elif name == "changement-vent":
            # Feu à l'est, vent tourne de 90° après 600 s simulées
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.135, -5.175)
            self._scheduled_commands.append(
                (self.sim_time + 600, {"type": "wind", "speed": 5.0, "dir": 190.0})
            )
        elif name == "pluie":
            # Feu démarre sous le Chergui, pluie arrive après 400 s simulées
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.135, -5.215)
            self._scheduled_commands.append(
                (self.sim_time + 400, {"type": "preset", "name": "pluie"})
            )
        elif name == "route":
            # CO d'un véhicule à l'arrêt sur la piste, sans fumée → fausse alerte évitée
            self.apply_command({"type": "preset", "name": "chergui"})
            self.add_false_source("vehicule")
        elif name == "brouillard":
            # Brouillard sur le sud-ouest : humidité > 85 %, MQ-2 trompés, pas de CO
            self.apply_command({"type": "preset", "name": "normal"})
            self.add_false_source("brouillard", 35.1278, -5.2245)
        elif name == "brulage":
            # Brûlage agricole sur la parcelle déclarée (le serveur déclare la zone)
            self.apply_command({"type": "preset", "name": "chergui"})
            self.add_false_source("brulage")
        elif name == "barbecue":
            self.apply_command({"type": "preset", "name": "chergui"})
            self.add_false_source("barbecue")
        elif name == "pluie_seule":
            self.apply_command({"type": "preset", "name": "pluie"})
        elif name == "reset":
            self.apply_command({"type": "reset"})

    # ------------------------------------------------------------------
    # Exposition au feu pour les capteurs
    # ------------------------------------------------------------------
    def _wind_to(self):
        """Vecteur unitaire (nord, est) vers lequel souffle le vent."""
        wind_from = math.radians(self.weather.get("wind_dir", 0.0))
        return -math.cos(wind_from), -math.sin(wind_from)

    @staticmethod
    def _plume(lat, lon, clat, clon, wind_to_n, wind_to_e, wind_speed=5.0):
        """
        Contribution d'une source ponctuelle en (clat, clon) au capteur (lat, lon) :
        (chaleur, fumée) non normalisées, même modèle que pour une cellule en feu.
        Fumée = panache gaussien sous le vent + faible diffusion autour de la source
        (turbulence, tourbillons de pente), plus marquée quand le vent est faible :
        un capteur au vent sent un peu la fumée d'un feu proche, jamais celle d'un feu lointain.
        """
        dlat_m = (lat - clat) * 111_320
        dlon_m = (lon - clon) * 111_320 * math.cos(math.radians(35.135))
        dist = max(1.0, math.hypot(dlat_m, dlon_m))
        heat = math.exp(-dist / 150.0) if dist < 500.0 else 0.0
        smoke = 0.0
        if dist < 3000.0:
            sensor_n = dlat_m / dist
            sensor_e = dlon_m / dist
            along = sensor_n * wind_to_n + sensor_e * wind_to_e   # cosinus (-1 … 1)
            if along * dist > -50.0:   # capteur sous le vent (ou à moins de 50 m au vent)
                cross_n = sensor_n - along * wind_to_n
                cross_e = sensor_e - along * wind_to_e
                cross = math.hypot(cross_n * dist, cross_e * dist)
                sigma = 100.0 + 0.3 * max(0.0, along * dist)  # panache qui s'élargit
                smoke = math.exp(-cross ** 2 / (2 * sigma ** 2)) * math.exp(-dist / 1800.0)
            w_diff = DIFFUSION_BASE + DIFFUSION_CALM * max(0.0, 1.0 - wind_speed / 4.0)
            smoke += w_diff * math.exp(-dist / DIFFUSION_M)
        return heat, smoke

    def fire_exposure(self, lat, lon):
        """
        Retourne (heat, smoke) ∈ [0,1] pour un capteur à (lat, lon).
        heat  : chaleur (cellules en feu proches)
        smoke : exposition au panache (cellules en feu sous le vent)
        """
        wind_to_n, wind_to_e = self._wind_to()
        ws = self.weather.get("wind_speed", 5.0)
        burning = self.fire.burning_cells()
        if not burning:
            return 0.0, 0.0
        heat_sum = 0.0
        smoke_sum = 0.0
        for (r, c) in burning:
            clat, clon = cell_to_latlon(r, c)
            h, sm = self._plume(lat, lon, clat, clon, wind_to_n, wind_to_e, ws)
            heat_sum += h
            smoke_sum += sm

        heat  = min(1.0, heat_sum)
        smoke = min(1.0, smoke_sum)
        return heat, smoke

    # ------------------------------------------------------------------
    # Snapshot pour POST /api/sim/world
    # ------------------------------------------------------------------
    def snapshot(self):
        """
        Retourne un dict JSON-sérialisable représentant la vérité terrain.
        - grid.cells : 1 caractère par cellule (F, B, X, W, R)
        - burning    : [[r, c, intensité 0-100], ...] des cellules en feu
        - spots      : sautes de feu survenues depuis le dernier snapshot
        - drops      : largages Canadair en cours (impactIn = s avant impact)
        """
        now = time.time()
        return {
            "grid": {
                "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
                "cell": CELL_M,
                "rows": ROWS,
                "cols": COLS,
                "cells": self.fire.compact_grid(),
            },
            "fires": self.fire.fires_snapshot(),
            "burning": self.fire.burning_intensity(),
            "spots": self.fire.drain_spots(),
            "drops": [
                {"id": d["id"], "lat": d["lat"], "lon": d["lon"], "radius": d["radius"],
                 "impactIn": round(d["impact_at"] - now, 2)}
                for d in self.drops
            ],
            "weather": dict(self.weather),
            "devices": [d.to_dict() for d in self.devices.values()],
            # Vérité terrain : affichage optionnel et métriques, jamais la détection
            "falseSources": [
                {"id": f["id"], "kind": f["kind"], "lat": round(f["lat"], 6),
                 "lon": round(f["lon"], 6), "remaining": round(f["until"] - now, 1),
                 "radius": FALSE_SOURCES[f["kind"]].get("radius", 0.0)}
                for f in self.false_sources
            ],
            "radio": {k: (round(v, 1) if isinstance(v, float) else v)
                      for k, v in self.radio_stats.items()},
            "timeScale": self.time_scale,
            "speed": self.speed,
            "simTime": round(self.sim_time, 1),
        }


def _dist_m(lat1, lon1, lat2, lon2):
    dn = (lat2 - lat1) * 111_320
    de = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dn, de)
