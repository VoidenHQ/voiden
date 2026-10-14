$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = 'voiden'
  softwareName   = 'Voiden*'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

$uninstallKey = Get-UninstallRegistryKey -SoftwareName $packageArgs.softwareName
if ($uninstallKey) {
  $packageArgs['file'] = $uninstallKey[0].UninstallString
  Uninstall-ChocolateyPackage @packageArgs
} else {
  Write-Warning "No uninstall registry entry found for '$($packageArgs.softwareName)' — it may already be removed."
}
