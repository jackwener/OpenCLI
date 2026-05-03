// Query connection status from background service worker
chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
  const card = document.getElementById('card');
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const daemonVersion = document.getElementById('daemonVersion');
  const profileRow = document.getElementById('profileRow');
  const contextId = document.getElementById('contextId');
  const copyBtn = document.getElementById('copyBtn');
  const hint = document.getElementById('hint');
  const extVersion = document.getElementById('extVersion');

  if (resp && typeof resp.extensionVersion === 'string') {
    extVersion.textContent = `v${resp.extensionVersion}`;
  }

  if (chrome.runtime.lastError || !resp) {
    setState(card, dot, 'disconnected');
    status.textContent = 'No daemon connected';
    daemonVersion.textContent = '';
    profileRow.style.display = 'none';
    hint.style.display = 'block';
    return;
  }

  if (typeof resp.contextId === 'string' && resp.contextId.length > 0) {
    contextId.textContent = resp.contextId;
    profileRow.style.display = 'flex';
    copyBtn.addEventListener('click', () => copyToClipboard(resp.contextId, copyBtn));
  } else {
    profileRow.style.display = 'none';
  }

  if (resp.connected) {
    setState(card, dot, 'connected');
    status.textContent = 'Connected to daemon';
    if (typeof resp.daemonVersion === 'string') {
      daemonVersion.textContent = `daemon v${resp.daemonVersion}`;
    }
    hint.style.display = 'none';
  } else if (resp.reconnecting) {
    setState(card, dot, 'connecting');
    status.textContent = 'Reconnecting...';
    daemonVersion.textContent = '';
    hint.style.display = 'none';
  } else {
    setState(card, dot, 'disconnected');
    status.textContent = 'No daemon connected';
    daemonVersion.textContent = '';
    hint.style.display = 'block';
  }
});

function setState(card, dot, state) {
  card.classList.remove('connected', 'disconnected', 'connecting');
  card.classList.add(state);
  dot.classList.remove('connected', 'disconnected', 'connecting');
  dot.classList.add(state);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(
    () => {
      const original = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1200);
    },
    () => {
      btn.textContent = 'Failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    },
  );
}
