param(
  [Parameter(Mandatory=$true)][ValidateSet('NewChat','Voice','StopVoice','Desktop','Restore')][string]$Action,
  [string]$Executable,
  [string]$Handle = '0',
  [string]$Style = '0'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OrreryWindows {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback,IntPtr parameter);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
  [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetParent(IntPtr child,IntPtr parent);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetStyle(IntPtr window,int index);
  [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)] public static extern IntPtr SetStyle(IntPtr window,int index,IntPtr value);
  public static IntPtr Worker() {
    var progman=FindWindow("Progman",null); if(progman==IntPtr.Zero) throw new Exception("Explorer desktop was not found.");
    IntPtr result; SendMessageTimeout(progman,0x052C,IntPtr.Zero,IntPtr.Zero,0,1000,out result);
    IntPtr worker=IntPtr.Zero;
    EnumWindows((window,param)=>{
      if(FindWindowEx(window,IntPtr.Zero,"SHELLDLL_DefView",null)!=IntPtr.Zero) {
        worker=FindWindowEx(IntPtr.Zero,window,"WorkerW",null);
        // Newer Explorer versions may put the wallpaper WorkerW below Progman.
        if(worker==IntPtr.Zero) worker=FindWindowEx(progman,IntPtr.Zero,"WorkerW",null);
      }
      return true;
    },IntPtr.Zero);
    if(worker==IntPtr.Zero) throw new Exception("Wallpaper host was not found. Use normal mode on this Windows version.");
    return worker;
  }
  public static long Parent(IntPtr child,IntPtr parent,long restoreStyle) {
    if(!IsWindow(child)) throw new Exception("ORRERY window no longer exists.");
    long previous=GetStyle(child,-16).ToInt64();
    SetParent(child,parent);
    if(GetParent(child)!=parent) throw new Exception("Windows refused desktop placement (DPI/session restrictions may apply).");
    long desired=parent==IntPtr.Zero?restoreStyle:((previous & ~0x80000000L) | 0x40000000L);
    SetStyle(child,-16,new IntPtr(desired));
    SetWindowPos(child,IntPtr.Zero,0,0,0,0,0x0001|0x0002|0x0004|0x0020|0x0040);
    return previous;
  }
}
'@
  if ($Action -eq 'Desktop' -or $Action -eq 'Restore') {
    $window = [IntPtr]([Int64]::Parse($Handle))
    if ($Action -eq 'Desktop') { $previous=[OrreryWindows]::Parent($window,[OrreryWindows]::Worker(),0) }
    else { $previous=[OrreryWindows]::Parent($window,[IntPtr]::Zero,[Int64]::Parse($Style)) }
    [Console]::WriteLine((@{ok=$true;style=$previous.ToString()} | ConvertTo-Json -Compress))
    exit 0
  }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if ([string]::IsNullOrWhiteSpace($Executable)) { throw 'Choose the target executable first.' }
  $expected = [IO.Path]::GetFullPath($Executable)
  $deadline = [DateTime]::UtcNow.AddSeconds(8)
  do {
    $targets = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($expected)) -ErrorAction SilentlyContinue | Where-Object {
      try { $_.Path -eq $expected -and $_.MainWindowHandle -ne [IntPtr]::Zero } catch { $false }
    })
    if($targets.Count -gt 1) { throw 'Multiple target app windows. Automatic operation stopped.' }
    if($targets.Count -eq 1) { break }
    Start-Sleep -Milliseconds 150
  } while([DateTime]::UtcNow -lt $deadline)
  if($targets.Count -ne 1) { throw 'No windowed instance of the selected executable was found.' }
  $target = $targets[0]
  $hwnd = $target.MainWindowHandle
  [void][OrreryWindows]::ShowWindow($hwnd,9)
  [void][OrreryWindows]::SetForegroundWindow($hwnd)
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  do {
    [uint32]$frontProcess = 0
    [void][OrreryWindows]::GetWindowThreadProcessId([OrreryWindows]::GetForegroundWindow(),[ref]$frontProcess)
    if ($frontProcess -eq $target.Id) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($frontProcess -ne $target.Id) { throw 'Could not focus the selected app. No input was sent.' }
  function Invoke-TargetButton([string[]]$Names) {
    $limit = [DateTime]::UtcNow.AddSeconds(7)
    do {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
      $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
      $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
      $candidates = @()
      foreach ($button in $buttons) {
        if ($button.Current.IsEnabled -and -not $button.Current.IsOffscreen -and ($Names -contains $button.Current.Name -or $Names -contains $button.Current.AutomationId)) {
          $pattern = $null
          if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $candidates += @{Button=$button; Pattern=$pattern} }
        }
      }
      if ($candidates.Count -gt 1) { throw 'Multiple matching buttons. Automatic operation stopped.' }
      if ($candidates.Count -eq 1) {
        # Invoke only a verified descendant of the selected app. Never send global keyboard shortcuts.
        $candidates[0].Pattern.Invoke()
        return
      }
      Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $limit)
    throw ('Supported button not found in the target app: ' + ($Names -join ', ') + '. Check whether this app/version provides the feature and accessibility controls.')
  }
  if ($Action -eq 'NewChat' -or $Action -eq 'Voice') {
    # Preflight voice support before creating a new chat: no destructive fallback shortcuts.
    if ($Action -eq 'Voice') {
      $root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
      $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      $supported=$false
      foreach($element in $all) { if(@('Start voice mode','Start voice','Voice mode','音声モードを開始','音声会話を開始','音声モード','composer.startVoiceMode') -contains $element.Current.Name -or @('composer.startVoiceMode') -contains $element.Current.AutomationId) { $supported=$true;break } }
      if(-not $supported) { throw 'Voice controls are not exposed by this app/version. No chat was created.' }
    }
    Invoke-TargetButton @('New chat','New task','New thread','新しいチャット','新規チャット','新しいタスク','新しいスレッド','newTask','newThread')
  }
  if ($Action -eq 'Voice') { Invoke-TargetButton @('Start voice mode','Start voice','Voice mode','音声モードを開始','音声会話を開始','音声モード','composer.startVoiceMode') }
  if ($Action -eq 'StopVoice') { Invoke-TargetButton @('End voice mode','End voice','音声モードを終了','音声会話を終了','composer.stopVoiceMode') }
  [Console]::WriteLine('{"ok":true}')
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
