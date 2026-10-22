/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    plugins: [react()],
    resolve: { alias: { '@capacitor/haptics': fileURLToPath(new URL('./src/test/capacitorHaptics.ts', import.meta.url)) } },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/setupTests.ts',
        css: true,
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
});
