/**
 * Browser module — public API re-exports.
 *
 * This barrel replaces the former monolithic browser.ts.
 * External code should import from './browser/index.js' (or './browser.js' via Node resolution).
 */

export { Page } from './page.js';
export { BrowserBridge } from './bridge.js';
export { CDPBridge } from './cdp.js';
export { isDaemonRunning } from './daemon-client.js';
export { generateSnapshotJs, scrollToRefJs, getFormStateJs } from './dom-snapshot.js';
export { generateStealthJs } from './stealth.js';
export type { DomSnapshotOptions } from './dom-snapshot.js';
