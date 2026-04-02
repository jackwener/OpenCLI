const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 19825;

function renderStatus(resp) {
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const hint = document.getElementById('hint');
  if (chrome.runtime.lastError || !resp) {
    dot.className = 'dot disconnected';
    status.innerHTML = '<strong>No daemon connected</strong>';
    hint.style.display = 'block';
    return;
  }
  if (resp.connected) {
    dot.className = 'dot connected';
    status.innerHTML = '<strong>Connected to daemon</strong>';
    hint.style.display = 'none';
  } else if (resp.reconnecting) {
    dot.className = 'dot connecting';
    status.innerHTML = '<strong>Reconnecting...</strong>';
    hint.style.display = 'none';
  } else {
    dot.className = 'dot disconnected';
    status.innerHTML = '<strong>No daemon connected</strong>';
    hint.style.display = 'block';
  }
}

function loadFields() {
  chrome.storage.local.get(
    { daemonHost: DEFAULT_HOST, daemonPort: DEFAULT_PORT },
    (stored) => {
      document.getElementById('host').value = stored.daemonHost || DEFAULT_HOST;
      document.getElementById('port').value = String(stored.daemonPort ?? DEFAULT_PORT);
    },
  );
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
    renderStatus(resp);
  });
}

document.getElementById('save').addEventListener('click', () => {
  const hostRaw = document.getElementById('host').value;
  const host = (hostRaw && hostRaw.trim()) ? hostRaw.trim() : DEFAULT_HOST;
  const portNum = parseInt(document.getElementById('port').value, 10);
  const hintEl = document.getElementById('saveHint');
  if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
    hintEl.textContent = 'Enter a valid port (1–65535).';
    hintEl.style.color = '#ff3b30';
    return;
  }
  chrome.storage.local.set({ daemonHost: host, daemonPort: portNum }, () => {
    hintEl.textContent = 'Saved. Reconnecting…';
    hintEl.style.color = '#34c759';
    setTimeout(() => {
      hintEl.textContent = '';
      refreshStatus();
    }, 800);
  });
});

loadFields();
refreshStatus();
