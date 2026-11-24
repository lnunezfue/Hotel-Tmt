import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// En desarrollo la API se sirve bajo el mismo origen (/api) para usar cookies seguras sin CORS (DT-001 §4.6).
// API_URL permite apuntar a otra instancia de la API (p. ej. dos copias del proyecto levantadas a la vez).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' } },
});
