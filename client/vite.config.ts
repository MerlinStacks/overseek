import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { createRequire } from 'module'

// Force restart

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    return {
        plugins: [react()],
        resolve: {
            dedupe: [
                'react',
                'react-dom',
                'lexical',
                '@lexical/react',
                '@lexical/html',
                '@lexical/link',
                '@lexical/list',
                '@lexical/rich-text',
                '@lexical/selection',
                '@lexical/utils'
            ],
            alias: {
                // Force single React instance - critical for react-email-editor compatibility with React 19.
                // Use package.json resolution (not directory path) to properly handle subpath exports.
                'react': path.dirname(createRequire(import.meta.url).resolve('react/package.json')),
                'react-dom': path.dirname(createRequire(import.meta.url).resolve('react-dom/package.json')),
            }
        },
        server: {
            allowedHosts: [
                'overseek.plateit.au',
                'localhost',
                ...(env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',') : [])
            ],
            hmr: {
                clientPort: 443
            },
            host: env.HOST === 'true' ? true : (env.HOST || true), // Default to true for Docker, or allow override
            port: parseInt(env.PORT) || 5173,
            watch: {
                usePolling: true
            },
            proxy: {
                '/uploads': {
                    target: env.VITE_API_URL || 'http://localhost:3000',
                    changeOrigin: true
                },
                '/api': {
                    target: env.VITE_API_URL || 'http://localhost:3000',
                    changeOrigin: true,
                    // rewrite: (path) => path.replace(/^\/api/, '') // Don't strip /api, server expects it
                },
                '/admin/queues': {
                    target: env.VITE_API_URL || 'http://localhost:3000',
                    changeOrigin: true
                },
                '/socket.io': {
                    target: env.VITE_API_URL || 'http://localhost:3000',
                    ws: true,
                    changeOrigin: true
                }
            }
        },
        optimizeDeps: {
            // Don't include react/react-dom - React 19 is ESM-native and doesn't need pre-bundling
            include: ['react-grid-layout', 'cookie', 'react-router', 'react-router-dom', 'react-email-editor'],
        },
        build: {
            commonjsOptions: {
                include: [/react-grid-layout/, /cookie/, /node_modules/],
                transformMixedEsModules: true
            },
            rollupOptions: {
                output: {
                    manualChunks: (id) => {
                        if (id.includes('node_modules')) {
                            if (id.includes('echarts')) return 'echarts';
                            if (id.includes('jspdf')) return 'pdf';
                            if (id.includes('react-grid-layout') || id.includes('react-resizable')) return 'grid';
                            if (id.includes('@xyflow')) return 'flow';
                            if (id.includes('lexical') || id.includes('@lexical')) return 'editor';
                            if (id.includes('react-email-editor')) return 'email-editor';
                            if (id.includes('react-markdown') || id.includes('remark-gfm')) return 'markdown';
                            if (id.includes('lucide-react')) return 'icons';

                            // Vendor chunk for React core
                            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/')) {
                                return 'vendor';
                            }
                        }
                    }
                }
            }
        }
    }
})
