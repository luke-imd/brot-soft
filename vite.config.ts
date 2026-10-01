/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev: API-Aufrufe an den lokalen Node-Server (npm run server) weiterreichen
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'node' },
})
