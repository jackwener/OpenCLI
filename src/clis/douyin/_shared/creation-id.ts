const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateCreationId(): string {
  const random = Array.from({ length: 4 }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('');
  return 'pin' + random + Date.now();
}
