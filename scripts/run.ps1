param(
    [ValidateSet('serve', 'check', 'test', 'browser')]
    [string]$Action = 'serve',
    [string]$PythonPath = (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),
    [switch]$Setup
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!(Test-Path -LiteralPath $PythonPath)) {
    throw 'Python was not found. Supply -PythonPath with an installed, policy-approved Python 3.12 executable.'
}
$packages = Join-Path $projectRoot '.runtime-packages'
if ($Setup) {
    & $PythonPath -m pip install --target $packages -r (Join-Path $projectRoot 'requirements-dev.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
$previousPythonPath = $env:PYTHONPATH
$previousEncoding = $env:PYTHONIOENCODING
try {
    $env:PYTHONPATH = $packages
    $env:PYTHONIOENCODING = 'utf-8'
    $manage = Join-Path $projectRoot 'StepbyStep/manage.py'
    switch ($Action) {
        'serve' { & $PythonPath $manage runserver 127.0.0.1:8000 --noreload }
        'check' { & $PythonPath $manage check }
        'test' { & $PythonPath $manage test main }
        'browser' { & $PythonPath (Join-Path $projectRoot 'tests/browser_smoke.py') }
    }
    if ($LASTEXITCODE -ne 0) { throw "Action failed: $Action (exit $LASTEXITCODE)" }
} finally {
    $env:PYTHONPATH = $previousPythonPath
    $env:PYTHONIOENCODING = $previousEncoding
}
