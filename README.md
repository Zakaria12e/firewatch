# 🔥 FireWatch

**Détection précoce des feux de forêt par IoT (simulé)**

Projet du module IoT – Master IDLD, Université Mohammed V, Rabat.

Des capteurs virtuels répartis dans une forêt du Rif mesurent la chaleur, la fumée, le gaz et le vent.
Le serveur confirme un départ de feu avec plusieurs capteurs, prévoit sa direction grâce au vent,
puis déclenche les alertes (carte en direct, sirène, notification iPhone).

## Architecture

```
Simulateur capteurs (Python) ──CoAP + CBOR/SenML──▶ Serveur (Node.js + Express) ──▶ Dashboard (React + shadcn)
                                                        │        │
                                                     MongoDB   Alertes iPhone (ntfy / Pushover)
```

Voir [`docs/architecture.md`](docs/architecture.md).

## Structure du dépôt

| Dossier | Contenu | Techno |
|---|---|---|
| `simulator/` | Nœuds IoT virtuels + scénario de feu | Python, CoAP, CBOR/SenML |
| `server/` | Réception CoAP, API, détection, alertes | Node.js, Express, Socket.io, MongoDB |
| `client/` | Tableau de bord avec carte en direct | React, Vite, shadcn, Leaflet |
| `docs/` | Rapport, schémas | Markdown, Mermaid |

## Prérequis (Windows)

- Python 3.10+
- Node.js 20 LTS
- MongoDB Community (ou MongoDB Atlas)
- Git
- Wireshark (optionnel, pour la démo des paquets CoAP)

## Lancer le projet

```bash
# 1. Serveur
cd server
npm install
cp .env.example .env
npm run dev

# 2. Dashboard
cd client
npm install
npm run dev

# 3. Simulateur
cd simulator
pip install -r requirements.txt
python firewatch_sim.py
```

## Équipe

| Membre | Rôle |
|---|---|
| Membre 1 | Simulateur et réseau IoT |
| Membre 2 | Serveur, base de données, détection |
| Membre 3 | Tableau de bord |
