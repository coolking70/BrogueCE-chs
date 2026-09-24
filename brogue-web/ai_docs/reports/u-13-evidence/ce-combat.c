#include <stdio.h>
#include <stdbool.h>
#include <string.h>
typedef long long fixpt;
#define FP_BASE 16 // Don't change this without recalculating all of the power tables throughout the code!
#define FP_FACTOR (1LL << FP_BASE)
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define clamp(x,lo,hi) min(max(x,lo),hi)
#define LAST_INDEX(a) (sizeof(a)/sizeof(a[0])-1)
typedef bool boolean;
enum { WEAPON=1, ARMOR=2, ITEM_RUNIC=4, W_SLAYING=5 };
enum { STATUS_STUCK, STATUS_PARALYZED, STATUS_DONNING };
enum { MB_CAPTIVE=1, MB_SEIZED=2, MB_SEIZING=4 };
typedef struct {short lowerBound, upperBound, clumpFactor;} randomRange;
typedef struct {int category, strengthRequired, enchant1, flags, enchant2, vorpalEnemy, armor; randomRange damage;} item;
typedef struct {struct {short accuracy, defense; randomRange damage;} info; short weaknessAmount, status[3]; int bookkeepingFlags;} creature;
creature player;
struct {int strength; item *weapon, *armor;} rogue;
boolean monsterIsInClass(creature *m, int c) {(void)m;(void)c;return false;}
long tuple; int calls, lows[16], highs[16];
long rand_range(long lo, long hi) {
    lows[calls]=lo; highs[calls++]=hi;
    if(hi<=lo)return lo;
    long n=lo+tuple%(hi-lo+1); tuple/=hi-lo+1; return n;
}
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
fixpt damageFraction(fixpt netEnchant) {
    const fixpt POW_DAMAGE_FRACTION[] = {
        // 1.065^x fixed point, with x representing a change in 0.25 weapon enchantment points, ranging from -20 to 50.
        18598, 18894, 19193, 19498, 19807, 20122, 20441, 20765, 21095, 21430, 21770, 22115, 22466, 22823, 23185, 23553, 23926, 24306, 24692, 25084, 25482, 25886,
        26297, 26714, 27138, 27569, 28006, 28451, 28902, 29361, 29827, 30300, 30781, 31269, 31765, 32269, 32781, 33302, 33830, 34367, 34912, 35466, 36029, 36601,
        37182, 37772, 38371, 38980, 39598, 40227, 40865, 41514, 42172, 42842, 43521, 44212, 44914, 45626, 46350, 47086, 47833, 48592, 49363, 50146, 50942, 51751,
        52572, 53406, 54253, 55114, 55989, 56877, 57780, 58697, 59628, 60574, 61536, 62512, 63504, 64512, 65536, 66575, 67632, 68705, 69795, 70903, 72028, 73171,
        74332, 75512, 76710, 77927, 79164, 80420, 81696, 82992, 84309, 85647, 87006, 88387, 89789, 91214, 92662, 94132, 95626, 97143, 98685, 100251, 101842, 103458,
        105099, 106767, 108461, 110182, 111931, 113707, 115511, 117344, 119206, 121098, 123020, 124972, 126955, 128969, 131016, 133095, 135207, 137352, 139532,
        141746, 143995, 146280, 148602, 150960, 153355, 155789, 158261, 160772, 163323, 165915, 168548, 171222, 173939, 176699, 179503, 182352, 185245, 188185,
        191171, 194205, 197286, 200417, 203597, 206828, 210110, 213444, 216831, 220272, 223767, 227318, 230925, 234589, 238312, 242094, 245935, 249838, 253802,
        257830, 261921, 266077, 270300, 274589, 278946, 283372, 287869, 292437, 297078, 301792, 306581, 311445, 316388, 321408, 326508, 331689, 336953, 342300,
        347731, 353249, 358855, 364549, 370334, 376211, 382180, 388245, 394406, 400664, 407022, 413481, 420042, 426707, 433479, 440357, 447345, 454443, 461655,
        468980, 476422, 483982, 491662, 499464, 507390, 515441, 523620, 531929, 540370, 548945, 557656, 566505, 575494, 584626, 593903, 603328, 612901, 622627,
        632507, 642544, 652740, 663098, 673620, 684309, 695168, 706199, 717406, 728790, 740354, 752102, 764037, 776161, 788477, 800989, 813699, 826611, 839728,
        853053, 866590, 880341, 894311, 908502, 922918, 937563, 952441, 967555, 982908, 998505, 1014350, 1030446, 1046797, 1063408, 1080282, 1097425, 1114839,
        1132529, 1150501, 1168757, 1187303, 1206144, 1225283, 1244726, 1264478, 1284543, 1304927, 1325634, 1346669, 1368039, 1389747, 1411800, 1434203, 1456961,
        1480081, 1503567, 1527426};

    short idx = clamp(netEnchant * 4 / FP_FACTOR + 80, 0, LAST_INDEX(POW_DAMAGE_FRACTION));
    return POW_DAMAGE_FRACTION[idx];
}
fixpt accuracyFraction(fixpt netEnchant) {
    const fixpt POW_ACCURACY_FRACTION[] = {
        // 1.065^x fixed point, with x representing a change in 0.25 weapon enchantment points (as displayed), ranging from -20 to 50.
        18598, 18894, 19193, 19498, 19807, 20122, 20441, 20765, 21095, 21430, 21770, 22115, 22466, 22823, 23185, 23553, 23926, 24306, 24692, 25084, 25482, 25886,
        26297, 26714, 27138, 27569, 28006, 28451, 28902, 29361, 29827, 30300, 30781, 31269, 31765, 32269, 32781, 33302, 33830, 34367, 34912, 35466, 36029, 36601,
        37182, 37772, 38371, 38980, 39598, 40227, 40865, 41514, 42172, 42842, 43521, 44212, 44914, 45626, 46350, 47086, 47833, 48592, 49363, 50146, 50942, 51751,
        52572, 53406, 54253, 55114, 55989, 56877, 57780, 58697, 59628, 60574, 61536, 62512, 63504, 64512, 65536, 66575, 67632, 68705, 69795, 70903, 72028, 73171,
        74332, 75512, 76710, 77927, 79164, 80420, 81696, 82992, 84309, 85647, 87006, 88387, 89789, 91214, 92662, 94132, 95626, 97143, 98685, 100251, 101842, 103458,
        105099, 106767, 108461, 110182, 111931, 113707, 115511, 117344, 119206, 121098, 123020, 124972, 126955, 128969, 131016, 133095, 135207, 137352, 139532,
        141746, 143995, 146280, 148602, 150960, 153355, 155789, 158261, 160772, 163323, 165915, 168548, 171222, 173939, 176699, 179503, 182352, 185245, 188185,
        191171, 194205, 197286, 200417, 203597, 206828, 210110, 213444, 216831, 220272, 223767, 227318, 230925, 234589, 238312, 242094, 245935, 249838, 253802,
        257830, 261921, 266077, 270300, 274589, 278946, 283372, 287869, 292437, 297078, 301792, 306581, 311445, 316388, 321408, 326508, 331689, 336953, 342300,
        347731, 353249, 358855, 364549, 370334, 376211, 382180, 388245, 394406, 400664, 407022, 413481, 420042, 426707, 433479, 440357, 447345, 454443, 461655,
        468980, 476422, 483982, 491662, 499464, 507390, 515441, 523620, 531929, 540370, 548945, 557656, 566505, 575494, 584626, 593903, 603328, 612901, 622627,
        632507, 642544, 652740, 663098, 673620, 684309, 695168, 706199, 717406, 728790, 740354, 752102, 764037, 776161, 788477, 800989, 813699, 826611, 839728,
        853053, 866590, 880341, 894311, 908502, 922918, 937563, 952441, 967555, 982908, 998505, 1014350, 1030446, 1046797, 1063408, 1080282, 1097425, 1114839,
        1132529, 1150501, 1168757, 1187303, 1206144, 1225283, 1244726, 1264478, 1284543, 1304927, 1325634, 1346669, 1368039, 1389747, 1411800, 1434203, 1456961,
        1480081, 1503567, 1527426};

    short idx = clamp(netEnchant * 4 / FP_FACTOR + 80, 0, LAST_INDEX(POW_ACCURACY_FRACTION));
    return POW_ACCURACY_FRACTION[idx];
}
fixpt defenseFraction(fixpt netDefense) {
    const fixpt POW_DEFENSE_FRACTION[] = {
        // 0.877347265^x fixed point, with x representing a change in 0.25 armor points (as displayed), ranging from -20 to 50.
        897530, 868644, 840688, 813632, 787446, 762103, 737575, 713837, 690863, 668629, 647110, 626283, 606127, 586619, 567740, 549468,
        531784, 514669, 498105, 482074, 466559, 451543, 437011, 422946, 409334, 396160, 383410, 371071, 359128, 347570, 336384, 325558,
        315080, 304940, 295125, 285627, 276435, 267538, 258927, 250594, 242529, 234724, 227169, 219858, 212782, 205934, 199306, 192892,
        186684, 180676, 174861, 169233, 163786, 158515, 153414, 148476, 143698, 139073, 134597, 130265, 126073, 122015, 118088, 114288,
        110609, 107050, 103604, 100270, 97043, 93920, 90897, 87971, 85140, 82400, 79748, 77181, 74697, 72293, 69967, 67715, 65536, 63426,
        61385, 59409, 57497, 55647, 53856, 52123, 50445, 48822, 47250, 45730, 44258, 42833, 41455, 40121, 38829, 37580, 36370, 35200, 34067,
        32970, 31909, 30882, 29888, 28926, 27995, 27094, 26222, 25378, 24562, 23771, 23006, 22266, 21549, 20855, 20184, 19535, 18906, 18297,
        17709, 17139, 16587, 16053, 15536, 15036, 14552, 14084, 13631, 13192, 12768, 12357, 11959, 11574, 11201, 10841, 10492, 10154, 9828,
        9511, 9205, 8909, 8622, 8345, 8076, 7816, 7565, 7321, 7085, 6857, 6637, 6423, 6216, 6016, 5823, 5635, 5454, 5278, 5108, 4944, 4785,
        4631, 4482, 4337, 4198, 4063, 3932, 3805, 3683, 3564, 3450, 3339, 3231, 3127, 3026, 2929, 2835, 2744, 2655, 2570, 2487, 2407, 2329,
        2255, 2182, 2112, 2044, 1978, 1914, 1853, 1793, 1735, 1679, 1625, 1573, 1522, 1473, 1426, 1380, 1336, 1293, 1251, 1211, 1172, 1134,
        1097, 1062, 1028, 995, 963, 932, 902, 873, 845, 817, 791, 766, 741, 717, 694, 672, 650, 629, 609, 589, 570, 552, 534, 517, 500, 484,
        469, 453, 439, 425, 411, 398, 385, 373, 361, 349, 338, 327, 316, 306, 296, 287, 277, 268, 260, 251, 243, 235, 228, 221, 213, 207,
        200, 193, 187, 181, 175, 170, 164, 159, 154, 149, 144, 139, 135, 130, 126, 122, 118, 114, 111, 107, 104, 100, 97, 94};

    short idx = clamp(netDefense * 4 / 10 / FP_FACTOR + 80, 0, LAST_INDEX(POW_DEFENSE_FRACTION));
    return POW_DEFENSE_FRACTION[idx];
}
fixpt strengthModifier(item *theItem) {
  int difference =
      (rogue.strength - player.weaknessAmount) - theItem->strengthRequired;
  if (difference > 0) {
    return difference * FP_FACTOR / 4; // 0.25x
  } else {
    return difference * FP_FACTOR * 5 / 2; // 2.5x
  }
}
fixpt netEnchant(item *theItem) {
  fixpt retval = theItem->enchant1 * FP_FACTOR;
  if (theItem->category & (WEAPON | ARMOR)) {
    retval += strengthModifier(theItem);
  }
  // Clamp all net enchantment values to [-20, 50].
  return clamp(retval, -20 * FP_FACTOR, 50 * FP_FACTOR);
}
fixpt monsterDamageAdjustmentAmount(const creature *monst) {
  if (monst == &player) {
    // Handled through player strength routines elsewhere.
    return FP_FACTOR;
  } else {
    return damageFraction(monst->weaknessAmount * FP_FACTOR * -3 / 2);
  }
}
short monsterDefenseAdjusted(const creature *monst) {
  short retval;
  if (monst == &player) {
    // Weakness is already taken into account in recalculateEquipmentBonuses()
    // for the player.
    retval = monst->info.defense;
  } else {
    retval = monst->info.defense - 25 * monst->weaknessAmount;
  }
  return max(retval, 0);
}
short monsterAccuracyAdjusted(const creature *monst) {
  short retval = monst->info.accuracy *
                 accuracyFraction(monst->weaknessAmount * FP_FACTOR * -3 / 2) /
                 FP_FACTOR;
  return max(retval, 0);
}
short hitProbability(creature *attacker, creature *defender) {
  short accuracy = monsterAccuracyAdjusted(attacker);
  short defense = monsterDefenseAdjusted(defender);
  short hitProbability;

  if (defender->status[STATUS_STUCK] ||
      (defender->bookkeepingFlags & MB_CAPTIVE)) {
    return 100;
  }
  if ((defender->bookkeepingFlags & MB_SEIZED) &&
      (attacker->bookkeepingFlags & MB_SEIZING)) {

    return 100;
  }
  if (attacker == &player && rogue.weapon) {
    if ((rogue.weapon->flags & ITEM_RUNIC) &&
        rogue.weapon->enchant2 == W_SLAYING &&
        monsterIsInClass(defender, rogue.weapon->vorpalEnemy)) {

      return 100;
    }
    accuracy = player.info.accuracy *
               accuracyFraction(netEnchant(rogue.weapon)) / FP_FACTOR;
  }
  hitProbability = accuracy * defenseFraction(defense * FP_FACTOR) / FP_FACTOR;
  if (hitProbability > 100) {
    hitProbability = 100;
  } else if (hitProbability < 0) {
    hitProbability = 0;
  }
  return hitProbability;
}
boolean attackHit(creature *attacker, creature *defender) {
  // automatically hit if the monster is sleeping or captive or stuck in a web
  if (defender->status[STATUS_STUCK] || defender->status[STATUS_PARALYZED] ||
      (defender->bookkeepingFlags & MB_CAPTIVE)) {

    return true;
  }

  return rand_percent(hitProbability(attacker, defender));
}
void recalculateEquipmentBonuses() {
    fixpt enchant;
    item *theItem;
    if (rogue.weapon) {
        theItem = rogue.weapon;
        enchant = netEnchant(theItem);
        player.info.damage = theItem->damage;
        player.info.damage.lowerBound = player.info.damage.lowerBound * damageFraction(enchant) / FP_FACTOR;
        player.info.damage.upperBound = player.info.damage.upperBound * damageFraction(enchant) / FP_FACTOR;
        if (player.info.damage.lowerBound < 1) {
            player.info.damage.lowerBound = 1;
        }
        if (player.info.damage.upperBound < 1) {
            player.info.damage.upperBound = 1;
        }
    }

    if (rogue.armor) {
        theItem = rogue.armor;
        enchant = netEnchant(theItem);
        enchant -= player.status[STATUS_DONNING] * FP_FACTOR;
        player.info.defense = (theItem->armor * FP_FACTOR + enchant * 10) / FP_FACTOR;
        if (player.info.defense < 0) {
            player.info.defense = 0;
        }
    }
}
int main(void) {
    int accuracies[]={-1,0,1,50,75,88,100,125,5000,32767};
    int defenses[]={-32768,-1,0,1,2,3,5,10,12,20,32,100,500,1000,32767};
    for(int a=0;a<10;a++)for(int d=0;d<15;d++) {
        creature attacker={0},defender={0};attacker.info.accuracy=accuracies[a];defender.info.defense=defenses[d];
        printf("H %d %d 999 %d\n",accuracies[a],defenses[d],hitProbability(&attacker,&defender));
    }
    item weapon={.category=WEAPON};rogue.weapon=&weapon;rogue.strength=12;weapon.strengthRequired=12;player.info.accuracy=100;
    for(int e=-20;e<=50;e++)for(int d=0;d<15;d++) {
        weapon.enchant1=e;creature defender={0};defender.info.defense=defenses[d];
        printf("H 100 %d %d %d\n",defenses[d],e,hitProbability(&player,&defender));
    }
    for(int q=-80;q<=200;q++)printf("F %g %lld %lld\n",q/4.0,(long long)accuracyFraction(q*FP_FACTOR/4),(long long)damageFraction(q*FP_FACTOR/4));
    for(int d=-205;d<=505;d++)printf("D %d %lld\n",d,(long long)defenseFraction(d*FP_FACTOR));
    int base[][3]={{1,2,1},{3,4,1},{3,11,3},{25,35,3}},enchants[]={-20,-1,0,1,10,50};
    item armor={.category=ARMOR,.strengthRequired=12,.armor=30};rogue.armor=&armor;
    for(int b=0;b<4;b++)for(int e=0;e<6;e++)for(int strength=9;strength<=15;strength++) {
        weapon.damage=(randomRange){base[b][0],base[b][1],base[b][2]};
        weapon.enchant1=armor.enchant1=enchants[e];rogue.strength=strength;
        recalculateEquipmentBonuses();
        printf("E %d %d %d %d %d %d %d %d\n",base[b][0],base[b][1],base[b][2],enchants[e],strength,player.info.damage.lowerBound,player.info.damage.upperBound,player.info.defense);
    }
    int ranges[][3]={{1,2,1},{3,7,2},{9,13,2},{3,4,2},{10,15,3},{25,50,4},{0,10,3},{3,11,3},{0,0,0},{7,7,4},{9,3,2}};
    for(int i=0;i<11;i++) {
        int lo=ranges[i][0],hi=ranges[i][1],cl=ranges[i][2],counts[256]={0};calls=0;tuple=0;
        randClumpedRange(lo,hi,cl);long total=1;int dice=calls;
        printf("R %d %d %d %d",lo,hi,cl,dice);
        for(int j=0;j<dice;j++){total*=highs[j]-lows[j]+1;printf(" %d %d",lows[j],highs[j]);}
        for(long n=0;n<total;n++){tuple=n;calls=0;counts[randClumpedRange(lo,hi,cl)]++;}
        printf(" %ld",total);for(int v=lo;v<=max(lo,hi);v++)printf(" %d",counts[v]);printf("\n");
    }
}
