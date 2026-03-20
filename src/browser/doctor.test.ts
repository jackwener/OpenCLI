import { describe, expect, it } from 'vitest';
import { renderBrowserBackendDoctorReport } from './doctor.js';

describe('browser doctor report rendering', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  it('renders extension backend details', () => {
    const text = strip(renderBrowserBackendDoctorReport({
      requestedBackend: 'extension',
      backend: 'extension',
      discoveredDebugBrowsers: [{ port: 9339, endpoint: 'http://127.0.0.1:9339', launchMode: 'background', userDataKind: 'temporary', source: 'opencli', status: 'alive' }],
      daemonRunning: true,
      extensionConnected: true,
      issues: [],
    }));

    expect(text).toContain('[INFO] Requested backend: extension');
    expect(text).toContain('[OK] Effective backend: extension');
    expect(text).toContain('[INFO] Local CDP browsers: 1 active (9339)');
    expect(text).toContain('[OK] Daemon: running on port 19825');
    expect(text).toContain('[OK] Extension: connected');
    expect(text).toContain('Everything looks good!');
  });

  it('renders cdp backend details', () => {
    const text = strip(renderBrowserBackendDoctorReport({
      requestedBackend: 'cdp',
      backend: 'cdp',
      discoveredDebugBrowsers: [{ port: 9222, endpoint: 'http://127.0.0.1:9222', launchMode: 'unknown', userDataKind: 'unknown', source: 'discovered', status: 'alive' }],
      cdpEndpoint: 'http://127.0.0.1:9222',
      connectivity: { ok: true, durationMs: 350 },
      issues: [],
    }));

    expect(text).toContain('[INFO] Requested backend: cdp');
    expect(text).toContain('[OK] Effective backend: cdp');
    expect(text).toContain('[OK] CDP endpoint: http://127.0.0.1:9222');
    expect(text).toContain('[OK] Connectivity: connected in 0.3s');
  });

  it('renders missing cdp endpoint', () => {
    const text = strip(renderBrowserBackendDoctorReport({
      requestedBackend: 'cdp',
      backend: 'cdp',
      discoveredDebugBrowsers: [],
      issues: ['CDP endpoint is not configured.'],
    }));

    expect(text).toContain('[INFO] Local CDP browsers: none discovered');
    expect(text).toContain('[MISSING] CDP endpoint: not configured');
    expect(text).toContain('CDP endpoint is not configured.');
  });
});
