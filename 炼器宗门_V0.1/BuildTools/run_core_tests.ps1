[CmdletBinding()]
param(
    [string]$Compiler = 'D:\Program Files\VisualStudioProject\MSBuild\Current\Bin\Roslyn\csc.exe'
)

# Local, append-only verification. No dependency installation, network, or deletion.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$verification = Join-Path $root 'Verification'
$core = Join-Path $root 'LianQiSectPrototype\Assets\LianQi\Core'
$tests = Join-Path $root 'Tests\ConsoleTests.cs'
$exe = Join-Path $verification 'ConsoleTests.exe'
$jsonReport = Join-Path $verification 'core_test_results.json'
$textReport = Join-Path $verification 'core_test_output.txt'
$runDirectory = $null
$compileExit = $null
$compilerInfo = $null
$reference = $null

function Write-NewUtf8([string]$Path, [string]$Text) {
    $bytes = $utf8.GetBytes($Text)
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}

function Preserve-Existing([string]$Path, [string]$Directory) {
    if ([System.IO.Directory]::Exists($Path)) { throw "Expected a file, found a directory: $Path" }
    if ([System.IO.File]::Exists($Path)) {
        $leaf = [System.IO.Path]::GetFileName($Path)
        $suffix = [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfffffff') + '_' + [Guid]::NewGuid().ToString('N')
        $backup = Join-Path $Directory ($leaf + '.backup_' + $suffix)
        $preserved = Join-Path $Directory ($leaf + '.preserved_' + $suffix)
        # First copy to an exclusive backup, then move the original out of the target.
        # Every new destination must be absent. The original and backup both survive.
        [System.IO.File]::Copy($Path, $backup, $false)
        if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash) {
            throw "Backup hash mismatch; original left untouched: $Path"
        }
        [System.IO.File]::Move($Path, $preserved)
        Write-Host "Preserved existing file: $preserved"
    }
}

function Publish-NewCopy([string]$Source, [string]$Destination, [string]$Archive) {
    Preserve-Existing $Destination $Archive
    [System.IO.File]::Copy($Source, $Destination, $false)
}

try {
    foreach ($dir in @($verification, $core, (Join-Path $root 'Tests'))) {
        if (-not [System.IO.Directory]::Exists($dir)) { throw "Required existing directory missing: $dir" }
    }
    $sources = @((Join-Path $core 'ForgeGame.cs'), (Join-Path $core 'SaveStore.cs'), $tests)
    foreach ($source in $sources) {
        if (-not [System.IO.File]::Exists($source)) { throw "Required source missing: $source" }
    }
    if (-not [System.IO.File]::Exists($Compiler)) {
        $candidates = @(
            (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
            (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
        )
        $Compiler = $candidates | Where-Object { [System.IO.File]::Exists($_) } | Select-Object -First 1
        if (-not $Compiler) { throw 'No local C# compiler available.' }
    }
    $Compiler = [System.IO.Path]::GetFullPath($Compiler)
    $references = @(
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Web.Extensions.dll'),
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\System.Web.Extensions.dll')
    )
    $reference = $references | Where-Object { [System.IO.File]::Exists($_) } | Select-Object -First 1
    if (-not $reference) { throw 'Local System.Web.Extensions.dll not found.' }
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfffffff') + '_' + [Guid]::NewGuid().ToString('N')
    $runDirectory = Join-Path $verification ('core_tests_' + $stamp)
    if ([System.IO.Directory]::Exists($runDirectory) -or [System.IO.File]::Exists($runDirectory)) { throw 'Unique run directory collision.' }
    [System.IO.Directory]::CreateDirectory($runDirectory) | Out-Null
    $coreBefore = @{}
    foreach ($source in $sources[0..1]) { $coreBefore[$source] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash }

    # This backup happens before a repeat compilation, as required.
    # Compile into the unique run folder, never into an existing user's executable.
    if ([System.IO.File]::Exists($exe)) {
        $backup = Join-Path $runDirectory ('ConsoleTests.exe.precompile_backup_' + $stamp)
        [System.IO.File]::Copy($exe, $backup, $false)
        if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash) { throw 'Precompile executable backup hash mismatch.' }
    }
    $runExe = Join-Path $runDirectory 'ConsoleTests.exe'
    if ([System.IO.File]::Exists($runExe)) { throw 'Refusing to compile over an existing executable.' }
    $arguments = @('/nologo', '/target:exe', '/platform:anycpu', '/optimize+', '/codepage:65001', ('/out:' + $runExe), ('/reference:' + $reference)) + $sources
    Write-Host "Compiler: $Compiler"
    $compileLines = @(& $Compiler $arguments 2>&1)
    $compileExit = $LASTEXITCODE
    $compilerInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Compiler).FileVersion
    $compileText = "Compiler: $Compiler`r`nVersion: $compilerInfo`r`nReference: $reference`r`nExit: $compileExit`r`n" + (($compileLines | ForEach-Object { $_.ToString() }) -join "`r`n")
    Write-NewUtf8 (Join-Path $runDirectory 'compiler_output.txt') $compileText
    if ($compileExit -ne 0 -or -not [System.IO.File]::Exists($runExe)) { throw "Compilation failed ($compileExit); see $runDirectory\compiler_output.txt" }

    # Preserve every earlier fixed-name output before publishing a new one.
    Publish-NewCopy $runExe $exe $runDirectory
    $testLines = @(& $runExe $runDirectory $Compiler 2>&1)
    $testExit = $LASTEXITCODE
    foreach ($line in $testLines) { Write-Host $line.ToString() }
    Write-NewUtf8 (Join-Path $runDirectory 'process_output.txt') (($testLines | ForEach-Object { $_.ToString() }) -join "`r`n")
    $runJson = Join-Path $runDirectory 'core_test_results.json'
    $runText = Join-Path $runDirectory 'core_test_output.txt'
    if (-not [System.IO.File]::Exists($runJson) -or -not [System.IO.File]::Exists($runText)) { throw "Test harness did not produce reports (exit $testExit). See process_output.txt." }
    $report = [System.IO.File]::ReadAllText($runJson, $utf8) | ConvertFrom-Json
    if ($report.total -le 0 -or $report.total -ne ($report.passed + $report.failed)) { throw 'Invalid report counts.' }
    foreach ($source in $sources[0..1]) {
        $after = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        if ($after -ne $coreBefore[$source]) { throw "Product source changed during verification: $source" }
    }
    $evidence = [ordered]@{
        compiler = $Compiler
        compilerVersion = $compilerInfo
        reference = $reference
        compileExit = $compileExit
        testExit = $testExit
        coreUnchanged = $true
        coreSHA256 = $coreBefore
        runDirectory = $runDirectory
        reportsAreUtf8 = $true
        oldOutputsPreserved = $true
    }
    Write-NewUtf8 (Join-Path $runDirectory 'execution_metadata.json') ($evidence | ConvertTo-Json -Depth 5)
    Publish-NewCopy $runJson $jsonReport $runDirectory
    Publish-NewCopy $runText $textReport $runDirectory
    Write-Host "TOTAL $($report.total); PASS $($report.passed); FAIL $($report.failed); CORE_UNCHANGED=True"
    Write-Host "JSON report: $jsonReport"
    Write-Host "Text report: $textReport"
    Write-Host "Retained artifacts: $runDirectory"
    # No Read-Host, UI, or indefinite wait: terminate with the actual test exit code.
    exit $testExit
}
catch {
    $failureMessage = $_.Exception.Message
    if ($runDirectory -and [System.IO.Directory]::Exists($runDirectory)) {
        try {
            $failureJson = Join-Path $runDirectory 'core_test_results.json'
            $failureText = Join-Path $runDirectory 'core_test_output.txt'
            if (-not [System.IO.File]::Exists($failureJson) -and -not [System.IO.File]::Exists($failureText)) {
                $failureReport = [ordered]@{
                    suite = 'LianQi V0.1 direct C# core verification'
                    status = 'blocked_before_test_results'
                    plannedCases = 187
                    total = 0
                    passed = 0
                    failed = 0
                    notRun = 187
                    compiler = $Compiler
                    compilerVersion = $compilerInfo
                    compileExit = $compileExit
                    reference = $reference
                    artifactDirectory = $runDirectory
                    infrastructureError = $failureMessage
                    productDefects = @()
                    productDefectsAssessment = 'Not established: runtime verification did not complete.'
                }
                Write-NewUtf8 $failureJson ($failureReport | ConvertTo-Json -Depth 5)
                Write-NewUtf8 $failureText ("BLOCKED: $failureMessage`r`nPLANNED 187; EXECUTED 0; PASS 0; FAIL 0; NOT_RUN 187`r`nNo product defect conclusion is possible without execution.`r`nArtifacts: $runDirectory`r`n")
                Publish-NewCopy $failureJson $jsonReport $runDirectory
                Publish-NewCopy $failureText $textReport $runDirectory
            }
        }
        catch { Write-Warning "Could not publish a blocked-run report: $($_.Exception.Message)" }
    }
    Write-Error -Message $failureMessage -ErrorAction Continue
    exit 2
}
