import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // proxy API calls to FastAPI so no CORS issues in dev
    proxy: {
      '/ingest': 'http://localhost:8000',
      '/query': 'http://localhost:8000',
      '/citations': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    }
  }
})