// Concrete, documented Windows power settings. Only AC values are changed.
const cpu='54533251-82be-4824-96c1-47b60b740d00';
const disk='0012ee47-9041-4b5d-9b77-535fba8b1442';
const setting=(subgroup,setting,value)=>({subgroup,setting,value});
export const powerControls={
  'performance-power':[
    setting(cpu,'be337238-0d82-4146-a960-4f3749d470c7',2),
    setting(cpu,'36687f9e-e3a5-4dbf-b1dc-15eb381c6863',0),
    setting(cpu,'bc5038f7-23e0-4960-96da-33abaf5935ec',100),
    setting('501a4d13-42af-4429-9fd1-a8218c268e20','ee12f906-d277-404b-b6da-e5fa1a576df5',0),
  ],
  'core-parking':[setting(cpu,'0cc5b647-c1df-4637-891a-dec35c318583',100)],
  'active-cooling':[setting(cpu,'94d3a615-a899-4ac5-ae2b-e4d8f634367f',1)],
  'nvme-latency':[
    setting(disk,'fc95af4d-40e7-4b6d-835a-56d131dbc80e',0),
    setting(disk,'dbc9e238-6de9-49e3-92cd-8c2b4946b472',0),
  ],
  'sata-link-power':[setting(disk,'0b2d69d7-a2a1-449c-9680-f91c70521c60',0)],
  'wifi-performance':[setting('19cbb8fa-5279-450e-9fac-8a3d5fedd0c1','12bbebe6-58d6-4636-95bb-3217ef867c1a',0)],
  'usb-stability':[setting('2a737441-1930-4402-8d77-b2bebba308a3','48e6b7a6-50f5-4782-a5d4-53bb8f07e226',0)],
  'stay-awake':[
    setting('7516b95f-f776-4464-8c53-06167f40cc99','3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e',0),
    setting('238c9fa8-0aad-41ed-83f4-97be242c8f20','29f6c1db-86da-48c5-9fdb-f2b67b1f44da',0),
    setting('238c9fa8-0aad-41ed-83f4-97be242c8f20','9d7815a6-7ee4-497e-8888-515a05f02364',0),
  ],
  'hdd-readiness':[setting('0012ee47-9041-4b5d-9b77-535fba8b1442','6738e2c4-e8a5-4a42-b16a-e040e769756e',0)],
};

// Driver keywords are used instead of localized display names.
export const networkControls={
  'ethernet-idle-sleep':[{keyword:'*SelectiveSuspend',value:['0'],required:true}],
  'ethernet-optimization':[
    {keyword:'*InterruptModeration',value:['0']},
    {keyword:'*EEE',value:['0']},
    {keyword:'EnableGreenEthernet',value:['0']},
    {keyword:'*RSS',value:['1']},
  ],
};
