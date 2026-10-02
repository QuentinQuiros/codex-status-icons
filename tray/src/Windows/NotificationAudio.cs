using System.Buffers.Binary;
using System.Media;

namespace CodexStatusTray.Windows;

public static class NotificationAudio
{
    public const int MaximumBytes = 5 * 1024 * 1024;
    private static readonly Lazy<byte[]?> chatGPT = new(() => {
        using var stream = typeof(NotificationAudio).Assembly.GetManifestResourceStream("CodexStatusTray.Audio.ChatGPT.wav");
        if (stream is null || stream.Length is < 44 or > MaximumBytes) return null;
        var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
        return ValidWave(bytes) ? bytes : null;
    });
    public static byte[]? ReadChatGPT() => chatGPT.Value?.ToArray();
    public static byte[]? ReadWave(string filename)
    {
        if (!Core.NotificationSounds.ValidFilePath(filename) || filename.Length == 0) return null;
        try {
            using var stream = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length is < 44 or > MaximumBytes) return null;
            var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
            return ValidWave(bytes) ? bytes : null;
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException or ArgumentException or NotSupportedException) { return null; }
    }
    public static bool ValidWave(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length is < 44 or > MaximumBytes || !bytes[..4].SequenceEqual("RIFF"u8) || !bytes.Slice(8, 4).SequenceEqual("WAVE"u8)
            || BinaryPrimitives.ReadUInt32LittleEndian(bytes[4..]) != bytes.Length - 8) return false;
        uint byteRate = 0, dataSize = 0; ushort blockAlign = 0; var hasFormat = false;
        var offset = 12;
        for (; offset + 8 <= bytes.Length;) {
            var size = BinaryPrimitives.ReadUInt32LittleEndian(bytes[(offset + 4)..]);
            if (size > bytes.Length - offset - 8) return false;
            var data = bytes.Slice(offset + 8, (int)size);
            if (bytes.Slice(offset, 4).SequenceEqual("fmt "u8)) {
                if (data.Length < 16 || BinaryPrimitives.ReadUInt16LittleEndian(data) != 1) return false;
                var channels = BinaryPrimitives.ReadUInt16LittleEndian(data[2..]); var sampleRate = BinaryPrimitives.ReadUInt32LittleEndian(data[4..]);
                byteRate = BinaryPrimitives.ReadUInt32LittleEndian(data[8..]); blockAlign = BinaryPrimitives.ReadUInt16LittleEndian(data[12..]);
                var bits = BinaryPrimitives.ReadUInt16LittleEndian(data[14..]);
                if (channels is < 1 or > 2 || sampleRate is < 8000 or > 192000 || bits is not (8 or 16)
                    || blockAlign != channels * bits / 8 || byteRate != sampleRate * blockAlign) return false;
                hasFormat = true;
            } else if (bytes.Slice(offset, 4).SequenceEqual("data"u8)) dataSize += size;
            offset += 8 + (int)size + ((int)size & 1);
        }
        return offset == bytes.Length && hasFormat && dataSize > 0 && blockAlign > 0 && dataSize % blockAlign == 0 && dataSize / (double)byteRate <= 30;
    }
}

// Play only after Windows reports that the banner is visible, never when queued
// or suppressed. The Shell sound is disabled for ChatGPT, silent and custom modes.
public sealed class NotificationSoundPlayback : IDisposable
{
    private readonly Action<byte[]> play;
    private readonly Action stop;
    private byte[]? pending;
    private SoundPlayer? player;
    public NotificationSoundPlayback(Action<byte[]>? play = null, Action? stop = null)
    {
        this.play = play ?? (bytes => { player?.Stop(); player?.Dispose(); player = new SoundPlayer(new MemoryStream(bytes, writable: false)); player.Load(); player.Play(); });
        this.stop = stop ?? (() => player?.Stop());
    }
    public void Prepare(string mode, string file) { pending = mode switch {
        "chatgpt" => NotificationAudio.ReadChatGPT(),
        "custom" => NotificationAudio.ReadWave(file),
        _ => null
    }; }
    public void Shown()
    {
        var bytes = pending; pending = null;
        if (bytes is null) return;
        try { play(bytes); } catch (Exception error) when (error is IOException or InvalidOperationException or System.ComponentModel.Win32Exception) { /* Keep the notification visible if audio is unavailable. */ }
    }
    public void Closed() => pending = null;
    public void Disable() { pending = null; stop(); }
    public void Dispose() { Disable(); player?.Dispose(); }
}
