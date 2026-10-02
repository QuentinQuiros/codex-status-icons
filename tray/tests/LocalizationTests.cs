using System.Globalization;
using System.Text.RegularExpressions;
using CodexStatusTray.Core;
using CodexStatusTray.Windows;

internal static class LocalizationTests
{
    public static void Run(Action<string, Action> test, Action<bool, string> check)
    {
        test("automatic language follows UI culture independently from number formatting", () => {
            var culture = CultureInfo.CurrentCulture; var ui = CultureInfo.CurrentUICulture;
            try {
                CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR"); CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("en-US"); UiText.Select("auto");
                check(UiText.Code == "en", "regional number format chose the interface language");
                foreach (var code in new[] { "fr", "fr-FR", "FR-ca" }) check(UiText.Resolve("auto", code) == "fr", "French variant");
                foreach (var code in new[] { "de-DE", "en-US", "" }) check(UiText.Resolve("auto", code) == "en", "English fallback");
                UiText.Select("fr"); check(UiText.Code == "fr", "French override");
                UiText.Select("en"); check(UiText.Code == "en" && !UiText.ValidPreference("de"), "English override or invalid preference");
            }
            finally { CultureInfo.CurrentCulture = culture; CultureInfo.CurrentUICulture = ui; UiText.Select("fr"); }
        });
        test("both native catalogs cover all keys with matching placeholders", () => {
            var en = UiText.Catalog("en"); var fr = UiText.Catalog("fr");
            check(en.Keys.Order().SequenceEqual(fr.Keys.Order()), "translation key mismatch");
            foreach (var key in en.Keys) {
                check(!string.IsNullOrWhiteSpace(en[key]) && !string.IsNullOrWhiteSpace(fr[key]), "empty translation " + key);
                check(Regex.Matches(en[key], @"\{\d+\}").Select(match => match.Value).Order().SequenceEqual(Regex.Matches(fr[key], @"\{\d+\}").Select(match => match.Value).Order()), "placeholder mismatch " + key);
            }
        });
        test("menus tooltips styles and sizes render entirely in the chosen language", () => {
            try {
                var registry = new WorkspaceRegistry(); registry.Update(new ClientMessage(1, "hello", new WorkspaceInfo("a", "Fixture", "C:/A", ["C:/A"], "A"), new StateSnapshot("working", "task_started", "session", Since: DateTimeOffset.UtcNow.AddSeconds(-30).ToString("O")), Settings: new TimingSettings(15, 600, ConfigurationVersion: 3)), Guid.NewGuid(), 1, DateTimeOffset.UtcNow);
                foreach (var code in new[] { "en", "fr" }) {
                    UiText.Select(code);
                    using var menu = TrayPresentation.CreateMenu(registry.Get("a")!, () => {}, openSettings: () => {});
                    check(menu.Items.Count == 10 && menu.Items[2].Text == UiText.Get("menu.open") && menu.Items[8].Text == UiText.Get("menu.settings") && menu.Items[9].Text == UiText.Get("menu.help"), "menu language");
                    check(TrayPresentation.Tooltip(registry.Get("a")!, DateTimeOffset.UtcNow).StartsWith("Fixture" + Environment.NewLine + UiText.Get("state.working")), "tooltip lines or language");
                    foreach (var style in IconStyles.All) check(IconStyles.Name(style) == UiText.Get("style." + IconStyles.Id(style)), "style language");
                    foreach (var size in IconSizes.All) check(IconSizes.Name(size) == UiText.Get("size." + IconSizes.Id(size)), "size language");
                }
            }
            finally { UiText.Select("fr"); }
        });
        test("both language dialogs save the preference and preserve custom numeric choices", () => {
            try {
                foreach (var code in new[] { "en", "fr" }) {
                    UiText.Select(code); TimingSettings? saved = null;
                    using var dialog = new TimingSettingsDialog("Fixture [SSH: fixture.example]", true, new(15, 600, ConfigurationVersion: 3), selected => { saved = selected; return Task.FromResult(true); });
                    check(dialog.Text.StartsWith(UiText.Get("settings.title")) && ((Button)dialog.AcceptButton!).Text == UiText.Get("button.save") && ((Button)dialog.CancelButton!).Text == UiText.Get("button.cancel"), "dialog language");
                    var language = (ComboBox)dialog.Controls.Find("language", true).Single();
                    check(language.Items.Cast<string>().SequenceEqual(UiText.Preferences.Select(choice => UiText.Get("language." + choice))), "language choices");
                    language.SelectedIndex = Array.IndexOf(UiText.Preferences, code);
                    var custom = (ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single();
                    check(custom.SelectedItem?.ToString() == "600", "custom value changed by translation");
                    check(dialog.SaveAsync().GetAwaiter().GetResult() && saved?.Language == code, "language preference not saved");
                }
            }
            finally { UiText.Select("fr"); }
        });
        test("English validation and failure messages remain English and invalid protocol languages are rejected", () => {
            try {
                UiText.Select("en"); using var dialog = new TimingSettingsDialog("Fixture", false, new(15, 600), _ => Task.FromResult(false));
                var input = (ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single(); input.Text = "1441";
                check(!dialog.TryGetSettings(out _) && ((Label)dialog.Controls.Find("feedback", true).Single()).Text.Contains("enter a number"), "validation language");
                input.Text = "30"; check(!dialog.SaveAsync().GetAwaiter().GetResult() && ((Label)dialog.Controls.Find("feedback", true).Single()).Text.StartsWith("Unable to save"), "failure language");
                var frame = new ClientMessage(1, "hello", new WorkspaceInfo("a", "Fixture", "C:/A", ["C:/A"], "A"), new StateSnapshot("idle", "task_complete", "session"), Settings: new TimingSettings(15, 60, Language: "de"));
                check(Protocol.Parse(Protocol.Serialize(frame)) is null, "invalid language accepted");
            }
            finally { UiText.Select("fr"); }
        });
    }
}
