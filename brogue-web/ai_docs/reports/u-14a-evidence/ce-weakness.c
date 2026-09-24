#include <stdio.h>
#include <stdbool.h>
typedef long long fixpt;
#define FP_BASE 16
#define FP_FACTOR (1LL << FP_BASE)
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define clamp(x,lo,hi) min(max(x,lo),hi)
#define LAST_INDEX(a) (sizeof(a)/sizeof(a[0])-1)
enum { WEAPON=1, ARMOR=2, STATUS_DONNING=0 };
typedef struct {short lowerBound,upperBound,clumpFactor;} randomRange;
typedef struct {int category,strengthRequired,enchant1,armor;randomRange damage;} item;
typedef struct {struct {short accuracy,defense;randomRange damage;} info;short weaknessAmount,status[1];} creature;
creature player;
struct {int strength;item *weapon,*armor;} rogue;
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
short monsterAccuracyAdjusted(const creature *monst) {
  short retval = monst->info.accuracy *
                 accuracyFraction(monst->weaknessAmount * FP_FACTOR * -3 / 2) /
                 FP_FACTOR;
  return max(retval, 0);
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
 item weapon={.category=WEAPON,.strengthRequired=17,.enchant1=2,.damage={10,20,2}};
 item armor={.category=ARMOR,.strengthRequired=17,.enchant1=2,.armor=40};
 rogue.strength=18;rogue.weapon=&weapon;rogue.armor=&armor;
 for(int w=0;w<=10;w++) {
  creature m={.info={.accuracy=120,.defense=160},.weaknessAmount=w};
  player.weaknessAmount=w;recalculateEquipmentBonuses();
  printf("%d %lld %d %d %lld %lld %d %d %d %d\n",w,monsterDamageAdjustmentAmount(&m),monsterAccuracyAdjusted(&m),monsterDefenseAdjusted(&m),strengthModifier(&weapon),netEnchant(&weapon),player.info.damage.lowerBound,player.info.damage.upperBound,player.info.defense,12+2*max(rogue.strength-player.weaknessAmount-12,2));
 }
}
