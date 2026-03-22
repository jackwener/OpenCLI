/**
 * CLI discovery: finds YAML/TS CLI definitions and registers them.
 *
 * Supports two modes:
 * 1. FAST PATH (manifest): If a pre-compiled cli-manifest.json exists,
 *    registers all YAML commands instantly without runtime YAML parsing.
 *    TS modules are loaded lazily only when their command is executed.
 * 2. FALLBACK (filesystem scan): Traditional runtime discovery for development.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import type { ManifestEntry } from "./build-manifest.js";
import { log } from "./logger.js";
import {
	type Arg,
	type CliCommand,
	type InternalCliCommand,
	registerCommand,
	Strategy,
} from "./registry.js";

/** Plugins directory: ~/.opencli/plugins/ */
export const PLUGINS_DIR = path.join(os.homedir(), ".opencli", "plugins");
const CLI_MODULE_PATTERN = /\bcli\s*\(/;

interface YamlArgDefinition {
	type?: string;
	default?: unknown;
	required?: boolean;
	positional?: boolean;
	description?: string;
	help?: string;
	choices?: string[];
}

interface YamlCliDefinition {
	site?: string;
	name?: string;
	description?: string;
	domain?: string;
	strategy?: string;
	browser?: boolean;
	args?: Record<string, YamlArgDefinition>;
	columns?: string[];
	pipeline?: Record<string, unknown>[];
	timeout?: number;
	navigateBefore?: boolean | string;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseStrategy(
	rawStrategy: string | undefined,
	fallback: Strategy = Strategy.COOKIE,
): Strategy {
	if (!rawStrategy) return fallback;
	const key = rawStrategy.toUpperCase() as keyof typeof Strategy;
	return Strategy[key] ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Discover and register CLI commands.
 * Uses pre-compiled manifest when available for instant startup.
 */
export async function discoverClis(...dirs: string[]): Promise<void> {
	// Fast path: try manifest first (production / post-build)
	for (const dir of dirs) {
		const manifestPath = path.resolve(dir, "..", "cli-manifest.json");
		try {
			await fs.promises.access(manifestPath);
			await loadFromManifest(manifestPath, dir);
		} catch {
			// Fallback: runtime filesystem scan (development)
			await discoverClisFromFs(dir);
		}
	}
}

/**
 * Fast-path: register commands from pre-compiled manifest.
 * YAML pipelines are inlined — zero YAML parsing at runtime.
 * TS modules are deferred — loaded lazily on first execution.
 */
async function loadFromManifest(
	manifestPath: string,
	clisDir: string,
): Promise<void> {
	try {
		const raw = await fs.promises.readFile(manifestPath, "utf-8");
		const manifest = JSON.parse(raw) as ManifestEntry[];
		for (const entry of manifest) {
			if (entry.type === "yaml") {
				// YAML pipelines fully inlined in manifest — register directly
				const strategy = parseStrategy(entry.strategy);
				const cmd: CliCommand = {
					site: entry.site,
					name: entry.name,
					description: entry.description ?? "",
					domain: entry.domain,
					strategy,
					browser: entry.browser,
					args: entry.args ?? [],
					columns: entry.columns,
					pipeline: entry.pipeline,
					timeoutSeconds: entry.timeout,
					source: `manifest:${entry.site}/${entry.name}`,
					navigateBefore: entry.navigateBefore,
				};
				registerCommand(cmd);
			} else if (entry.type === "ts" && entry.modulePath) {
				// TS adapters: register a lightweight stub.
				// The actual module is loaded lazily on first executeCommand().
				const strategy = parseStrategy(entry.strategy ?? "cookie");
				const modulePath = path.resolve(clisDir, entry.modulePath);
				const cmd: InternalCliCommand = {
					site: entry.site,
					name: entry.name,
					description: entry.description ?? "",
					domain: entry.domain,
					strategy,
					browser: entry.browser ?? true,
					args: entry.args ?? [],
					columns: entry.columns,
					timeoutSeconds: entry.timeout,
					source: modulePath,
					navigateBefore: entry.navigateBefore,
					_lazy: true,
					_modulePath: modulePath,
				};
				registerCommand(cmd);
			}
		}
	} catch (err) {
		log.warn(
			`Failed to load manifest ${manifestPath}: ${getErrorMessage(err)}`,
		);
	}
}

/**
 * Fallback: traditional filesystem scan (used during development with tsx).
 */
async function discoverClisFromFs(dir: string): Promise<void> {
	try {
		await fs.promises.access(dir);
	} catch {
		return;
	}
	const promises: Promise<unknown>[] = [];
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const site = entry.name;
		const siteDir = path.join(dir, site);
		const files = await fs.promises.readdir(siteDir);
		for (const file of files) {
			const filePath = path.join(siteDir, file);
			if (file.endsWith(".yaml") || file.endsWith(".yml")) {
				promises.push(registerYamlCli(filePath, site));
			} else if (
				(file.endsWith(".js") && !file.endsWith(".d.js")) ||
				(file.endsWith(".ts") &&
					!file.endsWith(".d.ts") &&
					!file.endsWith(".test.ts"))
			) {
				if (!(await isCliModule(filePath))) continue;
				promises.push(
					import(`file://${filePath}`).catch((err) => {
						log.warn(
							`Failed to load module ${filePath}: ${getErrorMessage(err)}`,
						);
					}),
				);
			}
		}
	}
	await Promise.all(promises);
}

async function registerYamlCli(
	filePath: string,
	defaultSite: string,
): Promise<void> {
	try {
		const raw = await fs.promises.readFile(filePath, "utf-8");
		const def = yaml.load(raw) as YamlCliDefinition | null;
		if (!isRecord(def)) return;
		const cliDef = def as YamlCliDefinition;

		const site = cliDef.site ?? defaultSite;
		const name = cliDef.name ?? path.basename(filePath, path.extname(filePath));
		const strategyStr =
			cliDef.strategy ?? (cliDef.browser === false ? "public" : "cookie");
		const strategy = parseStrategy(strategyStr);
		const browser = cliDef.browser ?? strategy !== Strategy.PUBLIC;

		const args: Arg[] = [];
		if (cliDef.args && typeof cliDef.args === "object") {
			for (const [argName, argDef] of Object.entries(cliDef.args)) {
				args.push({
					name: argName,
					type: argDef?.type ?? "str",
					default: argDef?.default,
					required: argDef?.required ?? false,
					positional: argDef?.positional ?? false,
					help: argDef?.description ?? argDef?.help ?? "",
					choices: argDef?.choices,
				});
			}
		}

		const cmd: CliCommand = {
			site,
			name,
			description: cliDef.description ?? "",
			domain: cliDef.domain,
			strategy,
			browser,
			args,
			columns: cliDef.columns,
			pipeline: cliDef.pipeline,
			timeoutSeconds: cliDef.timeout,
			source: filePath,
			navigateBefore: cliDef.navigateBefore,
		};

		registerCommand(cmd);
	} catch (err) {
		log.warn(`Failed to load ${filePath}: ${getErrorMessage(err)}`);
	}
}

/**
 * Discover and register plugins from ~/.opencli/plugins/.
 * Each subdirectory is treated as a plugin (site = directory name).
 * Files inside are scanned flat (no nested site subdirs).
 */
export async function discoverPlugins(): Promise<void> {
	try {
		await fs.promises.access(PLUGINS_DIR);
	} catch {
		return;
	}
	const entries = await fs.promises.readdir(PLUGINS_DIR, {
		withFileTypes: true,
	});
	for (const entry of entries) {
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		await discoverPluginDir(path.join(PLUGINS_DIR, entry.name), entry.name);
	}
}

/**
 * Flat scan: read yaml/ts files directly in a plugin directory.
 * Unlike discoverClisFromFs, this does NOT expect nested site subdirectories.
 */
async function discoverPluginDir(dir: string, site: string): Promise<void> {
	const files = await fs.promises.readdir(dir);
	const fileSet = new Set(files);
	const promises: Promise<unknown>[] = [];
	for (const file of files) {
		const filePath = path.join(dir, file);
		if (file.endsWith(".yaml") || file.endsWith(".yml")) {
			promises.push(registerYamlCli(filePath, site));
		} else if (file.endsWith(".js") && !file.endsWith(".d.js")) {
			if (!(await isCliModule(filePath))) continue;
			promises.push(
				import(`file://${filePath}`).catch((err) => {
					log.warn(`Plugin ${site}/${file}: ${getErrorMessage(err)}`);
				}),
			);
		} else if (
			file.endsWith(".ts") &&
			!file.endsWith(".d.ts") &&
			!file.endsWith(".test.ts")
		) {
			// Skip .ts if a compiled .js sibling exists (production mode can't load .ts)
			const jsFile = file.replace(/\.ts$/, ".js");
			if (fileSet.has(jsFile)) continue;
			if (!(await isCliModule(filePath))) continue;
			promises.push(
				import(`file://${filePath}`).catch((err) => {
					log.warn(`Plugin ${site}/${file}: ${getErrorMessage(err)}`);
				}),
			);
		}
	}
	await Promise.all(promises);
}

async function isCliModule(filePath: string): Promise<boolean> {
	try {
		const source = await fs.promises.readFile(filePath, "utf-8");
		return CLI_MODULE_PATTERN.test(source);
	} catch (err) {
		log.warn(`Failed to inspect module ${filePath}: ${getErrorMessage(err)}`);
		return false;
	}
}
