// Query connection status from background service worker
chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const hint = document.getElementById('hint');
  if (chrome.runtime.lastError || !resp) {
    dot.className = 'dot disconnected';
    status.innerHTML = '<strong>No daemon connected</strong>';
    hint.style.display = 'block';
    return;
  }
  const profileSuffix = resp.profileLabel
    ? ` · <span style="color:#555">${escapeHtml(resp.profileLabel)}</span>`
    : '';
  if (resp.connected) {
    dot.className = 'dot connected';
    status.innerHTML = `<strong>Connected to daemon</strong>${profileSuffix}`;
    hint.style.display = 'none';
  } else if (resp.reconnecting) {
    dot.className = 'dot connecting';
    status.innerHTML = `<strong>Reconnecting...</strong>${profileSuffix}`;
    hint.style.display = 'none';
  } else {
    dot.className = 'dot disconnected';
    status.innerHTML = `<strong>No daemon connected</strong>${profileSuffix}`;
    hint.style.display = 'block';
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
