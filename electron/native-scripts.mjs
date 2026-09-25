export const powerReadPrelude=`
if (-not ('RanklyPowerReader' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RanklyPowerReader {
  [DllImport("powrprof.dll")]
  private static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid subgroup, ref Guid setting, out uint value);
  public static uint Read(string plan, string group, string option, out uint value) {
    Guid s=new Guid(plan), g=new Guid(group), o=new Guid(option);
    return PowerReadACValueIndex(IntPtr.Zero, ref s, ref g, ref o, out value);
  }
}
'@
}
`;

export const networkReadPrelude=`
$ranklyAdapters = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop)
function Get-RanklyNetworkProperty([string]$adapter, [string]$keyword) {
  $nic = @($ranklyAdapters | Where-Object { ([string]$_.InterfaceGuid).Trim('{}') -ieq $adapter })
  if ($nic.Count -ne 1) { throw 'The saved network adapter is unavailable. Reconnect it before restoring.' }
  $property = @(Get-NetAdapterAdvancedProperty -Name ([System.Management.Automation.WildcardPattern]::Escape($nic[0].Name)) -IncludeHidden -AllProperties -ErrorAction Stop | Where-Object RegistryKeyword -CEQ $keyword)
  if ($property.Count -ne 1) { throw 'The network driver no longer exposes this setting. The backup has been kept.' }
  return $property[0]
}
`;
