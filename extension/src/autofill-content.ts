const MESSAGE_TYPE = 'autofill-page-ready';
const NOTIFY_DELAYS_MS = [0, 500, 1500];

function notifyBackground(): void {
  try {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE, url: window.location.href }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Content scripts can be orphaned while an unpacked extension reloads.
  }
}

for (const delay of NOTIFY_DELAYS_MS) {
  window.setTimeout(notifyBackground, delay);
}
