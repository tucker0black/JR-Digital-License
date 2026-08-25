import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/generated/**',
      '**/playwright-report/**',
      '**/test-results/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(GameRow|AdminTopUpPage)$' }]
    }
  },
  {
    files: ['**/admin/topup/page.tsx'],
    languageOptions: {
      parserOptions: {
        errorOnUnknownASTType: false,
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    }
  },
  prettier
);