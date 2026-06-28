import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface BrowserViewportMetrics {
  readonly screenX: number;
  readonly screenY: number;
  readonly outerWidth: number;
  readonly outerHeight: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

export function viewportPointToScreenPoint(
  metrics: BrowserViewportMetrics,
  point: ViewportPoint,
): ScreenPoint {
  assertFiniteNumber('point.x', point.x);
  assertFiniteNumber('point.y', point.y);
  assertFiniteNumber('metrics.screenX', metrics.screenX);
  assertFiniteNumber('metrics.screenY', metrics.screenY);
  assertFiniteNumber('metrics.outerWidth', metrics.outerWidth);
  assertFiniteNumber('metrics.outerHeight', metrics.outerHeight);
  assertFiniteNumber('metrics.innerWidth', metrics.innerWidth);
  assertFiniteNumber('metrics.innerHeight', metrics.innerHeight);

  const sideInset = Math.max(0, Math.round((metrics.outerWidth - metrics.innerWidth) / 2));
  const topInset = Math.max(0, Math.round(metrics.outerHeight - metrics.innerHeight - sideInset));
  return {
    x: Math.round(metrics.screenX + sideInset + point.x),
    y: Math.round(metrics.screenY + topInset + point.y),
  };
}

export async function clickScreenPoint(point: ScreenPoint): Promise<void> {
  assertFiniteNumber('point.x', point.x);
  assertFiniteNumber('point.y', point.y);
  if (process.platform !== 'darwin') {
    throw new Error('systemClick is currently implemented only on macOS');
  }

  await execFileAsync('/usr/bin/swift', [
    '-e',
    [
      'import AppKit',
      'import CoreGraphics',
      'import Foundation',
      'if let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome").first { app.activate(options: [.activateAllWindows]) }',
      'usleep(150000)',
      `let point = CGPoint(x: ${Math.round(point.x)}, y: ${Math.round(point.y)})`,
      'let source = CGEventSource(stateID: .hidSystemState)',
      'CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)',
      'usleep(50000)',
      'CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)',
      'usleep(50000)',
      'CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)',
    ].join('; '),
  ], { timeout: 5000 });
}

export const BROWSER_VIEWPORT_METRICS_SCRIPT = `(() => ({
  screenX: window.screenX,
  screenY: window.screenY,
  outerWidth: window.outerWidth,
  outerHeight: window.outerHeight,
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
}))()`;
