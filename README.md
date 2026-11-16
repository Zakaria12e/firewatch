# FireWatch

**Détection précoce des feux de forêt par IoT (entièrement simulé)**

Projet du module IoT – Master IDLD, Université Mohammed V, Rabat.  
Zone simulée : forêt de **Talassemtane, près de Chefchaouen** (Rif, Maroc).

Des capteurs virtuels répartis dans la forêt mesurent chaleur, fumée, CO et vent.
Le serveur fusionne les mesures, confirme un départ de feu, prédit la propagation selon
le vent et la pente, puis déclenche les alertes (carte 3D, sirène, notification iPhone).

## Architecture

```
Dashboard (React) ──HTTP──▶ Serveur ──file d'ordres──▶ Moteur de simulation (Python)
                                                           │ automate cellulaire : feu, vent, fumée
Capteurs ──LoRaWAN simulé──▶ Passerelles ──CoAP + CBOR/SenML──▶ Serveur
                                                           ▼
                      Pipeline de détection ──▶ Incidents ──▶ Alertes
Moteur ──POST /api/sim/world (vérité terrain)──▶ Serveur ──▶ Métriques + calque carte
```

Voir [`docs/architecture.md`](docs/architecture.md).

## Stack

| Couche | Technologie |
|---|---|
| Simulateur | Python 3.9+, CoAP (fait maison), CBOR/SenML, numpy |
| Serveur | Node.js 20, Express, Socket.io, node-coap, cbor-x, Mongoose |
| Dashboard | React 19, Vite, TypeScript, Tailwind v4, shadcn (Base UI), MapLibre GL 3D, Recharts |
| Protocoles | CoAP (RFC 7252), CBOR (RFC 8949), SenML (RFC 8428), LoRaWAN simulé |

## Prérequis

- **Python 3.9+** (compatible VM vLab Debian 9)
- **Node.js 20 LTS**
- **MongoDB Community** (optionnel – le serveur fonctionne en mémoire sans Mongo)
- Wireshark optionnel (filtre `coap` sur loopback pour la démo des paquets)

## Installation

```bash
# Simulateur
cd simulator
pip install cbor2

# Serveur
cd server
npm install

# Dashboard
cd client
npm install
```

## Lancement

Ouvrir **3 terminaux** dans le dossier `firewatch/`.

**Terminal 1 – Serveur**
```bash
cd server
cp .env.example .env   # puis éditer si besoin
npm run dev
# → API + dashboard : http://localhost:3000
# → CoAP : udp://localhost:5683
```

**Terminal 2 – Simulateur**
```bash
cd simulator
python firewatch_sim.py
# Options utiles :
#   --fire-after 30      feu automatique après 30 s
#   --speed 3            simulation 3× plus rapide
#   --real-weather       météo Open-Meteo en direct
#   --verbose            afficher toutes les mesures
#   --host 10.0.2.2      depuis la VM (NAT)
```

**Terminal 3 – Dashboard (développement)**
```bash
cd client
npm run dev
# → http://localhost:5173  (ou IP locale pour iPhone)
```

En production, `npm run build` dans `client/` : le serveur sert `client/dist/`.

## Variables d'environnement (`server/.env`)

```env
HTTP_PORT=3000
COAP_PORT=5683
MONGO_URI=              # laisser vide = mémoire seule
NTFY_TOPIC=firewatch-zaki-2026
PUSHOVER_TOKEN=
PUSHOVER_USER=
TIME_SCALE=15           # 1 s réelle = 15 s simulées
PERIOD_NORMAL=10        # période d'envoi capteurs (s)
PERIOD_ALERT=2          # période en mode alerte (s)
```

## Banc d'essai automatique

```bash
cd simulator
python firewatch_sim.py --bench 5
# Lance 5 scénarios × 5 runs en mode accéléré (×50)
# Résultats : docs/bench-results.json + docs/bench-results.md
```

## Scénarios de démo (depuis le dashboard)

| Scénario | Description |
|---|---|
| `chergui` | Feu à l'est, vent fort d'est – détection rapide |
| `au-vent` | Feu à l'ouest, fumée s'éloigne – détection plus lente |
| `nuit` | Feu de nuit, faible vent |
| `deux-foyers` | Sautes de feu – deux incidents séparés |
| `changement-vent` | Vent tourne de 90° pendant le feu |
| `pluie` | Pluie arrive et éteint le feu |

## Équipe

| Membre | Rôle |
|---|---|
| Zakaria Elbidali | Architecte, intégration |
| Membre 2 | Simulateur et réseau IoT |
| Membre 3 | Serveur, détection, alertes |
