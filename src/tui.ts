/**
 * tui.ts — Zero-dependency interactive TUI components
 *
 * Uses raw stdin mode + ANSI escape codes for interactive prompts.
 */
import { EXIT_CODES } from './errors.js';

export interface CheckboxItem {
  label: string;
  value: string;
  checked: boolean;
  /** Optional status to display after the label */
  status?: string;
}

/**
 * Interactive multi-select checkbox prompt.
 *
 * Controls:
 *   ↑/↓ or j/k  — navigate
 *   Space        — toggle selection
 *   a            — toggle all
 *   Enter        — confirm
 *   q/Esc        — cancel (returns empty)
 */
export async function checkboxPrompt(
  items: CheckboxItem[],
  opts: { title?: string; hint?: string } = {},
): Promise<string[]> {
  if (items.length === 0) return [];

  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    // Non-interactive: return all checked items
    return items.filter(i => i.checked).map(i => i.value);
  }

  let cursor = 0;
  const state = items.map(i => ({ ...i }));

  function render() {
    // Move cursor to start and clear
    let out = '';

    if (opts.title) {
      out += `\n${opts.title}\n\n`;
    }

    for (let i = 0; i < state.length; i++) {
      const item = state[i];
      const pointer = i === cursor ? '❯' : ' ';
      const checkbox = item.checked ? '◉' : '○';
      const status = item.status ?? '';
      out += `  ${pointer} ${checkbox} ${item.label}${status ? `  ${status}` : ''}\n`;
    }

    out += `\n  ↑↓ navigate  ·  Space toggle  ·  a all  ·  Enter confirm  ·  q cancel\n`;

    return out;
  }

  return new Promise<string[]>((resolve) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write('\x1b[?25l'); // Hide cursor

    let firstDraw = true;

    function draw() {
      // Clear previous render (skip on first draw)
      if (!firstDraw) {
        const lines = render().split('\n').length;
        stdout.write(`\x1b[${lines}A\x1b[J`);
      }
      firstDraw = false;
      stdout.write(render());
    }

    function cleanup() {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener('data', onData);
      // Clear the TUI and restore cursor
      const lines = render().split('\n').length;
      stdout.write(`\x1b[${lines}A\x1b[J`);
      stdout.write('\x1b[?25h'); // Show cursor
    }

    function onData(data: Buffer) {
      const key = data.toString();

      // Arrow up / k
      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + state.length) % state.length;
        draw();
        return;
      }

      // Arrow down / j
      if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % state.length;
        draw();
        return;
      }

      // Space — toggle
      if (key === ' ') {
        state[cursor].checked = !state[cursor].checked;
        draw();
        return;
      }

      // Tab — toggle and move down
      if (key === '\t') {
        state[cursor].checked = !state[cursor].checked;
        cursor = (cursor + 1) % state.length;
        draw();
        return;
      }

      // 'a' — toggle all
      if (key === 'a') {
        const allChecked = state.every(i => i.checked);
        for (const item of state) item.checked = !allChecked;
        draw();
        return;
      }

      // Enter — confirm
      if (key === '\r' || key === '\n') {
        cleanup();
        const selected = state.filter(i => i.checked).map(i => i.value);
        // Show summary
        stdout.write(`  ✓ ${selected.length} file(s) selected\n\n`);
        resolve(selected);
        return;
      }

      // q / Esc — cancel
      if (key === 'q' || key === '\x1b') {
        cleanup();
        stdout.write(`  ✗ Cancelled\n\n`);
        resolve([]);
        return;
      }

      // Ctrl+C — exit process
      if (key === '\x03') {
        cleanup();
        process.exit(EXIT_CODES.INTERRUPTED);
      }
    }

    stdin.on('data', onData);
    draw();
  });
}

/**
 * Simple yes/no confirmation prompt.
 *
 * In non-TTY environments, returns `defaultYes` (defaults to true) without blocking.
 * In TTY, waits for a single keypress: y/Enter → true, n/Esc/q → false.
 */
export async function confirmPrompt(
  message: string,
  defaultYes: boolean = true,
): Promise<boolean> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return defaultYes;

  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  stdout.write(`  ${message} ${hint} `);

  return new Promise<boolean>((resolve) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    function cleanup() {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    }

    function onData(data: Buffer) {
      const key = data.toString();

      // Ctrl+C
      if (key === '\x03') {
        cleanup();
        process.exit(EXIT_CODES.INTERRUPTED);
      }

      // Enter — use default
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(defaultYes);
        return;
      }

      // y/Y — yes
      if (key === 'y' || key === 'Y') {
        cleanup();
        resolve(true);
        return;
      }

      // n/N/q/Esc — no
      if (key === 'n' || key === 'N' || key === 'q' || key === '\x1b') {
        cleanup();
        resolve(false);
        return;
      }

      // Ignore other keys
    }

    stdin.on('data', onData);
  });
}
