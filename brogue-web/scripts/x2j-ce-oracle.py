from pathlib import Path
import subprocess, hashlib, json
out=Path('ai_docs/reports/x2j-evidence');ce=Path('../BrogueCE-master/src/brogue/Monsters.c').read_text()
body=ce[ce.index('void updateMonsterState(creature *monst) {'):ce.index('\nvoid decrementMonsterStatus',ce.index('void updateMonsterState(creature *monst) {'))]
head=r'''
#include <stdio.h>
#include <stdbool.h>
typedef bool boolean;
typedef struct {short x,y;} pos;
enum {MONSTER_SLEEPING,MONSTER_WANDERING,MONSTER_TRACKING_SCENT,MONSTER_FLEEING,MONSTER_ALLY};
enum {MODE_NORMAL,MODE_PERM_FLEEING};
enum {MONST_ALWAYS_HUNTING=1,MONST_IMMOBILE=2,MONST_FLEES_NEAR_DEATH=4,MA_HIT_STEAL_FLEE=1,STATUS_MAGICAL_FEAR=0,MB_FOLLOWER=1,IN_FIELD_OF_VIEW=1};
#define DCOLS 79
#define DROWS 29
typedef struct creature {pos loc,lastSeenPlayerAt;struct {int flags,abilityFlags,maxHP;} info;int creatureState,creatureMode,currentHP,status[1],bookkeepingFlags,ticksUntilTurn;void *carriedItem;struct creature *leader;} creature;
creature player;void *monsters;int aware,closest;
typedef int creatureIterator;
creatureIterator iterateCreatures(void *ignored){return 0;}
boolean hasNextCreature(creatureIterator ignored){return false;}
creature *nextCreature(creatureIterator *ignored){return &player;}
boolean awareOfTarget(creature *m,creature *p){return aware;}
boolean monsterFleesFrom(creature *m,creature *p){return closest<4;}
int distanceBetween(pos p,pos q){return closest;}
boolean traversiblePathBetween(creature *m,int x,int y){return true;}
boolean openPathBetween(pos p,pos q){return true;}
struct {int flags;} cell={1};
#define pmapAt(p) (&cell)
void alertMonster(creature *m){m->creatureState=m->creatureMode==MODE_PERM_FLEEING?MONSTER_FLEEING:MONSTER_TRACKING_SCENT;m->lastSeenPlayerAt=player.loc;}
void wakeUp(creature *m){if(m->creatureState!=MONSTER_ALLY)alertMonster(m);m->ticksUntilTurn=100;}
void wanderToward(creature *m,pos p){}
'''
main=r'''
int main(){player.loc=(pos){10,10};int first=1;printf("[");
for(int state=0;state<5;state++)for(int mode=0;mode<2;mode++)for(int flags=0;flags<8;flags++)for(int fear=0;fear<2;fear++)for(int steal=0;steal<2;steal++)for(int item=0;item<2;item++)for(aware=0;aware<2;aware++)for(int health=0;health<4;health++)for(int close=0;close<2;close++){
int hp=(int[]){25,26,75,76}[health];closest=close?2:4;
creature m={.loc={12,10},.lastSeenPlayerAt={-1,-1},.info={flags,steal,100},.creatureState=state,.creatureMode=mode,.currentHP=hp,.status={fear},.carriedItem=item?&player:NULL,.ticksUntilTurn=3};
updateMonsterState(&m);
printf("%s[%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d]",first?"":",",state,mode,flags,fear,steal,item,aware,hp,closest,m.creatureState,m.creatureMode,m.lastSeenPlayerAt.x,m.ticksUntilTurn);first=0;
}puts("]");}
'''
src=head+body+main;(out/'ce-state.c').write_text(src);exe='/private/tmp/x2j-ce-state'
subprocess.run(['cc','-std=c99',str(out/'ce-state.c'),'-o',exe],check=True)
result=subprocess.check_output([exe]);(out/'ce-state.json').write_bytes(result)
(out/'ce-oracle.json').write_text(json.dumps({'cases':len(json.loads(result)),'source':'BrogueCE-master/src/brogue/Monsters.c:updateMonsterState','sourceSHA256':hashlib.sha256(body.encode()).hexdigest(),'scope':'Unmodified CE function; perception, feared-enemy path and wake helper are controlled inputs, tested separately in web.'},indent=2)+'\n')
print(len(json.loads(result)))
