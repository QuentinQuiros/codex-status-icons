using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodexStatusTray.Core;

public sealed record WorkspaceInfo(string WorkspaceId, string WorkspaceName, string WorkspacePath, string[] WorkspaceRoots, string Label);
public sealed record StateSnapshot(string State, string Reason, string Provider, string? SessionId = null, string? CliVersion = null, string? Since = null);
public sealed record QuotaWindow(double RemainingPercent, double WindowMinutes, double ResetsAt)
{
    public bool Valid => double.IsFinite(RemainingPercent) && RemainingPercent >= 0 && RemainingPercent <= 100
        && double.IsFinite(WindowMinutes) && WindowMinutes > 0 && WindowMinutes <= 10000000
        && double.IsFinite(ResetsAt) && ResetsAt > 0 && ResetsAt < 253402300799;
}
public sealed record QuotaInfo(string CheckedAt, QuotaWindow[] Windows)
{
    public bool Valid => CheckedAt is not null && CheckedAt.Length <= 40 && DateTimeOffset.TryParse(CheckedAt, out _)
        && Windows is not null && Windows.Length <= 2 && Windows.All(window => window is not null && window.Valid);
}
public sealed record ClientMessage(int Version, string Type, WorkspaceInfo? Workspace = null, StateSnapshot? Snapshot = null, string? WorkspaceId = null, string? Timestamp = null, bool WindowFocused = false, bool ShowWorkingDuration = true, bool PinnedSession = false, string? RequestId = null, bool Focused = false, TimingSettings? Settings = null, bool? Success = null, string? ExtensionVersion = null, string? Location = null, string? BridgeVersion = null, QuotaInfo? Quota = null);
public static class Protocol
{
    public const int MaxFrameBytes = 16384;
    public static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip };
    private static readonly HashSet<string> States = ["idle", "working", "rate_limited", "unknown"];
    public static ClientMessage? Parse(string line)
    {
        if (System.Text.Encoding.UTF8.GetByteCount(line) > MaxFrameBytes) return null;
        try
        {
            var message = JsonSerializer.Deserialize<ClientMessage>(line, JsonOptions);
            if (message is null || message.Version != 1) return null;
            if (message.Type == "configuration_result") return ValidText(message.WorkspaceId, 100) && ValidText(message.RequestId, 100) && message.Success is not null ? message : null;
            if (message.Type is "disconnect" or "focus_result" or "diagnostics" or "request_focus" or "restart_tray") return ValidText(message.WorkspaceId, 100) && (message.Type == "disconnect" || ValidText(message.RequestId, 100)) ? message : null;
            if (message.Type is not ("hello" or "update" or "heartbeat")) return null;
            var workspace = message.Workspace;
            var snapshot = message.Snapshot;
            if (workspace is null || snapshot is null || !ValidText(workspace.WorkspaceId, 100) || !ValidText(workspace.WorkspaceName, 256) || !ValidText(workspace.Label, 8)) return null;
            if (workspace.WorkspacePath is null || workspace.WorkspacePath.Length > 2048 || workspace.WorkspaceRoots is null || workspace.WorkspaceRoots.Length > 64 || workspace.WorkspaceRoots.Any(root => root is null || root.Length > 2048)) return null;
            if (snapshot.State is null || !States.Contains(snapshot.State) || !ValidText(snapshot.Reason, 180) || snapshot.Provider is not ("session" or "app_server" or "none")) return null;
            if (snapshot.SessionId?.Length > 100 || snapshot.CliVersion?.Length > 100 || snapshot.Since?.Length > 100) return null;
            if (message.Settings is not null && !message.Settings.Valid) return null;
            if (message.Quota is not null && !message.Quota.Valid) return null;
            if (message.ExtensionVersion is not null && !ValidText(message.ExtensionVersion, 60) || message.Location is not null && !ValidText(message.Location, 60) || message.BridgeVersion is not null && !ValidText(message.BridgeVersion, 60)) return null;
            return message;
        }
        catch (JsonException) { return null; }
    }
    private static bool ValidText(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Length <= max && !value.Any(char.IsControl);
    public static string Serialize(object value) => JsonSerializer.Serialize(value, JsonOptions) + "\n";
}
