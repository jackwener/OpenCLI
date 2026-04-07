/**
 * Shared config for the ComfyUI plugin.
 *
 * Configuration via environment variables:
 *   COMFYUI_HOST  — ComfyUI server base URL (default: http://127.0.0.1:8188)
 *
 * Example:
 *   export COMFYUI_HOST=http://192.168.1.100:8008
 *   opencli comfyui system-stats
 */

export const COMFYUI_HOST = typeof process !== 'undefined'
  ? (process.env.COMFYUI_HOST || 'http://127.0.0.1:8188')
  : 'http://127.0.0.1:8188';

export function url(path) {
  const host = COMFYUI_HOST.replace(/\/+$/, '');
  return `${host}${path.startsWith('/') ? path : '/' + path}`;
}
