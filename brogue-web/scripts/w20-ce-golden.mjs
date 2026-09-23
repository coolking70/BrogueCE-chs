// Extract original cloneMonster and BE_PLENTY code. Stub placement/allocation/UI;
// the golden verifies copy/exception/HP semantics, not CE's generator RNG stream.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/w-20-evidence';fs.mkdirSync(dir,{recursive:true});
const read=n=>fs.readFileSync(`../BrogueCE-master/src/brogue/${n}`,'utf8');
const fn=(s,sig)=>{const start=s.indexOf(sig);if(start<0)throw Error(sig);const o=s.indexOf('{',start);let d=1,i=o+1;for(;d;i++){if(s[i]==='{')d++;if(s[i]==='}')d--;}return s.slice(start,i);};
const mc=read('Monsters.c'),ic=read('Items.c'),h=read('Rogue.h');
const enums=['monsterBehaviorFlags','monsterAbilityFlags'].map(n=>fn(h,`enum ${n} {`)+';').join('\n');
const plenty=ic.slice(ic.indexOf('            case BE_PLENTY:'),ic.indexOf('            case BE_DISCORD:',ic.indexOf('            case BE_PLENTY:')));
const c=`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define Fl(n) (1UL<<(n))
#define true 1
#define false 0
#define DCOLS 100
#define MB_LEADER 1
#define MB_CAPTIVE 2
#define MB_WEAPON_AUTO_ID 4
#define MB_FOLLOWER 8
#define MB_TELEPATHICALLY_REVEALED 16
#define HAS_MONSTER 1
#define HAS_PLAYER 2
#define HAS_STAIRS 4
#define T_DIVIDES_LEVEL 7
#define FEAT_JELLYMANCER 0
#define MONSTER_ALLY 3
#define BOLT_PLENTY 0
#define BE_PLENTY 0
${enums}
typedef int boolean;
typedef struct {int x,y;} pos;
typedef struct {short lowerBound,upperBound,clumpFactor;} range;
typedef struct {int monsterID;void *foreColor;range damage;short defense;char monsterName[100];unsigned long flags,abilityFlags;} creatureType;
typedef struct creature {creatureType info;struct creature *leader,*carriedMonster;void *carriedItem,*mapToMe,*safetyMap;unsigned long bookkeepingFlags;short currentHP,ticksUntilTurn;int creatureState;pos loc;short status[8];} creature;
creature player,*monsters[100],*dormantMonsters[100];int allocated=0,gray;struct {int featRecord[1];} rogue;
struct {void *backColor;} boltCatalog[1];
struct cell {int flags;} cell;
struct cell *pmapAt(pos p){return &cell;}
creature *generateMonster(int kind,int item,int mutation){creature *c=calloc(1,sizeof(creature));monsters[allocated++]=c;return c;}
int rand_percent(int p){return 0;}
void removeCreature(creature **list,creature *c){for(int i=0;i<allocated;i++)if(list[i]==c)list[i]=NULL;}
void becomeAllyWith(creature *c){c->creatureState=MONSTER_ALLY;c->leader=&player;c->bookkeepingFlags&=~MB_CAPTIVE;}
int avoidedFlagsForMonster(creatureType *t){return 0;}
pos getQualifyingPathLocNear(pos p,int a,int b,int d,int e,int f,int g){return (pos){p.x+1,p.y};}
void refreshDungeonCell(pos p){}
int canSeeMonster(creature *c){return 0;}
void monsterName(char *b,creature *c,int article){strcpy(b,"rat");}
void message(char *b,int n){}
void flashMonster(creature *c,void *color,int n){}
typedef struct {int index;} creatureIterator;
creatureIterator iterateCreatures(creature **list){return (creatureIterator){0};}
int hasNextCreature(creatureIterator it){return it.index<allocated;}
creature *nextCreature(creatureIterator *it){return monsters[it->index++];}
${fn(mc,'void initializeGender(creature *monst) {')}
${fn(mc,'creature *cloneMonster(creature *monst, boolean announce, boolean placeClone) {')}
int applyPlenty(creature *monst){int identified=0,*autoID=&identified;creature *newMonst;switch(BE_PLENTY){${plenty}}return identified;}
int main(void){
 for(int hp=1;hp<=137;hp++){creature m={0};m.currentHP=hp;m.loc=(pos){4,5};m.status[2]=17;m.bookkeepingFlags=MB_WEAPON_AUTO_ID|MB_TELEPATHICALLY_REVEALED;m.carriedItem=&gray;m.safetyMap=&gray;m.mapToMe=&gray;allocated=0;
 int ok=applyPlenty(&m);creature *c=monsters[0];c->status[2]=99;
 printf("hp %d %d %d %d %d %d %d %d %d %d\\n",hp,m.currentHP,c->currentHP,ok,c->ticksUntilTurn,c->leader==&m,c->carriedItem==NULL,c->safetyMap==NULL,m.status[2],(int)c->bookkeepingFlags);free(c);}
 creature m={0},carried={0};m.currentHP=5;m.carriedMonster=&carried;carried.currentHP=7;allocated=0;creature *c=cloneMonster(&m,0,0);printf("carried %d %d %d\\n",c->carriedMonster==NULL,allocated,monsters[1]==NULL);
 player.currentHP=19;strcpy(player.info.monsterName,"you");player.info.damage=(range){20,30,3};player.info.defense=80;allocated=0;applyPlenty(&player);c=monsters[0];printf("player %d %d %s %d %d %d %d %d\\n",player.currentHP,c->currentHP,c->info.monsterName,c->info.damage.lowerBound,c->info.damage.upperBound,c->info.defense,c->creatureState,c->leader==&player);
 m=(creature){0};m.currentHP=5;m.bookkeepingFlags=MB_CAPTIVE;allocated=0;applyPlenty(&m);c=monsters[0];printf("captive %d %d %d %d\\n",(int)m.bookkeepingFlags,(int)c->bookkeepingFlags,c->creatureState,c->leader==&player);
 return 0;
}
`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'w20-ce-'));try{fs.writeFileSync(`${tmp}/golden.c`,c);execFileSync('clang',['-std=c11','-Wall','-Werror','-Wno-unused-parameter',`${tmp}/golden.c`,'-o',`${tmp}/golden`]);fs.writeFileSync(`${dir}/ce-clone.c`,c);fs.writeFileSync(`${dir}/ce-clone.txt`,execFileSync(`${tmp}/golden`));}finally{fs.rmSync(tmp,{recursive:true,force:true});}
