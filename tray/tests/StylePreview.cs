using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using CodexStatusTray.Windows;

internal static class StylePreview
{
    public static void Write()
    {
        Directory.CreateDirectory("icons");
        using var image = new Bitmap(1400, 204 + IconStyles.All.Length * 182);
        using var g = Graphics.FromImage(image);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        g.Clear(Color.FromArgb(15, 19, 26));
        using var title = new Font("Segoe UI", 27, FontStyle.Bold, GraphicsUnit.Pixel);
        using var heading = new Font("Segoe UI", 22, FontStyle.Bold, GraphicsUnit.Pixel);
        using var body = new Font("Segoe UI", 15, FontStyle.Regular, GraphicsUnit.Pixel);
        using var small = new Font("Segoe UI", 12, FontStyle.Regular, GraphicsUnit.Pixel);
        using var white = new SolidBrush(Color.FromArgb(240, 244, 249));
        using var muted = new SolidBrush(Color.FromArgb(159, 173, 191));
        using var green = new SolidBrush(Color.FromArgb(74, 222, 128));
        g.DrawString("Trois styles pour vos icônes", title, white, 36, 27);
        g.DrawString("Choix depuis le clic droit · Même style pour toutes les fenêtres · Couleur selon l'état", body, muted, 36, 69);
        g.DrawString("Barre des tâches sombre", body, muted, 326, 119);
        g.DrawString("Barre des tâches claire", body, muted, 858, 119);
        var states = new[] { "idle", "working", "rate_limited", "unknown" };
        var captions = new[] { "Disponible", "Travail", "Quota", "Inconnu" };
        var labels = new[] { "P", "E", "R", "U" };
        var descriptions = new[] { "Couleur pleine.\nSans contour blanc.", "Une forme plus carrée.\nSans contour blanc.", "Une grande lettre.\nUn point pour l'état." };
        for (var row = 0; row < IconStyles.All.Length; row++)
        {
            var style = IconStyles.All[row]; var y = 151 + row * 182;
            g.DrawString(IconStyles.Name(style), heading, white, 36, y + 30);
            g.DrawString(descriptions[row], body, muted, 36, y + 66);
            if (row == 0) g.DrawString("MON CHOIX", small, green, 36, y + 6);
            for (var theme = 0; theme < 2; theme++)
            {
                var x = 298 + theme * 532;
                using var card = new SolidBrush(theme == 0 ? Color.FromArgb(36, 36, 36) : Color.FromArgb(243, 244, 246));
                using var text = new SolidBrush(theme == 0 ? Color.FromArgb(185, 194, 207) : Color.FromArgb(84, 96, 115));
                g.FillRectangle(card, x, y, 504, 158);
                g.DrawString("32 px", small, text, x + 14, y + 53);
                g.DrawString("16 px", small, text, x + 14, y + 111);
                for (var col = 0; col < states.Length; col++)
                {
                    var center = x + 120 + col * 103;
                    using var centerFormat = new StringFormat { Alignment = StringAlignment.Center };
                    g.DrawString(captions[col], small, text, new RectangleF(center - 41, y + 13, 82, 20), centerFormat);
                    foreach (var size in new[] { 32, 16 })
                    {
                        using var icon = IconRenderer.RenderBitmap(labels[col], states[col], size, style, theme == 1);
                        g.DrawImageUnscaled(icon, center - size / 2, y + (size == 32 ? 45 : 109));
                    }
                }
            }
        }
        g.DrawString("Les rangées de 16 px montrent les icônes à leur taille habituelle, sans agrandissement.", small, muted, 36, image.Height - 35);
        image.Save("icons/styles-preview.png", ImageFormat.Png);
    }
}
