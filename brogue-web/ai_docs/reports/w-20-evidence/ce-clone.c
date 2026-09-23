#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define Fl(n) (1UL<<(n))
#define true 1
#define false 0
#define DCOLS 100
#define MB_LEADER 1
#define MB_CAPTIVE 2
#define MB_WEAPON_AUTO_ID 4
#define MB_FOLLOWER 8
#define MB_TELEPATHICALLY_REVEALED 16
#define HAS_MONSTER 1
#define HAS_PLAYER 2
#define HAS_STAIRS 4
#define T_DIVIDES_LEVEL 7
#define FEAT_JELLYMANCER 0
#define MONSTER_ALLY 3
#define BOLT_PLENTY 0
#define BE_PLENTY 0
enum monsterBehaviorFlags {
    MONST_INVISIBLE                 = Fl(0),    // monster is invisible
    MONST_INANIMATE                 = Fl(1),    // monster has abbreviated stat bar display and is immune to many things
    MONST_IMMOBILE                  = Fl(2),    // monster won't move or perform melee attacks
    MONST_CARRY_ITEM_100            = Fl(3),    // monster carries an item 100% of the time
    MONST_CARRY_ITEM_25             = Fl(4),    // monster carries an item 25% of the time
    MONST_ALWAYS_HUNTING            = Fl(5),    // monster is never asleep or in wandering mode
    MONST_FLEES_NEAR_DEATH          = Fl(6),    // monster flees when under 25% health and re-engages when over 75%
    MONST_ATTACKABLE_THRU_WALLS     = Fl(7),    // can be attacked when embedded in a wall
    MONST_DEFEND_DEGRADE_WEAPON     = Fl(8),    // hitting the monster damages the weapon
    MONST_IMMUNE_TO_WEAPONS         = Fl(9),    // weapons ineffective
    MONST_FLIES                     = Fl(10),   // permanent levitation
    MONST_FLITS                     = Fl(11),   // moves randomly a third of the time
    MONST_IMMUNE_TO_FIRE            = Fl(12),   // won't burn, won't die in lava
    MONST_CAST_SPELLS_SLOWLY        = Fl(13),   // takes twice the attack duration to cast a spell
    MONST_IMMUNE_TO_WEBS            = Fl(14),   // monster passes freely through webs
    MONST_REFLECT_50                = Fl(15),   // monster reflects ~50% of bolts, as though wearing +4 armor of reflection
    MONST_NEVER_SLEEPS              = Fl(16),   // monster is always awake
    MONST_FIERY                     = Fl(17),   // monster carries an aura of flame (but no automatic fire light)
    MONST_INVULNERABLE              = Fl(18),   // monster is immune to absolutely everything
    MONST_IMMUNE_TO_WATER           = Fl(19),   // monster moves at full speed in deep water and (if player) doesn't drop items
    MONST_RESTRICTED_TO_LIQUID      = Fl(20),   // monster can move only on tiles that allow submersion
    MONST_SUBMERGES                 = Fl(21),   // monster can submerge in appropriate terrain
    MONST_MAINTAINS_DISTANCE        = Fl(22),   // monster tries to keep a distance of 3 tiles between it and player
    MONST_WILL_NOT_USE_STAIRS       = Fl(23),   // monster won't chase the player between levels
    MONST_DIES_IF_NEGATED           = Fl(24),   // monster will die if exposed to negation magic
    MONST_MALE                      = Fl(25),   // monster is male (or 50% likely to be male if also has MONST_FEMALE)
    MONST_FEMALE                    = Fl(26),   // monster is female (or 50% likely to be female if also has MONST_MALE)
    MONST_NOT_LISTED_IN_SIDEBAR     = Fl(27),   // monster doesn't show up in the sidebar
    MONST_GETS_TURN_ON_ACTIVATION   = Fl(28),   // monster never gets a turn, except when its machine is activated
    MONST_ALWAYS_USE_ABILITY        = Fl(29),   // monster will never fail to use special ability if eligible (no random factor)
    MONST_NO_POLYMORPH              = Fl(30),   // monster cannot result from a polymorph spell (liches, phoenixes and Warden of Yendor)

    NEGATABLE_TRAITS                = (MONST_INVISIBLE | MONST_DEFEND_DEGRADE_WEAPON | MONST_IMMUNE_TO_WEAPONS | MONST_FLIES
                                       | MONST_FLITS | MONST_IMMUNE_TO_FIRE | MONST_REFLECT_50 | MONST_FIERY | MONST_MAINTAINS_DISTANCE),
    MONST_TURRET                    = (MONST_IMMUNE_TO_WEBS | MONST_NEVER_SLEEPS | MONST_IMMOBILE | MONST_INANIMATE |
                                       MONST_ATTACKABLE_THRU_WALLS | MONST_WILL_NOT_USE_STAIRS),
    LEARNABLE_BEHAVIORS             = (MONST_INVISIBLE | MONST_FLIES | MONST_IMMUNE_TO_FIRE | MONST_REFLECT_50),
    MONST_NEVER_VORPAL_ENEMY        = (MONST_INANIMATE | MONST_INVULNERABLE | MONST_IMMOBILE | MONST_RESTRICTED_TO_LIQUID | MONST_GETS_TURN_ON_ACTIVATION | MONST_MAINTAINS_DISTANCE),
    MONST_NEVER_MUTATED             = (MONST_INVISIBLE | MONST_INANIMATE | MONST_IMMOBILE | MONST_INVULNERABLE),
};
enum monsterAbilityFlags {
    MA_HIT_HALLUCINATE              = Fl(0),    // monster can hit to cause hallucinations
    MA_HIT_STEAL_FLEE               = Fl(1),    // monster can steal an item and then run away
    MA_HIT_BURN                     = Fl(2),    // monster can hit to set you on fire
    MA_ENTER_SUMMONS                = Fl(3),    // monster will "become" its summoned leader, reappearing when that leader is defeated (phylactery, phoenix egg, vampire)
    MA_HIT_DEGRADE_ARMOR            = Fl(4),    // monster damages armor
    MA_CAST_SUMMON                  = Fl(5),    // requires that there be one or more summon hordes with this monster type as the leader
    MA_SEIZES                       = Fl(6),    // monster seizes enemies before attacking
    MA_POISONS                      = Fl(7),    // monster's damage is dealt in the form of poison
    MA_DF_ON_DEATH                  = Fl(8),    // monster spawns its DF when it dies
    MA_CLONE_SELF_ON_DEFEND         = Fl(9),    // monster splits in two when struck
    MA_KAMIKAZE                     = Fl(10),   // monster dies instead of attacking
    MA_TRANSFERENCE                 = Fl(11),   // monster recovers 40 or 90% of the damage that it inflicts as health
    MA_CAUSES_WEAKNESS              = Fl(12),   // monster attacks cause weakness status in target
    MA_ATTACKS_PENETRATE            = Fl(13),   // monster attacks all adjacent enemies, like an axe
    MA_ATTACKS_ALL_ADJACENT         = Fl(14),   // monster attacks penetrate one layer of enemies, like a spear
    MA_ATTACKS_EXTEND               = Fl(15),   // monster attacks from a distance in a cardinal direction, like a whip
    MA_ATTACKS_STAGGER              = Fl(16),   // monster attacks will push the player backward by one space if there is room
    MA_AVOID_CORRIDORS              = Fl(17),   // monster will avoid corridors when hunting
    MA_REFLECT_100                  = Fl(18),   // monster reflects 100% of bolts directly back at the caster

    SPECIAL_HIT                     = (MA_HIT_HALLUCINATE | MA_HIT_STEAL_FLEE | MA_HIT_DEGRADE_ARMOR | MA_POISONS
                                       | MA_TRANSFERENCE | MA_CAUSES_WEAKNESS | MA_HIT_BURN | MA_ATTACKS_STAGGER),
    LEARNABLE_ABILITIES             = (MA_TRANSFERENCE | MA_CAUSES_WEAKNESS),

    MA_NON_NEGATABLE_ABILITIES      = (MA_ATTACKS_PENETRATE | MA_ATTACKS_ALL_ADJACENT | MA_ATTACKS_EXTEND | MA_ATTACKS_STAGGER),
    MA_NEVER_VORPAL_ENEMY           = (MA_KAMIKAZE),
    MA_NEVER_MUTATED                = (MA_KAMIKAZE),
};
typedef int boolean;
typedef struct {int x,y;} pos;
typedef struct {short lowerBound,upperBound,clumpFactor;} range;
typedef struct {int monsterID;void *foreColor;range damage;short defense;char monsterName[100];unsigned long flags,abilityFlags;} creatureType;
typedef struct creature {creatureType info;struct creature *leader,*carriedMonster;void *carriedItem,*mapToMe,*safetyMap;unsigned long bookkeepingFlags;short currentHP,ticksUntilTurn;int creatureState;pos loc;short status[8];} creature;
creature player,*monsters[100],*dormantMonsters[100];int allocated=0,gray;struct {int featRecord[1];} rogue;
struct {void *backColor;} boltCatalog[1];
struct cell {int flags;} cell;
struct cell *pmapAt(pos p){return &cell;}
creature *generateMonster(int kind,int item,int mutation){creature *c=calloc(1,sizeof(creature));monsters[allocated++]=c;return c;}
int rand_percent(int p){return 0;}
void removeCreature(creature **list,creature *c){for(int i=0;i<allocated;i++)if(list[i]==c)list[i]=NULL;}
void becomeAllyWith(creature *c){c->creatureState=MONSTER_ALLY;c->leader=&player;c->bookkeepingFlags&=~MB_CAPTIVE;}
int avoidedFlagsForMonster(creatureType *t){return 0;}
pos getQualifyingPathLocNear(pos p,int a,int b,int d,int e,int f,int g){return (pos){p.x+1,p.y};}
void refreshDungeonCell(pos p){}
int canSeeMonster(creature *c){return 0;}
void monsterName(char *b,creature *c,int article){strcpy(b,"rat");}
void message(char *b,int n){}
void flashMonster(creature *c,void *color,int n){}
typedef struct {int index;} creatureIterator;
creatureIterator iterateCreatures(creature **list){return (creatureIterator){0};}
int hasNextCreature(creatureIterator it){return it.index<allocated;}
creature *nextCreature(creatureIterator *it){return monsters[it->index++];}
void initializeGender(creature *monst) {
    if ((monst->info.flags & MONST_MALE) && (monst->info.flags & MONST_FEMALE)) {
        monst->info.flags &= ~(rand_percent(50) ? MONST_MALE : MONST_FEMALE);
    }
}
creature *cloneMonster(creature *monst, boolean announce, boolean placeClone) {
    char buf[DCOLS], monstName[DCOLS];
    short jellyCount;

    creature *newMonst = generateMonster(monst->info.monsterID, false, false);
    *newMonst = *monst; // boink!

    newMonst->carriedMonster = NULL; // Temporarily remove anything it's carrying.

    initializeGender(newMonst);
    newMonst->bookkeepingFlags &= ~(MB_LEADER | MB_CAPTIVE | MB_WEAPON_AUTO_ID);
    newMonst->bookkeepingFlags |= MB_FOLLOWER;
    newMonst->mapToMe = NULL;
    newMonst->safetyMap = NULL;
    newMonst->carriedItem = NULL;
    if (monst->carriedMonster) {
        creature *parentMonst = cloneMonster(monst->carriedMonster, false, false); // Also clone the carriedMonster
        removeCreature(monsters, parentMonst); // The cloned create will be added to the world, which we immediately undo.
        removeCreature(dormantMonsters, parentMonst); // in case it's added as a dormant creature? TODO: is this possible?
    }
    newMonst->ticksUntilTurn = 101;
    if (!(monst->creatureState == MONSTER_ALLY)) {
        newMonst->bookkeepingFlags &= ~MB_TELEPATHICALLY_REVEALED;
    }
    if (monst->leader) {
        newMonst->leader = monst->leader;
    } else {
        newMonst->leader = monst;
        monst->bookkeepingFlags |= MB_LEADER;
    }

    if (monst->bookkeepingFlags & MB_CAPTIVE) {
        // If you clone a captive, the clone will be your ally.
        becomeAllyWith(newMonst);
    }

    if (placeClone) {
//      getQualifyingLocNear(loc, monst->loc.x, monst->loc.y, true, 0, forbiddenFlagsForMonster(&(monst->info)), (HAS_PLAYER | HAS_MONSTER), false, false);
//      newMonst->loc.x = loc[0];
//      newMonst->loc.y = loc[1];
        newMonst->loc = getQualifyingPathLocNear(monst->loc, true,
                                 T_DIVIDES_LEVEL & avoidedFlagsForMonster(&(newMonst->info)), HAS_PLAYER,
                                 avoidedFlagsForMonster(&(newMonst->info)), (HAS_PLAYER | HAS_MONSTER | HAS_STAIRS), false);
        pmapAt(newMonst->loc)->flags |= HAS_MONSTER;
        refreshDungeonCell(newMonst->loc);
        if (announce && canSeeMonster(newMonst)) {
            monsterName(monstName, newMonst, false);
            sprintf(buf, "another %s appears!", monstName);
            message(buf, 0);
        }
    }

    if (monst == &player) { // Player managed to clone himself.
        newMonst->info.foreColor = &gray;
        newMonst->info.damage.lowerBound = 1;
        newMonst->info.damage.upperBound = 2;
        newMonst->info.damage.clumpFactor = 1;
        newMonst->info.defense = 0;
        strcpy(newMonst->info.monsterName, "clone");
        newMonst->creatureState = MONSTER_ALLY;
    }

    if (monst->creatureState == MONSTER_ALLY
        && (monst->info.abilityFlags & MA_CLONE_SELF_ON_DEFEND)
        && !rogue.featRecord[FEAT_JELLYMANCER]) {

        jellyCount = 0;
        for (creatureIterator it = iterateCreatures(monsters); hasNextCreature(it);) {
            creature *nextMonst = nextCreature(&it);
            if (nextMonst->creatureState == MONSTER_ALLY
                && (nextMonst->info.abilityFlags & MA_CLONE_SELF_ON_DEFEND)) {

                jellyCount++;
            }
        }
        if (jellyCount >= 90) {
            rogue.featRecord[FEAT_JELLYMANCER] = true;
        }
    }
    return newMonst;
}
int applyPlenty(creature *monst){int identified=0,*autoID=&identified;creature *newMonst;switch(BE_PLENTY){            case BE_PLENTY:
                if (!(monst->info.flags & (MONST_INANIMATE | MONST_INVULNERABLE))) {
                    newMonst = cloneMonster(monst, true, true);
                    if (newMonst) {
                        monst->currentHP = (monst->currentHP + 1) / 2;
                        newMonst->currentHP = (newMonst->currentHP + 1) / 2;
                        if (boltCatalog[BOLT_PLENTY].backColor) {
                            flashMonster(monst, boltCatalog[BOLT_PLENTY].backColor, 100);
                            flashMonster(newMonst, boltCatalog[BOLT_PLENTY].backColor, 100);
                        }
                        if (autoID) {
                            *autoID = true;
                        }
                    }
                }
                break;
}return identified;}
int main(void){
 for(int hp=1;hp<=137;hp++){creature m={0};m.currentHP=hp;m.loc=(pos){4,5};m.status[2]=17;m.bookkeepingFlags=MB_WEAPON_AUTO_ID|MB_TELEPATHICALLY_REVEALED;m.carriedItem=&gray;m.safetyMap=&gray;m.mapToMe=&gray;allocated=0;
 int ok=applyPlenty(&m);creature *c=monsters[0];c->status[2]=99;
 printf("hp %d %d %d %d %d %d %d %d %d %d\n",hp,m.currentHP,c->currentHP,ok,c->ticksUntilTurn,c->leader==&m,c->carriedItem==NULL,c->safetyMap==NULL,m.status[2],(int)c->bookkeepingFlags);free(c);}
 creature m={0},carried={0};m.currentHP=5;m.carriedMonster=&carried;carried.currentHP=7;allocated=0;creature *c=cloneMonster(&m,0,0);printf("carried %d %d %d\n",c->carriedMonster==NULL,allocated,monsters[1]==NULL);
 player.currentHP=19;strcpy(player.info.monsterName,"you");player.info.damage=(range){20,30,3};player.info.defense=80;allocated=0;applyPlenty(&player);c=monsters[0];printf("player %d %d %s %d %d %d %d %d\n",player.currentHP,c->currentHP,c->info.monsterName,c->info.damage.lowerBound,c->info.damage.upperBound,c->info.defense,c->creatureState,c->leader==&player);
 m=(creature){0};m.currentHP=5;m.bookkeepingFlags=MB_CAPTIVE;allocated=0;applyPlenty(&m);c=monsters[0];printf("captive %d %d %d %d\n",(int)m.bookkeepingFlags,(int)c->bookkeepingFlags,c->creatureState,c->leader==&player);
 return 0;
}
