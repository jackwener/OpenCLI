import { describe, expect, it } from 'vitest';
import { buildClaudeModifyInvocation } from '../autoresearch/commands/run.js';

describe('autoresearch Claude invocation', () => {
  it('passes repository-derived prompts through stdin instead of shell arguments', () => {
    const prompt = 'try $(touch /tmp/opencli-pwned) and `id` and "quotes"';
    const invocation = buildClaudeModifyInvocation(prompt);

    expect(invocation.command).toBe('claude');
    expect(invocation.args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--allowedTools',
      'Bash(npm:*),Bash(npx:*),Bash(git:*),Read,Edit,Write,Glob,Grep',
      '--output-format',
      'text',
      '--no-session-persistence',
    ]);
    expect(invocation.args.join(' ')).not.toContain(prompt);
    expect(invocation.options.input).toBe(prompt);
    expect(invocation.options).not.toHaveProperty('shell');
  });
});
