/**
 * tui.ts — Zero-dependency interactive TUI components
 *
 * Uses raw stdin mode + ANSI escape codes for interactive prompts.
 */
import { EXIT_CODES } from './errors.js';

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
