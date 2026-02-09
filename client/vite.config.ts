import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { visualizer } from 'rollup-plugin-visualizer'

// Force restart

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    return {
        plugins: [
            react(),
            tailwindcss(),
            // Auto-version the service worker on each build to bust caches
            // Uses writeBundle hook since public/ files are copied, not transformed
            {
                name: 'sw-version',
                writeBundle: {
                    sequential: true,
                    handler() {
                        const swPath = path.join(__dirname, 'dist', 'push-sw.js');
                        if (fs.existsSync(swPath)) {
                            let content = fs.readFileSync(swPath, 'utf-8');
                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                            content = content.replaceAll('__BUILD_TIMESTAMP__', timestamp);
                            fs.writeFileSync(swPath, content);
                            console.log(`[sw-version] Service worker versioned: ${timestamp}`);
                        }
                    }
                }
            },
            // Bundle analyzer - run with: ANALYZE=true npm run build
            env.ANALYZE === 'true' && visualizer({
                open: true,
                filename: 'bundle-analysis.html',
                gzipSize: true,
                brotliSize: true,
            }),
        ].filter(Boolean),
        // Auto-generate app version at build time for PWA update detection
        define: {
            __APP_VERSION__: JSON.stringify(new Date().toISOString().split('T')[0].replace(/-/g, '.'))
        },
        resolve: {
            dedupe: [
                'react',
                'react-dom',
                'react-router',
                'react-router-dom',
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
                'localhost',
                ...(env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',').map(h => h.trim()) : [])
            ],
            hmr: {
                protocol: env.HMR_PROTOCOL || 'wss',
                clientPort: parseInt(env.HMR_PORT) || 443,
                host: env.HMR_HOST || undefined  // undefined = use window.location.host
            },
            host: env.HOST === 'true' ? true : (env.HOST || true), // Default to true for Docker, or allow override
            port: parseInt(env.PORT) || 5173,
            watch: {
                usePolling: true
            },
            // Disable caching for critical files to prevent stale asset issues
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
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
                // Capacitor is optional (only used in native builds) - don't fail Docker builds
                external: ['@capacitor/haptics'],
                output: {
                    manualChunks: (id) => {
                        if (id.includes('node_modules')) {
                            // echarts and its dependencies (zrender) should be in the same chunk
                            if (id.includes('echarts') || id.includes('zrender')) return 'echarts';
                            if (id.includes('jspdf')) return 'pdf';
                            if (id.includes('react-grid-layout') || id.includes('react-resizable')) return 'grid';
                            if (id.includes('@xyflow')) return 'flow';
                            if (id.includes('lexical') || id.includes('@lexical')) return 'editor';
                            if (id.includes('react-email-editor')) return 'email-editor';
                            if (id.includes('react-markdown') || id.includes('remark-gfm')) return 'markdown';
                            if (id.includes('lucide-react')) return 'icons';

                            // Vendor chunk for React core - exclude echarts/zrender deps
                            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
                                return 'vendor';
                            }
                        }
                    }
                }
            }
        }
    }
})
