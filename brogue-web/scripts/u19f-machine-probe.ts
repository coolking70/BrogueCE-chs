import {createHeadlessGame} from '../src/test/harness';
import {machineScene} from '../src/test/fixtures/u19a-machine-scenes';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
setMachineObservationHook(()=>{});
for(const ce of [52,55]){let done=false;for(const size of [-1,0,1,2]){for(let seed=1;seed<=20;seed++){
const g:any=createHeadlessGame(1,'test'),s=machineScene(g,ce,seed,size,true);if(s){console.log(JSON.stringify({ce,size,seed,items:g.items.map((i:any)=>({id:i.id,loc:i.loc})),monsters:g.monsters.length,dormant:g.dormantMonsters.length,trace:s.result.observation}));done=true;break;}
}if(done)break;}if(!done)console.log('NO BUILD',ce);}
