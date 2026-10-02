# Manual acceptance checks — 1.0.0

Automated tests cover protocol validation, state transitions, association, localization, settings, quota data, audio and the packaged companion. These checks cover interaction with Windows and VS Code.

## Installation and windows

- Install the release VSIX on Windows x64 without a separate .NET runtime.
- Open two local windows, then two Linux Remote SSH hosts, each has its own letter.
- Check extension, companion and SSH versions are 1.0.0 after reload.
- Close a window, only its icon disappears. Reopen it, its Windows visibility choice persists.
- Left-click a minimized window's icon, the existing window returns without creating another.

## Status and quotas

- A normal task becomes orange, the tooltip shows growing elapsed time, completion becomes green.
- A confirmed account block becomes red. Unknown or expired session data remains grey with a translated reason.
- A minimized SSH window keeps state while a command response is pending, later delivery restores a valid result.
- Quota periods show remaining percentages in brackets, absent/expired/disconnected data has no quota line.
- Account availability after a block resumes the session state. Validate this with a real quota renewal when possible.

## Settings and appearance

- Switch French/English/Automatic, reopen both dialogs and inspect menu, tooltip, validation and notification labels.
- General, Notifications and Icons tabs preserve unsaved values when switching. Cancel discards them.
- Save a custom expiration such as 600, reopen and verify it appears selected.
- Set a letter, clear it to restore automatic. Confirm other workspaces' letters are unchanged.
- Choose all three styles and sizes, verify persistence and readability.
- Check Settings and Help widths, buttons and scrolling at the screen's actual DPI.
- Open Windows taskbar settings and toggle each matching Codex Status Icons entry.

## Notifications and sound

- Working → confirmed completion and working → blocked quota notify once.
- Startup, reconnect, cancellation and grey updates do not announce success.
- Click a banner to return to its window.
- Test ChatGPT, Windows, Silent and a valid custom PCM WAV before saving.
- A suppressed banner does not play embedded/custom audio, nor does one notification play two sounds.
- Notification enable and sound changes apply to local and SSH windows.
- A moved custom WAV reports a validation problem when tested rather than falling back to an unrelated beep.

## Diagnostics

Copy support diagnostics from Help and compare the three component versions and selected workspace. No prompt, response, credential or personal custom-audio path should appear. Project names and paths are expected technical data and can be reviewed before sharing.
