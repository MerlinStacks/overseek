import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['leaflet', 'react-leaflet'],
  },
  server: {
    host: true, // Needed for Docker exposure
    hmr: {
      overlay: false
    },
    proxy: {
      // Proxy /api requests to the backend service
      '/admin': {
        target: process.env.VITE_API_URL || 'http://backend:4000',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: process.env.VITE_API_URL || 'http://backend:4000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
