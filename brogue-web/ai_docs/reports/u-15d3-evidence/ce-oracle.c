
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <assert.h>
#include <string.h>
#define Fl(n) (1UL << (n))
#define brogueAssert assert
#define clamp(x,a,b) ((x)<(a)?(a):((x)>(b)?(b):(x)))
#define MONSTER_CLASS_COUNT 15
typedef bool boolean;
typedef struct {short lowerBound, upperBound, clumpFactor;} randomRange;
typedef struct {short strengthRequired; randomRange range;} itemTable;
typedef struct {randomRange damage; short strengthRequired,enchant1,enchant2,vorpalEnemy,quantity,quiverNumber,charges,armor; unsigned long flags;} item;
struct {short depthLevel;} rogue;
struct constants {short weaponKillsToAutoID,armorDelayToAutoID;} constants = {20,1000}, *gameConst = &constants;
static long tape[128], calls[128][3]; static int count, length;
long rand_range(long lo,long hi) {
    if (hi<=lo) return lo;
    assert(count<128);
    long raw=count<length?tape[count]:99, value=lo+raw%(hi-lo+1);
    calls[count][0]=lo;calls[count][1]=hi;calls[count++][2]=value;return value;
}
short chooseKind(const itemTable *t, short n) {abort();}
short randClumpedRange(short,short,short);
enum itemCategory {
    FOOD                = Fl(0),
    WEAPON              = Fl(1),
    ARMOR               = Fl(2),
    POTION              = Fl(3),
    SCROLL              = Fl(4),
    STAFF               = Fl(5),
    WAND                = Fl(6),
    RING                = Fl(7),
    CHARM               = Fl(8),
    GOLD                = Fl(9),
    AMULET              = Fl(10),
    GEM                 = Fl(11),
    KEY                 = Fl(12),

    // Categories where the kinds have intrinsic magic polarity; i.e. each kind
    // has a certain polarity (with positive enchant) which doesn't depend on
    // the specific item. NOTE: Rings are considered to be naturally good, but
    // may be bad when negatively enchanted. We also assume that none of the
    // kinds in these categories have neutral polarity.
    HAS_INTRINSIC_POLARITY = (POTION | SCROLL | RING | WAND | STAFF),

    CAN_BE_DETECTED     = (WEAPON | ARMOR | POTION | SCROLL | RING | CHARM | WAND | STAFF | AMULET),
    CAN_BE_ENCHANTED    = (WEAPON | ARMOR | RING | CHARM | WAND | STAFF),
    PRENAMED_CATEGORY   = (FOOD | GOLD | AMULET | GEM | KEY),
    NEVER_IDENTIFIABLE  = (FOOD | CHARM | GOLD | AMULET | GEM | KEY),
    CAN_BE_SWAPPED      = (WEAPON | ARMOR | STAFF | CHARM | RING),
    ALL_ITEMS           = (FOOD|POTION|WEAPON|ARMOR|STAFF|WAND|SCROLL|RING|CHARM|GOLD|AMULET|GEM|KEY),
};
enum itemFlags {
    ITEM_IDENTIFIED         = Fl(0),
    ITEM_EQUIPPED           = Fl(1),
    ITEM_CURSED             = Fl(2),
    ITEM_PROTECTED          = Fl(3),
    // unused               = Fl(4),
    ITEM_RUNIC              = Fl(5),
    ITEM_RUNIC_HINTED       = Fl(6),
    ITEM_RUNIC_IDENTIFIED   = Fl(7),
    ITEM_CAN_BE_IDENTIFIED  = Fl(8),
    ITEM_PREPLACED          = Fl(9),
    ITEM_FLAMMABLE          = Fl(10),
    ITEM_MAGIC_DETECTED     = Fl(11),
    ITEM_MAX_CHARGES_KNOWN  = Fl(12),
    ITEM_IS_KEY             = Fl(13),

    ITEM_ATTACKS_STAGGER    = Fl(14),   // mace, hammer
    ITEM_ATTACKS_EXTEND     = Fl(15),   // whip
    ITEM_ATTACKS_QUICKLY    = Fl(16),   // rapier
    ITEM_ATTACKS_PENETRATE  = Fl(17),   // spear, pike
    ITEM_ATTACKS_ALL_ADJACENT=Fl(18),   // axe, war axe
    ITEM_LUNGE_ATTACKS      = Fl(19),   // rapier
    ITEM_SNEAK_ATTACK_BONUS = Fl(20),   // dagger
    ITEM_PASS_ATTACKS       = Fl(21),   // flail

    ITEM_KIND_AUTO_ID       = Fl(22),   // the item type will become known when the item is picked up.
    ITEM_PLAYER_AVOIDS      = Fl(23),   // explore and travel will try to avoid picking the item up
};
enum weaponKind {
    DAGGER,
    SWORD,
    BROADSWORD,

    WHIP,
    RAPIER,
    FLAIL,

    MACE,
    HAMMER,

    SPEAR,
    PIKE,

    AXE,
    WAR_AXE,

    DART,
    INCENDIARY_DART,
    JAVELIN,
    NUMBER_WEAPON_KINDS
};
enum weaponEnchants {
    W_SPEED,
    W_QUIETUS,
    W_PARALYSIS,
    W_MULTIPLICITY,
    W_SLOWING,
    W_CONFUSION,
    W_FORCE,
    W_SLAYING,
    W_MERCY,
    NUMBER_GOOD_WEAPON_ENCHANT_KINDS = W_MERCY,
    W_PLENTY,
    NUMBER_WEAPON_RUNIC_KINDS
};
enum armorKind {
    LEATHER_ARMOR,
    SCALE_MAIL,
    CHAIN_MAIL,
    BANDED_MAIL,
    SPLINT_MAIL,
    PLATE_MAIL,
    NUMBER_ARMOR_KINDS
};
enum armorEnchants {
    A_MULTIPLICITY,
    A_MUTUALITY,
    A_ABSORPTION,
    A_REPRISAL,
    A_IMMUNITY,
    A_REFLECTION,
    A_RESPIRATION,
    A_DAMPENING,
    A_BURDEN,
    NUMBER_GOOD_ARMOR_ENCHANT_KINDS = A_BURDEN,
    A_VULNERABILITY,
    A_IMMOLATION,
    NUMBER_ARMOR_ENCHANT_KINDS,
};
itemTable weaponTable[] = {{12,{3, 4,  1}},{14,{7, 9,  1}},{19,{14, 22, 1}},{14,{3, 5,  1}},{15,{3, 5,  1}},{17,{9, 15, 1}},{16,{16, 20, 1}},{20,{25, 35, 1}},{13,{4, 5, 1}},{18,{11, 15, 1}},{15,{7, 9, 1}},{19,{12, 17, 1}},{10,{2, 4,  1}},{12,{1, 2,  1}},{15,{3, 11, 3}}};
itemTable armorTable[] = {{10,{30,30,0}},{12,{40,40,0}},{13,{50,50,0}},{15,{70,70,0}},{17,{90,90,0}},{19,{110,110,0}}};
struct {char *name; short frequency, maxDepth;} monsterClassCatalog[] = {{"abomination",10,-1},{"dar",10,22},{"animal",10,10},{"goblin",10,10},{"ogre",10,16},{"dragon",10,-1},{"undead",10,-1},{"jelly",10,15},{"turret",5,18},{"infernal",10,-1},{"mage",10,-1},{"waterborne",10,17},{"airborne",10,15},{"fireborne",10,12},{"troll",10,15}};
short randClumpedRange(short lowerBound, short upperBound, short clumpFactor) {
    if (upperBound <= lowerBound) {
        return lowerBound;
    }
    if (clumpFactor <= 1) {
        return rand_range(lowerBound, upperBound);
    }

    short i, total = 0, numSides = (upperBound - lowerBound) / clumpFactor;

    for(i=0; i < (upperBound - lowerBound) % clumpFactor; i++) {
        total += rand_range(0, numSides + 1);
    }

    for(; i< clumpFactor; i++) {
        total += rand_range(0, numSides);
    }

    return (total + lowerBound);
}
short randClump(randomRange theRange) {
    return randClumpedRange(theRange.lowerBound, theRange.upperBound, theRange.clumpFactor);
}
boolean rand_percent(short percent) {
    return (rand_range(0, 99) < clamp(percent, 0, 100));
}
static short lotteryDraw(short *frequencies, short itemCount) {
    short i, maxFreq, randIndex;
    maxFreq = 0;
    for (i = 0; i < itemCount; i++) {
        maxFreq += frequencies[i];
    }
    brogueAssert(maxFreq > 0);
    randIndex = rand_range(0, maxFreq - 1);
    for (i = 0; i < itemCount; i++) {
        if (frequencies[i] > randIndex) {
            return i;
        } else {
            randIndex -= frequencies[i];
        }
    }
    brogueAssert(false);
    return 0;
}
short chooseVorpalEnemy() {
    short i, frequencies[MONSTER_CLASS_COUNT];
    for (i = 0; i < MONSTER_CLASS_COUNT; i++) {
        if (monsterClassCatalog[i].maxDepth <= 0
            || rogue.depthLevel <= monsterClassCatalog[i].maxDepth) {

            frequencies[i] = monsterClassCatalog[i].frequency;
        } else {
            frequencies[i] = 0;
        }
    }
    return lotteryDraw(frequencies, MONSTER_CLASS_COUNT);
}
void equipment(item *theItem, int category, short itemKind) { const itemTable *theEntry = NULL; switch(category) {
        case WEAPON:
            if (itemKind < 0) {
                itemKind = chooseKind(weaponTable, NUMBER_WEAPON_KINDS);
            }
            theEntry = &weaponTable[itemKind];
            theItem->damage = weaponTable[itemKind].range;
            theItem->strengthRequired = weaponTable[itemKind].strengthRequired;

            switch (itemKind) {
                case DAGGER:
                    theItem->flags |= ITEM_SNEAK_ATTACK_BONUS;
                    break;
                case MACE:
                case HAMMER:
                    theItem->flags |= ITEM_ATTACKS_STAGGER;
                    break;
                case WHIP:
                    theItem->flags |= ITEM_ATTACKS_EXTEND;
                    break;
                case RAPIER:
                    theItem->flags |= (ITEM_ATTACKS_QUICKLY | ITEM_LUNGE_ATTACKS);
                    break;
                case FLAIL:
                    theItem->flags |= ITEM_PASS_ATTACKS;
                    break;
                case SPEAR:
                case PIKE:
                    theItem->flags |= ITEM_ATTACKS_PENETRATE;
                    break;
                case AXE:
                case WAR_AXE:
                    theItem->flags |= ITEM_ATTACKS_ALL_ADJACENT;
                    break;
                default:
                    break;
            }

            if (rand_percent(40)) {
                theItem->enchant1 += rand_range(1, 3);
                if (rand_percent(50)) {
                    // cursed
                    theItem->enchant1 *= -1;
                    theItem->flags |= ITEM_CURSED;
                    if (rand_percent(33)) { // give it a bad runic
                        theItem->enchant2 = rand_range(NUMBER_GOOD_WEAPON_ENCHANT_KINDS, NUMBER_WEAPON_RUNIC_KINDS - 1);
                        theItem->flags |= ITEM_RUNIC;
                    }
                } else if (rand_range(3, 10)
                           * ((theItem->flags & ITEM_ATTACKS_STAGGER) ? 2 : 1)
                           / ((theItem->flags & ITEM_ATTACKS_QUICKLY) ? 2 : 1)
                           / ((theItem->flags & ITEM_ATTACKS_EXTEND) ? 2 : 1)
                           > theItem->damage.lowerBound) {
                    // give it a good runic; lower damage items are more likely to be runic
                    theItem->enchant2 = rand_range(0, NUMBER_GOOD_WEAPON_ENCHANT_KINDS - 1);
                    theItem->flags |= ITEM_RUNIC;
                    if (theItem->enchant2 == W_SLAYING) {
                        theItem->vorpalEnemy = chooseVorpalEnemy();
                    }
                } else {
                    while (rand_percent(10)) {
                        theItem->enchant1++;
                    }
                }
            }
            if (itemKind == DART || itemKind == INCENDIARY_DART || itemKind == JAVELIN) {
                if (itemKind == INCENDIARY_DART) {
                    theItem->quantity = rand_range(3, 6);
                } else {
                    theItem->quantity = rand_range(5, 18);
                }
                theItem->quiverNumber = rand_range(1, 60000);
                theItem->flags &= ~(ITEM_CURSED | ITEM_RUNIC); // throwing weapons can't be cursed or runic
                theItem->enchant1 = 0; // throwing weapons can't be magical
            }
            theItem->charges = gameConst->weaponKillsToAutoID; // kill 20 enemies to auto-identify
            break;

        case ARMOR:
            if (itemKind < 0) {
                itemKind = chooseKind(armorTable, NUMBER_ARMOR_KINDS);
            }
            theEntry = &armorTable[itemKind];
            theItem->armor = randClump(armorTable[itemKind].range);
            theItem->strengthRequired = armorTable[itemKind].strengthRequired;
            theItem->charges = gameConst->armorDelayToAutoID; // this many turns until it reveals its enchants and whether runic
            if (rand_percent(40)) {
                theItem->enchant1 += rand_range(1, 3);
                if (rand_percent(50)) {
                    // cursed
                    theItem->enchant1 *= -1;
                    theItem->flags |= ITEM_CURSED;
                    if (rand_percent(33)) { // give it a bad runic
                        theItem->enchant2 = rand_range(NUMBER_GOOD_ARMOR_ENCHANT_KINDS, NUMBER_ARMOR_ENCHANT_KINDS - 1);
                        theItem->flags |= ITEM_RUNIC;
                    }
                } else if (rand_range(0, 95) > theItem->armor) { // give it a good runic
                    theItem->enchant2 = rand_range(0, NUMBER_GOOD_ARMOR_ENCHANT_KINDS - 1);
                    theItem->flags |= ITEM_RUNIC;
                    if (theItem->enchant2 == A_IMMUNITY) {
                        theItem->vorpalEnemy = chooseVorpalEnemy();
                    }
                } else {
                    while (rand_percent(10)) {
                        theItem->enchant1++;
                    }
                }
            }
            break;

}}

int main(void) {
    int category,kind,depth;
    while(scanf("%d %d %d %d",&category,&kind,&depth,&length)==4) {
        for(int j=0;j<length;j++)assert(scanf("%ld",&tape[j])==1);
        count=0; rogue.depthLevel=depth; item i={0}; i.quantity=1; i.vorpalEnemy=-1;
        if(category<0)i.vorpalEnemy=chooseVorpalEnemy();else equipment(&i,category?ARMOR:WEAPON,kind);
        printf("{\"enchantment\":%d,\"runicIndex\":%d,\"isCursed\":%s,\"vorpalIndex\":%d,\"quantity\":%d,\"quiverNumber\":%d,\"charges\":%d,\"strength\":%d,\"draws\":[",
            i.enchant1,(i.flags&ITEM_RUNIC)?i.enchant2:-1,(i.flags&ITEM_CURSED)?"true":"false",i.vorpalEnemy,i.quantity,i.quiverNumber,i.charges,i.strengthRequired);
        for(int j=0;j<count;j++)printf("%s[%ld,%ld,%ld]",j?",":"",calls[j][0],calls[j][1],calls[j][2]);
        puts("]}");
    }
}
