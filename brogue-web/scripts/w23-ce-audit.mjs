import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = 'ai_docs/reports/w-23-evidence';
fs.mkdirSync(dir, { recursive: true });
const read = n => fs.readFileSync(`../BrogueCE-master/src/brogue/${n}`, 'utf8');
const fn = (s, signature) => {
    const start = s.indexOf(signature); if (start < 0) throw Error(signature);
    const open = s.indexOf('{', start); let d = 1, i = open + 1;
    for (; d; i++) { if (s[i] === '{') d++; if (s[i] === '}') d--; }
    return s.slice(start, i);
};
const h = read('Rogue.h'), items = read('Items.c'), monsters = read('Monsters.c'), globals = read('Globals.c');
const enums = ['monsterBehaviorFlags', 'monsterAbilityFlags', 'statusEffects', 'boltType'].map(n => fn(h, `enum ${n} {`) + ';').join('\n');
const c = `#include <stdio.h>
#include <string.h>
#include <assert.h>
#define Fl(n) (1UL << (n))
#define true 1
#define false 0
#define DCOLS 79
#define MB_SEIZING 1
#define BF_NOT_NEGATABLE Fl(8)
typedef int boolean;
${enums}
typedef struct {char name[80]; boolean isNegatable; short playerNegatedValue;} statusEffect;
${fn(globals, 'const statusEffect statusEffectCatalog[')};
typedef struct {int x,y;} pos;
typedef struct {unsigned long flags,abilityFlags;short movementSpeed,attackSpeed;enum boltType bolts[20];} creatureType;
typedef struct {creatureType info;unsigned long bookkeepingFlags;short status[NUMBER_OF_STATUS_EFFECTS],maxStatus[NUMBER_OF_STATUS_EFFECTS];short mutationIndex,movementSpeed,attackSpeed,newPowerCount,totalPowerCount;boolean wasNegated;pos loc;} creature;
struct {unsigned long flags;} boltCatalog[BOLT_WHIP + 1];
struct {boolean canBeNegated;} mutationCatalog[8]={{1},{1},{0},{0},{1},{1},{1},{1}};
creature player;
int dead,tiles,light,vision;char message[DCOLS*3];
void monsterName(char *s,creature *m,boolean article){(void)m;(void)article;strcpy(s,"target");}
void combatMessage(char *s,int color){(void)color;strcpy(message,s);}
int messageColorFromVictim(creature *m){(void)m;return 0;}
void killCreature(creature *m,boolean admin){(void)m;(void)admin;dead++;}
void extinguishFireOnCreature(creature *m){m->status[STATUS_BURNING]=0;}
void refreshDungeonCell(pos p){(void)p;}
void refreshSideBar(int a,int b,boolean c){(void)a;(void)b;(void)c;}
void resolvePronounEscapes(char *s,creature *m){(void)s;(void)m;}
void applyInstantTileEffectsToCreature(creature *m){(void)m;tiles++;}
void updateMinersLightRadius(void){light++;}
void updateVision(boolean refresh){(void)refresh;vision++;}
${fn(monsters, 'boolean canNegateCreatureStatusEffects(creature *monst) {')}
${fn(monsters, 'void negateCreatureStatusEffects(creature *monst) {')}
${fn(items, 'static boolean negationWillAffectMonster(creature *monst, boolean isBolt) {')}
${fn(items, 'boolean negate(creature *monst) {')}
creature fresh(void){creature m={0};m.mutationIndex=-1;m.info.movementSpeed=m.movementSpeed=100;m.info.attackSpeed=m.attackSpeed=100;m.totalPowerCount=3;return m;}
int main(void){
 for(int p=0;p<2;p++)for(int st=0;st<NUMBER_OF_STATUS_EFFECTS;st++)for(int dur=1;dur<=7;dur+=6){
  creature local=fresh();player=fresh();creature *m=p?&player:&local;m->status[st]=m->maxStatus[st]=dur;
  int eligible=negationWillAffectMonster(m,1),affected=negate(m);
  printf("status %d %d %d %d %d %d %d %d\\n",p,st,dur,eligible,affected,m->status[st],m->maxStatus[st],m->wasNegated);
 }
 creature m=fresh();m.info.abilityFlags=MA_SEIZES|MA_ATTACKS_STAGGER;m.info.flags=MONST_INVULNERABLE;m.bookkeepingFlags=MB_SEIZING;
 assert(!negationWillAffectMonster(&m,0));assert(negate(&m));assert(m.info.abilityFlags==MA_ATTACKS_STAGGER&&m.wasNegated&&!m.bookkeepingFlags&&m.newPowerCount==0);
 for(int kind=0;kind<3;kind++){m=fresh();m.info.flags=MONST_DIES_IF_NEGATED|(kind==1?MONST_INANIMATE:0);m.status[STATUS_LEVITATING]=kind==0;dead=tiles=0;assert(negate(&m));assert(dead==1&&tiles==0&&!m.wasNegated&&m.newPowerCount==0);printf("death %d %s\\n",kind,message);}
 for(int i=0;i<8;i++){m=fresh();m.mutationIndex=i;assert(negate(&m)==mutationCatalog[i].canBeNegated);assert(m.mutationIndex==(mutationCatalog[i].canBeNegated?-1:i));}
 m=fresh();m.info.flags=MONST_FLIES|MONST_FIERY|MONST_IMMUNE_TO_FIRE;m.status[STATUS_LEVITATING]=m.status[STATUS_BURNING]=m.status[STATUS_IMMUNE_TO_FIRE]=1000;assert(negate(&m));assert(!m.info.flags&&!m.status[STATUS_LEVITATING]&&!m.status[STATUS_BURNING]&&!m.status[STATUS_IMMUNE_TO_FIRE]);
 // Non-negatable flags are synthetic: the shipped CE catalog has none.
 boltCatalog[BOLT_WHIP].flags=BF_NOT_NEGATABLE;boltCatalog[BOLT_DISTANCE_ATTACK].flags=BF_NOT_NEGATABLE;
 m=fresh();m.info.bolts[0]=BOLT_NEGATION;m.info.bolts[1]=BOLT_WHIP;m.info.bolts[2]=BOLT_DISTANCE_ATTACK;assert(negate(&m));assert(m.info.bolts[0]==BOLT_WHIP&&m.info.bolts[1]==BOLT_DISTANCE_ATTACK&&m.info.bolts[2]==BOLT_DISTANCE_ATTACK);printf("tail %d %d %d\\n",m.info.bolts[0],m.info.bolts[1],m.info.bolts[2]);
 m=fresh();m.info.bolts[1]=BOLT_NEGATION;assert(negationWillAffectMonster(&m,0));assert(negate(&m));assert(m.info.bolts[0]==BOLT_NONE&&m.info.bolts[1]==BOLT_NONE);
 m=fresh();tiles=0;assert(!negate(&m));assert(tiles==1&&m.newPowerCount==3&&!m.wasNegated);
 puts("audit passed");return 0;
}
`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w23-ce-'));
try {
    fs.writeFileSync(`${tmp}/audit.c`, c);
    execFileSync('clang', ['-std=c11', '-Wall', '-Werror', `${tmp}/audit.c`, '-o', `${tmp}/audit`]);
    fs.writeFileSync(`${dir}/ce-negation.c`, c);
    fs.writeFileSync(`${dir}/ce-negation.txt`, execFileSync(`${tmp}/audit`));
    console.log('Original CE negation/status functions: audit passed');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
