param([ValidateSet('Start','Pause','Resume','Status')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
$taskDirectory = $PSScriptRoot
$taskWork = Join-Path $taskDirectory 'library-work'
$pauseFlag = Join-Path $taskWork 'PAUSE'
if ($Action -eq 'Pause') {
    New-Item -ItemType File -Force -Path $pauseFlag | Out-Null
    Write-Output 'Pausing Library processing; completed windows will be kept.'
    exit
}
if ($Action -eq 'Status') {
    Start-Process -FilePath (Join-Path $taskWork 'status.html')
    exit
}
if ($Action -eq 'Resume' -and (Test-Path -LiteralPath $pauseFlag)) { Remove-Item -LiteralPath $pauseFlag }
$runnerLock = Join-Path $taskWork 'runner.lock.json'
if (Test-Path -LiteralPath $runnerLock) {
    $runnerId = (Get-Content -Raw -LiteralPath $runnerLock | ConvertFrom-Json).pid
    if (Get-Process -Id $runnerId -ErrorAction SilentlyContinue) { Write-Output "Library runner is active (PID $runnerId)."; exit }
}
$taskPython = (Get-Command python.exe).Source
$taskProcess = Start-Process -FilePath $taskPython -ArgumentList @('-u','library-runner.py') -WorkingDirectory $taskDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskWork 'runner.stdout.log') -RedirectStandardError (Join-Path $taskWork 'runner.stderr.log') -PassThru
Write-Output "Library processing started in the background (PID $($taskProcess.Id))."
