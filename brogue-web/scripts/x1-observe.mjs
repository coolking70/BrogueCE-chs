// Synthetic in-memory observations of the unchanged production implementation.
// Does not patch methods, inject variants, modify tests, or capture baselines.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname,'..');
const evidence=path.join(root,'ai_docs/reports/x-1-evidence');
const {project}=JSON.parse(fs.readFileSync(path.join(evidence,'validation-stage.json')));
const require=createRequire(import.meta.url);
const {buildSync}=require(path.join(project,'node_modules/esbuild'));
const source=`
import {createHeadlessGame} from './src/test/harness.ts';
import {Monster, MonsterState} from './src/entities/Monster.ts';
import {TerrainType as T} from './src/engine/Map/Grid.ts';
import {ItemLoader} from './src/engine/Items/ItemLoader.ts';
import {ItemCategory} from './src/engine/Items/Item.ts';
import {canEnchantChosenItem} from './src/engine/Items/ItemUseCoordinator.ts';
import {generateItemDetail} from './src/engine/UI/DetailGenerator.ts';
import {DF_MISSING_TILES,DUNGEON_FEATURE_CATALOG} from './src/engine/Map/DungeonFeatureCatalog.ts';
import {RETIRED_INVENTED_BLUEPRINT_IDS,blueprintQualifies} from './src/engine/Generator/BlueprintEngine.ts';
import {rng} from './src/engine/Random.ts';
import {cellTerrainFlags} from './src/engine/Map/DungeonFeature.ts';
import {T_OBSTRUCTS_PASSABILITY,T_OBSTRUCTS_VISION} from './src/engine/Map/TerrainCatalog.ts';
import monsters from './src/data/monsters.json';
import blueprints from './src/data/blueprints.json';
import i18next from 'i18next';
import zh from './src/locales/zh_CN.json';
await i18next.init({lng:'zh_CN',fallbackLng:'zh_CN',resources:{zh_CN:{translation:zh}},initImmediate:false});
const output:any={scope:'Unmodified-code, synthetic in-memory observations; not natural occurrence rate or CE full-run equivalence'};
const g=createHeadlessGame(1212,'test');
g.monsters=[];g.dormantMonsters=[];g.items=[];
for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)g.grid.setTerrain(x,y,!x||!y||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR);
g.player.loc={x:6,y:8};
const ally=new Monster(8,8,monsters.find(m=>m.id==='kobold')!);
const enemy=new Monster(9,8,monsters.find(m=>m.id==='rat')!);
ally.isAlly=true;ally.state=MonsterState.HUNTING;enemy.state=MonsterState.HUNTING;
enemy.hp=enemy.maxHp=10000;g.monsters=[ally,enemy];
const rows=[];
for(let n=1;n<=100;n++) {const before={player:g.player.getStatusDuration('confused'),enemy:enemy.getStatusDuration('confused'),hp:enemy.hp};ally.takeTurn(g,0); const after={player:g.player.getStatusDuration('confused'),enemy:enemy.getStatusDuration('confused'),hp:enemy.hp}; if(after.player>before.player) {rows.push({attack:n,before,after,ally:ally.typeId,playerLoc:g.player.loc,allyLoc:ally.loc,enemyLoc:enemy.loc,onHitChance:ally.onHitChance});break;}}
output.allyStatusLeak=rows;
const h=createHeadlessGame(111,'test');const extra=ItemLoader.spawnWeapon('sword',0,0)!; h.player.inventory.addItem(extra);
output.enchantEligibility=h.player.inventory.items.filter(i=>[ItemCategory.WEAPON,ItemCategory.ARMOR].includes(i.category)).map(i=>({identity:i.identityId,weapon:i===h.player.equippedWeapon,armor:i===h.player.equippedArmor,allowed:canEnchantChosenItem(h.player,i)}));
const w=h.player.equippedWeapon!;w.runicType=undefined; w.enchantment=0;
const before={strength:w.strengthRequired,times:w.timesEnchanted,enchant:w.enchantment};
h.enchantEquippedItem();output.enchantResult={before,after:{strength:w.strengthRequired,times:w.timesEnchanted,enchant:w.enchantment,runic:w.runicType}};
w.enchantment=-3;w.isCursed=true;extra.enchantment=-2;extra.isCursed=true;
h.removeCurseFromInventory();output.removeCurseResult=[w,extra].map(i=>({identity:i.identityId,enchantment:i.enchantment,isCursed:i.isCursed}));
output.charmKinds=ItemLoader.genCharms.map(c=>c.id);
output.charmDetails=[1,2,5].map(e=>{const item=ItemLoader.spawnCharm('charm_of_health',0,0)!;item.enchantment=e;item.identified=true;return {e,description:item.description,detail:generateItemDetail(item,12).sections.flatMap(s=>s.lines.map(l=>l.text))};});
output.naturalCatalogLegacy=monsters.filter(m=>m.onHitStatus).map(m=>({id:m.id,status:m.onHitStatus,chance:m.onHitChance,duration:m.onHitDuration}));
output.dropDefaults={data:monsters.find(m=>m.id==='rat'),instance:{gold:enemy.goldDropChance,item:enemy.itemDropChance}};
output.df={count:Object.keys(DUNGEON_FEATURE_CATALOG).length,missingTiles:DF_MISSING_TILES};
output.retiredBlueprints=[...RETIRED_INVENTED_BLUEPRINT_IDS];
output.retiredQualifications=blueprints.filter(b=>RETIRED_INVENTED_BLUEPRINT_IDS.has(b.id)).map(b=>({id:b.id,depth1:blueprintQualifies(b,1,[]),depth12:blueprintQualifies(b,12,[])}));
output.potionPool=ItemLoader.genPotions.map(p=>p.id);
const r=createHeadlessGame(27027);r.handlePlayerAction('wait');r.handlePlayerAction('wait');const record=r.exportRecording();r.loadReplay(record);r.replaySeek(record.events.length);output.replay={events:record.events.length,cursor:r.replayCursor,error:r.replayError};
const n=createHeadlessGame(424242);const mismatches=[];
for(let x=0;x<n.grid.width;x++)for(let y=0;y<n.grid.height;y++){const cell=n.grid.getCell(x,y)!;const f=cellTerrainFlags(n.grid,x,y);const expected={passable:!(f&T_OBSTRUCTS_PASSABILITY),opaque:!!(f&T_OBSTRUCTS_VISION)};if(cell.isPassable!==expected.passable||cell.isOpaque!==expected.opaque)mismatches.push({x,y,layers:cell.layers.map(t=>T[t]),actual:{passable:cell.isPassable,opaque:cell.isOpaque},expected});}
output.naturalDerivedFlags={seed:424242,depth:1,count:mismatches.length,mismatches};
const t=createHeadlessGame(1212,'test');const retired=new Set(['potion_of_healing','scroll_of_amnesia','wand_of_fire','wand_of_lightning','staff_of_light','halberd']);
output.testModeRetired=[];
for(let depth=1;depth<=9;depth++){t.depth=depth;t.generateDepth(false,depth===1);const found=t.items.filter(i=>retired.has(i.identityId??i.consumableId??'')||['vampirism','venom','vitality'].includes(i.runicType??''));output.testModeRetired.push({depth,category:t.currentTestCategory,found:found.map(i=>({identity:i.identityId??i.consumableId,runic:i.runicType,loc:i.loc}))});}
export default output;
`;
const outfile=path.join(project,'x1-observe-bundle.mjs');
buildSync({stdin:{contents:source,loader:'ts',resolveDir:project},bundle:true,platform:'node',format:'esm',outfile});
const result=(await import(pathToFileURL(outfile))).default;
fs.writeFileSync(path.join(evidence,'runtime-observations.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({allyStatusLeak:result.allyStatusLeak,enchantResult:result.enchantResult,removeCurseResult:result.removeCurseResult,
  df:result.df,naturalDerivedFlags:{count:result.naturalDerivedFlags.count,
    opaque:result.naturalDerivedFlags.mismatches.filter(m=>m.actual.opaque!==m.expected.opaque).length,
    passable:result.naturalDerivedFlags.mismatches.filter(m=>m.actual.passable!==m.expected.passable).length}}));
