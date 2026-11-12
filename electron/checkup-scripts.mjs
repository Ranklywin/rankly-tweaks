// Read-only hardware checkup. Nothing in this script changes Windows settings.
// Display modes come from EnumDisplaySettings, which lists only modes the
// connected monitor and driver report as supported.
export const checkupPrelude=`
if (-not ('RanklyCheckup' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class RanklyCheckup {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DisplayDevice {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DevMode {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency, dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PowerStatus { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int BatteryLifeTime, BatteryFullLifeTime; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice info, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern bool EnumDisplaySettings(string device, int mode, ref DevMode info);
  [DllImport("kernel32.dll")] private static extern bool GetSystemPowerStatus(out PowerStatus status);
  public class Display { public string Device; public string Adapter; public bool Primary; public int Width; public int Height; public int Hz; public int MaxHz; }
  public static Display[] Displays() {
    List<Display> result = new List<Display>();
    for (uint i = 0; i < 64; i++) {
      DisplayDevice adapter = new DisplayDevice();
      adapter.cb = Marshal.SizeOf(typeof(DisplayDevice));
      if (!EnumDisplayDevices(null, i, ref adapter, 0)) break;
      if ((adapter.StateFlags & 1) == 0) continue; // Not attached to the desktop.
      DevMode current = new DevMode();
      current.dmSize = (short)Marshal.SizeOf(typeof(DevMode));
      if (!EnumDisplaySettings(adapter.DeviceName, -1, ref current)) continue;
      int max = 0;
      DevMode mode = new DevMode();
      mode.dmSize = current.dmSize;
      for (int m = 0; m < 4096 && EnumDisplaySettings(adapter.DeviceName, m, ref mode); m++) {
        // Ignore interlaced modes; compare only at the resolution in use.
        if (mode.dmPelsWidth == current.dmPelsWidth && mode.dmPelsHeight == current.dmPelsHeight && (mode.dmDisplayFlags & 2) == 0 && mode.dmDisplayFrequency > max) max = mode.dmDisplayFrequency;
      }
      Display display = new Display();
      display.Device = adapter.DeviceName; display.Adapter = adapter.DeviceString; display.Primary = (adapter.StateFlags & 4) != 0;
      display.Width = current.dmPelsWidth; display.Height = current.dmPelsHeight; display.Hz = current.dmDisplayFrequency; display.MaxHz = max;
      result.Add(display);
    }
    return result.ToArray();
  }
  public static PowerStatus Power() {
    PowerStatus status;
    if (!GetSystemPowerStatus(out status)) throw new InvalidOperationException("Power status unavailable.");
    return status;
  }
}
'@
}
`;

export const checkupScript=`
${checkupPrelude}
$displays=$null; $memory=$null; $gpus=$null; $power=$null
try { $displays=@([RanklyCheckup]::Displays() | ForEach-Object { @{device=[string]$_.Device;adapter=[string]$_.Adapter;primary=[bool]$_.Primary;width=[int]$_.Width;height=[int]$_.Height;hz=[int]$_.Hz;maxHz=[int]$_.MaxHz} }) } catch { }
try { $memory=@(Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop | ForEach-Object { @{capacityGB=[math]::Round([double]$_.Capacity/1GB,1);speed=[int]$_.Speed;configured=[int]$_.ConfiguredClockSpeed;type=[int]$_.SMBIOSMemoryType;formFactor=[int]$_.FormFactor;locator=[string]$_.DeviceLocator;bank=[string]$_.BankLabel;part=([string]$_.PartNumber).Trim()} }) } catch { }
try { $gpus=@(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object { @{name=[string]$_.Name;pnp=[string]$_.PNPDeviceID;driverDate=$(if($_.DriverDate){$_.DriverDate.ToUniversalTime().ToString('o')}else{$null})} }) } catch { }
try { $status=[RanklyCheckup]::Power(); $power=@{ac=[int]$status.ACLineStatus;batteryFlag=[int]$status.BatteryFlag;saver=([int]$status.SystemStatusFlag -eq 1)} } catch { }
$laptop=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).Count -gt 0
@{displays=$displays;memory=$memory;gpus=$gpus;power=$power;laptop=$laptop;checkedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json -Depth 6 -Compress
`;
