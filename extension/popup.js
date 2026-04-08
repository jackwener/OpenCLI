const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 19825;
const HOST_VALIDATION_ERROR = 'Enter hostname or IP only, no scheme or port.';

function normalizeHost(host) {
  let value = (host || '').trim();
  if (!value) return DEFAULT_HOST;

  if (value.includes('://')) {
    try {
      value = new URL(value).hostname || value;
    } catch {
      value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    }
  }

  value = value.replace(/[/?#].*$/, '');

  const bracketedIpv6Match = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6Match && bracketedIpv6Match[1]) return bracketedIpv6Match[1];

  const colonCount = (value.match(/:/g) || []).length;
  if (colonCount === 1) {
    const [hostname] = value.split(':');
    value = hostname || value;
  }

  return value.trim() || DEFAULT_HOST;
}

function validateHost(host) {
  const value = (host || '').trim();
  if (!value) return null;
  if (value.includes('://')) return HOST_VALIDATION_ERROR;
  if (/[/?#]/.test(value)) return HOST_VALIDATION_ERROR;
  if (/^\[[^\]]+\]:\d+$/.test(value)) return HOST_VALIDATION_ERROR;

  const colonCount = (value.match(/:/g) || []).length;
  if (colonCount === 1 && !value.startsWith('[')) return HOST_VALIDATION_ERROR;

  return null;
}

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
      document.getElementById('host').value = normalizeHost(stored.daemonHost);
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
  const hostError = validateHost(hostRaw);
  const host = normalizeHost(hostRaw);
  const portNum = parseInt(document.getElementById('port').value, 10);
  const hintEl = document.getElementById('saveHint');
  if (hostError) {
    hintEl.textContent = hostError;
    hintEl.style.color = '#ff3b30';
    return;
  }
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
