# Opens an already installed CareConnect APK in the project's official emulator.
# SDK/runtime settings apply only to this process and its children.
[CmdletBinding()]
param(
    [ValidateSet('Patient', 'Caretaker', 'PatientPrevious', 'CaretakerPrevious')]
    [string]$App
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = Join-Path $taskProjectRoot '.cache\android-runtime'
$taskSdk = Join-Path $taskRuntime 'sdk'
$taskJava = Join-Path $taskRuntime 'android-studio\jbr'
$taskUser = Join-Path $taskRuntime 'user'
$taskAvds = Join-Path $taskRuntime 'avd'
$taskAdb = Join-Path $taskSdk 'platform-tools\adb.exe'
$taskEmulator = Join-Path $taskSdk 'emulator\emulator.exe'
$taskAvdName = 'CareConnect_Laptop'
$taskSerial = 'emulator-5560'
$taskPort = 5560

function Invoke-AndroidCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [string[]]$Arguments = @(),
        [int]$TimeoutSeconds = 15
    )

    # Every argument used below is an owned command token, not a file path or
    # free-form user input. FileName itself accepts the complete path with spaces.
    foreach ($taskArgument in $Arguments) {
        if ($taskArgument -match '[\s"]') {
            throw 'An unsupported Android command argument was encountered.'
        }
    }
    $taskInfo = New-Object System.Diagnostics.ProcessStartInfo
    $taskInfo.FileName = $Executable
    $taskInfo.Arguments = $Arguments -join ' '
    $taskInfo.UseShellExecute = $false
    $taskInfo.CreateNoWindow = $true
    $taskInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $taskInfo.RedirectStandardOutput = $true
    $taskInfo.RedirectStandardError = $true
    $taskProcess = New-Object System.Diagnostics.Process
    $taskProcess.StartInfo = $taskInfo
    try {
        if (-not $taskProcess.Start()) { throw 'The Android command could not start.' }
        $taskOutput = $taskProcess.StandardOutput.ReadToEndAsync()
        $taskErrors = $taskProcess.StandardError.ReadToEndAsync()
        if (-not $taskProcess.WaitForExit($TimeoutSeconds * 1000)) {
            if (-not $taskProcess.HasExited) { $taskProcess.Kill() }
            throw 'An Android command timed out. Wait for the emulator, then try again.'
        }
        if (-not $taskOutput.Wait(1000) -or -not $taskErrors.Wait(1000)) {
            throw 'The Android command response could not be confirmed. Please retry.'
        }
        return [PSCustomObject]@{
            ExitCode = $taskProcess.ExitCode
            Output = $taskOutput.Result.Trim()
            Error = $taskErrors.Result.Trim()
        }
    }
    finally {
        $taskProcess.Dispose()
    }
}

function Get-TargetDeviceState {
    $taskDevices = Invoke-AndroidCommand -Executable $taskAdb -Arguments @('devices')
    if ($taskDevices.ExitCode -ne 0) {
        throw 'Android devices could not be checked. Please retry the launcher.'
    }
    $taskMatch = [regex]::Match($taskDevices.Output, '(?m)^emulator-5560\s+(\S+)')
    if ($taskMatch.Success) { return $taskMatch.Groups[1].Value }
    return 'missing'
}

function Assert-TargetAvd {
    $taskName = Invoke-AndroidCommand -Executable $taskAdb -Arguments @('-s', $taskSerial, 'emu', 'avd', 'name')
    $taskLines = @($taskName.Output -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne 'OK' })
    if ($taskName.ExitCode -ne 0 -or $taskLines.Count -ne 1 -or $taskLines[0].Trim() -ne $taskAvdName) {
        throw 'Port 5560 belongs to a different or unverified emulator. Close it normally or ask for help; this launcher will not replace it.'
    }
}

try {
    Write-Host ''
    Write-Host 'CareConnect Android APK launcher'
    Write-Host ''
    if (-not $App) {
        do {
            Write-Host '1 - Patient Latest (new face detection)'
            Write-Host '2 - Caretaker Latest'
            Write-Host '3 - Previous patient app'
            Write-Host '4 - Previous caretaker app'
            Write-Host 'Q - Cancel'
            $taskChoice = (Read-Host 'Choose an app').Trim().ToLowerInvariant()
            switch ($taskChoice) {
                '1' { $App = 'Patient' }
                'patient' { $App = 'Patient' }
                '2' { $App = 'Caretaker' }
                'caretaker' { $App = 'Caretaker' }
                '3' { $App = 'PatientPrevious' }
                'previous' { $App = 'PatientPrevious' }
                '4' { $App = 'CaretakerPrevious' }
                'q' { exit 0 }
                default { Write-Host 'Please choose 1, 2, 3, 4 or Q.' }
            }
        } while (-not $App)
    }

    foreach ($taskFile in @($taskAdb, $taskEmulator, (Join-Path $taskJava 'bin\java.exe'))) {
        if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) {
            throw 'The official Android runtime is incomplete. Ask to finish Android emulator setup before opening the APK.'
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $taskAvds ($taskAvdName + '.ini')) -PathType Leaf)) {
        throw 'The CareConnect_Laptop Android device has not been created. Ask to finish emulator setup; this launcher does not create or reset devices.'
    }

    $env:ANDROID_HOME = $taskSdk
    $env:ANDROID_SDK_ROOT = $taskSdk
    $env:ANDROID_USER_HOME = $taskUser
    $env:ANDROID_AVD_HOME = $taskAvds
    $env:JAVA_HOME = $taskJava
    $env:ANDROID_SERIAL = $taskSerial
    $env:PATH = (Join-Path $taskJava 'bin') + ';' + (Join-Path $taskSdk 'platform-tools') + ';' + (Join-Path $taskSdk 'emulator') + ';' + $env:PATH

    $taskAcceleration = Invoke-AndroidCommand -Executable $taskEmulator -Arguments @('-accel-check') -TimeoutSeconds 20
    $taskAccelerationCode = [regex]::Match(($taskAcceleration.Output + "`n" + $taskAcceleration.Error), '(?m)^\s*accel:\s*\r?\n\s*(-?\d+)\s*$')
    if ($taskAcceleration.ExitCode -ne 0 -or -not $taskAccelerationCode.Success -or $taskAccelerationCode.Groups[1].Value -ne '0') {
        throw 'Android hardware acceleration is not ready. Ask to finish the emulator setup; this launcher will not change Windows features or restart the laptop.'
    }

    $taskDeviceState = Get-TargetDeviceState
    if ($taskDeviceState -eq 'unauthorized') {
        throw 'The Android device requires authorization. Complete it normally, then retry.'
    }
    if ($taskDeviceState -eq 'missing') {
        $taskPortBusy = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq $taskPort }).Count -gt 0
        if ($taskPortBusy) {
            throw 'Emulator port 5560 is already in use or a device is starting. Wait for it to finish, then retry; no second device will be started.'
        }
        Write-Host 'Starting the visible CareConnect Android device...'
        # This is the requested visible app window. All helper calls stay hidden.
        # This software-graphics cold-boot configuration started successfully
        # on this laptop. Disk-installed apps and their data stay intact.
        Start-Process -FilePath $taskEmulator -ArgumentList @('-avd', $taskAvdName, '-port', [string]$taskPort, '-gpu', 'software', '-no-snapshot-load', '-no-boot-anim') -WorkingDirectory $taskRuntime -WindowStyle Normal -RedirectStandardOutput (Join-Path $taskRuntime 'emulator-launcher.stdout.log') -RedirectStandardError (Join-Path $taskRuntime 'emulator-launcher.stderr.log') | Out-Null
    }

    Write-Host 'Waiting for Android to finish starting (up to four minutes)...'
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(240)
    $taskBootReady = $false
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        $taskDeviceState = Get-TargetDeviceState
        if ($taskDeviceState -eq 'unauthorized') {
            throw 'The Android device requires authorization. Complete it normally, then retry.'
        }
        if ($taskDeviceState -eq 'device') {
            $taskBoot = Invoke-AndroidCommand -Executable $taskAdb -Arguments @('-s', $taskSerial, 'shell', 'getprop', 'sys.boot_completed') -TimeoutSeconds 10
            if ($taskBoot.ExitCode -eq 0 -and $taskBoot.Output -eq '1') {
                $taskBootReady = $true
                break
            }
        }
        Start-Sleep -Seconds 2
    }
    if (-not $taskBootReady) {
        throw 'Android did not finish booting in four minutes. Keep the emulator open, wait, then retry. No app or device data was removed.'
    }
    Assert-TargetAvd

    $taskPackage = switch ($App) {
        'Patient' { 'com.careconnect.patient' }
        'PatientPrevious' { 'com.careconnect.patient.preview' }
        'Caretaker' { 'com.careconnect.caretaker' }
        'CaretakerPrevious' { 'com.careconnect.caretaker.preview' }
    }
    $taskInstalled = Invoke-AndroidCommand -Executable $taskAdb -Arguments @('-s', $taskSerial, 'shell', 'pm', 'path', $taskPackage)
    if ($taskInstalled.ExitCode -ne 0 -or $taskInstalled.Output -notmatch '(?m)^package:') {
        throw "$App is not installed on CareConnect_Laptop. Ask to install the correct $App APK, then retry. This launcher will not install an older download."
    }
    $taskActivity = Invoke-AndroidCommand -Executable $taskAdb -Arguments @('-s', $taskSerial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', $taskPackage)
    $taskActivityPattern = '^' + [regex]::Escape($taskPackage) + '/[A-Za-z0-9_.$]+$'
    $taskComponents = @($taskActivity.Output -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match $taskActivityPattern })
    if ($taskActivity.ExitCode -ne 0 -or $taskComponents.Count -ne 1) {
        throw "$App has no confirmed launcher activity. Ask to check the installed APK; this launcher will not reinstall it."
    }
    $taskLaunch = Invoke-AndroidCommand -Executable $taskAdb -Arguments @('-s', $taskSerial, 'shell', 'am', 'start', '-W', '-n', $taskComponents[0]) -TimeoutSeconds 30
    if ($taskLaunch.ExitCode -ne 0 -or ($taskLaunch.Output + $taskLaunch.Error) -match '(?im)^\s*(Error:|Exception)') {
        throw "$App could not be opened. Check the emulator window and retry; its installed APK was kept."
    }
    Write-Host ''
    Write-Host "$App launch completed on CareConnect_Laptop."
    Write-Host 'If Android shows a lock screen, unlock it normally. Sign in using your own account.'
    Write-Host 'The installed APK is used as-is; no download was installed or permissions changed.'
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('Could not open CareConnect: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
