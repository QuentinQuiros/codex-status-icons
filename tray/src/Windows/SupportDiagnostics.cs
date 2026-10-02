using System.Text.Json;
using CodexStatusTray.Core;

namespace CodexStatusTray.Windows;

public static class SupportDiagnostics
{
    public static string Version => typeof(TrayContext).Assembly.GetName().Version?.ToString(3) ?? "unknown";
    public static string Build(WorkspaceEntry entry, int connectedCount, bool iconVisible, Guid? iconGuid, string style, string size, bool notificationsEnabled = true, int notificationsSent = 0, string notificationSound = NotificationSounds.DefaultMode) => JsonSerializer.Serialize(new {
        extension_version = entry.ExtensionVersion,
        workspace = entry.Workspace,
        snapshot = entry.Snapshot,
        pinned_session = entry.PinnedSession ? entry.Snapshot.SessionId : null,
        tray = new { tray_version = Version, connected_count = connectedCount, icon_visible = iconVisible, icon_guid = iconGuid, icon_style = style, icon_size = size, exit_grace_seconds = TimingSettings.DefaultExitGraceSeconds, language = UiText.Code, language_preference = UiText.Preference, notifications_enabled = notificationsEnabled, notifications_sent = notificationsSent, notification_sound = notificationSound },
        quota = entry.Quota,
        freshness_minutes = entry.Settings?.StaleWorkingMinutes,
        workspace_label = entry.Settings?.WorkspaceLabel,
        provider = entry.Snapshot.Provider,
        location = entry.Location ?? (entry.Workspace.WorkspacePath.StartsWith("vscode-remote://", StringComparison.Ordinal) ? "remote" : "local"),
        remote = entry.BridgeVersion is { } bridge ? new { bridge_version = bridge } : null,
        captured_at = DateTimeOffset.UtcNow.ToString("O")
    }, new JsonSerializerOptions(Protocol.JsonOptions) { WriteIndented = true });
}
