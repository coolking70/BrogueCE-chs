import fs from 'node:fs';
import crypto from 'node:crypto';
import {createHeadlessGame,terrainFingerprint} from '../src/test/harness';
import {rng} from '../src/engine/Random';
const base=JSON.parse(fs.readFileSync('ai_docs/reports/u-03b-evidence/baseline-before.json','utf8'));
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const levels:Record<string,any[]>={},traces:Record<string,any[]>={},interaction:Record<string,any[]>={};
for(const seed of base.seeds) {
 const g:any=createHeadlessGame(seed);levels[seed]=[];traces[seed]=[];
 for(let d=1;d<=26;d++) {
  if(d>1){g.depth=d;g.generateDepth(false,false);}
  levels[seed]!.push({fp:terrainFingerprint(g.grid),n:g.monsters.length,species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','),items:g.items.length});
  traces[seed]!.push({rng:rng.getState(),grid:hash(g.grid),monsters:hash(g.monsters.map((m:any)=>[m.typeId,m.loc,m.hp])),items:hash(g.items),player: {...g.player.loc}});
 }
 const play:any=createHeadlessGame(seed);play.animationEnabled=false;play.player.hp=play.player.maxHp=100000;
 interaction[seed]=[];
 for(let n=0;n<6;n++) {
  play.handlePlayerAction('wait',undefined,'system');
  if(n===1||n===3){play.depth=n===1?2:1;play.generateDepth(n===3);}
  interaction[seed]!.push({rng:rng.getState(),grid:hash(play.grid),monsters:hash(play.monsters.map((m:any)=>[m.typeId,m.loc,m.hp])),player:{...play.player.loc},absolute:play.absoluteTurnNumber});
 }
}
fs.writeFileSync(process.argv[2]!,JSON.stringify({levels,traces,interaction},null,2)+'\n');
