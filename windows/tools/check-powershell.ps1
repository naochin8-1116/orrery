$ErrorActionPreference = 'Stop'
foreach ($file in @('src/wake.ps1','src/windows.ps1')) {
  $tokens=$null; $errors=$null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file),[ref]$tokens,[ref]$errors)
  if($errors.Count -gt 0) { throw ($errors | Out-String) }
  if($file -eq 'src/windows.ps1') {
    $source = $ast.Find({param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.Contains('public static class OrreryWindows')},$true)
    if($null -eq $source) { throw 'Native Win32 source missing' }
    Add-Type -TypeDefinition $source.Value
  }
}
Write-Output 'PASS: PowerShell syntax and Win32 interop compilation'
