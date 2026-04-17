import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute, resolveCurrentUserIdentity, resolvePayload } from './write-shared.js';
const COMMENT_AUTHOR_SCOPE_SELECTOR = '.CommentItemV2-head, .CommentItem-head, .CommentItemV2-meta, .CommentItem-meta, .CommentItemV2-metaSibling, [data-comment-author], [itemprop="author"]';
cli({
    site: 'zhihu',
    name: 'comment',
    description: 'Create a top-level comment on a Zhihu answer or article',
    domain: 'zhihu.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu target URL or typed target' },
        { name: 'text', positional: true, help: 'Comment text' },
        { name: 'file', help: 'Comment text file path' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target', 'author_identity', 'created_url', 'created_proof'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu comment');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('comment', parseTarget(rawTarget));
        const payload = await resolvePayload(kwargs);
        await page.goto(target.url);
        const authorIdentity = await resolveCurrentUserIdentity(page);
        const entryPath = await page.evaluate(`(() => {
      const targetKind = ${JSON.stringify(target.kind)};
      const targetQuestionId = ${JSON.stringify(target.kind === 'answer' ? target.questionId : null)};
      const targetAnswerId = ${JSON.stringify(target.kind === 'answer' ? target.id : null)};
      const restoredDraft = !!document.querySelector('[contenteditable="true"][data-draft-restored], textarea[data-draft-restored]');
      let scope = document;
      if (targetKind === 'answer') {
        const block = Array.from(document.querySelectorAll('article, .AnswerItem, [data-zop-question-answer]')).find((node) => {
          const dataAnswerId = node.getAttribute('data-answerid') || node.getAttribute('data-zop-question-answer') || '';
          if (dataAnswerId && dataAnswerId.includes(targetAnswerId)) return true;
          return Array.from(node.querySelectorAll('a[href*="/answer/"]')).some((link) => {
            const href = link.getAttribute('href') || '';
            return href.includes('/question/' + targetQuestionId + '/answer/' + targetAnswerId);
          });
        });
        if (!block) return { entryPathSafe: false, wrongAnswer: true };
        scope = block;
      } else {
        scope =
          document.querySelector('article')
          || document.querySelector('.Post-Main')
          || document.querySelector('[itemprop="articleBody"]')
          || document;
      }
      const topLevelCandidates = Array.from(scope.querySelectorAll('[contenteditable="true"], textarea')).map((editor) => {
        const container = editor.closest('form, .CommentEditor, .CommentForm, .CommentsV2-footer, [data-comment-editor]') || editor.parentElement;
        const replyHint = editor.getAttribute('data-reply-to') || '';
        const text = 'value' in editor ? editor.value || '' : (editor.textContent || '');
        const nestedReply = Boolean(container?.closest('[data-comment-id], .CommentItem'));
        return { editor, container, replyHint, text, nestedReply };
      }).filter((candidate) => candidate.container && !candidate.nestedReply);
      return {
        entryPathSafe: topLevelCandidates.length === 1
          && !restoredDraft
          && !topLevelCandidates[0].replyHint
          && !String(topLevelCandidates[0].text || '').trim(),
        wrongAnswer: false,
      };
    })()`);
        if (entryPath.wrongAnswer) {
            throw new CliError('TARGET_NOT_FOUND', 'Resolved answer target no longer matches the requested answer:<questionId>:<answerId>');
        }
        if (!entryPath.entryPathSafe) {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Comment entry path was not proven side-effect free');
        }
        const beforeSubmitSnapshot = await page.evaluate(`(() => {
      const normalize = (value) => value.replace(/\\s+/g, ' ').trim();
      const targetKind = ${JSON.stringify(target.kind)};
      const targetQuestionId = ${JSON.stringify(target.kind === 'answer' ? target.questionId : null)};
      const targetAnswerId = ${JSON.stringify(target.kind === 'answer' ? target.id : null)};
      let scope = document;
      if (targetKind === 'answer') {
        const block = Array.from(document.querySelectorAll('article, .AnswerItem, [data-zop-question-answer]')).find((node) => {
          const dataAnswerId = node.getAttribute('data-answerid') || node.getAttribute('data-zop-question-answer') || '';
          if (dataAnswerId && dataAnswerId.includes(targetAnswerId)) return true;
          return Array.from(node.querySelectorAll('a[href*="/answer/"]')).some((link) => {
            const href = link.getAttribute('href') || '';
            return href.includes('/question/' + targetQuestionId + '/answer/' + targetAnswerId);
          });
        });
        if (!block) return { wrongAnswer: true, rows: [], commentLinks: [] };
        scope = block;
      } else {
        scope =
          document.querySelector('article')
          || document.querySelector('.Post-Main')
          || document.querySelector('[itemprop="articleBody"]')
          || document;
      }
      return {
        wrongAnswer: false,
        rows: Array.from(scope.querySelectorAll('[data-comment-id], .CommentItem')).map((node) => ({
          id: node.getAttribute('data-comment-id') || '',
          text: normalize(node.textContent || ''),
        })),
        commentLinks: Array.from(scope.querySelectorAll('a[href*="/comment/"]'))
          .map((node) => node.getAttribute('href') || '')
          .filter(Boolean),
      };
    })()`);
        if (beforeSubmitSnapshot.wrongAnswer) {
            throw new CliError('TARGET_NOT_FOUND', 'Resolved answer target no longer matches the requested answer:<questionId>:<answerId>');
        }
        const composer = await page.evaluate(`(async () => {
      const targetKind = ${JSON.stringify(target.kind)};
      const targetQuestionId = ${JSON.stringify(target.kind === 'answer' ? target.questionId : null)};
      const targetAnswerId = ${JSON.stringify(target.kind === 'answer' ? target.id : null)};
      let scope = document;
      if (targetKind === 'answer') {
        const block = Array.from(document.querySelectorAll('article, .AnswerItem, [data-zop-question-answer]')).find((node) => {
          const dataAnswerId = node.getAttribute('data-answerid') || node.getAttribute('data-zop-question-answer') || '';
          if (dataAnswerId && dataAnswerId.includes(targetAnswerId)) return true;
          return Array.from(node.querySelectorAll('a[href*="/answer/"]')).some((link) => {
            const href = link.getAttribute('href') || '';
            return href.includes('/question/' + targetQuestionId + '/answer/' + targetAnswerId);
          });
        });
        if (!block) return { composerState: 'wrong_answer' };
        scope = block;
      } else {
        scope =
          document.querySelector('article')
          || document.querySelector('.Post-Main')
          || document.querySelector('[itemprop="articleBody"]')
          || document;
      }
      const topLevelCandidates = Array.from(scope.querySelectorAll('[contenteditable="true"], textarea')).map((editor) => {
        const container = editor.closest('form, .CommentEditor, .CommentForm, .CommentsV2-footer, [data-comment-editor]') || editor.parentElement;
        const replyHint = editor.getAttribute('data-reply-to') || '';
        const text = 'value' in editor ? editor.value || '' : (editor.textContent || '');
        const nestedReply = Boolean(container?.closest('[data-comment-id], .CommentItem'));
        return { editor, container, replyHint, text, nestedReply };
      }).filter((candidate) => candidate.container && !candidate.nestedReply);
      if (topLevelCandidates.length !== 1) return { composerState: 'unsafe' };
      return {
        composerState: !topLevelCandidates[0].replyHint && !topLevelCandidates[0].text.trim() ? 'fresh_top_level' : 'unsafe',
      };
    })()`);
        if (composer.composerState === 'wrong_answer') {
            throw new CliError('TARGET_NOT_FOUND', 'Resolved answer target no longer matches the requested answer:<questionId>:<answerId>');
        }
        if (composer.composerState !== 'fresh_top_level') {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Comment composer was not a fresh top-level composer');
        }
        const editorCheck = await page.evaluate(`(async () => {
      const textToInsert = ${JSON.stringify(payload)};
      const targetKind = ${JSON.stringify(target.kind)};
      const targetQuestionId = ${JSON.stringify(target.kind === 'answer' ? target.questionId : null)};
      const targetAnswerId = ${JSON.stringify(target.kind === 'answer' ? target.id : null)};
      let scope = document;
      if (targetKind === 'answer') {
        const block = Array.from(document.querySelectorAll('article, .AnswerItem, [data-zop-question-answer]')).find((node) => {
          const dataAnswerId = node.getAttribute('data-answerid') || node.getAttribute('data-zop-question-answer') || '';
          if (dataAnswerId && dataAnswerId.includes(targetAnswerId)) return true;
          return Array.from(node.querySelectorAll('a[href*="/answer/"]')).some((link) => {
            const href = link.getAttribute('href') || '';
            return href.includes('/question/' + targetQuestionId + '/answer/' + targetAnswerId);
          });
        });
        if (!block) return { editorContent: '', mode: 'wrong_answer' };
        scope = block;
      } else {
        scope =
          document.querySelector('article')
          || document.querySelector('.Post-Main')
          || document.querySelector('[itemprop="articleBody"]')
          || document;
      }
      const topLevelCandidates = Array.from(scope.querySelectorAll('[contenteditable="true"], textarea')).map((editor) => {
        const container = editor.closest('form, .CommentEditor, .CommentForm, .CommentsV2-footer, [data-comment-editor]') || editor.parentElement;
        const nestedReply = Boolean(container?.closest('[data-comment-id], .CommentItem'));
        return { editor, container, nestedReply };
      }).filter((candidate) => candidate.container && !candidate.nestedReply);
      if (topLevelCandidates.length !== 1) return { editorContent: '', mode: 'missing' };
      const { editor } = topLevelCandidates[0];
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
      const replyHint = editor.getAttribute('data-reply-to') || '';
      return { editorContent: content, mode: replyHint ? 'reply' : 'top_level' };
    })()`);
        if (editorCheck.mode === 'wrong_answer') {
            throw new CliError('TARGET_NOT_FOUND', 'Resolved answer target no longer matches the requested answer:<questionId>:<answerId>');
        }
        if (editorCheck.mode !== 'top_level' || editorCheck.editorContent !== payload) {
            throw new CliError('OUTCOME_UNKNOWN', 'Comment editor content did not exactly match the requested payload before submit');
        }
        const proof = await page.evaluate(`(async () => {
      const normalize = (value) => value.replace(/\\s+/g, ' ').trim();
      const commentAuthorScopeSelector = ${JSON.stringify(COMMENT_AUTHOR_SCOPE_SELECTOR)};
      const readCommentAuthorSlug = (node) => {
        const authorScopes = Array.from(node.querySelectorAll(commentAuthorScopeSelector));
        const slugs = Array.from(new Set(authorScopes
          .flatMap((scope) => Array.from(scope.querySelectorAll('a[href^="/people/"]')))
          .map((link) => (link.getAttribute('href') || '').match(/^\\/people\\/([A-Za-z0-9_-]+)/)?.[1] || null)
          .filter(Boolean)));
        return slugs.length === 1 ? slugs[0] : null;
      };
      const targetKind = ${JSON.stringify(target.kind)};
      const targetQuestionId = ${JSON.stringify(target.kind === 'answer' ? target.questionId : null)};
      const targetAnswerId = ${JSON.stringify(target.kind === 'answer' ? target.id : null)};
      let scope = document;
      if (targetKind === 'answer') {
        const block = Array.from(document.querySelectorAll('article, .AnswerItem, [data-zop-question-answer]')).find((node) => {
          const dataAnswerId = node.getAttribute('data-answerid') || node.getAttribute('data-zop-question-answer') || '';
          if (dataAnswerId && dataAnswerId.includes(targetAnswerId)) return true;
          return Array.from(node.querySelectorAll('a[href*="/answer/"]')).some((link) => {
            const href = link.getAttribute('href') || '';
            return href.includes('/question/' + targetQuestionId + '/answer/' + targetAnswerId);
          });
        });
        if (!block) return { proofType: 'wrong_answer' };
        scope = block;
      } else {
        scope =
          document.querySelector('article')
          || document.querySelector('.Post-Main')
          || document.querySelector('[itemprop="articleBody"]')
          || document;
      }

      const topLevelCandidates = Array.from(scope.querySelectorAll('[contenteditable="true"], textarea')).map((editor) => {
        const container = editor.closest('form, [role="dialog"], .CommentEditor, .CommentForm, .CommentsV2-footer, [data-comment-editor]') || editor.parentElement;
        const nestedReply = Boolean(container?.closest('[data-comment-id], .CommentItem'));
        return { editor, container, nestedReply };
      }).filter((candidate) => candidate.container && !candidate.nestedReply);
      if (topLevelCandidates.length !== 1) return { proofType: 'unknown' };
      const submitScope = topLevelCandidates[0].container || scope;
      const submit = Array.from(submitScope.querySelectorAll('button')).find((node) => /发布|评论|发送/.test(node.textContent || ''));
      submit && submit.click();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const createdLink = Array.from(scope.querySelectorAll('a[href*="/comment/"]')).find((node) => {
        const href = node.getAttribute('href') || '';
        return href.includes('/comment/') && !${JSON.stringify(beforeSubmitSnapshot.commentLinks ?? [])}.includes(href);
      });

      if (createdLink) {
        const card = createdLink.closest('[data-comment-id], .CommentItem, li');
        const authorSlug = card ? readCommentAuthorSlug(card) : null;
        const contentNode =
          card?.querySelector('[data-comment-content], .RichContent-inner, .CommentItemV2-content, .CommentContent')
          || card;
        const text = normalize(contentNode?.textContent || '');
        const nestedReply = Boolean(card?.closest('ul ul, ol ol, li li') || card?.parentElement?.closest('[data-comment-id], .CommentItem'));
        return {
          proofType: 'stable_url',
          createdUrl: new URL(createdLink.getAttribute('href') || '', location.origin).href,
          commentScope: nestedReply ? 'nested_reply' : 'top_level_only',
          authorIdentity: authorSlug,
          targetMatches: text === normalize(${JSON.stringify(payload)}),
        };
      }

      const currentUserSlug = ${JSON.stringify(authorIdentity)};
      const beforeIds = new Set(${JSON.stringify((beforeSubmitSnapshot.rows ?? []).map((row) => row.id).filter(Boolean))});
      const beforeTexts = new Set(${JSON.stringify((beforeSubmitSnapshot.rows ?? []).map((row) => row.text).filter(Boolean))});
      const normalizedPayload = normalize(${JSON.stringify(payload)});
      const after = Array.from(scope.querySelectorAll('[data-comment-id], .CommentItem')).map((node) => {
        return {
          id: node.getAttribute('data-comment-id') || '',
          text: normalize(node.textContent || ''),
          authorSlug: readCommentAuthorSlug(node),
          topLevel: !node.closest('ul ul, ol ol, li li') && !node.parentElement?.closest('[data-comment-id], .CommentItem'),
        };
      });

      const matching = after.filter((row) =>
        !beforeIds.has(row.id)
        && row.authorSlug === currentUserSlug
        && row.topLevel
        && row.text === normalizedPayload
        && !beforeTexts.has(row.text)
      );

      return matching.length === 1
        ? {
            proofType: 'fallback',
            createdProof: {
              proof_type: 'comment_fallback',
              author_scope: 'current_user',
              target_scope: 'requested_target',
              comment_scope: 'top_level_only',
              content_match: 'exact_normalized',
              observed_after_submit: true,
              present_in_pre_submit_snapshot: false,
              new_matching_entries: 1,
              post_submit_matching_entries: after.filter((row) =>
                row.authorSlug === currentUserSlug && row.topLevel && row.text === normalizedPayload
              ).length,
              snapshot_scope: ${JSON.stringify(target.kind === 'answer'
            ? 'stabilized_expanded_target_answer_comment_list'
            : 'stabilized_expanded_target_article_comment_list')},
            },
          }
        : { proofType: 'unknown' };
    })()`);
        if (proof.proofType === 'wrong_answer') {
            throw new CliError('TARGET_NOT_FOUND', 'Resolved answer target no longer matches the requested answer:<questionId>:<answerId>');
        }
        if (proof.proofType === 'fallback') {
            return buildResultRow(`Commented on ${target.kind}`, target.kind, rawTarget, 'created', {
                author_identity: authorIdentity,
                created_proof: proof.createdProof,
            });
        }
        if (proof.proofType !== 'stable_url') {
            throw new CliError('OUTCOME_UNKNOWN', 'Comment submit was dispatched, but the created object could not be proven safely');
        }
        if (proof.commentScope !== 'top_level_only' || proof.authorIdentity !== authorIdentity || !proof.targetMatches) {
            throw new CliError('OUTCOME_UNKNOWN', 'Stable comment URL was found, but authorship or top-level scope could not be proven safely');
        }
        return buildResultRow(`Commented on ${target.kind}`, target.kind, rawTarget, 'created', {
            author_identity: authorIdentity,
            created_url: proof.createdUrl,
        });
    },
});
