import { describe, expect, it } from 'vitest';
import { viewportPointToScreenPoint } from './system-input.js';

describe('viewportPointToScreenPoint', () => {
  it('adds browser chrome offsets to viewport coordinates', () => {
    const point = viewportPointToScreenPoint({
      screenX: 100,
      screenY: 50,
      outerWidth: 1200,
      outerHeight: 900,
      innerWidth: 1180,
      innerHeight: 760,
    }, { x: 90, y: 200 });

    expect(point).toEqual({ x: 200, y: 380 });
  });

  it('does not invent negative offsets for fullscreen-like windows', () => {
    const point = viewportPointToScreenPoint({
      screenX: 10,
      screenY: 20,
      outerWidth: 1200,
      outerHeight: 800,
      innerWidth: 1200,
      innerHeight: 800,
    }, { x: 12, y: 34 });

    expect(point).toEqual({ x: 22, y: 54 });
  });
});
