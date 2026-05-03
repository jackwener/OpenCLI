import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const SUBMIT_WAIT_SECONDS = 3;
const AFTER_SUBMIT_WAIT_MS = 6000;

cli({
  site: 'reddit',
  name: 'post',
  description: 'Create a text post in a subreddit via the Reddit web composer',
  domain: 'reddit.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'subreddit', type: 'string', required: true, positional: true, help: 'Target subreddit name without r/ prefix (e.g. AI_Agents)' },
    { name: 'title', type: 'string', required: true, positional: true, help: 'Post title' },
    { name: 'text', type: 'string', required: true, positional: true, help: 'Post body text' },
    { name: 'flair', type: 'string', required: false, help: 'Visible flair text to select if the subreddit requires flair' },
  ],
  columns: ['status', 'message', 'subreddit', 'title', 'url'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required for reddit post');

    const subreddit = String(kwargs.subreddit || '').trim().replace(/^r\//i, '');
    const title = String(kwargs.title || '').trim();
    const text = String(kwargs.text || '');
    const flair = kwargs.flair ? String(kwargs.flair).trim() : '';
    const textParagraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

    if (!subreddit) throw new CommandExecutionError('subreddit is required');
    if (!title) throw new CommandExecutionError('title is required');
    if (!text.trim()) throw new CommandExecutionError('text is required');

    await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`);
    await page.wait(SUBMIT_WAIT_SECONDS);

    const titlePrepared = await page.evaluate(`(() => {
      const host = document.querySelector('faceplate-textarea-input[name="title"]');
      if (!host || !host.shadowRoot) return { ok: false, message: 'Could not find Reddit title host' };
      const textarea = host.shadowRoot.querySelector('textarea');
      if (!textarea) return { ok: false, message: 'Could not find Reddit title textarea' };
      const rect = textarea.getBoundingClientRect();
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);

    if (!titlePrepared.ok) {
      return [{ status: 'failed', message: titlePrepared.message, subreddit, title, url: '' }];
    }

    if (page.nativeClick && page.insertText) {
      await page.nativeClick(titlePrepared.x, titlePrepared.y);
      await page.insertText(title);
    } else if (page.insertText) {
      await page.evaluate(`(() => {
        const host = document.querySelector('faceplate-textarea-input[name="title"]');
        const textarea = host && host.shadowRoot ? host.shadowRoot.querySelector('textarea') : null;
        if (textarea) textarea.focus();
        return { ok: !!textarea };
      })()`);
      await page.insertText(title);
    } else {
      await page.evaluate(`(() => {
        const host = document.querySelector('faceplate-textarea-input[name="title"]');
        const textarea = host && host.shadowRoot ? host.shadowRoot.querySelector('textarea') : null;
        if (!textarea) return { ok: false };
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(textarea, ${JSON.stringify(title)});
        else textarea.value = ${JSON.stringify(title)};
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()`);
    }

    const titleResult = await page.evaluate(`(() => {
      const host = document.querySelector('faceplate-textarea-input[name="title"]');
      const textarea = host && host.shadowRoot ? host.shadowRoot.querySelector('textarea') : null;
      if (!textarea) return { ok: false, message: 'Could not verify Reddit title textarea' };
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.blur();
      return { ok: !!textarea.value, value: textarea.value };
    })()`);

    if (!titleResult.ok) {
      return [{ status: 'failed', message: titleResult.message || 'Failed to set Reddit title', subreddit, title, url: '' }];
    }

    const bodyPrepared = await page.evaluate(`(() => {
      const selectors = [
        'div[name="body"][role="textbox"]',
        'div[aria-label*="帖子正文"]',
        'div[role="textbox"][aria-label*="post body"]',
        'div[aria-label="帖子正文字段"]'
      ];
      const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;
      let box = null;
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel)).find(isVisible);
        if (found) { box = found; break; }
      }
      if (!box) return { ok: false, message: 'Could not find Reddit body field' };
      const rect = box.getBoundingClientRect();
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(rect.height / 2, 40)) };
    })()`);

    if (!bodyPrepared.ok) {
      return [{ status: 'failed', message: bodyPrepared.message, subreddit, title, url: '' }];
    }

    if (page.nativeClick && page.insertText) {
      await page.nativeClick(bodyPrepared.x, bodyPrepared.y);
      await page.insertText(text);
    } else if (page.insertText) {
      await page.evaluate(`(() => {
        const selectors = [
          'div[name="body"][role="textbox"]',
          'div[aria-label*="帖子正文"]',
          'div[role="textbox"][aria-label*="post body"]',
          'div[aria-label="帖子正文字段"]'
        ];
        const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;
        let box = null;
        for (const sel of selectors) {
          const found = Array.from(document.querySelectorAll(sel)).find(isVisible);
          if (found) { box = found; break; }
        }
        if (box) box.focus();
        return { ok: !!box };
      })()`);
      await page.insertText(text);
    } else {
      await page.evaluate(`(() => {
        const selectors = [
          'div[name="body"][role="textbox"]',
          'div[aria-label*="帖子正文"]',
          'div[role="textbox"][aria-label*="post body"]',
          'div[aria-label="帖子正文字段"]'
        ];
        const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;
        let box = null;
        for (const sel of selectors) {
          const found = Array.from(document.querySelectorAll(sel)).find(isVisible);
          if (found) { box = found; break; }
        }
        if (!box) return { ok: false };
        box.innerHTML = '';
        const paragraphs = ${JSON.stringify(textParagraphs)};
        for (const para of paragraphs) {
          const p = document.createElement('p');
          p.textContent = para;
          box.appendChild(p);
        }
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()`);
    }

    const bodyResult = await page.evaluate(`(async () => {
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const selectors = [
        'div[name="body"][role="textbox"]',
        'div[aria-label*="帖子正文"]',
        'div[role="textbox"][aria-label*="post body"]',
        'div[aria-label="帖子正文字段"]'
      ];
      const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;
      let box = null;
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel)).find(isVisible);
        if (found) { box = found; break; }
      }
      const composer = document.querySelector('#post-composer_bodytext') || document.querySelector('shreddit-composer[name="body"]');
      if (!box && !composer) return { ok: false, message: 'Could not verify Reddit body field' };
      if (box) {
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
        box.blur();
      }
      if (composer) {
        const payload = {
          document: ${JSON.stringify(textParagraphs.length ? textParagraphs : [text])}.map(para => ({
            e: 'par',
            c: [{ e: 'text', t: para }],
          })),
        };
        try { composer.redditRte?.setRTJSON?.(payload); } catch {}
        try { composer.setIsDirty?.(); } catch {}
        try { composer.setCustomValidity?.(''); } catch {}
        try { composer.clearValidationMessage?.(); } catch {}
        try { composer.dispatchInputEvent?.(); } catch {}
        try { composer.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch {}
        try { composer.reportValidity?.(); } catch {}
        try { composer.requestUpdate?.(); } catch {}
        if (composer.updateComplete && typeof composer.updateComplete.then === 'function') {
          try { await composer.updateComplete; } catch {}
        }
        await sleep(100);
        const value = composer.value || composer.getRichTextValue?.() || '';
        const textValue = box ? ((box.innerText || box.textContent || '').trim()) : '';
        const validationMessage = composer.validationMessage || '';
        const ariaInvalid = composer.getAttribute('aria-invalid') || '';
        const faceplateValidity = composer.getAttribute('faceplate-validity') || '';
        const valid = typeof composer.checkValidity === 'function' ? composer.checkValidity() : !validationMessage;
        return {
          ok: !!(value || textValue) && valid,
          message: valid ? 'Body set' : 'Reddit body composer still invalid',
          value: value || textValue,
          validationMessage,
          ariaInvalid,
          faceplateValidity,
          valid,
        };
      }
      const value = box.innerText || box.textContent || '';
      return { ok: !!value.trim(), value };
    })()`);

    if (!bodyResult.ok) {
      return [{ status: 'failed', message: bodyResult.message || 'Failed to set Reddit body', subreddit, title, url: '' }];
    }

    let flairCommitFailureMessage = '';

    if (flair) {
      const flairButtonPrepared = await page.evaluate(`(() => {
        const textOf = (el) => ((el.innerText || el.textContent || '').trim());
        const flairHost = document.querySelector('r-post-flairs-modal');
        const flairButton = flairHost && flairHost.shadowRoot
          ? flairHost.shadowRoot.querySelector('#reddit-post-flair-button') || flairHost.shadowRoot.querySelector('button')
          : null;
        if (!flairButton) return { ok: false, message: 'Could not find flair chooser button' };
        const rect = flairButton.getBoundingClientRect();
        return {
          ok: true,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          label: textOf(flairButton),
        };
      })()`);

      if (!flairButtonPrepared.ok) {
        return [{ status: 'failed', message: flairButtonPrepared.message, subreddit, title, url: '' }];
      }

      if (page.nativeClick) {
        await page.nativeClick(flairButtonPrepared.x, flairButtonPrepared.y);
      } else {
        await page.evaluate(`(() => {
          const flairHost = document.querySelector('r-post-flairs-modal');
          const flairButton = flairHost && flairHost.shadowRoot
            ? flairHost.shadowRoot.querySelector('#reddit-post-flair-button') || flairHost.shadowRoot.querySelector('button')
            : null;
          if (flairButton) flairButton.click();
          return { ok: !!flairButton };
        })()`);
      }
      await page.wait(1);

      const flairOptionPrepared = await page.evaluate(`(() => {
        const textOf = (el) => ((el.innerText || el.textContent || '').trim());
        const options = Array.from(document.querySelectorAll('faceplate-radio-input[role="radio"]'));
        const target = options.find(el => textOf(el).includes(${JSON.stringify(flair)}));
        if (!target) {
          return {
            ok: false,
            message: 'Could not find flair: ' + ${JSON.stringify(flair)},
            available: options.map(el => textOf(el)).filter(Boolean),
          };
        }
        const clickTarget = (target.shadowRoot && (target.shadowRoot.querySelector('label') || target.shadowRoot.querySelector('input'))) || target;
        const rect = clickTarget.getBoundingClientRect();
        return {
          ok: true,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          text: textOf(target),
        };
      })()`);

      if (!flairOptionPrepared.ok) {
        return [{ status: 'failed', message: flairOptionPrepared.message, subreddit, title, url: '' }];
      }

      if (page.nativeClick) {
        await page.nativeClick(flairOptionPrepared.x, flairOptionPrepared.y);
        await page.wait(1);
      }

      await page.evaluate(`(() => {
        const textOf = (el) => ((el.innerText || el.textContent || '').trim());
        const options = Array.from(document.querySelectorAll('faceplate-radio-input[role="radio"]'));
        const target = options.find(el => textOf(el).includes(${JSON.stringify(flair)}));
        if (!target) {
          return { ok: false, message: 'Could not find flair option during selection' };
        }
        const input = target.shadowRoot ? target.shadowRoot.querySelector('input') : null;
        const label = target.shadowRoot ? target.shadowRoot.querySelector('label') : null;
        if (label) {
          for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
            label.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
          }
        }
        if (input) {
          input.click();
          try { input.checked = true; } catch {}
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }
        target.click();
        const hiddenFlairText = document.querySelector('input[name="flairText"]')?.value || '';
        const hiddenFlairIds = Array.from(document.querySelectorAll('input[name="flairId"]')).map(el => el.value || '');
        return {
          ok: true,
          selected: target.getAttribute('aria-checked') === 'true' || target.hasAttribute('checked'),
          text: textOf(target),
          hiddenFlairText,
          hiddenFlairIds,
        };
      })()`);
      await page.wait(1);

      const flairApplyPrepared = await page.evaluate(`(() => {
        const textOf = (el) => ((el.innerText || el.textContent || '').trim());
        const flairHost = document.querySelector('r-post-flairs-modal');
        const flairRoot = flairHost && flairHost.shadowRoot ? flairHost.shadowRoot : null;
        if (!flairRoot) return { ok: false, message: 'Could not access flair modal shadow root' };
        const collectButtons = (root, acc = []) => {
          if (!root || !root.querySelectorAll) return acc;
          acc.push(...Array.from(root.querySelectorAll('button')));
          for (const el of Array.from(root.querySelectorAll('*'))) {
            if (el.shadowRoot) collectButtons(el.shadowRoot, acc);
          }
          return acc;
        };
        const applyBtn = collectButtons(flairRoot)
          .find(btn => btn.id === 'post-flair-modal-apply-button' || (btn.id !== 'reddit-post-flair-button' && (btn.getAttribute('type') === 'submit' || ['应用', 'Apply', '添加'].includes(textOf(btn)))));
        if (!applyBtn) {
          return {
            ok: false,
            message: 'Could not find flair apply button',
            available: collectButtons(flairRoot).map(btn => ({
              id: btn.id || '',
              type: btn.getAttribute('type') || '',
              text: textOf(btn),
              ariaLabel: btn.getAttribute('aria-label') || '',
            })),
          };
        }
        const rect = applyBtn.getBoundingClientRect();
        return {
          ok: true,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          label: textOf(applyBtn),
          id: applyBtn.id || '',
        };
      })()`);

      if (flairApplyPrepared.ok && page.nativeClick) {
        await page.nativeClick(flairApplyPrepared.x, flairApplyPrepared.y);
        await page.wait(1);
      }

      const flairCommitResult = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const textOf = (el) => ((el && (el.innerText || el.textContent) || '').trim());
        const collectButtons = (root, acc = []) => {
          if (!root || !root.querySelectorAll) return acc;
          acc.push(...Array.from(root.querySelectorAll('button')));
          for (const el of Array.from(root.querySelectorAll('*'))) {
            if (el.shadowRoot) collectButtons(el.shadowRoot, acc);
          }
          return acc;
        };
        const collectInputs = (root, acc = []) => {
          if (!root || !root.querySelectorAll) return acc;
          acc.push(...Array.from(root.querySelectorAll('input')));
          for (const el of Array.from(root.querySelectorAll('*'))) {
            if (el.shadowRoot) collectInputs(el.shadowRoot, acc);
          }
          return acc;
        };
        const flairHost = document.querySelector('r-post-flairs-modal');
        const flairRoot = flairHost && flairHost.shadowRoot ? flairHost.shadowRoot : null;
        if (!flairHost || !flairRoot) return { ok: false, message: 'Could not access flair host' };

        const flairButton = flairRoot.querySelector('#reddit-post-flair-button') || flairRoot.querySelector('button');
        const applyBtn = collectButtons(flairRoot)
          .find(btn => btn.id === 'post-flair-modal-apply-button' || (btn.id !== 'reddit-post-flair-button' && (btn.getAttribute('type') === 'submit' || ['应用', 'Apply', '添加'].includes(textOf(btn)))));
        const formRef = flairHost.postFlairsFormRef && flairHost.postFlairsFormRef.value ? flairHost.postFlairsFormRef.value : null;
        const modalRef = flairHost.postFlairsModalRef && flairHost.postFlairsModalRef.value ? flairHost.postFlairsModalRef.value : null;
        const request = formRef && typeof formRef.buildRequest === 'function' ? formRef.buildRequest() : null;
        const stagedBody = request ? request.body : null;
        const stagedEntries = stagedBody && typeof stagedBody.entries === 'function' ? Array.from(stagedBody.entries()) : [];
        const staged = Object.fromEntries(stagedEntries);
        const postForm = document.querySelector('r-post-composer-form');

        const snapshot = () => {
          const selectedFlairs = Array.from(document.querySelectorAll('faceplate-radio-input[role="radio"]'))
            .filter(el => el.getAttribute('aria-checked') === 'true' || el.hasAttribute('checked'))
            .map(el => ({
              text: textOf(el),
              value: el.getAttribute('value') || '',
            }))
            .filter(item => item.text || item.value);
          const hiddenFlairInputs = collectInputs(flairRoot).filter(el => ['flairText', 'flairId'].includes(el.getAttribute('name') || ''));
          const hiddenFlairTextInput = hiddenFlairInputs.find(el => (el.getAttribute('name') || '') === 'flairText');
          const hiddenFlairIdInputs = hiddenFlairInputs.filter(el => (el.getAttribute('name') || '') === 'flairId').map(el => el.value || '');
          const submitHost = document.querySelector('#submit-post-button');
          const submitBtn = submitHost && submitHost.shadowRoot ? submitHost.shadowRoot.querySelector('button') : null;
          const flairButtonText = textOf(flairButton);
          const modalStillOpen = !!(modalRef && ((typeof modalRef.open === 'boolean' && modalRef.open) || modalRef.hasAttribute?.('open') || (getComputedStyle(modalRef).display !== 'none' && modalRef.getBoundingClientRect().height > 0)));
          const currentValueEntries = flairHost && flairHost.value ? Array.from(flairHost.value.entries()) : [];
          const currentValue = Object.fromEntries(currentValueEntries);
          const realFlairField = postForm && postForm._elements ? postForm._elements.flair : null;
          const realValueEntries = realFlairField && realFlairField.value ? Array.from(realFlairField.value.entries()) : [];
          const realValue = Object.fromEntries(realValueEntries);
          const realValidationMessage = realFlairField ? (realFlairField.validationMessage || '') : '';
          const selectedTemplate = flairHost && typeof flairHost.getSelectedFlair === 'function' ? flairHost.getSelectedFlair() : null;
          const submitDisabledAfterFlair = !!(submitBtn && submitBtn.disabled);
          const committed = !!realValue.flairId && realValue.flairId !== 'on' && !!realValue.flairText && !realValidationMessage;
          return {
            committed,
            flairButtonText,
            modalStillOpen,
            selectedFlairs,
            hiddenFlairText: hiddenFlairTextInput ? hiddenFlairTextInput.value || '' : '',
            hiddenFlairIds: hiddenFlairIdInputs,
            selectedTemplateText: textOf(selectedTemplate),
            valueEntries: currentValueEntries,
            currentValue,
            realValueEntries,
            realValue,
            realValidationMessage,
            submitDisabledAfterFlair,
          };
        };

        const path = [];
        try {
          if (postForm) {
            flairHost._form = postForm;
            path.push('attach-post-form-early');
          }
        } catch (e) { path.push('attach-post-form-early!' + String((e && e.message) || e)); }
        let state = snapshot();
        const selectedChoice = state.selectedFlairs[0] || null;
        let effectivePayload = stagedBody;
        let effectiveStaged = staged;

        if (selectedChoice && selectedChoice.value && selectedChoice.value !== 'on' && (!staged.flairId || staged.flairId === 'on' || !staged.flairText)) {
          const manualPayload = new FormData();
          manualPayload.set('flairId', selectedChoice.value);
          manualPayload.set('flairText', selectedChoice.text || '');
          effectivePayload = manualPayload;
          effectiveStaged = {
            flairId: selectedChoice.value,
            flairText: selectedChoice.text || '',
          };
          path.push('manual-payload-from-selected-flair');
          try {
            const existingTemplate = flairHost.flairTemplates?.get?.(selectedChoice.value);
            if (!existingTemplate && flairHost.flairTemplates && typeof flairHost.flairTemplates.set === 'function') {
              const baseTemplate = flairHost.flairTemplates.values?.().next?.().value || {};
              flairHost.flairTemplates.set(selectedChoice.value, {
                ...baseTemplate,
                id: selectedChoice.value,
                text: selectedChoice.text || '',
                isEditable: false,
              });
              path.push('hydrate-flair-template');
            }
          } catch (e) { path.push('hydrate-flair-template!' + String((e && e.message) || e)); }
          try {
            if (Array.isArray(flairHost.__flairIds) && !flairHost.__flairIds.includes(selectedChoice.value)) {
              flairHost.__flairIds = [...flairHost.__flairIds, selectedChoice.value];
              path.push('__flairIds');
            }
          } catch (e) { path.push('__flairIds!' + String((e && e.message) || e)); }
          try {
            if (Array.isArray(flairHost.__visibleFlairIds) && !flairHost.__visibleFlairIds.includes(selectedChoice.value)) {
              flairHost.__visibleFlairIds = [...flairHost.__visibleFlairIds, selectedChoice.value];
              path.push('__visibleFlairIds');
            }
          } catch (e) { path.push('__visibleFlairIds!' + String((e && e.message) || e)); }
          try {
            if ('__flairId' in flairHost) {
              flairHost.__flairId = selectedChoice.value;
              path.push('__flairId');
            }
          } catch (e) { path.push('__flairId!' + String((e && e.message) || e)); }
          try {
            if ('__selectedFlairId' in flairHost) {
              flairHost.__selectedFlairId = selectedChoice.value;
              path.push('__selectedFlairId');
            }
          } catch (e) { path.push('__selectedFlairId!' + String((e && e.message) || e)); }
          try {
            if ('selectedFlairId' in flairHost) {
              flairHost.selectedFlairId = selectedChoice.value;
              path.push('selectedFlairId');
            }
          } catch (e) { path.push('selectedFlairId!' + String((e && e.message) || e)); }
          try {
            if (typeof flairHost.setFlair === 'function') {
              flairHost.setFlair(selectedChoice.value);
              path.push('setFlair');
            }
          } catch (e) { path.push('setFlair!' + String((e && e.message) || e)); }
          await sleep(200);
          state = snapshot();
        }

        if (applyBtn && !(applyBtn.disabled || applyBtn.getAttribute('aria-disabled') === 'true')) {
          try { applyBtn.click(); path.push('applyBtn.click'); } catch (e) { path.push('applyBtn.click!' + String((e && e.message) || e)); }
          await sleep(200);
          state = snapshot();
        }

        if (!state.committed && effectivePayload && modalRef) {
          try { modalRef.returnValue = effectivePayload; path.push('modal.returnValue'); } catch (e) { path.push('modal.returnValue!' + String((e && e.message) || e)); }
          try {
            if (typeof modalRef.close === 'function') {
              modalRef.close();
              path.push('modal.close');
            }
          } catch (e) { path.push('modal.close!' + String((e && e.message) || e)); }
          await sleep(250);
          state = snapshot();
        }

        if (!state.committed && effectivePayload && flairHost && typeof flairHost.persistValues === 'function') {
          try { flairHost.persistValues(effectivePayload); path.push('persistValues'); } catch (e) { path.push('persistValues!' + String((e && e.message) || e)); }
          try {
            if (postForm) {
              flairHost._form = postForm;
              path.push('attach-post-form');
            }
          } catch (e) { path.push('attach-post-form!' + String((e && e.message) || e)); }
          try {
            flairHost.setCustomValidity?.('');
            path.push('setCustomValidity-empty');
          } catch (e) { path.push('setCustomValidity-empty!' + String((e && e.message) || e)); }
          try { flairHost.syncInputValidity?.(false); path.push('syncInputValidity'); } catch (e) { path.push('syncInputValidity!' + String((e && e.message) || e)); }
          try { flairHost.dispatchEvent(new Event('change', { bubbles: true, composed: true })); path.push('dispatch-change'); } catch (e) { path.push('dispatch-change!' + String((e && e.message) || e)); }
          try { flairHost.requestUpdate?.(); path.push('requestUpdate'); } catch (e) { path.push('requestUpdate!' + String((e && e.message) || e)); }
          if (flairHost.updateComplete && typeof flairHost.updateComplete.then === 'function') {
            try { await flairHost.updateComplete; path.push('updateComplete'); } catch (e) { path.push('updateComplete!' + String((e && e.message) || e)); }
          }
          await sleep(250);
          state = snapshot();
        }

        return {
          ok: state.committed,
          message: state.committed ? 'Flair applied' : 'Flair did not commit',
          diagnostics: {
            path,
            staged: effectiveStaged,
            hasApplyBtn: !!applyBtn,
            hasBuildRequest: !!request,
            hasModalRef: !!modalRef,
            hasPersistValues: typeof flairHost.persistValues === 'function',
            hasGetSelectedFlair: typeof flairHost.getSelectedFlair === 'function',
            hasSetFlair: typeof flairHost.setFlair === 'function',
            ...state,
          },
        };
      })()`);

      if (!flairCommitResult.ok) {
        flairCommitFailureMessage = flairCommitResult.diagnostics
          ? `${flairCommitResult.message} | diagnostics=${JSON.stringify(flairCommitResult.diagnostics)}`
          : flairCommitResult.message;
      }
    }

    const submitResult = await page.evaluate(`(async () => {
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const textOf = (el) => ((el.innerText || el.textContent || '').trim());
      const host = document.querySelector('#submit-post-button');
      if (!host || !host.shadowRoot) return { ok: false, message: 'Could not find submit host', url: location.href };
      const btn = host.shadowRoot.querySelector('button');
      if (!btn) return { ok: false, message: 'Could not find submit button', url: location.href };
      const bodyComposer = document.querySelector('#post-composer_bodytext') || document.querySelector('shreddit-composer[name="body"]');
      if (bodyComposer) {
        try { bodyComposer.setIsDirty?.(); } catch {}
        try { bodyComposer.setCustomValidity?.(''); } catch {}
        try { bodyComposer.clearValidationMessage?.(); } catch {}
        try { bodyComposer.dispatchInputEvent?.(); } catch {}
        try { bodyComposer.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch {}
        try { bodyComposer.reportValidity?.(); } catch {}
        try { bodyComposer.requestUpdate?.(); } catch {}
        if (bodyComposer.updateComplete && typeof bodyComposer.updateComplete.then === 'function') {
          try { await bodyComposer.updateComplete; } catch {}
        }
        await sleep(100);
      }
      if (btn.disabled) {
        const titleHost = document.querySelector('faceplate-textarea-input[name="title"]');
        const titleBox = titleHost && titleHost.shadowRoot ? titleHost.shadowRoot.querySelector('textarea') : null;
        const bodySelectors = [
          'div[name="body"][role="textbox"]',
          'div[aria-label*="帖子正文"]',
          'div[role="textbox"][aria-label*="post body"]',
          'div[aria-label="帖子正文字段"]'
        ];
        const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;
        let bodyBox = null;
        for (const sel of bodySelectors) {
          const found = Array.from(document.querySelectorAll(sel)).find(isVisible);
          if (found) { bodyBox = found; break; }
        }
        const flairHost = document.querySelector('r-post-flairs-modal');
        const flairButton = flairHost && flairHost.shadowRoot
          ? flairHost.shadowRoot.querySelector('#reddit-post-flair-button') || flairHost.shadowRoot.querySelector('button')
          : null;
        const selectedFlairs = Array.from(document.querySelectorAll('faceplate-radio-input[role="radio"]'))
          .filter(el => el.getAttribute('aria-checked') === 'true' || el.hasAttribute('checked'))
          .map(el => ({
            text: textOf(el),
            value: el.getAttribute('value') || '',
          }))
          .filter(item => item.text || item.value);
        const invalidControls = Array.from(document.querySelectorAll('[aria-invalid="true"], [faceplate-validity="invalid"]'))
          .map(el => ({
            tag: el.tagName,
            id: el.id || '',
            name: el.getAttribute('name') || '',
            text: textOf(el).slice(0, 120),
          }));
        const diagnostics = {
          titleLength: (titleBox?.value || '').trim().length,
          bodyLength: (bodyBox?.innerText || bodyBox?.textContent || '').trim().length,
          flairRequired: !!(flairHost && flairHost.hasAttribute('flairs-required')),
          flairButtonText: textOf(flairButton),
          flairModalOpen: Array.from(document.querySelectorAll('button')).some(b => b.getAttribute('type') === 'submit' && ['应用', 'Apply'].includes(textOf(b))),
          selectedFlairs,
          invalidControls,
        };
        return { ok: false, message: 'Submit button is disabled | diagnostics=' + JSON.stringify(diagnostics), url: location.href };
      }
      if (typeof host.submitPostForm === 'function') {
        const maybe = host.submitPostForm();
        if (maybe && typeof maybe.then === 'function') await maybe;
      } else {
        btn.click();
      }
      await sleep(${AFTER_SUBMIT_WAIT_MS});
      const href = location.href;
      if (href.includes('/comments/') && !href.includes('/submit')) {
        return { ok: true, message: 'Reddit post created successfully', url: href };
      }
      return { ok: false, message: 'Submit action ran but post URL did not appear', url: href };
    })()`);

    return [{
      status: submitResult.ok ? 'success' : 'failed',
      message: !submitResult.ok && flairCommitFailureMessage
        ? `${submitResult.message} | flair=${flairCommitFailureMessage}`
        : submitResult.message,
      subreddit,
      title,
      url: submitResult.url || '',
    }];
  },
});
