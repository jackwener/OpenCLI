import { CliError } from '../../errors.js';

export const CHATGPT_SURFACES = ['macos-native', 'macos-cdp', 'windows-cdp'] as const;

export type ChatGPTSurface = typeof CHATGPT_SURFACES[number];

export const DEFAULT_CHATGPT_SURFACE: ChatGPTSurface = 'macos-native';

export function normalizeChatGPTSurface(value: unknown): ChatGPTSurface {
  const normalized = String(value ?? '').trim().toLowerCase();
  return (CHATGPT_SURFACES as readonly string[]).includes(normalized)
    ? normalized as ChatGPTSurface
    : DEFAULT_CHATGPT_SURFACE;
}

export function isChatGPTCDPSurface(surface: ChatGPTSurface): boolean {
  return surface !== 'macos-native';
}

export function requireMacOSHost(commandName: string): void {
  if (process.platform === 'darwin') return;

  throw new CliError(
    'COMMAND_EXEC',
    `ChatGPT ${commandName} defaults to the macOS-native surface, but this host is ${process.platform}.`,
    'On macOS, rerun normally. From WSL/Linux targeting the Windows ChatGPT desktop app, rerun with --surface windows-cdp and OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9224.',
  );
}

export function chatGPTCDPHint(surface: ChatGPTSurface): string {
  if (surface === 'windows-cdp') {
    return 'Experimental ChatGPT windows-cdp surface: fully quit ChatGPT first, then launch the Windows ChatGPT app with `ChatGPT.exe --remote-debugging-port=9224 --remote-debugging-address=127.0.0.1`. After that export `OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9224`. If multiple inspectable targets exist, set `OPENCLI_CDP_TARGET=chatgpt`.';
  }

  return 'Experimental ChatGPT macos-cdp surface: launch `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --remote-debugging-port=9224`, then export `OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9224`. If multiple inspectable targets exist, set `OPENCLI_CDP_TARGET=chatgpt`.';
}

export const __test__ = {
  normalizeChatGPTSurface,
  isChatGPTCDPSurface,
};
