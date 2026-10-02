using System.Text;

namespace CodexStatusTray.Core;

public sealed record TimingSettings(double ExitGraceSeconds, double StaleWorkingMinutes, bool ExitWhenNoWindows = true, int ConfigurationVersion = 1, string Language = "auto", string WorkspaceLabel = "", bool? NotificationsEnabled = null, string NotificationSound = NotificationSounds.DefaultMode, string NotificationSoundFile = "")
{
    public const int DefaultExitGraceSeconds = 15;
    // Validate the legacy wire field without allowing it to control the process lifetime.
    public bool Valid => double.IsFinite(ExitGraceSeconds) && ExitGraceSeconds >= 5 && ExitGraceSeconds <= 300
        && TimingSettingSpec.Find("stale_working_minutes")!.Accepts(StaleWorkingMinutes) && UiText.ValidPreference(Language)
        && (ConfigurationVersion < 5 || NotificationsEnabled is not null)
        && NotificationSounds.ValidMode(NotificationSound) && NotificationSounds.ValidFilePath(NotificationSoundFile)
        && WorkspaceLabel is not null && WorkspaceLabel.Length <= 256 && !WorkspaceLabel.Any(char.IsControl);
    public static bool ValidLabel(string value)
    {
        if (value.Length > 8) return false;
        var runes = value.EnumerateRunes().ToArray();
        if (runes.Length == 0) return true;
        var category = System.Text.Rune.GetUnicodeCategory(runes[0]);
        return (System.Text.Rune.IsLetter(runes[0]) || category is System.Globalization.UnicodeCategory.DecimalDigitNumber or System.Globalization.UnicodeCategory.LetterNumber or System.Globalization.UnicodeCategory.OtherNumber)
            && runes.Skip(1).All(rune => System.Text.Rune.GetUnicodeCategory(rune) is System.Globalization.UnicodeCategory.NonSpacingMark or System.Globalization.UnicodeCategory.SpacingCombiningMark or System.Globalization.UnicodeCategory.EnclosingMark);
    }
}

public static class NotificationSounds
{
    public const string DefaultMode = "chatgpt";
    public static readonly string[] Modes = ["chatgpt", "windows", "silent", "custom"];
    public static bool ValidMode(string value) => Modes.Contains(value);
    public static bool ValidFilePath(string value) => value is not null && value.Length <= 2048 && !value.Any(char.IsControl)
        && (value.Length == 0 || System.Text.RegularExpressions.Regex.IsMatch(value, @"^[a-z]:[\\/].*\.wav$", System.Text.RegularExpressions.RegexOptions.IgnoreCase));
}

public sealed record TimingSettingSpec(string Key, double Minimum, double Maximum, double[] Presets)
{
    public string Label => UiText.Get(Key + ".label");
    public string Unit => UiText.Get(Key + ".unit");
    public static readonly TimingSettingSpec[] All = [
        new("stale_working_minutes", 5, 1440, [5, 15, 30, 60, 120, 240, 1440])
    ];
    public static TimingSettingSpec? Find(string key) => All.FirstOrDefault(setting => setting.Key == key);
    public bool Accepts(double value) => double.IsFinite(value) && value >= Minimum && value <= Maximum;
    public double[] Choices(double current) => Presets.Append(current).Where(Accepts).Distinct().Order().ToArray();
}
