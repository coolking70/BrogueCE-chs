// Compile the local CE target predicate verbatim. World/team inputs are stubs;
// this is a bounded target-gate oracle, not a full-engine differential run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const dir='ai_docs/reports/u-09-evidence';fs.mkdirSync(dir,{recursive:true});
const read=f=>fs.readFileSync('../BrogueCE-master/src/'+f,'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const extract=(s,signature)=>{const start=s.indexOf(signature);if(start<0)throw Error(signature);let i=s.indexOf('{',start),depth=0;do{if(s[i]==='{')depth++;if(s[i]==='}')depth--;i++;}while(depth);return s.slice(start,i);};
const header=read('brogue/Rogue.h'),mc=read('brogue/Monsters.c'),power=read('brogue/PowerTables.c');
const boltEnum=extract(header,'enum boltType {');const names=[...boltEnum.matchAll(/\bBOLT_([A-Z_0-9]+)\b/g)].map(m=>m[1]);
const rows=extract(read('variants/GlobalsBrogue.c'),'const bolt boltCatalog_Brogue[] = {').split('\n').filter(l=>/^\s*\{"/.test(l));
const catalog=rows.map((row,i)=>{const c=[...row.trim().slice(1,-2).matchAll(/\s*("[^"]*"|'[^']*'|[^,]+)\s*(?:,|$)/g)].map(m=>m[1].trim());return {name:names[i+1],effect:c[6],magnitude:Number(c[7]),forbidden:c[10],flags:c[11],learnable:!c[11].includes('BF_NOT_LEARNABLE'),negatable:!c[11].includes('BF_NOT_NEGATABLE'),source:row.trim()};});
const tests=[];
const cases=[
 ['enemy',true,false,false,[],[],[]],['teammate',false,false,false,[],[],[]],['allied',true,true,false,[],[],[]],['player',false,true,true,[],[],[]],
 ...['MONST_INANIMATE','MONST_TURRET','MONST_IMMOBILE','MONST_IMMUNE_TO_WEAPONS','MONST_INVULNERABLE','MONST_REFLECT_50','MONST_IMMUNE_TO_FIRE'].map(f=>[f,true,false,false,[f],[],[]]),
 ['reflect100',true,false,false,[],['MA_REFLECT_100'],[]],['ally-reflect50',true,true,false,['MONST_REFLECT_50'],[],[]],['ally-reflect100',true,true,false,[],['MA_REFLECT_100'],[]],
 ...['STATUS_ENTRANCED','STATUS_SLOWED','STATUS_INVISIBLE','STATUS_IMMUNE_TO_FIRE'].map(f=>[f,true,false,false,[],[],[f]]),
];
for(const name of ['TELEPORT','SLOW','POLYMORPH','DOMINATION','INVISIBILITY','LIGHTNING','POISON','ENTRANCEMENT','CONJURATION','TUNNELING','OBSTRUCTION']) for(const [label,casterAlly,targetAlly,playerTarget,behavior,ability,status] of cases)tests.push({name,label,casterAlly,targetAlly,playerTarget,behavior,ability,status});
const func=extract(mc,'static boolean specificallyValidBoltTarget(');
const c=`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#define Fl(n) (1UL<<(n))
#define true 1
#define false 0
#define MONSTER_ALLY 1
#define ITEM_RUNIC 1
#define ITEM_RUNIC_IDENTIFIED 2
#define A_REFLECTION 1
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define clamp(x,a,b) min(max((x),(a)),(b))
#define LAST_INDEX(a) (sizeof(a)/sizeof(*(a))-1)
${header.match(/^typedef .* fixpt;/m)[0]}
${header.match(/^#define FP_BASE .*$/m)[0]}
${header.match(/^#define FP_FACTOR .*$/m)[0]}
typedef int boolean;
typedef struct {short x,y;} pos;
${['monsterBehaviorFlags','monsterAbilityFlags','boltFlags','boltEffects','statusEffects'].map(n=>extract(header,'enum '+n+' {')+';').join('\n')}
${boltEnum};
enum {T_LAVA_INSTA_DEATH=1,T_IS_DEEP_WATER=2,T_AUTO_DESCENT=4,T_ENTANGLES=8,T_OBSTRUCTS_PASSABILITY=16};
typedef struct {unsigned long flags,abilityFlags;int maxHP;} creatureType;
typedef struct {creatureType info;int creatureState,currentHP;pos loc;int status[NUMBER_OF_STATUS_EFFECTS];} creature;
typedef struct {int flags,enchant2;} item;
struct {item *armor;} rogue;
creature player;
struct {enum boltEffects boltEffect;int magnitude;unsigned long forbiddenMonsterFlags,flags;int targetDF;} boltCatalog[30]={
 {0},${catalog.map(b=>`{${b.effect},${b.magnitude},${b.forbidden},${b.flags},0}`).join(',\n')}
};
struct {int tile;} dungeonFeatureCatalog[1];struct {unsigned long flags;} tileCatalog[1];
boolean monstersAreTeammates(creature*a,creature*b){return a!=b && a->creatureState==b->creatureState;}
boolean monstersAreEnemies(creature*a,creature*b){return a!=b && a->creatureState!=b->creatureState;}
int distanceBetween(pos a,pos b){return max(abs(a.x-b.x),abs(a.y-b.y));}
unsigned long burnedTerrainFlagsAtLoc(pos p){return 0;}
unsigned long avoidedFlagsForMonster(creatureType*t){return 0;}
boolean cellHasTerrainFlag(pos p,unsigned long f){return false;}
boolean targetEligibleForCombatBuff(creature*a,creature*b){return true;}
int netEnchant(item*i){return 1;}
${func}
${extract(power,'short reflectionChance(')}
${extract(power,'short staffDamageLow(')}
${extract(power,'short staffDamageHigh(')}
int main(void){
 printf("%d %d %d\\n",reflectionChance(4*FP_FACTOR),staffDamageLow(10*FP_FACTOR),staffDamageHigh(10*FP_FACTOR));
 creature caster,target,*recipient;
 ${tests.map(t=>`memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=${+t.casterAlly};caster.loc=(pos){12,5};recipient=${t.playerTarget?'&player':'&target'};recipient->creatureState=${+t.targetAlly};recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=${t.behavior.join('|')||0};recipient->info.abilityFlags=${t.ability.join('|')||0};${t.status.map(s=>`recipient->status[${s}]=10;`).join('')}
 printf("%d\\n",specificallyValidBoltTarget(&caster,recipient,BOLT_${t.name}));`).join('\n')}
}
`;
fs.writeFileSync(dir+'/ce-target-oracle.c',c);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'brogue-u09-ce-'));
execFileSync('cc',['-std=c99','-Wno-unused-parameter',dir+'/ce-target-oracle.c','-o',tmp+'/oracle']);
const output=execFileSync(tmp+'/oracle',{encoding:'utf8'}).trim().split('\n');
const [reflection48,lightningLow,lightningHigh]=output.shift().split(' ').map(Number);
if(output.length!==tests.length)throw Error('missing CE target outcomes');
tests.forEach((t,i)=>t.expected=output[i]==='1');
fs.writeFileSync(dir+'/ce-target-cases.json',JSON.stringify({formulas:{reflection48,lightningLow,lightningHigh},tests},null,2)+'\n');
const data=JSON.parse(fs.readFileSync('src/data/monsters.json'));
const legacy=Object.fromEntries(['abilities','onHitStatus','statusImmunities','statusResistTurns'].map(k=>[k,data.filter(m=>m[k]&&(Array.isArray(m[k])?m[k].length:typeof m[k]==='object'?Object.keys(m[k]).length:true)).map(m=>({id:m.id,value:m[k]}))]));
const result={sources:Object.fromEntries(['brogue/Rogue.h','brogue/Monsters.c','brogue/Combat.c','brogue/Items.c','brogue/PowerTables.c','variants/GlobalsBrogue.c'].map(f=>[f,hash(read(f))])),predicateSha256:hash(func),catalog:catalog.map(b=>({...b,initialSources:data.filter(m=>m.bolts?.includes(b.name)).map(m=>m.id)})),legacy,oracleCases:tests.length};
fs.writeFileSync(dir+'/ce-source.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({oracleCases:tests.length,learnable:catalog.filter(b=>b.learnable).length,formulas:{reflection48,lightningLow,lightningHigh}}));
