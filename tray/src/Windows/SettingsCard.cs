using System.Drawing.Drawing2D;

namespace CodexStatusTray.Windows;

internal sealed class SettingsCard : Panel
{
    public SettingsCard(TableLayoutPanel content)
    {
        AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink;
        MinimumSize = new Size(520, 0); MaximumSize = new Size(520, 0);
        Padding = new Padding(18); Margin = new Padding(0, 0, 0, 14);
        BackColor = Color.White;
        SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        content.Location = new Point(Padding.Left, Padding.Top);
        content.Margin = Padding.Empty;
        content.MaximumSize = new Size(480, 0);
        Controls.Add(content);
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var background = new SolidBrush(Parent?.BackColor ?? Color.White);
        e.Graphics.FillRectangle(background, ClientRectangle);
        var bounds = new RectangleF(.5f, .5f, Width - 1, Height - 1);
        var corner = 14f;
        using var shape = new GraphicsPath();
        shape.AddArc(bounds.Left, bounds.Top, corner, corner, 180, 90);
        shape.AddArc(bounds.Right - corner, bounds.Top, corner, corner, 270, 90);
        shape.AddArc(bounds.Right - corner, bounds.Bottom - corner, corner, corner, 0, 90);
        shape.AddArc(bounds.Left, bounds.Bottom - corner, corner, corner, 90, 90);
        shape.CloseFigure();
        using var fill = new SolidBrush(Color.White); e.Graphics.FillPath(fill, shape);
        using var outline = new Pen(Color.FromArgb(222, 228, 237)); e.Graphics.DrawPath(outline, shape);
    }
}

internal sealed class SettingsTabs : TabControl
{
    public SettingsTabs()
    {
        Name = "settings_tabs"; Dock = DockStyle.Fill;
        DrawMode = TabDrawMode.OwnerDrawFixed; SizeMode = TabSizeMode.Fixed;
        ItemSize = new Size(140, 38); Padding = new Point(12, 6);
        Margin = new Padding(0, 12, 0, 14);
    }
    protected override void OnDrawItem(DrawItemEventArgs e)
    {
        var selected = e.Index == SelectedIndex;
        using var fill = new SolidBrush(selected ? Color.White : Color.FromArgb(244, 247, 251));
        e.Graphics.FillRectangle(fill, e.Bounds);
        var color = selected ? Color.FromArgb(37, 99, 235) : Color.FromArgb(80, 95, 116);
        TextRenderer.DrawText(e.Graphics, TabPages[e.Index].Text, Font, e.Bounds, color, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        if (selected) {
            using var accent = new SolidBrush(color);
            e.Graphics.FillRectangle(accent, e.Bounds.Left + 12, e.Bounds.Bottom - 3, e.Bounds.Width - 24, 3);
        }
        if ((e.State & DrawItemState.Focus) != 0 && Focused) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(e.Bounds, -6, -6));
    }
}
