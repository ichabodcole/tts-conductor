import js from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-config-prettier';
import turboPlugin from 'eslint-config-turbo/flat';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  turboPlugin,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
