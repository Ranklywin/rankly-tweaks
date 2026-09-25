// Keep the Win32 boundary separate so tests can exercise the same writer with
// an in-memory implementation, without calling any real SPI_SET action.
export const keyboardStructures=`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct RanklyKeyboardPair { public uint cbSize, dwFlags; }
[StructLayout(LayoutKind.Sequential)]
public struct RanklyKeyboardFilter { public uint cbSize, dwFlags, iWaitMSec, iDelayMSec, iRepeatMSec, iBounceMSec; }
`;
export const keyboardInterop=`
public static class RanklyKeyboardNative {
  [DllImport("user32.dll", EntryPoint="SystemParametersInfoW", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool Pair(uint action, uint size, ref RanklyKeyboardPair value, uint options);
  [DllImport("user32.dll", EntryPoint="SystemParametersInfoW", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool Filter(uint action, uint size, ref RanklyKeyboardFilter value, uint options);
}
`;
export const keyboardLogic=`
public static class RanklyKeyboard {
  private const uint ShortcutMask=0x0C;
  private static uint Action(string name) {
    switch(name) {
      case "sticky": return 0x003A;
      case "toggle": return 0x0034;
      case "filter": return 0x0032;
      default: throw new ArgumentException("Unknown keyboard shortcut.");
    }
  }
  private static void Check(bool success) {
    if(!success) throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not access keyboard shortcut settings.");
  }
  private static RanklyKeyboardPair ReadPair(uint action) {
    var value=new RanklyKeyboardPair();
    value.cbSize=(uint)Marshal.SizeOf(typeof(RanklyKeyboardPair));
    Check(RanklyKeyboardNative.Pair(action,value.cbSize,ref value,0));
    return value;
  }
  private static RanklyKeyboardFilter ReadFilter() {
    var value=new RanklyKeyboardFilter();
    value.cbSize=(uint)Marshal.SizeOf(typeof(RanklyKeyboardFilter));
    Check(RanklyKeyboardNative.Filter(0x0032,value.cbSize,ref value,0));
    return value;
  }
  public static uint[] Read(string name) {
    uint action=Action(name);
    uint flags=name=="filter" ? ReadFilter().dwFlags : ReadPair(action).dwFlags;
    return new uint[] {flags & ShortcutMask, flags & 2, flags & 1};
  }
  private static uint Merge(uint flags, uint shortcuts) {
    if((shortcuts & ~ShortcutMask)!=0) throw new ArgumentException("Invalid keyboard shortcut flags.");
    if((flags & 2)==0) throw new InvalidOperationException("This keyboard accessibility feature is unavailable. The backup has been kept.");
    if((flags & 1)!=0 && (flags & ShortcutMask)!=shortcuts)
      throw new InvalidOperationException("An accessibility feature is active. Its shortcut was preserved; retry Recovery when the feature is no longer in use.");
    return (flags & ~ShortcutMask) | shortcuts;
  }
  public static void Write(string name, uint shortcuts) {
    uint action=Action(name);
    // Read again immediately before writing, including during recovery. Never
    // restore an old full flags word over a user's later accessibility choices.
    if(name=="filter") {
      var value=ReadFilter();
      uint flags=Merge(value.dwFlags,shortcuts);
      if(flags==value.dwFlags) return;
      value.dwFlags=flags;
      Check(RanklyKeyboardNative.Filter(0x0033,value.cbSize,ref value,3));
    } else {
      var value=ReadPair(action);
      uint flags=Merge(value.dwFlags,shortcuts);
      if(flags==value.dwFlags) return;
      value.dwFlags=flags;
      Check(RanklyKeyboardNative.Pair(action+1,value.cbSize,ref value,3));
    }
  }
}
`;
export const keyboardReadPrelude=`
if (-not ('RanklyKeyboard' -as [type])) {
Add-Type -TypeDefinition @'
${keyboardStructures}${keyboardInterop}${keyboardLogic}
'@
}
function Get-RanklyKeyboardShortcut([string]$name) {
  $value=[RanklyKeyboard]::Read($name)
  @{type='keyboard-shortcut';name=$name;value=$value[0];available=($value[1] -ne 0);active=($value[2] -ne 0)}
}
`;
