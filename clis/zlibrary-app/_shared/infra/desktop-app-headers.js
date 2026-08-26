/**
 * Desktop App Headers  -  shared use by cdp-fetch-transport.js and
 * probe-cdp-download.mjs.
 *
 * Builds desktop-app-* headers matching the real Electron app request profile.
 * These headers help the CDN identify a request as coming from the official
 * Z-Library Desktop app rather than a generic HTTP client.
 */
import os from 'node:os'

// Module load timestamp — used for desktop-app-active-time (elapsed seconds, not epoch)
// CDP log shows values like "175" meaning active seconds since the app started.
const HTTP_DOWNLOAD_START_TIME = Date.now()

/**
 * Build desktop-app headers matching the real Electron app request profile.
 *
 * Uses elapsed seconds since module load (not epoch seconds) to match the
 * real Electron app's `desktop-app-active-time` header value.
 *
 * @returns {Record<string, string>}
 */
function buildDesktopAppHeaders () {
  return {
    'desktop-app-active-time': String(Math.floor((Date.now() - HTTP_DOWNLOAD_START_TIME) / 1000)),
    'desktop-app-os': `Darwin ${os.release()}`,
    'desktop-app-version': '2.1.2',
  }
}

export { buildDesktopAppHeaders, HTTP_DOWNLOAD_START_TIME }
