#!/usr/bin/env python3
"""
FireWatch – Simulateur IoT forestier.

Point d'entrée : initialise le monde (grille CA + relief + météo),
place 12 stations, puis boucle :
  1. tick du monde (automate cellulaire, dt_sim = dt_réel × speed × time_scale)
  2. chaque station prête envoie un paquet CoAP/CBOR/SenML
  3. la réponse CoAP porte les ordres pour le nœud (period, siren)
  4. toutes les ~1 s : POST /api/sim/world (vérité terrain) → reçoit la file d'ordres

Usage :
  python firewatch_sim.py                      # serveur sur localhost
  python firewatch_sim.py --host 10.0.2.2      # depuis la VM (NAT)
  python firewatch_sim.py --fire-after 30      # feu automatique après 30 s
  python firewatch_sim.py --real-weather       # météo Open-Meteo
  python firewatch_sim.py --speed 3            # simulation 3× plus rapide
"""
from __future__ import annotations

import argparse
import io
import json
import math
import random
import sys
import time
import urllib.request

# Windows : forcer la sortie en UTF-8 pour les emojis dans la console
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import cbor2

from coap_client import CoapClient
from engine.world import World
from engine.forest import COLS, ROWS, CELL_M, latlon_to_cell, cell_to_latlon
from devices.station import Station

CENTER = (35.135, -5.215)
GRID_COLS, GRID_ROWS = 4, 3
SPACING_M = 900

# Labels SenML entiers (RFC 8428)
SENML_BN, SENML_BT = -2, -3


def make_stations(period, world):
    """Crée 12 stations en grille 4×3 autour du centre, et les enregistre dans le monde."""
    stations = []
    k = 1
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            north = (row - (GRID_ROWS - 1) / 2) * SPACING_M + random.uniform(-120, 120)
            east  = (col - (GRID_COLS - 1) / 2) * SPACING_M + random.uniform(-120, 120)
            lat = CENTER[0] + north / 111_320
            lon = CENTER[1] + east / (111_320 * math.cos(math.radians(CENTER[0])))
            sid = "N{:02d}".format(k)
            st = Station(sid, lat, lon, period)
            stations.append(st)
            world.devices[sid] = st.to_dict()
            k += 1
    return stations


def _http_post(url, body_dict, timeout=2.0):
    """POST JSON vers url. Retourne le dict de réponse ou None."""
    body = json.dumps(body_dict).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception:
        return None


def _http_get(url, timeout=2.0):
    """GET JSON depuis url. Retourne le dict ou None."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.load(r)
    except Exception:
        return None


def post_command(host, http_port, cmd, timeout=2.0):
    _http_post("http://{}:{}/api/world/command".format(host, http_port), cmd, timeout)


def get_server_state(host, http_port):
    return _http_get("http://{}:{}/api/state".format(host, http_port))


def get_server_metrics(host, http_port):
    return _http_get("http://{}:{}/api/metrics".format(host, http_port)) or {}


def reset_server(host, http_port):
    _http_post("http://{}:{}/api/scenario/reset".format(host, http_port), {})
    _http_post("http://{}:{}/api/metrics/reset".format(host, http_port), {})


def post_world(host, http_port, world, stations, timeout=2.0):
    """
    Envoie la vérité terrain au serveur (POST /api/sim/world).
    Retourne la liste des ordres à appliquer (peut être vide).
    """
    devices_list = [s.to_dict() for s in stations] + [
        d for did, d in world.devices.items()
        if did not in {s.id for s in stations}
    ]
    snap = world.snapshot(devices_list)
    body = json.dumps(snap).encode()
    url = "http://{}:{}/api/sim/world".format(host, http_port)
    try:
        req = urllib.request.Request(
            url, data=body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            resp = json.load(r)
        return resp.get("commands", [])
    except Exception:
        return []


def handle_coap_response(station, resp, world):
    """Applique la réponse CoAP au nœud (period, siren uniquement – plus de scenario)."""
    if resp is None or not resp.get("payload"):
        return
    try:
        cmd = cbor2.loads(resp["payload"])
    except Exception:
        return
    station.period = float(cmd.get("period", station.period))
    siren = bool(cmd.get("siren", False))
    if siren != station.siren:
        station.siren = siren
        flag = "ACTIVÉE" if siren else "arrêtée"
        print("🚨 {} : SIRÈNE {}".format(station.id, flag))


BENCH_SCENARIOS = [
    {"name": "chergui",          "desc": "Feu Chergui (vent fort d'est)"},
    {"name": "au-vent",          "desc": "Feu au vent (fumée s'éloigne)"},
    {"name": "nuit",             "desc": "Feu de nuit (vent faible)"},
    {"name": "deux-foyers",      "desc": "Deux foyers simultanés"},
    {"name": "pluie",            "desc": "Pluie (risque faible, extinction)"},
]

RUN_DURATION_REAL = 60   # secondes réelles par run (vitesse ×50 → ~12 min sim)
BENCH_SPEED = 50.0       # facteur d'accélération pendant le banc


def run_bench(args):
    """Banc d'essai : chaque scénario N fois, résultats dans docs/bench-results.json."""
    import os
    print("🔬 Banc d'essai FireWatch – {} scénarios × {} runs".format(
        len(BENCH_SCENARIOS), args.bench))
    print("   Serveur : http://{}:{}".format(args.host, args.http_port))
    print("   Accélération : {}×, durée max par run : {} s réelles".format(
        BENCH_SPEED, RUN_DURATION_REAL))
    print()

    all_results = []

    for sc in BENCH_SCENARIOS:
        print("  ▶  Scénario «{}» …".format(sc["name"]))
        runs = []

        for n in range(args.bench):
            # Réinitialisation du serveur
            reset_server(args.host, args.http_port)
            time.sleep(1.5)

            # Nouveau monde accéléré
            world = World(speed=BENCH_SPEED)
            stations = make_stations(args.period, world)
            coap_client = CoapClient(args.host, args.port)

            # Lancer le scénario
            post_command(args.host, args.http_port,
                         {"type": "scenario", "name": sc["name"]})

            t0 = time.time()
            detected = False
            det_time_s = None
            last_world_post = 0.0

            while time.time() - t0 < RUN_DURATION_REAL:
                world.tick()
                now = time.time()

                for st in stations:
                    if not st.ready(now):
                        continue
                    rssi, snr = -80.0, 5.0
                    sf = st.sf_from_snr(snr)
                    if random.random() < st.packet_loss(snr):
                        st.schedule_next(now)
                        st.consume_battery(sf)
                        continue
                    readings = st.read_sensors(world)
                    pack = st.build_senml(readings, rssi, snr, sf)
                    payload = cbor2.dumps(pack)
                    resp = coap_client.post("fw/up", payload)
                    st.consume_battery(sf)
                    st.schedule_next(now)
                    if resp:
                        handle_coap_response(st, resp, world)

                if now - last_world_post >= 0.5:
                    post_world(args.host, args.http_port, world, stations)
                    last_world_post = now

                srv = get_server_state(args.host, args.http_port)
                if srv and srv.get("incident") and srv["incident"].get("status") == "actif":
                    det_time_s = round(time.time() - t0, 1)
                    detected = True
                    break

                time.sleep(0.05)

            m = get_server_metrics(args.host, args.http_port)
            runs.append({
                "run": n + 1,
                "detected": detected,
                "det_time_s": det_time_s,
                "pdr_pct": m.get("network", {}).get("pdr", None),
                "cbor_savings_pct": m.get("data", {}).get("savingsPct", 0),
            })
            status = "✅ {:.1f} s".format(det_time_s) if detected else "❌ non détecté"
            print("     run {}/{} : {}".format(n + 1, args.bench, status))

        det_runs = [r for r in runs if r["detected"]]
        avg_time = (
            round(sum(r["det_time_s"] for r in det_runs) / len(det_runs), 1)
            if det_runs else None
        )
        result = {
            "scenario": sc["name"],
            "description": sc["desc"],
            "runs": runs,
            "detection_rate": len(det_runs) / len(runs),
            "avg_det_time_s": avg_time,
            "avg_cbor_savings_pct": (
                round(sum(r["cbor_savings_pct"] for r in runs) / len(runs), 1)
                if runs else 0
            ),
        }
        all_results.append(result)
        print("     → taux={:.0%}  temps moyen={}s\n".format(
            result["detection_rate"],
            avg_time if avg_time is not None else "N/A",
        ))

    # Écriture JSON
    docs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
    os.makedirs(docs_dir, exist_ok=True)
    json_path = os.path.join(docs_dir, "bench-results.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)

    # Tableau Markdown
    md_path = os.path.join(docs_dir, "bench-results.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# Résultats du banc d'essai FireWatch\n\n")
        f.write("| Scénario | Taux détection | Temps moyen (s) | Économie CBOR |\n")
        f.write("|---|---|---|---|\n")
        for r in all_results:
            f.write("| {} | {:.0%} | {} | {}% |\n".format(
                r["scenario"],
                r["detection_rate"],
                r["avg_det_time_s"] if r["avg_det_time_s"] is not None else "N/A",
                r["avg_cbor_savings_pct"],
            ))

    print("✅ Résultats écrits dans {} et {}".format(json_path, md_path))


def main():
    p = argparse.ArgumentParser(description="FireWatch – simulateur IoT forestier")
    p.add_argument("--host",         default="127.0.0.1")
    p.add_argument("--port",         type=int,   default=5683,  help="port CoAP")
    p.add_argument("--http-port",    type=int,   default=3000,  help="port HTTP serveur")
    p.add_argument("--period",       type=float, default=10.0,  help="période d'envoi (s)")
    p.add_argument("--speed",        type=float, default=1.0,   help="vitesse de simulation (×)")
    p.add_argument("--fire-after",   type=float, default=0,     help="feu auto après N s (0=jamais)")
    p.add_argument("--real-weather", action="store_true")
    p.add_argument("--verbose",      action="store_true")
    p.add_argument("--bench",        type=int,   default=0,
                   help="banc d'essai : N runs par scénario (serveur doit être en marche)")
    args = p.parse_args()

    if args.bench > 0:
        run_bench(args)
        return

    print("🌲 FireWatch – démarrage du moteur de simulation")
    print("   Chargement du relief (peut prendre quelques secondes)…")

    world = World(speed=args.speed, real_weather=args.real_weather)
    stations = make_stations(args.period, world)
    coap = CoapClient(args.host, args.port)

    # Démonstration CBOR vs JSON
    sample_readings = stations[0].read_sensors(world)
    sample_pack = stations[0].build_senml(sample_readings, -80.0, 5.0, 7)
    cbor_size = len(cbor2.dumps(sample_pack))
    json_size  = len(json.dumps(sample_pack, separators=(",", ":")).encode())

    print("   Serveur CoAP : coap://{}:{}/fw/up".format(args.host, args.port))
    print("   Serveur HTTP : http://{}:{}/api/sim/world".format(args.host, args.http_port))
    print("   {} stations autour de {}".format(len(stations), CENTER))
    print("   Météo : {temp}°C, {hum}% HR, vent {wind_speed} m/s depuis {wind_dir}°".format(
        **world.weather))
    print("   Grille : {}×{} cellules de {} m = {:.1f}×{:.1f} km".format(
        COLS, ROWS, CELL_M, COLS * CELL_M / 1000, ROWS * CELL_M / 1000))
    print("   SenML CBOR={} o / JSON={} o (−{}%)".format(
        cbor_size, json_size, 100 - cbor_size * 100 // json_size))
    print()

    last_world_post = 0.0
    auto_fire_done  = False
    start_time      = time.time()
    offline_warned  = False

    try:
        while True:
            world.tick()
            now = time.time()

            # Feu automatique après N secondes
            if args.fire_after and not auto_fire_done and now - start_time >= args.fire_after:
                target = random.choice(stations)
                r, c = latlon_to_cell(
                    target.lat + random.uniform(-150, 150) / 111_320,
                    target.lon + random.uniform(-150, 150) / 111_320
                )
                if world.fire.ignite(r, c):
                    lat, lon = cell_to_latlon(r, c)
                    print("🔥 Feu automatique allumé en ({:.5f}, {:.5f})".format(lat, lon))
                auto_fire_done = True

            # Envoi CoAP pour les stations prêtes
            for st in stations:
                if not st.ready(now):
                    continue
                # Radio simulée (passerelles = aucune pour l'instant, RSSI par défaut)
                rssi, snr = -80.0, 5.0   # TODO: passerelles dynamiques
                sf = st.sf_from_snr(snr)
                # Perte de paquets
                if random.random() < st.packet_loss(snr):
                    st.schedule_next(now)
                    st.consume_battery(sf)
                    continue

                readings = st.read_sensors(world)
                pack = st.build_senml(readings, rssi, snr, sf)
                payload = cbor2.dumps(pack)
                resp = coap.post("fw/up", payload)
                st.consume_battery(sf)
                st.schedule_next(now)

                if resp is None:
                    if not offline_warned:
                        print("⚠️  Pas de réponse CoAP (serveur démarré ?)")
                        offline_warned = True
                else:
                    offline_warned = False
                    handle_coap_response(st, resp, world)

                if args.verbose or readings.get("smoke", 0) > 300:
                    flag = "🔥" if readings.get("flame") else (
                        "💨" if readings.get("smoke", 0) > 300 else "  ")
                    print("{} {} {} T={:.1f}°C fumée={:.0f}ppm CO={:.1f}ppm ({} o)".format(
                        flag, st.id, resp["code"] if resp else "---",
                        readings["temp"], readings["smoke"], readings["co"], len(payload)))

            # POST /api/sim/world toutes les ~1 s
            if now - last_world_post >= 1.0:
                commands = post_world(args.host, args.http_port, world, stations)
                for cmd in commands:
                    world.apply_command(cmd)
                last_world_post = now
                # Affichage du feu si actif
                nb_burning = world.fire.active_fire_count()
                if nb_burning and args.verbose:
                    print("   🔥 {} cellule(s) en feu (simTime={:.0f}s)".format(
                        nb_burning, world.sim_time))

            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\nArrêt du simulateur.")


if __name__ == "__main__":
    main()
