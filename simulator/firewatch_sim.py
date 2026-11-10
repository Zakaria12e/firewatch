#!/usr/bin/env python3
"""
FireWatch – Simulateur de nœuds IoT forestiers.

Chaque nœud (ESP32 virtuel) lit ses capteurs :
  DHT22 (température, humidité), MQ-2 (fumée), MQ-7 (CO),
  KY-026 (flamme), anémomètre + girouette (vent), GPS NEO-6M (position).

Les mesures sont formatées en SenML (RFC 8428), codées en CBOR (RFC 8949)
et envoyées en CoAP POST confirmable (RFC 7252) vers le serveur.
La réponse CoAP transporte les ordres du serveur (fréquence d'envoi,
sirène, scénario), comme une fenêtre de réception LoRaWAN classe A.

Usage :
  python firewatch_sim.py                      # serveur sur localhost
  python firewatch_sim.py --host 10.0.2.2      # depuis la VM (NAT) vers Windows
  python firewatch_sim.py --fire-after 30      # feu automatique après 30 s
"""
import argparse
import json
import math
import os
import random
import socket
import struct
import time
import urllib.request

import cbor2

# ---------------------------------------------------------------------------
# Zone simulée : forêt de Talassemtane, près de Chefchaouen (Rif)
# ---------------------------------------------------------------------------
CENTER = (35.135, -5.215)
GRID_COLS, GRID_ROWS = 4, 3
SPACING_M = 900                      # distance entre deux nœuds

# Conditions par défaut : vent de Chergui (vent d'est chaud et sec, cause
# fréquente des grands feux dans le Rif)
CHERGUI = {"temp": 36.0, "hum": 18.0, "wind_speed": 7.0, "wind_dir": 100.0}

# Labels SenML en CBOR (RFC 8428, section 6)
SENML_BN, SENML_BT, SENML_N, SENML_U, SENML_V, SENML_VB = -2, -3, 0, 1, 2, 4


# ---------------------------------------------------------------------------
# Géométrie (approximation plane, suffisante sur quelques km)
# ---------------------------------------------------------------------------
def offset(lat, lon, north_m, east_m):
    """Déplace un point GPS de north_m mètres au nord et east_m mètres à l'est."""
    dlat = north_m / 111_320
    dlon = east_m / (111_320 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def to_local(lat, lon, ref_lat, ref_lon):
    """Coordonnées (nord, est) en mètres par rapport à un point de référence."""
    north = (lat - ref_lat) * 111_320
    east = (lon - ref_lon) * 111_320 * math.cos(math.radians(ref_lat))
    return north, east


# ---------------------------------------------------------------------------
# Client CoAP minimal (UDP), écrit à la main pour montrer le protocole
# ---------------------------------------------------------------------------
class CoapClient:
    CON, NON, ACK, RST = 0, 1, 2, 3
    POST = 0x02
    OPT_URI_PATH, OPT_CONTENT_FORMAT = 11, 12
    CF_CBOR = 60

    def __init__(self, host, port, timeout=1.5, retries=2):
        self.addr = (host, port)
        self.timeout = timeout
        self.retries = retries
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(timeout)
        self.mid = random.randint(0, 0xFFFF)

    @staticmethod
    def _nibble(x):
        if x < 13:
            return x, b""
        if x < 269:
            return 13, bytes([x - 13])
        return 14, struct.pack("!H", x - 269)

    def _encode_option(self, delta, value):
        d, d_ext = self._nibble(delta)
        l, l_ext = self._nibble(len(value))
        return bytes([(d << 4) | l]) + d_ext + l_ext + value

    def build(self, path, payload, token):
        self.mid = (self.mid + 1) & 0xFFFF
        header = bytes([(1 << 6) | (self.CON << 4) | len(token), self.POST])
        header += struct.pack("!H", self.mid) + token
        options = [(self.OPT_URI_PATH, seg.encode()) for seg in path.strip("/").split("/")]
        options.append((self.OPT_CONTENT_FORMAT, bytes([self.CF_CBOR])))
        encoded, last = b"", 0
        for number, value in options:
            encoded += self._encode_option(number - last, value)
            last = number
        return header + encoded + b"\xff" + payload

    @staticmethod
    def parse(data):
        if len(data) < 4:
            return None
        tkl = data[0] & 0x0F
        code = data[1]
        token = data[4:4 + tkl]
        i = 4 + tkl
        while i < len(data):
            b = data[i]
            if b == 0xFF:
                i += 1
                break
            delta, length = b >> 4, b & 0x0F
            i += 1
            for field in ("delta", "length"):
                val = delta if field == "delta" else length
                if val == 13:
                    val = data[i] + 13
                    i += 1
                elif val == 14:
                    val = struct.unpack("!H", data[i:i + 2])[0] + 269
                    i += 2
                if field == "delta":
                    delta = val
                else:
                    length = val
            i += length
        else:
            i = len(data)
        return {"code": f"{code >> 5}.{code & 0x1F:02d}", "token": token, "payload": data[i:]}

    def post(self, path, payload):
        token = os.urandom(4)
        msg = self.build(path, payload, token)
        for _ in range(self.retries + 1):
            self.sock.sendto(msg, self.addr)
            deadline = time.time() + self.timeout
            try:
                while time.time() < deadline:
                    data, _ = self.sock.recvfrom(4096)
                    resp = self.parse(data)
                    if resp and resp["token"] == token:
                        return resp
            except (socket.timeout, ConnectionResetError):
                continue
        return None


# ---------------------------------------------------------------------------
# Modèle de la forêt et du feu
# ---------------------------------------------------------------------------
class Forest:
    def __init__(self, weather, speed=1.0):
        self.weather = weather
        self.speed = speed
        self.fire = None              # {"lat", "lon", "radius", "since"}

    def start_fire(self, lat, lon):
        self.fire = {"lat": lat, "lon": lon, "radius": 30.0, "since": time.time()}
        print(f"\n🔥 DÉPART DE FEU en ({lat:.5f}, {lon:.5f})\n")

    def reset(self):
        self.fire = None
        print("\n🧯 Scénario réinitialisé : plus de feu.\n")

    def step(self, dt):
        """Le feu grandit et son front avance dans le sens du vent."""
        if not self.fire:
            return
        w = self.weather["wind_speed"]
        dryness = max(0.3, (60 - self.weather["hum"]) / 40)
        ros = (1.5 + 1.2 * w) * dryness * self.speed      # m/s (accéléré pour la démo)
        down = math.radians(self.weather["wind_dir"] + 180)  # direction où va le vent
        lat, lon = offset(self.fire["lat"], self.fire["lon"],
                          math.cos(down) * ros * 0.6 * dt, math.sin(down) * ros * 0.6 * dt)
        self.fire.update(lat=lat, lon=lon, radius=self.fire["radius"] + ros * 0.4 * dt)

    def exposure(self, lat, lon):
        """Retourne (chaleur, fumée) entre 0 et 1 pour un nœud."""
        if not self.fire:
            return 0.0, 0.0
        n, e = to_local(lat, lon, self.fire["lat"], self.fire["lon"])
        dist = math.hypot(n, e)
        r = self.fire["radius"]
        heat = max(0.0, min(1.0, 1 - (dist - r) / 250)) if dist > r else 1.0
        # Panache de fumée poussé par le vent
        down = math.radians(self.weather["wind_dir"] + 180)
        along = n * math.cos(down) + e * math.sin(down)
        cross = abs(-n * math.sin(down) + e * math.cos(down))
        smoke = 0.0
        if along > -r and cross < r + 0.35 * max(along, 0) + 150:
            smoke = math.exp(-max(along, 0) / 1800) * min(1.0, r / 200 + 0.3)
        smoke = max(smoke, heat)
        return heat, min(1.0, smoke)


# ---------------------------------------------------------------------------
# Nœud IoT virtuel
# ---------------------------------------------------------------------------
class Node:
    def __init__(self, node_id, lat, lon, period):
        self.id = node_id
        self.lat, self.lon = lat, lon
        self.period = period
        self.next_send = time.time() + random.uniform(0, period)
        self.battery = random.uniform(85, 100)
        self.siren = False
        self.temp_offset = random.uniform(-1.5, 1.5)

    def read_sensors(self, forest):
        w = forest.weather
        heat, smoke = forest.exposure(self.lat, self.lon)
        return {
            "temp": round(w["temp"] + self.temp_offset + heat * 45 + random.gauss(0, 0.3), 1),
            "hum": round(max(3.0, w["hum"] - heat * 14 + random.gauss(0, 0.8)), 1),
            "smoke": round(max(0.0, 25 + smoke * 1800 + random.gauss(0, 4)), 0),
            "co": round(max(0.0, 2 + smoke * 280 + random.gauss(0, 0.6)), 1),
            "flame": heat > 0.75,
            "wind_speed": round(max(0.0, w["wind_speed"] + random.gauss(0, 0.6)), 1),
            "wind_dir": round((w["wind_dir"] + random.gauss(0, 6)) % 360, 0),
            "bat": round(self.battery, 1),
        }

    def senml(self, r):
        """Paquet SenML avec labels entiers (forme compacte CBOR)."""
        return [
            {SENML_BN: f"urn:dev:fw:{self.id}:", SENML_BT: int(time.time()),
             SENML_N: "temp", SENML_U: "Cel", SENML_V: r["temp"]},
            {SENML_N: "hum", SENML_U: "%RH", SENML_V: r["hum"]},
            {SENML_N: "smoke", SENML_U: "ppm", SENML_V: r["smoke"]},
            {SENML_N: "co", SENML_U: "ppm", SENML_V: r["co"]},
            {SENML_N: "flame", SENML_VB: r["flame"]},
            {SENML_N: "wind_speed", SENML_U: "m/s", SENML_V: r["wind_speed"]},
            {SENML_N: "wind_dir", SENML_U: "deg", SENML_V: r["wind_dir"]},
            {SENML_N: "lat", SENML_U: "lat", SENML_V: round(self.lat, 6)},
            {SENML_N: "lon", SENML_U: "lon", SENML_V: round(self.lon, 6)},
            {SENML_N: "bat", SENML_U: "%EL", SENML_V: r["bat"]},
        ]

    def consume_battery(self):
        # Chaque envoi radio coûte de l'énergie : envoyer souvent vide la batterie
        self.battery = max(0.0, self.battery - 0.02)


def make_nodes(period):
    nodes, k = [], 1
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            north = (row - (GRID_ROWS - 1) / 2) * SPACING_M + random.uniform(-120, 120)
            east = (col - (GRID_COLS - 1) / 2) * SPACING_M + random.uniform(-120, 120)
            lat, lon = offset(*CENTER, north, east)
            nodes.append(Node(f"N{k:02d}", lat, lon, period))
            k += 1
    return nodes


def fetch_weather():
    """Météo réelle (Open-Meteo) au centre de la forêt, sinon None."""
    url = ("https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}"
           "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m"
           "&wind_speed_unit=ms").format(*CENTER)
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            c = json.load(r)["current"]
        return {"temp": c["temperature_2m"], "hum": c["relative_humidity_2m"],
                "wind_speed": c["wind_speed_10m"], "wind_dir": c["wind_direction_10m"]}
    except Exception as exc:  # pas d'Internet, DNS bloqué...
        print(f"⚠️  Météo réelle indisponible ({exc.__class__.__name__}), conditions Chergui utilisées.")
        return None


# ---------------------------------------------------------------------------
# Boucle principale
# ---------------------------------------------------------------------------
def handle_response(node, resp, forest, nodes):
    if resp is None or not resp["payload"]:
        return
    try:
        cmd = cbor2.loads(resp["payload"])
    except Exception:
        return
    node.period = float(cmd.get("period", node.period))
    siren = bool(cmd.get("siren", False))
    if siren != node.siren:
        node.siren = siren
        print(f"🚨 {node.id} : SIRÈNE {'ACTIVÉE' if siren else 'arrêtée'}")
    scenario = cmd.get("scenario")
    if isinstance(scenario, dict):
        if scenario.get("type") == "fire":
            lat, lon = scenario.get("lat"), scenario.get("lon")
            if lat is None or lon is None:
                target = random.choice(nodes)
                lat, lon = offset(target.lat, target.lon, random.uniform(-200, 200), random.uniform(-200, 200))
            forest.start_fire(lat, lon)
        elif scenario.get("type") == "reset":
            forest.reset()


def main():
    p = argparse.ArgumentParser(description="FireWatch – simulateur de nœuds IoT")
    p.add_argument("--host", default="127.0.0.1", help="adresse du serveur CoAP (10.0.2.2 depuis la VM)")
    p.add_argument("--port", type=int, default=5683)
    p.add_argument("--period", type=float, default=10.0, help="période d'envoi normale (s)")
    p.add_argument("--speed", type=float, default=1.0, help="vitesse de propagation du feu (x)")
    p.add_argument("--fire-after", type=float, default=0, help="déclenche un feu après N secondes (0 = jamais)")
    p.add_argument("--real-weather", action="store_true", help="utiliser la météo réelle au lieu du Chergui")
    p.add_argument("--verbose", action="store_true", help="affiche chaque paquet envoyé")
    args = p.parse_args()

    weather = dict(CHERGUI)
    if args.real_weather:
        weather = fetch_weather() or weather
    forest = Forest(weather, args.speed)
    nodes = make_nodes(args.period)
    coap = CoapClient(args.host, args.port)

    # Démonstration CBOR vs JSON (lien avec le TP)
    sample = nodes[0].senml(nodes[0].read_sensors(forest))
    cbor_size = len(cbor2.dumps(sample))
    json_size = len(json.dumps(sample, separators=(",", ":")).encode())
    print("🌲 FireWatch – simulateur démarré")
    print(f"   Serveur CoAP : coap://{args.host}:{args.port}/fw/up")
    print(f"   {len(nodes)} nœuds autour de {CENTER}")
    print(f"   Météo : {weather['temp']}°C, {weather['hum']}% HR, vent {weather['wind_speed']} m/s "
          f"venant de {weather['wind_dir']}°")
    print(f"   Taille d'un paquet SenML : CBOR = {cbor_size} octets / JSON = {json_size} octets "
          f"(-{100 - cbor_size * 100 // json_size}%)\n")

    start, last = time.time(), time.time()
    auto_fire_done = False
    offline_warned = False
    try:
        while True:
            now = time.time()
            forest.step(now - last)
            last = now

            if args.fire_after and not auto_fire_done and now - start >= args.fire_after:
                target = random.choice(nodes)
                forest.start_fire(*offset(target.lat, target.lon, 150, 150))
                auto_fire_done = True

            for node in nodes:
                if now < node.next_send:
                    continue
                readings = node.read_sensors(forest)
                payload = cbor2.dumps(node.senml(readings))
                resp = coap.post("fw/up", payload)
                node.consume_battery()
                node.next_send = now + node.period

                if resp is None:
                    if not offline_warned:
                        print(f"⚠️  Pas de réponse du serveur {args.host}:{args.port} (il est lancé ?)")
                        offline_warned = True
                    continue
                offline_warned = False
                if args.verbose or readings["smoke"] > 300:
                    flag = "🔥" if readings["flame"] else ("💨" if readings["smoke"] > 300 else "  ")
                    print(f"{flag} {node.id} {resp['code']} T={readings['temp']}°C "
                          f"fumée={readings['smoke']:.0f}ppm CO={readings['co']}ppm "
                          f"({len(payload)} o)")
                handle_response(node, resp, forest, nodes)
            time.sleep(0.2)
    except KeyboardInterrupt:
        print("\nArrêt du simulateur.")


if __name__ == "__main__":
    main()