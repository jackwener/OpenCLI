const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|prior|above)\s+instructions?/i,
  /system\s*prompt/i,
  /you\s+are\s+(now\s+)?a/i,
  /execute\s+the\s+following/i,
  /\beval\b.*\bfetch\b/i,
  /忽略.*(之前|先前|上面).*指令/,
  /你現在是/,
];

export function assertNotInjected(content: string, source: string): void {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error(
        `[OpenCLI Security] Potential prompt injection blocked.\n` +
          `Source: ${source}\n` +
          `Matched pattern: ${pattern}`
      );
    }
  }
}
