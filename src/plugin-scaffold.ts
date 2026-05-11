/**
 * Plugin scaffold: generates a ready-to-develop plugin directory.
 *
 * Usage: opencli plugin create <name> [--dir <path>]
 *
 * Creates:
 *   <name>/
 *     opencli-plugin.json   — manifest with name, version, description
 *     package.json          — ESM package with opencli peer dependency
 *     hello.ts              — sample pipeline command
 *     greet.ts              — sample TS command using func()
 *     README.md             — basic documentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PKG_VERSION } from './version.js';

export interface ScaffoldOptions {
  /** Directory to create the plugin in. Defaults to `./<name>` */
  dir?: string;
  /** Plugin description */
  description?: string;
}

export interface ScaffoldResult {
  name: string;
  dir: string;
  files: string[];
}

/**
 * Create a new plugin scaffold directory.
 */
export function createPluginScaffold(name: string, opts: ScaffoldOptions = {}): ScaffoldResult {
  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Invalid plugin name "${name}". ` +
      `Plugin names must start with a lowercase letter and contain only lowercase letters, digits, and hyphens.`
    );
  }

  const targetDir = opts.dir
    ? path.resolve(opts.dir)
    : path.resolve(name);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const files: string[] = [];

  // opencli-plugin.json
  const manifest = {
    name,
    version: '0.1.0',
    description: opts.description ?? `An opencli plugin: ${name}`,
    opencli: `>=${PKG_VERSION}`,
  };
  writeFile(targetDir, 'opencli-plugin.json', JSON.stringify(manifest, null, 2) + '\n');
  files.push('opencli-plugin.json');

  // package.json
  const pkg = {
    name: `opencli-plugin-${name}`,
    version: '0.1.0',
    type: 'module',
    description: opts.description ?? `An opencli plugin: ${name}`,
    peerDependencies: {
      '@jackwener/opencli': `>=${PKG_VERSION}`,
    },
  };
  writeFile(targetDir, 'package.json', JSON.stringify(pkg, null, 2) + '\n');
  files.push('package.json');

  // hello.ts — sample pipeline command
  const helloContent = `/**
 * Sample pipeline command for ${name}.
 * Demonstrates the declarative pipeline API.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: '${name}',
  name: 'hello',
  description: 'A sample pipeline command',
  strategy: Strategy.PUBLIC,
  browser: false,
  columns: ['greeting'],
  pipeline: [
    { fetch: { url: 'https://httpbin.org/get?greeting=hello' } },
    { select: 'args' },
  ],
});
`;
  writeFile(targetDir, 'hello.ts', helloContent);
  files.push('hello.ts');

  // greet.ts — sample TS command using registry API
  const tsContent = `/**
 * Sample TypeScript command for ${name}.
 * Demonstrates the programmatic cli() registration API.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: '${name}',
  name: 'greet',
  description: 'Greet someone by name',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'name', positional: true, required: true, help: 'Name to greet' },
  ],
  columns: ['greeting'],
  func: async (kwargs) => [{ greeting: \`Hello, \${String(kwargs.name ?? 'World')}!\` }],
});
`;
  writeFile(targetDir, 'greet.ts', tsContent);
  files.push('greet.ts');

  // README.md
  const readme = `# opencli-plugin-${name}

${opts.description ?? `An opencli plugin: ${name}`}

## Install

\`\`\`bash
# From local development directory
opencli plugin install file://${targetDir}

# From GitHub (after publishing)
opencli plugin install github:<user>/opencli-plugin-${name}
\`\`\`

## Commands

| Command | Type | Description |
|---------|------|-------------|
| \`${name}/hello\` | Pipeline | Sample pipeline command |
| \`${name}/greet\` | TypeScript | Sample TS command with func() |

## Development

\`\`\`bash
# Install locally for development (symlinked, changes reflect immediately)
opencli plugin install file://${targetDir}

# Verify commands are registered
opencli list | grep ${name}

# Run a command
opencli ${name} hello
opencli ${name} greet --name World
\`\`\`
`;
  writeFile(targetDir, 'README.md', readme);
  files.push('README.md');

  return { name, dir: targetDir, files };
}

function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content);
}
