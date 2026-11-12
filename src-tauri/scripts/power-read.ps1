
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
