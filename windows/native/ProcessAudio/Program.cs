using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text.Json;
using System.Threading;
[assembly: SupportedOSPlatform("windows")]

// Windows process loopback (Windows build 20348+). Only frequency magnitudes leave this process.
internal static class Program
{
    [MTAThread]
    static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--self-test") { Spectrum.SelfTest(); return 0; }
            if (args.Length != 1) throw new ArgumentException("Select an executable first.");
            if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348)) throw new PlatformNotSupportedException("Per-app audio requires Windows build 20348 or later (Windows 11 recommended).");
            using var process = FindProcess(args[0]);
            using var cancel = new CancellationTokenSource();
            _ = Task.Run(() => { Console.ReadLine(); cancel.Cancel(); });
            var activation = new Activation();
            activation.Open((uint)process.Id);
            var client = activation.Client!;
            var wave = new WaveFormat { Format = 1, Channels = 2, Rate = 44100, BytesPerSecond = 176400, BlockAlign = 4, Bits = 16, Extra = 0 };
            IntPtr format = Marshal.AllocHGlobal(Marshal.SizeOf<WaveFormat>());
            IAudioCaptureClient? capture = null;
            using var ready = new AutoResetEvent(false);
            try
            {
                Marshal.StructureToPtr(wave, format, false);
                // LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM. The format matches the Windows sample.
                Check(client.Initialize(0, 0x00020000 | 0x00040000 | 0x80000000, 0, 0, format, IntPtr.Zero));
                Check(client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle()));
                Guid captureId = typeof(IAudioCaptureClient).GUID;
                Check(client.GetService(ref captureId, out var obj)); capture = (IAudioCaptureClient)obj;
                Check(client.Start());
                Console.WriteLine(JsonSerializer.Serialize(new { ready = true, pid = process.Id }));
                var fft = new Spectrum();
                while (!cancel.IsCancellationRequested && !process.HasExited)
                {
                    ready.WaitOne(100);
                    Check(capture.GetNextPacketSize(out uint available));
                    while (available > 0)
                    {
                        Check(capture.GetBuffer(out IntPtr data, out uint frames, out uint flags, out _, out _));
                        try
                        {
                            if (frames > 441000) throw new InvalidOperationException("Unexpected audio packet size.");
                            var samples = new short[checked((int)frames * 2)];
                            if ((flags & 2) == 0) Marshal.Copy(data, samples, 0, samples.Length); // AUDCLNT_BUFFERFLAGS_SILENT
                            fft.Add(samples);
                        }
                        finally { Check(capture.ReleaseBuffer(frames)); }
                        Check(capture.GetNextPacketSize(out available));
                    }
                }
                Check(client.Stop());
            }
            finally
            {
                Marshal.FreeHGlobal(format);
                if (capture is not null) Marshal.ReleaseComObject(capture);
                Marshal.ReleaseComObject(client);
                GC.KeepAlive(activation);
            }
            return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
    }
    static Process FindProcess(string exe)
    {
        string expected = Path.GetFullPath(exe);
        var matches = new List<Process>();
        foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(exe)))
        {
            try { if (string.Equals(p.MainModule?.FileName, expected, StringComparison.OrdinalIgnoreCase) && p.MainWindowHandle != IntPtr.Zero) { matches.Add(p); continue; } } catch { }
            p.Dispose();
        }
        if (matches.Count != 1) { foreach (var p in matches) p.Dispose(); throw new InvalidOperationException("Open exactly one windowed instance of the selected executable. No fallback to system-wide audio is performed."); }
        return matches[0];
    }
    internal static void Check(int hr) { Marshal.ThrowExceptionForHR(hr); }
}

[ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivateAudioInterfaceCompletionHandler { [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation); }
[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivateAudioInterfaceAsyncOperation { [PreserveSig] int GetActivateResult(out int result, [MarshalAs(UnmanagedType.IUnknown)] out object activated); }
[ComVisible(true), Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAgileObject { }
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class Activation : IActivateAudioInterfaceCompletionHandler, IAgileObject
{
    [DllImport("Mmdevapi.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    static extern int ActivateAudioInterfaceAsync(string device, ref Guid iid, IntPtr parameters, IActivateAudioInterfaceCompletionHandler completion, out IActivateAudioInterfaceAsyncOperation operation);
    readonly ManualResetEventSlim completed = new(false);
    int result = unchecked((int)0x80004005);
    public IAudioClient? Client;
    public void Open(uint pid)
    {
        // AUDIOCLIENT_ACTIVATION_PARAMS: ActivationType, TargetProcessId, ProcessLoopbackMode(include=0).
        IntPtr blob = Marshal.AllocHGlobal(12), variant = Marshal.AllocHGlobal(24);
        IActivateAudioInterfaceAsyncOperation? operation = null;
        try
        {
            Marshal.WriteInt32(blob, 0, 1); Marshal.WriteInt32(blob, 4, checked((int)pid)); Marshal.WriteInt32(blob, 8, 0);
            // PROPVARIANT x64: vt at 0; BLOB cbSize at 8; pBlobData at 16.
            for (int i = 0; i < 24; i++) Marshal.WriteByte(variant, i, 0);
            Marshal.WriteInt16(variant, 0, 65); Marshal.WriteInt32(variant, 8, 12); Marshal.WriteIntPtr(variant, 16, blob);
            var iid = typeof(IAudioClient).GUID;
            Program.Check(ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, variant, this, out operation));
            if (!completed.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("Audio activation timed out.");
            Program.Check(result);
        }
        finally { Marshal.FreeHGlobal(variant); Marshal.FreeHGlobal(blob); if (operation is not null) Marshal.ReleaseComObject(operation); }
    }
    public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
    {
        try { Program.Check(operation.GetActivateResult(out result, out object obj)); if (result >= 0) Client = (IAudioClient)obj; }
        catch (Exception e) { result = e.HResult; }
        finally { completed.Set(); }
        return 0;
    }
}
[StructLayout(LayoutKind.Sequential, Pack = 2)]
struct WaveFormat { public ushort Format, Channels; public uint Rate, BytesPerSecond; public ushort BlockAlign, Bits, Extra; }
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioClient
{
    [PreserveSig] int Initialize(int shareMode, uint flags, long duration, long periodicity, IntPtr format, IntPtr session);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int mode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    [PreserveSig] int Start(); [PreserveSig] int Stop(); [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}
[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioCaptureClient
{
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
}
sealed class Spectrum
{
    const int Size = 512;
    readonly double[] window = new double[Size], real = new double[Size], imaginary = new double[Size];
    readonly Stopwatch clock = Stopwatch.StartNew();
    int offset; long last = -100;
    readonly Action<int[]> emit;
    public Spectrum(Action<int[]>? output = null) { emit = output ?? (bins => Console.WriteLine(JsonSerializer.Serialize(new { bins }))); }
    public static void SelfTest()
    {
        int[]? result = null;
        var spectrum = new Spectrum(bins => result = bins);
        var samples = new short[Size*2];
        for (int i=0;i<Size;i++) samples[i*2]=samples[i*2+1]=(short)(1000*Math.Sin(2*Math.PI*20*i/Size));
        spectrum.Add(samples);
        if(result is null || result.Length!=128 || Array.IndexOf(result,result.Max())!=20) throw new Exception("FFT sine-wave test failed.");
        result=null;
        new Spectrum(bins => result=bins).Add(new short[Size*2]);
        if(result is null || result.Any(b=>b!=0)) throw new Exception("FFT silence test failed.");
        Console.WriteLine("PASS: native FFT sine-wave peak and silence");
    }
    public void Add(short[] stereo)
    {
        for (int s = 0; s < stereo.Length; s += 2)
        {
            window[offset] = (stereo[s] + stereo[s+1]) / 65536.0; offset++;
            if (offset < Size) continue;
            offset = 0;
            if (clock.ElapsedMilliseconds - last < 33) continue;
            last = clock.ElapsedMilliseconds;
            for (int i=0;i<Size;i++) { real[i] = window[i]*(0.5-0.5*Math.Cos(2*Math.PI*i/(Size-1))); imaginary[i] = 0; }
            for (int i=1,j=0;i<Size;i++) { int bit=Size>>1; for (;(j&bit)!=0;bit>>=1) j^=bit; j^=bit; if(i<j) { (real[i],real[j])=(real[j],real[i]); } }
            for (int length=2;length<=Size;length<<=1)
            {
                double angle=-2*Math.PI/length;
                for (int start=0;start<Size;start+=length)
                    for(int j=0;j<length/2;j++)
                    {
                        int a=start+j,b=a+length/2; double c=Math.Cos(angle*j),d=Math.Sin(angle*j);
                        double r=real[b]*c-imaginary[b]*d, im=real[b]*d+imaginary[b]*c;
                        real[b]=real[a]-r; imaginary[b]=imaginary[a]-im; real[a]+=r; imaginary[a]+=im;
                    }
            }
            var bins=new byte[128];
            for(int i=0;i<128;i++) { double magnitude=Math.Sqrt(real[i]*real[i]+imaginary[i]*imaginary[i])/Size; double db=20*Math.Log10(Math.Max(1e-10,magnitude)); bins[i]=(byte)Math.Clamp((db+90)/65*255,0,255); }
            // Cast to int[]: System.Text.Json serializes byte[] as Base64, not a numeric array.
            emit(bins.Select(b => (int)b).ToArray());
        }
    }
}
