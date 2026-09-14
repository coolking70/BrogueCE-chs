# 报告：web 自创内容退出生成池（D2）

日期：2026-09-14
范围：`src/engine/Items/ItemLoader.ts`、`src/engine/Core/Game.ts`（仅生成池）、`src/data/*.json`（仅加 `excludeFromGeneration` 字段）、新增测试与本报告。未删除任何数据条目与效果实现代码；未触碰禁止清单文件。

---

## 0. 结论速览

- 已确认自创（CE 无对应）并退出生成池的条目共 **8 项**：用户已确认 3 项 + 本轮复核新增 5 项（见 §1、§2）。
- 实现方式：数据条目加 `excludeFromGeneration: true` 字段；`ItemLoader` 派生 `gen*` 生成池；`Game.ts` 所有随机生成读取点改用 `gen*` 池；武器/护甲符文改为 `GENERATED_*_RUNICS` 池。全量数组保留，供直接构造（`spawnXxx(id)`）与测试模式资产使用。
- **`npm test` 有 2 个既有用例失败**（`horde_terrain_spawn.test.ts`），因果已用 HEAD 基线副本验证：纯属 RNG 流移动打击败于随机流的计数/阈值断言，循环内的行为性质断言全部仍通过。按任务"若有测试因此失败，如实报告，不要去改那些测试"的约定处理（详见 §5、§7）。
- `npm run build` 全绿。

---

## 1. parity_gap_analysis.md §10 清单逐条复核

判定标准：能否通过"从某个随机池移除条目"让玩家遇不到它。

| # | §10 条目 | 复核结论 | 依据/去向 |
|---|---|---|---|
| 1 | 附魔卷轴"自动强化已装备 +20% 送符文" | **行为偏离，不在本轮** | 无独立数据条目可退池；强化/送符文逻辑属行为层 |
| 2a | 武器符文 vampirism（CE 无） | **本轮处理** | `weaponRunicNames`（Globals.c）10 种：speed/quietus/paralysis/multiplicity/slowing/confusion/force/slaying/mercy/plenty，无 vampirism |
| 2b | mercy 留 1HP（CE 是治疗 50% maxHP） | **行为偏离，不在本轮** | mercy 符文本身 CE 有，只是强度/机制偏离 |
| 3 | 护甲符文 vitality（CE 无） | **本轮处理** | `armorRunicNames`（Globals.c）11 种：multiplicity/mutuality/absorption/reprisal/immunity/reflection/respiration/dampening/burden/vulnerability/immolation，无 vitality |
| 4 | 卷轴 amnesia（CE 无） | **本轮处理** | CE 全源码 grep "amnesia" 零命中；`scrollTable_Brogue` 14 种无此条 |
| 5 | speed 护符给 levitating（bug） | 行为偏离，不在本轮 | charm_of_speed 对应 CE CHARM_HASTE，条目本身非自创 |
| 6 | 深水即死 | 行为偏离，不在本轮 | 地形规则，无可退池条目 |
| 7 | 饥饿 12000 / 10 回合回血 | 行为偏离（数值），不在本轮 | 非"生成池条目" |
| 8 | 隐形攻击 +50% 命中 | 行为偏离，不在本轮 | 战斗公式层 |
| 9 | 怪物掉落固定 4 选 1 | 行为偏离，不在本轮 | Game.ts:2077-2086 的掉落硬编码 dagger/sword/leather_armor/chain_mail，全是 CE 物品，不涉及自创条目 |
| 10 | 陷阱始终可见、压力板链式触发 | 行为偏离，不在本轮 | 陷阱系统行为 |
| 11 | 测试模式 | 保留 | §10 原文即"保留"；其资产清单继续使用**全量**数组（Game.ts:1375-1421 未改），自创物品仍可在测试模式构造出来做 QA |
| 12 | 传送/火焰陷阱"焦地"残留 | 行为偏离，不在本轮 | 地形生命周期 |

---

## 2. 用户清单之外的额外自创项（本轮一并退池）

逐类比对 web 数据表与 CE 表（BrogueCE-master）后发现 5 项提示词未列出的自创条目，全部满足"退池即遇不到"：

| 条目 | web 位置 | CE 证据 |
|---|---|---|
| `potion_of_healing` | consumables.json | `potionTable_Brogue`（GlobalsBrogue.c:665）16 种、`POTION_*` 枚举（Rogue.h:792-807）16 种，均无 healing/extra healing（CE 的治疗手段是生命药水/治疗法杖/恢复戒指） |
| `wand_of_fire` | arcana.json | `wandTable_Brogue`（GlobalsBrogue.c:701）9 种无火魔杖；火焰伤害在 CE 属法杖（firebolt） |
| `wand_of_lightning` | arcana.json | 同上，9 种无闪电魔杖；闪电属法杖（lightning staff） |
| `staff_of_light` | arcana.json | `staffTable`（Globals.c:1641）12 种无 light 法杖；Rogue.h 的 `*_LIGHT` 枚举只是 easy 模式视觉闪光，非独立物品 |
| `halberd`（戟） | weapons.json | `weaponTable`（Globals.c:1582）15 种无 halberd。**旁证**：`src/data/weapons.test.ts` 头注早已记载"halberd 为 web 侧多余条目（CE weaponTable 无对应行）" |

复核中排除的嫌疑项（看似可疑、实为 CE 内容，**未退池**）：

- 护甲符文 `dampening`：CE `armorRunicNames` 有，保留。
- 武器符文 `paralyzing`：即 CE "paralysis" 符文的拼写变体，保留（改名对齐 CE 属后续任务）。
- 怪物 67 种：程序化比对 CE `monsterCatalog`，除 `Warden_of_Yendor` 与 CE `warden_of_yendor` 的大小写差异外全部对应，**无自创怪物**。
- 变异 8 种（explosive/infested/agile/juggernaut/grappling/vampiric/toxic/reflective）：与 CE `monsterMutationCatalog`（Globals.c:1398-1412）一一对应，**非自创**。
- 戒指 6 / 护符 6 / 食物 2 / 护甲 6 / 钥匙 / 护符(yendor)：均为 CE 对应表的子集，无自创。
- `blueprints.json`：grep 全部自创 id 零引用。
- CE 有而 web 缺失的条目（potion of darkness、scroll of aggravate monsters、wand of polymorph/negation/domination/plenty、staff of tunneling/blinking/entrancement/obstruction/discord/protection、incendiary dart、javelin、ring of light/reaping、6 个 charm 等）：属"补齐占位物品"路线（Phase B-7），不在本轮。

---

## 3. 每项的排除方式与 CE 依据汇总

| 自创项 | CE 依据 | 排除方式 |
|---|---|---|
| `scroll_of_amnesia` | CE 无 "amnesia"（scrollTable 14 种） | consumables.json 标记退池；`spawnBlueprintItem` SCROLL 类别与地面物品池改用 `genScrolls`；`case 'amnesia'` 效果分支保留（未触碰） |
| `potion_of_healing` | potionTable 16 种无 healing | json 标记退池；蓝图 POTION 类别与地面物品池改用 `genPotions` |
| `wand_of_fire` | wandTable 9 种无火魔杖 | json 标记退池；**机器房宝藏的硬编码 `spawnWand('wand_of_fire')`（原 Game.ts:686）改为从 `genWands` 按深度抽取**；祭坛/地面池改用 `genWands`；Bolt.ts 效果表与 Game.ts 使用分支保留 |
| `wand_of_lightning` | 同上 | json 标记退池；地面/祭坛/蓝图池改用 `genWands` |
| `staff_of_light` | staffTable 12 种无 light | json 标记退池；池读取改 `genStaffs`；Bolt.ts 效果表保留 |
| `halberd` | weaponTable 15 种无 halberd | json 标记退池；蓝图 WEAPON 类别改用 `genWeapons`；`getWeaponConfigs()` 保持全量（测试模式资产用） |
| 武器符文 `vampirism`、`venom` | weaponRunicNames 10 种无此二项 | ItemLoader 拆出 `ALL_WEAPON_RUNICS`（9 项原列表原序保留）与 `GENERATED_WEAPON_RUNICS`（7 项 CE 对应）；spawnWeapon 用后者 |
| 护甲符文 `vitality` | armorRunicNames 11 种无 vitality | 同上拆 `ALL_ARMOR_RUNICS` / `GENERATED_ARMOR_RUNICS`（7 项） |

**刻意保留的全量数组读取点**（不属于生成）：

- Game.ts:2283 / 2377 / 2404 / 3212 —— 效果解析按 id 查全量表（保证直接构造出的自创物品功能正常，D2 的"可重新启用"语义）；
- Game.ts:1375-1421 —— 测试模式资产清单（§10-11：保留的 QA 工具）。

---

## 4. 验收条款逐条对照

1. **固定多 seed 大量生成、断言自创项 0 出现** —— ✅ 新增 `src/test/invented_content_pool.test.ts`：
   - 整层生成扫描：20 seed × D1-D26 = **520 层**，逐层收集 `game.items` 的 consumableId/identityId/runicType/显示名，断言 8 项自创条目 0 命中（附反真空断言：物品总数 >1000，8 个主要类别均须出现过）；
   - 符文随机流：20 seed × 19 种装备 × 20 次 ≈ **7600 次** spawn，断言 vampirism/venom/vitality 0 次且 7 种 CE 武器符文、6 种 CE 护甲符文每种 ≥5 次。
2. **被排除条目仍存在、可直接构造** —— ✅ 用例 2：`spawnScroll('scroll_of_amnesia')`、`spawnPotion('potion_of_healing')`、`spawnWand('wand_of_fire'/'wand_of_lightning')`、`spawnStaff('staff_of_light')`、`spawnWeapon('halberd')` 均返回完整物品（halberd 的 `damage === '3d4'` 原样）；用例 1 另断言 json 条目仍在且 `excludeFromGeneration === true`、全量符文表仍含自创符文。
3. **对抗性验证** —— ✅ 临时把 `vampirism`、`venom` 加回 `GENERATED_WEAPON_RUNICS` 后，5 用例中 3 个失败（失败输出见 §6）；已还原并复核 diff。
4. **npm test 全绿、202 passed 不减** —— ⚠️ **部分未达成**：205 passed（= 我新增的 5 + 原 202 中的 200）、**2 failed**、5 todo。2 个失败均为 `horde_terrain_spawn.test.ts` 的既有用例，因果已验证为 RNG 流移动（§5、§7）。按任务"如实报告、不要改那些测试"的约定保留红灯。
5. **npm run build 全绿** —— ✅ `vue-tsc -b && vite build` 通过（尾部输出 §8）。

---

## 5. RNG 流变动的影响验证

**理论**：`randRange(0, 池大小-1)` 的池大小变化（卷轴 14→13、药水 16→15、魔杖 7→5、法杖 7→6、武器 13→12、武器符文 9→7、护甲符文 8→7）会改变每次抽取的取值分布，从而移动 RNG 流。机器房宝藏从"固定 wand_of_fire（不掷池抽取）"改为"池内随机抽取"也改变了抽取次数与顺序。

**实际验证**：

- 基线对照：用 `git archive HEAD` 在 /tmp 复原改动前代码，`horde_terrain_spawn.test.ts` 10/10 通过 → 2 个失败确由本轮改动引起，非既有问题。
- 受影响断言（2 个，均在 horde_terrain_spawn.test.ts）：
  1. "仅作为无 spawnsIn horde 领袖出现的物种……必在 FLOOR 上"：循环内的性质断言（领袖必须落 FLOOR）对全部样本仍通过；失败的只是样本量阈值 `checked > 30`（流移动后恰好抽到 30 个样本）。
  2. "楼梯存在且可站立，floorTiles 路径物品不落墙"：楼梯/钥匙/护符的**落点性质断言全部仍通过**；失败的只是计数 `amuletSeen === 4`。机制：护符 = D26 保底 1 个 + 地面物品 randType===8 时 10% 概率额外 1 个（minDepth=26 只在 D26 生效）；4 个 seed 期望 4~5 个，流移动前恰好 4、移动后某 seed 的 10% 分支命中得到 5。
- 确定性测试（smoke 的"同 seed 两次生成指纹一致"）依旧全绿——其只比对同一次运行内两次生成，不受流移动影响，与任务预判一致。
- **此前记录的任何"绝对数值基线表"（同 seed 地图/掉落/物品清单）自本轮起失效**；按常识 §四在此声明。

---

## 6. 对抗性测试失败输出（加回 vampirism/venom 后，已还原）

```
 ❯ src/test/invented_content_pool.test.ts (5 tests | 3 failed) 3160ms
     × 符文生成池不含自创符文，全量符号表仍含之 2ms
     × 20 seed × 19 种装备 × 20 次：vampirism/venom/vitality 出现 0 次，CE 符文均出现 4ms
     × 520 层生成的地面/机器/祭坛/金库物品中自创项出现 0 次 3153ms
AssertionError: expected [ 'paralyzing', 'venom', …(7) ] to not include 'vampirism'
AssertionError: 武器符文 vampirism 不应出现在生成流中: expected 78 to be +0
AssertionError: 整层生成撞见自创项：vampirism, venom: expected [ 'vampirism', 'venom' ] to deeply equal []
 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

还原后复跑：5/5 通过。

---

## 7. 与预设不符之处（只列不修）

1. **"既有确定性测试只比对同一次运行内两次生成是否一致，应不受影响"的预判不成立**。`horde_terrain_spawn.test.ts` 除一致性断言外还有受随机流影响的计数/阈值断言（`toBe(4)`、`toBeGreaterThan(30)`），本轮改动致其 2 用例红灯。已按任务约定不改测试、如实报告；若需转绿，属测试侧加固任务（把精确计数/样本阈值改为流无关断言），应由下一轮明确授权。
2. **验收第 4 条"npm test 全绿、202 passed 不得减少"与上述约定互斥**，本轮按"不改测试、如实报告"优先处理（200/202 原有用例保持通过，新增 5 用例全绿）。
3. **提示词漏列 5 项自创条目**（potion_of_healing、wand_of_fire、wand_of_lightning、staff_of_light、halberd），已按任务"发现遗漏一并处理"的指示退池。
4. **既有 bug（未修，超出本轮边界）**：机器房宝藏的 `spawnScroll('scroll_of_enchanting', …)`（Game.ts:684）id 拼写错误——web 数据中的合法 id 是 `scroll_of_enchantment`，故该分支恒返回 null、不放置宝藏。本轮保持原样（只替换了 wand_of_fire 半边），修复它会进一步改变 RNG 流，应与其它生成修正合并处理。
5. **命名差异（未改）**：web 武器符文 `paralyzing` 对应 CE "paralysis"；药水 `potion_of_haste` 对应 CE "potion of speed"；`charm_of_speed` 对应 CE "charm of haste"。均为拼写/本地化差异，非自创，保留现状。
6. 提示词边界写明 CE 表位于 `src/brogue/Globals.c` 等——实际 CE 源码在兄弟目录 `BrogueCE-master/src/`（web 仓库内无 C 源码），已按实际位置复核。

---

## 8. `npm test` 与 `npm run build` 完整输出尾部

```
=== npm test 尾部 ===
 FAIL  src/test/horde_terrain_spawn.test.ts > 地形感知落点 — 既有 floorTiles 用法未被破坏（楼梯 / 物品） > 多 seed × D1-D26：楼梯存在且可站立，floorTiles 路径物品（钥匙/护符）不落墙
AssertionError: 4 个 seed 的 D26 都应生成护符: expected 5 to be 4 // Object.is equality

- Expected
+ Received

- 4
+ 5

 ❯ src/test/horde_terrain_spawn.test.ts:285:53

（另一失败同文件："仅作为无 spawnsIn horde 领袖出现的物种……"
AssertionError: 应实际覆盖到该组物种的样本: expected 30 to be greater than 30
 ❯ src/test/horde_terrain_spawn.test.ts:240:42）

 Test Files  1 failed | 23 passed (24)
      Tests  2 failed | 205 passed | 5 todo (212)
   Start at  10:01:12
   Duration  12.90s (transform 1.33s, setup 0ms, import 2.78s, tests 36.52s, environment 7ms)

=== npm run build 尾部 ===
dist/assets/CanvasRenderer-Iq6TZnlN.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-_7XqZBGG.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-DuLT_CVA.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-B7stZvgj.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-CFgTNTUd.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-CKBSmWCA.js               886.65 kB │ gzip: 281.50 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.37s
```

## 9. `git diff --stat`

```
 brogue-web/src/data/arcana.json           |  3 ++
 brogue-web/src/data/consumables.json      |  2 ++
 brogue-web/src/data/weapons.json          |  1 +
 brogue-web/src/engine/Core/Game.ts        | 51 +++++++++++++++++--------------
 brogue-web/src/engine/Items/ItemLoader.ts | 50 ++++++++++++++++++++++++++--
 5 files changed, 82 insertions(+), 25 deletions(-)
 新增（未跟踪）：src/test/invented_content_pool.test.ts、ai_docs/invented_content_pool_report.md
```

改动全部留在工作区，未执行任何 git 写操作。
