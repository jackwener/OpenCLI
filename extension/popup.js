// Query connection status from background service worker
chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  if (chrome.runtime.lastError || !resp) {
    dot.className = 'dot disconnected';
    status.innerHTML = '<strong>No daemon connected</strong>';
    return;
  }
  if (resp.connected) {
    dot.className = 'dot connected';
    status.innerHTML = '<strong>Connected to daemon</strong>';
  } else if (resp.reconnecting) {
    dot.className = 'dot connecting';
    status.innerHTML = '<strong>Reconnecting...</strong>';
  } else {
    dot.className = 'dot disconnected';
    status.innerHTML = '<strong>No daemon connected</strong>';
  }
});
