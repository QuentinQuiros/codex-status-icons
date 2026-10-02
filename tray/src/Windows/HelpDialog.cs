using System.Diagnostics;
using CodexStatusTray.Core;

namespace CodexStatusTray.Windows;

public class HelpDialog : Form
{
    public const string DocumentationUrl = "https://github.com/QuentinQuiros/codex-status-icons#readme";
    private readonly Label feedback;
    private readonly Func<string> diagnostics;
    private readonly Action<string> copy;
    private readonly Action<string> open;

    public HelpDialog(WorkspaceEntry entry, Func<string> diagnostics, Action<string>? copy = null, Action<string>? open = null)
    {
        this.diagnostics = diagnostics;
        this.copy = copy ?? (value => Clipboard.SetText(value, TextDataFormat.UnicodeText));
        this.open = open ?? (url => { using var process = Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); });
        Text = UiText.Get("menu.help") + " — Codex Status Icons";
        Font = new Font("Segoe UI", 10);
        BackColor = SystemColors.Window;
        AutoScaleMode = AutoScaleMode.Font;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = MinimizeBox = ShowInTaskbar = ShowIcon = false;
        TopMost = true;
        var layout = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Padding = new Padding(24) };
        layout.Controls.Add(TextLabel("Codex Status Icons", 14, FontStyle.Bold));
        layout.Controls.Add(TextLabel(UiText.Get("help.description"), bottom: 16));
        var versions = UiText.Get("help.version", SupportDiagnostics.Version) + Environment.NewLine + UiText.Get("help.extension_version", entry.ExtensionVersion ?? UiText.Get("help.unavailable"));
        if (entry.Workspace.WorkspacePath.StartsWith("vscode-remote://", StringComparison.Ordinal))
            versions += Environment.NewLine + UiText.Get("help.bridge_version", entry.BridgeVersion ?? UiText.Get("help.unavailable"));
        if (entry.Snapshot.CliVersion is { } cli) versions += Environment.NewLine + UiText.Get("help.codex_version", cli);
        var versionLabel = TextLabel(versions, bottom: 18); versionLabel.Name = "versions"; layout.Controls.Add(versionLabel);
        layout.Controls.Add(TextLabel(UiText.Get("help.colors"), 11, FontStyle.Bold));
        foreach (var state in new[] { "idle", "working", "rate_limited", "unknown" }) {
            var row = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, 8) };
            row.Controls.Add(new Panel { BackColor = IconRenderer.StateColor(state), Size = new Size(16, 16), Margin = new Padding(0, 4, 10, 0) });
            row.Controls.Add(TextLabel(UiText.Get("help.color." + state), maximumWidth: 510, bottom: 0));
            layout.Controls.Add(row);
        }
        layout.Controls.Add(TextLabel(UiText.Get("help.workspace", TrayPresentation.DisplayName(entry.Workspace.WorkspaceName)), 11, FontStyle.Bold));
        layout.Controls.Add(TextLabel(UiText.Get("help.diagnostics_info"), bottom: 12));
        var actions = new FlowLayoutPanel { AutoSize = true, WrapContents = true, MaximumSize = new Size(560, 0), Margin = new Padding(0, 0, 0, 8) };
        var documentation = new Button { Name = "documentation", Text = UiText.Get("help.documentation"), AutoSize = true, Padding = new Padding(8, 3, 8, 3) };
        documentation.Click += (_, _) => OpenDocumentation(); actions.Controls.Add(documentation);
        var copyButton = new Button { Name = "copy_diagnostics", Text = UiText.Get("help.copy"), AutoSize = true, Padding = new Padding(8, 3, 8, 3) };
        copyButton.Click += (_, _) => CopyDiagnostics(); actions.Controls.Add(copyButton);
        layout.Controls.Add(actions);
        feedback = TextLabel("", bottom: 8); feedback.Name = "feedback"; feedback.AccessibleRole = AccessibleRole.Alert; layout.Controls.Add(feedback);
        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, Margin = Padding.Empty };
        var close = new Button { Name = "close", Text = UiText.Get("button.close"), AutoSize = true, DialogResult = DialogResult.Cancel, Padding = new Padding(10, 3, 10, 3) };
        buttons.Controls.Add(close); layout.Controls.Add(buttons); DialogLayout.Attach(this, layout); CancelButton = close;
    }
    private static Label TextLabel(string text, float size = 10, FontStyle style = FontStyle.Regular, int bottom = 8, int maximumWidth = 560) => new() {
        AutoSize = true, MaximumSize = new Size(maximumWidth, 0), Text = text, Font = new Font("Segoe UI", size, style), Margin = new Padding(0, 0, 0, bottom)
    };
    public bool CopyDiagnostics()
    {
        try { copy(diagnostics()); feedback.ForeColor = SystemColors.ControlText; feedback.Text = UiText.Get("help.copied"); return true; }
        catch (Exception error) when (error is System.Runtime.InteropServices.ExternalException or InvalidOperationException or System.Threading.ThreadStateException) {
            feedback.ForeColor = Color.Firebrick; feedback.Text = UiText.Get("help.copy_failure"); return false;
        }
    }
    public bool OpenDocumentation()
    {
        var wasTopMost = TopMost; TopMost = false;
        try { open(DocumentationUrl); return true; }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException) {
            TopMost = wasTopMost; feedback.ForeColor = Color.Firebrick; feedback.Text = UiText.Get("help.open_failure"); return false;
        }
    }
}
