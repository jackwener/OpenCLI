import { defineConfig } from 'vitest/config';

const includeExtendedE2e = process.env.OPENCLI_E2E === '1';
const includeAxChromeE2e = process.env.OPENCLI_AX_E2E === '1';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['clis/**/*.test.{ts,js}'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'extension',
          include: ['extension/src/**/*.test.ts'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'adapter',
          include: ['clis/**/*.test.{ts,js}'],
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'e2e-fixed-port',
          include: ['tests/e2e/browser-tabs.test.ts', 'tests/e2e/daemon-transport.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
      {
        test: {
          name: 'e2e',
          include: [
            'tests/e2e/auth-contract.test.ts',
            'tests/e2e/local-commands.test.ts',
            'tests/e2e/management.test.ts',
            ...(includeAxChromeE2e ? ['tests/e2e/browser-ax-chrome.test.ts', 'tests/e2e/site-slots-chrome.test.ts'] : []),
            ...(process.env.OPENCLI_P0_E2E === '1' ? ['tests/e2e/browser-p0-chrome.test.ts'] : []),
            // Live sites require an authenticated browser; keep them out of offline E2E.
            //   OPENCLI_E2E=1 npx vitest run
            ...(includeExtendedE2e ? ['tests/e2e/browser-public.test.ts', 'tests/e2e/douban.test.ts', 'tests/e2e/plugin-management.test.ts', 'tests/e2e/article-download-pipeline.test.ts'] : []),
          ],
          maxWorkers: 2,
          sequence: { groupOrder: 3 },
        },
      },
      {
        test: {
          name: 'smoke',
          include: ['tests/smoke/**/*.test.ts'],
          sequence: { groupOrder: 4 },
        },
      },
    ],
  },
});
