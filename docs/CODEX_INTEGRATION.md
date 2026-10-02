# Codex integration — 1.0.0

## Session state

The official Codex extension does not expose a public event subscription API that this project can attach to. Codex Status Icons therefore reads technical JSONL session evidence from the machine where Codex runs.

The default directory is `CODEX_HOME/sessions`, otherwise `~/.codex/sessions`. Reads are bounded and retain technical metadata/events only. Matching checks workspace roots and VS Code origin, Desktop, CLI and subagent sessions are excluded.

Task-start and task-completion evidence drive working/idle. Structured quota errors can establish a blocked state. Unrecognized or stale evidence remains unknown. Conversation text is never searched for success or quota messages. The reader depends on Codex's internal format and file flushes.

For ambiguous windows, an explicit technical session selection can be pinned until reload. Merely opening a conversation does not constitute new activity.

## Account limits

An independent stdio client starts the official Codex binary bundled with the OpenAI extension. It initializes the app-server, reads account type and limits, then closes. It does not create a thread or turn.

The official binary manages its existing login and any authenticated service request. Codex Status Icons does not open authentication files or retain account credentials.

Polling runs at startup and every 30 seconds, one read at a time, bounded to 12 seconds. Purchased or unlimited usable credits are taken into account. A confirmed block overrides session state, an unavailable account check does not invent a block.

The tooltip stores at most two validated periods with remaining percentage, duration and reset timestamp. Old, expired, future-dated or disconnected data is omitted.

Account checks target ChatGPT accounts with the default session store. API-key accounts, custom account stores and WSL are not arbitrarily assigned the Windows account's quota.

## Limitations

- Approvals and requests for user intervention are not exposed as a status.
- Session evidence can lag behind the official interface.
- Minimized SSH windows may delay delivery by about a minute.
- An account becoming available restores the session state, which can still be unknown.
- Task notifications require a confirmed working transition, they are not replayed from old history.
