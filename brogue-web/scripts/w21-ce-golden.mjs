// Compile verbatim CE empowerMonster + heal; only world/UI dependencies are stubs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/w-21-evidence';fs.mkdirSync(dir,{recursive:true});
const read=n=>fs.readFileSync(`../BrogueCE-master/src/brogue/${n}`,'utf8');
const fn=(s,sig)=>{const start=s.indexOf(sig);if(start<0)throw Error(sig);const o=s.indexOf('{',start);let d=1,i=o+1;for(;d;i++){if(s[i]==='{')d++;if(s[i]==='}')d--;}return s.slice(start,i);};
const c=`#include <stdio.h>
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define true 1
#define COLS 100
typedef int boolean;
${fn(read('Rogue.h'),'enum statusEffects {')};
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
${fn(read('Items.c'),'void heal(creature *monst, short percent, boolean panacea) {')}
${fn(read('Monsters.c'),'void empowerMonster(creature *monst) {')}
int main(void){
 int bounds[]={0,1,9,10,19,20,29,99,137};
 for(int a=0;a<9;a++)for(int b=a;b<9;b++){
  creature m={0};m.info=(creatureType){37,17,85,{bounds[a],bounds[b],3}};m.currentHP=1;
  for(int n=1;n<=12;n++){empowerMonster(&m);printf("empower %d %d %d %d %d %d %d %d %d %d %d %d\\n",bounds[a],bounds[b],n,m.info.maxHP,m.currentHP,m.info.defense,m.info.accuracy,m.info.damage.lowerBound,m.info.damage.upperBound,m.info.damage.clumpFactor,m.newPowerCount,m.totalPowerCount);}
 }
 for(int t=0;t<=3;t++){
  creature m={0};m.info.maxHP=37;m.currentHP=1;m.poisonAmount=4;m.weaknessAmount=5;
  for(int j=0;j<NUMBER_OF_STATUS_EFFECTS;j++){m.status[j]=t;m.maxStatus[j]=20;}
  heal(&m,100,1);printf("heal %d %d %d %d",t,m.currentHP,m.poisonAmount,m.weaknessAmount);
  for(int j=0;j<NUMBER_OF_STATUS_EFFECTS;j++)printf(" %d",m.status[j]);
  for(int j=0;j<NUMBER_OF_STATUS_EFFECTS;j++)printf(" %d",m.maxStatus[j]);printf("\\n");
 }
 player.info.maxHP=37;player.status[STATUS_DARKNESS]=3;heal(&player,100,1);printf("player-darkness %d %d %d\\n",player.status[STATUS_DARKNESS],light,vision);
}
`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'w21-ce-'));
try{fs.writeFileSync(`${tmp}/golden.c`,c);execFileSync('clang',['-std=c11','-Wall','-Werror','-Wno-unused-parameter',`${tmp}/golden.c`,'-o',`${tmp}/golden`]);fs.writeFileSync(`${dir}/ce-empower.c`,c);fs.writeFileSync(`${dir}/ce-empower.txt`,execFileSync(`${tmp}/golden`));}
finally{fs.rmSync(tmp,{recursive:true,force:true});}
