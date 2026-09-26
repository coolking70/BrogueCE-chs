import fs from 'node:fs';import {createHeadlessGame} from '../src/test/harness';import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';import {runMachineActions} from '../src/test/fixtures/u19d-machine-actions';
const g:any=createHeadlessGame(19,'test');let traces:any[]=[];setMachineObservationHook(()=>{});const pop=g.populateLevel.bind(g);g.populateLevel=(...args:any[])=>{const r=pop(...args);traces=args[3].flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
g.startNewGame({seed:12,mode:'normal'});for(let d=2;d<=10;d++){g.depth=d;g.generateDepth(false,false);}const trace=traces.find(t=>t.ceBlueprintId===40),steps:any[]=[];
const act=g.handlePlayerAction.bind(g);g.handlePlayerAction=(action:string,data:any)=>{const r=act(action,data);steps.push({action,data,pos:{...g.player.loc},hp:g.player.hp,status:{...g.player.statusDurations},dead:g.isGameOver,depth:g.depth,log:g.player.deathCause});return r;};
let result:any;try{result=runMachineActions(g,trace);}catch(e){result={error:String(e)};}
fs.writeFileSync('ai_docs/reports/u-19e-evidence/ce40-old-scene.json',JSON.stringify({trace,steps,result},null,2)+'\n');console.log(steps.slice(-15));
