"""État météo du monde simulé + préréglages + récupération Open-Meteo."""
import json
import urllib.request

# Coordonnées du centre de la forêt surveillée
CENTER_LAT = 35.135
CENTER_LON = -5.215

PRESETS = {
    "chergui": {"temp": 36.0, "hum": 18.0, "wind_speed": 7.0, "wind_dir": 100.0,
                "gust": 10.0, "fmc": 8.0, "rain": 0.0},
    "normal":  {"temp": 24.0, "hum": 45.0, "wind_speed": 3.0, "wind_dir": 270.0,
                "gust": 5.0,  "fmc": 20.0, "rain": 0.0},
    "pluie":   {"temp": 16.0, "hum": 85.0, "wind_speed": 2.0, "wind_dir": 230.0,
                "gust": 4.0,  "fmc": 60.0, "rain": 5.0},
    "nuit":    {"temp": 18.0, "hum": 55.0, "wind_speed": 1.5, "wind_dir": 320.0,
                "gust": 3.0,  "fmc": 25.0, "rain": 0.0},
}


def default_weather():
    """Préréglage Chergui (vent d'est chaud et sec, cause des grands feux dans le Rif)."""
    return dict(PRESETS["chergui"])


def fetch_real_weather():
    """Météo actuelle (Open-Meteo) au centre de la forêt. Retourne None si indisponible."""
    url = (
        "https://api.open-meteo.com/v1/forecast"
        "?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,"
        "wind_direction_10m,wind_gusts_10m,precipitation"
        "&wind_speed_unit=ms"
    ).format(lat=CENTER_LAT, lon=CENTER_LON)
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            c = json.load(r)["current"]
        return {
            "temp": float(c["temperature_2m"]),
            "hum": float(c["relative_humidity_2m"]),
            "wind_speed": float(c["wind_speed_10m"]),
            "wind_dir": float(c["wind_direction_10m"]),
            "gust": float(c.get("wind_gusts_10m", c["wind_speed_10m"] * 1.3)),
            "fmc": 20.0,   # pas disponible Open-Meteo gratuit
            "rain": float(c.get("precipitation", 0.0)),
        }
    except Exception as exc:
        print(f"⚠️  Météo réelle indisponible ({exc.__class__.__name__}), Chergui utilisé.")
        return None
