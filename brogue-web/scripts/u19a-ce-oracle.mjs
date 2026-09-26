// Compile the actual local CE scan + fixed-point sqrt, never the web algorithm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='../BrogueCE-master/src/brogue/';
const movement=fs.readFileSync(`${root}Movement.c`,'utf8'),math=fs.readFileSync(`${root}Math.c`,'utf8');
const scan=movement.slice(movement.indexOf('void betweenOctant1andN('),movement.indexOf('void addScentToCell('));
const sqrt=math.slice(math.indexOf('static int msbpos('),math.indexOf('// Returns base to the power of expn'));
const header=`#include <stdio.h>
#include <stdbool.h>
#include <string.h>
typedef long long fixpt;
typedef bool boolean;
typedef struct {short x,y;} pos;
#define DCOLS 79
#define DROWS 29
#define FP_BASE 16
#define FP_FACTOR (1LL << FP_BASE)
#define FP_MUL(x,y) ((x)*(y)/FP_FACTOR)
#define LOS_SLOPE_GRANULARITY 32768
#define IN_FIELD_OF_VIEW 1
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
struct {unsigned long flags;} pmap[DCOLS][DROWS];
static bool blocked[DCOLS][DROWS];
bool coordinatesAreInMap(short x,short y){return x>=0&&y>=0&&x<DCOLS&&y<DROWS;}
bool cellHasTerrainFlag(pos p,unsigned long f){return blocked[p.x][p.y] && f;}
void scanOctantFOV(char g[DCOLS][DROWS],short x,short y,short o,fixpt r,short c,long s,long e,unsigned long t,unsigned long f,boolean w);
`;
const main=`int main(void){int n,x,y,count,bx,by;scanf("%d",&n);while(n--){memset(blocked,0,sizeof(blocked));scanf("%d%d%d",&x,&y,&count);while(count--){scanf("%d%d",&bx,&by);blocked[bx][by]=true;}char g[DCOLS][DROWS]={0};getFOVMask(g,x,y,79*FP_FACTOR,1,0,false);g[x][y]=1;for(int j=0;j<DROWS;j++)for(int i=0;i<DCOLS;i++)putchar(g[i][j]?'1':'0');putchar('\\n');}return 0;}`;
const cases=[];
for(const origin of [{x:0,y:0},{x:78,y:28},{x:39,y:14}])cases.push({name:`open-${origin.x}-${origin.y}`,origin,blocked:[]});
// Every combination in an asymmetric 3x3 patch; exposes slope and corner rules.
for(let bits=0;bits<512;bits++)cases.push({name:`patch-${bits}`,origin:{x:35,y:14},blocked:Array.from({length:9},(_,i)=>[37+i%3,12+Math.floor(i/3)]).filter((_,i)=>bits&(1<<i))});
let state=19019;const draw=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
for(let i=0;i<64;i++){
 const origin={x:draw()%79,y:draw()%29},blocked=[];
 for(let x=0;x<79;x++)for(let y=0;y<29;y++)if(draw()%7===0)blocked.push([x,y]);
 cases.push({name:`noise-${i}`,origin,blocked});
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u19a-ce-'));
try{
 const machineInput=process.argv[2];
 if(machineInput){
  const machines=JSON.parse(fs.readFileSync(machineInput,'utf8'));
  cases.splice(0,cases.length,...machines.flatMap(m=>m.snapshots));
 }
 fs.writeFileSync(`${temp}/oracle.c`,header+sqrt+scan+main);
 execFileSync('cc',['-std=c99','-O2',`${temp}/oracle.c`,'-o',`${temp}/oracle`]);
 const input=[cases.length,...cases.map(c=>[c.origin.x,c.origin.y,c.blocked.length,...c.blocked.flat()].join(' '))].join('\n');
 const masks=execFileSync(`${temp}/oracle`,{input,encoding:'utf8',maxBuffer:8e6}).trim().split('\n');
 const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 if(machineInput){
  const rows=cases.map((c,i)=>({ce:c.ce,feature:c.feature,origin:c.origin,passable:c.passable,placements:c.placements,
   accepted:[...new Set(c.accepted.map(p=>p.y*79+p.x))].length,
   outsideCandidates:c.accepted.filter(p=>masks[i][p.y*79+p.x]!=='1'),outsidePlacements:c.placements.filter(p=>masks[i][p.y*79+p.x]!=='1'),ceMaskSHA256:sha(masks[i])}));
  fs.writeFileSync(process.argv[3],JSON.stringify(rows,null,2)+'\n');
  if(rows.some(r=>r.outsideCandidates.length||r.outsidePlacements.length))throw Error('Machine sites outside CE view');
  console.log(`CE verified all candidates and placements in ${rows.length} actual feature snapshots.`);
 }else{
  fs.writeFileSync('src/test/fixtures/u19a-ce-view.json',JSON.stringify({source:{movement:sha(movement),math:sha(math),scan:sha(scan),sqrt:sha(sqrt),radius:79},cases:cases.map((c,i)=>({...c,mask:sha(masks[i])}))})+'\n');
  console.log(`${cases.length} independent CE masks captured.`);
 }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
