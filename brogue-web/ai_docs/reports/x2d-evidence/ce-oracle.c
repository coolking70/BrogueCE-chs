#include <stdio.h>
#include <string.h>
#include <stdbool.h>
typedef bool boolean;
#define COLS 100
#define REQUIRE_ACKNOWLEDGMENT 0
#define KEYBOARD_LABELS 0
#define FEAT_SPECIALIST 0
#define SCROLL_ENCHANTMENT_LIGHT 0
#define ITEM_IDENTIFIED 1
#define ITEM_CAN_BE_IDENTIFIED 2
#define ITEM_RUNIC 4
#define ITEM_RUNIC_IDENTIFIED 8
#define ITEM_RUNIC_HINTED 16
#define ITEM_CURSED 32
#define ITEM_EQUIPPED 64
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
enum { WEAPON=1, ARMOR=2, RING=4, STAFF=8, WAND=16, CHARM=32, SCROLL=64, POTION=128 };
enum weaponKind {
    DAGGER,
    SWORD,
    BROADSWORD,

    WHIP,
    RAPIER,
    FLAIL,

    MACE,
    HAMMER,

    SPEAR,
    PIKE,

    AXE,
    WAR_AXE,

    DART,
    INCENDIARY_DART,
    JAVELIN,
    NUMBER_WEAPON_KINDS
};
enum armorKind {
    LEATHER_ARMOR,
    SCALE_MAIL,
    CHAIN_MAIL,
    BANDED_MAIL,
    SPLINT_MAIL,
    PLATE_MAIL,
    NUMBER_ARMOR_KINDS
};
enum ringKind {
    RING_CLAIRVOYANCE,
    RING_STEALTH,
    RING_REGENERATION,
    RING_TRANSFERENCE,
    RING_LIGHT,
    RING_AWARENESS,
    RING_WISDOM,
    RING_REAPING,
    NUMBER_RING_KINDS
};
enum staffKind {
    STAFF_LIGHTNING,
    STAFF_FIRE,
    STAFF_POISON,
    STAFF_TUNNELING,
    STAFF_BLINKING,
    STAFF_ENTRANCEMENT,
    STAFF_OBSTRUCTION,
    STAFF_DISCORD,
    STAFF_CONJURATION,
    STAFF_HEALING,
    NUMBER_GOOD_STAFF_KINDS = STAFF_HEALING,
    STAFF_HASTE,
    STAFF_PROTECTION,
    NUMBER_STAFF_KINDS
};
enum wandKind {
    WAND_TELEPORT,
    WAND_SLOW,
    WAND_POLYMORPH,
    WAND_NEGATION,
    WAND_DOMINATION,
    WAND_BECKONING,
    WAND_PLENTY,
    WAND_INVISIBILITY,
    WAND_EMPOWERMENT
};
enum charmKind {
    CHARM_HEALTH,
    CHARM_PROTECTION,
    CHARM_HASTE,
    CHARM_FIRE_IMMUNITY,
    CHARM_INVISIBILITY,
    CHARM_TELEPATHY,
    CHARM_LEVITATION,
    CHARM_SHATTERING,
    CHARM_GUARDIAN,
    CHARM_TELEPORTATION,
    CHARM_RECHARGING,
    CHARM_NEGATION
};
enum scrollKind {
    SCROLL_ENCHANTING,
    SCROLL_IDENTIFY,
    SCROLL_TELEPORT,
    SCROLL_REMOVE_CURSE,
    SCROLL_RECHARGING,
    SCROLL_PROTECT_ARMOR,
    SCROLL_PROTECT_WEAPON,
    SCROLL_SANCTUARY,
    SCROLL_MAGIC_MAPPING,
    SCROLL_NEGATION,
    SCROLL_SHATTERING,
    SCROLL_DISCORD,
    SCROLL_AGGRAVATE_MONSTER,
    SCROLL_SUMMON_MONSTER,
};
typedef struct { int category,kind,flags,enchant1,enchant2,charges,timesEnchanted,strengthRequired,quiverNumber,quantity; char inventoryLetter; } item;
typedef struct { boolean identified; int power; struct {int lowerBound;} range; } itemTable;
itemTable tables[129][64];
itemTable *wandTable=tables[WAND];
item *selected;
int rolls=0, itemMessageColor;
struct { boolean gameHasEnded; boolean featRecord[1]; } rogue;
struct { struct { int x,y; } loc; } player;
itemTable *tableForItemCategory(int c) { return tables[c]; }
int rand_range(int a,int b) { rolls++; return 8929; }
const char *tr(const char *s) { return s; }
void identifyItemKind(item *i) { tables[i->category][i->kind].identified=true; }
void updateRingBonuses(void) {}
void updateClairvoyance(void) {}
void displayLevel(void) {}
void confirmMessages(void) {}
void message(const char *s,int a) {}
void messageWithColor(const char *s,int *c,int a) {}
void itemName(item *i,char *s,boolean a,boolean b,void *p) { strcpy(s,"item"); }
int numberOfMatchingPackItems(int a,int b,int c,boolean d) { return 1; }
item *promptForItemOfType(int a,int b,int c,const char *d,boolean e) { return selected; }
void recordKeystroke(int a,boolean b,boolean c) {}
void equipItem(item *a,boolean b,void *c) {}
void createFlare(int a,int b,int c) {}
static int enchantMagnitude() {
    return tableForItemCategory(SCROLL)[SCROLL_ENCHANTING].power;
}
void identify(item *theItem) {
    theItem->flags |= ITEM_IDENTIFIED;
    theItem->flags &= ~ITEM_CAN_BE_IDENTIFIED;
    if (theItem->flags & ITEM_RUNIC) {
        theItem->flags |= (ITEM_RUNIC_IDENTIFIED | ITEM_RUNIC_HINTED);
    }
    if (theItem->category & RING) {
        updateRingBonuses();
    }
    identifyItemKind(theItem);
}
static boolean uncurse( item *theItem ) {
    if (theItem->flags & ITEM_CURSED) {
        theItem->flags &= ~ITEM_CURSED;
        return true;
    }
    return false;
}
void autoIdentify(item *theItem) {
    short quantityBackup;
    char buf[COLS * 3], oldName[COLS * 3], newName[COLS * 3];

    if (tableForItemCategory(theItem->category)
        && !tableForItemCategory(theItem->category)[theItem->kind].identified) {

        identifyItemKind(theItem);
        quantityBackup = theItem->quantity;
        theItem->quantity = 1;
        itemName(theItem, newName, false, true, NULL);
        theItem->quantity = quantityBackup;
        {
            boolean chineseUi = strcmp(tr("Health"), "Health") != 0;
            if (chineseUi) {
                if (theItem->category & (POTION | SCROLL)) {
                    sprintf(buf, "（它一定是%s。）", newName);
                } else {
                    sprintf(buf, "（它必定是%s。）", newName);
                }
            } else {
                sprintf(buf, "(It must %s %s.)",
                        ((theItem->category & (POTION | SCROLL)) ? "have been" : "be"),
                        newName);
            }
        }
        messageWithColor(buf, &itemMessageColor, 0);
    }

    if ((theItem->category & (WEAPON | ARMOR))
        && (theItem->flags & ITEM_RUNIC)
        && !(theItem->flags & ITEM_RUNIC_IDENTIFIED)) {

        itemName(theItem, oldName, false, false, NULL);
        theItem->flags |= (ITEM_RUNIC_IDENTIFIED | ITEM_RUNIC_HINTED);
        itemName(theItem, newName, true, true, NULL);
        {
            boolean chineseUi = strcmp(tr("Health"), "Health") != 0;
            if (chineseUi) {
                sprintf(buf, "（你的%s必定是%s。）", oldName, newName);
            } else {
                sprintf(buf, "(Your %s must be %s.)", oldName, newName);
            }
        }
        messageWithColor(buf, &itemMessageColor, 0);
    }
}
boolean readEnchantment(item *theItem) {
    char buf[COLS*3], buf2[COLS*3];
    itemTable scrollKind=tableForItemCategory(theItem->category)[theItem->kind];
    switch(theItem->kind) {
        case SCROLL_ENCHANTING:
            identify(theItem);
            messageWithColor("this is a scroll of enchanting.", &itemMessageColor, REQUIRE_ACKNOWLEDGMENT);
            if (!numberOfMatchingPackItems((WEAPON | ARMOR | RING | STAFF | WAND | CHARM), 0, 0, false)) {
                confirmMessages();
                message("you have nothing that can be enchanted.", 0);
                break; // regardless, the scroll is consumed
            }
            do {
                theItem = promptForItemOfType((WEAPON | ARMOR | RING | STAFF | WAND | CHARM), 0, 0,
                                              KEYBOARD_LABELS ? "Enchant what? (a-z; shift for more info)" : "Enchant what?",
                                              false);
                confirmMessages();
                if (theItem == NULL || !(theItem->category & (WEAPON | ARMOR | RING | STAFF | WAND | CHARM))) {
                    message("Can't enchant that.", REQUIRE_ACKNOWLEDGMENT);
                }
                if (rogue.gameHasEnded) {
                    return false;
                }
            } while (theItem == NULL || !(theItem->category & (WEAPON | ARMOR | RING | STAFF | WAND | CHARM)));
            recordKeystroke(theItem->inventoryLetter, false, false);
            confirmMessages();

            theItem->timesEnchanted += enchantMagnitude();
            switch (theItem->category) {
                case WEAPON:
                    theItem->strengthRequired = max(0, theItem->strengthRequired - enchantMagnitude());
                    theItem->enchant1 += enchantMagnitude();
                    if (theItem->quiverNumber) {
                        theItem->quiverNumber = rand_range(1, 60000);
                    }
                    break;
                case ARMOR:
                    theItem->strengthRequired = max(0, theItem->strengthRequired - enchantMagnitude());
                    theItem->enchant1 += enchantMagnitude();
                    break;
                case RING:
                    theItem->enchant1 += enchantMagnitude();
                    updateRingBonuses();
                    if (theItem->kind == RING_CLAIRVOYANCE) {
                        updateClairvoyance();
                        displayLevel();
                    }
                    break;
                case STAFF:
                    theItem->enchant1 += enchantMagnitude();
                    theItem->charges += enchantMagnitude();
                    theItem->enchant2 = 500 / theItem->enchant1;
                    break;
                case WAND:
                    theItem->charges += wandTable[theItem->kind].range.lowerBound * enchantMagnitude();
                    break;
                case CHARM:
                    theItem->enchant1 += enchantMagnitude();
                    theItem->charges = min(0, theItem->charges); // Enchanting instantly recharges charms.
                    break;
                default:
                    break;
            }
            if ((theItem->category & (WEAPON | ARMOR | STAFF | RING | CHARM))
                && theItem->enchant1 >= 16) {

                rogue.featRecord[FEAT_SPECIALIST] = true;
            }
            if (theItem->flags & ITEM_EQUIPPED) {
                equipItem(theItem, true, NULL);
            }
            itemName(theItem, buf, false, false, NULL);
            {
                boolean chineseUi = strcmp(tr("Health"), "Health") != 0;
                if (chineseUi) {
                    sprintf(buf2, "你的%s在黑暗中短暂闪耀。", buf);
                } else {
                    sprintf(buf2, "your %s gleam%s briefly in the darkness.", buf, (theItem->quantity == 1 ? "s" : ""));
                }
                messageWithColor(buf2, &itemMessageColor, 0);
                if (uncurse(theItem)) {
                    if (chineseUi) {
                        sprintf(buf2, "一股邪恶的力量离开了你的%s。", buf);
                    } else {
                        sprintf(buf2, "a malevolent force leaves your %s.", buf);
                    }
                    messageWithColor(buf2, &itemMessageColor, 0);
                }
            }
            createFlare(player.loc.x, player.loc.y, SCROLL_ENCHANTMENT_LIGHT);
            break;

    }
    // all scrolls auto-identify on use
    if (!scrollKind.identified
        && (theItem->kind != SCROLL_ENCHANTING)
        && (theItem->kind != SCROLL_IDENTIFY)) {

        autoIdentify(theItem);
    }

    return true;
}


int main(void) {
    int cats[]={WEAPON,ARMOR,RING,STAFF,WAND,CHARM};
    printf("[");
    int row=0;
    for(int c=0;c<6;c++) for(int known=0;known<=1;known++) for(int k=0;k<3;k++) {
        memset(tables,0,sizeof(tables)); rolls=0;
        tables[SCROLL][SCROLL_ENCHANTING].identified=known;
        tables[SCROLL][SCROLL_ENCHANTING].power=1;
        tables[cats[c]][k].identified=(cats[c]==WEAPON || cats[c]==ARMOR || cats[c]==CHARM);
        wandTable[k].range.lowerBound=3;
        item scroll={.category=SCROLL,.kind=SCROLL_ENCHANTING,.quantity=1};
        item target={.category=cats[c],.kind=k,.quantity=15,.flags=ITEM_CURSED|((c<2)?ITEM_RUNIC:0),.enchant1=(c<2?-3:3),.strengthRequired=12,.charges=1,.timesEnchanted=2,.quiverNumber=(c==0 && k==2 ? 123 : 0)};
        selected=&target; readEnchantment(&scroll);
        printf("%s{\"category\":%d,\"kind\":%d,\"scrollKnown\":%s,\"runeKnown\":%s,\"kindKnown\":%s,\"E\":%d,\"strength\":%d,\"times\":%d,\"cursed\":%s,\"charges\":%d,\"timer\":%d,\"rolls\":%d}",row++?",":"",cats[c],k,known?"true":"false",(target.flags&ITEM_RUNIC_IDENTIFIED)?"true":"false",tables[cats[c]][k].identified?"true":"false",target.enchant1,target.strengthRequired,target.timesEnchanted,(target.flags&ITEM_CURSED)?"true":"false",target.charges,target.enchant2,rolls);
    }
    printf("]\n"); return 0;
}
