# Codex Status Icons

[Français](README.fr.md) · **English** · **Version 1.0.0**

Follow Codex across your VS Code windows from the Windows notification area. Each local or SSH window gets its own icon, with a project letter, a status colour and the working duration. Click an icon to return to its existing VS Code window.

Codex Status Icons is an independent community project, with no official affiliation with OpenAI or Microsoft. The Windows companion, VS Code extension and SSH component are all version **1.0.0**.

![The three icon styles](icons/styles-preview.png)

## Installation

Requirements: **Windows x64**, **VS Code 1.96 or newer**, and the official **OpenAI Codex extension** (`openai.chatgpt`) installed where Codex runs, with its account already connected.

1. Download **[codex-status-1.0.0.vsix](https://github.com/QuentinQuiros/codex-status-icons/releases/download/v1.0.0/codex-status-1.0.0.vsix)** from the [1.0.0 release](https://github.com/QuentinQuiros/codex-status-icons/releases/tag/v1.0.0). The source ZIP is for development.
2. In VS Code, open Extensions with **Ctrl+Shift+X**, then **… → Install from VSIX…** and select that file. You can also use **Ctrl+Shift+P → Extensions: Install from VSIX…**.
3. Reload existing windows when requested, using **Ctrl+Shift+P → Developer: Reload Window**.
4. Look for your project letter near the Windows clock, or in the hidden icon menu **^**. The Windows companion starts automatically.

Optional command-line installation:

```powershell
code --install-extension .\codex-status-1.0.0.vsix
```

No administrator rights, separate Node.js installation or .NET runtime are required to use the VSIX. The extension is installed once on your PC and works in new VS Code windows automatically.

### SSH

Install the main VSIX **locally on Windows**, then open your Remote SSH workspace. Its bundled **SSH component 1.0.0** is installed automatically on the host, once per host. It uses VS Code Server and the official Codex binary already present there. Neither Python nor .NET is required on the server.

Reload existing SSH windows after an update. If diagnostics show `remote_bridge_reload_required`, reload once more to replace the bridge already loaded in memory. The separately downloadable remote VSIX is optional, the main package already includes it.

Minimized SSH windows can delay VS Code command delivery. The icon waits up to 75 seconds for a response and keeps the last confirmed state during that wait. Changes and notifications may therefore arrive about a minute later. An explicit connection error makes the state unknown. [SSH guide](docs/SSH_SUPPORT.md).

## Colours and quotas

| Colour | Meaning |
| --- | --- |
| Green | Codex is available. |
| Orange | Codex is working. |
| Red | Codex has exhausted the quota. |
| Grey | Codex's current state cannot be confirmed. |

Green requires recent session evidence. Opening an old conversation alone does not establish availability. Technical session activity expires after **60 minutes** by default, this duration is configurable per workspace.

A confirmed account block takes precedence over the session. Quotas are checked at startup and every **30 seconds**, on the machine where Codex runs. Usable purchased or unlimited credits prevent a red icon based only on a 100% usage figure. When the account becomes available again, the icon returns to the session's current state.

Hover over an icon to see its project, status, working duration and available quota periods, for example **[5h : 72% | 7d : 84%]**. Percentages are **remaining quota**, rounded down, with each period independent. The quota line is omitted when data is missing, stale, expired or disconnected. It is never estimated from conversation text.

## Notifications and sounds

Windows notifications are enabled by default for a confirmed task completion (**orange → green**) or a quota interruption (**orange → red**). Click a notification to return to the corresponding VS Code window. Startup, reconnection, manual cancellation and unknown states do not generate completion notifications. Windows controls whether banners are displayed, including Do not disturb.

**Settings → Notifications** offers four sounds:

- **ChatGPT**: the bundled notification sound, selected by default.
- **Windows sound**: the Windows notification sound.
- **Silent**: a banner without sound.
- **Custom sound**: a local PCM WAV file, 8 or 16 bits, mono or stereo, up to 30 seconds and 5 MB.

Notification activation and sound apply to **all local and SSH windows**. **Test notification** previews your selection before saving. A custom file stays at its original location, moving or deleting it prevents its sound from playing. Sounds play only when Windows reports that the banner is shown.

## Settings and appearance

Right-click an icon to open **Settings**, **Help / About**, the style or size menu.

**Settings** has three tabs:

| Tab | Options | Scope |
| --- | --- | --- |
| General | Interface language, session status expiration. | Language: all windows. Expiration: selected workspace. |
| Notifications | Enable notifications, choose and test their sound. | All windows. |
| Icons | Custom letter, Windows taskbar visibility instructions. | Letter: selected workspace. Visibility: Windows. |

The interface supports **Automatic**, **Français** and **English**. Automatic selects French on French Windows, English otherwise. VS Code command titles and configuration descriptions follow VS Code's display language.

The letter accepts one letter or digit, leave it empty for the automatic initial. Session expiration accepts **5–1440 minutes** and keeps saved custom values in its editable list. **Save** applies the changes, **Cancel** leaves saved values unchanged. In a window without a folder, workspace options are saved globally.

The three styles are **Filled circle**, **Rounded square** and **Letter + dot**. The three sizes are **Small**, **Medium** and **Large**. Style and size apply to all icons and survive restarts. Windows fixes the icon slot size, the size setting changes how much of that slot the drawing fills. [Size preview](icons/sizes-preview.png).

### Keep icons visible beside the clock

On Windows 11:

1. Right-click one of our icons, including in **^**, then **Settings → Icons**.
2. Click **Open Windows settings…**.
3. Expand **Other system tray icons** on the taskbar settings page.
4. Turn **On** each **Codex Status Icons** entry you want beside the clock. Its letter identifies the VS Code window. **Off** puts it back in **^**.

On Windows 10, use **Notification area → Select which icons appear on the taskbar**.

The companion uses a fixed executable location and a stable icon identifier for each workspace, allowing Windows to preserve your visibility choice across versions. The first choice is made in Windows. Two simultaneous windows for the same workspace have separate icon slots, assigned by opening order.

## Help and troubleshooting

**Help / About** shows the component versions, colour meanings, documentation link and **Copy diagnostics**. Diagnostics contain technical project information and paths, versions, state, reasons and preferences, without prompts, responses or login credentials. Nothing is sent automatically.

In VS Code, use **Ctrl+Shift+P**:

- **Codex Status: show diagnostics** to inspect the selected window.
- **Codex Status: restart** to restart the Windows companion.
- **Codex Status: associate a session with this window** to select a technical session when automatic association is ambiguous.

A grey icon explains its known cause in the tooltip and menu, such as no recent activity, expired session, unavailable SSH connection or a required reload. Each icon disappears when its window disconnects. The companion exits 15 seconds after the last window disconnects.

To stop displaying the icons, disable **Codex Status Icons** in VS Code's **Extensions** panel, for the selected workspace or globally. Enable the extension again to restore them.

[Configuration reference](docs/CONFIGURATION.md) · [Manual checks](docs/MANUAL_TESTS.md)

## Privacy and supported environments

Session files are read in bounded chunks to extract technical metadata and events. Prompts and responses are not retained or sent to the companion. Account checks use the official Codex app-server with its existing login, our extension does not read authentication tokens or start a conversation.

The Windows companion uses a local Named Pipe restricted to the current user. SSH collection uses the existing VS Code connection. No public port or telemetry is added.

Windows x64 and Linux Remote SSH are the validated targets. WSL, containers, API-key account quotas, custom account/session stores, ARM64 builds and simultaneous Windows login sessions are outside the validated scope. Codex's internal session format and file flushes affect detection. Desktop, CLI and subagent sessions are excluded. Windows can refuse a foreground focus request.

## Build from source

Windows development requires **Node.js 22+**, **npm** and **.NET SDK 10**.

```powershell
git clone https://github.com/QuentinQuiros/codex-status-icons.git
cd codex-status-icons
npm ci
npm run build
npm run lint
npm test
npm run package
npm run test:integration
```

Artifacts are written to `dist/`. The main VSIX includes the self-contained Windows companion and remote VSIX. `CODEX_STATUS_DOTNET` selects a specific .NET executable. `CODEX_STATUS_RUNTIME=win-arm64` requests an ARM64 build, which is not validated.

[Architecture](docs/ARCHITECTURE.md) · [Codex integration](docs/CODEX_INTEGRATION.md) · [IPC protocol](shared/protocol/README.md) · [Release validation](docs/RELEASE_REPORT.md)

## Licence

Project code and documentation: [MIT](LICENSE). The bundled third-party audio is identified separately in [Third-party notices](THIRD_PARTY_NOTICES.md).
