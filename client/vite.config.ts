import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Force restart

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    return {
        plugins: [react()],
        resolve: {
            alias: {
                // Force all React imports to resolve from root node_modules (npm workspace hoists React there)
                'react': path.resolve(__dirname, '../node_modules/react'),
                'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
            }
        },
        server: {
            allowedHosts: (env.ALLOWED_HOSTS || env.VITE_ALLOWED_HOSTS) ? (env.ALLOWED_HOSTS || env.VITE_ALLOWED_HOSTS).split(',') : [],
            host: env.HOST === 'true' ? true : (env.HOST || true), // Default to true for Docker, or allow override
            port: parseInt(env.PORT) || 5173,
            watch: {
                usePolling: true
            },
            proxy: {
                '/uploads': {
                    target: 'http://api:3000',
                    changeOrigin: true
                },
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
            include: ['react-grid-layout', 'cookie', 'react-router', 'react-router-dom', 'react', 'react-dom'],
        },
        build: {
            commonjsOptions: {
                include: [/react-grid-layout/, /cookie/, /node_modules/],
                transformMixedEsModules: true
            }
        }
    }
})
