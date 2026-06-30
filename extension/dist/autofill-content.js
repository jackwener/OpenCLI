const MESSAGE_TYPE = "autofill-page-ready";
const NOTIFY_DELAYS_MS = [0, 500, 1500];
function notifyBackground() {
  try {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE, url: window.location.href }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
  }
}
for (const delay of NOTIFY_DELAYS_MS) {
  window.setTimeout(notifyBackground, delay);
}
