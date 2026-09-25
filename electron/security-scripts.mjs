// These functions query supported Windows interfaces. No setting changes occur
// during capability discovery or status refresh.
export const securityReadPrelude = String.raw`
function Get-RanklySecurityValue {
  param([string]$Path,[string]$Name)
  if (!(Test-Path -LiteralPath $Path)) { return $null }
  $key=Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($key.GetValueNames() -notcontains $Name) { return $null }
  return $key.GetValue($Name)
}
function Get-RanklyMemoryIntegrityStatus {
  try {
    $guard=Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop
    if ($null -eq $guard.SecurityServicesRunning) { throw 'Memory Integrity status unavailable' }
    $running=@($guard.SecurityServicesRunning) -contains 2
    $scenario='HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity'
    $guardPath='HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard'
    $policy='HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeviceGuard'
    $locked=(Get-RanklySecurityValue $scenario 'Locked') -eq 1 -or (Get-RanklySecurityValue $guardPath 'Locked') -eq 1
    $managed=$null -ne (Get-RanklySecurityValue $policy 'HypervisorEnforcedCodeIntegrity')
    if ($locked) { return @{available=$false;running=$running;reason='Memory Integrity is firmware-locked'} }
    if ($managed) { return @{available=$false;running=$running;reason='Memory Integrity is managed by policy'} }
    return @{available=$true;running=$running}
  } catch { return @{available=$false;reason='Windows could not read Memory Integrity status'} }
}
`;

export const memoryIntegrityWriteGuard = String.raw`
$memorySupport=Get-RanklyMemoryIntegrityStatus
if (!$memorySupport.available) { throw $memorySupport.reason }
`;
