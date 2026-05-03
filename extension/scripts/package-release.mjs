import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionDir, '..');

function parseArgs(argv) {
  const args = { outDir: path.join(repoRoot, 'extension-package') };
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
    && !ref.startsWith('data:')
    && !ref.startsWith('#');
}

function addLocalAsset(files, ref) {
  if (isLocalAsset(ref)) files.add(ref);
}

function getDynamicOffscreenDocuments(manifest) {
  if (!manifest.permissions?.includes?.('offscreen')) return [];
  // Offscreen documents are created at runtime via chrome.offscreen.createDocument
  // rather than referenced by manifest.json, so keep the release package aware
  // of OpenCLI's fixed offscreen bridge entrypoint explicitly.
  return ['offscreen.html'];
}

function collectManifestEntrypoints(manifest) {
  const files = new Set(['manifest.json']);

  addLocalAsset(files, manifest.background?.service_worker);
  for (const page of getDynamicOffscreenDocuments(manifest)) addLocalAsset(files, page);
  addLocalAsset(files, manifest.action?.default_popup);
  addLocalAsset(files, manifest.options_page);
  addLocalAsset(files, manifest.devtools_page);
  addLocalAsset(files, manifest.side_panel?.default_path);

  for (const ref of Object.values(manifest.icons ?? {})) addLocalAsset(files, ref);
  for (const ref of Object.values(manifest.action?.default_icon ?? {})) addLocalAsset(files, ref);
  for (const contentScript of manifest.content_scripts ?? []) {
    for (const jsFile of contentScript.js ?? []) addLocalAsset(files, jsFile);
    for (const cssFile of contentScript.css ?? []) addLocalAsset(files, cssFile);
  }
  for (const page of manifest.sandbox?.pages ?? []) addLocalAsset(files, page);
  for (const overridePage of Object.values(manifest.chrome_url_overrides ?? {})) addLocalAsset(files, overridePage);
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const resource of entry.resources ?? []) addLocalAsset(files, resource);
  }
  if (manifest.default_locale) files.add('_locales');

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

async function collectJsDependencies(relativeJsPath, files, visited) {
  if (visited.has(relativeJsPath)) return;
  visited.add(relativeJsPath);

  const jsPath = path.join(extensionDir, relativeJsPath);
  const js = await fs.readFile(jsPath, 'utf8');
  const importRe = /(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of js.matchAll(importRe)) {
    const rawRef = match[1] ?? match[2];
    const cleanRef = rawRef.split('?')[0];
    if (!isLocalAsset(cleanRef)) continue;

    const resolvedRelativePath = cleanRef.startsWith('/')
      ? cleanRef.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(relativeJsPath), cleanRef));

    addLocalAsset(files, resolvedRelativePath);
    if (resolvedRelativePath.endsWith('.js')) {
      await collectJsDependencies(resolvedRelativePath, files, visited);
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
  if (manifest.side_panel?.default_path) htmlPages.push(manifest.side_panel.default_path);
  for (const page of getDynamicOffscreenDocuments(manifest)) htmlPages.push(page);
  if (manifest.offscreen_documents) {
    for (const page of manifest.offscreen_documents ?? []) htmlPages.push(page);
  }
  for (const page of manifest.sandbox?.pages ?? []) htmlPages.push(page);
  for (const overridePage of Object.values(manifest.chrome_url_overrides ?? {})) htmlPages.push(overridePage);

  const visited = new Set();
  for (const htmlPage of htmlPages) {
    if (isLocalAsset(htmlPage)) {
      await collectHtmlDependencies(htmlPage, files, visited);
    }
  }

  const visitedJs = new Set();
  let pendingJs = [...files].filter(file => file.endsWith('.js') && !visitedJs.has(file));
  while (pendingJs.length > 0) {
    for (const jsFile of pendingJs) {
      await collectJsDependencies(jsFile, files, visitedJs);
    }
    pendingJs = [...files].filter(file => file.endsWith('.js') && !visitedJs.has(file));
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
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  const requiredEntries = await collectManifestAssets(manifest);
  const missingEntries = await findMissingEntries(extensionDir, requiredEntries);

  if (missingEntries.length > 0) {
    console.error('Missing files referenced by the extension package:');
    for (const missingEntry of missingEntries) console.error(`- ${missingEntry}`);
    process.exit(1);
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  for (const relativePath of requiredEntries) {
    await copyEntry(relativePath, outDir);
  }

  // Guard against regressions where manifest entry files (e.g. action.default_popup)
  // are accidentally omitted from the packaged directory.
  const packagedEntrypoints = collectManifestEntrypoints(manifest);
  const missingPackagedEntrypoints = await findMissingEntries(outDir, packagedEntrypoints);
  if (missingPackagedEntrypoints.length > 0) {
    console.error('Packaged extension is missing files referenced by manifest.json:');
    for (const missingEntry of missingPackagedEntrypoints) console.error(`- ${missingEntry}`);
    process.exit(1);
  }

  console.log(`Extension package prepared at ${path.relative(repoRoot, outDir) || outDir}`);
}

await main();
