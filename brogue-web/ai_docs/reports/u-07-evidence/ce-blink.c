#include <stdio.h>
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
pos perimeterCoords(short n) {
    if (n <= 10) {          // top edge, left to right
        return (pos){
            .x = n - 5,
            .y = -5
        };
    } else if (n <= 21) {   // bottom edge, left to right
        return (pos){
            .x = (n - 11) - 5,
            .y = 5
        };
    } else if (n <= 30) {   // left edge, top to bottom
        return (pos){
            .x = -5,
            .y = (n - 22) - 4
        };
    } else if (n <= 39) {   // right edge, top to bottom
        return (pos){
            .x = 5,
            .y = (n - 31) - 4
        };
    } else {
        message("ERROR! Bad perimeter coordinate request!", REQUIRE_ACKNOWLEDGMENT);
        return (pos){ .x = 0, .y = 0 }; // garbage in, garbage out
    }
}

// Tries to make the monster blink to the most desirable square it can aim at, according to the
// preferenceMap argument. "blinkUphill" determines whether it's aiming for higher or lower numbers on
// the preference map -- true means higher. Returns true if the monster blinked; false if it didn't.
boolean monsterBlinkToPreferenceMap(creature *monst, short **preferenceMap, boolean blinkUphill) {
    short i, nowPreference, maxDistance;
    boolean gotOne;
    char monstName[DCOLS];
    char buf[DCOLS];
    enum boltType theBoltType;
    bolt theBolt;

    theBoltType = monsterHasBoltEffect(monst, BE_BLINKING);
    if (!theBoltType) {
        return false;
    }

    maxDistance = staffBlinkDistance(5 * FP_FACTOR);
    gotOne = false;

    pos origin = monst->loc;
    pos bestTarget = (pos){ .x = 0, .y = 0 };
    short bestPreference = preferenceMap[monst->loc.x][monst->loc.y];

    // make sure that we beat the four cardinal neighbors
    for (i = 0; i < 4; i++) {
        const pos monstNeighborLoc = posNeighborInDirection(monst->loc, i);
        nowPreference = preferenceMap[monstNeighborLoc.x][monstNeighborLoc.y];

        if (((blinkUphill && nowPreference > bestPreference) || (!blinkUphill && nowPreference < bestPreference))
            && !monsterAvoids(monst, monstNeighborLoc)) {

            bestPreference = nowPreference;
        }
    }

    for (i=0; i<40; i++) {
        pos target = perimeterCoords(i);
        target.x += monst->loc.x;
        target.y += monst->loc.y;

        pos impact;
        getImpactLoc(&impact, origin, target, maxDistance, true, &boltCatalog[BOLT_BLINKING]);
        nowPreference = preferenceMap[impact.x][impact.y];

        if (((blinkUphill && (nowPreference > bestPreference))
             || (!blinkUphill && (nowPreference < bestPreference)))
            && !monsterAvoids(monst, impact)) {

            bestTarget = target;
            bestPreference  = nowPreference;

            if ((abs(impact.x - origin.x) > 1 || abs(impact.y - origin.y) > 1)
                // Note: these are deliberately backwards:
                || (cellHasTerrainFlag((pos){ impact.x, origin.y }, T_OBSTRUCTS_PASSABILITY))
                || (cellHasTerrainFlag((pos){ origin.x, impact.y }, T_OBSTRUCTS_PASSABILITY))) {
                gotOne = true;
            } else {
                gotOne = false;
            }
        }
    }

    if (gotOne) {
        if (canDirectlySeeMonster(monst)) {
            monsterName(monstName, monst, true);
            sprintf(buf, "%s blinks", monstName);
            combatMessage(buf, 0);
        }
        monst->ticksUntilTurn = monst->attackSpeed * (monst->info.flags & MONST_CAST_SPELLS_SLOWLY ? 2 : 1);
        theBolt = boltCatalog[theBoltType];
        zap(origin, bestTarget, &theBolt, false, false);
        return true;
    }
    return false;
}


int main(){int n;scanf("%d",&n);for(int k=0;k<n;k++){int up,slow;scanf("%d %d %d",&up,&hasBolt,&slow);for(int x=0;x<31;x++){map[x]=vals[x];for(int y=0;y<31;y++){int v,a,b;scanf("%d %d %d",&v,&a,&b);vals[x][y]=v;avoid[x][y]=a;block[x][y]=b;}}for(int i=0;i<40;i++)scanf("%hd %hd",&impacts[i].x,&impacts[i].y);creature m={.loc={15,15},.ticksUntilTurn=17,.attackSpeed=73,.info.flags=slow};calls=0;aimed=(pos){-1,-1};int ok=monsterBlinkToPreferenceMap(&m,map,up);printf("%d %d %d %d %d\n",ok,aimed.x,aimed.y,m.ticksUntilTurn,calls);}return 0;}
