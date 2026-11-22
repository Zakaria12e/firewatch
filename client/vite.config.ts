import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Serveur FireWatch ciblé par le proxy (ex. FIREWATCH_API=http://10.0.2.15:3000 pour la VM)
const API = process.env.FIREWATCH_API || "http://localhost:3000"

export default defineConfig({
  // Cache de pré-bundling séparable (deux serveurs de dev sur le même dossier)
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
  },
  server: {
    host: true,
    proxy: {
      "/api": API,
      "/socket.io": {
        target: API,
        ws: true,
      },
    },
  },
})