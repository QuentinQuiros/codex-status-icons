using CodexStatusTray.Core;
namespace CodexStatusTray.Windows;
public static class TrayPresentation
{
    public static string DisplayName(string name)
    {
        var bracket = name.IndexOf('[');
        return bracket >= 0 ? name[bracket..] : name;
    }
    public static string StateText(string state) => state switch
    {
        "idle" => UiText.Get("state.idle"), "working" => UiText.Get("state.working"),
        "rate_limited" => UiText.Get("state.rate_limited"), _ => UiText.Get("state.unknown")
    };
    public static string UnknownReason(string reason) => UiText.Get(reason switch {
        "stale_session" => "unknown.expired",
        "no_matching_session" or "no_turn_event" or "session_not_associated" => "unknown.no_activity",
        "remote_unavailable" or "remote_timeout" => "unknown.remote_unavailable",
        "remote_bridge_reload_required" => "unknown.reload",
        "remote_install_command_unavailable" => "unknown.remote_setup",
        "codex_extension_absent" or "remote_codex_extension_absent" => "unknown.codex_absent",
        "ambiguous_workspace_windows" => "unknown.ambiguous",
        "initializing" or "remote_initializing" or "remote_connecting" => "unknown.connecting",
        "remote_session_changing" => "unknown.changing",
        "window_disconnected" => "unknown.window_closed",
        _ => "unknown.unavailable"
    });
    public static string SnapshotText(StateSnapshot snapshot) => snapshot.State == "unknown" ? UnknownReason(snapshot.Reason) : StateText(snapshot.State);
    public static string Tooltip(WorkspaceEntry entry, DateTimeOffset now)
    {
        var name = DisplayName(entry.Workspace.WorkspaceName);
        if (name.Length > 55) name = name[..55] + "…";
        var status = SnapshotText(entry.Snapshot);
        if (entry.ShowWorkingDuration && entry.Snapshot.State == "working" && DateTimeOffset.TryParse(entry.Snapshot.Since, out var since))
        {
            var duration = now - since; if (duration < TimeSpan.Zero) duration = TimeSpan.Zero;
            status += UiText.Get("tooltip.since", $"{(int)duration.TotalMinutes:00}:{duration.Seconds:00}");
        }
        var quota = QuotaText(entry, now);
        // Reserve the quota line before trimming a long project name.
        var available = 127 - status.Length - Environment.NewLine.Length - (quota is null ? 0 : quota.Length + Environment.NewLine.Length);
        if (name.Length > available) name = name[..Math.Max(0, available - 1)] + "…";
        var text = name + Environment.NewLine + status + (quota is null ? "" : Environment.NewLine + quota);
        return text.Length > 127 ? text[..127] : text;
    }
    public static string? QuotaText(WorkspaceEntry entry, DateTimeOffset now)
    {
        if (entry.Snapshot.Reason is "remote_unavailable" or "remote_timeout" || entry.Quota is not { Valid: true } quota
            || !DateTimeOffset.TryParse(quota.CheckedAt, out var checkedAt) || checkedAt > now.AddSeconds(5) || now - checkedAt > TimeSpan.FromSeconds(150)) return null;
        var windows = quota.Windows.Where(window => window.ResetsAt > now.ToUnixTimeSeconds()).Select(window => {
            var minutes = window.WindowMinutes;
            var period = minutes % 1440 == 0 ? UiText.Get("quota.days", (minutes / 1440).ToString("0.##", System.Globalization.CultureInfo.CurrentCulture))
                : minutes % 60 == 0 ? UiText.Get("quota.hours", (minutes / 60).ToString("0.##", System.Globalization.CultureInfo.CurrentCulture))
                : UiText.Get("quota.minutes", minutes.ToString("0.##", System.Globalization.CultureInfo.CurrentCulture));
            return period + " : " + Math.Floor(window.RemainingPercent).ToString("0", System.Globalization.CultureInfo.CurrentCulture) + "%";
        }).ToArray();
        return windows.Length == 0 ? null : "[" + string.Join(" | ", windows) + "]";
    }
    public static ContextMenuStrip CreateMenu(WorkspaceEntry entry, Action focus, IconStyle style = IconStyle.Flat, Action<IconStyle>? selectStyle = null, IconSize size = IconSize.Small, Action<IconSize>? selectSize = null, Action? openSettings = null, Action? openHelp = null)
    {
        // A menu already opens a submenu on hover. Do not open another native
        // tooltip over it; help belongs in the custom settings dialog.
        var menu = new ContextMenuStrip { ShowItemToolTips = false };
        menu.Items.Add(new ToolStripMenuItem(DisplayName(entry.Workspace.WorkspaceName)) { Enabled = false });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(UiText.Get("menu.open"), null, (_, _) => focus());
        menu.Items.Add(new ToolStripMenuItem(UiText.Get("menu.state", SnapshotText(entry.Snapshot))) { Enabled = false });
        menu.Items.Add(new ToolStripSeparator());
        var styles = new ToolStripMenuItem(UiText.Get("menu.styles"));
        styles.DropDown.ShowItemToolTips = false;
        foreach (var candidate in IconStyles.All)
        {
            var item = new ToolStripMenuItem(IconStyles.Name(candidate)) { Checked = candidate == style, Enabled = selectStyle is not null };
            item.Click += (_, _) => selectStyle?.Invoke(candidate);
            styles.DropDownItems.Add(item);
        }
        menu.Items.Add(styles);
        var sizes = new ToolStripMenuItem(UiText.Get("menu.sizes"));
        sizes.DropDown.ShowItemToolTips = false;
        foreach (var candidate in IconSizes.All)
        {
            var item = new ToolStripMenuItem(IconSizes.Name(candidate)) { Checked = candidate == size, Enabled = selectSize is not null };
            item.Click += (_, _) => selectSize?.Invoke(candidate);
            sizes.DropDownItems.Add(item);
        }
        menu.Items.Add(sizes);
        menu.Items.Add(new ToolStripSeparator());
        var supported = entry.Settings?.ConfigurationVersion >= 3;
        var settings = new ToolStripMenuItem(UiText.Get(supported ? "menu.settings" : "menu.reload")) { Enabled = supported && openSettings is not null };
        settings.Click += (_, _) => openSettings?.Invoke();
        menu.Items.Add(settings);
        var help = new ToolStripMenuItem(UiText.Get("menu.help")) { Enabled = openHelp is not null };
        help.Click += (_, _) => openHelp?.Invoke();
        menu.Items.Add(help);
        return menu;
    }
}
