import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import chalk from 'chalk';
import { log } from './logger.js';
import { EXIT_CODES, getErrorMessage } from './errors.js';
import * as externalStore from './external-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type InstallationType = 'global' | 'isolated';

export interface ExternalCliInstall {
  mac?: string;
  linux?: string;
  windows?: string;
  default?: string;
}

export interface IsolatedInstallEntry {
  version: string;
  installPath: string;
  installedAt: string;
  current: boolean;
}

export interface InstalledExternalCli {
  name: string;
  binaryName: string;
  installType: InstallationType;
  versions: IsolatedInstallEntry[];
  cachedVersion?: string;
  cachedAt?: string;
}

export interface ExternalLockFile {
  [name: string]: InstalledExternalCli;
}

export interface ListExternalCliEntry {
  name: string;
  description?: string;
  binary: string;
  installed: boolean;
  version?: string;
  installType?: InstallationType;
}

export interface ExternalCliConfig {
  name: string;
  binary: string;
  description?: string;
  homepage?: string;
  tags?: string[];
  install?: ExternalCliInstall;
}

function getUserRegistryPath(): string {
  const home = os.homedir();
  return path.join(home, '.opencli', 'external-clis.yaml');
}

let _cachedExternalClis: ExternalCliConfig[] | null = null;

export function loadExternalClis(): ExternalCliConfig[] {
  if (_cachedExternalClis) return _cachedExternalClis;
  const configs = new Map<string, ExternalCliConfig>();

  // 1. Load built-in
  const builtinPath = path.resolve(__dirname, 'external-clis.yaml');
  try {
    if (fs.existsSync(builtinPath)) {
      const raw = fs.readFileSync(builtinPath, 'utf8');
      const parsed = (yaml.load(raw) || []) as ExternalCliConfig[];
      for (const item of parsed) configs.set(item.name, item);
    }
  } catch (err) {
    log.warn(`Failed to parse built-in external-clis.yaml: ${getErrorMessage(err)}`);
  }

  // 2. Load user custom
  const userPath = getUserRegistryPath();
  try {
    if (fs.existsSync(userPath)) {
      const raw = fs.readFileSync(userPath, 'utf8');
      const parsed = (yaml.load(raw) || []) as ExternalCliConfig[];
      for (const item of parsed) {
        configs.set(item.name, item); // Overwrite built-in if duplicated
      }
    }
  } catch (err) {
    log.warn(`Failed to parse user external-clis.yaml: ${getErrorMessage(err)}`);
  }

  _cachedExternalClis = Array.from(configs.values()).sort((a, b) => a.name.localeCompare(b.name));
  return _cachedExternalClis;
}

export function isBinaryInstalled(binary: string): boolean {
  try {
    const isWindows = os.platform() === 'win32';
    execFileSync(isWindows ? 'where' : 'which', [binary], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getInstallCmd(installConfig?: ExternalCliInstall): string | null {
  if (!installConfig) return null;
  const platform = os.platform();
  if (platform === 'darwin' && installConfig.mac) return installConfig.mac;
  if (platform === 'linux' && installConfig.linux) return installConfig.linux;
  if (platform === 'win32' && installConfig.windows) return installConfig.windows;
  if (installConfig.default) return installConfig.default;
  return null;
}

/**
 * Safely parses a command string into a binary and argument list.
 * Rejects commands containing shell operators (&&, ||, |, ;, >, <, `) that
 * cannot be safely expressed as execFileSync arguments.
 *
 * Args:
 *   cmd: Raw command string from YAML config (e.g. "brew install gh")
 *
 * Returns:
 *   Object with `binary` and `args` fields, or throws on unsafe input.
 */
export function parseCommand(cmd: string): { binary: string; args: string[] } {
  const shellOperators = /&&|\|\|?|;|[><`$#\n\r]|\$\(/;
  if (shellOperators.test(cmd)) {
    throw new Error(
      `Install command contains unsafe shell operators and cannot be executed securely: "${cmd}". ` +
        `Please install the tool manually.`
    );
  }

  // Tokenise respecting single- and double-quoted segments (no variable expansion).
  const tokens: string[] = [];
  const re = /(?:"([^"]*)")|(?:'([^']*)')|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cmd)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }

  if (tokens.length === 0) {
    throw new Error(`Install command is empty.`);
  }

  const [binary, ...args] = tokens;
  return { binary, args };
}

function shouldRetryWithCmdShim(binary: string, err: unknown): boolean {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  return os.platform() === 'win32' && !path.extname(binary) && code === 'ENOENT';
}

function runInstallCommand(cmd: string): void {
  const { binary, args } = parseCommand(cmd);

  try {
    execFileSync(binary, args, { stdio: 'inherit' });
  } catch (err) {
    if (shouldRetryWithCmdShim(binary, err)) {
      execFileSync(`${binary}.cmd`, args, { stdio: 'inherit' });
      return;
    }
    throw err;
  }
}

export interface InstallOptions {
  version?: string;
  isolated?: boolean;
}

function joinPackageSpecWithVersion(pkgSpec: string, version: string): string {
  if (version === 'latest') return pkgSpec;
  if (pkgSpec.startsWith('@')) {
    const slashIndex = pkgSpec.indexOf('/');
    const versionIndex = pkgSpec.lastIndexOf('@');
    if (slashIndex !== -1 && versionIndex > slashIndex) {
      return `${pkgSpec.slice(0, versionIndex)}@${version}`;
    }
    return `${pkgSpec}@${version}`;
  }
  const versionIndex = pkgSpec.lastIndexOf('@');
  if (versionIndex > 0) {
    return `${pkgSpec.slice(0, versionIndex)}@${version}`;
  }
  return `${pkgSpec}@${version}`;
}

function buildIsolatedInstallCommand(cmd: string, installPath: string, version: string): string {
  const { binary, args } = parseCommand(cmd);

  if (binary === 'npm' && args[0] === 'install') {
    const packageSpecs = args.slice(1).filter(arg => arg !== '-g' && arg !== '--global');
    if (packageSpecs.length !== 1) {
      throw new Error(
        `Isolated installation only supports a single npm package spec. Original command: "${cmd}".`,
      );
    }
    const pkgSpec = joinPackageSpecWithVersion(packageSpecs[0], version);
    return `npm install ${pkgSpec} --prefix "${installPath}"`;
  }

  if (binary === 'yarn') {
    let packageSpecs: string[] = [];
    if (args[0] === 'add') {
      packageSpecs = args.slice(1);
    } else if (args[0] === 'global' && args[1] === 'add') {
      packageSpecs = args.slice(2);
    }

    if (packageSpecs.length > 0) {
      if (packageSpecs.length !== 1) {
        throw new Error(
          `Isolated installation only supports a single yarn package spec. Original command: "${cmd}".`,
        );
      }
      const pkgSpec = joinPackageSpecWithVersion(packageSpecs[0], version);
      return `yarn add ${pkgSpec} --cwd "${installPath}"`;
    }
  }

  throw new Error(
    `Isolated installation is only supported for npm/yarn package installs. ` +
      `Original command: "${cmd}". Please install '${binary}' globally or register a package-manager command.`,
  );
}

export function installExternalCli(cli: ExternalCliConfig, opts: InstallOptions = {}): boolean {
  if (!cli.install) {
    console.error(chalk.red(`No auto-install command configured for '${cli.name}'.`));
    console.error(`Please install '${cli.binary}' manually.`);
    return false;
  }

  const cmd = getInstallCmd(cli.install);
  if (!cmd) {
    console.error(chalk.red(`No install command for your platform (${os.platform()}) for '${cli.name}'.`));
    if (cli.homepage) console.error(`See: ${cli.homepage}`);
    return false;
  }

  if (!opts.isolated) {
    // Global installation - original behavior
    console.log(chalk.cyan(`🔹 '${cli.name}' is not installed. Installing globally...`));
    console.log(chalk.dim(`$ ${cmd}`));
    try {
      runInstallCommand(cmd);
      console.log(chalk.green(`✅ Installed '${cli.name}' successfully.\n`));
      return true;
    } catch (err) {
      console.error(chalk.red(`❌ Failed to install '${cli.name}': ${getErrorMessage(err)}`));
      return false;
    }
  }

  // Isolated installation
  const version = opts.version || 'latest';
  console.log(chalk.cyan(`🔹 '${cli.name}'@${version} - installing in isolated mode...`));

  // Check if already installed
  const existing = externalStore.getInstalledInfo(cli.name);
  if (existing) {
    const hasVersion = existing.versions.some(v => v.version === version);
    if (hasVersion) {
      console.log(chalk.yellow(`⚠️  '${cli.name}'@${version} is already installed. Switching to it...`));
      externalStore.setCurrentVersion(cli.name, version);
      console.log(chalk.green(`✅ Switched to '${cli.name}'@${version}\n`));
      return true;
    }
  }

  // Create isolated directory
  const optRoot = externalStore.getOptRoot();
  const installPath = path.join(optRoot, cli.name, version);
  if (!fs.existsSync(installPath)) {
    fs.mkdirSync(installPath, { recursive: true });
  }

  let installCmd: string;
  try {
    installCmd = buildIsolatedInstallCommand(cmd, installPath, version);
  } catch (err) {
    console.error(chalk.red(`❌ Failed to install '${cli.name}' in isolated mode: ${getErrorMessage(err)}`));
    try { fs.rmSync(installPath, { recursive: true, force: true }); } catch {}
    return false;
  }

  console.log(chalk.dim(`$ ${installCmd}`));
  try {
    runInstallCommand(installCmd);
  } catch (err) {
    console.error(chalk.red(`❌ Failed to install '${cli.name}': ${getErrorMessage(err)}`));
    // Clean up partial installation
    try { fs.rmSync(installPath, { recursive: true, force: true }); } catch {}
    return false;
  }

  // Update lock file
  const installedAt = new Date().toISOString();
  const entry: IsolatedInstallEntry = {
    version,
    installPath,
    installedAt,
    current: true,
  };

  if (existing) {
    // Unmark current on existing
    existing.versions.forEach(v => v.current = false);
    existing.versions.push(entry);
    externalStore.upsertInstallEntry({
      ...existing,
      versions: existing.versions,
    });
  } else {
    externalStore.upsertInstallEntry({
      name: cli.name,
      binaryName: cli.binary,
      installType: 'isolated',
      versions: [entry],
    });
  }

  console.log(chalk.green(`✅ Installed '${cli.name}'@${version} in isolated mode.\n`));
  return true;
}

export function executeExternalCli(name: string, args: string[], preloaded?: ExternalCliConfig[]): void {
  const configs = preloaded ?? loadExternalClis();
  const cli = configs.find((c) => c.name === name);
  if (!cli) {
    throw new Error(`External CLI '${name}' not found in registry.`);
  }

  // Check for isolated installation first
  const installedInfo = externalStore.getInstalledInfo(name);
  let binaryPath = cli.binary;

  if (installedInfo && installedInfo.installType === 'isolated') {
    const currentPath = externalStore.getCurrentBinaryPath(installedInfo);
    if (currentPath) {
      if (fs.existsSync(currentPath) || fs.existsSync(`${currentPath}.cmd`)) {
        binaryPath = currentPath;
      } else {
        console.log(chalk.yellow(`⚠️  Isolated installation not found at ${currentPath}. Falling back to global.`));
      }
    }
  }

  // 1. Check if installed
  const isInstalled = installedInfo?.installType === 'isolated'
    ? fs.existsSync(binaryPath) || fs.existsSync(`${binaryPath}.cmd`)
    : isBinaryInstalled(cli.binary);

  if (!isInstalled) {
    // 2. Try to auto install
    const success = installExternalCli(cli);
    if (!success) {
      process.exitCode = EXIT_CODES.SERVICE_UNAVAIL;
      return;
    }
    // After install, check again for isolated
    const newInfo = externalStore.getInstalledInfo(name);
    if (newInfo?.installType === 'isolated') {
      const newPath = externalStore.getCurrentBinaryPath(newInfo);
      if (newPath) {
        binaryPath = newPath;
      }
    }
  }

  // 3. Passthrough execution with stdio inherited
  const result = spawnSync(binaryPath, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(chalk.red(`Failed to execute '${binaryPath}': ${result.error.message}`));
    process.exitCode = EXIT_CODES.GENERIC_ERROR;
    return;
  }

  if (result.status !== null) {
    process.exitCode = result.status;
  }
}

/**
 * Uninstall an external CLI.
 * If version is specified, only uninstall that version.
 * Otherwise, uninstall all versions.
 */
export function uninstallExternalCli(name: string, version?: string): boolean {
  const installedInfo = externalStore.getInstalledInfo(name);
  if (!installedInfo) {
    console.error(chalk.red(`External CLI '${name}' is not installed in isolated mode.`));
    console.error(chalk.dim(`For globally installed CLI, please uninstall it manually.`));
    return false;
  }

  const optRoot = externalStore.getOptRoot();
  const cliDir = path.join(optRoot, name);

  if (version) {
    // Uninstall only the specified version
    const versionDir = path.join(cliDir, version);
    if (!fs.existsSync(versionDir)) {
      console.error(chalk.red(`Version '${version}' of '${name}' is not installed.`));
      return false;
    }

    try {
      fs.rmSync(versionDir, { recursive: true, force: true });
    } catch (err) {
      console.error(chalk.red(`Failed to delete version directory: ${getErrorMessage(err)}`));
      return false;
    }

    const removed = externalStore.removeVersionEntry(name, version);
    console.log(chalk.green(`✅ Uninstalled '${name}'@${version} successfully.`));
    return removed;
  }

  // Uninstall all versions
  if (fs.existsSync(cliDir)) {
    try {
      fs.rmSync(cliDir, { recursive: true, force: true });
    } catch (err) {
      console.error(chalk.red(`Failed to delete installation directory: ${getErrorMessage(err)}`));
      return false;
    }
  }

  const removed = externalStore.removeInstallEntry(name);
  console.log(chalk.green(`✅ Uninstalled '${name}' completely.`));
  return removed;
}

/**
 * Switch the currently active version.
 */
export function switchExternalCliVersion(name: string, version: string): boolean {
  const installedInfo = externalStore.getInstalledInfo(name);
  if (!installedInfo) {
    console.error(chalk.red(`External CLI '${name}' is not installed in isolated mode.`));
    return false;
  }

  const hasVersion = installedInfo.versions.some(v => v.version === version);
  if (!hasVersion) {
    console.error(chalk.red(`Version '${version}' is not installed for '${name}'.`));
    console.error(chalk.dim(`Installed versions: ${installedInfo.versions.map(v => v.version).join(', ')}`));
    return false;
  }

  const success = externalStore.setCurrentVersion(name, version);
  if (success) {
    console.log(chalk.green(`✅ Switched '${name}' to version ${version}.`));
  }
  return success;
}

export interface RegisterOptions {
  binary?: string;
  install?: string;
  description?: string;
}

export function registerExternalCli(name: string, opts?: RegisterOptions): void {
  const userPath = getUserRegistryPath();
  const configDir = path.dirname(userPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let items: ExternalCliConfig[] = [];
  if (fs.existsSync(userPath)) {
    try {
      const raw = fs.readFileSync(userPath, 'utf8');
      items = (yaml.load(raw) || []) as ExternalCliConfig[];
    } catch {
      // Ignore
    }
  }

  const existingIndex = items.findIndex((c) => c.name === name);
  
  const newItem: ExternalCliConfig = {
    name,
    binary: opts?.binary || name,
  };
  if (opts?.description) newItem.description = opts.description;
  if (opts?.install) newItem.install = { default: opts.install };

  if (existingIndex >= 0) {
    items[existingIndex] = { ...items[existingIndex], ...newItem };
    console.log(chalk.green(`Updated '${name}' in user registry.`));
  } else {
    items.push(newItem);
    console.log(chalk.green(`Registered '${name}' in user registry.`));
  }

  const dump = yaml.dump(items, { indent: 2, sortKeys: true });
  fs.writeFileSync(userPath, dump, 'utf8');
  _cachedExternalClis = null; // Invalidate cache so next load reflects the change
  console.log(chalk.dim(userPath));
}
