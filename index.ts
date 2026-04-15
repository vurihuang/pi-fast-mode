import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

type NotifyLevel = "info" | "warning" | "error";
type ActiveModel = ExtensionContext["model"];

type FastModeState = {
	enabled?: boolean;
};

type FastTarget = {
	provider: string;
	model: string;
	serviceTier?: string;
};

type FastModeConfig = {
	targets: FastTarget[];
};

const EXTENSION_NAME = "pi-fast-mode";
const ENTRY_TYPE = "fast-mode";
const STATUS_ID = "fast-mode";
const BUNDLED_CONFIG_PATH = join(__dirname, "config.json");
const GLOBAL_CONFIG_PATH = join(getAgentDir(), "extensions", EXTENSION_NAME, "config.json");
const GLOBAL_STATE_PATH = join(getAgentDir(), "extensions", EXTENSION_NAME, "state.json");
const LEGACY_GLOBAL_CONFIG_PATH = join(getAgentDir(), "extensions", "fast-mode.json");
const PROJECT_CONFIG_CANDIDATES = [
	".pi-fast-mode.json",
	join(".pi", "pi-fast-mode.json"),
] as const;
const DEFAULT_CONFIG: FastModeConfig = {
	targets: [{ provider: "openai-codex", model: "gpt-5.4", serviceTier: "priority" }],
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getModelLabel(model: ActiveModel): string {
	return model ? `${model.provider}/${model.id}` : "no model selected";
}

function normalizeTarget(raw: unknown): FastTarget | undefined {
	if (!isRecord(raw)) return undefined;

	const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
	const model = typeof raw.model === "string" ? raw.model.trim() : "";
	const serviceTier =
		typeof raw.serviceTier === "string"
			? raw.serviceTier.trim()
			: typeof raw.service_tier === "string"
				? raw.service_tier.trim()
				: "";

	if (!provider || !model) return undefined;
	return {
		provider,
		model,
		...(serviceTier ? { serviceTier } : {}),
	};
}

function normalizeConfig(raw: unknown): FastModeConfig {
	if (!isRecord(raw) || !Array.isArray(raw.targets)) {
		return { targets: [...DEFAULT_CONFIG.targets] };
	}

	const targets = raw.targets
		.map((target) => normalizeTarget(target))
		.filter((target): target is FastTarget => target !== undefined);

	return { targets };
}

function dedupeTargets(targets: FastTarget[]): FastTarget[] {
	const byKey = new Map<string, FastTarget>();
	for (const target of targets) {
		byKey.set(`${target.provider}/${target.model}`, target);
	}
	return [...byKey.values()];
}

function getMatchingTarget(model: ActiveModel, targets: FastTarget[]): FastTarget | undefined {
	if (!model) return undefined;
	return targets.find((target) => target.provider === model.provider && target.model === model.id);
}

function getSavedStateFromBranch(ctx: ExtensionContext): boolean | undefined {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE || !isRecord(entry.data)) continue;
		const enabled = (entry.data as FastModeState).enabled;
		if (typeof enabled === "boolean") return enabled;
	}
	return undefined;
}

function safeNotify(ctx: ExtensionContext, message: string, level: NotifyLevel): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify(message, level);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function ensureBundledConfigFile(): Promise<void> {
	try {
		await access(BUNDLED_CONFIG_PATH);
	} catch {
		await writeFile(BUNDLED_CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
	}
}

async function resolveConfigPath(cwd: string): Promise<string> {
	for (const relativePath of PROJECT_CONFIG_CANDIDATES) {
		const candidatePath = join(cwd, relativePath);
		if (await pathExists(candidatePath)) return candidatePath;
	}

	if (await pathExists(GLOBAL_CONFIG_PATH)) return GLOBAL_CONFIG_PATH;
	if (await pathExists(LEGACY_GLOBAL_CONFIG_PATH)) return LEGACY_GLOBAL_CONFIG_PATH;
	return BUNDLED_CONFIG_PATH;
}

async function copyBundledConfig(destinationPath: string): Promise<void> {
	await ensureBundledConfigFile();
	await mkdir(dirname(destinationPath), { recursive: true });
	await copyFile(BUNDLED_CONFIG_PATH, destinationPath);
}

export default function fastModeExtension(pi: ExtensionAPI): void {
	let fastModeEnabled = false;
	let currentModel: ActiveModel;
	let configuredTargets: FastTarget[] = [...DEFAULT_CONFIG.targets];
	let resolvedConfigPath = BUNDLED_CONFIG_PATH;
	const lastConfigError: { value?: string } = {};
	const lastStateError: { value?: string } = {};

	function activeModel(ctx?: ExtensionContext): ActiveModel {
		return currentModel ?? ctx?.model;
	}

	function configuredTargetsText(): string {
		return configuredTargets.length > 0
			? configuredTargets.map((target) => `${target.provider}/${target.model}`).join(", ")
			: "none";
	}

	function notifyStateError(ctx: ExtensionContext | undefined, action: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		const errorKey = `${action}:${message}`;
		if (lastStateError.value === errorKey) return;
		lastStateError.value = errorKey;
		if (!ctx) return;
		safeNotify(ctx, `[${EXTENSION_NAME}] Failed to ${action} fast-mode state at ${GLOBAL_STATE_PATH}: ${message}`, "warning");
	}

	async function readGlobalEnabledState(ctx?: ExtensionContext): Promise<boolean | undefined> {
		try {
			if (!(await pathExists(GLOBAL_STATE_PATH))) {
				lastStateError.value = undefined;
				return undefined;
			}

			const raw = JSON.parse(await readFile(GLOBAL_STATE_PATH, "utf8"));
			const enabled = isRecord(raw) ? raw.enabled : undefined;
			lastStateError.value = undefined;
			return typeof enabled === "boolean" ? enabled : undefined;
		} catch (error) {
			notifyStateError(ctx, "read persisted", error);
			return undefined;
		}
	}

	async function persistGlobalEnabledState(enabled: boolean, ctx?: ExtensionContext): Promise<void> {
		try {
			await mkdir(dirname(GLOBAL_STATE_PATH), { recursive: true });
			await writeFile(GLOBAL_STATE_PATH, `${JSON.stringify({ enabled }, null, 2)}\n`, "utf8");
			lastStateError.value = undefined;
		} catch (error) {
			notifyStateError(ctx, "write persisted", error);
		}
	}

	async function refreshConfig(cwd: string, ctx?: ExtensionContext): Promise<void> {
		await ensureBundledConfigFile();
		const configPath = await resolveConfigPath(cwd);
		resolvedConfigPath = configPath;

		try {
			const parsed = normalizeConfig(JSON.parse(await readFile(configPath, "utf8")));
			configuredTargets = dedupeTargets(parsed.targets);
			lastConfigError.value = undefined;
		} catch (error) {
			configuredTargets = [...DEFAULT_CONFIG.targets];
			const message = error instanceof Error ? error.message : String(error);
			const errorKey = `${configPath}:${message}`;
			if (lastConfigError.value !== errorKey) {
				lastConfigError.value = errorKey;
				if (ctx) {
					safeNotify(
						ctx,
						`[${EXTENSION_NAME}] Failed to read config from ${configPath}. Falling back to bundled defaults: ${message}`,
						"warning",
					);
				}
			}
		}
	}

	function statusText(ctx?: ExtensionContext): string {
		const model = activeModel(ctx);
		if (!fastModeEnabled) {
			return `Fast mode is OFF. Config: ${resolvedConfigPath}`;
		}

		const target = getMatchingTarget(model, configuredTargets);
		if (target) {
			return `Fast mode is ON for ${getModelLabel(model)} (service_tier=${target.serviceTier ?? "priority"}). Config: ${resolvedConfigPath}`;
		}

		if (configuredTargets.length === 0) {
			return `Fast mode is ON, but no targets are configured in ${resolvedConfigPath}.`;
		}

		return `Fast mode is ON, but ${getModelLabel(model)} is not enabled in ${resolvedConfigPath}. Enabled targets: ${configuredTargetsText()}.`;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!fastModeEnabled) {
			ctx.ui.setStatus(STATUS_ID, undefined);
			return;
		}

		const target = getMatchingTarget(activeModel(ctx), configuredTargets);
		if (target) {
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", "⚡ fast"));
			return;
		}

		ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("warning", "⚡ fast*"));
	}

	function persistState(): void {
		pi.appendEntry<FastModeState>(ENTRY_TYPE, { enabled: fastModeEnabled });
	}

	function notifyState(ctx: ExtensionContext): void {
		safeNotify(
			ctx,
			statusText(ctx),
			fastModeEnabled && !getMatchingTarget(activeModel(ctx), configuredTargets) ? "warning" : "info",
		);
	}

	async function applyEnabledState(
		enabled: boolean,
		ctx: ExtensionContext,
		options?: { notify?: boolean; persist?: boolean; persistGlobal?: boolean },
	): Promise<void> {
		fastModeEnabled = enabled;
		if (options?.persist !== false) persistState();
		if (options?.persistGlobal !== false) await persistGlobalEnabledState(enabled, ctx);
		updateStatus(ctx);
		if (options?.notify !== false) notifyState(ctx);
	}

	async function restoreEnabledState(
		ctx: ExtensionContext,
		options?: { fallback?: boolean; preserveCurrentIfMissing?: boolean },
	): Promise<void> {
		const savedState = getSavedStateFromBranch(ctx);
		const globalState = await readGlobalEnabledState(ctx);
		if (typeof savedState === "boolean") {
			await applyEnabledState(savedState, ctx, { notify: false, persist: false, persistGlobal: false });
			if (typeof globalState !== "boolean") {
				await persistGlobalEnabledState(savedState, ctx);
			}
			return;
		}

		if (typeof globalState === "boolean") {
			await applyEnabledState(globalState, ctx, { notify: false, persist: false, persistGlobal: false });
			return;
		}

		if (!options?.preserveCurrentIfMissing && typeof options?.fallback === "boolean") {
			await applyEnabledState(options.fallback, ctx, { notify: false, persist: false, persistGlobal: false });
			return;
		}

		updateStatus(ctx);
	}

	async function toggleFastMode(ctx: ExtensionContext): Promise<void> {
		await applyEnabledState(!fastModeEnabled, ctx);
	}

	pi.registerFlag("fast", {
		description: `Start with fast mode enabled. Targets are loaded from project config, ${GLOBAL_CONFIG_PATH}, or the bundled config.`,
		type: "boolean",
		default: false,
	});

	pi.registerCommand("pi-fast-mode:setup", {
		description: `Copy the default ${EXTENSION_NAME} config to ${GLOBAL_CONFIG_PATH}`,
		handler: async (_args, ctx) => {
			if (await pathExists(GLOBAL_CONFIG_PATH)) {
				safeNotify(ctx, `[${EXTENSION_NAME}] Config already exists at ${GLOBAL_CONFIG_PATH}`, "warning");
				return;
			}

			await copyBundledConfig(GLOBAL_CONFIG_PATH);
			safeNotify(ctx, `[${EXTENSION_NAME}] Config copied to ${GLOBAL_CONFIG_PATH}`, "info");
		},
	});

	pi.registerCommand("fast", {
		description: "Toggle fast mode. Usage: /fast [on|off|status|reload]",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			switch (action) {
				case "":
				case "toggle":
					await toggleFastMode(ctx);
					return;
				case "on":
				case "enable":
					if (fastModeEnabled) {
						notifyState(ctx);
						return;
					}
					await applyEnabledState(true, ctx);
					return;
				case "off":
				case "disable":
					if (!fastModeEnabled) {
						notifyState(ctx);
						return;
					}
					await applyEnabledState(false, ctx);
					return;
				case "status":
					notifyState(ctx);
					return;
				case "reload":
					await refreshConfig(ctx.cwd, ctx);
					updateStatus(ctx);
					safeNotify(
						ctx,
						`[${EXTENSION_NAME}] Reloaded targets from ${resolvedConfigPath}. Enabled targets: ${configuredTargetsText()}.`,
						"info",
					);
					return;
				default:
					safeNotify(ctx, "Usage: /fast [on|off|status|reload]", "warning");
			}
		},
	});

	pi.registerShortcut(Key.ctrlShift("f"), {
		description: "Toggle fast mode",
		handler: async (ctx) => {
			await toggleFastMode(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		currentModel = ctx.model;
		await refreshConfig(ctx.cwd, ctx);

		if (pi.getFlag("fast") === true) {
			await applyEnabledState(true, ctx, { notify: false, persist: false });
			return;
		}

		await restoreEnabledState(ctx, { fallback: false, preserveCurrentIfMissing: false });
	});

	pi.on("session_tree", async (_event, ctx) => {
		await restoreEnabledState(ctx, { preserveCurrentIfMissing: true });
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (getSavedStateFromBranch(ctx) !== fastModeEnabled) {
			persistState();
		}
		await persistGlobalEnabledState(fastModeEnabled, ctx);
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_ID, undefined);
	});

	pi.on("model_select", async (event, ctx) => {
		currentModel = event.model;
		updateStatus(ctx);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!fastModeEnabled) return;
		const target = getMatchingTarget(activeModel(ctx), configuredTargets);
		if (!target) return;
		if (!isRecord(event.payload)) return;
		if (typeof event.payload.model !== "string") return;

		const serviceTier = target.serviceTier ?? "priority";
		if (event.payload.service_tier === serviceTier) return;
		return {
			...event.payload,
			service_tier: serviceTier,
		};
	});
}
