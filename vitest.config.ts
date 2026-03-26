import { defineConfig } from 'vitest/config';

const includeExtendedE2e = process.env.OPENCLI_E2E === '1';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/clis/**/*.test.ts'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'adapter',
          include: [
            'src/clis/bilibili/**/*.test.ts',
            'src/clis/jd/**/*.test.ts',
            'src/clis/linux-do/**/*.test.ts',
            'src/clis/xiaohongshu/**/*.test.ts',
            'src/clis/twitter/**/*.test.ts',
            'src/clis/zhihu/**/*.test.ts',
            'src/clis/v2ex/**/*.test.ts',
            'src/clis/weread/**/*.test.ts',
            'src/clis/36kr/**/*.test.ts',
            'src/clis/producthunt/**/*.test.ts',
          ],
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'e2e',
          include: [
            'tests/e2e/browser-public.test.ts',
            'tests/e2e/public-commands.test.ts',
            'tests/e2e/management.test.ts',
            'tests/e2e/output-formats.test.ts',
            'tests/e2e/plugin-management.test.ts',
            // Extended browser tests (20+ sites) — opt-in only:
            //   OPENCLI_E2E=1 npx vitest run
            ...(includeExtendedE2e ? ['tests/e2e/browser-public-extended.test.ts', 'tests/e2e/browser-auth.test.ts'] : []),
          ],
          maxWorkers: 2,
          sequence: { groupOrder: 2 },
        },
      },
      {
        test: {
          name: 'smoke',
          include: ['tests/smoke/**/*.test.ts'],
          sequence: { groupOrder: 3 },
        },
      },
    ],
  },
});
