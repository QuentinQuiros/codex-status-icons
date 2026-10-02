using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace CodexStatusTray.Windows;
public static class IconRenderer
{
    public static Color StateColor(string state) => state switch
    {
        "idle" => Color.FromArgb(74, 222, 128), "working" => Color.FromArgb(251, 191, 36),
        "rate_limited" => Color.FromArgb(248, 113, 113),
        _ => Color.FromArgb(148, 163, 184)
    };
    public static Bitmap RenderBitmap(string label, string state, int size, IconStyle style = IconStyle.Flat, bool lightBackground = false, IconSize iconSize = IconSize.Small)
    {
        var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias; graphics.PixelOffsetMode = PixelOffsetMode.HighQuality; graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        graphics.Clear(Color.Transparent);
        using var fill = new SolidBrush(StateColor(state));
        // Windows owns the notification-area slot. Larger presets use its free
        // margins and enlarge the glyph; requesting a larger HICON alone is scaled down.
        var step = iconSize switch { IconSize.Medium => 1, IconSize.Large => 2, _ => 0 };
        var inset = size * (step == 0 ? .055f : step == 1 ? .028f : 0f);
        var bounds = new RectangleF(inset, inset, size - 2 * inset, size - 2 * inset);
        if (style == IconStyle.Flat) graphics.FillEllipse(fill, bounds);
        else if (style == IconStyle.Rounded)
        {
            var corner = size * .38f;
            using var shape = new GraphicsPath();
            shape.AddArc(bounds.Left, bounds.Top, corner, corner, 180, 90);
            shape.AddArc(bounds.Right - corner, bounds.Top, corner, corner, 270, 90);
            shape.AddArc(bounds.Right - corner, bounds.Bottom - corner, corner, corner, 0, 90);
            shape.AddArc(bounds.Left, bounds.Bottom - corner, corner, corner, 90, 90);
            shape.CloseFigure(); graphics.FillPath(fill, shape);
        }
        using var font = new Font("Segoe UI", size * (style == IconStyle.Minimal ? .78f + step * .11f : .60f + step * .07f), FontStyle.Bold, GraphicsUnit.Pixel);
        var textColor = style == IconStyle.Minimal ? (lightBackground ? Color.FromArgb(24, 32, 43) : Color.FromArgb(243, 246, 250)) : Color.FromArgb(19, 29, 39);
        using var ink = new SolidBrush(textColor);
        using var format = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        var textBounds = style == IconStyle.Minimal ? new RectangleF(-size * .08f, -size * .07f, size, size) : new RectangleF(0, -size * .035f, size, size);
        graphics.DrawString(label, font, ink, textBounds, format);
        if (style == IconStyle.Minimal)
        {
            var dotDiameter = .31f + step * .045f;
            var dotOrigin = step == 0 ? .65f : step == 1 ? .635f : .60f;
            var dot = new RectangleF(size * dotOrigin, size * dotOrigin, size * dotDiameter, size * dotDiameter);
            var clearance = dot; clearance.Inflate(size * .065f, size * .065f);
            graphics.CompositingMode = CompositingMode.SourceCopy;
            using var transparent = new SolidBrush(Color.Transparent);
            graphics.FillEllipse(transparent, clearance);
            graphics.CompositingMode = CompositingMode.SourceOver; graphics.FillEllipse(fill, dot);
        }
        return bitmap;
    }
    public static byte[] RenderIco(string label, string state, IconStyle style = IconStyle.Flat, bool lightBackground = false, IconSize iconSize = IconSize.Small)
    {
        var sizes = new[] { 16, 20, 24, 32, 40, 48, 64, 256 };
        var images = sizes.Select(size => { using var bitmap = RenderBitmap(label, state, size, style, lightBackground, iconSize); using var data = new MemoryStream(); bitmap.Save(data, ImageFormat.Png); return data.ToArray(); }).ToArray();
        using var stream = new MemoryStream(); using var writer = new BinaryWriter(stream);
        writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)sizes.Length);
        var offset = 6 + 16 * sizes.Length;
        for (var i = 0; i < sizes.Length; i++)
        {
            writer.Write((byte)(sizes[i] == 256 ? 0 : sizes[i])); writer.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
            writer.Write((byte)0); writer.Write((byte)0); writer.Write((ushort)1); writer.Write((ushort)32); writer.Write(images[i].Length); writer.Write(offset); offset += images[i].Length;
        }
        foreach (var image in images) writer.Write(image);
        return stream.ToArray();
    }
    public static Icon Create(string label, string state, IconStyle style = IconStyle.Flat, bool lightBackground = false, IconSize iconSize = IconSize.Small)
    {
        using var stream = new MemoryStream(RenderIco(label, state, style, lightBackground, iconSize)); using var icon = new Icon(stream, SystemInformation.SmallIconSize);
        return (Icon)icon.Clone();
    }
}
