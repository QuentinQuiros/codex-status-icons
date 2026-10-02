# Local IPC protocol — application 1.0.0

The transport protocol is **version 1**, independently of the application version. UTF-8 JSONL frames are limited to **16,384 bytes**.

Pipe: `\\.\pipe\codex_status_v1_<sha256(lowercase username)[0:20]>`. The native server restricts access with `PipeOptions.CurrentUserOnly`. There is no TCP listener or OpenAI token in this protocol. A per-user mutex ensures one companion instance, simultaneous desktop login sessions for one Windows user are outside the supported scope.

## Lifecycle

After connecting, the client sends `hello` within 5 seconds. `hello`, `update` and `heartbeat` carry a complete permitted workspace/snapshot/settings observation. Heartbeats run every 10 seconds, the server expires a transport after 35 seconds without one, using its own clock.

A connection cannot change workspace ID. A replacement transport for the same ID supersedes the old one, a delayed disconnect cannot remove the replacement. Unplanned breaks reconnect with backoff/jitter from 0.5 to 15 seconds.

States are `idle`, `working`, `rate_limited`, `unknown`. Workspace identity contains a window ID, name, roots and letter. Local Windows roots compare without case, remote roots preserve case and SSH authority. Shared roots without a distinct explicit session association can be ambiguous.

Server messages include `welcome`, `association`, `focus`, `shutdown`, `diagnostics`, `configure` and `configure_settings`. Client replies use correlated `request_id` and `workspace_id`, only the requesting window's current transport may acknowledge.

## Settings

Current clients advertise `settings.configuration_version=7`. Grouped `configure_settings.changes` contains at most six permitted modified values:

| Field | Validation / scope |
| --- | --- |
| `language` | `auto`, `fr`, `en`, global. |
| `stale_working_minutes` | 5–1440, workspace. |
| `workspace_label` | Empty or one Unicode letter/digit, workspace. |
| `notifications_enabled` | Boolean, global. |
| `notification_sound` | `chatgpt`, `windows`, `silent`, `custom`, global. |
| `notification_sound_file` | Empty or absolute local Windows WAV path, at most 2048 characters without controls, global. |

All changes validate before writes. The extension saves exact prior overrides and attempts restoration after failure, then returns `configuration_result`. The settings dialog closes only after success. The older single-field `configure` message permits only session expiration.

Compatibility clients continue displaying icons but cannot change unsupported new settings. The technical `exit_grace_seconds` field is validated but ignored, the effective process exit delay is fixed to 15 seconds. `welcome` returns resolved interface language. Technical state/reason/ID values are not translated.

## Quota and diagnostics

Optional quota metadata contains `checked_at` and up to two `windows`:

- `remaining_percent`: finite 0–100.
- `window_minutes`: finite positive duration.
- `resets_at`: Unix timestamp in seconds.

Permitted numeric data is copied, undeclared properties are ignored. Omission clears earlier data. The companion hides periods older than 150 seconds, future-dated, expired or disconnected.

Diagnostics expose component versions, state/reason, label, icon style/size/GUID, known HWND, current settings and notification request count. Custom audio paths, prompts, responses and credentials are excluded.

A focus request must be acknowledged by the selected window, a Win32 call alone does not prove success. Clicking does not launch another window. `shutdown:user_exit` suspends relaunch for current clients until Restart or a new window.
