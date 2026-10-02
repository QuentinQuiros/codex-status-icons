# Architecture — 1.0.0

The project has three components, all version **1.0.0**:

1. **Windows VS Code UI extension**, TypeScript: workspace identity, technical Codex state, configuration and local IPC client.
2. **Windows companion**, WinForms/.NET 10: one icon per connected window, presentation, notifications, audio, settings and focus.
3. **SSH workspace extension**, TypeScript: technical session and account collection on the remote host. Bundled and installed through VS Code.

## Data flow

Local: session/account providers → UI extension → current-user Named Pipe → Windows companion.

SSH: session/account providers on host → workspace extension → VS Code command response → Windows UI extension → Named Pipe → companion.

The remote component never sends prompts, responses, credentials or audio. The native companion receives typed technical metadata, not session file contents.

## Code map

- `extension/src/codex/`: state providers, bounded JSONL reader, account quota client and SSH response validation.
- `extension/src/workspace.ts`: per-window identity and local/remote roots.
- `extension/src/remote_extension.ts`: remote activation and collection command.
- `extension/src/ipc/`: framed JSONL, reconnect/backoff and stable executable deployment.
- `extension/src/locales/`: shared English and French strings, embedded in the native build.
- `tray/src/Core/`: protocol, window registry, association, icon identities and notification transitions.
- `tray/src/Windows/`: icons, menus, dialogs, focus, notification audio and support diagnostics.
- `shared/protocol/`: IPC contract.
- `scripts/`: build, test, packaging and integration checks.

## Connection and identity

Each VS Code window has a random activation ID. Reconnecting replaces only its previous transport, a late disconnect cannot remove the replacement. Heartbeats run every 10 seconds, the server expires a connection after 35 seconds without one.

An icon is removed on disconnection. With no clients, the process exits after 15 seconds unless a connection returns. Users stop the icons by disabling Codex Status Icons in VS Code, either globally or for the selected workspace.

Windows icon GUIDs derive from workspace roots and a duplicate-window slot. SSH authority and Linux path case are preserved. Label, language, state and software version do not change the GUID. The executable remains at a stable path, deployment uses a lock, SHA-256 verification and temporary-file replacement. A running executable is not overwritten with a fallback path.

## State and account data

The session reader accepts matching VS Code-originated sessions and excludes Desktop, CLI and subagents. Evidence is selected from technical activity and file modification, uncertainty yields `unknown`.

Quota reads use a separate official Codex app-server process over stdio, with initialize/account read/rate-limit read only. One read at a time, 30-second polling, 12-second deadline. A confirmed account block overrides the session. Only bounded numeric periods and technical observations are retained.

SSH commands allow 75 seconds for renderer-mediated background responses. A valid late response can restore state, single-flight requests and selection revisions prevent accumulation or stale association.

## Presentation and settings

The companion uses `Shell_NotifyIconW` with stable GUIDs. Menus remain stable while open. Working duration is drawn from the original task timestamp, quota tooltips omit unavailable or expired periods.

Settings use configuration capability 7 and validated grouped writes. Language, notifications and sound are global. Letter and expiration are workspace-specific. A failed write attempts to restore the previous overrides before reporting failure.

Native banners occur only for confirmed working-to-completed or working-to-quota transitions. Duplicate updates, initial registration, reconnection, cancellation and ambiguous associations do not notify. Audio starts only on Windows' banner-shown callback. Windows sound stays native, embedded/custom audio uses a validated bounded WAV and disables the simultaneous native sound.

Clicking an icon or banner restores and focuses the existing matching window. The request is correlated with its extension, it never creates a new VS Code window. Foreground focus remains subject to Windows rules.

## Trust boundary

Named Pipe access is restricted to the current Windows user, with bounded frames and permitted message fields. The SSH bridge uses the existing connection. No extra network listener or telemetry is added. Another application running as the same Windows user remains inside that local trust boundary.

See [IPC protocol](../shared/protocol/README.md), [Codex integration](CODEX_INTEGRATION.md) and [SSH guide](SSH_SUPPORT.md).
