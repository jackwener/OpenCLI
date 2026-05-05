// Query connection status from background service worker
chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
  const card = document.getElementById('card');
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const daemonVersion = document.getElementById('daemonVersion');
  const profileRow = document.getElementById('profileRow');
  const contextId = document.getElementById('contextId');
  const copyBtn = document.getElementById('copyBtn');
  const daemonPortInput = document.getElementById('daemonPort');
  const savePortBtn = document.getElementById('savePortBtn');
  const resetPortBtn = document.getElementById('resetPortBtn');
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

  if (typeof resp.daemonPort === 'number') {
    daemonPortInput.value = String(resp.daemonPort);
  }
  savePortBtn.addEventListener('click', () => saveDaemonPort(daemonPortInput, savePortBtn));
  resetPortBtn.addEventListener('click', () => resetDaemonPort(daemonPortInput, resetPortBtn));

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

function saveDaemonPort(input, btn) {
  const port = Number(input.value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    flashButton(btn, 'Invalid');
    return;
  }
  chrome.runtime.sendMessage({ type: 'setDaemonPort', port }, (resp) => {
    if (resp && resp.ok && typeof resp.daemonPort === 'number') {
      input.value = String(resp.daemonPort);
      flashButton(btn, 'Saved');
    } else {
      flashButton(btn, 'Failed');
    }
  });
}

function resetDaemonPort(input, btn) {
  chrome.runtime.sendMessage({ type: 'resetDaemonPort' }, (resp) => {
    if (resp && resp.ok && typeof resp.daemonPort === 'number') {
      input.value = String(resp.daemonPort);
      flashButton(btn, 'Reset');
    } else {
      flashButton(btn, 'Failed');
    }
  });
}

function flashButton(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 1200);
}
