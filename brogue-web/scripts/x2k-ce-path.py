from pathlib import Path
import subprocess, hashlib, json
out=Path('ai_docs/reports/x2k-evidence')
base=Path('../BrogueCE-master/src/brogue')
g=(base/'Grid.c').read_text();m=(base/'Monsters.c').read_text();d=(base/'Dijkstra.c').read_text()
near=m[m.index('boolean getQualifyingLocNear(pos *loc,'):m.index('\nboolean getQualifyingGridLocNear',m.index('boolean getQualifyingLocNear(pos *loc,'))]
path=g[g.index('static short leastPositiveValueInGrid'):g.index('\nstatic void cellularAutomataRound')]
pds=d[d.index('typedef struct pdsLink'):d.index('\nvoid calculateDistances(')]
head=r'''
#include <stdio.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
typedef bool boolean;
typedef struct {short x,y;} pos;
#define DCOLS 9
#define DROWS 9
#define INVALID_POS ((pos){-1,-1})
#define PDS_CELL(m,x,y) (&(m)->links[(x)+DCOLS*(y)])
#define PDS_OBSTRUCTION -2
#define PDS_FORBIDDEN -1
#define T_OBSTRUCTS_PASSABILITY 1
#define T_OBSTRUCTS_DIAGONAL_MOVEMENT 2
#define max(a,b) ((a)>(b)?(a):(b))
#define brogueAssert(x) do {if(!(x)) abort();} while(0)
const short nbDirs[8][2]={{0,-1},{0,1},{-1,0},{1,0},{-1,-1},{-1,1},{1,-1},{1,1}};
struct cell {unsigned long flags,terrain;short layers[4];} pmap[DCOLS][DROWS];
#define LIQUID 1
#define NOTHING 0
#define pmapAt(p) (&pmap[(p).x][(p).y])
boolean coordinatesAreInMap(int x,int y){return x>=0&&y>=0&&x<DCOLS&&y<DROWS;}
boolean isPosInMap(pos p){return coordinatesAreInMap(p.x,p.y);}
boolean cellHasTerrainFlag(pos p,unsigned long f){return !!(pmapAt(p)->terrain&f);}
int passableArcCount(int x,int y){return 0;}
short **allocGrid(){short **g=malloc(DCOLS*sizeof(*g));for(int x=0;x<DCOLS;x++)g[x]=calloc(DROWS,sizeof(**g));return g;}
void freeGrid(short **g){for(int x=0;x<DCOLS;x++)free(g[x]);free(g);}
void fillGrid(short **g,short v){for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)g[x][y]=v;}
void getTerrainGrid(short **g,short v,unsigned long t,unsigned long f){for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)if((pmap[x][y].terrain&t)||(pmap[x][y].flags&f))g[x][y]=v;}
void getPassableArcGrid(short **g,int a,int b,int c){}
void findReplaceGrid(short **g,short lo,short hi,short v){for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)if(g[x][y]>=lo&&g[x][y]<=hi)g[x][y]=v;}
short validLocationCount(short **g,short v){short count=0;for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)if(g[x][y]==v)count++;return count;}
int choice;
short rand_range(int lo,int hi){return lo+choice%(hi-lo+1);}
'''
main=r'''
int main(){puts("[");for(int seed=0;seed<128;seed++) {
 unsigned state=seed+1;int cells[81];
 for(int x=0;x<9;x++)for(int y=0;y<9;y++){state=state*1664525u+1013904223u;int n=(state>>16)%6;if(!x||!y||x==8||y==8)n=1;cells[x*9+y]=n;pmap[x][y].terrain=n==1?7:n==2?8:n==3?16:0;pmap[x][y].flags=n==4?1:0;}
 for(int mode=0;mode<2;mode++) {pos origin={(seed%7)+1,((seed/7)%7)+1};unsigned long blocking=mode?1|8|16:1|8, forbidden=mode?0:4;int seen[81]={0};
 for(choice=0;choice<81;choice++){pos p=getQualifyingPathLocNear(origin,true,blocking,0,forbidden,1,false);if(isPosInMap(p))seen[p.x*9+p.y]=1;}
 printf("%s{\"seed\":%d,\"mode\":%d,\"origin\":[%d,%d],\"cells\":[",seed||mode?",":"",seed,mode,origin.x,origin.y);
 for(int i=0;i<81;i++)printf("%s%d",i?",":"",cells[i]);printf("],\"candidates\":[");int first=1;for(int i=0;i<81;i++)if(seen[i]){printf("%s[%d,%d]",first?"":",",i/9,i%9);first=0;}printf("]}");
 }}puts("]");}
'''
source=head+'\n'+pds+'\n'+near+'\n'+path+'\n'+main
(out/'ce-path.c').write_text(source)
subprocess.run(['cc','-std=c11','-O2','-w',str(out/'ce-path.c'),'-o','/private/tmp/x2k-ce-path'],check=True)
r=subprocess.check_output(['/private/tmp/x2k-ce-path']);(out/'ce-path.json').write_bytes(r)
(out/'ce-path-provenance.json').write_text(json.dumps({'sources':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [base/'Grid.c',base/'Dijkstra.c',base/'Monsters.c']},'cases':len(json.loads(r))},indent=2)+'\n')
