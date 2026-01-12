import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { createRequire } from 'module'

// Force restart

// Helper to resolve React paths that works in both npm workspaces and Docker
const resolveReactPath = (pkg: string): string => {
    try {
        // Use createRequire for ESM-compatible resolution
        const require = createRequire(import.meta.url)
        return path.dirname(require.resolve(`${pkg}/package.json`))
    } catch {
        // Fallback for workspace setup (local dev)
        const workspacePath = path.resolve(__dirname, '../node_modules', pkg)
        const localPath = path.resolve(__dirname, 'node_modules', pkg)
        // Prefer workspace path if running locally, otherwise use local
        return require('fs').existsSync(workspacePath) ? workspacePath : localPath
    }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    return {
        plugins: [react()],
        resolve: {
            alias: {
                // Use dynamic resolution that works in both npm workspaces and Docker
                'react': resolveReactPath('react'),
                'react-dom': resolveReactPath('react-dom'),
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
            include: ['react-grid-layout', 'cookie', 'react-router', 'react-router-dom'],
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
