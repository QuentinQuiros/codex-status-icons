# Configuration — 1.0.0

[English](#english) · [Français](#français)

## English

Use an icon's **Settings** dialog for the usual options. Language, notifications and sound apply to every window. Letter and expiration apply to the selected workspace, globally if there is no folder. Style and size are shared native preferences, available from the right-click menu.

Advanced settings are available in VS Code by searching for **Codex Status**:

| Key | Default | Description |
| --- | --- | --- |
| `codex_status.enabled` | `true` | Enable this window's icon. |
| `codex_status.workspace_label` | Empty | Automatic initial, or a custom letter/digit. |
| `codex_status.show_working_duration` | `true` | Show elapsed working time. |
| `codex_status.start_tray_automatically` | `true` | Start the companion automatically. |
| `codex_status.exit_when_no_windows` | `true` | Exit after all tracked windows disconnect. |
| `codex_status.language` | `auto` | Shared language: `auto`, `fr`, `en`. |
| `codex_status.notifications_enabled` | `true` | Shared completion and quota notifications. |
| `codex_status.notification_sound` | `chatgpt` | Shared sound: `chatgpt`, `windows`, `silent`, `custom`. |
| `codex_status.notification_sound_file` | Empty | Absolute local path for custom PCM WAV. |
| `codex_status.stale_working_minutes` | `60` | Workspace session expiration, 5–1440 minutes. |
| `codex_status.sessions_directory` | Empty | Local `CODEX_HOME/sessions` or `~/.codex/sessions`. |
| `codex_status.remote_sessions_directory` | Empty | Equivalent session directory on the SSH host. |
| `codex_status.log_level` | `off` | `off`, `error` or `debug`, technical metadata only. |

The native companion keeps appearance preferences in `%LOCALAPPDATA%/codex-status/appearance.json`. Its fixed executable is `%LOCALAPPDATA%/codex-status/bin/stable/Codex Status Icons.exe`. Windows owns taskbar visibility preferences.

A window's icon is removed immediately when it disconnects. The fixed 15-second process shutdown delay is internal and does not keep that icon visible.

## Français

Utilisez la boîte **Paramètres** de l'icône pour les options habituelles. Langue, notifications et son concernent toutes les fenêtres. Lettre et expiration concernent le workspace sélectionné, globalement sans dossier. Style et taille sont des préférences natives communes, accessibles depuis le clic droit.

Les clés ci-dessus sont aussi disponibles dans les paramètres VS Code, en recherchant **Codex Status**. `stale_working_minutes` désigne l'expiration de l'état d'une session, sans nouvelle activité Codex. Il ne règle pas la connexion SSH ni les vérifications de quota, qui continuent indépendamment.

Le compagnon enregistre l'apparence dans `%LOCALAPPDATA%/codex-status/appearance.json`. Son exécutable conserve le chemin `%LOCALAPPDATA%/codex-status/bin/stable/Codex Status Icons.exe`. Windows gère les préférences de visibilité près de l'horloge.

Une icône est retirée immédiatement quand sa fenêtre se déconnecte. Le délai interne fixe de 15 secondes concerne uniquement l'arrêt du processus et ne maintient pas l'icône visible.
