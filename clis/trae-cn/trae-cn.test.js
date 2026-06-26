import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { activityCommand } from './activity.js';
import { approveCommand } from './approve.js';
import { askCommand } from './ask.js';
import { modelCommand } from './model.js';
import { newCommand } from './new.js';
import { readCommand } from './read.js';
import { selectModelCommand } from './select-model.js';
import { sendCommand } from './send.js';
import { setupCommand } from './setup.js';
import { statusCommand } from './status.js';
import { targetsCommand } from './targets.js';
import { watchCommand } from './watch.js';
import {
  activityScript,
  approvalPromptsScript,
  clickNewTaskScript,
  countTurnsScript,
  currentTaskStateScript,
  injectPromptScript,
  isLikelyBlockingActivity,
  listOpenModelItemsScript,
  normalizeApprovalKinds,
  normalizeApprovalLimit,
  normalizeLimit,
  normalizeMaxChars,
  normalizeModelLabel,
  normalizeTimeout,
  readMessagesScript,
  submitPromptScript,
  submittedPromptScript,
} from './utils.js';

function evaluateInDom(html, script) {
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  return dom.window.eval(script);
}

describe('trae-cn utils', () => {
  it('extracts user and assistant turns from Trae CN DOM', () => {
    const rows = evaluateInDom(`
      <section class="chat-turn user" data-role="user" data-turn-index="1" data-message-id="u1">
        <div class="chat-turn-heading user">User</div>
        <div class="user-chat-line"><span>hello</span></div>
        <div class="user-chat-line"><span>world</span></div>
      </section>
      <section class="chat-turn assistant task" data-role="assistant" data-turn-index="2" data-message-id="a1">
        <div class="chat-turn-heading assistant">Trae Agent</div>
        <div class="chat-markdown"><p class="chat-markdown-p">TRAE_OPENCLI_SMOKE_OK</p></div>
        <div class="assistant-action-bar">copy</div>
      </section>
    `, readMessagesScript(10));

    expect(rows).toEqual([
      { Role: 'User', Text: 'hello\nworld', TextChars: 11, Truncated: 'no', TurnIndex: '1', MessageId: 'u1' },
      { Role: 'Assistant', Text: 'TRAE_OPENCLI_SMOKE_OK', TextChars: 21, Truncated: 'no', TurnIndex: '2', MessageId: 'a1' },
    ]);
  });

  it('limits and truncates returned turns', () => {
    const rows = evaluateInDom(`
      <section class="chat-turn user" data-role="user"><div class="user-chat-line">one</div></section>
      <section class="chat-turn assistant" data-role="assistant"><div class="chat-markdown">abcdef</div></section>
    `, readMessagesScript(1, 3));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Text: 'abc\n...[truncated, 3 chars omitted]', TextChars: 6, Truncated: 'yes' });
  });

  it('validates timeout, limit, and approval arguments', () => {
    expect(normalizeTimeout(undefined, 60)).toBe(60);
    expect(normalizeLimit(undefined, 20)).toBe(20);
    expect(normalizeMaxChars(undefined, 6000)).toBe(6000);
    expect(normalizeApprovalKinds(undefined)).toEqual(['terminal', 'delete']);
    expect(normalizeApprovalKinds('terminal,delete')).toEqual(['terminal', 'delete']);
    expect(normalizeApprovalKinds('all')).toEqual(['terminal', 'delete', 'keep']);
    expect(normalizeApprovalLimit(undefined, 1)).toBe(1);
    expect(() => normalizeTimeout(0)).toThrow('--timeout');
    expect(() => normalizeLimit(201)).toThrow('--limit');
    expect(() => normalizeMaxChars(-1)).toThrow('--max-chars');
    expect(() => normalizeApprovalKinds('terminal,unknown')).toThrow('--approve-kinds');
    expect(() => normalizeApprovalLimit(21)).toThrow('--limit');
  });

  it('builds injectable scripts for composer, turn count, and model selection', () => {
    expect(injectPromptScript('hello')).toContain('chat-input-v2-input-box-editable');
    expect(submitPromptScript()).toContain('chat-input-v2-send-button');
    expect(submittedPromptScript(2, 'hello')).toContain('section.chat-turn');
    expect(countTurnsScript()).toContain('section.chat-turn');
    expect(normalizeModelLabel('GPT 5.4')).toBe('gpt5.4');
    expect(normalizeModelLabel('GPT-5.4')).toBe('gpt5.4');
    expect(listOpenModelItemsScript()).toContain('icube-model-select-portal-model-item');
  });

  it('clicks the Trae new task control by stable data-testid', () => {
    const dom = new JSDOM(`
      <a role="button" data-testid="ai-chat-create-new-session" aria-label="新建任务 (⌃⌘N)">新建</a>
    `, { runScripts: 'dangerously' });
    const button = dom.window.document.querySelector('[data-testid="ai-chat-create-new-session"]');
    button.click = () => button.setAttribute('data-clicked', 'yes');
    button.getBoundingClientRect = () => ({ width: 120, height: 32 });

    const result = dom.window.eval(clickNewTaskScript());
    expect(result).toMatchObject({ ok: true, method: 'data-testid-or-class' });
    expect(button.getAttribute('data-clicked')).toBe('yes');
  });

  it('reads the current task state', () => {
    const state = evaluateInDom(`
      <title>AGENTS.md (Preview) — talk</title>
      <div class="chat-input-selected-agent-title">@Trae Agent</div>
      <div class="chat-input-v2-editor-part-lower__left">GPT-5.4</div>
      <div class="chat-input-v2-input-box-editable" data-lexical-editor="true"></div>
    `, currentTaskStateScript());

    expect(state).toMatchObject({ workspace: 'talk', model: 'GPT-5.4', agent: '@Trae Agent', turns: 0, composerReady: true });
  });

  it('detects and clicks terminal approval prompts', () => {
    const dom = new JSDOM(`
      <div role="dialog">
        <p>Trae 请求运行终端命令：printf OPENCLI_APPROVE</p>
        <button id="cancel">取消</button>
        <button id="approve">同意运行</button>
      </div>
    `, { runScripts: 'dangerously' });
    const approve = dom.window.document.querySelector('#approve');
    const cancel = dom.window.document.querySelector('#cancel');
    approve.click = () => approve.setAttribute('data-clicked', 'yes');
    cancel.click = () => cancel.setAttribute('data-clicked', 'yes');

    const rows = dom.window.eval(approvalPromptsScript(['terminal'], { click: true, limit: 1, maxChars: 200 }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Status: 'Approved', Kind: 'terminal', Button: '同意运行', Action: 'clicked' });
    expect(rows[0].Prompt).toContain('运行终端命令');
    expect(approve.getAttribute('data-clicked')).toBe('yes');
    expect(cancel.getAttribute('data-clicked')).toBeNull();
  });

  it('does not click ordinary terminal result-card controls without a confirmation prompt', () => {
    const dom = new JSDOM(`
      <section class="chat-turn assistant">
        <div class="terminal-run-card">
          <p>workspace 白名单运行 在终端查看</p>
          <button id="sandbox">沙箱运行（支持白名单）</button>
          <button id="run">运行</button>
        </div>
      </section>
    `, { runScripts: 'dangerously' });
    for (const button of dom.window.document.querySelectorAll('button')) {
      button.click = () => button.setAttribute('data-clicked', 'yes');
    }

    const rows = dom.window.eval(approvalPromptsScript(['terminal'], { click: true, limit: 1, maxChars: 200 }));
    expect(rows).toEqual([]);
    expect(dom.window.document.querySelector('#sandbox').getAttribute('data-clicked')).toBeNull();
    expect(dom.window.document.querySelector('#run').getAttribute('data-clicked')).toBeNull();
  });

  it('does not click terminal run-mode dropdowns inside a real confirmation card', () => {
    const dom = new JSDOM(`
      <div role="dialog">
        <p>检测到高风险命令 echo ok，运行命令可能会带来严重后果，是否仍要在沙箱中运行？</p>
        <button id="mode">沙箱运行（支持白名单）</button>
        <button id="auto">自动运行</button>
        <button id="skip">跳过</button>
        <button id="allowlist">添加 1 个命令 到白名单</button>
        <button id="run">运行</button>
      </div>
    `, { runScripts: 'dangerously' });
    for (const button of dom.window.document.querySelectorAll('button')) {
      button.click = () => button.setAttribute('data-clicked', 'yes');
    }

    const rows = dom.window.eval(approvalPromptsScript(['terminal'], { click: true, limit: 1, maxChars: 200 }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Kind: 'terminal', Button: '运行' });
    expect(dom.window.document.querySelector('#run').getAttribute('data-clicked')).toBe('yes');
    expect(dom.window.document.querySelector('#mode').getAttribute('data-clicked')).toBeNull();
    expect(dom.window.document.querySelector('#auto').getAttribute('data-clicked')).toBeNull();
    expect(dom.window.document.querySelector('#allowlist').getAttribute('data-clicked')).toBeNull();
    expect(dom.window.document.querySelector('#skip').getAttribute('data-clicked')).toBeNull();
  });

  it('prioritizes the second high-risk terminal confirmation modal', () => {
    const dom = new JSDOM(`
      <div class="terminal-run-card">
        <p>运行终端命令 rm -rf tmp-file</p>
        <button id="run-card">运行</button>
      </div>
      <div role="dialog">
        <p>运行风险命令可能导致不可挽回的后果，确认是否仍要执行？</p>
        <button id="cancel">取消</button>
        <button id="run-modal">仍要运行</button>
      </div>
    `, { runScripts: 'dangerously' });
    for (const button of dom.window.document.querySelectorAll('button')) {
      button.click = () => button.setAttribute('data-clicked', 'yes');
    }

    const rows = dom.window.eval(approvalPromptsScript(['terminal'], { click: true, limit: 1, maxChars: 300 }));
    expect(rows[0]).toMatchObject({ Kind: 'terminal', Button: '仍要运行', Action: 'clicked' });
    expect(dom.window.document.querySelector('#run-modal').getAttribute('data-clicked')).toBe('yes');
    expect(dom.window.document.querySelector('#run-card').getAttribute('data-clicked')).toBeNull();
  });

  it('distinguishes delete approval from keep approval', () => {
    const dom = new JSDOM(`
      <div class="file-delete-confirm-card">
        <p>是否删除 opencli.tmp？删除后文件无法恢复。</p>
        <button id="keep">保留文档</button>
        <button id="delete">删除</button>
      </div>
    `, { runScripts: 'dangerously' });
    const keep = dom.window.document.querySelector('#keep');
    const remove = dom.window.document.querySelector('#delete');
    keep.click = () => keep.setAttribute('data-clicked', 'yes');
    remove.click = () => remove.setAttribute('data-clicked', 'yes');

    const deleteRows = dom.window.eval(approvalPromptsScript(['delete'], { click: true, limit: 1, maxChars: 200 }));
    expect(deleteRows[0]).toMatchObject({ Kind: 'delete', Button: '删除' });
    expect(remove.getAttribute('data-clicked')).toBe('yes');
    expect(keep.getAttribute('data-clicked')).toBeNull();

    const keepRows = dom.window.eval(approvalPromptsScript(['keep'], { click: true, limit: 1, maxChars: 200 }));
    expect(keepRows[0]).toMatchObject({ Kind: 'keep', Button: '保留文档' });
    expect(keep.getAttribute('data-clicked')).toBe('yes');
  });

  it('summarizes activity and blocking approval state', () => {
    const row = evaluateInDom(`
      <title>Task — talk</title>
      <div class="chat-input-selected-agent-title">@Trae Agent</div>
      <div class="chat-input-v2-editor-part-lower__left">GPT-5.4</div>
      <section class="chat-turn assistant" data-role="assistant" data-turn-index="3" data-message-id="a3">
        <div class="icd-tasks-list-card-container">
          <div class="icd-tasks-list-item-container in_progress">
            <div class="icd-tasks-list-item-content">Run command</div>
          </div>
        </div>
        <div role="dialog">
          <p>Trae 请求运行终端命令：npm test</p>
          <button>同意运行</button>
        </div>
      </section>
    `, activityScript(600));

    expect(row).toMatchObject({
      Status: 'running',
      Workspace: 'talk',
      Model: 'GPT-5.4',
      Agent: '@Trae Agent',
      ApprovalPending: 'yes',
      ApprovalKind: 'terminal',
      ApprovalButton: '同意运行',
    });
    expect(isLikelyBlockingActivity(row)).toBe(true);
  });
});

describe('trae-cn commands', () => {
  it('keeps the first PR command surface focused on the desktop adapter loop', async () => {
    const setupRows = await setupCommand.func();
    const setupText = setupRows.map(row => `${row.Command}\n${row.Purpose}`).join('\n');
    expect(setupText).toContain('open -a "Trae CN" --args --remote-debugging-port=39240');
    expect(setupText).toContain('export OPENCLI_CDP_TARGET="talk"');
    expect(setupText).toContain('opencli trae-cn approve --approve-kinds terminal,delete -f json');
    expect(setupText).toContain('opencli trae-cn watch --stream true --duration 120 --auto-approve true');
  });

  it('documents endpoint/target examples for browser commands', () => {
    for (const command of [activityCommand, approveCommand, askCommand, modelCommand, newCommand, readCommand, selectModelCommand, sendCommand, statusCommand, watchCommand]) {
      expect(command.example).toContain('OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240');
      expect(command.example).toContain('OPENCLI_CDP_TARGET=');
    }
    expect(targetsCommand.example).toContain('OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240');
  });

  it('keeps approval clicks opt-in and marks any approval-capable command as write', () => {
    expect(askCommand.access).toBe('write');
    expect(watchCommand.access).toBe('write');
    expect(approveCommand.access).toBe('write');
    expect(askCommand.args.find(arg => arg.name === 'auto-approve')).toMatchObject({ type: 'boolean', default: false });
    expect(watchCommand.args.find(arg => arg.name === 'auto-approve')).toMatchObject({ type: 'boolean', default: false });
    expect(askCommand.args.find(arg => arg.name === 'approve-kinds')).toMatchObject({ default: 'terminal,delete' });
    expect(watchCommand.args.find(arg => arg.name === 'approve-kinds')).toMatchObject({ default: 'terminal,delete' });
  });

  it('approve supports dry-run without clicking', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValueOnce([
        { Status: 'Detected', Kind: 'terminal', Button: '运行', Prompt: '运行终端命令', Selector: 'button', Action: 'detected' },
      ]),
    };

    const rows = await approveCommand.func(page, { 'approve-kinds': 'terminal,delete', limit: 1, 'max-chars': 300, 'dry-run': true });
    expect(rows).toEqual([
      { Status: 'Detected', Kind: 'terminal', Button: '运行', Prompt: '运行终端命令', Selector: 'button', Action: 'detected' },
    ]);
  });

  it('approve returns an explicit no-prompt row on dry-run when nothing matches', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValueOnce([]),
    };

    const rows = await approveCommand.func(page, { 'approve-kinds': 'terminal', limit: 1, 'dry-run': true });
    expect(rows[0]).toMatchObject({ Status: 'NoPrompt', Kind: 'terminal', Action: 'dry-run' });
  });

  it('approve fails closed when the native approval click fails', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValueOnce([
        { Status: 'Detected', Kind: 'terminal', Button: '运行', Prompt: '运行终端命令', Selector: '[data-opencli-approval-id="x"]', Action: 'detected' },
      ]),
      click: vi.fn().mockRejectedValueOnce(new Error('stale element')),
    };

    await expect(approveCommand.func(page, { 'approve-kinds': 'terminal', limit: 1, 'dry-run': false }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('select-model fails closed when the selected model is not verified after click', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ Index: 0, Model: 'GPT 5.4' }])
        .mockResolvedValueOnce({ model: 'Claude 4', workspace: 'talk', agent: '@Trae Agent' }),
      click: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
    };

    await expect(selectModelCommand.func(page, { name: 'GPT 5.4' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('select-model rejects ambiguous partial model names before changing selection', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { Index: 0, Model: 'GPT 5.4' },
          { Index: 1, Model: 'GPT 5.5' },
        ]),
      click: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
    };

    await expect(selectModelCommand.func(page, { name: 'GPT 5' }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.click).toHaveBeenCalledTimes(1);
    expect(page.click).toHaveBeenCalledWith(expect.stringContaining('icd-model-select-trigger'));
  });

  it('new fails closed when clicking new task does not prove a fresh empty composer', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce({ ok: true, method: 'data-testid-or-class' })
        .mockResolvedValue({ composerReady: true, turns: 2, workspace: 'talk', model: 'GPT-5.4', agent: '@Trae Agent' }),
      wait: vi.fn().mockResolvedValue(undefined),
    };

    await expect(newCommand.func(page, { timeout: 1 }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('send fails closed when submit does not create a matching user turn', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, mode: 'button' })
        .mockResolvedValue(false),
      wait: vi.fn().mockResolvedValue(undefined),
    };
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1_000;
      return now;
    });
    try {
      await expect(sendCommand.func(page, { text: 'ping' }))
        .rejects.toBeInstanceOf(CommandExecutionError);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('ask throws a typed timeout instead of returning a system sentinel row', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, mode: 'button' })
        .mockResolvedValueOnce(true),
      wait: vi.fn().mockResolvedValue(undefined),
    };
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 2_000;
      return now;
    });
    try {
      await expect(askCommand.func(page, { text: 'ping', timeout: 1, 'auto-approve': false }))
        .rejects.toBeInstanceOf(TimeoutError);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
