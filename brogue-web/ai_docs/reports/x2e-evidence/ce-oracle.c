
#include <stdio.h>
#include <stdint.h>
#define FP_FACTOR 65536LL
#define FP_DIV(a,b) ((a)*FP_FACTOR/(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define clamp(x,a,b) min(max(x,a),b)
#define LAST_INDEX(a) (sizeof(a)/sizeof((a)[0])-1)
#define CHARM_EFFECT_DURATION_INCREMENT_ARRAY_SIZE 50
typedef int64_t fixpt;

enum {CHARM_HEALTH,CHARM_PROTECTION,CHARM_HASTE,CHARM_FIRE_IMMUNITY,CHARM_INVISIBILITY,CHARM_TELEPATHY,CHARM_LEVITATION,CHARM_SHATTERING,CHARM_GUARDIAN,CHARM_TELEPORTATION,CHARM_RECHARGING,CHARM_NEGATION};
typedef struct charmEffectTableEntry {
    const short kind;
    const int effectDurationBase;
    const fixpt *effectDurationIncrement;
    const int rechargeDelayDuration;
    const int rechargeDelayBase;
    const int rechargeDelayMinTurns;
    const int effectMagnitudeConstant;
    const int effectMagnitudeMultiplier;
} charmEffectTableEntry;
const fixpt POW_0_CHARM_INCREMENT[] = { // 1.0
    65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536,
    65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536,
    65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536};
const fixpt POW_120_CHARM_INCREMENT[] = { // 1.20^x fixed point, with x from 1 to 50 in increments of 1:
    78643, 94371, 113246, 135895, 163074, 195689, 234827, 281792, 338151, 405781, 486937, 584325, 701190, 841428, 1009714, 1211657,
    1453988, 1744786, 2093744, 2512492, 3014991, 3617989, 4341587, 5209905, 6251886, 7502263, 9002716, 10803259, 12963911, 15556694,
    18668032, 22401639, 26881967, 32258360, 38710033, 46452039, 55742447, 66890937, 80269124, 96322949, 115587539, 138705047, 166446056,
    199735268, 239682321, 287618785, 345142543, 414171051, 497005262, 596406314, 715687577};
const fixpt POW_125_CHARM_INCREMENT[] = { // 1.25^x fixed point, with x from 1 to 50 in increments of 1:
    81920, 102400, 128000, 160000, 200000, 250000, 312500, 390625, 488281, 610351, 762939, 953674, 1192092, 1490116, 1862645, 2328306,
    2910383, 3637978, 4547473, 5684341, 7105427, 8881784, 11102230, 13877787, 17347234, 21684043, 27105054, 33881317, 42351647, 52939559,
    66174449, 82718061, 103397576, 129246970, 161558713, 201948391, 252435489, 315544362, 394430452, 493038065, 616297582, 770371977,
    962964972, 1203706215, 1504632769, 1880790961, 2350988701, 2938735877, 3673419846, 4591774807, 5739718509};
const charmEffectTableEntry charmEffectTable_Brogue[] = {
    { .kind = CHARM_HEALTH, .effectDurationBase = 3, .effectDurationIncrement = POW_0_CHARM_INCREMENT, .rechargeDelayDuration = 2500, .rechargeDelayBase = FP_FACTOR * 55 / 100, .rechargeDelayMinTurns = 1, .effectMagnitudeMultiplier = 20 },
    { .kind = CHARM_PROTECTION, .effectDurationBase = 20, .effectDurationIncrement = POW_0_CHARM_INCREMENT, .rechargeDelayDuration = 1000, .rechargeDelayBase = FP_FACTOR * 60 / 100, .rechargeDelayMinTurns = 1, .effectMagnitudeMultiplier = 150 },
    { .kind = CHARM_HASTE, .effectDurationBase = 7, .effectDurationIncrement = POW_120_CHARM_INCREMENT, .rechargeDelayDuration = 800, .rechargeDelayBase = FP_FACTOR * 65 / 100, .rechargeDelayMinTurns = 1 },
    { .kind = CHARM_FIRE_IMMUNITY, .effectDurationBase = 10, .effectDurationIncrement = POW_125_CHARM_INCREMENT, .rechargeDelayDuration = 800, .rechargeDelayBase = FP_FACTOR * 60 / 100, .rechargeDelayMinTurns = 1 },
    { .kind = CHARM_INVISIBILITY, .effectDurationBase = 5, .effectDurationIncrement = POW_120_CHARM_INCREMENT, .rechargeDelayDuration = 800, .rechargeDelayBase = FP_FACTOR * 65 / 100, .rechargeDelayMinTurns = 1 },
    { .kind = CHARM_TELEPATHY, .effectDurationBase = 25, .effectDurationIncrement = POW_125_CHARM_INCREMENT, .rechargeDelayDuration = 800, .rechargeDelayBase = FP_FACTOR * 65 / 100, .rechargeDelayMinTurns = 1 },
    { .kind = CHARM_LEVITATION, .effectDurationBase = 10, .effectDurationIncrement = POW_125_CHARM_INCREMENT, .rechargeDelayDuration = 800, .rechargeDelayBase = FP_FACTOR * 65 / 100, .rechargeDelayMinTurns = 1 },
    { .kind = CHARM_SHATTERING, .effectDurationBase = 0, .effectDurationIncrement = POW_0_CHARM_INCREMENT, .rechargeDelayDuration = 2500, .rechargeDelayBase = FP_FACTOR * 60 / 100, .rechargeDelayMinTurns = 1, .effectMagnitudeConstant = 4 },
    { .kind = CHARM_GUARDIAN, .effectDurationBase = 18, .effectDurationIncrement = POW_0_CHARM_INCREMENT, .rechargeDelayDuration = 700, .rechargeDelayBase = FP_FACTOR * 70 / 100, .rechargeDelayMinTurns = 1, .effectMagnitudeConstant = 4, .effectMagnitudeMultiplier = 2 },
    { .kind = CHARM_TELEPORTATION, .effectDurationBase = 0, .effectDurationIncrement = POW_0_CHARM_INCREMENT, .rechargeDelayDuration = 920, .rechargeDelayBase = FP_FACTOR * 60 / 100, .rechargeDelayMinTurns = 1 },
    { .kind = CHARM_RECHARGING, .effectDurationBase = 0, .effectDurationIncrement = POW_0_CHARM_INCREMENT, .rechargeDelayDuration = 10000, .rechargeDelayBase = FP_FACTOR * 55 / 100, .rechargeDelayMinTurns = 1 },
    { .kind = CHARM_NEGATION, .effectDurationBase = 0, .effectDurationIncrement = POW_0_CHARM_INCREMENT, .rechargeDelayDuration = 2500, .rechargeDelayBase = FP_FACTOR * 60 / 100, .rechargeDelayMinTurns = 1, .effectMagnitudeConstant = 1, .effectMagnitudeMultiplier = 3 }
};
const charmEffectTableEntry *charmEffectTable = charmEffectTable_Brogue;
fixpt fp_round(fixpt x) {
    long long div = x / FP_FACTOR, rem = x % FP_FACTOR;
    int sign = (x >= 0) - (x < 0);

    if (rem >= FP_FACTOR / 2 || rem <= -FP_FACTOR / 2) {
        return div + sign;
    } else {
        return div;
    }
}
fixpt fp_pow(fixpt base, int expn) {
    if (base == 0) return 0;

    if (expn < 0) {
        base = FP_DIV(FP_FACTOR, base);
        expn = -expn;
    }

    fixpt res = FP_FACTOR, err = 0;
    while (expn--) {
        res = res * base + (err * base) / FP_FACTOR;
        err = res % FP_FACTOR;
        res /= FP_FACTOR;
    }

    return res + fp_round(err);
}
short charmHealing(fixpt enchant)              {return ((int) clamp(charmEffectTable[CHARM_HEALTH].effectMagnitudeMultiplier * (enchant) / FP_FACTOR, 0, 100));}
short charmShattering(fixpt enchant)           {return ((int) (charmEffectTable[CHARM_SHATTERING].effectMagnitudeConstant + (enchant / FP_FACTOR)));}
short charmGuardianLifespan(fixpt enchant)     {return ((int) (charmEffectTable[CHARM_GUARDIAN].effectMagnitudeConstant + charmEffectTable[CHARM_GUARDIAN].effectMagnitudeMultiplier * (enchant / FP_FACTOR)));}
short charmNegationRadius(fixpt enchant)       {return ((int) (charmEffectTable[CHARM_NEGATION].effectMagnitudeConstant + charmEffectTable[CHARM_NEGATION].effectMagnitudeMultiplier * (enchant / FP_FACTOR)));}
int charmProtection(fixpt enchant) {
    const fixpt POW_CHARM_PROTECTION[] = {
        // 1.35^x fixed point, with x from 0 to 50 in increments of 1:
        65536, 88473, 119439, 161243, 217678, 293865, 396718, 535570, 723019, 976076, 1317703, 1778899, 2401514, 3242044, 4376759, 5908625, 7976644, 10768469,
        14537434, 19625536, 26494473, 35767539, 48286178, 65186341, 88001560, 118802106, 160382844, 216516839, 292297733, 394601940, 532712620, 719162037, 970868750,
        1310672812, 1769408297, 2388701201, 3224746621, 4353407939, 5877100717, 7934085969, 10711016058, 14459871678, 19520826766, 26353116134, 35576706781,
        48028554155, 64838548109, 87532039948, 118168253930, 159527142806, 215361642788};

    short idx = clamp(enchant / FP_FACTOR - 1, 0, LAST_INDEX(POW_CHARM_PROTECTION));
    return charmEffectTable[CHARM_PROTECTION].effectMagnitudeMultiplier * POW_CHARM_PROTECTION[idx] / FP_FACTOR;
}
short charmEffectDuration(short charmKind, short enchant) {

    short idx = clamp(enchant - 1, 0, CHARM_EFFECT_DURATION_INCREMENT_ARRAY_SIZE - 1);
    return charmEffectTable[charmKind].effectDurationBase * charmEffectTable[charmKind].effectDurationIncrement[idx] / FP_FACTOR;
}
short charmRechargeDelay(short charmKind, short enchant) {

    enchant = clamp(enchant, 1, 50);
    short delay = charmEffectDuration(charmKind, enchant)
        + (charmEffectTable[charmKind].rechargeDelayDuration * fp_pow(charmEffectTable[charmKind].rechargeDelayBase, enchant) / FP_FACTOR);
    return max(charmEffectTable[charmKind].rechargeDelayMinTurns, delay);
}

int main(void) {
  puts("["); int sep=0;
  for (int k=0; k<12; k++) for (int e=0; e<=51; e++) {
    int magnitude = k==CHARM_HEALTH ? charmHealing(e*FP_FACTOR)
      : k==CHARM_PROTECTION ? charmProtection(e*FP_FACTOR)
      : k==CHARM_SHATTERING ? charmShattering(e*FP_FACTOR)
      : k==CHARM_GUARDIAN ? charmGuardianLifespan(e*FP_FACTOR)
      : k==CHARM_NEGATION ? charmNegationRadius(e*FP_FACTOR) : 0;
    printf("%s{\"kind\":%d,\"enchant\":%d,\"duration\":%d,\"recharge\":%d,\"magnitude\":%d}",
      sep++?",\n":"",k,e,charmEffectDuration(k,e),charmRechargeDelay(k,e),magnitude);
  }
  puts("\n]");
}

