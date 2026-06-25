export function argvPositional(commandName, index = 0) {
  const argv = process.argv || [];
  const commandIndex = argv.lastIndexOf(commandName);
  if (commandIndex < 0) return '';
  const values = [];
  for (let i = commandIndex + 1; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--') continue;
    if (String(value).startsWith('-')) {
      const next = argv[i + 1];
      if (next !== undefined && !String(next).startsWith('-')) i += 1;
      continue;
    }
    values.push(value);
  }
  return values[index] || '';
}

export function argvOption(name, fallback = '') {
  const argv = process.argv || [];
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const next = argv[index + 1];
  if (next === undefined || String(next).startsWith('-')) return fallback;
  return next;
}
