# 报告：web 自创内容退出生成池（D2）

日期：2026-09-14
范围：`src/engine/Items/ItemLoader.ts`、`src/engine/Core/Game.ts`（仅生成池/随机抽取）、`src/data/*.json`（仅加 `excludeFromGeneration` 字段）、新增测试与本报告。未删除任何数据条目与效果实现代码；未触碰禁止清单文件。

> **修订记录**
> - **v1（2026-09-14 上午）**：首轮执行，排除 6 项物品 + 3 项符文（代码层），附首轮报告与测试。随后由验收方独立核对 CE 三张表、修复 3 处测试脆弱性（horde 两处流耦合断言、本测试文件 4 处补 timeout），并以上述内容提交为 **c0dc248**。
> - **v2（本轮，2026-09-14）**：复核发现并补上两处 c0dc248 仍存在的漏洞——
>   ① `potion_of_poison`（首轮与验收均漏判的自创药水，仍可生成）；
>   ② `enchantEquippedItem`（附魔卷轴 20% 送符文路径）仍是**全量符文池硬编码**，玩家读附魔卷轴依然可能得到 vampirism/venom/vitality——这是 c0dc248 报告把 §10-1 整体判为"行为偏离"带来的漏网之鱼：其中"送符文的池子"是真实游玩中的随机抽取，属本轮判定标准之内。
>   v2 同时把测试覆盖扩到上述两处，并刷新验收对照与输出尾部。改动保留在工作区，未提交。

---

## 0. 结论速览

- 已确认自创（CE 无对应）并退出生成池的条目共 **9 项**：用户已确认 3 项 + v1 复核新增 5 项 + v2 新增 1 项（见 §1、§2）。
- 实现方式：数据条目加 `excludeFromGeneration: true` 字段；`ItemLoader` 派生 `gen*` 生成池；`Game.ts` 所有随机生成读取点改用 `gen*` 池；武器/护甲符文两处随机来源（`spawnWeapon`/`spawnArmor` 与附魔卷轴授予路径）均改用 `GENERATED_*_RUNICS` 池。全量数组保留，供直接构造（`spawnXxx(id)`）与测试模式资产使用。
- **`npm test` 全绿**：25 文件 / **210 passed** / 5 todo / 0 failed（horde 两处断言已由验收方在 c0dc248 中改为流无关的下限断言并注明理由；其性质断言在流移动前后均通过）。
- `npm run build` 全绿。

---

## 1. parity_gap_analysis.md §10 清单逐条复核

判定标准：能否通过"从某个随机池移除条目"让玩家遇不到它。

| # | §10 条目 | 复核结论 | 依据/去向 |
|---|---|---|---|
| 1 | 附魔卷轴"自动强化已装备 +20% 送符文" | **拆开看**："+20% 送符文"机制与"自动强化"是行为偏离（不在本轮，留待后续对齐 CE：CE 附魔卷轴不授符文）；但**被授予的符文来自一个随机池，池中含自创符文**——属"从随机池移除条目即可让玩家遇不到"，**池的部分本轮处理**（v2：`enchantEquippedItem` 改用 `GENERATED_*_RUNICS`） |
| 2a | 武器符文 vampirism（CE 无） | **本轮处理** | `weaponRunicNames`（Globals.c:1614）10 种：speed/quietus/paralysis/multiplicity/slowing/confusion/force/slaying/mercy/plenty，无 vampirism |
| 2b | mercy 留 1HP（CE 是治疗 50% maxHP） | **行为偏离，不在本轮** | mercy 符文本身 CE 有，只是强度/机制偏离 |
| 3 | 护甲符文 vitality（CE 无） | **本轮处理** | `armorRunicNames`（Globals.c:1627）11 种：multiplicity/mutuality/absorption/reprisal/immunity/reflection/respiration/dampening/burden/vulnerability/immolation，无 vitality |
| 4 | 卷轴 amnesia（CE 无） | **本轮处理** | CE 全源码 grep "amnesia" 零命中；`scrollTable_Brogue` 14 种无此条 |
| 5 | speed 护符给 levitating（bug） | 行为偏离，不在本轮 | charm_of_speed 对应 CE CHARM_HASTE，条目本身非自创 |
| 6 | 深水即死 | 行为偏离，不在本轮 | 地形规则，无可退池条目 |
| 7 | 饥饿 12000 / 10 回合回血 | 行为偏离（数值），不在本轮 | 非"生成池条目" |
| 8 | 隐形攻击 +50% 命中 | 行为偏离，不在本轮 | 战斗公式层 |
| 9 | 怪物掉落固定 4 选 1 | 行为偏离，不在本轮 | Game.ts 掉落硬编码 dagger/sword/leather_armor/chain_mail，全是 CE 物品，不涉及自创条目 |
| 10 | 陷阱始终可见、压力板链式触发 | 行为偏离，不在本轮 | 陷阱系统行为 |
| 11 | 测试模式 | 保留 | §10 原文即"保留"；其资产清单继续使用**全量**数组（Game.ts 测试模式资产段与 `getWeaponConfigs()/getArmorConfigs()` 未改），自创物品仍可在测试模式构造出来做 QA |
| 12 | 传送/火焰陷阱"焦地"残留 | 行为偏离，不在本轮 | 地形生命周期 |

---

## 2. 用户清单之外的额外自创项（一并退池）

逐类比对 web 数据表与 CE 表（BrogueCE-master）后发现 **6 项**提示词未列出的自创条目，全部满足"退池即遇不到"（v1 发现前 5 项，v2 发现第 6 项）：

| 条目 | web 位置 | CE 证据 |
|---|---|---|
| `potion_of_healing` | consumables.json | `potionTable_Brogue`（GlobalsBrogue.c:665）16 种、`POTION_*` 枚举 16 种，均无 healing/extra healing（CE 的治疗手段是生命药水/治疗法杖/恢复戒指） |
| `potion_of_poison` | consumables.json | **v2 新增**。同表 16 种无 poison（CE 的毒来自毒气陷阱 GAS_TRAP_POISON、creeping death 药水、毒镖，均非"毒药水"）。web 有 16 种药水与 CE 数量相同，逐一对位后缺口是 darkness 与 caustic gas（属 Phase B-7 补齐项），多出的 healing/poison 均自创 |
| `wand_of_fire` | arcana.json | `wandTable_Brogue`（GlobalsBrogue.c:701）9 种无火魔杖；火焰伤害在 CE 属法杖（firebolt） |
| `wand_of_lightning` | arcana.json | 同上，9 种无闪电魔杖；闪电属法杖（lightning staff） |
| `staff_of_light` | arcana.json | `staffTable`（Globals.c:1641）12 种无 light 法杖；Rogue.h 的 `*_LIGHT` 枚举只是 easy 模式视觉闪光，非独立物品 |
| `halberd`（戟） | weapons.json | `weaponTable`（Globals.c:1582）15 种无 halberd，CE 全源码 grep 零命中。**旁证**：`src/data/weapons.test.ts` 头注早已记载"halberd 为 web 侧多余条目（CE weaponTable 无对应行）" |

复核中排除的嫌疑项（看似可疑、实为 CE 内容，**未退池**）：

- 护甲符文 `dampening`：CE `armorRunicNames` 有，保留。
- 武器符文 `paralyzing`：即 CE "paralysis" 符文的拼写变体，保留（改名对齐 CE 属后续任务）。
- 怪物 67 种：程序化比对 CE `monsterCatalog`，除 `Warden_of_Yendor` 与 CE `warden_of_yendor` 的大小写差异外全部对应，**无自创怪物**。
- 变异 8 种（explosive/infested/agile/juggernaut/grappling/vampiric/toxic/reflective）：与 CE `monsterMutationCatalog` 一一对应，**非自创**。
- 戒指 6 / 护符 6 / 食物 2 / 护甲 6 / 钥匙 / 护符(yendor)：均为 CE 对应表的子集，无自创。
- `blueprints.json`：grep 全部自创 id 零引用。
- CE 有而 web 缺失的条目（potion of darkness、potion of caustic gas、scroll of aggravate monsters、wand of polymorph/negation/domination/plenty、staff of tunneling/blinking/entrancement/obstruction/discord/protection、incendiary dart、javelin、ring of light/reaping、6 个 charm 等）：属"补齐占位物品"路线（Phase B-7），不在本轮。

---

## 3. 每项的排除方式与 CE 依据汇总

| 自创项 | CE 依据 | 排除方式 |
|---|---|---|
| `scroll_of_amnesia` | CE 无 "amnesia"（scrollTable 14 种） | consumables.json 标记退池；`spawnBlueprintItem` SCROLL 类别与地面物品池改用 `genScrolls`；`case 'amnesia'` 效果分支保留（未触碰） |
| `potion_of_healing` | potionTable 16 种无 healing | json 标记退池；蓝图 POTION 类别与地面物品池改用 `genPotions` |
| `potion_of_poison` | potionTable 16 种无 poison | **v2**：json 标记退池；随 `genPotions` 自动生效，无需改生成代码 |
| `wand_of_fire` | wandTable 9 种无火魔杖 | json 标记退池；机器房宝藏的硬编码 `spawnWand('wand_of_fire')` 改为从 `genWands` 按深度抽取；祭坛/地面池改用 `genWands`；Bolt.ts 效果表与 Game.ts 使用分支保留 |
| `wand_of_lightning` | 同上 | json 标记退池；地面/祭坛/蓝图池改用 `genWands` |
| `staff_of_light` | staffTable 12 种无 light | json 标记退池；池读取改 `genStaffs`；Bolt.ts 效果表保留 |
| `halberd` | weaponTable 15 种无 halberd | json 标记退池；蓝图 WEAPON 类别改用 `genWeapons`；`getWeaponConfigs()` 保持全量（测试模式资产用） |
| 武器符文 `vampirism`、`venom` | weaponRunicNames 10 种无此二项 | ItemLoader 拆出 `ALL_WEAPON_RUNICS`（9 项原列表原序保留）与 `GENERATED_WEAPON_RUNICS`（7 项 CE 对应）；**两处**随机来源——`spawnWeapon` 与附魔卷轴授予路径 `enchantEquippedItem`（v2）——均用后者 |
| 护甲符文 `vitality` | armorRunicNames 11 种无 vitality | 同上拆 `ALL_ARMOR_RUNICS` / `GENERATED_ARMOR_RUNICS`（7 项），`spawnArmor` 与 `enchantEquippedItem`（v2）均用后者 |

**刻意保留的全量数组读取点**（不属于生成）：

- Game.ts 效果解析按 id 查全量表（保证直接构造出的自创物品功能正常，D2 的"可重新启用"语义）；
- 测试模式资产清单（§10-11：保留的 QA 工具），含其自带的 9/8 项全量符文列表——它恰是"退池非删除"的代码层证据。

---

## 4. 验收条款逐条对照

1. **固定多 seed 大量生成、断言自创项 0 出现** —— ✅ `src/test/invented_content_pool.test.ts`（v2 扩充后 6 用例）：
   - 整层生成扫描：20 seed × D1-D26 = **520 层**，逐层收集 `game.items` 的 consumableId/identityId/runicType/显示名，断言 9 项自创条目 0 命中（附反真空断言：物品总数 >1000，8 个主要类别均须出现过）；
   - 符文随机流：20 seed × 19 种装备 × 20 次 ≈ **7600 次** spawn，断言 vampirism/venom/vitality 0 次且每个 CE 符文 ≥5 次；
   - **v2 新增附魔路径采样**：2 seed × (8000 次武器 + 8000 次护甲) = **32000 次** `enchantEquippedItem`，断言自创符文 0 次且每个 CE 符文 ≥20 次（实测 CE 符文各数百次、授予总量数千，样本充分）。
2. **被排除条目仍存在、可直接构造** —— ✅ 用例 2：`spawnScroll('scroll_of_amnesia')`、`spawnPotion('potion_of_healing'/'potion_of_poison')`、`spawnWand('wand_of_fire'/'wand_of_lightning')`、`spawnStaff('staff_of_light')`、`spawnWeapon('halberd')` 均返回完整物品（halberd 的 `damage === '3d4'` 原样）；用例 1 另断言 json 条目仍在且 `excludeFromGeneration === true`、全量符文表仍含自创符文；测试模式资产段仍按全量列表构造全部符文房间。
3. **对抗性验证** —— ✅ v2 重做：临时把 `vampirism` 加回 `GENERATED_WEAPON_RUNICS` 后，6 用例中 **4 个失败**（含 v2 新增的附魔路径用例，失败输出见 §6）；已还原并复核 diff（ItemLoader.ts 归零）。
4. **npm test 全绿、202 passed 不减** —— ✅ v2 终态：**25 文件 / 210 passed / 0 failed / 5 todo**。原 202 用例全部保持通过（v1 期间 2 个 horde 用例因 RNG 流移动红灯，已由验收方在 c0dc248 中把两处流耦合断言改为保持原意的下限断言并注明理由；其性质断言在流移动前后均通过）。
5. **npm run build 全绿** —— ✅ `vue-tsc -b && vite build` 通过（尾部输出 §8）。

---

## 5. RNG 流变动的影响验证

**理论**：池大小变化（卷轴 14→13、药水 16→14、魔杖 7→5、法杖 7→6、武器 13→12、武器符文 9→7、护甲符文 8→7）会改变每次抽取的取值分布，从而移动 RNG 流；机器房宝藏从"固定 wand_of_fire（不掷池抽取）"改为"池内随机抽取"也改变抽取次数与顺序。v2 的附魔路径改池只在触发送符文时（20%）改变分布，同样会造成流偏移。

**实际验证**：

- v1 曾用改动前基线副本（git archive）验证：`horde_terrain_spawn.test.ts` 10/10 通过 → 失败确由退池改动引起，非既有问题。受影响的只是两处与流强耦合的计数/阈值断言（`toBe(4)`、`toBeGreaterThan(30)`），循环内的**性质断言（落点必须 FLOOR 等）全部仍通过**；验收方随后将其改为下限断言（c0dc248，含注释说明）。
- v2 终态全量 210 passed：smoke 的"同 seed 两次生成指纹一致"等确定性测试依旧全绿——其只比对同一次运行内两次生成，不受流移动影响，与任务预判一致。
- **此前记录的任何"绝对数值基线表"（同 seed 地图/掉落/物品清单）自本轮起失效**；按常识 §四在此声明。v2 的两处补丁会再次移动流（药水池 -1、附魔授予分布变化），一次性并入本次失效声明。

---

## 6. 对抗性测试失败输出（v2：临时加回 vampirism，已还原）

```
 ❯ src/test/invented_content_pool.test.ts (6 tests | 4 failed) 3.93s
     × 符文生成池不含自创符文，全量符号表仍含之
       AssertionError: expected [ 'paralyzing', 'quietus', …(6) ] to not include 'vampirism'
     × 附魔卷轴送符文路径（enchantEquippedItem）：自创符文 0 出现 > 8000 次附魔：武器/护甲只授 CE 符文，vampirism/venom/vitality 出现 0 次
       AssertionError: 附魔路径授予了自创武器符文 vampirism: expected 433 to be +0
     × 随机流大量采样 > 20 seed × 19 种装备 × 20 次：vampirism/venom/vitality 出现 0 次，CE 符文均出现
       AssertionError: 武器符文 vampirism 不应出现在生成流中: expected 81 to be +0
     × 整层生成扫描 > 520 层生成的地面/机器/祭坛/金库物品中自创项出现 0 次
       AssertionError: 整层生成撞见自创项：vampirism: expected [ 'vampirism' ] to deeply equal []
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

还原后复跑：6/6 通过。四层防护（池直查 / 附魔路径 / 装备随机流 / 整层扫描）全部能捕获回退。

---

## 7. 与预设不符之处（只列不修）

1. **（v2 重要发现）c0dc248 已提交版本存在两处漏网**，本轮补上：
   - `potion_of_poison` 未被判为自创（v1 与验收方均漏判；CE potionTable 16 种无 poison）；
   - `enchantEquippedItem`（附魔卷轴送符文路径）仍是全量符文池——已提交版本的报告把 §10-1 整体判为"行为偏离"，但其中"送符文的池子"满足本轮判定标准。v1 报告该行的判定有误，本版已修正。
2. **（v1 报告遗留修正）**v1 报告 §0 写"npm test 有 2 个既有用例失败"——该状态已被验收方在 c0dc248 中处理（两处流耦合断言改为下限断言），本版终态全绿。v1 报告 §4-4 的"部分未达成"随之解决。
3. **提示词漏列 6 项自创条目**（potion_of_healing、potion_of_poison、wand_of_fire、wand_of_lightning、staff_of_light、halberd），已按任务"发现遗漏一并处理"的指示退池。任务已确认的 3 项（amnesia、vampirism、venom、vitality 中列出的符文）经 CE 源码复核**全部成立，无误判**。
4. **既有 bug（未修，超出本轮边界）**：机器房宝藏的 `spawnScroll('scroll_of_enchanting', …)` id 拼写错误——web 数据中的合法 id 是 `scroll_of_enchantment`，故该分支恒返回 null、不放置宝藏。保持原样（只替换了 wand_of_fire 半边）；修复它会进一步改变 RNG 流，应与其它生成修正合并处理。
5. **命名差异（未改）**：web 武器符文 `paralyzing` 对应 CE "paralysis"；药水 `potion_of_haste` 对应 CE "potion of speed"；`charm_of_speed` 对应 CE "charm of haste"；`staff_of_fire` 对应 CE "firebolt"。均为拼写/本地化差异，非自创，保留现状。
6. 提示词边界写明 CE 表位于 `src/brogue/Globals.c` 等——实际 CE 源码在兄弟目录 `BrogueCE-master/src/`（web 仓库内无 C 源码），已按实际位置复核。
7. **c0dc248 提交信息的小出入**：称"附魔卷轴……改为从过滤池按深度取"仅指机器房硬编码那半边；同提交的 Game.ts 中 `enchantEquippedItem` 的两处硬编码全量符文池未改（本轮 v2 处理）。此外 v1 报告 §9 称"未执行任何 git 写操作"，而 c0dc248 的提交是验收方所为——特此说明以免混淆归责。
8. **（v2 过程记录）工作区存在并行会话**：本轮执行期间，另一会话的 P2-0 工作（存档实体 id 撞号修复、RNG 流量化 scratch 测试）实时落入同一工作区（GameCanvas.vue / Item.ts / Creature.ts / Monster.ts / Game.ts 的存档段 / zz_scratch_*.test.ts / p2_0_seeded_rng.test.ts）。其中 Monster.ts/Creature.ts/Item.ts 属本轮任务的禁触清单，v2 未触碰；v2 的改动与 P2-0 改动仅在 Game.ts 不同区域共存，互不重叠。**§8 的测试输出取自仅含 D2 增量（c0dc248 + v2）的树**；在其后包含 P2-0 半成品的树上运行会看到 P2-0 自己的失败（p2_0_seeded_rng 的实体 id 断言、zz_scratch_vue 的 window 依赖），与 D2 无关。

---

## 8. `npm test` 与 `npm run build` 完整输出尾部（v2 终态）

```
=== npm test 尾部 ===
 Test Files  25 passed (25)
      Tests  210 passed | 5 todo (215)
 Start at  10:15:44
 Duration  19.42s (transform 1.39s, setup 0ms, import 3.05s, tests 51.91s, environment 6ms)

=== npm run build 尾部 ===
dist/assets/CanvasRenderer-*.js   22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-*.js   38.19 kB │ gzip:  10.65 kB
dist/assets/index-*.js           886.65 kB │ gzip: 281.50 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 6.67s
```

## 9. `git diff --stat`（v2 增量，基于 c0dc248 之上，留在工作区）

v2 自身的改动（Game.ts 仅计 v2 的附魔路径 2 处替换，4 行）：

```
 brogue-web/ai_docs/invented_content_pool_report.md | 160 +++++++++++++-----
 brogue-web/src/data/consumables.json               |   1 +
 brogue-web/src/engine/Core/Game.ts                 |  4 +-→ （与 P2-0 并行改动共存于同文件不同区域）
 brogue-web/src/test/invented_content_pool.test.ts  | 96 ++++++++++++++++++--
```

（c0dc248 已包含 v1 的 arcana.json/weapons.json/consumables.json/ItemLoader.ts/Game.ts 改动、测试与本报告 v1。v2 增量未执行任何 git 写操作。工作区另含并行会话 P2-0 的进行中改动，见 §7-8，不属本轮。）
