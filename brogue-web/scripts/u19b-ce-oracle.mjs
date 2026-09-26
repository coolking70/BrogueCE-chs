// Actual CE predicates, compiled unchanged. Only map/allocation/RNG/path services
// are controlled fixtures; this does not claim a complete CE generation replay.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const file='../BrogueCE-master/src/brogue/Architect.c',source=fs.readFileSync(file,'utf8');
const code=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,s=>' '.repeat(s.length));
function fn(name){const begin=source.indexOf('static boolean '+name+'('),brace=source.indexOf('{',begin);let d=1,i=brace+1;while(d&&i<source.length){if(code[i]==='{')d++;else if(code[i]==='}')d--;i++;}if(d)throw Error('Unbalanced extraction: '+name);if(begin<0)throw Error(name);return source.slice(begin,i);}
const names=['cellIsFeatureCandidate','fillInteriorForVestibuleMachine','addTileToMachineInteriorAndIterate'],functions=names.map(fn),flags=[...new Set(functions.join('\n').match(/\b(?:MF_|BP_|HAS_|IS_|IN_LOOP|T_)[A-Z_]*\b/g))];
// HAS_PLAYER/HAS_STAIRS/HAS_DORMANT_MONSTER are deliberately absent from these CE predicates.
for(const f of ['HAS_ITEM','HAS_MONSTER','HAS_PLAYER','HAS_STAIRS','HAS_DORMANT_MONSTER'])if(!flags.includes(f))flags.push(f);
const header=`#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>
typedef bool boolean;typedef struct {short x,y;} pos;
#define DCOLS 79
#define DROWS 29
#define PDS_FORBIDDEN -1
${flags.map((f,i)=>`#define ${f} (1UL << ${i})`).join('\n')}
struct {unsigned long flags;short machineNumber;} pmap[DCOLS][DROWS];
struct {short roomSize[2];unsigned long flags;} blueprintCatalog[1];
short chokeMap[DCOLS][DROWS];short nbDirs[4][2]={{0,-1},{0,1},{-1,0},{1,0}};
boolean coordinatesAreInMap(int x,int y){return x>=0&&y>=0&&x<DCOLS&&y<DROWS;}
boolean cellHasTerrainFlag(pos p,unsigned long f){return (!(p.y==10&&p.x>=10&&p.x<=12)) && (f&(T_OBSTRUCTS_PASSABILITY|T_PATHING_BLOCKER));}
int passableArcCount(int x,int y){return 0;}
short **allocGrid(void){short **g=malloc(DCOLS*sizeof(*g));for(int x=0;x<DCOLS;x++)g[x]=calloc(DROWS,sizeof(short));return g;}
void freeGrid(short **g){for(int x=0;x<DCOLS;x++)free(g[x]);free(g);}
void fillGrid(short **g,int v){for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)g[x][y]=v;}
void zeroOutGrid(char g[DCOLS][DROWS]){memset(g,0,DCOLS*DROWS);}
void populateGenericCostMap(short **g){for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)g[x][y]=cellHasTerrainFlag((pos){x,y},T_PATHING_BLOCKER)?-1:1;}
void dijkstraScan(short **d,short **c,boolean diagonals){for(int n=0;n<4;n++)for(int x=1;x<DCOLS-1;x++)for(int y=1;y<DROWS-1;y++)if(c[x][y]>0)for(int k=0;k<4;k++){int nx=x+nbDirs[k][0],ny=y+nbDirs[k][1];if(c[nx][ny]>0&&d[x][y]>d[nx][ny]+1)d[x][y]=d[nx][ny]+1;}}
int rand_range(int lo,int hi){return lo;}
void fillSequentialList(short *a,int n){for(int i=0;i<n;i++)a[i]=i;}
void shuffleList(short *a,int n){}
int levelIsDisconnectedWithBlockingMap(char g[DCOLS][DROWS],boolean b){return 0;}
`;
const main=`int main(void){unsigned long entities[]={HAS_ITEM,HAS_MONSTER,HAS_PLAYER,HAS_STAIRS,HAS_DORMANT_MONSTER};for(int mask=0;mask<32;mask++)for(int at=10;at<=11;at++){
 memset(pmap,0,sizeof(pmap));unsigned long f=0;for(int i=0;i<5;i++)if(mask&(1<<i))f|=entities[i];pmap[at][10].flags=f;
 char interior[DCOLS][DROWS]={0},occupied[DCOLS][DROWS]={0},view[DCOLS][DROWS];memset(view,1,sizeof(view));short **dist=allocGrid();fillGrid(dist,0);short bound[2]={0,100};interior[at][10]=true;
 int candidate=cellIsFeatureCandidate(at,10,12,10,bound,interior,occupied,view,dist,1,0,0);
 blueprintCatalog[0].roomSize[0]=blueprintCatalog[0].roomSize[1]=2;blueprintCatalog[0].flags=0;
 int vestibule=fillInteriorForVestibuleMachine(interior,0,10,10);
 for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)chokeMap[x][y]=30000;for(int x=10;x<=12;x++)chokeMap[x][10]=1;zeroOutGrid(interior);
 int room=addTileToMachineInteriorAndIterate(interior,10,10);
 printf("%d %d %d %d %d\\n",mask,at,candidate,vestibule,room);freeGrid(dist);
 }return 0;}`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u19b-ce-')),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
try{fs.writeFileSync(`${tmp}/oracle.c`,header+functions.join('\n')+main);execFileSync('cc',['-std=c99','-O2',`${tmp}/oracle.c`,'-o',`${tmp}/oracle`]);
 const rows=execFileSync(`${tmp}/oracle`,{encoding:'utf8'}).trim().split('\n').map(line=>{const [mask,x,candidate,vestibule,room]=line.split(' ').map(Number);return {mask,x,candidate:!!candidate,vestibule:!!vestibule,room:!!room};});
 fs.writeFileSync('src/test/fixtures/u19b-ce-occupancy.json',JSON.stringify({file,sha256:sha(source),functions:Object.fromEntries(names.map((n,i)=>[n,sha(functions[i])])),entityBits:['HAS_ITEM','HAS_MONSTER','HAS_PLAYER','HAS_STAIRS','HAS_DORMANT_MONSTER'],rows},null,2)+'\n');console.log(rows.length,'compiled CE occupancy truth-table rows');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
