#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#define Fl(n) (1UL<<(n))
#define true 1
#define false 0
#define MONSTER_ALLY 1
#define ITEM_RUNIC 1
#define ITEM_RUNIC_IDENTIFIED 2
#define A_REFLECTION 1
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define clamp(x,a,b) min(max((x),(a)),(b))
#define LAST_INDEX(a) (sizeof(a)/sizeof(*(a))-1)
typedef long long fixpt;
#define FP_BASE 16 // Don't change this without recalculating all of the power tables throughout the code!
#define FP_FACTOR (1LL << FP_BASE)
typedef int boolean;
typedef struct {short x,y;} pos;
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
enum boltFlags {
    BF_PASSES_THRU_CREATURES        = Fl(0),    // Bolt continues through creatures (e.g. lightning and tunneling)
    BF_HALTS_BEFORE_OBSTRUCTION     = Fl(1),    // Bolt takes effect the space before it terminates (e.g. conjuration, obstruction, blinking)
    BF_TARGET_ALLIES                = Fl(2),    // Staffs/wands/creatures that shoot this bolt will auto-target allies.
    BF_TARGET_ENEMIES               = Fl(3),    // Staffs/wands/creatures that shoot this bolt will auto-target enemies.
    BF_FIERY                        = Fl(4),    // Bolt will light flammable terrain on fire as it passes, and will ignite monsters hit.
    BF_NEVER_REFLECTS               = Fl(6),    // Bolt will never reflect (e.g. spiderweb, arrows).
    BF_NOT_LEARNABLE                = Fl(7),    // This technique cannot be absorbed by empowered allies.
    BF_NOT_NEGATABLE                = Fl(8),    // Won't be erased by negation.
    BF_ELECTRIC                     = Fl(9),    // Activates terrain that has TM_PROMOTES_ON_ELECTRICITY
    BF_DISPLAY_CHAR_ALONG_LENGTH    = Fl(10),   // Display the character along the entire length of the bolt instead of just at the front.
};
enum boltEffects {
    BE_NONE,
    BE_ATTACK,
    BE_TELEPORT,
    BE_SLOW,
    BE_POLYMORPH,
    BE_NEGATION,
    BE_DOMINATION,
    BE_BECKONING,
    BE_PLENTY,
    BE_INVISIBILITY,
    BE_EMPOWERMENT,
    BE_DAMAGE,
    BE_POISON,
    BE_TUNNELING,
    BE_BLINKING,
    BE_ENTRANCEMENT,
    BE_OBSTRUCTION,
    BE_DISCORD,
    BE_CONJURATION,
    BE_HEALING,
    BE_HASTE,
    BE_SHIELDING,
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
enum {T_LAVA_INSTA_DEATH=1,T_IS_DEEP_WATER=2,T_AUTO_DESCENT=4,T_ENTANGLES=8,T_OBSTRUCTS_PASSABILITY=16};
typedef struct {unsigned long flags,abilityFlags;int maxHP;} creatureType;
typedef struct {creatureType info;int creatureState,currentHP;pos loc;int status[NUMBER_OF_STATUS_EFFECTS];} creature;
typedef struct {int flags,enchant2;} item;
struct {item *armor;} rogue;
creature player;
struct {enum boltEffects boltEffect;int magnitude;unsigned long forbiddenMonsterFlags,flags;int targetDF;} boltCatalog[30]={
 {0},{BE_TELEPORT,10,MONST_IMMOBILE,(BF_TARGET_ENEMIES),0},
{BE_SLOW,10,MONST_INANIMATE,(BF_TARGET_ENEMIES),0},
{BE_POLYMORPH,10,MONST_INANIMATE,(BF_TARGET_ENEMIES),0},
{BE_NEGATION,10,0,(BF_TARGET_ENEMIES),0},
{BE_DOMINATION,10,MONST_INANIMATE,(BF_TARGET_ENEMIES),0},
{BE_BECKONING,10,MONST_IMMOBILE,(BF_TARGET_ENEMIES),0},
{BE_PLENTY,10,MONST_INANIMATE,(BF_TARGET_ALLIES | BF_NOT_LEARNABLE),0},
{BE_INVISIBILITY,10,MONST_INANIMATE,(BF_TARGET_ALLIES),0},
{BE_EMPOWERMENT,10,MONST_INANIMATE,(BF_TARGET_ALLIES | BF_NOT_LEARNABLE),0},
{BE_DAMAGE,10,0,(BF_PASSES_THRU_CREATURES | BF_TARGET_ENEMIES | BF_ELECTRIC),0},
{BE_DAMAGE,4,MONST_IMMUNE_TO_FIRE,(BF_TARGET_ENEMIES | BF_FIERY),0},
{BE_POISON,10,MONST_INANIMATE,(BF_TARGET_ENEMIES),0},
{BE_TUNNELING,10,0,(BF_PASSES_THRU_CREATURES),0},
{BE_BLINKING,5,0,(BF_HALTS_BEFORE_OBSTRUCTION),0},
{BE_ENTRANCEMENT,10,MONST_INANIMATE,(BF_TARGET_ENEMIES),0},
{BE_OBSTRUCTION,10,0,(BF_HALTS_BEFORE_OBSTRUCTION),0},
{BE_DISCORD,10,MONST_INANIMATE,(BF_TARGET_ENEMIES),0},
{BE_CONJURATION,10,MONST_IMMUNE_TO_WEAPONS,(BF_HALTS_BEFORE_OBSTRUCTION | BF_TARGET_ENEMIES),0},
{BE_HEALING,5,0,(BF_TARGET_ALLIES),0},
{BE_HASTE,2,MONST_INANIMATE,(BF_TARGET_ALLIES),0},
{BE_SLOW,2,MONST_INANIMATE,(BF_TARGET_ENEMIES),0},
{BE_SHIELDING,5,MONST_INANIMATE,(BF_TARGET_ALLIES),0},
{BE_NONE,10,(MONST_IMMOBILE | MONST_IMMUNE_TO_WEBS),(BF_TARGET_ENEMIES | BF_NEVER_REFLECTS | BF_NOT_LEARNABLE),0},
{BE_DAMAGE,1,0,(BF_PASSES_THRU_CREATURES | BF_TARGET_ENEMIES | BF_ELECTRIC),0},
{BE_DAMAGE,18,MONST_IMMUNE_TO_FIRE,(BF_TARGET_ENEMIES | BF_FIERY | BF_NOT_LEARNABLE),0},
{BE_ATTACK,1,MONST_IMMUNE_TO_WEAPONS,(BF_TARGET_ENEMIES | BF_NEVER_REFLECTS | BF_NOT_LEARNABLE),0},
{BE_ATTACK,1,0,(BF_TARGET_ENEMIES | BF_NEVER_REFLECTS | BF_NOT_LEARNABLE),0},
{BE_NONE,5,(MONST_INANIMATE | MONST_IMMUNE_TO_WEBS),(BF_TARGET_ENEMIES | BF_NEVER_REFLECTS),0},
{BE_ATTACK,1,MONST_IMMUNE_TO_WEAPONS,(BF_TARGET_ENEMIES | BF_NEVER_REFLECTS | BF_NOT_LEARNABLE | BF_DISPLAY_CHAR_ALONG_LENGTH),0}
};
struct {int tile;} dungeonFeatureCatalog[1];struct {unsigned long flags;} tileCatalog[1];
boolean monstersAreTeammates(creature*a,creature*b){return a!=b && a->creatureState==b->creatureState;}
boolean monstersAreEnemies(creature*a,creature*b){return a!=b && a->creatureState!=b->creatureState;}
int distanceBetween(pos a,pos b){return max(abs(a.x-b.x),abs(a.y-b.y));}
unsigned long burnedTerrainFlagsAtLoc(pos p){return 0;}
unsigned long avoidedFlagsForMonster(creatureType*t){return 0;}
boolean cellHasTerrainFlag(pos p,unsigned long f){return false;}
boolean targetEligibleForCombatBuff(creature*a,creature*b){return true;}
int netEnchant(item*i){return 1;}
static boolean specificallyValidBoltTarget(creature *caster, creature *target, enum boltType theBoltType) {

    if ((boltCatalog[theBoltType].flags & BF_TARGET_ALLIES)
        && (!monstersAreTeammates(caster, target) || monstersAreEnemies(caster, target))) {

        return false;
    }
    if ((boltCatalog[theBoltType].flags & BF_TARGET_ENEMIES)
        && (!monstersAreEnemies(caster, target))) {

        return false;
    }
    if ((boltCatalog[theBoltType].flags & BF_TARGET_ENEMIES)
        && (target->info.flags & MONST_INVULNERABLE)) {

        return false;
    }
    if (((target->info.flags & MONST_REFLECT_50) || (target->info.abilityFlags & MA_REFLECT_100))
        && target->creatureState != MONSTER_ALLY
        && !(boltCatalog[theBoltType].flags & (BF_NEVER_REFLECTS | BF_HALTS_BEFORE_OBSTRUCTION))) {
        // Don't fire a reflectable bolt at a reflective target unless it's your ally.
        return false;
    }
    if (boltCatalog[theBoltType].forbiddenMonsterFlags & target->info.flags) {
        // Don't fire a bolt at a creature type that it won't affect.
        return false;
    }
    if ((boltCatalog[theBoltType].flags & BF_FIERY)
        && target->status[STATUS_IMMUNE_TO_FIRE]) {
        // Don't shoot fireballs at fire-immune creatures.
        return false;
    }
    if ((boltCatalog[theBoltType].flags & BF_FIERY)
        && burnedTerrainFlagsAtLoc(caster->loc) & avoidedFlagsForMonster(&(caster->info))) {
        // Don't shoot fireballs if you're standing on a tile that could combust into something that harms you.
        return false;
    }

    // Rules specific to bolt effects:
    switch (boltCatalog[theBoltType].boltEffect) {
        case BE_BECKONING:
            if (distanceBetween(caster->loc, target->loc) <= 1) {
                return false;
            }
            break;
        case BE_ATTACK:
            if (cellHasTerrainFlag(target->loc, T_OBSTRUCTS_PASSABILITY)
                && !(target->info.flags & MONST_ATTACKABLE_THRU_WALLS)) {
                // Don't shoot an arrow at an embedded creature.
                return false;
            }
            // continue to BE_DAMAGE below
        case BE_DAMAGE:
            if (target->status[STATUS_ENTRANCED]
                && monstersAreEnemies(caster, target)) {
                // Don't break your enemies' entrancement.
                return false;
            }
            break;
        case BE_NONE:
            // BE_NONE bolts are always going to be all about the terrain effects,
            // so our logic has to follow from the terrain parameters of the bolt's target DF.
            if (boltCatalog[theBoltType].targetDF) {
                const unsigned long terrainFlags = tileCatalog[dungeonFeatureCatalog[boltCatalog[theBoltType].targetDF].tile].flags;
                if ((terrainFlags & T_ENTANGLES)
                    && target->status[STATUS_STUCK]) {
                    // Don't try to entangle a creature that is already entangled.
                    return false;
                }
                if ((boltCatalog[theBoltType].flags & BF_TARGET_ENEMIES)
                    && !(terrainFlags & avoidedFlagsForMonster(&(target->info)))
                    && (!(terrainFlags & T_ENTANGLES) || (target->info.flags & MONST_IMMUNE_TO_WEBS))) {

                    return false;
                }
            }
            break;
        case BE_DISCORD:
            if (target->status[STATUS_DISCORDANT]
                || target == &player) {
                // Don't cast discord if the target is already discordant, or if it is the player.
                // (Players should never be intentionally targeted by discord. It's just a fact of monster psychology.)
                return false;
            }
            break;
        case BE_NEGATION:
            if (monstersAreEnemies(caster, target)) {
                if (target->status[STATUS_HASTED] || target->status[STATUS_TELEPATHIC] || target->status[STATUS_SHIELDED]) {
                    // Dispel haste, telepathy, protection.
                    return true;
                }
                if (target->info.flags & (MONST_DIES_IF_NEGATED | MONST_IMMUNE_TO_WEAPONS)) {
                    // Dispel magic creatures; strip weapon invulnerability from revenants.
                    return true;
                }
                if ((target->status[STATUS_IMMUNE_TO_FIRE] || target->status[STATUS_LEVITATING])
                    && cellHasTerrainFlag(target->loc, (T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_AUTO_DESCENT))) {
                    // Drop the target into lava or a chasm if opportunity knocks.
                    return true;
                }
                if (monstersAreTeammates(caster, target)
                    && target->status[STATUS_DISCORDANT]
                    && !caster->status[STATUS_DISCORDANT]
                    && !(target->info.flags & MONST_DIES_IF_NEGATED)) {
                    // Dispel discord from allies unless it would destroy them.
                    return true;
                }
            } else if (monstersAreTeammates(caster, target)) {
                if (target == &player && rogue.armor && (rogue.armor->flags & ITEM_RUNIC) && (rogue.armor->flags & ITEM_RUNIC_IDENTIFIED)
                    && rogue.armor->enchant2 == A_REFLECTION && netEnchant(rogue.armor) > 0) {
                    // Allies shouldn't cast negation on the player if she's knowingly wearing armor of reflection.
                    // Too much risk of negating themselves in the process.
                    return false;
                }
                if (target->info.flags & MONST_DIES_IF_NEGATED) {
                    // Never cast negation if it would destroy an allied creature.
                    return false;
                }
                if (target->status[STATUS_ENTRANCED]
                    && caster->creatureState != MONSTER_ALLY) {
                    // Non-allied monsters will dispel entrancement on their own kind.
                    return true;
                }
                if (target->status[STATUS_MAGICAL_FEAR]) {
                    // Dispel magical fear.
                    return true;
                }
            }
            return false; // Don't cast negation unless there's a good reason.
            break;
        case BE_SLOW:
            if (target->status[STATUS_SLOWED]) {
                return false;
            }
            break;
        case BE_HASTE:
            if (target->status[STATUS_HASTED]) {
                return false;
            }
            if (!targetEligibleForCombatBuff(caster, target)) {
                return false;
            }
            break;
        case BE_SHIELDING:
            if (target->status[STATUS_SHIELDED]) {
                return false;
            }
            if (!targetEligibleForCombatBuff(caster, target)) {
                return false;
            }
            break;
        case BE_HEALING:
            if (target->currentHP >= target->info.maxHP) {
                // Don't heal a creature already at full health.
                return false;
            }
            break;
        case BE_TUNNELING:
        case BE_OBSTRUCTION:
            // Monsters will never cast these.
            return false;
            break;
        default:
            break;
    }
    return true;
}
short reflectionChance(fixpt enchant) {
    const fixpt POW_REFLECT[] = {
        // 0.85^x fixed point, with x from 0.25 to 50 in increments of 0.25:
        62926, 60421, 58015, 55705, 53487, 51358, 49313, 47349, 45464, 43654, 41916, 40247, 38644, 37106, 35628, 34210, 32848, 31540, 30284, 29078, 27920,
        26809, 25741, 24716, 23732, 22787, 21880, 21009, 20172, 19369, 18598, 17857, 17146, 16464, 15808, 15179, 14574, 13994, 13437, 12902, 12388, 11895, 11421,
        10967, 10530, 10111, 9708, 9321, 8950, 8594, 8252, 7923, 7608, 7305, 7014, 6735, 6466, 6209, 5962, 5724, 5496, 5278, 5067, 4866, 4672, 4486, 4307, 4136,
        3971, 3813, 3661, 3515, 3375, 3241, 3112, 2988, 2869, 2755, 2645, 2540, 2439, 2341, 2248, 2159, 2073, 1990, 1911, 1835, 1762, 1692, 1624, 1559, 1497, 1438,
        1380, 1325, 1273, 1222, 1173, 1127, 1082, 1039, 997, 958, 919, 883, 848, 814, 781, 750, 720, 692, 664, 638, 612, 588, 564, 542, 520, 500, 480, 461, 442,
        425, 408, 391, 376, 361, 346, 333, 319, 307, 294, 283, 271, 261, 250, 240, 231, 221, 213, 204, 196, 188, 181, 173, 166, 160, 153, 147, 141, 136, 130, 125,
        120, 115, 111, 106, 102, 98, 94, 90, 87, 83, 80, 77, 74, 71, 68, 65, 62, 60, 58, 55, 53, 51, 49, 47, 45, 43, 41, 40, 38, 37, 35, 34, 32, 31, 30, 29, 27,
        26, 25, 24, 23, 22, 21, 21, 20, 19};

    short idx = clamp(enchant * 4 / FP_FACTOR - 1, 0, LAST_INDEX(POW_REFLECT));
    return clamp(100 - (100 * POW_REFLECT[idx] / FP_FACTOR), 1, 100);
}
short staffDamageLow(fixpt enchant)            {return ((int) ((2 + enchant / FP_FACTOR) * 3 / 4));}
short staffDamageHigh(fixpt enchant)           {return ((int) (4 + (5 * enchant / FP_FACTOR / 2)));}
int main(void){
 printf("%d %d %d\n",reflectionChance(4*FP_FACTOR),staffDamageLow(10*FP_FACTOR),staffDamageHigh(10*FP_FACTOR));
 creature caster,target,*recipient;
 memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TELEPORT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_SLOW));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POLYMORPH));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_DOMINATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_INVISIBILITY));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_LIGHTNING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_POISON));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_ENTRANCEMENT));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_CONJURATION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_TUNNELING));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=0;caster.loc=(pos){12,5};recipient=&player;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INANIMATE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_TURRET;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMOBILE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_WEAPONS;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_INVULNERABLE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_IMMUNE_TO_FIRE;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=MONST_REFLECT_50;recipient->info.abilityFlags=0;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=1;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=MA_REFLECT_100;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_ENTRANCED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_SLOWED]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_INVISIBLE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
memset(&caster,0,sizeof(caster));memset(&target,0,sizeof(target));memset(&player,0,sizeof(player));
 caster.creatureState=1;caster.loc=(pos){12,5};recipient=&target;recipient->creatureState=0;recipient->loc=(pos){8,5};recipient->info.maxHP=recipient->currentHP=100;
 recipient->info.flags=0;recipient->info.abilityFlags=0;recipient->status[STATUS_IMMUNE_TO_FIRE]=10;
 printf("%d\n",specificallyValidBoltTarget(&caster,recipient,BOLT_OBSTRUCTION));
}
