// Intel describes these as access-point compatibility workarounds, not universal
// latency optimizations. Values are resolved from the driver's labelled
// enumeration by src-tauri/src/ops.rs.
export const wifiControls=Object.freeze({
  'wifi-smps':Object.freeze({keyword:'MIMOPowerSaveMode',target:'No SMPS'}),
  'wifi-uapsd':Object.freeze({keyword:'uAPSD',target:'Disabled'}),
});
