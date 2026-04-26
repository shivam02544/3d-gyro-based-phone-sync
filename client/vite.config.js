import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/]three[\\/]/.test(id)) return 'three-core';
          if (/node_modules[\\/]@react-three[\\/]fiber[\\/]/.test(id)) return 'r3f';
          if (/node_modules[\\/]@react-three[\\/]drei[\\/]/.test(id)) return 'drei';
          if (/node_modules[\\/]framer-motion[\\/]/.test(id)) return 'motion';
          if (/node_modules[\\/]socket\.io-client[\\/]/.test(id)) return 'socket';
          if (/node_modules[\\/]/.test(id)) return 'vendor';
        }
      }
    }
  }
})
