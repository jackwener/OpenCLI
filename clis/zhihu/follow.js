import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute } from './write-shared.js';
cli({
    site: 'zhihu',
    name: 'follow',
    description: 'Follow a Zhihu user or question',
    domain: 'www.zhihu.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu target URL or typed target' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu follow');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('follow', parseTarget(rawTarget));
        await page.goto(target.url);
        const result = await page.evaluate(`(async () => {
      const targetKind = ${JSON.stringify(target.kind)};
      const mainRoot = document.querySelector('main') || document;
      let followBtn = null;

      if (targetKind === 'question') {
        const questionRoots = Array.from(mainRoot.querySelectorAll('.QuestionHeader, .Question-main, [data-zop-question-id], [class*="QuestionHeader"]'));
        const scopedRoots = questionRoots.length ? questionRoots : [mainRoot];
        const candidates = Array.from(new Set(scopedRoots.flatMap((root) => Array.from(root.querySelectorAll('button, a'))))).filter((node) => {
          const text = (node.textContent || '').trim();
          const inAside = Boolean(node.closest('aside, [data-testid*="recommend"], .Recommendations'));
          const inAnswerBlock = Boolean(node.closest('article, .AnswerItem, [data-zop-question-answer]'));
          return /关注问题|已关注/.test(text) && !inAside && !inAnswerBlock;
        });
        if (candidates.length !== 1) return { state: 'ambiguous_question_follow' };
        followBtn = candidates[0];
      } else {
        const candidates = Array.from(mainRoot.querySelectorAll('button, a')).filter((node) => {
          const text = (node.textContent || '').trim();
          const inAside = Boolean(node.closest('aside, [data-testid*="recommend"], .Recommendations'));
          return /关注|已关注/.test(text) && !/邀请|收藏|评论/.test(text) && !inAside;
        });

        if (candidates.length !== 1) return { state: 'ambiguous_user_follow' };
        followBtn = candidates[0];
      }

      if (!followBtn) return { state: 'missing' };
      if ((followBtn.textContent || '').includes('已关注') || followBtn.getAttribute('aria-pressed') === 'true') {
        return { state: 'already_following' };
      }

      followBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return ((followBtn.textContent || '').includes('已关注') || followBtn.getAttribute('aria-pressed') === 'true')
        ? { state: 'followed' }
        : { state: 'unknown' };
    })()`);
        if (result?.state === 'already_following') {
            return buildResultRow(`Already followed ${target.kind}`, target.kind, rawTarget, 'already_applied');
        }
        if (result?.state === 'ambiguous_question_follow') {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Question follow control was not uniquely anchored on the requested question page');
        }
        if (result?.state === 'ambiguous_user_follow') {
            throw new CliError('ACTION_NOT_AVAILABLE', 'User follow control was not uniquely anchored on the requested profile page');
        }
        if (result?.state === 'missing') {
            throw new CliError('ACTION_FAILED', 'Zhihu follow control was missing before any write was dispatched');
        }
        if (result?.state !== 'followed') {
            throw new CliError('OUTCOME_UNKNOWN', 'Zhihu follow click was dispatched, but the final state could not be verified safely');
        }
        return buildResultRow(`Followed ${target.kind}`, target.kind, rawTarget, 'applied');
    },
});
