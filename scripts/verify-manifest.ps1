$ErrorActionPreference = 'Stop'
$ranklyVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RanklyManifestReader {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadLibraryEx(string file,IntPtr reserved,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr FindResource(IntPtr module,IntPtr name,IntPtr type);
 [DllImport("kernel32.dll")] public static extern uint SizeofResource(IntPtr module,IntPtr resource);
 [DllImport("kernel32.dll")] public static extern IntPtr LoadResource(IntPtr module,IntPtr resource);
 [DllImport("kernel32.dll")] public static extern IntPtr LockResource(IntPtr resource);
 [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr module);
}
'@
foreach ($ranklyFile in @('release/win-unpacked/Rankly Tweaks.exe', "release/Rankly-Tweaks-$ranklyVersion.exe")) {
 $ranklyBinary = (Resolve-Path -LiteralPath $ranklyFile).Path
 # LOAD_LIBRARY_AS_DATAFILE reads PE resources without executing the binary.
 $ranklyModule = [RanklyManifestReader]::LoadLibraryEx($ranklyBinary,[IntPtr]::Zero,2)
 if ($ranklyModule -eq [IntPtr]::Zero) { throw 'Cannot read the executable resources.' }
 try {
  $ranklyResource = [RanklyManifestReader]::FindResource($ranklyModule,[IntPtr]1,[IntPtr]24)
  if ($ranklyResource -eq [IntPtr]::Zero) { throw 'Manifest resource missing.' }
  $ranklyBytes = New-Object byte[] ([RanklyManifestReader]::SizeofResource($ranklyModule,$ranklyResource))
  $ranklyData = [RanklyManifestReader]::LockResource([RanklyManifestReader]::LoadResource($ranklyModule,$ranklyResource))
  [Runtime.InteropServices.Marshal]::Copy($ranklyData,$ranklyBytes,0,$ranklyBytes.Length)
  $ranklyManifest = [Text.Encoding]::UTF8.GetString($ranklyBytes)
  if ($ranklyManifest -notmatch 'requestedExecutionLevel\s+level="requireAdministrator"') { throw "$ranklyFile does not request administrator access." }
  "Verified $ranklyFile : requireAdministrator"
 } finally { [RanklyManifestReader]::FreeLibrary($ranklyModule) | Out-Null }
}
