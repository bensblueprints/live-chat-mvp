import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5315,
    proxy: {
      '/api': 'http://localhost:5314',
      '/ws': { target: 'ws://localhost:5314', ws: true }
    }
  }
});
