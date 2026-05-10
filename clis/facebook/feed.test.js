/**
 * Regression test: evaluate scripts inside template literals must produce
 * syntactically valid JavaScript after framework placeholder substitution.
 * Catches double-escaping bugs (\d, \s, \n) that typecheck cannot see
 * because the code lives inside a string passed to page.evaluate.
 */
import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './feed.js';

describe('facebook feed evaluate script', () => {
  it('produces valid JS after placeholder substitution', () => {
    const cmd = getRegistry().get('facebook/feed');
    expect(cmd).toBeDefined();

    const evaluateStep = cmd.pipeline?.find(step => 'evaluate' in step);
    expect(evaluateStep).toBeDefined();

    // Replace framework placeholders ${{ expr }} with dummy values so
    // new Function() can parse the script without substitution support.
    const script = evaluateStep.evaluate.replace(/\$\{\{[^}]*\}\}/g, '10');

    expect(() => new Function(`return (${script})`)).not.toThrow();
  });
});
