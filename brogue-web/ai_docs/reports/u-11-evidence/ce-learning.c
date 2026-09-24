// Generated from repository CE; world/map/RNG/UI are audit stubs.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#define Fl(n) (1UL << (n))
#define true 1
#define false 0
#define COLS 256
#define DCOLS 256
#define MONSTER_ALLY 1
#define MK_SPECTRAL_IMAGE 999
#define T_OBSTRUCTS_PASSABILITY 1
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
enum monsterBookkeepingFlags {
    MB_WAS_VISIBLE              = Fl(0),    // monster was visible to player last turn
    MB_TELEPATHICALLY_REVEALED  = Fl(1),    // player can magically see monster and adjacent cells
    MB_PREPLACED                = Fl(2),    // monster dropped onto the level and requires post-processing
    MB_APPROACHING_UPSTAIRS     = Fl(3),    // following the player up the stairs
    MB_APPROACHING_DOWNSTAIRS   = Fl(4),    // following the player down the stairs
    MB_APPROACHING_PIT          = Fl(5),    // following the player down a pit
    MB_LEADER                   = Fl(6),    // monster is the leader of a horde
    MB_FOLLOWER                 = Fl(7),    // monster is a member of a horde
    MB_CAPTIVE                  = Fl(8),    // monster is all tied up
    MB_SEIZED                   = Fl(9),    // monster is being held
    MB_SEIZING                  = Fl(10),   // monster is holding another creature immobile
    MB_SUBMERGED                = Fl(11),   // monster is currently submerged and hence invisible until it attacks
    MB_JUST_SUMMONED            = Fl(12),   // used to mark summons so they can be post-processed
    MB_WILL_FLASH               = Fl(13),   // this monster will flash as soon as control is returned to the player
    MB_BOUND_TO_LEADER          = Fl(14),   // monster will die if the leader dies or becomes separated from the leader
    MB_MARKED_FOR_SACRIFICE     = Fl(15),   // scary glow, monster can be sacrificed in the appropriate machine
    MB_ABSORBING                = Fl(16),   // currently learning a skill by absorbing an enemy corpse
    MB_DOES_NOT_TRACK_LEADER    = Fl(17),   // monster will not follow its leader around
    MB_IS_FALLING               = Fl(18),   // monster is plunging downward at the end of the turn
    MB_IS_DYING                 = Fl(19),   // monster is currently dying; the death is still being processed
    MB_GIVEN_UP_ON_SCENT        = Fl(20),   // to help the monster remember that the scent map is a dead end
    MB_IS_DORMANT               = Fl(21),   // lurking, waiting to burst out
    MB_WEAPON_AUTO_ID           = Fl(22),   // slaying the monster will count toward weapon auto-ID
    MB_ALREADY_SEEN             = Fl(23),   // seeing this monster won't interrupt exploration
    MB_ADMINISTRATIVE_DEATH     = Fl(24),   // like the `administrativeDeath` parameter to `killCreature`
    MB_HAS_DIED                 = Fl(25),   // monster has already been killed but not yet removed from `monsters`
    MB_DOES_NOT_RESURRECT       = Fl(26)    // resurrection altars don't revive monsters summoned by allies
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
typedef struct {short x,y;} pos;
#define INVALID_POS ((pos){-1,-1})
typedef struct {unsigned long flags,abilityFlags; short monsterID,bolts[32]; char monsterName[30];} creatureType;
typedef struct {creatureType info; short creatureState,newPowerCount,totalPowerCount;
 pos loc,targetCorpseLoc; char targetCorpseName[30]; unsigned long absorptionFlags,bookkeepingFlags;
 boolean absorbBehavior; short absorptionBolt,corpseAbsorptionCounter,ticksUntilTurn;
 short status[NUMBER_OF_STATUS_EFFECTS],maxStatus[NUMBER_OF_STATUS_EFFECTS];} creature;
typedef struct {unsigned long flags; char abilityDescription[80];} auditBolt;
auditBolt boltCatalog[30] = {[BOLT_TELEPORT]={0,""},[BOLT_SLOW]={0,""},[BOLT_POLYMORPH]={0,""},[BOLT_NEGATION]={0,""},[BOLT_DOMINATION]={0,""},[BOLT_BECKONING]={0,""},[BOLT_PLENTY]={BF_NOT_LEARNABLE,""},[BOLT_INVISIBILITY]={0,""},[BOLT_EMPOWERMENT]={BF_NOT_LEARNABLE,""},[BOLT_LIGHTNING]={0,""},[BOLT_FIRE]={0,""},[BOLT_POISON]={0,""},[BOLT_TUNNELING]={0,""},[BOLT_BLINKING]={0,""},[BOLT_ENTRANCEMENT]={0,""},[BOLT_OBSTRUCTION]={0,""},[BOLT_DISCORD]={0,""},[BOLT_CONJURATION]={0,""},[BOLT_HEALING]={0,""},[BOLT_HASTE]={0,""},[BOLT_SLOW_2]={0,""},[BOLT_SHIELDING]={0,""},[BOLT_SPIDERWEB]={BF_NOT_LEARNABLE,""},[BOLT_SPARK]={0,""},[BOLT_DRAGONFIRE]={BF_NOT_LEARNABLE,""},[BOLT_DISTANCE_ATTACK]={BF_NOT_LEARNABLE,""},[BOLT_POISON_DART]={BF_NOT_LEARNABLE,""},[BOLT_ANCIENT_SPIRIT_VINES]={0,""},[BOLT_WHIP]={BF_NOT_LEARNABLE,""}};
struct {int numberBoltKinds;} constants={30},*gameConst=&constants;
creature roster[3]; int monsters,rosterCount,mapCall,rngCalls,draws[8],lo[8],hi[8],avoids,blocked;
short mapInputs[3][4];
typedef struct {int index;} creatureIterator;
creatureIterator iterateCreatures(int ignored){return (creatureIterator){0};}
boolean hasNextCreature(creatureIterator it){return it.index<rosterCount;}
creature *nextCreature(creatureIterator *it){return &roster[it->index++];}
boolean isPosInMap(pos p){return p.x>=0&&p.y>=0&&p.x<4&&p.y<4;}
boolean posEq(pos a,pos b){return a.x==b.x&&a.y==b.y;}
boolean monsterAvoids(creature *m,pos p){return avoids;}
boolean cellHasTerrainFlag(pos p,unsigned long flag){return blocked;}
unsigned long forbiddenFlagsForMonster(creatureType *t){return t->flags;}
short **allocGrid(void){short **g=calloc(4,sizeof(*g));for(int x=0;x<4;x++)g[x]=calloc(4,sizeof(**g));return g;}
void freeGrid(short **g){for(int x=0;x<4;x++)free(g[x]);free(g);}
void fillGrid(short **g,short value){for(int x=0;x<4;x++)for(int y=0;y<4;y++)g[x][y]=value;}
void calculateDistances(short **g,short x,short y,unsigned long flags,void *traveler,boolean diag,boolean secrets){
 assert(mapCall<3);for(int i=0;i<4;i++)g[i][0]=mapInputs[mapCall][i];mapCall++;
}
short rand_range(short low,short high){assert(rngCalls<8);lo[rngCalls]=low;hi[rngCalls]=high;int r=draws[rngCalls++];assert(r>=low&&r<=high);return r;}
struct {char absorbing[30];} monsterText[1000];
struct {char description[80];} monsterBehaviorCatalog[32],monsterAbilityCatalog[32];
int goodMessageColor,advancementMessageColor;
boolean canSeeMonster(creature *m){return false;}
void monsterName(char *b,creature *m,boolean article){strcpy(b,"ally");}
void messageWithColor(char *b,int *color,int n){}
void resolvePronounEscapes(char *b,creature *m){}
int unflag(unsigned long flag){int i=0;while(flag>1){flag>>=1;i++;}return i;}
static boolean canAbsorb(creature *ally, boolean ourBolts[], creature *prey,
                         short **grid) {
  short i;

  if (ally->creatureState == MONSTER_ALLY && ally->newPowerCount > 0 &&
      (!isPosInMap(ally->targetCorpseLoc)) &&
      !((ally->info.flags | prey->info.flags) &
        (MONST_INANIMATE | MONST_IMMOBILE)) &&
      !monsterAvoids(ally, prey->loc) && grid[ally->loc.x][ally->loc.y] <= 10) {

    if (~(ally->info.abilityFlags) & prey->info.abilityFlags &
        LEARNABLE_ABILITIES) {
      return true;
    } else if (~(ally->info.flags) & prey->info.flags & LEARNABLE_BEHAVIORS) {
      return true;
    } else {
      for (i = 0; i < gameConst->numberBoltKinds; i++) {
        ourBolts[i] = false;
      }
      for (i = 0; ally->info.bolts[i] != BOLT_NONE; i++) {
        ourBolts[ally->info.bolts[i]] = true;
      }

      for (i = 0; prey->info.bolts[i] != BOLT_NONE; i++) {
        if (!(boltCatalog[prey->info.bolts[i]].flags & BF_NOT_LEARNABLE) &&
            !ourBolts[prey->info.bolts[i]]) {

          return true;
        }
      }
    }
  }
  return false;
}
static boolean anyoneWantABite(creature *decedent) {
  short candidates, randIndex, i;
  short **grid;
  boolean success = false;
  boolean *ourBolts;

  ourBolts = (boolean *)calloc(gameConst->numberBoltKinds, sizeof(boolean));

  candidates = 0;
  if ((!(decedent->info.abilityFlags & LEARNABLE_ABILITIES) &&
       !(decedent->info.flags & LEARNABLE_BEHAVIORS) &&
       decedent->info.bolts[0] == BOLT_NONE) ||
      (cellHasTerrainFlag(decedent->loc, T_OBSTRUCTS_PASSABILITY)) ||
      decedent->info.monsterID == MK_SPECTRAL_IMAGE ||
      (decedent->info.flags & (MONST_INANIMATE | MONST_IMMOBILE))) {

    return false;
  }

  grid = allocGrid();
  for (creatureIterator it = iterateCreatures(monsters); hasNextCreature(it);) {
    creature *ally = nextCreature(&it);
    if (ally->creatureState == MONSTER_ALLY) {
      fillGrid(grid, 0);
      calculateDistances(grid, decedent->loc.x, decedent->loc.y,
                         forbiddenFlagsForMonster(&(ally->info)), NULL, true,
                         true);
    }
    if (canAbsorb(ally, ourBolts, decedent, grid)) {
      candidates++;
    }
  }
  if (candidates > 0) {
    randIndex = rand_range(1, candidates);
    creature *firstAlly = NULL;
    for (creatureIterator it = iterateCreatures(monsters);
         hasNextCreature(it);) {
      creature *ally = nextCreature(&it);
      // CanAbsorb() populates ourBolts if it returns true and there are no
      // learnable behaviors or flags:
      if (canAbsorb(ally, ourBolts, decedent, grid) && !--randIndex) {
        firstAlly = ally;
        break;
      }
    }
    if (firstAlly) {
      firstAlly->targetCorpseLoc = decedent->loc;
      strcpy(firstAlly->targetCorpseName, decedent->info.monsterName);
      firstAlly->corpseAbsorptionCounter =
          20; // 20 turns to get there and start eating before he loses interest

      // Choose a superpower.
      // First, select from among learnable ability or behavior flags, if one is
      // available.
      candidates = 0;
      for (i = 0; i < 32; i++) {
        if (Fl(i) & ~(firstAlly->info.abilityFlags) &
            decedent->info.abilityFlags & LEARNABLE_ABILITIES) {
          candidates++;
        }
      }
      for (i = 0; i < 32; i++) {
        if (Fl(i) & ~(firstAlly->info.flags) & decedent->info.flags &
            LEARNABLE_BEHAVIORS) {
          candidates++;
        }
      }
      if (candidates > 0) {
        randIndex = rand_range(1, candidates);
        for (i = 0; i < 32; i++) {
          if ((Fl(i) & ~(firstAlly->info.abilityFlags) &
               decedent->info.abilityFlags & LEARNABLE_ABILITIES) &&
              !--randIndex) {

            firstAlly->absorptionFlags = Fl(i);
            firstAlly->absorbBehavior = false;
            success = true;
            break;
          }
        }
        for (i = 0; i < 32 && !success; i++) {
          if ((Fl(i) & ~(firstAlly->info.flags) & decedent->info.flags &
               LEARNABLE_BEHAVIORS) &&
              !--randIndex) {

            firstAlly->absorptionFlags = Fl(i);
            firstAlly->absorbBehavior = true;
            success = true;
            break;
          }
        }
      } else if (decedent->info.bolts[0] != BOLT_NONE) {
        // If there are no learnable ability or behavior flags, pick a learnable
        // bolt.
        candidates = 0;
        for (i = 0; decedent->info.bolts[i] != BOLT_NONE; i++) {
          if (!(boltCatalog[decedent->info.bolts[i]].flags &
                BF_NOT_LEARNABLE) &&
              !ourBolts[decedent->info.bolts[i]]) {

            candidates++;
          }
        }
        if (candidates > 0) {
          randIndex = rand_range(1, candidates);
          for (i = 0; decedent->info.bolts[i] != BOLT_NONE; i++) {
            if (!(boltCatalog[decedent->info.bolts[i]].flags &
                  BF_NOT_LEARNABLE) &&
                !ourBolts[decedent->info.bolts[i]] && !--randIndex) {

              firstAlly->absorptionBolt = decedent->info.bolts[i];
              success = true;
              break;
            }
          }
        }
      }
    }
  }
  freeGrid(grid);
  free(ourBolts);
  return success;
}
static boolean updateMonsterCorpseAbsorption(creature *monst) {
    short i;
    char buf[COLS], buf2[COLS];

    if (posEq(monst->loc, monst->targetCorpseLoc)
        && (monst->bookkeepingFlags & MB_ABSORBING)) {

        if (--monst->corpseAbsorptionCounter <= 0) {
            monst->targetCorpseLoc = INVALID_POS;
            if (monst->absorptionBolt != BOLT_NONE) {
                for (i=0; monst->info.bolts[i] != BOLT_NONE; i++);
                monst->info.bolts[i] = monst->absorptionBolt;
            } else if (monst->absorbBehavior) {
                monst->info.flags |= monst->absorptionFlags;
            } else {
                monst->info.abilityFlags |= monst->absorptionFlags;
            }
            monst->newPowerCount--;
            monst->bookkeepingFlags &= ~MB_ABSORBING;

            if (monst->info.flags & MONST_FIERY) {
                monst->status[STATUS_BURNING] = monst->maxStatus[STATUS_BURNING] = 1000; // won't decrease
            }
            if (monst->info.flags & MONST_FLIES) {
                monst->status[STATUS_LEVITATING] = monst->maxStatus[STATUS_LEVITATING] = 1000; // won't decrease
                monst->info.flags &= ~(MONST_RESTRICTED_TO_LIQUID | MONST_SUBMERGES);
                monst->bookkeepingFlags &= ~(MB_SUBMERGED);
            }
            if (monst->info.flags & MONST_IMMUNE_TO_FIRE) {
                monst->status[STATUS_IMMUNE_TO_FIRE] = monst->maxStatus[STATUS_IMMUNE_TO_FIRE] = 1000; // won't decrease
            }
            if (monst->info.flags & MONST_INVISIBLE) {
                monst->status[STATUS_INVISIBLE] = monst->maxStatus[STATUS_INVISIBLE] = 1000; // won't decrease
            }
            if (canSeeMonster(monst)) {
                monsterName(buf2, monst, true);
                sprintf(buf, "%s finished %s the %s.", buf2, monsterText[monst->info.monsterID].absorbing, monst->targetCorpseName);
                messageWithColor(buf, &goodMessageColor, 0);
                if (monst->absorptionBolt != BOLT_NONE) {
                    sprintf(buf, "%s %s!", buf2, boltCatalog[monst->absorptionBolt].abilityDescription);
                } else if (monst->absorbBehavior) {
                    sprintf(buf, "%s now %s!", buf2, monsterBehaviorCatalog[unflag(monst->absorptionFlags)].description);
                } else {
                    sprintf(buf, "%s now %s!", buf2, monsterAbilityCatalog[unflag(monst->absorptionFlags)].description);
                }
                resolvePronounEscapes(buf, monst);
                messageWithColor(buf, &advancementMessageColor, 0);
            }
            monst->absorptionFlags = 0;
            monst->absorptionBolt = BOLT_NONE;
        }
        monst->ticksUntilTurn = 100;
        return true;
    } else if (--monst->corpseAbsorptionCounter <= 0) {
        monst->targetCorpseLoc = INVALID_POS; // lost its chance
        monst->bookkeepingFlags &= ~MB_ABSORBING;
        monst->absorptionFlags = 0;
        monst->absorptionBolt = BOLT_NONE;
    } else if (monst->bookkeepingFlags & MB_ABSORBING) {
        monst->bookkeepingFlags &= ~MB_ABSORBING; // absorbing but not on the corpse
        if (monst->corpseAbsorptionCounter <= 15) {
            monst->targetCorpseLoc = INVALID_POS; // lost its chance
            monst->absorptionFlags = 0;
            monst->absorptionBolt = BOLT_NONE;
        }
    }
    return false;
}
creature prey;
void reset(int n){
 memset(roster,0,sizeof(roster));memset(&prey,0,sizeof(prey));memset(mapInputs,0,sizeof(mapInputs));
 rosterCount=n;mapCall=rngCalls=avoids=blocked=0;for(int i=0;i<8;i++)draws[i]=1;
 for(int i=0;i<n;i++){roster[i].creatureState=MONSTER_ALLY;roster[i].newPowerCount=roster[i].totalPowerCount=1;roster[i].loc=(pos){i,0};roster[i].targetCorpseLoc=INVALID_POS;}
 prey.loc=(pos){3,0};strcpy(prey.info.monsterName,"prey");
}
int main(void){
 // Scratch array is deliberately dirty before the flag-success early return.
 reset(1);boolean scratch[30]={0};short **g=allocGrid();prey.info.abilityFlags=MA_TRANSFERENCE;scratch[BOLT_FIRE]=true;
 assert(canAbsorb(&roster[0],scratch,&prey,g));assert(scratch[BOLT_FIRE]);
 prey.info.abilityFlags=0;prey.info.bolts[0]=BOLT_FIRE;roster[0].info.bolts[0]=BOLT_SPARK;
 assert(canAbsorb(&roster[0],scratch,&prey,g));assert(!scratch[BOLT_FIRE]&&scratch[BOLT_SPARK]);
 roster[0].newPowerCount=0;assert(!canAbsorb(&roster[0],scratch,&prey,g));roster[0].newPowerCount=1;
 roster[0].targetCorpseLoc=prey.loc;assert(!canAbsorb(&roster[0],scratch,&prey,g));roster[0].targetCorpseLoc=INVALID_POS;
 roster[0].info.flags=MONST_INANIMATE;assert(!canAbsorb(&roster[0],scratch,&prey,g));roster[0].info.flags=0;
 prey.info.flags=MONST_IMMOBILE;assert(!canAbsorb(&roster[0],scratch,&prey,g));prey.info.flags=0;
 avoids=1;assert(!canAbsorb(&roster[0],scratch,&prey,g));avoids=0;
 g[0][0]=11;assert(!canAbsorb(&roster[0],scratch,&prey,g));g[0][0]=10;assert(canAbsorb(&roster[0],scratch,&prey,g));freeGrid(g);
 puts("PASS scratch: flag early return preserves stale ourBolts; bolt branch rebuilds it; eligibility gates and distance 10/11");
 // First pass: A/B qualify on their own maps. Second pass uses B's map for both.
 for(int draw=1;draw<=2;draw++){
  reset(2);prey.info.abilityFlags=MA_TRANSFERENCE;mapInputs[0][0]=2;mapInputs[1][0]=20;mapInputs[1][1]=2;draws[0]=draw;
  boolean result=anyoneWantABite(&prey);assert(mapCall==2&&hi[0]==2);
  if(draw==1){assert(result&&isPosInMap(roster[1].targetCorpseLoc)&&!isPosInMap(roster[0].targetCorpseLoc)&&rngCalls==2);}
  else{assert(!result&&!isPosInMap(roster[0].targetCorpseLoc)&&!isPosInMap(roster[1].targetCorpseLoc)&&rngCalls==1);}
  printf("PASS shared-map draw=%d denominator=%d selected=%s rng_calls=%d\n",draw,hi[0],result?"B":"none",rngCalls);
 }
 reset(2);prey.info.abilityFlags=MA_TRANSFERENCE;mapInputs[0][0]=20;mapInputs[1][0]=mapInputs[1][1]=2;
 assert(anyoneWantABite(&prey)&&hi[0]==1&&isPosInMap(roster[0].targetCorpseLoc));
 puts("PASS shared-map: first-pass-ineligible A can be chosen on last map; denominator remains 1");
 reset(2);roster[1].newPowerCount=0;prey.info.abilityFlags=MA_TRANSFERENCE;mapInputs[0][0]=2;mapInputs[1][0]=20;
 assert(!anyoneWantABite(&prey)&&mapCall==2&&rngCalls==1&&hi[0]==1);
 puts("PASS shared-map: last ally with no pending slot still overwrites map");
 reset(1);prey.info.abilityFlags=LEARNABLE_ABILITIES;prey.info.flags=LEARNABLE_BEHAVIORS;prey.info.bolts[0]=BOLT_FIRE;draws[1]=3;
 assert(anyoneWantABite(&prey)&&hi[1]==6&&roster[0].absorbBehavior&&roster[0].absorptionFlags==MONST_INVISIBLE&&roster[0].absorptionBolt==0);
 puts("PASS priority: 2 abilities then 4 behaviors; FIRE does not enter this six-way draw");
 int accepted=0,rejected=0;
 for(int b=1;b<30;b++){
  reset(1);prey.info.bolts[0]=b;boolean result=anyoneWantABite(&prey);
  if(boltCatalog[b].flags&BF_NOT_LEARNABLE){assert(!result&&rngCalls==0);rejected++;}
  else{assert(result&&rngCalls==2&&roster[0].absorptionBolt==b);accepted++;}
 }
 assert(accepted==22&&rejected==7);printf("PASS catalog: %d learnable, %d excluded (including blink/vines/tunnel/obstruction accepted)\n",accepted,rejected);
 reset(1);roster[0].info.bolts[0]=BOLT_SPARK;prey.info.bolts[0]=BOLT_SPARK;prey.info.bolts[1]=BOLT_SPIDERWEB;prey.info.bolts[2]=BOLT_ANCIENT_SPIRIT_VINES;prey.info.bolts[3]=BOLT_BLINKING;draws[1]=2;
 assert(anyoneWantABite(&prey)&&hi[1]==2&&roster[0].absorptionBolt==BOLT_BLINKING);
 puts("PASS bolt draw: existing SPARK and NOT_LEARNABLE web excluded; vines/blink retain denominator 2");
 creature *m=&roster[0];m->loc=m->targetCorpseLoc;m->bookkeepingFlags|=MB_ABSORBING;
 m->status[STATUS_POISONED]=m->status[STATUS_BURNING]=m->status[STATUS_PARALYZED]=3;
 for(int i=0;i<20;i++){assert(updateMonsterCorpseAbsorption(m));assert(m->ticksUntilTurn==100);if(i<19)assert(m->newPowerCount==1);}
 assert(m->newPowerCount==0&&m->totalPowerCount==1&&m->info.bolts[1]==BOLT_BLINKING&&m->absorptionBolt==0&&!isPosInMap(m->targetCorpseLoc));
 assert(!updateMonsterCorpseAbsorption(m)&&m->newPowerCount==0&&rngCalls==2);
 puts("PASS finish: 20 absorption calls, final call consumed, append bolt, new-- once, total unchanged, no RNG; statuses do not gate ongoing absorption");
 for(int count=16;count<=17;count++){
  reset(1);m=&roster[0];m->targetCorpseLoc=prey.loc;m->corpseAbsorptionCounter=count;m->bookkeepingFlags=MB_ABSORBING;m->absorptionFlags=MA_TRANSFERENCE;
  assert(!updateMonsterCorpseAbsorption(m));assert(!(m->bookkeepingFlags&MB_ABSORBING));assert(isPosInMap(m->targetCorpseLoc)==(count==17));assert(m->newPowerCount==1);
 }
 puts("PASS displaced: pre-counter 17 -> 16 retains target, 16 -> 15 abandons; no slot spent");
 reset(1);m=&roster[0];m->targetCorpseLoc=prey.loc;m->corpseAbsorptionCounter=20;m->absorptionFlags=MA_TRANSFERENCE;
 for(int i=0;i<20;i++)assert(!updateMonsterCorpseAbsorption(m));assert(!isPosInMap(m->targetCorpseLoc)&&m->newPowerCount==1&&m->absorptionFlags==0);
 puts("PASS approach timeout: 20 calls without starting absorption clear target/power, retain slot");
 reset(1);m=&roster[0];m->targetCorpseLoc=m->loc;m->corpseAbsorptionCounter=1;m->bookkeepingFlags=MB_ABSORBING|MB_SUBMERGED;
 m->info.flags=MONST_FIERY|MONST_IMMUNE_TO_FIRE|MONST_INVISIBLE|MONST_RESTRICTED_TO_LIQUID|MONST_SUBMERGES;m->absorbBehavior=true;m->absorptionFlags=MONST_FLIES;
 assert(updateMonsterCorpseAbsorption(m));assert(!(m->info.flags&(MONST_RESTRICTED_TO_LIQUID|MONST_SUBMERGES))&&!(m->bookkeepingFlags&MB_SUBMERGED));
 int statuses[]={STATUS_BURNING,STATUS_LEVITATING,STATUS_IMMUNE_TO_FIRE,STATUS_INVISIBLE};
 for(int i=0;i<4;i++)assert(m->status[statuses[i]]==1000&&m->maxStatus[statuses[i]]==1000);
 puts("PASS permanent flags: 4 status/maxStatus pairs=1000; flying clears liquid/submerged flags");
 puts("ALL CE AUDIT ASSERTIONS PASSED (stubbed distance/world inputs; not a full-engine differential test)");
}
