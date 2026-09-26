"""Compile original CE light/recharge functions with deterministic host stubs."""
from pathlib import Path
import json, subprocess, tempfile, hashlib
root=Path('../BrogueCE-master/src/brogue');out=Path('ai_docs/reports/u-15b2-evidence')
def extract(file,start):
 s=(root/file).read_text();a=s.index(start);b=s.index('{',a);depth=1;i=b+1
 while depth:
  depth+=(s[i]=='{')-(s[i]=='}');i+=1
 return s[a:i]
pre=r'''
#include <stdio.h>
#include <stdint.h>
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define clamp(x,a,b) min(max(x,a),b)
#define LAST_INDEX(a) (sizeof(a)/sizeof((a)[0])-1)
#define FP_FACTOR 65536LL
#define STATUS_DARKNESS 0
#define DCOLS 100
#define STAFF 1
#define CHARM 2
#define STAFF_BLINKING 1
#define STAFF_OBSTRUCTION 2
#define false 0
typedef int64_t fixpt;
typedef struct item {unsigned short category; short kind,enchant1,enchant2,charges;struct item *nextItem;} item;
struct {int wisdomBonus,lightMultiplier,inWater;fixpt minersLightRadius;struct {int radialFadeToPercent;struct{int lowerBound,upperBound;}lightRadius;}minersLight;}rogue;
struct {int status[1],maxStatus[1];}player;
item head,*packItems=&head;
int calls=0,lo=0,hi=0;
int randClumpedRange(int a,int b,int c){calls++;lo=a;hi=b;return (a+b)/2;}
int charmRechargeDelay(int kind,int e){return 1000;}
void itemName(item*i,char*s,int a,int b,void*c){s[0]=0;}
void message(char*s,int a){}
'''
functions='\n'.join([extract('PowerTables.c','fixpt ringWisdomMultiplier('),extract('Time.c','short staffChargeDuration('),extract('Time.c','void rechargeItemsIncrementally('),extract('Light.c','void updateMinersLightRadius(')])
main=r'''
int main(){
 int bases[]={65536,123456,720896},lms[]={-4,-3,-2,-1,1,2,4,15},dark[]={0,5,20};
 puts("{\"light\":[");int sep=0;
 for(int b=0;b<3;b++)for(int l=0;l<8;l++)for(int d=0;d<3;d++)for(int w=0;w<2;w++){
 rogue.minersLightRadius=bases[b];rogue.lightMultiplier=lms[l];rogue.inWater=w;player.status[0]=dark[d];player.maxStatus[0]=20;updateMinersLightRadius();
 printf("%s[%d,%d,%d,%d,%d,%d]",sep++?",\n":"",bases[b],lms[l],dark[d],w,rogue.minersLight.lightRadius.lowerBound,rogue.minersLight.radialFadeToPercent);
 }
 puts("],\"recharge\":[");sep=0;
 int wis[]={-10,-2,0,1,5,27},mult[]={-3200,-3000,-100,-3,0,1,3,100,3200},timers[]={1,500,3000};
 for(int k=0;k<3;k++)for(int w=0;w<6;w++)for(int m=0;m<9;m++)for(int c=0;c<4;c++)for(int t=0;t<3;t++){
 item a={STAFF,k,3,timers[t],c,NULL};head.nextItem=&a;rogue.wisdomBonus=wis[w];calls=0;lo=hi=0;
 rechargeItemsIncrementally(mult[m]);
 printf("%s[%d,%d,%d,%d,%d,%d,%d,%d,%d,%d]",sep++?",\n":"",k,wis[w],mult[m],c,timers[t],a.charges,a.enchant2,calls,lo,hi);
 }
 puts("]}");return 0;
}
'''
s=pre+functions+main;(out/'ce-oracle.c').write_text(s)
with tempfile.TemporaryDirectory(prefix='u15b2-ce-') as td:
 exe=Path(td)/'oracle';subprocess.run(['cc','-w','-o',str(exe),str(out/'ce-oracle.c')],check=True)
 data=json.loads(subprocess.check_output([str(exe)]));(out/'ce-golden.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
(out/'ce-sources.json').write_text(json.dumps({f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in ['Items.c','Globals.c','Combat.c','Light.c','Time.c','PowerTables.c','Rogue.h']},indent=2)+'\n')
print({k:len(v) for k,v in data.items()})
