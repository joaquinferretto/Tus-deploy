/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ['expo', 'plugin:import/typescript'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'boundaries', 'import'],
  settings: {
    'import/resolver': {
      typescript: {
        project: './tsconfig.json',
      },
    },
    'boundaries/elements': [
      { type: 'app', pattern: 'app/**' },
      { type: 'presentation', pattern: 'src/presentation/**' },
      { type: 'application', pattern: 'src/application/**' },
      { type: 'core', pattern: 'src/core/**' },
      { type: 'infrastructure', pattern: 'src/infrastructure/**' },
      { type: 'tests', pattern: 'tests/**' },
    ],
  },
  rules: {
    'boundaries/no-unknown-files': 'off',
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: [
          { from: 'core', allow: ['core'] },
          { from: 'application', allow: ['application', 'core'] },
          { from: 'infrastructure', allow: ['infrastructure', 'core'] },
          { from: 'presentation', allow: ['presentation', 'application', 'core'] },
          { from: 'app', allow: ['app', 'presentation', 'application', 'core', 'infrastructure'] },
          { from: 'tests', allow: ['app', 'presentation', 'application', 'core', 'infrastructure', 'tests'] },
        ],
      },
    ],
    'import/no-cycle': ['error', { maxDepth: 1 }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  },
  overrides: [
    {
      files: ['src/core/**/*.{ts,tsx}', 'src/application/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  'expo',
                  'expo-*',
                  'react-native',
                  '@sentry/*',
                  '@tanstack/*',
                  'axios',
                  'react-native-mmkv',
                  'zustand',
                  'src/infrastructure/*',
                  '@infrastructure/*',
                ],
                message:
                  'Core/application layers must depend on typed ports, not SDKs or infrastructure adapters.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/infrastructure/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['src/presentation/*', '@presentation/*', 'app/*', '@app/*'],
                message: 'Infrastructure adapters must not import UI or composition roots.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/core/services/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
