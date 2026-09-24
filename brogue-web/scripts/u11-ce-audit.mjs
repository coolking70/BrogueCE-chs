// Run from brogue-web. Audit verbatim CE selection/absorption; U11 web regression consumes the same four map fixtures.
// Distance maps and world/UI services are controlled inputs, not a CE pathfinder port.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = 'ai_docs/reports/u-11-evidence';
fs.mkdirSync(dir, { recursive: true });
const read = n => fs.readFileSync(`../BrogueCE-master/src/brogue/${n}`, 'utf8');
const extract = (s, signature) => {
    const start = s.indexOf(signature);
    if (start < 0) throw Error(signature);
    let i = s.indexOf('{', start), depth = 0;
    do { if (s[i] === '{') depth++; if (s[i] === '}') depth--; i++; } while (depth);
    return s.slice(start, i);
};
const rh = read('Rogue.h');
const boltEnum = extract(rh, 'enum boltType {');
const names = [...boltEnum.matchAll(/\bBOLT_[A-Z_0-9]+\b/g)].map(m => m[0]);
const catalog = fs.readFileSync('../BrogueCE-master/src/variants/GlobalsBrogue.c', 'utf8');
const rows = extract(catalog, 'const bolt boltCatalog_Brogue[] = {').split('\n').filter(l => /^\s*\{"/.test(l));
if (rows.length !== names.length - 1) throw Error('CE catalog shape changed');
const metadata = rows.map((line, i) => ({ name: names[i + 1], learnable: !line.includes('BF_NOT_LEARNABLE'), source: line.trim() }));
fs.writeFileSync(`${dir}/ce-bolts.json`, JSON.stringify(metadata, null, 2) + '\n');
const c = `// Generated from repository CE; world/map/RNG/UI are audit stubs.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#define Fl(n) (1UL << (n))
#define true 1
#define false 0
#define COLS 256
#define DCOLS 256
#define MONSTER_ALLY 1
#define MK_SPECTRAL_IMAGE 999
#define T_OBSTRUCTS_PASSABILITY 1
typedef int boolean;
${['monsterBehaviorFlags', 'monsterAbilityFlags', 'monsterBookkeepingFlags', 'boltFlags', 'statusEffects'].map(n => extract(rh, 'enum ' + n + ' {') + ';').join('\n')}
${boltEnum};
typedef struct {short x,y;} pos;
#define INVALID_POS ((pos){-1,-1})
typedef struct {unsigned long flags,abilityFlags; short monsterID,bolts[32]; char monsterName[30];} creatureType;
typedef struct {creatureType info; short creatureState,newPowerCount,totalPowerCount;
 pos loc,targetCorpseLoc; char targetCorpseName[30]; unsigned long absorptionFlags,bookkeepingFlags;
 boolean absorbBehavior; short absorptionBolt,corpseAbsorptionCounter,ticksUntilTurn;
 short status[NUMBER_OF_STATUS_EFFECTS],maxStatus[NUMBER_OF_STATUS_EFFECTS];} creature;
typedef struct {unsigned long flags; char abilityDescription[80];} auditBolt;
auditBolt boltCatalog[30] = {${metadata.map(r => `[${r.name}]={${r.learnable ? 0 : 'BF_NOT_LEARNABLE'},""}`).join(',')}};
struct {int numberBoltKinds;} constants={30},*gameConst=&constants;
creature roster[3]; int monsters,rosterCount,mapCall,rngCalls,draws[8],lo[8],hi[8],avoids,blocked;
short mapInputs[3][4];
typedef struct {int index;} creatureIterator;
creatureIterator iterateCreatures(int ignored){return (creatureIterator){0};}
boolean hasNextCreature(creatureIterator it){return it.index<rosterCount;}
creature *nextCreature(creatureIterator *it){return &roster[it->index++];}
boolean isPosInMap(pos p){return p.x>=0&&p.y>=0&&p.x<4&&p.y<4;}
boolean posEq(pos a,pos b){return a.x==b.x&&a.y==b.y;}
boolean monsterAvoids(creature *m,pos p){return avoids;}
boolean cellHasTerrainFlag(pos p,unsigned long flag){return blocked;}
unsigned long forbiddenFlagsForMonster(creatureType *t){return t->flags;}
short **allocGrid(void){short **g=calloc(4,sizeof(*g));for(int x=0;x<4;x++)g[x]=calloc(4,sizeof(**g));return g;}
void freeGrid(short **g){for(int x=0;x<4;x++)free(g[x]);free(g);}
void fillGrid(short **g,short value){for(int x=0;x<4;x++)for(int y=0;y<4;y++)g[x][y]=value;}
void calculateDistances(short **g,short x,short y,unsigned long flags,void *traveler,boolean diag,boolean secrets){
 assert(mapCall<3);for(int i=0;i<4;i++)g[i][0]=mapInputs[mapCall][i];mapCall++;
}
short rand_range(short low,short high){assert(rngCalls<8);lo[rngCalls]=low;hi[rngCalls]=high;int r=draws[rngCalls++];assert(r>=low&&r<=high);return r;}
struct {char absorbing[30];} monsterText[1000];
struct {char description[80];} monsterBehaviorCatalog[32],monsterAbilityCatalog[32];
int goodMessageColor,advancementMessageColor;
boolean canSeeMonster(creature *m){return false;}
void monsterName(char *b,creature *m,boolean article){strcpy(b,"ally");}
void messageWithColor(char *b,int *color,int n){}
void resolvePronounEscapes(char *b,creature *m){}
int unflag(unsigned long flag){int i=0;while(flag>1){flag>>=1;i++;}return i;}
${extract(read('Combat.c'), 'static boolean canAbsorb(')}
${extract(read('Combat.c'), 'static boolean anyoneWantABite(')}
${extract(read('Monsters.c'), 'static boolean updateMonsterCorpseAbsorption(')}
creature prey;
void reset(int n){
 memset(roster,0,sizeof(roster));memset(&prey,0,sizeof(prey));memset(mapInputs,0,sizeof(mapInputs));
 rosterCount=n;mapCall=rngCalls=avoids=blocked=0;for(int i=0;i<8;i++)draws[i]=1;
 for(int i=0;i<n;i++){roster[i].creatureState=MONSTER_ALLY;roster[i].newPowerCount=roster[i].totalPowerCount=1;roster[i].loc=(pos){i,0};roster[i].targetCorpseLoc=INVALID_POS;}
 prey.loc=(pos){3,0};strcpy(prey.info.monsterName,"prey");
}
int main(void){
 // Scratch array is deliberately dirty before the flag-success early return.
 reset(1);boolean scratch[30]={0};short **g=allocGrid();prey.info.abilityFlags=MA_TRANSFERENCE;scratch[BOLT_FIRE]=true;
 assert(canAbsorb(&roster[0],scratch,&prey,g));assert(scratch[BOLT_FIRE]);
 prey.info.abilityFlags=0;prey.info.bolts[0]=BOLT_FIRE;roster[0].info.bolts[0]=BOLT_SPARK;
 assert(canAbsorb(&roster[0],scratch,&prey,g));assert(!scratch[BOLT_FIRE]&&scratch[BOLT_SPARK]);
 roster[0].newPowerCount=0;assert(!canAbsorb(&roster[0],scratch,&prey,g));roster[0].newPowerCount=1;
 roster[0].targetCorpseLoc=prey.loc;assert(!canAbsorb(&roster[0],scratch,&prey,g));roster[0].targetCorpseLoc=INVALID_POS;
 roster[0].info.flags=MONST_INANIMATE;assert(!canAbsorb(&roster[0],scratch,&prey,g));roster[0].info.flags=0;
 prey.info.flags=MONST_IMMOBILE;assert(!canAbsorb(&roster[0],scratch,&prey,g));prey.info.flags=0;
 avoids=1;assert(!canAbsorb(&roster[0],scratch,&prey,g));avoids=0;
 g[0][0]=11;assert(!canAbsorb(&roster[0],scratch,&prey,g));g[0][0]=10;assert(canAbsorb(&roster[0],scratch,&prey,g));freeGrid(g);
 puts("PASS scratch: flag early return preserves stale ourBolts; bolt branch rebuilds it; eligibility gates and distance 10/11");
 // First pass: A/B qualify on their own maps. Second pass uses B's map for both.
 for(int draw=1;draw<=2;draw++){
  reset(2);prey.info.abilityFlags=MA_TRANSFERENCE;mapInputs[0][0]=2;mapInputs[1][0]=20;mapInputs[1][1]=2;draws[0]=draw;
  boolean result=anyoneWantABite(&prey);assert(mapCall==2&&hi[0]==2);
  if(draw==1){assert(result&&isPosInMap(roster[1].targetCorpseLoc)&&!isPosInMap(roster[0].targetCorpseLoc)&&rngCalls==2);}
  else{assert(!result&&!isPosInMap(roster[0].targetCorpseLoc)&&!isPosInMap(roster[1].targetCorpseLoc)&&rngCalls==1);}
  printf("PASS shared-map draw=%d denominator=%d selected=%s rng_calls=%d\\n",draw,hi[0],result?"B":"none",rngCalls);
 }
 reset(2);prey.info.abilityFlags=MA_TRANSFERENCE;mapInputs[0][0]=20;mapInputs[1][0]=mapInputs[1][1]=2;
 assert(anyoneWantABite(&prey)&&hi[0]==1&&isPosInMap(roster[0].targetCorpseLoc));
 puts("PASS shared-map: first-pass-ineligible A can be chosen on last map; denominator remains 1");
 reset(2);roster[1].newPowerCount=0;prey.info.abilityFlags=MA_TRANSFERENCE;mapInputs[0][0]=2;mapInputs[1][0]=20;
 assert(!anyoneWantABite(&prey)&&mapCall==2&&rngCalls==1&&hi[0]==1);
 puts("PASS shared-map: last ally with no pending slot still overwrites map");
 reset(1);prey.info.abilityFlags=LEARNABLE_ABILITIES;prey.info.flags=LEARNABLE_BEHAVIORS;prey.info.bolts[0]=BOLT_FIRE;draws[1]=3;
 assert(anyoneWantABite(&prey)&&hi[1]==6&&roster[0].absorbBehavior&&roster[0].absorptionFlags==MONST_INVISIBLE&&roster[0].absorptionBolt==0);
 puts("PASS priority: 2 abilities then 4 behaviors; FIRE does not enter this six-way draw");
 int accepted=0,rejected=0;
 for(int b=1;b<30;b++){
  reset(1);prey.info.bolts[0]=b;boolean result=anyoneWantABite(&prey);
  if(boltCatalog[b].flags&BF_NOT_LEARNABLE){assert(!result&&rngCalls==0);rejected++;}
  else{assert(result&&rngCalls==2&&roster[0].absorptionBolt==b);accepted++;}
 }
 assert(accepted==22&&rejected==7);printf("PASS catalog: %d learnable, %d excluded (including blink/vines/tunnel/obstruction accepted)\\n",accepted,rejected);
 reset(1);roster[0].info.bolts[0]=BOLT_SPARK;prey.info.bolts[0]=BOLT_SPARK;prey.info.bolts[1]=BOLT_SPIDERWEB;prey.info.bolts[2]=BOLT_ANCIENT_SPIRIT_VINES;prey.info.bolts[3]=BOLT_BLINKING;draws[1]=2;
 assert(anyoneWantABite(&prey)&&hi[1]==2&&roster[0].absorptionBolt==BOLT_BLINKING);
 puts("PASS bolt draw: existing SPARK and NOT_LEARNABLE web excluded; vines/blink retain denominator 2");
 creature *m=&roster[0];m->loc=m->targetCorpseLoc;m->bookkeepingFlags|=MB_ABSORBING;
 m->status[STATUS_POISONED]=m->status[STATUS_BURNING]=m->status[STATUS_PARALYZED]=3;
 for(int i=0;i<20;i++){assert(updateMonsterCorpseAbsorption(m));assert(m->ticksUntilTurn==100);if(i<19)assert(m->newPowerCount==1);}
 assert(m->newPowerCount==0&&m->totalPowerCount==1&&m->info.bolts[1]==BOLT_BLINKING&&m->absorptionBolt==0&&!isPosInMap(m->targetCorpseLoc));
 assert(!updateMonsterCorpseAbsorption(m)&&m->newPowerCount==0&&rngCalls==2);
 puts("PASS finish: 20 absorption calls, final call consumed, append bolt, new-- once, total unchanged, no RNG; statuses do not gate ongoing absorption");
 for(int count=16;count<=17;count++){
  reset(1);m=&roster[0];m->targetCorpseLoc=prey.loc;m->corpseAbsorptionCounter=count;m->bookkeepingFlags=MB_ABSORBING;m->absorptionFlags=MA_TRANSFERENCE;
  assert(!updateMonsterCorpseAbsorption(m));assert(!(m->bookkeepingFlags&MB_ABSORBING));assert(isPosInMap(m->targetCorpseLoc)==(count==17));assert(m->newPowerCount==1);
 }
 puts("PASS displaced: pre-counter 17 -> 16 retains target, 16 -> 15 abandons; no slot spent");
 reset(1);m=&roster[0];m->targetCorpseLoc=prey.loc;m->corpseAbsorptionCounter=20;m->absorptionFlags=MA_TRANSFERENCE;
 for(int i=0;i<20;i++)assert(!updateMonsterCorpseAbsorption(m));assert(!isPosInMap(m->targetCorpseLoc)&&m->newPowerCount==1&&m->absorptionFlags==0);
 puts("PASS approach timeout: 20 calls without starting absorption clear target/power, retain slot");
 reset(1);m=&roster[0];m->targetCorpseLoc=m->loc;m->corpseAbsorptionCounter=1;m->bookkeepingFlags=MB_ABSORBING|MB_SUBMERGED;
 m->info.flags=MONST_FIERY|MONST_IMMUNE_TO_FIRE|MONST_INVISIBLE|MONST_RESTRICTED_TO_LIQUID|MONST_SUBMERGES;m->absorbBehavior=true;m->absorptionFlags=MONST_FLIES;
 assert(updateMonsterCorpseAbsorption(m));assert(!(m->info.flags&(MONST_RESTRICTED_TO_LIQUID|MONST_SUBMERGES))&&!(m->bookkeepingFlags&MB_SUBMERGED));
 int statuses[]={STATUS_BURNING,STATUS_LEVITATING,STATUS_IMMUNE_TO_FIRE,STATUS_INVISIBLE};
 for(int i=0;i<4;i++)assert(m->status[statuses[i]]==1000&&m->maxStatus[statuses[i]]==1000);
 puts("PASS permanent flags: 4 status/maxStatus pairs=1000; flying clears liquid/submerged flags");
 puts("ALL CE AUDIT ASSERTIONS PASSED (stubbed distance/world inputs; not a full-engine differential test)");
}
`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w22-ce-'));
try {
    fs.writeFileSync(`${tmp}/audit.c`, c);
    execFileSync('clang', ['-std=c11', '-Wall', '-Werror', '-Wno-unused-parameter', `${tmp}/audit.c`, '-o', `${tmp}/audit`]);
    const output = execFileSync(`${tmp}/audit`, { encoding: 'utf8' });
    fs.writeFileSync(`${dir}/ce-learning.c`, c);
    fs.writeFileSync(`${dir}/ce-learning.txt`, output);
    console.log(output);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
