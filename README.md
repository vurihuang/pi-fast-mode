# pi-fast-mode

<p align="center">
  <img src="./showcase.png" alt="pi-fast-mode showcase" width="960" />
</p>

`pi-fast-mode` is a pi extension/package that toggles fast mode for selected models by injecting `service_tier` into provider requests.

It follows the same packaging approach as `pi-hodor`:

- normal pi package structure
- bundled default config
- optional global config bootstrap command
- project/global/bundled config resolution
- persistent per-session and per-branch on/off state

## What it does

When fast mode is enabled and the current `provider/model` matches a configured target, the extension patches the outgoing provider payload to include:

```json
{
  "service_tier": "priority"
}
```

This is useful when you want a lightweight toggle in pi without changing your provider or model definitions.

## Features

- `/fast` toggle command
- `/fast on|off|status|reload`
- `Ctrl+Shift+F` keyboard shortcut
- `--fast` CLI flag for starting a session with fast mode enabled
- supports custom provider names and custom model ids
- supports custom `serviceTier` values per target
- remembers the last on/off state when the session is resumed
- restores the saved state when navigating branches with `/tree`
- shows status in the footer while fast mode is active
- supports project-local, global, legacy-global, and bundled config files

## Requirements

- pi with extension support
- Node.js 20+

## Installation

### Install from npm

```bash
pi install npm:pi-fast-mode
```

### Install from git

```bash
pi install git:github.com/vurihuang/pi-fast-mode
```

### Install from a local path

```bash
pi install /absolute/path/to/pi-fast-mode
```

Restart pi after installation so the extension is loaded.

## Quick start

### 1. Bootstrap the global config

```text
/pi-fast-mode:setup
```

This creates:

```text
~/.pi/agent/extensions/pi-fast-mode/config.json
```

if it does not already exist.

### 2. Edit the config

Example:

```json
{
  "targets": [
    {
      "provider": "openai-codex",
      "model": "gpt-5.4",
      "serviceTier": "priority"
    },
    {
      "provider": "my-proxy",
      "model": "gpt-5-4",
      "serviceTier": "priority"
    }
  ]
}
```

### 3. Toggle fast mode

```text
/fast
```

## Usage

### Slash command

```text
/fast
```

### Explicit control

```text
/fast on
/fast off
/fast status
/fast reload
```

### Keyboard shortcut

```text
Ctrl+Shift+F
```

### CLI flag

```bash
pi --fast
```

`--fast` makes the current session start with fast mode enabled, regardless of the previously saved state.

## Configuration

Config is resolved in this order:

1. `./.pi-fast-mode.json`
2. `./.pi/pi-fast-mode.json`
3. `~/.pi/agent/extensions/pi-fast-mode/config.json`
4. legacy fallback: `~/.pi/agent/extensions/fast-mode.json`
5. bundled `config.json`

That means:

- project config overrides global config
- global config overrides the bundled defaults
- the legacy single-file path still works as a compatibility fallback

### Config schema

```json
{
  "targets": [
    {
      "provider": "openai-codex",
      "model": "gpt-5.4",
      "serviceTier": "priority"
    }
  ]
}
```

### Fields

| Field | Type | Description |
| --- | --- | --- |
| `targets` | `FastTarget[]` | Allowlist of provider/model pairs that should receive `service_tier`. |
| `targets[].provider` | `string` | Exact pi provider name. Official and unofficial provider names are both supported. |
| `targets[].model` | `string` | Exact pi model id. Official and unofficial model ids are both supported. |
| `targets[].serviceTier` | `string` | Value written as `service_tier`. Defaults to `priority` when omitted. |

### Matching behavior

Matching is done with exact string equality against:

- `ctx.model.provider`
- `ctx.model.id`

So this works with:

- built-in providers and models
- providers added via `models.json`
- providers registered through other extensions
- unofficial model names

### Example configs

#### Default Codex target

```json
{
  "targets": [
    {
      "provider": "openai-codex",
      "model": "gpt-5.4"
    }
  ]
}
```

#### Multiple custom providers

```json
{
  "targets": [
    {
      "provider": "my-proxy",
      "model": "gpt-5.4",
      "serviceTier": "priority"
    },
    {
      "provider": "openrouter",
      "model": "openai/gpt-5.4",
      "serviceTier": "priority"
    },
    {
      "provider": "local-gateway",
      "model": "gpt-5.4",
      "serviceTier": "priority"
    }
  ]
}
```

## Persistence behavior

Fast mode state is stored in the session as custom entries.

That means:

- if you turn fast mode on, quit pi, and resume the same session, it comes back on
- if you turn it off and resume the same session, it stays off
- if you switch branches with `/tree`, the extension restores the saved state for that branch

This persistence is session-aware and branch-aware.

## Notes and limitations

- The extension only patches request payloads when fast mode is enabled.
- It only patches requests for configured provider/model pairs.
- It does not validate whether a provider actually supports `service_tier`.
- If a provider ignores unknown fields, the request will continue normally.
- `/fast reload` reloads config from disk without restarting pi.

## Development

Install dependencies:

```bash
npm install
```

Run type-check:

```bash
npm run check
```

Run release verification:

```bash
npm run release:check
```

Preview the package contents:

```bash
npm run pack:check
```

## Publishing checklist

Before publishing:

1. update `version` in `package.json`
2. verify `repository`, `homepage`, and `bugs` URLs
3. run `npm run release:check`
4. confirm the tarball only contains intended files
5. publish with npm if desired

## Package structure

```text
.
├── config.json
├── index.ts
├── LICENSE
├── README.md
├── package.json
├── package-lock.json
└── tsconfig.json
```
