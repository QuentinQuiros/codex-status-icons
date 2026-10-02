# SSH support / Fonctionnement SSH — 1.0.0

## English

Install `codex-status-1.0.0.vsix` on the **local Windows side** of VS Code. Open a trusted Linux Remote SSH workspace with the official Codex extension installed remotely and its account connected.

The UI extension installs its bundled `codex-status-remote` **1.0.0** workspace component automatically through VS Code. It is shared by windows connected to the same host. You do not copy an executable to the server, install .NET/Python there or expose a network port.

After an update:

1. Reload the SSH window using **Developer: Reload Window**.
2. Run **Codex Status: show diagnostics**.
3. Check `extension_version`, `tray.tray_version` and `remote.bridge_version`, each should report **1.0.0**.
4. If the state says `remote_bridge_reload_required`, reload once more.

If no recent task exists, grey is expected. Run a normal Codex task to observe orange, then green on completion. A confirmed exhausted quota can produce red without a recent task.

The host's default sessions are `CODEX_HOME/sessions` or `~/.codex/sessions`. Use `codex_status.remote_sessions_directory` only if a custom directory is required, automatic account-quota association is restricted to the default store.

## Français

Installez `codex-status-1.0.0.vsix` du **côté Windows local** de VS Code. Ouvrez un workspace Linux Remote SSH approuvé, avec l'extension officielle Codex installée à distance et son compte connecté.

L'extension UI installe automatiquement le composant workspace `codex-status-remote` **1.0.0** inclus, via VS Code. Il est partagé entre les fenêtres du même hôte. Aucun exécutable à copier manuellement, aucune installation .NET/Python et aucun port réseau à ouvrir sur le serveur.

Après une mise à jour :

1. Rechargez la fenêtre SSH avec **Developer: Reload Window**.
2. Lancez **Codex Status : afficher les diagnostics**.
3. Vérifiez `extension_version`, `tray.tray_version` et `remote.bridge_version`, tous doivent indiquer **1.0.0**.
4. Si l'état indique `remote_bridge_reload_required`, rechargez une seconde fois.

Le gris est attendu si aucune tâche récente n'existe. Une tâche Codex normale permet d'observer l'orange puis le vert. Un quota épuisé confirmé peut produire le rouge sans tâche récente.

Les sessions distantes sont dans `CODEX_HOME/sessions` ou `~/.codex/sessions`. `codex_status.remote_sessions_directory` permet un chemin personnalisé, la vérification automatique du compte est réservée au répertoire par défaut.

## Technical behaviour

The UI calls `_codex_status_remote.snapshot` with a request ID, roots, selected session and expiration. The response returns validated technical state, versions and optional quota periods. Remote roots retain their SSH authority and case.

One request remains in flight at a time. A 75-second deadline accommodates background command batching, a valid late reply restores state. Selection revisions prevent an older response replacing a newly selected session. Explicit failures show unknown, quota information disappears when the connection is unavailable.

The audio file and banner remain on Windows. The host never plays a notification sound.
