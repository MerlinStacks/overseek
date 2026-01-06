import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Force restart

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        host: true, // Needed for Docker
        port: 5173,
        watch: {
            usePolling: true
        },
        proxy: {
            '/api': {
                target: 'http://api:3000',
                changeOrigin: true,
                // rewrite: (path) => path.replace(/^\/api/, '') // Don't strip /api, server expects it
            },
            '/admin/queues': {
                target: 'http://api:3000',
                changeOrigin: true
            },
            '/socket.io': {
                target: 'http://api:3000',
                ws: true,
                changeOrigin: true
            }
        }
    },
    optimizeDeps: {
        include: ['react-grid-layout']
    },
    build: {
        commonjsOptions: {
            include: [/react-grid-layout/]
        }
    }
})
