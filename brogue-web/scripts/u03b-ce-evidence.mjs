// Compile the local CE eligibility/countdown loop verbatim, with a one-creature
// list and injected distance maps; compare independently to the TS public helper.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/u-03b-evidence';
const sources=['RogueMain.c','Time.c','Architect.c','Dijkstra.c','Grid.c','Movement.c','Monsters.c'];
const manifest=Object.fromEntries(sources.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(`../BrogueCE-master/src/brogue/${f}`)).digest('hex')]));
const source=fs.readFileSync('../BrogueCE-master/src/brogue/RogueMain.c','utf8');
const start=source.indexOf('        for (flying = 0; flying <= 1; flying++)'),end=source.indexOf('        freeGrid(mapToStairs);',start);
const loop=source.slice(start,end);
fs.writeFileSync(`${dir}/ce-follow-loop.c.txt`,loop);
const c=`#include <stdio.h>
#include <stdbool.h>
#define MONSTER_TRACKING_SCENT 1
#define MONSTER_ALLY 2
#define T_OBSTRUCTS_PASSABILITY 1
#define T_PATHING_BLOCKER 3
#define T_SACRED 4
#define T_AUTO_DESCENT 2
#define MB_CAPTIVE 1
#define MONST_WILL_NOT_USE_STAIRS 1
#define MONST_RESTRICTED_TO_LIQUID 2
#define MB_APPROACHING_DOWNSTAIRS 2
#define MB_APPROACHING_UPSTAIRS 4
#define MB_APPROACHING_PIT 8
#define STATUS_LEVITATING 0
#define STATUS_ENTRANCED 1
#define STATUS_PARALYZED 2
#define STATUS_ENTERS_LEVEL_IN 3
#define clamp(v,a,b) ((v)<(a)?(a):(v)>(b)?(b):(v))
typedef struct {short x,y;} pos;
typedef struct {pos loc; int creatureState,currentHP,status[4],movementSpeed,bookkeepingFlags; struct {int flags;} info;} creature;
creature one; creature *monsters=&one; struct {creature *yendorWarden;} rogue;
typedef struct {bool pending;} creatureIterator;
creatureIterator iterateCreatures(creature *m){return (creatureIterator){true};}
bool hasNextCreature(creatureIterator i){return i.pending;}
creature *nextCreature(creatureIterator *i){i->pending=false;return &one;}
short cells[8][8],*map[8];int terrain,walking,flyingDistance;
void fillGrid(short **g,int v){}
bool cellHasTerrainFlag(pos p,int f){return p.x==3 && p.y==3 && (terrain&f);}
void calculateDistances(short **g,int x,int y,int blocking,void*t,bool secret,bool eight){g[3][3]=blocking==(T_OBSTRUCTS_PASSABILITY|T_SACRED)?flyingDistance:walking;}
int main(){for(int i=0;i<8;i++)map[i]=cells[i];int state,hp,lev,cap,flags,entranced,paralyzed,direction,speed,walk,fly,t;
while(scanf("%d %d %d %d %d %d %d %d %d %d %d %d",&state,&hp,&lev,&cap,&flags,&entranced,&paralyzed,&direction,&speed,&walk,&fly,&t)==12){
one=(creature){.loc={3,3},.creatureState=state,.currentHP=hp,.movementSpeed=speed,.bookkeepingFlags=cap,.info={flags},.status={lev,entranced,paralyzed,0}};
terrain=t;walking=walk;flyingDistance=fly;short flying,x,y,px=1,py=1,stairDirection=direction;short **mapToStairs=map;
${loop}
printf("%d %d\\n",one.status[3],one.bookkeepingFlags & 14);
}return 0;}`;
fs.writeFileSync('/tmp/u03b-ce.c',c);
execFileSync('cc',['-std=c11','-O2','/tmp/u03b-ce.c','-o','/tmp/u03b-ce']);
// Exhaustive eligibility gates, plus both speed arithmetic and boundary distances.
const cases=[];
for(const state of [0,1,2])for(const direction of [-1,0,1])for(let mask=0;mask<128;mask++)for(const distance of [0,4,149,30000]) {
 cases.push([state,mask&1?10:11,mask&2?1:0,mask&4?1:0,mask&8?1:mask&16?2:0,mask&32?1:0,mask&64?1:0,direction,150,distance,distance,0]);
}
const output=execFileSync('/tmp/u03b-ce',[],{input:cases.map(r=>r.join(' ')).join('\n'),encoding:'utf8',maxBuffer:4e6}).trim().split('\n').map(r=>r.split(' ').map(Number));
fs.writeFileSync(`${dir}/ce-golden.json`,JSON.stringify({manifest,cases,output})+'\n');
fs.writeFileSync('src/test/fixtures/u03b-ce-follow.json',JSON.stringify({cases,output})+'\n');
console.log(JSON.stringify({cases:cases.length,manifest}));
