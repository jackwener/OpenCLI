import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute } from './write-shared.js';
function rowKey(row) {
    return row.id || `name:${normalizeCollectionName(row.name)}`;
}
function normalizeCollectionName(value) {
    return value
        .replace(/\s+/g, ' ')
        .replace(/\s+\d+\s*(条内容|个内容|items?)$/i, '')
        .replace(/\s+(公开|私密|默认)$/i, '')
        .trim();
}
cli({
    site: 'zhihu',
    name: 'favorite',
    description: 'Favorite a Zhihu answer or article into a specific collection',
    domain: 'zhihu.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu target URL or typed target' },
        { name: 'collection', help: 'Collection name' },
        { name: 'collection-id', help: 'Stable collection id' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target', 'collection_name', 'collection_id'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu favorite');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('favorite', parseTarget(rawTarget));
        const collectionName = typeof kwargs.collection === 'string' ? kwargs.collection : undefined;
        const collectionId = typeof kwargs['collection-id'] === 'string' ? kwargs['collection-id'] : undefined;
        if ((collectionName ? 1 : 0) + (collectionId ? 1 : 0) !== 1) {
            throw new CliError('INVALID_INPUT', 'Use exactly one of --collection or --collection-id');
        }
        await page.goto(target.url);
        const preflight = await page.evaluate(`(async () => {
      const targetKind = ${JSON.stringify(target.kind)};
      const targetQuestionId = ${JSON.stringify(target.kind === 'answer' ? target.questionId : null)};
      const targetAnswerId = ${JSON.stringify(target.kind === 'answer' ? target.id : null)};
      const wantedName = ${JSON.stringify(collectionName ?? null)};
      const wantedId = ${JSON.stringify(collectionId ?? null)};

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
        if (!block) return { wrongAnswer: true, chooserRows: [] };
        scope = block;
      } else {
        scope =
          document.querySelector('article')
          || document.querySelector('.Post-Main')
          || document.querySelector('[itemprop="articleBody"]')
          || document;
      }

      const favoriteButton = Array.from(scope.querySelectorAll('button')).find((node) => /收藏/.test(node.textContent || ''));
      if (!favoriteButton) return { wrongAnswer: false, missingChooser: true, chooserRows: [] };
      favoriteButton.click();
      await new Promise((resolve) => setTimeout(resolve, 600));

      const chooserRows = Array.from(document.querySelectorAll('[role="dialog"] li, [role="dialog"] [role="checkbox"], [role="dialog"] button'))
        .map((node) => {
          const text = (node.textContent || '').trim();
          const id = node.getAttribute('data-id') || node.getAttribute('data-collection-id') || '';
          const selected = node.getAttribute('aria-checked') === 'true'
            || node.getAttribute('aria-pressed') === 'true'
            || /已选|已收藏/.test(text);
          return text ? { id, name: text, selected } : null;
        })
        .filter(Boolean);

      return {
        wrongAnswer: false,
        missingChooser: chooserRows.length === 0,
        chooserRows,
        targetRowId: wantedId,
        targetRowName: wantedName,
      };
    })()`);
        if (preflight.wrongAnswer) {
            throw new CliError('TARGET_NOT_FOUND', 'Resolved answer target no longer matches the requested answer:<questionId>:<answerId>');
        }
        if (preflight.missingChooser) {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Favorite chooser did not open on the requested target');
        }
        const matchingRows = preflight.chooserRows.filter((row) => (collectionId
            ? row.id === collectionId
            : normalizeCollectionName(row.name) === normalizeCollectionName(collectionName || '')));
        if (collectionId && !matchingRows.some((row) => row.id === collectionId)) {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Favorite chooser could not confirm the requested stable collection id');
        }
        if (!collectionId && matchingRows.length !== 1) {
            throw new CliError('ACTION_NOT_AVAILABLE', 'Favorite chooser could not prove that the requested collection name is globally unique');
        }
        const targetRow = matchingRows[0];
        const targetRowKey = rowKey(targetRow);
        const selectedBefore = preflight.chooserRows.filter((row) => row.selected).map(rowKey);
        const verify = await page.evaluate(`(async () => {
      const targetKind = ${JSON.stringify(target.kind)};
      const targetQuestionId = ${JSON.stringify(target.kind === 'answer' ? target.questionId : null)};
      const targetAnswerId = ${JSON.stringify(target.kind === 'answer' ? target.id : null)};
      const targetWasSelected = ${JSON.stringify(targetRow.selected)};
      const wantedName = ${JSON.stringify(collectionName ?? null)};
      const wantedId = ${JSON.stringify(collectionId ?? null)};
      const normalizeCollectionName = (value) => String(value || '')
        .replace(/\\s+/g, ' ')
        .replace(/\\s+\\d+\\s*(条内容|个内容|items?)$/i, '')
        .replace(/\\s+(公开|私密|默认)$/i, '')
        .trim();
      const rowKey = (row) => row.id || 'name:' + normalizeCollectionName(row.name);

      const chooserSelector = '[role="dialog"] li, [role="dialog"] [role="checkbox"], [role="dialog"] button';
      const readChooserRows = () => Array.from(document.querySelectorAll(chooserSelector))
        .map((node) => {
          const text = (node.textContent || '').trim();
          const id = node.getAttribute('data-id') || node.getAttribute('data-collection-id') || '';
          const selected = node.getAttribute('aria-checked') === 'true'
            || node.getAttribute('aria-pressed') === 'true'
            || /已选|已收藏/.test(text);
          return text ? { id, name: text, selected } : null;
        })
        .filter(Boolean);
      const waitForChooserRows = async (expectedPresent) => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const rows = readChooserRows();
          if (expectedPresent ? rows.length > 0 : rows.length === 0) return rows;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return readChooserRows();
      };
      const closeChooser = async () => {
        const closeButton = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"]')).find((node) => {
          const text = (node.textContent || '').trim();
          const aria = node.getAttribute('aria-label') || '';
          return /关闭|取消|收起/.test(text) || /关闭|cancel|close/i.test(aria);
        });
        closeButton && closeButton.click();
        return waitForChooserRows(false);
      };
      const reopenChooser = async () => {
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
          if (!block) return [];
          scope = block;
        } else {
          scope =
            document.querySelector('article')
            || document.querySelector('.Post-Main')
            || document.querySelector('[itemprop="articleBody"]')
            || document;
        }
        const favoriteButton = Array.from(scope.querySelectorAll('button')).find((node) => /收藏/.test(node.textContent || ''));
        favoriteButton && favoriteButton.click();
        return waitForChooserRows(true);
      };

      let chooserRows = readChooserRows();
      let sawChooserClose = false;
      if (!targetWasSelected) {
        const row = Array.from(document.querySelectorAll('[role="dialog"] li, [role="dialog"] [role="checkbox"], [role="dialog"] button')).find((node) => {
          const text = (node.textContent || '').trim();
          const id = node.getAttribute('data-id') || node.getAttribute('data-collection-id') || '';
          return wantedId ? id === wantedId : normalizeCollectionName(text) === normalizeCollectionName(wantedName);
        });
        row && row.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const submit = Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => /完成|确定|保存/.test(node.textContent || ''));
        submit && submit.click();
        chooserRows = await waitForChooserRows(false);
        sawChooserClose = chooserRows.length === 0;
      } else {
        chooserRows = await closeChooser();
        sawChooserClose = chooserRows.length === 0;
      }
      if (sawChooserClose) {
        chooserRows = await reopenChooser();
      }

      return {
        persisted: sawChooserClose && chooserRows.length > 0,
        readbackSource: sawChooserClose && chooserRows.length > 0 ? 'reopened_chooser' : (chooserRows.length > 0 ? 'same_modal' : 'missing'),
        selectedAfter: chooserRows.filter((row) => row.selected).map(rowKey),
        targetSelected: chooserRows.some((row) => rowKey(row) === ${JSON.stringify(targetRowKey)} && row.selected),
      };
    })()`);
        if (!verify.persisted) {
            throw new CliError('OUTCOME_UNKNOWN', 'Favorite action may have been applied, but persisted read-back was unavailable');
        }
        if (verify.readbackSource !== 'reopened_chooser') {
            throw new CliError('OUTCOME_UNKNOWN', 'Favorite state was not re-read from a reopened chooser after submit');
        }
        if (!verify.targetSelected) {
            throw new CliError('OUTCOME_UNKNOWN', 'Favorite chooser remained readable, but the requested collection was not confirmed as selected');
        }
        if (!selectedBefore.every((row) => verify.selectedAfter.includes(row))) {
            throw new CliError('OUTCOME_UNKNOWN', `Favorite action changed unrelated collection membership: before=${JSON.stringify(selectedBefore)} after=${JSON.stringify(verify.selectedAfter)}`);
        }
        const outcome = targetRow.selected ? 'already_applied' : 'applied';
        return buildResultRow(targetRow.selected ? `Already favorited ${target.kind}` : `Favorited ${target.kind}`, target.kind, rawTarget, outcome, {
            collection_name: collectionName ?? targetRow.name,
            ...(targetRow.id ? { collection_id: targetRow.id } : {}),
        });
    },
});
