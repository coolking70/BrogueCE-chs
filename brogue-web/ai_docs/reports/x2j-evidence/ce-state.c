
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
void updateMonsterState(creature *monst) {
    short x, y, closestFearedEnemy;
    boolean awareOfPlayer;

    x = monst->loc.x;
    y = monst->loc.y;

    if ((monst->info.flags & MONST_ALWAYS_HUNTING)
        && monst->creatureState != MONSTER_ALLY) {

        monst->creatureState = MONSTER_TRACKING_SCENT;
        return;
    }

    awareOfPlayer = awareOfTarget(monst, &player);

    if ((monst->info.flags & MONST_IMMOBILE)
        && monst->creatureState != MONSTER_ALLY) {

        if (awareOfPlayer) {
            monst->creatureState = MONSTER_TRACKING_SCENT;
        } else {
            monst->creatureState = MONSTER_SLEEPING;
        }
        return;
    }

    if (monst->creatureMode == MODE_PERM_FLEEING
        && (monst->creatureState == MONSTER_WANDERING || monst->creatureState == MONSTER_TRACKING_SCENT)) {

        monst->creatureState = MONSTER_FLEEING;
    }

    closestFearedEnemy = DCOLS+DROWS;

    boolean handledPlayer = false;
    for (creatureIterator it = iterateCreatures(monsters); !handledPlayer || hasNextCreature(it);) {
        creature *monst2 = !handledPlayer ? &player : nextCreature(&it);
        handledPlayer = true;
        if (monsterFleesFrom(monst, monst2)
            && distanceBetween((pos){x, y}, monst2->loc) < closestFearedEnemy
            && traversiblePathBetween(monst2, x, y)
            && openPathBetween((pos){x, y}, monst2->loc)) {

            closestFearedEnemy = distanceBetween((pos){x, y}, monst2->loc);
        }
    }

    if ((monst->creatureState == MONSTER_WANDERING)
        && awareOfPlayer
        && (pmapAt(player.loc)->flags & IN_FIELD_OF_VIEW)) {
        // If wandering and you notice the player, start tracking the scent.
        alertMonster(monst);
    } else if (monst->creatureState == MONSTER_SLEEPING) {
        // if sleeping, the monster has a chance to awaken
        if (awareOfPlayer) {
            wakeUp(monst); // wakes up the whole horde if necessary
        }
    } else if (monst->creatureState == MONSTER_TRACKING_SCENT && !awareOfPlayer) {
        // if tracking scent, but the scent is weaker than the scent detection threshold, begin wandering.
        monst->creatureState = MONSTER_WANDERING;
        wanderToward(monst, monst->lastSeenPlayerAt);
    } else if (monst->creatureState == MONSTER_TRACKING_SCENT
               && closestFearedEnemy < 3) {
        monst->creatureState = MONSTER_FLEEING;
    } else if (monst->creatureState != MONSTER_ALLY
               && (monst->info.flags & MONST_FLEES_NEAR_DEATH)
               && monst->currentHP <= 3 * monst->info.maxHP / 4) {

        if (monst->creatureState == MONSTER_FLEEING
            || monst->currentHP <= monst->info.maxHP / 4) {

            monst->creatureState = MONSTER_FLEEING;
        }
    } else if (monst->creatureMode == MODE_NORMAL
               && monst->creatureState == MONSTER_FLEEING
               && !(monst->status[STATUS_MAGICAL_FEAR])
               && closestFearedEnemy >= 3) {

        monst->creatureState = MONSTER_TRACKING_SCENT;
    } else if (monst->creatureMode == MODE_PERM_FLEEING
               && monst->creatureState == MONSTER_FLEEING
               && (monst->info.abilityFlags & MA_HIT_STEAL_FLEE)
               && !(monst->status[STATUS_MAGICAL_FEAR])
               && !(monst->carriedItem)) {

        monst->creatureMode = MODE_NORMAL;

        if (monst->leader == &player) {
            monst->creatureState = MONSTER_ALLY; // Reset state if a discorded ally steals an item and then loses it (probably in deep water)
        } else {
            alertMonster(monst);
        }

    } else if (monst->creatureMode == MODE_NORMAL
               && monst->creatureState == MONSTER_FLEEING
               && (monst->info.flags & MONST_FLEES_NEAR_DEATH)
               && !(monst->status[STATUS_MAGICAL_FEAR])
               && monst->currentHP >= monst->info.maxHP * 3 / 4) {

        if ((monst->bookkeepingFlags & MB_FOLLOWER) && monst->leader == &player) {
            monst->creatureState = MONSTER_ALLY;
        } else {
            alertMonster(monst);
        }
    }

    if (awareOfPlayer) {
        if (monst->creatureState == MONSTER_FLEEING
            || monst->creatureState == MONSTER_TRACKING_SCENT) {

            monst->lastSeenPlayerAt = player.loc;
        }
    }
}

int main(){player.loc=(pos){10,10};int first=1;printf("[");
for(int state=0;state<5;state++)for(int mode=0;mode<2;mode++)for(int flags=0;flags<8;flags++)for(int fear=0;fear<2;fear++)for(int steal=0;steal<2;steal++)for(int item=0;item<2;item++)for(aware=0;aware<2;aware++)for(int health=0;health<4;health++)for(int close=0;close<2;close++){
int hp=(int[]){25,26,75,76}[health];closest=close?2:4;
creature m={.loc={12,10},.lastSeenPlayerAt={-1,-1},.info={flags,steal,100},.creatureState=state,.creatureMode=mode,.currentHP=hp,.status={fear},.carriedItem=item?&player:NULL,.ticksUntilTurn=3};
updateMonsterState(&m);
printf("%s[%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d]",first?"":",",state,mode,flags,fear,steal,item,aware,hp,closest,m.creatureState,m.creatureMode,m.lastSeenPlayerAt.x,m.ticksUntilTurn);first=0;
}puts("]");}
