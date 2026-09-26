from pathlib import Path
import subprocess
import json
base = Path('ai_docs/reports/u-13-evidence/ce-combat.c').read_text(encoding='utf-8')
base = base[:base.index('int main(void) {')]
base = base.replace('typedef struct {int category, strengthRequired, enchant1, flags, enchant2, vorpalEnemy, armor; randomRange damage;} item;', 'typedef struct {int category, strengthRequired, enchant1, flags, enchant2, vorpalEnemy, armor; randomRange damage;} item;')
base = base.replace('typedef struct {struct {short accuracy, defense; randomRange damage;} info; short weaknessAmount, status[3]; int bookkeepingFlags;} creature;', 'typedef struct {struct {short accuracy, defense; int flags; randomRange damage;} info; short weaknessAmount, status[3], creatureMode, creatureState, currentHP; int bookkeepingFlags;} creature;')
ce = Path('../BrogueCE-master/src/brogue/Items.c').read_text(encoding='utf-8')
original = ce[ce.index('static boolean hitMonsterWithProjectileWeapon('):ce.index('static void throwItem(', ce.index('static boolean hitMonsterWithProjectileWeapon('))]
stubs = r'''
#define DCOLS 200
#define MONST_IMMUNE_TO_WEAPONS 1
#define MONST_INVULNERABLE 2
#define MONST_INANIMATE 4
#define STATUS_ENTRANCED 2
#define STATUS_MAGICAL_FEAR 0
#define MODE_PERM_FLEEING 1
#define MONSTER_FLEEING 2
#define MONSTER_ALLY 3
#define MONSTER_TRACKING_SCENT 4
#define MB_CAPTIVE 1
#define ITEM_PLAYER_AVOIDS 8
typedef int color;
color red;
const char *tr(const char *s) { return s; }
void handlePaladinFeat(creature *m) {(void)m;}
void itemName(item *i,char *out,boolean a,boolean b,void *c) {(void)i;(void)a;(void)b;(void)c;strcpy_s(out,DCOLS,"weapon");}
void monsterName(char *out,creature *m,boolean b) {(void)m;(void)b;strcpy_s(out,DCOLS,"rat");}
void equipItem(item *i,boolean b,void *p) {(void)b;(void)p;rogue.weapon=i;}
void unequipItem(item *i,boolean b) {(void)i;(void)b;rogue.weapon=NULL;}
void messageWithColor(const char *s,color *c,int n) {(void)s;(void)c;(void)n;}
void message(const char *s,int n) {(void)s;(void)n;}
color *messageColorFromVictim(creature *m) {(void)m;return &red;}
boolean inflictDamage(creature *a,creature *m,short d,color *c,boolean b) {(void)a;(void)c;(void)b;m->currentHP-=d;return m->currentHP<=0;}
void killCreature(creature *m,boolean b) {(void)m;(void)b;}
void magicWeaponHit(creature *m,item *i,boolean b) {(void)m;(void)i;(void)b;}
void applyArmorRunicEffect(char *out,creature *a,short *d,boolean melee) {(void)out;(void)a;(void)d;(void)melee;}
void moralAttack(creature *a,creature *m) {(void)a;(void)m;}
void splitMonster(creature *m,creature *a) {(void)m;(void)a;}
'''
# Preserve the CE function body verbatim; the stubs only replace its UI/world side effects.
main = r'''
int main(void) {
 int cases[][6]={{3,11,3,0,12,12},{3,11,3,10,12,12},{3,11,1,10,12,12},{3,11,3,-1,12,12},{3,11,3,3,9,12},{1,2,1,1,15,12},{7,7,4,10,12,12}};
 for(int k=0;k<7;k++) {
  int *c=cases[k];item w={.category=WEAPON,.damage={c[0],c[1],c[2]},.enchant1=c[3],.strengthRequired=c[5]};
  rogue.strength=c[4];player.info.accuracy=100;
  creature target={0};target.status[STATUS_STUCK]=1;
  calls=0;tuple=0;target.currentHP=10000;
  hitMonsterWithProjectileWeapon(&player,&target,&w);
  int dice=calls, counts[512]={0}; long combinations=1;
  for(int i=0;i<dice;i++) combinations*=highs[i]-lows[i]+1;
  for(long t=0;t<combinations;t++) {calls=0;tuple=t;target.currentHP=10000;hitMonsterWithProjectileWeapon(&player,&target,&w);int d=10000-target.currentHP;counts[d]++;if(calls!=dice)return 2;}
  printf("C %d %d %d %d %d %d %d %ld",c[0],c[1],c[2],c[3],c[4],c[5],dice,combinations);
  for(int d=0;d<512;d++)if(counts[d])printf(" %d:%d",d,counts[d]);puts("");
 }
 return 0;
}
'''
out = Path('ai_docs/reports/x2f-evidence/ce-thrown-original.c')
out.write_bytes((base + stubs + original + main).encode('utf-8'))
subprocess.run(['clang','-std=c99','-O0',str(out),'-o',str(out.with_suffix('.exe'))],check=True)
result = subprocess.check_output([str(out.with_suffix('.exe'))], text=True)
golden = json.loads(Path('ai_docs/reports/x2f-evidence/ce-thrown.json').read_text(encoding='utf-8'))
lines = result.splitlines()
assert len(lines) == len(golden)
for line, row in zip(lines, golden):
    fields = line.split()
    assert [int(x) for x in fields[1:9]] == [row['lo'], row['hi'], row['clump'], row['enchant'], row['strength'], row['required'], row['calls'], row['combinations']]
    assert {k: int(v) for k, v in (field.split(':') for field in fields[9:])} == row['weights']
Path('ai_docs/reports/x2f-evidence/original-output.txt').write_bytes(result.replace('\r\n', '\n').encode('utf-8'))
print(f'original CE function: {len(lines)} distributions match golden')
out.with_suffix('.exe').unlink()
