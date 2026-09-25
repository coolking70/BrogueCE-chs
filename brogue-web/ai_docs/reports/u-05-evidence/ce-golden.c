#include <stdio.h>
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
static boolean itemIsThrowingWeapon(const item *theItem) {
    if (theItem && (theItem->category == WEAPON)
        && ((theItem->kind == DART) || (theItem->kind == JAVELIN) || (theItem->kind == INCENDIARY_DART))) {

        return true;
    }
    return false;
}
boolean itemIsHeavyWeapon(const item *theItem) {
    if (theItem && theItem->category == WEAPON && !itemIsThrowingWeapon(theItem)
        && weaponTable[theItem->kind].strengthRequired > 15) {
        return true;
    }
    return false;
}
boolean itemIsPositivelyEnchanted(const item *theItem) {
    return theItem->enchant1 > 0;
}
static boolean itemIsADuplicate(item *theItem, item **spawnedItems, short itemCount) {
    short i;
    if (theItem->category & (STAFF | WAND | POTION | SCROLL | RING | WEAPON | ARMOR | CHARM)) {
        for (i = 0; i < itemCount; i++) {
            if (spawnedItems[i]->category == theItem->category
                && spawnedItems[i]->kind == theItem->kind) {

                return true;
            }
        }
    }
    return false;
}
int calls=0,acceptAt=0;
item *generateItem(int category,int kind){item *i=malloc(sizeof(item));*i=(item){category,kind,++calls==acceptAt?0:ITEM_CURSED,1,1};return i;}
void deleteItem(item *i){free(i);}
int main(void){
 int cats[]={WEAPON,ARMOR,POTION,SCROLL,STAFF,WAND,RING,CHARM,KEY};
 printf("{\"cases\":[");int comma=0;
 for(int c=0;c<9;c++)for(int q=0;q<8;q++)for(int profile=0;profile<8;profile++){
  item value={cats[c],profile==3?JAVELIN:0,profile==1?ITEM_CURSED:profile==2?ITEM_RUNIC:0,profile==4?2:1,profile==5?0:profile==6?-1:1};
  item *theItem=&value;featureType feat={q,cats[c],0},*feature=&feat;int itemCount=profile==7?1:0;
  weaponTable[0].strengthRequired=profile==0?15:19;weaponTable[JAVELIN].strengthRequired=19;p->spawnedItems[0]=theItem;
  printf("%s[%d,%d,%d,%d,%d,%d,%d,%d,%d]",comma++?",":"",c,q,profile,value.kind,value.flags,value.quantity,value.enchant1,weaponTable[value.kind].strengthRequired,((theItem->flags & ITEM_CURSED)
                                   || ((feature->flags & MF_REQUIRE_GOOD_RUNIC) && (!(theItem->flags & ITEM_RUNIC))) // runic if requested
                                   || ((feature->flags & MF_NO_THROWING_WEAPONS) && theItem->category == WEAPON && theItem->quantity > 1) // no throwing weapons if prohibited
                                   || ((feature->flags & MF_REQUIRE_HEAVY_WEAPON) && (!itemIsHeavyWeapon(theItem) || !itemIsPositivelyEnchanted(theItem))) // must be a positively enchanted heavy weapon
                                   || itemIsADuplicate(theItem, p->spawnedItems, itemCount))?1:0);
 }
 printf("],\"boundaries\":[");
 int targets[]={0,1,2,1001,1002};
 for(int t=0;t<5;t++){calls=0;acceptAt=targets[t];item *theItem;featureType feat={0,WEAPON,0},*feature=&feat;int failsafe,itemCount=0;
 theItem = generateItem(feature->itemCategory, feature->itemKind);
                            failsafe = 1000;
                            while ((theItem->flags & ITEM_CURSED)
                                   || ((feature->flags & MF_REQUIRE_GOOD_RUNIC) && (!(theItem->flags & ITEM_RUNIC))) // runic if requested
                                   || ((feature->flags & MF_NO_THROWING_WEAPONS) && theItem->category == WEAPON && theItem->quantity > 1) // no throwing weapons if prohibited
                                   || ((feature->flags & MF_REQUIRE_HEAVY_WEAPON) && (!itemIsHeavyWeapon(theItem) || !itemIsPositivelyEnchanted(theItem))) // must be a positively enchanted heavy weapon
                                   || itemIsADuplicate(theItem, p->spawnedItems, itemCount)) { // don't want to duplicates of rings, staffs, etc.
                                deleteItem(theItem);
                                theItem = generateItem(feature->itemCategory, feature->itemKind);
                                if (failsafe <= 0) {
                                    break;
                                }
                                failsafe--;
                            }
                            
 printf("%s{\"acceptAt\":%d,\"calls\":%d,\"cursed\":%s}",t?",":"",acceptAt,calls,theItem->flags&ITEM_CURSED?"true":"false");deleteItem(theItem);
 }printf("]}\n");return 0;
}