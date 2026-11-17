param([Parameter(Mandatory=$true)][string]$Phrase, [Parameter(Mandatory=$true)][string]$Locale)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo($Locale)
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
  $builder = New-Object System.Speech.Recognition.GrammarBuilder
  $builder.Culture = $culture
  $choices = New-Object System.Speech.Recognition.Choices
  $phrases = @($Phrase.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if($phrases.Count -lt 1 -or $phrases.Count -gt 8) { throw 'Configure 1 to 8 wake phrases.' }
  $choices.Add([string[]]$phrases)
  $builder.Append($choices)
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.Grammar($builder)))
  $recognizer.SetInputToDefaultAudioDevice()
  [Console]::WriteLine('READY')
  while ($true) {
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(3))
    if ($null -ne $result -and $result.Confidence -ge 0.65) { [Console]::WriteLine('WAKE') }
  }
} catch {
  [Console]::Error.WriteLine('Offline speech unavailable. Install the matching Windows speech language and allow microphone access. ' + $_.Exception.Message)
  exit 1
} finally { if ($null -ne $recognizer) { $recognizer.Dispose() } }
