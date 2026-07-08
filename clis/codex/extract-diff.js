import { cli, Strategy } from '@jackwener/opencli/registry';
export const extractDiffCommand = cli({
    site: 'codex',
    name: 'extract-diff',
    access: 'read',
    description: 'Extract visual code review diff patches from Codex',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    columns: ['File', 'Diff'],
    func: async (page) => {
        const diffs = await page.evaluate(`
      (function() {
        const results = [];
        // Assuming diffs are rendered with standard diff classes or monaco difference editors
        const diffBlocks = document.querySelectorAll('.diff-editor, .monaco-diff-editor, [data-testid="diff-view"]');
        
        diffBlocks.forEach((block, index) => {
            // Very roughly scrape text representing additions/deletions mapped from the inner wrapper
            results.push({
                File: block.getAttribute('data-filename') || \`DiffBlock_\${index+1}\`,
                Diff: block.innerText || block.textContent
            });
        });

        // If no structured diffs found, try to find any code blocks labeled as patches
        if (results.length === 0) {
            const codeBlocks = document.querySelectorAll('pre code.language-diff, pre code.language-patch');
            codeBlocks.forEach((code, index) => {
                results.push({
                    File: \`Patch_\${index+1}\`,
                    Diff: code.innerText || code.textContent
                });
            });
        }
        
        return results;
      })()
    `);
        if (diffs.length === 0) {
            return [{ File: 'No diffs found', Diff: 'Try running opencli codex send "/review" first' }];
        }
        return diffs;
    },
});
