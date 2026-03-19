import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  ignores: [
    'dist/**',
    'scripts/**',
    '**/*.cjs',
    // E2E/smoke tests and vitest.config.ts are outside tsconfig.json include path
    'tests/**',
    'vitest.config.ts',
  ],
  rules: {
    // Phase 1: warn on any — tighten to error incrementally
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // CLI tool needs console output
    'no-console': 'off',
  },
}, {
  // Disable opinionated jsonc sort-keys for config files
  files: ['**/*.json', '**/*.jsonc'],
  rules: {
    'jsonc/sort-keys': 'off',
  },
})
