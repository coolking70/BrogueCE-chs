// Compile the actual CE predicates and retry loop, with only allocation/table stubs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
const dir='ai_docs/reports/u-05-evidence',arch=fs.readFileSync('../BrogueCE-master/src/brogue/Architect.c','utf8'),items=fs.readFileSync('../BrogueCE-master/src/brogue/Items.c','utf8');
function fn(source,name){const at=source.indexOf(name+'('),start=source.lastIndexOf('\n',at)+1;let end=source.indexOf('{',at),n=1;while(n){end++;if(source[end]==='{')n++;if(source[end]==='}')n--;}return source.slice(start,end+1);}
const duplicate=fn(arch,'itemIsADuplicate'),heavy=fn(items,'itemIsHeavyWeapon'),positive=fn(items,'itemIsPositivelyEnchanted'),throwing=fn(items,'itemIsThrowingWeapon');
const start=arch.indexOf('theItem = generateItem(feature->itemCategory'),end=arch.indexOf('p->spawnedItems[itemCount] = theItem',start);
const loop=arch.slice(start,end),condition=loop.slice(loop.indexOf('while (')+7,loop.indexOf(') { // don'));
const source=`#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
typedef bool boolean;
enum {WEAPON=1,ARMOR=2,POTION=4,SCROLL=8,STAFF=16,WAND=32,RING=64,CHARM=128,KEY=256};
enum {ITEM_CURSED=1,ITEM_RUNIC=2,MF_REQUIRE_GOOD_RUNIC=1,MF_NO_THROWING_WEAPONS=2,MF_REQUIRE_HEAVY_WEAPON=4};
enum {DART=1,JAVELIN=2,INCENDIARY_DART=3};
typedef struct {int category,kind,flags,quantity,enchant1;} item;
typedef struct {int flags,itemCategory,itemKind;} featureType;
struct {int strengthRequired;} weaponTable[4];
struct {item *spawnedItems[2];} storage,*p=&storage;
${throwing}
${heavy}
${positive}
${duplicate}
int calls=0,acceptAt=0;
item *generateItem(int category,int kind){item *i=malloc(sizeof(item));*i=(item){category,kind,++calls==acceptAt?0:ITEM_CURSED,1,1};return i;}
void deleteItem(item *i){free(i);}
int main(void){
 int cats[]={WEAPON,ARMOR,POTION,SCROLL,STAFF,WAND,RING,CHARM,KEY};
 printf("{\\"cases\\":[");int comma=0;
 for(int c=0;c<9;c++)for(int q=0;q<8;q++)for(int profile=0;profile<8;profile++){
  item value={cats[c],profile==3?JAVELIN:0,profile==1?ITEM_CURSED:profile==2?ITEM_RUNIC:0,profile==4?2:1,profile==5?0:profile==6?-1:1};
  item *theItem=&value;featureType feat={q,cats[c],0},*feature=&feat;int itemCount=profile==7?1:0;
  weaponTable[0].strengthRequired=profile==0?15:19;weaponTable[JAVELIN].strengthRequired=19;p->spawnedItems[0]=theItem;
  printf("%s[%d,%d,%d,%d,%d,%d,%d,%d,%d]",comma++?",":"",c,q,profile,value.kind,value.flags,value.quantity,value.enchant1,weaponTable[value.kind].strengthRequired,(${condition})?1:0);
 }
 printf("],\\"boundaries\\":[");
 int targets[]={0,1,2,1001,1002};
 for(int t=0;t<5;t++){calls=0;acceptAt=targets[t];item *theItem;featureType feat={0,WEAPON,0},*feature=&feat;int failsafe,itemCount=0;
 ${loop}
 printf("%s{\\"acceptAt\\":%d,\\"calls\\":%d,\\"cursed\\":%s}",t?",":"",acceptAt,calls,theItem->flags&ITEM_CURSED?"true":"false");deleteItem(theItem);
 }printf("]}\\n");return 0;
}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u05-ce-'));
try{fs.writeFileSync(path.join(temp,'golden.c'),source);execFileSync('cc',['-std=c99',path.join(temp,'golden.c'),'-o',path.join(temp,'golden')]);
 const data=JSON.parse(execFileSync(path.join(temp,'golden'),{encoding:'utf8'}));
 fs.writeFileSync(`${dir}/ce-golden.json`,JSON.stringify({sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),...data},null,2)+'\n');
 fs.writeFileSync(`${dir}/ce-golden.c`,source);console.log(JSON.stringify({cases:data.cases.length,boundaries:data.boundaries}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
