$ErrorActionPreference = 'Stop'

# __VERSION__ / __CHECKSUM__ are substituted by publish-choco.js before `choco pack`.
$version  = '__VERSION__'
$checksum = '__CHECKSUM__'
$url64    = "https://github.com/VoidenHQ/voiden/releases/download/v$version/Voiden.Setup.$version.exe"

$packageArgs = @{
  packageName    = 'voiden'
  fileType       = 'exe'
  url64bit       = $url64
  checksum64     = $checksum
  checksumType64 = 'sha256'
  softwareName   = 'Voiden*'
  # electron-builder NSIS default silent switch. If this changes (perMachine/oneClick
  # settings in apps/electron/forge.config.ts), update here to match.
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
