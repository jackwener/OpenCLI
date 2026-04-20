const DEFAULT_PORT = 19825;

// Load saved port into input
chrome.storage.local.get('daemonPort', (result) => {
  document.getElementById('portInput').value = result.daemonPort || DEFAULT_PORT;
});

// Save port
document.getElementById('portSave').addEventListener('click', () => {
  const input = document.getElementById('portInput');
  const msg = document.getElementById('portMsg');
  const val = parseInt(input.value, 10);
  if (!Number.isInteger(val) || val < 1024 || val > 65535) {
    msg.textContent = 'Port must be 1024-65535';
    msg.className = 'port-msg err';
    return;
  }
  chrome.storage.local.set({ daemonPort: val }, () => {
    msg.textContent = 'Saved';
    msg.className = 'port-msg ok';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });
});

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
  const portLabel = resp.port ? ` <span style="color:#999">(port ${resp.port})</span>` : '';
  if (resp.connected) {
    dot.className = 'dot connected';
    status.innerHTML = `<strong>Connected to daemon</strong>${portLabel}`;
    hint.style.display = 'none';
  } else if (resp.reconnecting) {
    dot.className = 'dot connecting';
    status.innerHTML = `<strong>Reconnecting...</strong>${portLabel}`;
    hint.style.display = 'none';
  } else {
    dot.className = 'dot disconnected';
    status.innerHTML = `<strong>No daemon connected</strong>${portLabel}`;
    hint.style.display = 'block';
  }
});
