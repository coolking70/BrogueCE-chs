#include <stdio.h>
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define true 1
#define COLS 100
typedef int boolean;
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
typedef struct {short lowerBound,upperBound,clumpFactor;} range;
typedef struct {short maxHP,defense,accuracy;range damage;} creatureType;
typedef struct {creatureType info;short currentHP,newPowerCount,totalPowerCount,status[NUMBER_OF_STATUS_EFFECTS],maxStatus[NUMBER_OF_STATUS_EFFECTS],poisonAmount,weaknessAmount;} creature;
creature player;int advancementMessageColor,encumbrance,light,vision;
int canSeeMonster(creature *m){return 0;}
int canDirectlySeeMonster(creature *m){return 0;}
void monsterName(char *s,creature *m,int article){}
void combatMessage(char *s,void *color){}
void updateEncumbrance(void){encumbrance++;}
void updateMinersLightRadius(void){light++;}
void updateVision(int n){vision++;}
void heal(creature *monst, short percent, boolean panacea) {
    char buf[COLS], monstName[COLS];
    monst->currentHP = min(monst->info.maxHP, monst->currentHP + percent * monst->info.maxHP / 100);
    if (panacea) {
        if (monst->status[STATUS_HALLUCINATING] > 1) {
            monst->status[STATUS_HALLUCINATING] = 1;
        }
        if (monst->status[STATUS_CONFUSED] > 1) {
            monst->status[STATUS_CONFUSED] = 1;
        }
        if (monst->status[STATUS_NAUSEOUS] > 1) {
            monst->status[STATUS_NAUSEOUS] = 1;
        }
        if (monst->status[STATUS_SLOWED] > 1) {
            monst->status[STATUS_SLOWED] = 1;
        }
        if (monst->status[STATUS_WEAKENED] > 1) {
            monst->weaknessAmount = 0;
            monst->status[STATUS_WEAKENED] = 0;
            updateEncumbrance();
        }
        if (monst->status[STATUS_POISONED]) {
            monst->poisonAmount = 0;
            monst->status[STATUS_POISONED] = 0;
        }
        if (monst->status[STATUS_DARKNESS] > 0) {
            monst->status[STATUS_DARKNESS] = 0;
            if (monst == &player) {
                updateMinersLightRadius();
                updateVision(true);
            }
        }
    }
    if (canDirectlySeeMonster(monst)
        && monst != &player
        && !panacea) {

        monsterName(monstName, monst, true);
        sprintf(buf, "%s looks healthier", monstName);
        combatMessage(buf, NULL);
    }
}
void empowerMonster(creature *monst) {
    char theMonsterName[100], buf[200];
    monst->info.maxHP += 12;
    monst->info.defense += 10;
    monst->info.accuracy += 10;
    monst->info.damage.lowerBound += max(1, monst->info.damage.lowerBound / 10);
    monst->info.damage.upperBound += max(1, monst->info.damage.upperBound / 10);
    monst->newPowerCount++;
    monst->totalPowerCount++;
    heal(monst, 100, true);

    if (canSeeMonster(monst)) {
        monsterName(theMonsterName, monst, true);
        sprintf(buf, "%s looks stronger", theMonsterName);
        combatMessage(buf, &advancementMessageColor);
    }
}
int main(void){
 int bounds[]={0,1,9,10,19,20,29,99,137};
 for(int a=0;a<9;a++)for(int b=a;b<9;b++){
  creature m={0};m.info=(creatureType){37,17,85,{bounds[a],bounds[b],3}};m.currentHP=1;
  for(int n=1;n<=12;n++){empowerMonster(&m);printf("empower %d %d %d %d %d %d %d %d %d %d %d %d\n",bounds[a],bounds[b],n,m.info.maxHP,m.currentHP,m.info.defense,m.info.accuracy,m.info.damage.lowerBound,m.info.damage.upperBound,m.info.damage.clumpFactor,m.newPowerCount,m.totalPowerCount);}
 }
 for(int t=0;t<=3;t++){
  creature m={0};m.info.maxHP=37;m.currentHP=1;m.poisonAmount=4;m.weaknessAmount=5;
  for(int j=0;j<NUMBER_OF_STATUS_EFFECTS;j++){m.status[j]=t;m.maxStatus[j]=20;}
  heal(&m,100,1);printf("heal %d %d %d %d",t,m.currentHP,m.poisonAmount,m.weaknessAmount);
  for(int j=0;j<NUMBER_OF_STATUS_EFFECTS;j++)printf(" %d",m.status[j]);
  for(int j=0;j<NUMBER_OF_STATUS_EFFECTS;j++)printf(" %d",m.maxStatus[j]);printf("\n");
 }
 player.info.maxHP=37;player.status[STATUS_DARKNESS]=3;heal(&player,100,1);printf("player-darkness %d %d %d\n",player.status[STATUS_DARKNESS],light,vision);
}
