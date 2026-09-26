// Unchanged CE feature/abort blocks; deterministic allocation and RNG stubs.
// Certifies call-site order, not full generateMonster or dungeon parity.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const source=fs.readFileSync('../BrogueCE-master/src/brogue/Architect.c','utf8');
const cut=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const item=cut('                    // Generate an item as necessary.','                    if (feature->flags & (MF_OUTSOURCE_ITEM_TO_MACHINE');
const monster=cut('                    // Generate a horde as necessary.','                }\n                theItem = NULL;\n\n                // Finished with this instance!');
const abort=cut('static void abortItemsAndMonsters(', 'static boolean cellIsFeatureCandidate(');
const handoff=cut('    if (torchBearer && torch) {','    freeGrid(distanceMap);\n    if (D_MESSAGE_MACHINE_GENERATION)');
const flags=[...new Set((item+monster).match(/\b(?:MF_|BP_|ITEM_|MB_|HORDE_|HAS_)[A-Z_0-9]+\b/g))];if(!flags.includes('MB_IS_DORMANT'))flags.push('MB_IS_DORMANT');
const header=`#include <stdio.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
typedef bool boolean;typedef struct {int x,y;} pos;
#define MACHINES_BUFFER_LENGTH 100
#define MONSTER_SLEEPING 1
#define MONSTER_FLEEING 2
#define MONSTER_TRACKING_SCENT 3
#define MONSTER_ALLY 4
#define MODE_PERM_FLEEING 5
#define WEAPON 1
${flags.map((f,i)=>`#define ${f} (1UL<<${i})`).join('\n')}
typedef struct item {unsigned long flags;int category,quantity,id,originDepth;pos loc;struct item *nextItem;} item;
typedef struct creature {unsigned long bookkeepingFlags;pos loc;int creatureState,creatureMode,machineHome,id,dead;struct creature *leader;item *carriedItem;} creature;
struct {unsigned long flags;} pmap[80][30],blueprintCatalog[1];
struct {int depthLevel;} rogue={10};
struct {unsigned long flags,itemFlags,hordeFlags;int itemCategory,itemKind,monsterID;} f,*feature=&f;
struct {item *spawnedItems[100];creature *spawnedMonsters[100];} data,*p=&data;
item *floorItems,*packItems,*adoptiveItem,*theItem,*torch;creature *monst,*leader,*torchBearer,*monsters[100];
int nc,ni,itemCount,monsterCount,featX,featY=10,machineNumber=7,bp=0,failsafe,draws,first;
void event(char *name,int draw){if(!first)printf(",");first=0;printf("\\"%s:%d\\"",name,draws);draws+=draw;}
item *generateItem(int cat,int kind){event("item",1);item *i=calloc(1,sizeof(item));i->id=++ni;i->quantity=1;return i;}
void deleteItem(item *i){if(i)i->id=0;}
bool itemIsHeavyWeapon(item *i){return true;}bool itemIsPositivelyEnchanted(item *i){return true;}bool itemIsADuplicate(item *i,item **a,int n){return false;}
void addLocationToKey(item *i,int x,int y,bool b){}void addMachineNumberToKey(item *i,int n,bool b){}
void placeItemAt(item *i,pos loc){i->loc=loc;}void removeItemFromChain(item *i,item *head){}
creature *generateMonster(int id,bool a,bool b){event("monster",1);creature *m=calloc(1,sizeof(creature));m->id=nc+1;monsters[nc++]=m;return m;}
creature *monsterAtLoc(pos loc){for(int i=0;i<nc;i++)if(!monsters[i]->dead&&monsters[i]->loc.x==loc.x&&monsters[i]->loc.y==loc.y)return monsters[i];return NULL;}
void killCreature(creature *m,bool b){m->dead=1;m->carriedItem=NULL;}
creature *spawnHorde(int id,pos loc,unsigned long forbidden,unsigned long required){event("horde",1);creature *m=generateMonster(1,true,true);m->loc=loc;m->bookkeepingFlags=MB_LEADER;for(int j=0;j<2;j++){creature *n=generateMonster(1,true,true);n->loc=(pos){loc.x+j+1,loc.y};n->leader=m;n->bookkeepingFlags=MB_JUST_SUMMONED|MB_FOLLOWER;}return m;}
void toggleMonsterDormancy(creature *m){m->bookkeepingFlags|=MB_IS_DORMANT;}
typedef struct {int i;} creatureIterator;
creatureIterator iterateCreatures(creature **a){return (creatureIterator){0};}
bool hasNextCreature(creatureIterator it){return it.i<nc;}
creature *nextCreature(creatureIterator *it){return monsters[it->i++];}
#define pmapAt(loc) (&pmap[(loc).x][(loc).y])
`;
const main=`void step(int x,unsigned long flags,int single){featX=x;f.flags=flags;f.monsterID=single;theItem=NULL;event("feature",1);${item}\n${monster}\n}
int main(void){first=1;printf("{\\"events\\":[");step(10,MF_GENERATE_ITEM|MF_GENERATE_HORDE|MF_MONSTER_TAKE_ITEM|MF_MONSTERS_DORMANT,0);step(20,MF_MONSTER_SLEEPING|MF_MONSTER_FLEEING,1);${handoff}\nevent("commit",0);printf("],\\"draws\\":%d,\\"created\\":%d,\\"carry\\":%d",draws,nc,torchBearer&&torchBearer->carriedItem!=NULL);abortItemsAndMonsters(p->spawnedItems,p->spawnedMonsters);int live=0;for(int i=0;i<nc;i++)live+=!monsters[i]->dead;printf(",\\"afterAbort\\":%d}\\n",live);return 0;}`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u19c-ce-'));
try{fs.writeFileSync(`${tmp}/oracle.c`,header+abort+main);execFileSync('cc',['-std=c11','-w',`${tmp}/oracle.c`,'-o',`${tmp}/oracle`]);const result=JSON.parse(execFileSync(`${tmp}/oracle`,{encoding:'utf8'}));const hash=s=>crypto.createHash('sha256').update(s).digest('hex');fs.writeFileSync('src/test/fixtures/u19c-ce-order.json',JSON.stringify({scope:'Unchanged CE feature/commit/abort blocks; allocation and RNG stubs. Not full generateMonster parity.',source:hash(source),blocks:{item:hash(item),monster:hash(monster),abort:hash(abort),handoff:hash(handoff)},...result},null,2)+'\n');console.log(result);}finally{fs.rmSync(tmp,{recursive:true,force:true});}
