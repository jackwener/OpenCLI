import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute } from './write-shared.js';
cli({
    site: 'zhihu',
    name: 'like',
    description: 'Like a Zhihu answer or article',
    domain: 'zhihu.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu target URL or typed target' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu like');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('like', parseTarget(rawTarget));
        await page.goto(target.url);
        const result = await page.evaluate(`(async () => {
      const targetKind = ${JSON.stringify(target.kind)};
      const targetQuestionId = ${JSON.stringify(target.kind === 'answer' ? target.questionId : null)};
      const targetAnswerId = ${JSON.stringify(target.kind === 'answer' ? target.id : null)};

      let btn = null;
      if (targetKind === 'answer') {
        const block = Array.from(document.querySelectorAll('article, .AnswerItem, [data-zop-question-answer]')).find((node) => {
          const dataAnswerId = node.getAttribute('data-answerid') || node.getAttribute('data-zop-question-answer') || '';
          if (dataAnswerId && dataAnswerId.includes(targetAnswerId)) return true;
          return Array.from(node.querySelectorAll('a[href*="/answer/"]')).some((link) => {
            const href = link.getAttribute('href') || '';
            return href.includes('/question/' + targetQuestionId + '/answer/' + targetAnswerId);
          });
        });
        if (!block) return { state: 'wrong_answer' };
        const candidates = Array.from(block?.querySelectorAll('button') || []).filter((node) => {
          const text = (node.textContent || '').trim();
          const inCommentItem = Boolean(node.closest('[data-comment-id], .CommentItem'));
          return /赞同|赞/.test(text) && node.hasAttribute('aria-pressed') && !inCommentItem;
        });
        if (candidates.length !== 1) return { state: 'ambiguous_answer_like' };
        btn = candidates[0];
      } else {
        const articleRoot =
          document.querySelector('article')
          || document.querySelector('.Post-Main')
          || document.querySelector('[itemprop="articleBody"]')
          || document;
        const candidates = Array.from(articleRoot.querySelectorAll('button')).filter((node) => {
          const text = (node.textContent || '').trim();
          return /赞同|赞/.test(text) && node.hasAttribute('aria-pressed');
        });
        if (candidates.length !== 1) return { state: 'ambiguous_article_like' };
        btn = candidates[0];
      }

      if (!btn) return { state: 'missing' };
      if (btn.getAttribute('aria-pressed') === 'true') return { state: 'already_liked' };

      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 1200));

      return btn.getAttribute('aria-pressed') === 'true'
        ? { state: 'liked' }
        : { state: 'unknown' };
    })()`);
        if (result?.state === 'wrong_answer') {
            throw new CliError('TARGET_NOT_FOUND', 'Resolved answer target no longer matches the requested answer:<questionId>:<answerId>');
        }
        if (result?.state === 'already_liked') {
            return buildResultRow(`Already liked ${target.kind}`, target.kind, rawTarget, 'already_applied');
        }
        if (result?.state === 'ambiguous_answer_like') {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Answer like control was not uniquely anchored on the requested answer');
        }
        if (result?.state === 'ambiguous_article_like') {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Article like control was not uniquely anchored on the requested target');
        }
        if (result?.state === 'missing') {
            throw new CliError('ACTION_FAILED', 'Zhihu like control was missing before any write was dispatched');
        }
        if (result?.state !== 'liked') {
            throw new CliError('OUTCOME_UNKNOWN', 'Zhihu like click was dispatched, but the final state could not be verified safely');
        }
        return buildResultRow(`Liked ${target.kind}`, target.kind, rawTarget, 'applied');
    },
});
