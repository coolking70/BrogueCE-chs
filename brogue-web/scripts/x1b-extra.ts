import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {ItemLoader} from '../src/engine/Items/ItemLoader';
import {ItemCategory as IC} from '../src/engine/Items/Item';
import {TerrainType as T} from '../src/engine/Map/Grid';
import {readHighScores} from '../src/engine/Core/HighScores';
import {rng} from '../src/engine/Random';
import {endgameScore} from '../src/engine/Core/Endgame';
import {HORDE_POPULATE_FORBIDDEN_FLAGS} from '../src/engine/Core/Game';
import hordes from '../src/data/hordes.json';
const store=new Map<string,string>();
globalThis.localStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}} as any;
const terminal=(g:any,t:T)=>{for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)if(g.grid.getCell(x,y).layers.includes(t))return{x,y};throw Error('missing stair');};
const g:any=createHeadlessGame(777);g.player.hp=g.player.maxHp=100000;
const moves:any[]=[];
for(let d=2;d<=40;d++){
 g.player.loc=terminal(g,T.STAIRS_DOWN);g.handlePlayerAction('stairs_down');
 moves.push({wantedDepth:d,depth:g.depth});
}
const before=g.items.map((i:any)=>({id:i.id,quantity:i.quantity,originDepth:i.originDepth}));
g.player.loc=terminal(g,T.STAIRS_UP);g.handlePlayerAction('stairs_up');
const upstairsDepth=g.depth;
g.player.loc=terminal(g,T.STAIRS_DOWN);g.handlePlayerAction('stairs_down');
const returnDepth=g.depth,after=g.items.map((i:any)=>({id:i.id,quantity:i.quantity,originDepth:i.originDepth}));
// A bounded inventory fixture isolates the count consumer. Generation is unchanged.
g.player.inventory.addItem(ItemLoader.spawnAmulet('amulet_of_yendor',0,0)!);
for(let d=27;d<=40;d++)for(let n=0;n<ItemLoader.CE_LUMENSTONE_DISTRIBUTION[d-27]!;n++)g.player.inventory.addItem(ItemLoader.spawnGem(d,0,0));
const gems=g.player.inventory.items.filter((i:any)=>i.category===IC.GEM);
const totalQuantity=gems.reduce((n:number,i:any)=>n+i.quantity,0);
const death=endgameScore(0,g.player.inventory.items,false,false,false);
g.player.loc=terminal(g,T.DUNGEON_PORTAL);g.handlePlayerAction('stairs_down');
const result={scope:'Real D1-D40 stair commands with explicit location/HP fixtures, unchanged natural maps; synthetic 25-gem inventory to isolate score-description consumer',moves,revisit:{upstairsDepth,returnDepth,before,after,equal:JSON.stringify(before)===JSON.stringify(after)},ending:{quantity:totalQuantity,stacks:gems.length,score:g.gameOverScore,deathScore:death,won:g.gameOverWon,superVictory:g.gameOverSuperVictory,description:readHighScores()[0]?.description,expectedDescriptionFromCEQuantity:`Mastered the Dungeons of Doom with ${totalQuantity} lumenstones!`},countDistribution:[] as any[]};
// Same RNG, no stubs: observe the two count primitives used/required by the sources.
for(let seed=1;seed<=12;seed++){
 rng.seedRandomGenerator(seed);const uniform=rng.randRange(5,10),uniformState=rng.getState();
 rng.seedRandomGenerator(seed);const ceClump=5+rng.randRange(0,3)+rng.randRange(0,2),clumpState=rng.getState();
 result.countDistribution.push({seed,uniform,ceClump,sameState:JSON.stringify(uniformState)===JSON.stringify(clumpState)});
}
fs.writeFileSync(process.argv[2]+'/extra-observations.json',JSON.stringify(result,null,2)+'\n');
// Correct the derived catalog using the exported production exclusion set.
const runtimeCatalog=JSON.parse(fs.readFileSync(process.argv[2]+'/runtime-catalog.json','utf8'));
runtimeCatalog.ordinaryHordeCandidates=[27,29,30,32,34,39,40].map(depth=>({depth,rows:g.hordeCandidates(depth,HORDE_POPULATE_FORBIDDEN_FLAGS).map((h:any)=>hordes.indexOf(h))}));
fs.writeFileSync(process.argv[2]+'/runtime-catalog.json',JSON.stringify(runtimeCatalog,null,2)+'\n');
console.log(JSON.stringify({ending:result.ending,revisit:result.revisit.equal}));
