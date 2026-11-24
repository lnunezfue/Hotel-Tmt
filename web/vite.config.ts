import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// En desarrollo la API se sirve bajo el mismo origen (/api) para usar cookies seguras sin CORS (DT-001 §4.6).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // La demostración web se publica en una carpeta cualquiera: rutas relativas (pnpm --filter web build:demo).
  base: process.env.VITE_DEMO === '1' ? './' : '/',
  // La demo se publica como una sola página: un único archivo JS
  build: process.env.VITE_DEMO === '1' ? { rollupOptions: { output: { inlineDynamicImports: true } } } : undefined,
  // API_URL permite apuntar a otra instancia de la API (p. ej. dos copias del proyecto levantadas a la vez).
  server: { port: 5173, proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' } },
});
