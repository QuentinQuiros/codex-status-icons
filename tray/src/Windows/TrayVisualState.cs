using CodexStatusTray.Core;

namespace CodexStatusTray.Windows;

// Keep the native icon/menu untouched while the user navigates a menu or tooltip.
// Heartbeats still update the registry; the latest values are rendered on close.
public sealed class TrayVisualState
{
    private string? iconKey;
    private string? tooltip;
    private string? menuKey;
    public bool MenuOpen { get; set; }
    public bool SetIcon(string next) => Remember(ref iconKey, next);
    public bool SetTooltip(string next) => Remember(ref tooltip, next);
    public bool SetMenu(string next) => Remember(ref menuKey, next);
    private bool Remember(ref string? previous, string next)
    {
        if (MenuOpen || previous == next) return false;
        previous = next;
        return true;
    }
    public static string MenuKey(WorkspaceEntry entry, IconStyle style, IconSize size, double exitGrace) =>
        System.Text.Json.JsonSerializer.Serialize(new {
            name = entry.Workspace.WorkspaceName,
            state = entry.Snapshot.State,
            reason = entry.Snapshot.State == "unknown" ? entry.Snapshot.Reason : null,
            style,
            size,
            exitGrace,
            stale = entry.Settings?.StaleWorkingMinutes,
            configurable = entry.Settings?.ConfigurationVersion >= 3,
            language = UiText.Code
        });
}
