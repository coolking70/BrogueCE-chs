
#include <stdio.h>
#include <stdint.h>
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define clamp(x,a,b) min(max(x,a),b)
#define LAST_INDEX(a) (sizeof(a)/sizeof((a)[0])-1)
#define FP_FACTOR 65536LL
#define STATUS_DARKNESS 0
#define DCOLS 100
#define STAFF 1
#define CHARM 2
#define STAFF_BLINKING 1
#define STAFF_OBSTRUCTION 2
#define false 0
typedef int64_t fixpt;
typedef struct item {unsigned short category; short kind,enchant1,enchant2,charges;struct item *nextItem;} item;
struct {int wisdomBonus,lightMultiplier,inWater;fixpt minersLightRadius;struct {int radialFadeToPercent;struct{int lowerBound,upperBound;}lightRadius;}minersLight;}rogue;
struct {int status[1],maxStatus[1];}player;
item head,*packItems=&head;
int calls=0,lo=0,hi=0;
int randClumpedRange(int a,int b,int c){calls++;lo=a;hi=b;return (a+b)/2;}
int charmRechargeDelay(int kind,int e){return 1000;}
void itemName(item*i,char*s,int a,int b,void*c){s[0]=0;}
void message(char*s,int a){}
fixpt ringWisdomMultiplier(fixpt enchant) {
    const fixpt POW_WISDOM[] = {
        // 1.3^x fixed point, with x from -10 to 30 in increments of 1:
        4753, 6180, 8034, 10444, 13577, 17650, 22945, 29829, 38778, 50412, 65536, 85196, 110755, 143982, 187177, 243330, 316329, 411228, 534597, 694976, 903469,
        1174510, 1526863, 1984922, 2580398, 3354518, 4360874, 5669136, 7369877, 9580840, 12455093, 16191620, 21049107, 27363839, 35572991, 46244888, 60118355,
        78153861, 101600020, 132080026, 171704034};

    short idx = clamp(min(27, enchant / FP_FACTOR) + 10, 0, LAST_INDEX(POW_WISDOM));
    return POW_WISDOM[idx];
}
short staffChargeDuration(const item *theItem) {
  // staffs of blinking and obstruction recharge half as fast so they're less
  // powerful
  return (theItem->kind == STAFF_BLINKING || theItem->kind == STAFF_OBSTRUCTION
              ? 10000
              : 5000) /
         theItem->enchant1;
}
void rechargeItemsIncrementally(short multiplier) {
  item *theItem;
  char buf[DCOLS * 3], theItemName[DCOLS * 3];
  short rechargeIncrement, staffRechargeDuration;

  if (rogue.wisdomBonus) {
    // at level 27, you recharge anything to full in one turn
    rechargeIncrement =
        10 * ringWisdomMultiplier(rogue.wisdomBonus * FP_FACTOR) / FP_FACTOR;
  } else {
    rechargeIncrement = 10;
  }

  rechargeIncrement *= multiplier;

  for (theItem = packItems->nextItem; theItem != NULL;
       theItem = theItem->nextItem) {
    if (theItem->category & STAFF) {
      if (theItem->charges < theItem->enchant1 && rechargeIncrement > 0 ||
          theItem->charges > 0 && rechargeIncrement < 0) {

        theItem->enchant2 -= rechargeIncrement;
      }
      staffRechargeDuration = staffChargeDuration(theItem);
      while (theItem->enchant2 <= 0) {
        // if it's time to add a staff charge
        if (theItem->charges < theItem->enchant1) {
          theItem->charges++;
        }
        theItem->enchant2 += randClumpedRange(max(staffRechargeDuration / 3, 1),
                                              staffRechargeDuration * 5 / 3, 3);
      }
      while (theItem->enchant2 > staffRechargeDuration * 5 / 3) {
        // if it's time to drain a staff charge
        if (theItem->charges > 0) {
          theItem->charges--;
        }
        theItem->enchant2 -= staffRechargeDuration;
      }
    } else if ((theItem->category & CHARM) && (theItem->charges > 0)) {
      theItem->charges =
          clamp(theItem->charges - multiplier, 0,
                charmRechargeDelay(theItem->kind, theItem->enchant1));
      if (theItem->charges == 0) {
        itemName(theItem, theItemName, false, false, NULL);
        sprintf(buf, "your %s has recharged.", theItemName);
        message(buf, 0);
      }
    }
  }
}
void updateMinersLightRadius() {
    fixpt base_fraction, fraction, lightRadius;

    lightRadius = 100 * rogue.minersLightRadius;

    if (rogue.lightMultiplier < 0) {
        lightRadius = lightRadius / (-1 * rogue.lightMultiplier + 1);
    } else {
        lightRadius *= rogue.lightMultiplier;
        lightRadius = max(lightRadius, (rogue.lightMultiplier * 2 + 2) * FP_FACTOR);
    }

    if (player.status[STATUS_DARKNESS]) {
        base_fraction = FP_FACTOR - player.status[STATUS_DARKNESS] * FP_FACTOR / player.maxStatus[STATUS_DARKNESS];
        fraction = (base_fraction * base_fraction / FP_FACTOR) * base_fraction / FP_FACTOR;
        //fraction = (double) pow(1.0 - (((double) player.status[STATUS_DARKNESS]) / player.maxStatus[STATUS_DARKNESS]), 3);
        if (fraction < FP_FACTOR / 20) {
            fraction = FP_FACTOR / 20;
        }
        lightRadius = lightRadius * fraction / FP_FACTOR;
    } else {
        fraction = FP_FACTOR;
    }

    if (lightRadius < 2 * FP_FACTOR) {
        lightRadius = 2 * FP_FACTOR;
    }

    if (rogue.inWater && lightRadius > 3 * FP_FACTOR) {
        lightRadius = max(lightRadius / 2, 3 * FP_FACTOR);
    }

    rogue.minersLight.radialFadeToPercent = 35 + (max(0, min(65, rogue.lightMultiplier * 5)) * fraction) / FP_FACTOR;
    rogue.minersLight.lightRadius.upperBound = rogue.minersLight.lightRadius.lowerBound = clamp(lightRadius / FP_FACTOR, -30000, 30000);
}
int main(){
 int bases[]={65536,123456,720896},lms[]={-4,-3,-2,-1,1,2,4,15},dark[]={0,5,20};
 puts("{\"light\":[");int sep=0;
 for(int b=0;b<3;b++)for(int l=0;l<8;l++)for(int d=0;d<3;d++)for(int w=0;w<2;w++){
 rogue.minersLightRadius=bases[b];rogue.lightMultiplier=lms[l];rogue.inWater=w;player.status[0]=dark[d];player.maxStatus[0]=20;updateMinersLightRadius();
 printf("%s[%d,%d,%d,%d,%d,%d]",sep++?",\n":"",bases[b],lms[l],dark[d],w,rogue.minersLight.lightRadius.lowerBound,rogue.minersLight.radialFadeToPercent);
 }
 puts("],\"recharge\":[");sep=0;
 int wis[]={-10,-2,0,1,5,27},mult[]={-3200,-3000,-100,-3,0,1,3,100,3200},timers[]={1,500,3000};
 for(int k=0;k<3;k++)for(int w=0;w<6;w++)for(int m=0;m<9;m++)for(int c=0;c<4;c++)for(int t=0;t<3;t++){
 item a={STAFF,k,3,timers[t],c,NULL};head.nextItem=&a;rogue.wisdomBonus=wis[w];calls=0;lo=hi=0;
 rechargeItemsIncrementally(mult[m]);
 printf("%s[%d,%d,%d,%d,%d,%d,%d,%d,%d,%d]",sep++?",\n":"",k,wis[w],mult[m],c,timers[t],a.charges,a.enchant2,calls,lo,hi);
 }
 puts("]}");return 0;
}
