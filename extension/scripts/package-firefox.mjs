import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionDir, '..');

function parseArgs(argv) {
  const args = { outDir: path.join(repoRoot, 'extension-package-firefox') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out' && argv[i + 1]) {
      const outDir = argv[++i];
      args.outDir = path.isAbsolute(outDir)
        ? outDir
        : path.resolve(process.cwd(), outDir);
    }
  }
  return args;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isLocalAsset(ref) {
  return typeof ref === 'string'
    && ref.length > 0
    && !ref.startsWith('http://')
    && !ref.startsWith('https://')
    && !ref.startsWith('//')
    && !ref.startsWith('chrome://')
    && !ref.startsWith('chrome-extension://')
    && !ref.startsWith('moz-extension://')
    && !ref.startsWith('data:')
    && !ref.startsWith('#');
}

function addLocalAsset(files, ref) {
  if (isLocalAsset(ref)) files.add(ref);
}

function collectManifestEntrypoints(manifest) {
  const files = new Set(['manifest.firefox.json']);

  // Firefox uses background.scripts array instead of service_worker
  if (manifest.background?.scripts) {
    for (const script of manifest.background.scripts) addLocalAsset(files, script);
  }
  addLocalAsset(files, manifest.action?.default_popup);
  addLocalAsset(files, manifest.options_page);
  addLocalAsset(files, manifest.devtools_page);

  for (const ref of Object.values(manifest.icons ?? {})) addLocalAsset(files, ref);
  for (const ref of Object.values(manifest.action?.default_icon ?? {})) addLocalAsset(files, ref);
  for (const contentScript of manifest.content_scripts ?? []) {
    for (const jsFile of contentScript.js ?? []) addLocalAsset(files, jsFile);
    for (const cssFile of contentScript.css ?? []) addLocalAsset(files, cssFile);
  }

  return [...files];
}

async function collectHtmlDependencies(relativeHtmlPath, files, visited) {
  if (visited.has(relativeHtmlPath)) return;
  visited.add(relativeHtmlPath);

  const htmlPath = path.join(extensionDir, relativeHtmlPath);
  const html = await fs.readFile(htmlPath, 'utf8');
  const attrRe = /\b(?:src|href)=["']([^"'#?]+(?:\?[^"']*)?)["']/gi;

  for (const match of html.matchAll(attrRe)) {
    const rawRef = match[1];
    const cleanRef = rawRef.split('?')[0];
    if (!isLocalAsset(cleanRef)) continue;

    const resolvedRelativePath = cleanRef.startsWith('/')
      ? cleanRef.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(relativeHtmlPath), cleanRef));

    addLocalAsset(files, resolvedRelativePath);
    if (resolvedRelativePath.endsWith('.html')) {
      await collectHtmlDependencies(resolvedRelativePath, files, visited);
    }
  }
}

async function collectManifestAssets(manifest) {
  const files = new Set(collectManifestEntrypoints(manifest));
  const htmlPages = [];

  if (manifest.action?.default_popup) {
    htmlPages.push(manifest.action.default_popup);
  }
  if (manifest.options_page) htmlPages.push(manifest.options_page);
  if (manifest.devtools_page) htmlPages.push(manifest.devtools_page);

  const visited = new Set();
  for (const htmlPage of htmlPages) {
    if (isLocalAsset(htmlPage)) {
      await collectHtmlDependencies(htmlPage, files, visited);
    }
  }

  return [...files];
}

async function copyEntry(relativePath, outDir) {
  const fromPath = path.join(extensionDir, relativePath);
  const toPath = path.join(outDir, relativePath);
  const stats = await fs.stat(fromPath);

  if (stats.isDirectory()) {
    await fs.cp(fromPath, toPath, { recursive: true });
    return;
  }

  await fs.mkdir(path.dirname(toPath), { recursive: true });
  await fs.copyFile(fromPath, toPath);
}

async function findMissingEntries(baseDir, entries) {
  const missingEntries = [];
  for (const relativePath of entries) {
    const absolutePath = path.join(baseDir, relativePath);
    if (!(await exists(absolutePath))) {
      missingEntries.push(relativePath);
    }
  }
  return missingEntries;
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(extensionDir, 'manifest.firefox.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  const requiredEntries = await collectManifestAssets(manifest);
  const missingEntries = await findMissingEntries(extensionDir, requiredEntries);

  if (missingEntries.length > 0) {
    console.error('Missing files referenced by the Firefox extension package:');
    for (const missingEntry of missingEntries) console.error(`  - ${missingEntry}`);
    process.exit(1);
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  // Copy manifest.firefox.json as manifest.json in the output
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  await fs.writeFile(path.join(outDir, 'manifest.json'), manifestContent);

  // Copy all other required files
  for (const relativePath of requiredEntries) {
    if (relativePath === 'manifest.firefox.json') continue;
    await copyEntry(relativePath, outDir);
  }

  // Verify all entrypoints are present
  const packagedEntrypoints = collectManifestEntrypoints(manifest)
    .map(f => f === 'manifest.firefox.json' ? 'manifest.json' : f);
  const missingPackagedEntrypoints = await findMissingEntries(outDir, packagedEntrypoints);
  if (missingPackagedEntrypoints.length > 0) {
    console.error('Packaged Firefox extension is missing files:');
    for (const missingEntry of missingPackagedEntrypoints) console.error(`  - ${missingEntry}`);
    process.exit(1);
  }

  // Create .xpi file (zip archive)
  const xpiPath = path.join(repoRoot, `opencli-firefox-v${manifest.version}.xpi`);
  try {
    // Use system zip if available, otherwise note that user needs to zip manually
    execSync(`cd "${outDir}" && zip -r "${xpiPath}" .`, { stdio: 'pipe' });
    console.log(`Firefox extension packaged: ${path.relative(repoRoot, xpiPath) || xpiPath}`);
  } catch {
    console.log(`Firefox extension files prepared at ${path.relative(repoRoot, outDir) || outDir}`);
    console.log('To create .xpi, zip the contents: zip -r opencli-firefox.xpi .');
  }
}

await main();
