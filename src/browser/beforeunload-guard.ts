/**
 * Keep a page from wedging the session on its own "Leave site?" prompt.
 *
 * A site that stages unsaved state arms `beforeunload`, and the next navigation
 * opens a native dialog. Nothing in the CLI can answer it: the daemon owns the
 * CDP session, so the dialog events never reach us, and while it is open every
 * evaluate returns an empty document, which reads as a broken adapter rather
 * than a blocked tab.
 *
 * The script must run before the page's own scripts. Blink dispatches listeners
 * on a target in registration order, so a guard injected after load is queued
 * behind the site's handler and cannot stop it; injected first, it wins.
 *
 * The flag hides on a built-in prototype for the reason stealth.ts documents: a
 * bare window property is an automation fingerprint. The extension carries the
 * same script inline, since it cannot import from this package.
 */
export function generateBeforeUnloadGuardJs(): string {
  return `
    (() => {
      const holder = EventTarget.prototype;
      const key = '__lsnUnload';  // looks like an internal listener cache
      if (Object.getOwnPropertyDescriptor(holder, key)) return 'skipped';
      try {
        Object.defineProperty(holder, key, { value: true, enumerable: false, configurable: true });
      } catch {}
      window.addEventListener('beforeunload', (event) => {
        event.stopImmediatePropagation();
        event.returnValue = '';
      }, true);
      window.onbeforeunload = null;
      return 'installed';
    })()
  `;
}
