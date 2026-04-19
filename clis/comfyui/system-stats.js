import { cli, Strategy } from '../../registry.js';
import { url } from './config.js';

cli({
  site: 'comfyui',
  name: 'system-stats',
  description: 'Show ComfyUI server status and system information',
  strategy: Strategy.PUBLIC,
  columns: ['comfyui_version', 'os', 'devices', 'ram_total', 'ram_free'],
  func: async () => {
    const res = await fetch(url('/api/system_stats'));
    const data = await res.json();
    const sys = data.system || {};
    const devices = data.devices || [];

    const formatBytes = (bytes) => {
      if (!bytes) return 'N/A';
      return (bytes / 1073741824).toFixed(1) + ' GB';
    };

    const devNames = devices.map(d => `${d.name || d.device || 'unknown'} (${formatBytes(d.vram_total)})`).join(', ');

    return [{
      comfyui_version: sys.comfyui_version || 'unknown',
      os: sys.os || 'unknown',
      devices: devices.length > 0 ? `${devices.length} device(s): ${devNames}` : 'none',
      ram_total: formatBytes(sys.ram_total),
      ram_free: formatBytes(sys.ram_free),
    }];
  },
});
