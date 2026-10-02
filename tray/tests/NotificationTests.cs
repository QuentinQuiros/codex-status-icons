using System.Reflection;
using CodexStatusTray.Core;
using CodexStatusTray.Windows;

internal static class NotificationTests
{
    private static WorkspaceEntry Entry(string state, string reason = "task_complete") => new(new("project", "Projet [SSH: fixture.example]", "vscode-remote://ssh-remote+fixture/srv/project", ["vscode-remote://ssh-remote+fixture/srv/project"], "P"), new(state, reason, "session", "session-id"), Guid.Empty, 1, DateTimeOffset.UtcNow, false, true, false);
    public static void Run(Action<string, Action> test, Action<bool, string> check)
    {
        test("completion and confirmed quota transitions notify once while unrelated updates stay quiet", () => {
            var registry = new WorkspaceRegistry(); var connection = Guid.NewGuid(); var now = DateTimeOffset.UtcNow;
            var working = Entry("working", "task_started");
            void Apply(WorkspaceEntry next, string type, TaskNotification? expected) {
                var previous = registry.Get(next.Workspace.WorkspaceId);
                check(registry.Update(new(1, type, next.Workspace, next.Snapshot), connection, 1, now), "update rejected");
                check(NotificationTransition.Detect(previous, registry.Get(next.Workspace.WorkspaceId)!, type, true, false) == expected, "incorrect transition");
            }
            Apply(working, "hello", null);
            Apply(Entry("idle"), "update", TaskNotification.Completed);
            for (var repeat = 0; repeat < 10; repeat++) Apply(Entry("idle"), "heartbeat", null);
            Apply(working, "update", null);
            Apply(Entry("rate_limited", "technical_error"), "update", TaskNotification.QuotaExhausted);
            Apply(Entry("rate_limited", "technical_error"), "heartbeat", null);
            Apply(Entry("idle"), "update", null);
        });
        test("startup reconnection expiration cancellation and disabled or ambiguous windows do not notify", () => {
            var working = Entry("working", "task_started"); var idle = Entry("idle");
            check(NotificationTransition.Detect(null, idle, "hello", true, false) is null, "startup announced history");
            check(NotificationTransition.Detect(working, idle, "hello", true, false) is null, "hello announced completion");
            check(NotificationTransition.Detect(working, idle with { ConnectionId = Guid.NewGuid() }, "update", true, false) is null, "reconnection announced completion");
            check(NotificationTransition.Detect(working, idle, "update", false, false) is null, "disabled notifications");
            check(NotificationTransition.Detect(working, idle, "update", true, true) is null, "ambiguous workspace");
            check(NotificationTransition.Detect(working, Entry("unknown", "stale_session"), "update", true, false) is null, "expiration announced completion");
            check(NotificationTransition.Detect(Entry("unknown"), idle, "update", true, false) is null, "unknown announced completion");
            check(NotificationTransition.Detect(working, Entry("idle", "turn_aborted"), "update", true, false) is null, "manual cancellation announced success");
        });
        test("notifications stay scoped to the observed workspace and session while account blocks remain valid", () => {
            var working = Entry("working", "task_started"); var idle = Entry("idle");
            check(NotificationTransition.Detect(working, idle with { Workspace = idle.Workspace with { WorkspaceId = "other" } }, "update", true, false) is null, "other workspace");
            check(NotificationTransition.Detect(working, idle with { Workspace = idle.Workspace with { WorkspacePath = "other" } }, "update", true, false) is null, "changed workspace");
            check(NotificationTransition.Detect(working, idle with { Snapshot = idle.Snapshot with { SessionId = "other" } }, "update", true, false) is null, "another session completed");
            var blocked = Entry("rate_limited", "account_rate_limit_reached") with { Snapshot = new("rate_limited", "account_rate_limit_reached", "app_server", "other") };
            check(NotificationTransition.Detect(working, blocked, "update", true, false) == TaskNotification.QuotaExhausted, "account block lost after a session change");
        });
        test("native notifications use translated bounded project text without conversation data", () => {
            try {
                foreach (var language in new[] { "fr", "en" }) {
                    UiText.Select(language);
                    foreach (var kind in new[] { TaskNotification.Completed, TaskNotification.QuotaExhausted }) {
                        var content = TaskNotificationText.Create(kind, Entry("idle").Workspace);
                        check(content.Title == UiText.Get(kind == TaskNotification.Completed ? "notification.completed" : "notification.quota"), "wrong title language");
                        check(content.Body == "[SSH: fixture.example]" + Environment.NewLine + UiText.Get("notification.open"), "workspace or click instruction");
                        var longText = TaskNotificationText.Create(kind, Entry("idle").Workspace with { WorkspaceName = new string('x', 256) });
                        check(longText.Title.Length <= 63 && longText.Body.Length <= 255, "shell text bounds");
                    }
                }
            } finally { UiText.Select("fr"); }
        });
        test("clicking a notification invokes its window action once and dismissing it never steals focus", () => {
            using var icon = new StableNotifyIcon(Guid.NewGuid()); var notificationClicks = 0; var trayClicks = 0;
            icon.BalloonTipClicked += (_, _) => notificationClicks++; icon.MouseClick += (_, _) => trayClicks++;
            var callback = typeof(StableNotifyIcon).GetMethod("OnCallback", BindingFlags.Instance | BindingFlags.NonPublic)!;
            foreach (var code in new[] { 0x402, 0x403, 0x404 }) callback.Invoke(icon, [IntPtr.Zero, new IntPtr(0x10000 | code)]);
            check(notificationClicks == 0 && trayClicks == 0, "dismissal focused the window");
            callback.Invoke(icon, [new IntPtr(-1), new IntPtr(0x10000 | 0x405)]);
            check(notificationClicks == 1 && trayClicks == 0, "notification and tray click handlers overlapped");
        });
        test("notification checkbox saves globally with other settings and stays read-only for old clients", () => {
            var settings = new TimingSettings(15, 60, ConfigurationVersion: 5, NotificationsEnabled: true); TimingSettings? saved = null;
            using (var dialog = new TimingSettingsDialog("Projet", true, settings, value => { saved = value; return Task.FromResult(true); })) {
                var input = (CheckBox)dialog.Controls.Find("notifications_enabled", true).Single(); check(input.Checked && input.Enabled, "default checkbox"); input.Checked = false;
                ((ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single()).Text = "600";
                check(dialog.SaveAsync().GetAwaiter().GetResult() && saved == (settings with { NotificationsEnabled = false, StaleWorkingMinutes = 600 }), "notification choice not saved");
            }
            using var old = new TimingSettingsDialog("Projet", true, settings with { ConfigurationVersion = 4, NotificationsEnabled = null }, _ => throw new Exception("unsupported write"));
            var disabled = (CheckBox)old.Controls.Find("notifications_enabled", true).Single(); check(!disabled.Enabled, "older client writable"); disabled.Checked = false;
            check(old.TryGetSettings(out var unchanged) && unchanged.NotificationsEnabled is null, "old choice changed");
        });
        test("notification protocol preserves false rejects strings and requires the new capability field", () => {
            var settings = new TimingSettings(15, 60, ConfigurationVersion: 5, NotificationsEnabled: false);
            var message = new ClientMessage(1, "hello", Entry("idle").Workspace, Entry("idle").Snapshot, Settings: settings);
            var json = Protocol.Serialize(message);
            check(Protocol.Parse(json)?.Settings?.NotificationsEnabled == false, "false preference lost");
            check(Protocol.Parse(json.Replace("\"notifications_enabled\":false", "\"notifications_enabled\":\"false\"")) is null, "string preference accepted");
            check(Protocol.Parse(Protocol.Serialize(message with { Settings = settings with { NotificationsEnabled = null } })) is null, "incomplete capability");
            check(Protocol.Parse(Protocol.Serialize(message with { Settings = settings with { ConfigurationVersion = 4, NotificationsEnabled = null } })) is not null, "legacy settings broken");
        });
    }
}
