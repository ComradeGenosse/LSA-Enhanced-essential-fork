import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// This is a source-pinned binary contract, NOT a GTA movement test. It verifies
// why native ACT6 must explicitly retire Essential's persistent free-drive flag.
// If the upstream DLL changes, re-audit its IL instead of trusting these offsets.
const PIN='9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653';
const rvaToOffset=(data,rva)=>{
  const pe=data.readUInt32LE(0x3c);
  assert.equal(data.subarray(pe,pe+4).toString('hex'),'50450000');
  const sections=data.readUInt16LE(pe+6);
  const table=pe+24+data.readUInt16LE(pe+20);
  for(let i=0;i<sections;i++){
    const at=table+40*i;
    const virtualSize=data.readUInt32LE(at+8),virtualAddress=data.readUInt32LE(at+12);
    const rawSize=data.readUInt32LE(at+16),rawAddress=data.readUInt32LE(at+20);
    if(rva>=virtualAddress&&rva<virtualAddress+Math.max(rawSize,virtualSize))
      return rawAddress+rva-virtualAddress;
  }
  throw Error('unknown method RVA: '+rva.toString(16));
};
const methodBody=(data,rva)=>{
  const at=rvaToOffset(data,rva),kind=data[at]&3;
  if(kind===2)return data.subarray(at+1,at+1+(data[at]>>2));
  assert.equal(kind,3);
  const header=(data.readUInt16LE(at)>>12)*4;
  const length=data.readUInt32LE(at+4);
  return data.subarray(at+header,at+header+length);
};

test('pinned Essential StartDriving reissues every 3000ms but StopAll misses free-drive flag',()=>{
  const dll=readFileSync(new URL('../upstream/LosSantosAlive.dll',import.meta.url));
  assert.equal(createHash('sha256').update(dll).digest('hex'),PIN);
  // ECMA-335 FieldDef token 04000268: NpcState.DriveToXWhenBothSeated.
  const writeFlag=Buffer.from([0x7d,0x68,0x02,0x00,0x04]);
  const readFlag=Buffer.from([0x7b,0x68,0x02,0x00,0x04]);
  assert.ok(methodBody(dll,0x8e1d4).includes(writeFlag),'stock StartDriving arms persistent free-drive');
  assert.ok(methodBody(dll,0x91aa0).includes(readFlag),'stock UpdateStartDriving consumes persistent free-drive');
  assert.ok(methodBody(dll,0x91d2c).includes(Buffer.from([0x20,0xb8,0x0b,0x00,0x00])),'stock task reissues on 3000ms timer');
  assert.ok(!methodBody(dll,0x8e534).includes(writeFlag),
    'stock StopAllVehicleCommands does not clear the free-drive flag');
});
test('native ACT6 handoff explicitly disables the still-active stock mode before drive_to',()=>{
  const cs=readFileSync(new URL('../../native/promoted-characters/ActivityDispatch.cs',import.meta.url),'utf8');
  const handoff=cs.slice(cs.indexOf('if (capability == "drive_to") {',cs.indexOf('else if (capability == "walk_to" || capability == "drive_to") {',cs.indexOf('public bool Dispatch'))));
  assert.ok(handoff.includes('VehicleBehavior.StopAllVehicleCommands(ped,state);'));
  assert.match(handoff,new RegExp('VehicleBehavior'+'\\.'+'StopAllVehicleCommands'+'\\('+'ped,state'+'\\);'+'\\s*'+'state'+'\\.'+'DriveToXWhenBothSeated = false;'));
  const off=handoff.indexOf('state.DriveToXWhenBothSeated = false;');
  const task=handoff.indexOf('"TASK_VEHICLE_DRIVE_TO_COORD_LONGRANGE"');
  assert.ok(off>=0&&task>off,'free-drive flag is retired before ACT6 route task');
});
