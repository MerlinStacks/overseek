import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
    { ignores: ['dist', 'node_modules', '*.config.js', '*.config.ts', 'public/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_|^err$|^error$|^e$|^i$|^j$|^k$',
                caughtErrorsIgnorePattern: '^_|^err$|^error$|^e$'
            }],
            '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
            'no-case-declarations': 'warn',
        },
    },
    // Service worker files
    {
        files: ['**/sw.ts', '**/service-worker.ts'],
        languageOptions: {
            globals: {
                self: 'readonly',
                clients: 'readonly',
                caches: 'readonly',
                fetch: 'readonly',
            },
        },
    }
);
