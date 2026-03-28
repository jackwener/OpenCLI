/**
 * tui.ts — Zero-dependency interactive TUI components
 *
 * Uses raw stdin mode + ANSI escape codes for interactive prompts.
 */
import chalk from 'chalk';
import { EXIT_CODES } from './errors.js';

export interface CheckboxItem {
  label: string;
  value: string;
  checked: boolean;
  /** Optional status to display after the label */
  status?: string;
  statusColor?: 'green' | 'yellow' | 'red' | 'dim';
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

  function colorStatus(status: string | undefined, color: CheckboxItem['statusColor']): string {
    if (!status) return '';
    switch (color) {
      case 'green': return chalk.green(status);
      case 'yellow': return chalk.yellow(status);
      case 'red': return chalk.red(status);
      case 'dim': return chalk.dim(status);
      default: return chalk.dim(status);
    }
  }

  function render() {
    // Move cursor to start and clear
    let out = '';

    if (opts.title) {
      out += `\n${chalk.bold(opts.title)}\n\n`;
    }

    for (let i = 0; i < state.length; i++) {
      const item = state[i];
      const pointer = i === cursor ? chalk.cyan('❯') : ' ';
      const checkbox = item.checked ? chalk.green('◉') : chalk.dim('○');
      const label = i === cursor ? chalk.bold(item.label) : item.label;
      const status = colorStatus(item.status, item.statusColor);
      out += `  ${pointer} ${checkbox} ${label}${status ? `  ${status}` : ''}\n`;
    }

    out += `\n  ${chalk.dim('↑↓ navigate  ·  Space toggle  ·  a all  ·  Enter confirm  ·  q cancel')}\n`;

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
        stdout.write(`  ${chalk.green('✓')} ${chalk.bold(`${selected.length} file(s) selected`)}\n\n`);
        resolve(selected);
        return;
      }

      // q / Esc — cancel
      if (key === 'q' || key === '\x1b') {
        cleanup();
        stdout.write(`  ${chalk.yellow('✗')} ${chalk.dim('Cancelled')}\n\n`);
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
