// Compile verbatim CE enchanting/autoIdentify/uncurse control flow with inert UI ports.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const out = 'ai_docs/reports/x2d-evidence';
const items = fs.readFileSync('../BrogueCE-master/src/brogue/Items.c', 'utf8');
const header = fs.readFileSync('../BrogueCE-master/src/brogue/Rogue.h', 'utf8');
const block = (source, start) => {
    const at = source.indexOf(start), open = source.indexOf('{', at);
    if (at < 0) throw Error(start);
    let depth = 1, end = open + 1;
    for (; depth; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
    return source.slice(at, end);
};
const enchanting = items.slice(items.indexOf('        case SCROLL_ENCHANTING:', items.indexOf('boolean readScroll(')), items.indexOf('        case SCROLL_RECHARGING:', items.indexOf('boolean readScroll(')));
const tail = items.slice(items.indexOf('    // all scrolls auto-identify on use'), items.indexOf('static void detectMagicOnItem'));
const source = `#include <stdio.h>
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
${['weaponKind','armorKind','ringKind','staffKind','wandKind','charmKind','scrollKind'].map(e => block(header, 'enum ' + e + ' {') + ';').join('\n')}
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
${block(items, 'static int enchantMagnitude()')}
${block(items, 'void identify(item *theItem)')}
${block(items, 'static boolean uncurse( item *theItem )')}
${block(items, 'void autoIdentify(item *theItem)')}
boolean readEnchantment(item *theItem) {
    char buf[COLS*3], buf2[COLS*3];
    itemTable scrollKind=tableForItemCategory(theItem->category)[theItem->kind];
    switch(theItem->kind) {
${enchanting}
    }
${tail}
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
        printf("%s{\\"category\\":%d,\\"kind\\":%d,\\"scrollKnown\\":%s,\\"runeKnown\\":%s,\\"kindKnown\\":%s,\\"E\\":%d,\\"strength\\":%d,\\"times\\":%d,\\"cursed\\":%s,\\"charges\\":%d,\\"timer\\":%d,\\"rolls\\":%d}",row++?",":"",cats[c],k,known?"true":"false",(target.flags&ITEM_RUNIC_IDENTIFIED)?"true":"false",tables[cats[c]][k].identified?"true":"false",target.enchant1,target.strengthRequired,target.timesEnchanted,(target.flags&ITEM_CURSED)?"true":"false",target.charges,target.enchant2,rolls);
    }
    printf("]\\n"); return 0;
}
`;
fs.writeFileSync(`${out}/ce-oracle.c`, source);
const exe = `${out}/ce-oracle.exe`;
try {
    const compile = spawnSync('clang', [`${out}/ce-oracle.c`, '-o', exe], { encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(`${out}/ce-compile.txt`, `${compile.stdout ?? ''}${compile.stderr ?? ''}`.replaceAll('\r\n', '\n'));
    if (compile.status !== 0) throw Error(`clang failed: ${compile.stderr || compile.error}`);
    const run = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true });
    if (run.status !== 0) throw Error(run.stderr || 'CE oracle failed');
    const rows = JSON.parse(run.stdout);
    fs.writeFileSync(`${out}/ce-oracle.json`, JSON.stringify({ source: 'verbatim CE switch branch and tail, identify/autoIdentify/uncurse; UI/equipment refresh stubs; rand_range counted with deterministic 8929; kind/flag/resource behavior is actual C', itemsSHA256: createHash('sha256').update(items).digest('hex'), headerSHA256: createHash('sha256').update(header).digest('hex'), rows }, null, 2) + '\n');
    console.log(JSON.stringify({ rows: rows.length, unexpectedRunic: rows.filter(r => r.category <= 2 && r.runeKnown !== (!r.scrollKnown && r.kind >= 2)) }));
} finally { if (fs.existsSync(exe)) fs.unlinkSync(exe); }
