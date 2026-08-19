import { expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

await Promise.all([
  './action.js', './describe.js', './download.js', './generate.js', './history.js',
  './login.js', './quota.js', './settings.js', './status.js', './whoami.js',
].map((file) => import(file)));

it('adapter exposes the intentional ten-command surface', () => {
  const commands = [...new Set([...getRegistry().values()]
    .filter((command) => command.site === 'midjourney')
    .map((command) => command.name))].sort();
  expect(commands).toEqual([
    'action', 'describe', 'download', 'generate', 'history',
    'login', 'quota', 'settings', 'status', 'whoami',
  ]);
});

it('auth, quota alias, and paid-command safety metadata are registered', () => {
  const registry = getRegistry();
  const whoami = registry.get('midjourney/whoami');
  const quota = registry.get('midjourney/quota');
  const generate = registry.get('midjourney/generate');
  const action = registry.get('midjourney/action');
  expect(typeof whoami?.authStatus?.quickCheck).toBe('function');
  expect(quota?.aliases).toEqual(['account']);
  for (const command of [generate, action]) {
    const names = new Set(command.args.map((arg) => arg.name));
    expect(names.has('dry-run')).toBe(true);
    expect(names.has('max-minutes')).toBe(true);
    expect(names.has('reserve-minutes')).toBe(true);
  }
});

it('all public Midjourney output columns follow the repository snake_case contract', () => {
  const commands = [...getRegistry().values()].filter((command) => command.site === 'midjourney');
  for (const command of commands) {
    expect(command.columns, `${command.site}/${command.name}`).toBeDefined();
    for (const column of command.columns) {
      expect(column, `${command.site}/${command.name}`).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
    }
  }
});
