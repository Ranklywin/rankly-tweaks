
$ranklyAdapters = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop)
function Get-RanklyNetworkProperty([string]$adapter, [string]$keyword) {
  $nic = @($ranklyAdapters | Where-Object { ([string]$_.InterfaceGuid).Trim('{}') -ieq $adapter })
  if ($nic.Count -ne 1) { throw 'The saved network adapter is unavailable. Reconnect it before restoring.' }
  $property = @(Get-NetAdapterAdvancedProperty -Name ([System.Management.Automation.WildcardPattern]::Escape($nic[0].Name)) -IncludeHidden -AllProperties -ErrorAction Stop | Where-Object RegistryKeyword -CEQ $keyword)
  if ($property.Count -ne 1) { throw 'The network driver no longer exposes this setting. The backup has been kept.' }
  return $property[0]
}
