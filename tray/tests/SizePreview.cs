using System.Drawing;
using System.Drawing.Imaging;
using CodexStatusTray.Windows;

internal static class SizePreview
{
    public static void Write()
    {
        Directory.CreateDirectory("icons");
        using var image = new Bitmap(1296, 216 + IconStyles.All.Length * 168);
        using var g = Graphics.FromImage(image);
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        g.Clear(Color.FromArgb(15, 19, 26));
        using var title = new Font("Segoe UI", 27, FontStyle.Bold, GraphicsUnit.Pixel);
        using var heading = new Font("Segoe UI", 20, FontStyle.Bold, GraphicsUnit.Pixel);
        using var body = new Font("Segoe UI", 15, FontStyle.Regular, GraphicsUnit.Pixel);
        using var small = new Font("Segoe UI", 12, FontStyle.Regular, GraphicsUnit.Pixel);
        using var white = new SolidBrush(Color.FromArgb(240, 244, 249));
        using var muted = new SolidBrush(Color.FromArgb(159, 173, 191));
        g.DrawString("Trois tailles pour chaque style", title, white, 32, 25);
        g.DrawString("Le dessin et la lettre grandissent dans l'espace réservé par Windows. Petite conserve la taille actuelle.", body, muted, 32, 69);
        for (var column = 0; column < IconSizes.All.Length; column++)
            g.DrawString(IconSizes.Name(IconSizes.All[column]), heading, white, 268 + column * 340, 117);
        for (var row = 0; row < IconStyles.All.Length; row++)
        {
            var style = IconStyles.All[row]; var y = 159 + row * 168;
            g.DrawString(IconStyles.Name(style), heading, white, 32, y + 58);
            for (var column = 0; column < IconSizes.All.Length; column++)
            {
                var x = 248 + column * 340;
                for (var theme = 0; theme < 2; theme++)
                {
                    var top = y + theme * 76;
                    using var card = new SolidBrush(theme == 0 ? Color.FromArgb(36, 36, 36) : Color.FromArgb(243, 244, 246));
                    using var text = new SolidBrush(theme == 0 ? Color.FromArgb(185, 194, 207) : Color.FromArgb(84, 96, 115));
                    g.FillRectangle(card, x, top, 316, 70);
                    var offset = x + 48;
                    foreach (var pixels in new[] { 16, 32 })
                    {
                        g.DrawString(pixels + " px", small, text, offset - 33, top + 28);
                        foreach (var (label, state) in new[] { ("P", "idle"), ("E", "working"), ("U", "unknown") })
                        {
                            using var icon = IconRenderer.RenderBitmap(label, state, pixels, style, theme == 1, IconSizes.All[column]);
                            g.DrawImageUnscaled(icon, offset, top + (70 - pixels) / 2); offset += pixels + 14;
                        }
                        offset += 32;
                    }
                }
            }
        }
        g.DrawString("Rendus à leur taille réelle, sans zoom. L'agrandissement reste limité par la barre des tâches et son réglage d'affichage.", small, muted, 32, image.Height - 41);
        image.Save("icons/sizes-preview.png", ImageFormat.Png);
    }
}
