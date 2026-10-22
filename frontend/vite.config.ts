import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The app's version, from package.json, baked in at build time. Only the
// version string reaches the bundle, not the rest of the manifest.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: true,
    // allowedHosts: ["approximately-computed-emissions-behind.trycloudflare.com"],
    proxy: {
      // The analytics backend runs on 8001. Port 8000 belongs to the separate
      // Report Console project on this machine, which 404s every /api/cdr/* call.
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
