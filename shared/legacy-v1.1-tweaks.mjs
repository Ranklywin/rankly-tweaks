// Immutable v1.1.0 definitions: recovery only. Keep independent of the current catalog.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const legacyV11Tweaks=freeze([
  {
    "id": "cpu-responsiveness",
    "name": "CPU responsiveness",
    "category": "CPU & power",
    "icon": "Cpu",
    "tag": "Performance",
    "impact": "CPU",
    "description": "Favor CPU performance and boost while plugged in.",
    "detail": "Adjusts CPU boost, performance preference, and the performance ceiling together.",
    "tradeoff": "May increase heat and fan noise. Battery settings stay unchanged.",
    "restart": "Instant",
    "recommended": false,
    "primary": true,
    "featured": true,
    "admin": true,
    "powerSettings": [
      {
        "subgroup": "54533251-82be-4824-96c1-47b60b740d00",
        "setting": "be337238-0d82-4146-a960-4f3749d470c7",
        "value": 2
      },
      {
        "subgroup": "54533251-82be-4824-96c1-47b60b740d00",
        "setting": "36687f9e-e3a5-4dbf-b1dc-15eb381c6863",
        "value": 0
      },
      {
        "subgroup": "54533251-82be-4824-96c1-47b60b740d00",
        "setting": "bc5038f7-23e0-4960-96da-33abaf5935ec",
        "value": 100
      }
    ]
  },
  {
    "id": "pcie-performance",
    "name": "PCIe performance",
    "category": "CPU & power",
    "icon": "Zap",
    "tag": "Plugged-in PCs",
    "impact": "Device power",
    "description": "Keep PCIe links out of their power-saving modes.",
    "detail": "Disables PCIe link-state power saving in your plugged-in power settings.",
    "tradeoff": "Uses more power at idle. Benefits depend on your hardware.",
    "restart": "Instant",
    "recommended": false,
    "primary": true,
    "admin": true,
    "powerSettings": [
      {
        "subgroup": "501a4d13-42af-4429-9fd1-a8218c268e20",
        "setting": "ee12f906-d277-404b-b6da-e5fa1a576df5",
        "value": 0
      }
    ]
  },
  {
    "id": "ethernet-latency",
    "name": "Ethernet low latency",
    "category": "Network",
    "icon": "Network",
    "tag": "Advanced",
    "impact": "Network response",
    "description": "Reduce packet batching and Ethernet power saving.",
    "detail": "Adjusts supported interrupt moderation and energy-saving options on active Ethernet adapters.",
    "tradeoff": "Can increase CPU and power use. Restart to activate the driver settings.",
    "restart": "Restart PC",
    "recommended": false,
    "primary": true,
    "featured": true,
    "admin": true,
    "networkSettings": [
      {
        "keyword": "*InterruptModeration",
        "value": [
          "0"
        ],
        "required": true
      },
      {
        "keyword": "*EEE",
        "value": [
          "0"
        ]
      },
      {
        "keyword": "EnableGreenEthernet",
        "value": [
          "0"
        ]
      }
    ]
  },
  {
    "id": "network-rss",
    "name": "Multicore networking",
    "category": "Network",
    "icon": "Router",
    "tag": "Hardware dependent",
    "impact": "Network processing",
    "description": "Spread supported Ethernet receive processing across CPU cores.",
    "detail": "Enables Receive Side Scaling on active Ethernet adapters that support it.",
    "tradeoff": "Often enabled already. It does not change your internet route or server ping.",
    "restart": "Restart PC",
    "recommended": false,
    "primary": true,
    "admin": true,
    "networkSettings": [
      {
        "keyword": "*RSS",
        "value": [
          "1"
        ],
        "required": true
      }
    ]
  }
]);
