#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define Fl(n) (1UL << (n))
#define max(a,b) ((a)>(b)?(a):(b))
#define true 1
#define false 0
#define STOMACH_SIZE 2150
typedef int boolean;
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
enum statusEffects {
    STATUS_SEARCHING = 0,
    STATUS_DONNING,
    STATUS_WEAKENED,
    STATUS_TELEPATHIC,
    STATUS_HALLUCINATING,
    STATUS_LEVITATING,
    STATUS_SLOWED,
    STATUS_HASTED,
    STATUS_CONFUSED,
    STATUS_BURNING,
    STATUS_PARALYZED,
    STATUS_POISONED,
    STATUS_STUCK,
    STATUS_NAUSEOUS,
    STATUS_DISCORDANT,
    STATUS_IMMUNE_TO_FIRE,
    STATUS_EXPLOSION_IMMUNITY,
    STATUS_NUTRITION,
    STATUS_ENTERS_LEVEL_IN,
    STATUS_ENRAGED, // temporarily ignores normal MA_AVOID_CORRIDORS behavior
    STATUS_MAGICAL_FEAR,
    STATUS_ENTRANCED,
    STATUS_DARKNESS,
    STATUS_LIFESPAN_REMAINING,
    STATUS_SHIELDED,
    STATUS_INVISIBLE,
    STATUS_AGGRAVATING,
    NUMBER_OF_STATUS_EFFECTS,
};
enum creatureStates {
    MONSTER_SLEEPING,
    MONSTER_TRACKING_SCENT,
    MONSTER_WANDERING,
    MONSTER_FLEEING,
    MONSTER_ALLY,
};
enum creatureModes {
    MODE_NORMAL,
    MODE_PERM_FLEEING
};
#define MB_CAPTIVE 1
#define MB_SEIZING 2
#define MB_SEIZED 4
#define MB_FOLLOWER 8
#define MB_TELEPATHICALLY_REVEALED 16
#define NUMBER_MONSTER_KINDS 68
#define BOLT_POLYMORPH 0
typedef struct {int x,y;} pos;
typedef struct {short monsterID,maxHP,movementSpeed,attackSpeed;long turnsBetweenRegen;unsigned long flags,abilityFlags;} creatureType;
typedef struct creature {creatureType info;short currentHP,mutationIndex,movementSpeed,attackSpeed,ticksUntilTurn;int creatureState,creatureMode,wasNegated;unsigned long bookkeepingFlags;short status[NUMBER_OF_STATUS_EFFECTS],maxStatus[NUMBER_OF_STATUS_EFFECTS];struct creature *carriedMonster,*leader;pos loc;} creature;
creature player;
creatureType monsterCatalog[68]={{0,30,100,100,20,(MONST_MALE | MONST_FEMALE),0},
{1,6,100,100,20,0,0},
{2,7,100,100,20,0,0},
{3,8,50,100,20,0,0},
{4,18,50,100,5,(MONST_RESTRICTED_TO_LIQUID | MONST_IMMUNE_TO_WATER | MONST_SUBMERGES | MONST_FLITS | MONST_NEVER_SLEEPS),0},
{5,12,100,100,20,(0),(MA_HIT_STEAL_FLEE)},
{6,4,100,100,5,(MONST_FLIES | MONST_FLITS),(MA_KAMIKAZE | MA_DF_ON_DEATH)},
{7,4,100,100,5,(MONST_FLIES | MONST_FLITS),(MA_KAMIKAZE | MA_DF_ON_DEATH)},
{8,15,100,100,20,(0),(MA_ATTACKS_PENETRATE | MA_AVOID_CORRIDORS)},
{9,10,100,100,20,(MONST_MAINTAINS_DISTANCE | MONST_CAST_SPELLS_SLOWLY | MONST_CARRY_ITEM_25),(MA_CAST_SUMMON | MA_AVOID_CORRIDORS)},
{10,10,100,100,20,(MONST_MAINTAINS_DISTANCE | MONST_CARRY_ITEM_25),(MA_AVOID_CORRIDORS)},
{11,30,100,300,0,(MONST_IMMUNE_TO_WEBS | MONST_NEVER_SLEEPS | MONST_IMMOBILE | MONST_INANIMATE | MONST_WILL_NOT_USE_STAIRS),(0)},
{12,50,100,100,0,(MONST_NEVER_SLEEPS),(MA_CLONE_SELF_ON_DEFEND)},
{13,18,100,100,10,(0),(MA_HIT_HALLUCINATE)},
{14,18,50,100,20,(MONST_FLIES | MONST_FLITS),(MA_TRANSFERENCE)},
{15,30,100,250,0,(MONST_TURRET),(0)},
{16,15,100,100,5,(MONST_DEFEND_DEGRADE_WEAPON),(MA_HIT_DEGRADE_ARMOR)},
{17,20,100,100,20,(0),(MA_CAUSES_WEAKNESS)},
{18,55,100,200,20,(MONST_MALE | MONST_FEMALE),(MA_AVOID_CORRIDORS | MA_ATTACKS_STAGGER)},
{19,55,200,100,3,(MONST_RESTRICTED_TO_LIQUID | MONST_SUBMERGES | MONST_FLITS | MONST_FLEES_NEAR_DEATH),(MA_SEIZES)},
{20,70,100,400,0,(MONST_IMMUNE_TO_WEBS | MONST_NEVER_SLEEPS | MONST_IMMOBILE | MONST_INANIMATE | MONST_WILL_NOT_USE_STAIRS),(0)},
{21,20,100,200,20,(MONST_IMMUNE_TO_WEBS | MONST_CAST_SPELLS_SLOWLY | MONST_ALWAYS_USE_ABILITY),(MA_POISONS)},
{22,80,100,150,0,(MONST_TURRET),(0)},
{23,10,100,100,5,(MONST_IMMUNE_TO_FIRE | MONST_FLIES | MONST_FLITS | MONST_NEVER_SLEEPS | MONST_FIERY | MONST_DIES_IF_NEGATED),(MA_HIT_BURN)},
{24,50,50,100,5,(MONST_FLEES_NEAR_DEATH),0},
{25,80,100,100,0,0,0},
{26,65,100,100,1,(MONST_MALE | MONST_FEMALE),0},
{27,45,100,200,20,(MONST_MAINTAINS_DISTANCE | MONST_CAST_SPELLS_SLOWLY | MONST_MALE | MONST_FEMALE),(MA_CAST_SUMMON | MA_AVOID_CORRIDORS)},
{28,75,100,100,10,(MONST_IMMUNE_TO_WATER | MONST_SUBMERGES | MONST_NEVER_SLEEPS | MONST_FEMALE),(MA_ATTACKS_ALL_ADJACENT)},
{29,60,100,100,10,(MONST_IMMUNE_TO_FIRE | MONST_SUBMERGES | MONST_NEVER_SLEEPS | MONST_FIERY | MONST_MALE),(MA_ATTACKS_EXTEND)},
{30,10,100,100,5,(MONST_FLIES | MONST_FLITS),(MA_KAMIKAZE | MA_DF_ON_DEATH)},
{31,35,100,100,20,(MONST_CARRY_ITEM_25 | MONST_MALE | MONST_FEMALE),(MA_AVOID_CORRIDORS)},
{32,20,100,100,20,(MONST_MAINTAINS_DISTANCE | MONST_CARRY_ITEM_25 | MONST_FEMALE),(MA_AVOID_CORRIDORS)},
{33,20,100,100,20,(MONST_MAINTAINS_DISTANCE | MONST_CARRY_ITEM_25 | MONST_MALE | MONST_FEMALE),(MA_AVOID_CORRIDORS)},
{34,60,100,100,0,(MONST_DEFEND_DEGRADE_WEAPON),(MA_HIT_DEGRADE_ARMOR | MA_CLONE_SELF_ON_DEFEND)},
{35,35,50,100,20,(MONST_MAINTAINS_DISTANCE | MONST_MALE),(0)},
{36,80,150,200,3,(MONST_NEVER_SLEEPS),0},
{37,50,100,175,0,(MONST_TURRET | MONST_CAST_SPELLS_SLOWLY | MONST_DIES_IF_NEGATED),(0)},
{38,20,100,250,0,(MONST_TURRET),(MA_CAUSES_WEAKNESS)},
{39,120,50,100,1,(MONST_RESTRICTED_TO_LIQUID | MONST_IMMUNE_TO_WATER | MONST_SUBMERGES | MONST_FLITS | MONST_NEVER_SLEEPS | MONST_FLEES_NEAR_DEATH),(MA_SEIZES)},
{40,35,100,100,0,(MONST_MAINTAINS_DISTANCE | MONST_CARRY_ITEM_25 | MONST_NO_POLYMORPH),(MA_CAST_SUMMON)},
{41,30,100,150,0,(MONST_IMMUNE_TO_WEBS | MONST_NEVER_SLEEPS | MONST_IMMOBILE | MONST_INANIMATE | MONST_ALWAYS_HUNTING | MONST_WILL_NOT_USE_STAIRS | MONST_DIES_IF_NEGATED),(MA_CAST_SUMMON | MA_ENTER_SUMMONS)},
{42,10,50,100,20,(MONST_MAINTAINS_DISTANCE | MONST_FLIES | MONST_FLITS | MONST_MALE | MONST_FEMALE),(0)},
{43,35,50,200,0,(MONST_INVISIBLE | MONST_FLITS | MONST_FLIES | MONST_IMMUNE_TO_WEBS),0},
{44,40,100,250,0,(MONST_TURRET),(0)},
{45,35,100,100,10,(0),(MA_HIT_STEAL_FLEE)},
{46,19,50,100,20,(MONST_NEVER_SLEEPS | MONST_FLIES),0},
{47,30,100,100,0,(MONST_IMMUNE_TO_WEAPONS),0},
{48,120,100,100,1,0,0},
{49,400,100,100,0,(MONST_REFLECT_50 | MONST_DIES_IF_NEGATED),0},
{50,150,50,200,20,(MONST_IMMUNE_TO_FIRE | MONST_CARRY_ITEM_100),(MA_ATTACKS_ALL_ADJACENT)},
{51,30,100,100,20,(MONST_MAINTAINS_DISTANCE | MONST_CARRY_ITEM_25),(MA_CAST_SUMMON | MA_ATTACKS_PENETRATE | MA_AVOID_CORRIDORS)},
{52,120,100,100,0,(0),(MA_CLONE_SELF_ON_DEFEND)},
{53,75,50,100,6,(MONST_FLEES_NEAR_DEATH | MONST_MALE),(MA_TRANSFERENCE | MA_DF_ON_DEATH | MA_CAST_SUMMON | MA_ENTER_SUMMONS)},
{54,65,100,100,0,(MONST_MAINTAINS_DISTANCE | MONST_IMMUNE_TO_FIRE | MONST_FIERY),(MA_HIT_BURN)},
{55,1,50,100,0,(MONST_INANIMATE | MONST_NEVER_SLEEPS | MONST_FLIES | MONST_WILL_NOT_USE_STAIRS | MONST_DIES_IF_NEGATED | MONST_IMMUNE_TO_WEBS | MONST_NOT_LISTED_IN_SIDEBAR),0},
{56,1,50,100,0,(MONST_INANIMATE | MONST_NEVER_SLEEPS | MONST_FLIES | MONST_WILL_NOT_USE_STAIRS | MONST_DIES_IF_NEGATED | MONST_IMMUNE_TO_WEBS),0},
{57,1000,100,100,0,(MONST_INANIMATE | MONST_NEVER_SLEEPS | MONST_ALWAYS_HUNTING | MONST_IMMUNE_TO_FIRE | MONST_IMMUNE_TO_WEAPONS | MONST_WILL_NOT_USE_STAIRS | MONST_DIES_IF_NEGATED | MONST_ALWAYS_USE_ABILITY | MONST_GETS_TURN_ON_ACTIVATION),(MA_REFLECT_100)},
{58,1000,100,100,0,(MONST_INANIMATE | MONST_NEVER_SLEEPS | MONST_ALWAYS_HUNTING | MONST_IMMUNE_TO_FIRE | MONST_IMMUNE_TO_WEAPONS | MONST_WILL_NOT_USE_STAIRS | MONST_DIES_IF_NEGATED | MONST_GETS_TURN_ON_ACTIVATION | MONST_ALWAYS_USE_ABILITY),(MA_REFLECT_100)},
{59,1000,100,100,0,(MONST_INANIMATE | MONST_NEVER_SLEEPS | MONST_IMMUNE_TO_FIRE | MONST_IMMUNE_TO_WEAPONS | MONST_DIES_IF_NEGATED | MONST_ALWAYS_USE_ABILITY),(MA_REFLECT_100)},
{60,1000,200,200,0,(MONST_NEVER_SLEEPS | MONST_ALWAYS_HUNTING | MONST_INVULNERABLE | MONST_NO_POLYMORPH),0},
{61,80,100,100,0,(MONST_IMMUNE_TO_WEBS | MONST_NEVER_SLEEPS | MONST_IMMOBILE | MONST_INANIMATE | MONST_ALWAYS_HUNTING | MONST_WILL_NOT_USE_STAIRS | MONST_GETS_TURN_ON_ACTIVATION | MONST_ALWAYS_USE_ABILITY),(MA_CAST_SUMMON)},
{62,80,100,100,0,(MONST_IMMUNE_TO_WEBS | MONST_NEVER_SLEEPS | MONST_IMMOBILE | MONST_INANIMATE | MONST_ALWAYS_HUNTING | MONST_WILL_NOT_USE_STAIRS | MONST_GETS_TURN_ON_ACTIVATION | MONST_ALWAYS_USE_ABILITY | MONST_IMMUNE_TO_WEAPONS | MONST_IMMUNE_TO_FIRE),(MA_REFLECT_100)},
{63,40,50,100,20,(MONST_MAINTAINS_DISTANCE | MONST_MALE | MONST_FEMALE),(0)},
{64,40,50,100,1,(MONST_IMMUNE_TO_FIRE | MONST_FLIES | MONST_MALE),(0)},
{65,30,50,100,0,(MONST_IMMUNE_TO_FIRE| MONST_FLIES | MONST_NO_POLYMORPH),0},
{66,50,100,150,0,(MONST_IMMUNE_TO_FIRE| MONST_IMMUNE_TO_WEBS | MONST_NEVER_SLEEPS | MONST_IMMOBILE | MONST_INANIMATE | MONST_WILL_NOT_USE_STAIRS | MONST_NO_POLYMORPH | MONST_ALWAYS_HUNTING | MONST_IMMUNE_TO_WEAPONS),(MA_CAST_SUMMON | MA_ENTER_SUMMONS)},
{67,70,100,100,6,(MONST_IMMUNE_TO_WEBS | MONST_ALWAYS_USE_ABILITY | MONST_MAINTAINS_DISTANCE | MONST_NO_POLYMORPH | MONST_MALE | MONST_FEMALE),(0)}};
struct {void *backColor;} boltCatalog[1];
int chosen=1;
int rand_range(int lo,int hi){if(lo!=1||hi!=67)abort();return chosen;}
void freeCreature(creature *m){(void)m;}
void demoteMonsterFromLeadership(creature *m){(void)m;}
void refreshDungeonCell(pos p){(void)p;}
void flashMonster(creature *m,void *color,int strength){(void)m;(void)color;(void)strength;}
void unAlly(creature *monst) {
    if (monst->creatureState == MONSTER_ALLY) {
        monst->creatureState = MONSTER_TRACKING_SCENT;
        monst->bookkeepingFlags &= ~(MB_FOLLOWER | MB_TELEPATHICALLY_REVEALED);
        monst->leader = NULL;
    }
}
void initializeStatus(creature *monst) {
    short i;

    for (i=0; i<NUMBER_OF_STATUS_EFFECTS; i++) {
        monst->status[i] = monst->maxStatus[i] = 0;
    }

    if (monst->info.flags & MONST_FIERY) {
        monst->status[STATUS_BURNING] = monst->maxStatus[STATUS_BURNING] = 1000; // won't decrease
    }
    if (monst->info.flags & MONST_FLIES) {
        monst->status[STATUS_LEVITATING] = monst->maxStatus[STATUS_LEVITATING] = 1000; // won't decrease
    }
    if (monst->info.flags & MONST_IMMUNE_TO_FIRE) {
        monst->status[STATUS_IMMUNE_TO_FIRE] = monst->maxStatus[STATUS_IMMUNE_TO_FIRE] = 1000; // won't decrease
    }
    if (monst->info.flags & MONST_INVISIBLE) {
        monst->status[STATUS_INVISIBLE] = monst->maxStatus[STATUS_INVISIBLE] = 1000; // won't decrease
    }
    monst->status[STATUS_NUTRITION] = monst->maxStatus[STATUS_NUTRITION] = (monst == &player ? STOMACH_SIZE : 1000);
}
static boolean polymorph(creature *monst) {
    short previousDamageTaken, healthFraction, newMonsterIndex;

    if (monst == &player || (monst->info.flags & (MONST_INANIMATE | MONST_INVULNERABLE))) {
        return false; // Sorry, this is not Nethack.
    }

    if (monst->creatureState == MONSTER_FLEEING
        && (monst->info.flags & (MONST_MAINTAINS_DISTANCE | MONST_FLEES_NEAR_DEATH)) || (monst->info.abilityFlags & MA_HIT_STEAL_FLEE)) {

        monst->creatureState = MONSTER_TRACKING_SCENT;
        monst->creatureMode = MODE_NORMAL;
    }

    unAlly(monst); // Sorry, no cheap dragon allies.
    monst->mutationIndex = -1; // Polymorph cures mutation -- basic science.

    // After polymorphing, don't "drop" any creature on death (e.g. phylactery, phoenix egg)
    if (monst->carriedMonster) {
        freeCreature(monst->carriedMonster);
        monst->carriedMonster = NULL;
    }

    healthFraction = monst->currentHP * 1000 / monst->info.maxHP;
    previousDamageTaken = monst->info.maxHP - monst->currentHP;

    do {
        newMonsterIndex = rand_range(1, NUMBER_MONSTER_KINDS - 1);
    } while (monsterCatalog[newMonsterIndex].flags & (MONST_INANIMATE | MONST_NO_POLYMORPH) // Can't turn something into an inanimate object or lich/phoenix/warden.
             || newMonsterIndex == monst->info.monsterID); // Can't stay the same monster.
    monst->info = monsterCatalog[newMonsterIndex]; // Presto change-o!

    monst->info.turnsBetweenRegen *= 1000;
    monst->currentHP = max(1, max(healthFraction * monst->info.maxHP / 1000, monst->info.maxHP - previousDamageTaken));

    monst->movementSpeed = monst->info.movementSpeed;
    monst->attackSpeed = monst->info.attackSpeed;
    if (monst->status[STATUS_HASTED]) {
        monst->movementSpeed /= 2;
        monst->attackSpeed /= 2;
    }
    if (monst->status[STATUS_SLOWED]) {
        monst->movementSpeed *= 2;
        monst->attackSpeed *= 2;
    }
    monst->wasNegated = false;
    initializeStatus(monst);

    if (monst->bookkeepingFlags & MB_CAPTIVE) {
        demoteMonsterFromLeadership(monst);
        monst->creatureState = MONSTER_TRACKING_SCENT;
        monst->bookkeepingFlags &= ~MB_CAPTIVE;
    }
    monst->bookkeepingFlags &= ~(MB_SEIZING | MB_SEIZED);

    monst->ticksUntilTurn = max(monst->ticksUntilTurn, 101);

    refreshDungeonCell(monst->loc);
    if (boltCatalog[BOLT_POLYMORPH].backColor) {
        flashMonster(monst, boltCatalog[BOLT_POLYMORPH].backColor, 100);
    }
    return true;
}
int main(int argc,char **argv){
if(argc>1 && !strcmp(argv[1],"catalog")){for(int i=1;i<68;i++){creatureType m=monsterCatalog[i];printf("%d %d %d %d %d\n",i,!(m.flags&(MONST_INANIMATE|MONST_NO_POLYMORPH)),m.maxHP,m.movementSpeed,m.attackSpeed);}return 0;}
int maxima[]={3,7,8,19,25,99,100,101,137};int forms[]={1,3,18,23,43,50,63,64};
for(unsigned a=0;a<sizeof(maxima)/sizeof(int);a++)for(int hp=1;hp<=maxima[a]+1;hp++)for(unsigned f=0;f<sizeof(forms)/sizeof(int);f++)for(int speed=0;speed<4;speed++){
 creature m={0};m.info=monsterCatalog[2];m.info.maxHP=maxima[a];m.currentHP=hp;m.status[STATUS_HASTED]=speed&1;m.status[STATUS_SLOWED]=speed&2;m.ticksUntilTurn=7;chosen=forms[f];
 polymorph(&m);printf("%d %d %d %d %d %d %d %d %d\n",hp,maxima[a],chosen,speed,m.currentHP,m.movementSpeed,m.attackSpeed,m.status[STATUS_HASTED],m.status[STATUS_SLOWED]);
}return 0;}
