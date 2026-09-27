#include <stdio.h>
#include <stdbool.h>
#define boolean bool
#define MONST_SUBMERGES 1
#define MONST_IMMUNE_TO_FIRE 2
#define MONST_INVULNERABLE 4
#define MB_SEIZING 1
#define MB_SEIZED 2
#define MB_CAPTIVE 4
#define MB_SUBMERGED 8
#define STATUS_IMMUNE_TO_FIRE 0
#define STATUS_LEVITATING 1
#define TM_ALLOWS_SUBMERGING 1
#define T_OBSTRUCTS_PASSABILITY 2
#define T_LAVA_INSTA_DEATH 4
#define T_IS_DEEP_WATER 8
#define min(a,b) ((a)<(b)?(a):(b))
typedef struct { int x,y; } pos;
typedef struct { struct {int flags;} info; int bookkeepingFlags; int status[2]; pos loc; int currentHP; } creature;
int terrain[2], mech;
int terrainFlags(pos p) {return terrain[p.x];}
bool cellHasTerrainFlag(pos p,int f) {return (terrainFlags(p)&f)!=0;}
bool cellHasTMFlag(pos p,int f) {return (mech&f)!=0;}
boolean monsterCanSubmergeNow(creature *monst) {
    return ((monst->info.flags & MONST_SUBMERGES)
            && cellHasTMFlag(monst->loc, TM_ALLOWS_SUBMERGING)
            && !cellHasTerrainFlag(monst->loc, T_OBSTRUCTS_PASSABILITY)
            && !(monst->bookkeepingFlags & (MB_SEIZING | MB_SEIZED | MB_CAPTIVE))
            && ((monst->info.flags & (MONST_IMMUNE_TO_FIRE | MONST_INVULNERABLE))
                || monst->status[STATUS_IMMUNE_TO_FIRE]
                || !cellHasTerrainFlag(monst->loc, T_LAVA_INSTA_DEATH)));
}
boolean monsterHiddenBySubmersion(const creature *monst, const creature *observer) {
    if (monst->bookkeepingFlags & MB_SUBMERGED) {
        if (observer
            && (terrainFlags(observer->loc) & T_IS_DEEP_WATER)
            && !observer->status[STATUS_LEVITATING]) {
            // observer is in deep water, so target is not hidden by water
            return false;
        } else {
            // submerged and the observer is not in deep water.
            return true;
        }
    }
    return false;
}
int main(void) {
 printf("{\"submerge\":[");
 for(int i=0;i<1024;i++) {
 creature m={0};m.info.flags=i&7;m.bookkeepingFlags=(i>>3)&7;m.status[0]=(i>>6)&1;
 mech=(i>>7)&1;terrain[0]=((i>>8)&1)*2+((i>>9)&1)*4;
 printf("%s%d",i?",":"",monsterCanSubmergeNow(&m));
 }
 printf("],\"hidden\":[");
 for(int i=0;i<16;i++) {creature m={0},o={0};m.bookkeepingFlags=(i&1)*8;o.loc.x=1;terrain[1]=((i>>1)&1)*8;o.status[1]=(i>>2)&1;
 printf("%s%d",i?",":"",monsterHiddenBySubmersion(&m,(i&8)?&o:NULL));}
 printf("],\"blood\":[");
 for(int hp=1;hp<=80;hp++)for(int damage=1;damage<=100;damage++) {struct {int startProbability;} theBlood={12};creature d={0};creature *defender=&d;d.currentHP=hp;
 theBlood.startProbability = (theBlood.startProbability *
         (15 + min(damage, defender->currentHP) * 3 / 2) / 100);
 theBlood.startProbability *=100;
 printf("%s[%d,%d,%d]",hp==1&&damage==1?"":",",hp,damage,theBlood.startProbability);
 }
 printf("]}");return 0;
}
