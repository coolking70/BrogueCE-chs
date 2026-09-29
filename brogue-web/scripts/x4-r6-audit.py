from pathlib import Path
import hashlib,json,re,subprocess
root=Path('.');out=Path('ai_docs/reports/x4-r6-evidence');out.mkdir(exist_ok=True)
def write(name,data): (out/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
files=sorted(p for p in Path('src').rglob('*') if p.is_file() and re.search(r'\.(test|spec)\.[cm]?[jt]sx?$',p.name))
readers=[]
for p in files:
 s=p.read_text()
 if re.search(r'readFileSync|readFile\s*\(|readFile\s*<|read_file|readTextFile',s):readers.append(str(p))
write('source-reader-inventory.json',{'policy':'All source-reading guards included; full npm test runs every test file, no subset substitution. Fixture-only readers retained conservatively.','files':readers,'count':len(readers)})
ce=Path('../BrogueCE-master/src');write('ce-source-hashes.json',{str(p):sha(p) for p in [ce/'brogue/Time.c',ce/'brogue/Items.c',ce/'brogue/Combat.c',ce/'brogue/Monsters.c',ce/'brogue/Globals.c',ce/'brogue/Movement.c',ce/'brogue/Architect.c',ce/'brogue/Rogue.h']})
write('state-contract.json',{
 'Item.knownStaffUses':{'kind':'persist','contract':'新数组，最近三次成功玩家法杖使用回合，新到旧；空杖/取消不记录；允许实际第0回合；绝不从回电倒推。','codec':'EntitySnapshot.ITEM_FIELDS / copyFields deep copy; all world/level/graph/throw clones use registered contract','reader':'createItemDetailContext freezes a detached copy; ItemDetailArcana displays ages','writer':'Game.confirmArcanaTarget -> ItemUseCoordinator.commitArcanaTarget currentTurn before turn completion','migration':'none'},
 'Item.originDepth':{'kind':'existing persist','contract':'GenerationCoordinator.populateLevel assigns all populated ordinary items at birth (CE Items.c:721); existing machine/gem/key sources preserved. Pickup/drop/throw never relabel; Inventory mixed-origin stack=0. Unknown or starting-kit source stays absent, not current-depth guessed.','codec':'existing EntitySnapshot.ITEM_FIELDS'},
 'Game.replayOmniscientDetails':{'kind':'session','contract':'scripts/u03-state-contract.json: explicit replay-only read-only projection; no knowledge/RNG/turn mutation; not world snapshot state'},
 'bloodType/DFChance/DFType':{'kind':'derived','contract':'Creature/Player/Monster getters; species/typeId/mutation/deathDFType retain U01/U03 serialization; no new feature timer'},
 'blood/healing/fire/trail results':{'kind':'existing persist','contract':'four terrain layers and volume via LevelSnapshot; no independent hidden task state'}})
# Record the prior R4 adjudication already integrated on the requested baseline.
p=Path('src/engine/UI/Discoveries.test.ts');head=subprocess.check_output(['git','show','HEAD:brogue-web/'+str(p)],text=True)
write('r4-capacity-premise.json',{'file':str(p),'headAlreadyUsesCapacityUnknown':'staff.maxChargesKnown = false;' in head,'unchangedFromHead':p.read_text()==head,'sha256':sha(p),'r4Proof':'../x4-r4-evidence/discoveries-premise-proposal.diff','decision':'本基线已经应用 R4 单行前提修订；R6 不重复修改，保留隐藏 E 扰动与不显示距离断言，并运行 R4 已知容量反泄漏守卫。'})
print(json.dumps({'sourceReaders':len(readers),'tests':len(files)},ensure_ascii=False))
