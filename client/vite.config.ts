import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Force restart

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    return {
        plugins: [react()],
        server: {
            allowedHosts: (env.ALLOWED_HOSTS || env.VITE_ALLOWED_HOSTS) ? (env.ALLOWED_HOSTS || env.VITE_ALLOWED_HOSTS).split(',') : [],
            host: env.HOST === 'true' ? true : (env.HOST || true), // Default to true for Docker, or allow override
            port: parseInt(env.PORT) || 5173,
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
    }
})
