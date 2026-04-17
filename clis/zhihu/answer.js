import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute, resolveCurrentUserIdentity, resolvePayload } from './write-shared.js';
const ANSWER_AUTHOR_SCOPE_SELECTOR = '.AuthorInfo, .AnswerItem-authorInfo, .ContentItem-meta, [itemprop="author"]';
cli({
    site: 'zhihu',
    name: 'answer',
    description: 'Answer a Zhihu question',
    domain: 'www.zhihu.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu question URL or typed target' },
        { name: 'text', positional: true, help: 'Answer text' },
        { name: 'file', help: 'Answer text file path' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target', 'created_target', 'created_url', 'author_identity'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu answer');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('answer', parseTarget(rawTarget));
        const questionTarget = target;
        const payload = await resolvePayload(kwargs);
        await page.goto(target.url);
        const authorIdentity = await resolveCurrentUserIdentity(page);
        const entryPath = await page.evaluate(`(() => {
      const currentUserSlug = ${JSON.stringify(authorIdentity)};
      const answerAuthorScopeSelector = ${JSON.stringify(ANSWER_AUTHOR_SCOPE_SELECTOR)};
      const readAnswerAuthorSlug = (node) => {
        const authorScopes = Array.from(node.querySelectorAll(answerAuthorScopeSelector));
        const slugs = Array.from(new Set(authorScopes
          .flatMap((scope) => Array.from(scope.querySelectorAll('a[href^="/people/"]')))
          .map((link) => (link.getAttribute('href') || '').match(/^\\/people\\/([A-Za-z0-9_-]+)/)?.[1] || null)
          .filter(Boolean)));
        return slugs.length === 1 ? slugs[0] : null;
      };
      const restoredDraft = !!document.querySelector('[contenteditable="true"][data-draft-restored], textarea[data-draft-restored]');
      const composerCandidates = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).map((editor) => {
        const container = editor.closest('form, .AnswerForm, .DraftEditor-root, [data-za-module*="Answer"]') || editor.parentElement;
        const text = 'value' in editor ? editor.value || '' : (editor.textContent || '');
        const submitButton = Array.from((container || document).querySelectorAll('button')).find((node) => /发布|提交/.test(node.textContent || ''));
        const nestedComment = Boolean(container?.closest('[data-comment-id], .CommentItem'));
        return { editor, container, text, submitButton, nestedComment };
      }).filter((candidate) => candidate.container && candidate.submitButton && !candidate.nestedComment);
      const hasExistingAnswerByCurrentUser = Array.from(document.querySelectorAll('[data-zop-question-answer], article')).some((node) => {
        return readAnswerAuthorSlug(node) === currentUserSlug;
      });
      return {
        entryPathSafe: composerCandidates.length === 1
          && !String(composerCandidates[0].text || '').trim()
          && !restoredDraft
          && !hasExistingAnswerByCurrentUser,
        hasExistingAnswerByCurrentUser,
      };
    })()`);
        if (entryPath.hasExistingAnswerByCurrentUser) {
            throw new CliError('ACTION_NOT_AVAILABLE', 'zhihu answer only supports creating a new answer when the current user has not already answered this question');
        }
        if (!entryPath.entryPathSafe) {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Answer editor entry path was not proven side-effect free');
        }
        const editorState = await page.evaluate(`(async () => {
      const composerCandidates = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).map((editor) => {
        const container = editor.closest('form, .AnswerForm, .DraftEditor-root, [data-za-module*="Answer"]') || editor.parentElement;
        const text = 'value' in editor ? editor.value || '' : (editor.textContent || '');
        const submitButton = Array.from((container || document).querySelectorAll('button')).find((node) => /发布|提交/.test(node.textContent || ''));
        const nestedComment = Boolean(container?.closest('[data-comment-id], .CommentItem'));
        return { editor, container, text, submitButton, nestedComment };
      }).filter((candidate) => candidate.container && candidate.submitButton && !candidate.nestedComment);
      if (composerCandidates.length !== 1) return { editorState: 'unsafe', anonymousMode: 'unknown' };
      const { editor, text } = composerCandidates[0];
      const anonymousLabeledControl =
        (composerCandidates[0].container && composerCandidates[0].container.querySelector('[aria-label*="匿名"], [title*="匿名"]'))
        || Array.from((composerCandidates[0].container || document).querySelectorAll('label, button, [role="switch"], [role="checkbox"]')).find((node) => /匿名/.test(node.textContent || ''))
        || null;
      const anonymousToggle =
        anonymousLabeledControl?.matches?.('input[type="checkbox"], [role="switch"], [role="checkbox"], button')
          ? anonymousLabeledControl
          : anonymousLabeledControl?.querySelector?.('input[type="checkbox"], [role="switch"], [role="checkbox"], button')
            || null;
      let anonymousMode = 'unknown';
      if (anonymousToggle) {
        const ariaChecked = anonymousToggle.getAttribute && anonymousToggle.getAttribute('aria-checked');
        const checked = 'checked' in anonymousToggle ? anonymousToggle.checked === true : false;
        if (ariaChecked === 'true' || checked) anonymousMode = 'on';
        else if (ariaChecked === 'false' || ('checked' in anonymousToggle && anonymousToggle.checked === false)) anonymousMode = 'off';
      }
      return {
        editorState: editor && !text.trim() ? 'fresh_empty' : 'unsafe',
        anonymousMode,
      };
    })()`);
        if (editorState.editorState !== 'fresh_empty') {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Answer editor was not fresh and empty');
        }
        if (editorState.anonymousMode !== 'off') {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Anonymous answer mode could not be proven off for zhihu answer');
        }
        const editorCheck = await page.evaluate(`(async () => {
      const textToInsert = ${JSON.stringify(payload)};
      const composerCandidates = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).map((editor) => {
        const container = editor.closest('form, .AnswerForm, .DraftEditor-root, [data-za-module*="Answer"]') || editor.parentElement;
        const submitButton = Array.from((container || document).querySelectorAll('button')).find((node) => /发布|提交/.test(node.textContent || ''));
        const nestedComment = Boolean(container?.closest('[data-comment-id], .CommentItem'));
        return { editor, container, submitButton, nestedComment };
      }).filter((candidate) => candidate.container && candidate.submitButton && !candidate.nestedComment);
      if (composerCandidates.length !== 1) return { editorContent: '', bodyMatches: false };
      const { editor } = composerCandidates[0];
      editor.focus();
      if ('value' in editor) {
        editor.value = '';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.value = textToInsert;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        editor.textContent = '';
        document.execCommand('insertText', false, textToInsert);
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: textToInsert, inputType: 'insertText' }));
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const content = 'value' in editor ? editor.value : (editor.textContent || '');
      return { editorContent: content, bodyMatches: content === textToInsert };
    })()`);
        if (editorCheck.editorContent !== payload || !editorCheck.bodyMatches) {
            throw new CliError('OUTCOME_UNKNOWN', 'Answer editor content did not exactly match the requested payload before publish');
        }
        const proof = await page.evaluate(`(async () => {
      const normalize = (value) => value.replace(/\\s+/g, ' ').trim();
      const answerAuthorScopeSelector = ${JSON.stringify(ANSWER_AUTHOR_SCOPE_SELECTOR)};
      const readAnswerAuthorSlug = (node) => {
        const authorScopes = Array.from(node.querySelectorAll(answerAuthorScopeSelector));
        const slugs = Array.from(new Set(authorScopes
          .flatMap((scope) => Array.from(scope.querySelectorAll('a[href^="/people/"]')))
          .map((link) => (link.getAttribute('href') || '').match(/^\\/people\\/([A-Za-z0-9_-]+)/)?.[1] || null)
          .filter(Boolean)));
        return slugs.length === 1 ? slugs[0] : null;
      };
      const composerCandidates = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).map((editor) => {
        const container = editor.closest('form, [role="dialog"], .AnswerForm, .DraftEditor-root, [data-za-module*="Answer"]') || editor.parentElement;
        const submitButton = Array.from((container || document).querySelectorAll('button')).find((node) => /发布|提交/.test(node.textContent || ''));
        const nestedComment = Boolean(container?.closest('[data-comment-id], .CommentItem'));
        return { editor, container, submitButton, nestedComment };
      }).filter((candidate) => candidate.container && candidate.submitButton && !candidate.nestedComment);
      if (composerCandidates.length !== 1) return { createdTarget: null, createdUrl: null, authorIdentity: null, bodyMatches: false };
      const submitScope = composerCandidates[0].container || document;
      const submit = Array.from(submitScope.querySelectorAll('button')).find((node) => /发布|提交/.test(node.textContent || ''));
      submit && submit.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const href = location.href;
      const match = href.match(/question\\/(\\d+)\\/answer\\/(\\d+)/);
      const targetHref = match ? '/question/' + match[1] + '/answer/' + match[2] : null;
      const answerContainer = targetHref
        ? Array.from(document.querySelectorAll('[data-zop-question-answer], article')).find((node) => {
            const dataAnswerId = node.getAttribute('data-answerid') || node.getAttribute('data-zop-question-answer') || '';
            if (dataAnswerId && dataAnswerId.includes(match[2])) return true;
            return Array.from(node.querySelectorAll('a[href*="/answer/"]')).some((link) => {
              const hrefValue = link.getAttribute('href') || '';
              return hrefValue.includes(targetHref);
            });
          })
        : null;
      const authorSlug = answerContainer ? readAnswerAuthorSlug(answerContainer) : null;
      const bodyNode =
        answerContainer?.querySelector('[itemprop="text"]')
        || answerContainer?.querySelector('.RichContent-inner')
        || answerContainer?.querySelector('.RichText')
        || answerContainer;
      const bodyText = normalize(bodyNode?.textContent || '');
      return match
        ? {
            createdTarget: 'answer:' + match[1] + ':' + match[2],
            createdUrl: href,
            authorIdentity: authorSlug,
            bodyMatches: bodyText === normalize(${JSON.stringify(payload)}),
          }
        : { createdTarget: null, createdUrl: null, authorIdentity: authorSlug, bodyMatches: false };
    })()`);
        if (proof.authorIdentity !== authorIdentity) {
            throw new CliError('OUTCOME_UNKNOWN', 'Answer was created but authorship could not be proven for the frozen current user');
        }
        if (!proof.createdTarget || !proof.bodyMatches || proof.createdTarget.split(':')[1] !== questionTarget.id) {
            throw new CliError('OUTCOME_UNKNOWN', 'Created answer proof did not match the requested question or payload');
        }
        return buildResultRow(`Answered question ${questionTarget.id}`, target.kind, rawTarget, 'created', {
            created_target: proof.createdTarget,
            created_url: proof.createdUrl,
            author_identity: authorIdentity,
        });
    },
});
