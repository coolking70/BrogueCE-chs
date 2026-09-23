#include <stdio.h>
typedef int boolean;
typedef struct { short currentHP; struct { short maxHP; } info; } creature;
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define clamp(a,b,c) min(c,max(b,a))
static int roll;
int rand_range(int lo, int hi) { (void)lo; (void)hi; return roll; }
short wandDominate(creature *monst)                 {return (((monst)->currentHP * 5 < (monst)->info.maxHP) ? 100 : \
                                                     max(0, 100 * ((monst)->info.maxHP - (monst)->currentHP) / (monst)->info.maxHP));}
boolean rand_percent(short percent) {
    return (rand_range(0, 99) < clamp(percent, 0, 100));
}
int main(void) {
  int maxima[]={3,5,7,25,99,100,101,137};
  for (unsigned i=0;i<sizeof(maxima)/sizeof(maxima[0]);i++) {
    creature m={.info.maxHP=maxima[i]};
    for(int hp=1;hp<=maxima[i]+1;hp++) {
      m.currentHP=hp;int chance=wandDominate(&m),successes=0;
      for(roll=0;roll<100;roll++) successes+=rand_percent(chance);
      printf("%d %d %d %d\n",hp,maxima[i],chance,successes);
    }
  }
}
