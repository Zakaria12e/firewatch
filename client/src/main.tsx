import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setWorkerUrl } from 'maplibre-gl'
// Worker MapLibre (décodage des tuiles d'altitude du relief) servi comme fichier à part :
// sans cela, MapLibre le cherche à côté du bundle et le relief reste plat.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import './index.css'
import App from './App.tsx'

setWorkerUrl(maplibreWorkerUrl)
document.documentElement.classList.add("dark")

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
