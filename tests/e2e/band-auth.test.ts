import { describe, it } from 'vitest';
import { expectGracefulAuthFailure } from './browser-auth-helpers.js';

describe('band auth-required commands — graceful failure', () => {
  it('band bands fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['band', 'bands', '-f', 'json']);
  }, 60_000);

  it('band mentions fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['band', 'mentions', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('band posts fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['band', 'posts', '58400480', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('band post fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['band', 'post', '58400480', '1', '-f', 'json']);
  }, 60_000);
});
