// Compile unmodified CE selector/perimeter; deterministic impact/world stubs.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
const dir='ai_docs/reports/u-07-evidence';
const ce=fs.readFileSync('../BrogueCE-master/src/brogue/Monsters.c','utf8');
const start=ce.indexOf('pos perimeterCoords(short n)'),end=ce.indexOf('static boolean fleeingMonsterAwareOfPlayer',start),source=ce.slice(start,end);
const c=`#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
typedef bool boolean;
typedef struct {short x,y;} pos;
enum boltType { BOLT_NONE, BOLT_BLINKING };
typedef struct {int unused;} bolt;
typedef struct {pos loc; short ticksUntilTurn,attackSpeed; struct {int flags;} info;} creature;
#define DCOLS 31
#define FP_FACTOR 65536
#define BE_BLINKING 1
#define T_OBSTRUCTS_PASSABILITY 1
#define MONST_CAST_SPELLS_SLOWLY 1
#define REQUIRE_ACKNOWLEDGMENT 0
static bolt boltCatalog[2];
static short vals[31][31],*map[31];
static int avoid[31][31],block[31][31],calls,hasBolt;
static pos impacts[40],aimed;
static int monsterHasBoltEffect(creature*m,int e){return hasBolt;}
static int staffBlinkDistance(int e){return 2+2*e/FP_FACTOR;}
static pos posNeighborInDirection(pos p,int i){int dx[]={0,0,-1,1},dy[]={-1,1,0,0};return(pos){p.x+dx[i],p.y+dy[i]};}
static bool monsterAvoids(creature*m,pos p){return avoid[p.x][p.y];}
static void getImpactLoc(pos*r,pos o,pos t,int d,bool b,bolt*z){if(d!=12)abort();*r=impacts[calls++];}
static bool cellHasTerrainFlag(pos p,int f){return block[p.x][p.y];}
static bool canDirectlySeeMonster(creature*m){return false;}
static void monsterName(char*s,creature*m,bool b){}
static void combatMessage(char*s,int n){}
static void message(char*s,int n){}
static void zap(pos o,pos t,bolt*b,bool x,bool y){aimed=t;}
${source}
int main(){int n;scanf("%d",&n);for(int k=0;k<n;k++){int up,slow;scanf("%d %d %d",&up,&hasBolt,&slow);for(int x=0;x<31;x++){map[x]=vals[x];for(int y=0;y<31;y++){int v,a,b;scanf("%d %d %d",&v,&a,&b);vals[x][y]=v;avoid[x][y]=a;block[x][y]=b;}}for(int i=0;i<40;i++)scanf("%hd %hd",&impacts[i].x,&impacts[i].y);creature m={.loc={15,15},.ticksUntilTurn=17,.attackSpeed=73,.info.flags=slow};calls=0;aimed=(pos){-1,-1};int ok=monsterBlinkToPreferenceMap(&m,map,up);printf("%d %d %d %d %d\\n",ok,aimed.x,aimed.y,m.ticksUntilTurn,calls);}return 0;}
`;
let seed=701;const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
const cases=[];
for(let k=0;k<100;k++){
 const values=Array.from({length:31},()=>Array.from({length:31},()=>next(100)-50));
 const avoids=Array.from({length:31},()=>Array.from({length:31},()=>next(5)===0?1:0));
 const blocks=Array.from({length:31},()=>Array.from({length:31},()=>next(5)===0?1:0));
 const impacts=Array.from({length:40},()=>({x:next(25)+3,y:next(25)+3}));
 if(k<10)values.forEach(col=>col.fill(k%3));
 cases.push({uphill:!!(k%2),hasBolt:k%13!==0,slow:!!(k%3),values,avoids,blocks,impacts});
}
const input=[cases.length,...cases.flatMap(c=>[`${+c.uphill} ${+c.hasBolt} ${+c.slow}`,...c.values.flatMap((col,x)=>col.map((v,y)=>`${v} ${c.avoids[x][y]} ${c.blocks[x][y]}`)),...c.impacts.map(p=>`${p.x} ${p.y}`)])].join('\n');
fs.writeFileSync(`${dir}/ce-blink.c`,c);
execFileSync('cc',['-std=c99','-O2',`${dir}/ce-blink.c`,'-o','/tmp/u07-ce-blink']);
execFileSync('/tmp/u07-ce-blink',{input,encoding:'utf8'}).trim().split('\n').forEach((row,i)=>{const[ok,x,y,ticks,calls]=row.split(' ').map(Number);cases[i].expected={ok:!!ok,aim:{x,y},ticks,calls};});
fs.writeFileSync(`${dir}/ce-blink.json`,JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),cases})+'\n');
console.log(`CE selector: ${cases.length} vectors, unchanged source compiled; impact/rules are explicit stubs.`);
