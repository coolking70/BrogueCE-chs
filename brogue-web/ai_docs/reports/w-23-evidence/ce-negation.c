#include <stdio.h>
#include <string.h>
#include <assert.h>
#define Fl(n) (1UL << (n))
#define true 1
#define false 0
#define DCOLS 79
#define MB_SEIZING 1
#define BF_NOT_NEGATABLE Fl(8)
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
enum boltType {
    BOLT_NONE = 0,
    BOLT_TELEPORT,
    BOLT_SLOW,
    BOLT_POLYMORPH,
    BOLT_NEGATION,
    BOLT_DOMINATION,
    BOLT_BECKONING,
    BOLT_PLENTY,
    BOLT_INVISIBILITY,
    BOLT_EMPOWERMENT,
    BOLT_LIGHTNING,
    BOLT_FIRE,
    BOLT_POISON,
    BOLT_TUNNELING,
    BOLT_BLINKING,
    BOLT_ENTRANCEMENT,
    BOLT_OBSTRUCTION,
    BOLT_DISCORD,
    BOLT_CONJURATION,
    BOLT_HEALING,
    BOLT_HASTE,
    BOLT_SLOW_2,
    BOLT_SHIELDING,
    BOLT_SPIDERWEB,
    BOLT_SPARK,
    BOLT_DRAGONFIRE,
    BOLT_DISTANCE_ATTACK,
    BOLT_POISON_DART,
    BOLT_ANCIENT_SPIRIT_VINES,
    BOLT_WHIP
};
typedef struct {char name[80]; boolean isNegatable; short playerNegatedValue;} statusEffect;
const statusEffect statusEffectCatalog[NUMBER_OF_STATUS_EFFECTS] = {
    {"Searching",       false, 0}, // STATUS_SEARCHING
    {"Donning Armor",   false, 0}, // STATUS_DONNING
    {"Weakened: -",     false, 0}, // STATUS_WEAKENED
    {"Telepathic",      true,  1}, // STATUS_TELEPATHIC
    {"Hallucinating",   true,  0}, // STATUS_HALLUCINATING
    {"Levitating",      true,  1}, // STATUS_LEVITATING
    {"Slowed",          true,  0}, // STATUS_SLOWED
    {"Hasted",          true,  0}, // STATUS_HASTED
    {"Confused",        true,  0}, // STATUS_CONFUSED
    {"Burning",         false, 0}, // STATUS_BURNING
    {"Paralyzed",       false, 0}, // STATUS_PARALYZED
    {"Poisoned",        false, 0}, // STATUS_POISONED
    {"Stuck",           false, 0}, // STATUS_STUCK
    {"Nauseous",        false, 0}, // STATUS_NAUSEOUS
    {"Discordant",      true,  0}, // STATUS_DISCORDANT
    {"Immune to Fire",  true,  1}, // STATUS_IMMUNE_TO_FIRE
    {"",                false, 0}, // STATUS_EXPLOSION_IMMUNITY,
    {"",                false, 0}, // STATUS_NUTRITION,
    {"",                false, 0}, // STATUS_ENTERS_LEVEL_IN,
    {"",                false, 0}, // STATUS_ENRAGED,
    {"Frightened",      true,  0}, // STATUS_MAGICAL_FEAR
    {"Entranced",       true,  0}, // STATUS_ENTRANCED
    {"Darkened",        true,  0}, // STATUS_DARKNESS
    {"Lifespan",        false, 0}, // STATUS_LIFESPAN_REMAINING
    {"Shielded",        true,  0}, // STATUS_SHIELDED
    {"Invisible",       true,  0}, // STATUS_INVISIBLE
};
typedef struct {int x,y;} pos;
typedef struct {unsigned long flags,abilityFlags;short movementSpeed,attackSpeed;enum boltType bolts[20];} creatureType;
typedef struct {creatureType info;unsigned long bookkeepingFlags;short status[NUMBER_OF_STATUS_EFFECTS],maxStatus[NUMBER_OF_STATUS_EFFECTS];short mutationIndex,movementSpeed,attackSpeed,newPowerCount,totalPowerCount;boolean wasNegated;pos loc;} creature;
struct {unsigned long flags;} boltCatalog[BOLT_WHIP + 1];
struct {boolean canBeNegated;} mutationCatalog[8]={{1},{1},{0},{0},{1},{1},{1},{1}};
creature player;
int dead,tiles,light,vision;char message[DCOLS*3];
void monsterName(char *s,creature *m,boolean article){(void)m;(void)article;strcpy(s,"target");}
void combatMessage(char *s,int color){(void)color;strcpy(message,s);}
int messageColorFromVictim(creature *m){(void)m;return 0;}
void killCreature(creature *m,boolean admin){(void)m;(void)admin;dead++;}
void extinguishFireOnCreature(creature *m){m->status[STATUS_BURNING]=0;}
void refreshDungeonCell(pos p){(void)p;}
void refreshSideBar(int a,int b,boolean c){(void)a;(void)b;(void)c;}
void resolvePronounEscapes(char *s,creature *m){(void)s;(void)m;}
void applyInstantTileEffectsToCreature(creature *m){(void)m;tiles++;}
void updateMinersLightRadius(void){light++;}
void updateVision(boolean refresh){(void)refresh;vision++;}
boolean canNegateCreatureStatusEffects(creature *monst) {

    if (!monst || (monst->info.flags & MONST_INVULNERABLE)) {
        return false;
    }

    boolean hasNegatableStatusEffect = false;
    for (int i = 0; i < NUMBER_OF_STATUS_EFFECTS; i++) {
        enum statusEffects theStatus = (enum statusEffects) i;
        if (monst->status[theStatus] > 0 && statusEffectCatalog[theStatus].isNegatable) {
            hasNegatableStatusEffect = true;
        }
    }
    return hasNegatableStatusEffect;
}
void negateCreatureStatusEffects(creature *monst) {

    if (!monst || (monst->info.flags & MONST_INVULNERABLE)) {
        return;
    }

    for (int i = 0; i < NUMBER_OF_STATUS_EFFECTS; i++) {
        enum statusEffects theStatus = (enum statusEffects) i;
        if (monst->status[theStatus] > 0 && statusEffectCatalog[theStatus].isNegatable) {
            monst->status[theStatus] = (monst == &player) ? statusEffectCatalog[theStatus].playerNegatedValue : 0;
            if (theStatus == STATUS_DARKNESS && monst == &player) {
                updateMinersLightRadius();
                updateVision(true);
            }
        }
    }
}
static boolean negationWillAffectMonster(creature *monst, boolean isBolt) {

    // negation bolts don't affect monsters that always reflect. negation never affects the warden.
    if ((isBolt && (monst->info.abilityFlags & MA_REFLECT_100))
        || (monst->info.flags & MONST_INVULNERABLE)) {
        return false;
    }

    if ((monst->info.abilityFlags & ~MA_NON_NEGATABLE_ABILITIES)
        || (monst->bookkeepingFlags & MB_SEIZING)
        || (monst->info.flags & MONST_DIES_IF_NEGATED)
        || (monst->info.flags & NEGATABLE_TRAITS)
        || (monst->info.flags & MONST_IMMUNE_TO_FIRE)
        || ((monst->info.flags & MONST_FIERY) && (monst->status[STATUS_BURNING]))
        || (monst->status[STATUS_IMMUNE_TO_FIRE])
        || (monst->status[STATUS_SLOWED])
        || (monst->status[STATUS_HASTED])
        || (monst->status[STATUS_CONFUSED])
        || (monst->status[STATUS_ENTRANCED])
        || (monst->status[STATUS_DISCORDANT])
        || (monst->status[STATUS_SHIELDED])
        || (monst->status[STATUS_INVISIBLE])
        || (monst->status[STATUS_MAGICAL_FEAR])
        || (monst->status[STATUS_LEVITATING])
        || (monst->movementSpeed != monst->info.movementSpeed)
        || (monst->attackSpeed != monst->info.attackSpeed)
        || (monst->mutationIndex > -1 && mutationCatalog[monst->mutationIndex].canBeNegated)) {
        return true;
    }

    // any negatable bolts?
    for (int i = 0; i < 20; i++) {
        if (monst->info.bolts[i] && !(boltCatalog[monst->info.bolts[i]].flags & BF_NOT_NEGATABLE)) {
            return true;
        }
    }

    return false;
}
boolean negate(creature *monst) {
    short i, j;
    enum boltType backupBolts[20];
    char buf[DCOLS * 3], monstName[DCOLS];
    boolean negated = false;

    monsterName(monstName, monst, true);

    if (monst->info.abilityFlags & ~MA_NON_NEGATABLE_ABILITIES) {
        monst->info.abilityFlags &= MA_NON_NEGATABLE_ABILITIES; // negated monsters lose all special abilities
        negated = true;
        monst->wasNegated = true;
    }

    if (monst->bookkeepingFlags & MB_SEIZING){
        monst->bookkeepingFlags &= ~MB_SEIZING;
        negated = true;
    }

    if (monst->info.flags & MONST_DIES_IF_NEGATED) {
        if (monst->status[STATUS_LEVITATING]) {
            sprintf(buf, "%s dissipates into thin air", monstName);
        } else if (monst->info.flags & MONST_INANIMATE) {
            sprintf(buf, "%s shatters into tiny pieces", monstName);
        } else {
            sprintf(buf, "%s falls to the ground, lifeless", monstName);
        }
        killCreature(monst, false);
        combatMessage(buf, messageColorFromVictim(monst));
        negated = true;
    } else if (!(monst->info.flags & MONST_INVULNERABLE)) {
        if (canNegateCreatureStatusEffects(monst)) {
            negated = true;
            negateCreatureStatusEffects(monst);
        }
        if (monst->info.flags & MONST_IMMUNE_TO_FIRE) {
            monst->info.flags &= ~MONST_IMMUNE_TO_FIRE;
            monst->wasNegated = true;
            negated = true;
        }
        if (monst->movementSpeed != monst->info.movementSpeed) {
            monst->movementSpeed = monst->info.movementSpeed;
            negated = true;
        }
        if (monst->attackSpeed != monst->info.attackSpeed) {
            monst->attackSpeed = monst->info.attackSpeed;
            negated = true;
        }

        if (monst != &player && monst->mutationIndex > -1 && mutationCatalog[monst->mutationIndex].canBeNegated) {

            monst->mutationIndex = -1;
            negated = true;
            monst->wasNegated = true;
        }
        if (monst != &player && (monst->info.flags & NEGATABLE_TRAITS)) {
            if ((monst->info.flags & MONST_FIERY) && monst->status[STATUS_BURNING]) {
                extinguishFireOnCreature(monst);
            }
            monst->info.flags &= ~NEGATABLE_TRAITS;
            negated = true;
            monst->wasNegated = true;
            refreshDungeonCell(monst->loc);
            refreshSideBar(-1, -1, false);
        }
        for (i = 0; i < 20; i++) {
            backupBolts[i] = monst->info.bolts[i];
            if (monst->info.bolts[i] && !(boltCatalog[monst->info.bolts[i]].flags & BF_NOT_NEGATABLE)) {
                monst->info.bolts[i] = BOLT_NONE;
                negated = true;
                monst->wasNegated = true;
            }
        }
        for (i = 0, j = 0; i < 20 && backupBolts[i]; i++) {
            if (boltCatalog[backupBolts[i]].flags & BF_NOT_NEGATABLE) {
                monst->info.bolts[j] = backupBolts[i];
                j++;
            }
        }
        monst->newPowerCount = monst->totalPowerCount; // Allies can re-learn lost ability slots.
        applyInstantTileEffectsToCreature(monst); // in case it should immediately die or fall into a chasm
    }

    if (negated && monst != &player && !(monst->info.flags & MONST_DIES_IF_NEGATED)) {
        sprintf(buf, "%s is stripped of $HISHER special traits", monstName);
        resolvePronounEscapes(buf, monst);
        combatMessage(buf, messageColorFromVictim(monst));
    }

    return negated;
}
creature fresh(void){creature m={0};m.mutationIndex=-1;m.info.movementSpeed=m.movementSpeed=100;m.info.attackSpeed=m.attackSpeed=100;m.totalPowerCount=3;return m;}
int main(void){
 for(int p=0;p<2;p++)for(int st=0;st<NUMBER_OF_STATUS_EFFECTS;st++)for(int dur=1;dur<=7;dur+=6){
  creature local=fresh();player=fresh();creature *m=p?&player:&local;m->status[st]=m->maxStatus[st]=dur;
  int eligible=negationWillAffectMonster(m,1),affected=negate(m);
  printf("status %d %d %d %d %d %d %d %d\n",p,st,dur,eligible,affected,m->status[st],m->maxStatus[st],m->wasNegated);
 }
 creature m=fresh();m.info.abilityFlags=MA_SEIZES|MA_ATTACKS_STAGGER;m.info.flags=MONST_INVULNERABLE;m.bookkeepingFlags=MB_SEIZING;
 assert(!negationWillAffectMonster(&m,0));assert(negate(&m));assert(m.info.abilityFlags==MA_ATTACKS_STAGGER&&m.wasNegated&&!m.bookkeepingFlags&&m.newPowerCount==0);
 for(int kind=0;kind<3;kind++){m=fresh();m.info.flags=MONST_DIES_IF_NEGATED|(kind==1?MONST_INANIMATE:0);m.status[STATUS_LEVITATING]=kind==0;dead=tiles=0;assert(negate(&m));assert(dead==1&&tiles==0&&!m.wasNegated&&m.newPowerCount==0);printf("death %d %s\n",kind,message);}
 for(int i=0;i<8;i++){m=fresh();m.mutationIndex=i;assert(negate(&m)==mutationCatalog[i].canBeNegated);assert(m.mutationIndex==(mutationCatalog[i].canBeNegated?-1:i));}
 m=fresh();m.info.flags=MONST_FLIES|MONST_FIERY|MONST_IMMUNE_TO_FIRE;m.status[STATUS_LEVITATING]=m.status[STATUS_BURNING]=m.status[STATUS_IMMUNE_TO_FIRE]=1000;assert(negate(&m));assert(!m.info.flags&&!m.status[STATUS_LEVITATING]&&!m.status[STATUS_BURNING]&&!m.status[STATUS_IMMUNE_TO_FIRE]);
 // Non-negatable flags are synthetic: the shipped CE catalog has none.
 boltCatalog[BOLT_WHIP].flags=BF_NOT_NEGATABLE;boltCatalog[BOLT_DISTANCE_ATTACK].flags=BF_NOT_NEGATABLE;
 m=fresh();m.info.bolts[0]=BOLT_NEGATION;m.info.bolts[1]=BOLT_WHIP;m.info.bolts[2]=BOLT_DISTANCE_ATTACK;assert(negate(&m));assert(m.info.bolts[0]==BOLT_WHIP&&m.info.bolts[1]==BOLT_DISTANCE_ATTACK&&m.info.bolts[2]==BOLT_DISTANCE_ATTACK);printf("tail %d %d %d\n",m.info.bolts[0],m.info.bolts[1],m.info.bolts[2]);
 m=fresh();m.info.bolts[1]=BOLT_NEGATION;assert(negationWillAffectMonster(&m,0));assert(negate(&m));assert(m.info.bolts[0]==BOLT_NONE&&m.info.bolts[1]==BOLT_NONE);
 m=fresh();tiles=0;assert(!negate(&m));assert(tiles==1&&m.newPowerCount==3&&!m.wasNegated);
 puts("audit passed");return 0;
}
