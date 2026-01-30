import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/prisma/generated/**', '**/.prisma/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-ignore': 'allow-with-description' }],
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_|^err$|^error$|^e$|^i$|^j$|^k$',
                    caughtErrorsIgnorePattern: '^_|^err$|^error$|^e$',
                },
            ],
            '@typescript-eslint/no-var-requires': 'off',
            '@typescript-eslint/no-require-imports': 'off',
            'prefer-const': 'off',
            'no-undef': 'off',
        },
    },
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                process: 'readonly',
                console: 'readonly',
                __dirname: 'readonly',
                module: 'readonly',
                require: 'readonly',
                Buffer: 'readonly'
            }
        }
    }
);
