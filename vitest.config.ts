import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/clis/**/*.test.ts'],
          // Run unit tests before e2e tests to avoid project-level contention in CI.
          sequence: {
            groupOrder: 0,
          },
        },
      },
      {
        test: {
          name: 'adapter',
          include: [
            'src/clis/bilibili/**/*.test.ts',
            'src/clis/zhihu/**/*.test.ts',
            'src/clis/v2ex/**/*.test.ts',
          ],
          sequence: {
            groupOrder: 1,
          },
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/**/*.test.ts'],
          maxWorkers: 2,
          sequence: {
            groupOrder: 2,
          },
        },
      },
    ],
  },
});
