# V-2b-2a 执行报告：放置旗标轮——CE `cellIsFeatureCandidate` 七步判定接入

任务书：`ai_docs/tasks/v-2b-2a.prompt.md`。全部改动在 worktree
`wt-v-2b-2a/brogue-web`（分支 `round/v-2b-2a`）工作区内，未执行任何 git 写操作，
未触碰 `src/data/blueprints.json` 与 `BrogueCE-master/`。

改动文件（`git diff --stat`，见文末）：`src/engine/Generator/BlueprintEngine.ts`
+ 新建 `src/test/v_2b_2a_placement_flags.test.ts`（27 用例）+
基线重捕获 `src/test/fixtures/generation_baseline.json`（最后一步）。

---

## 1. 七步判定的 web 落地（任务书 §1）

CE `cellIsFeatureCandidate`（`Architect.c:492-588`）整函数移植为
`BlueprintEngine.cellIsFeatureCandidate`（`BlueprintEngine.ts:1310-1390`），
七步顺序照抄。候选拾取结构在 `findFeaturePosition`（`:1207-1285`）重排为三路：

- **BATO**（`MF_BUILD_AT_ORIGIN`，`:1216-1229`）：过前置检查后恒返 origin；
- **全图扫描域**（`MF_BUILD_IN_WALLS` / `MF_BUILD_ANYWHERE_ON_LEVEL`，
  `:1231-1247`）：DCOLS×DROWS 光栅扫描收集合格格（CE :1362-1377 的扫描序），
  `randRange(0, n-1)` 均匀取一（CE :1413 `rand_range(1, qualifyingTileCount)` 的等价）；
- **interior 域**（其余，含 NEAR/FAR_ORIGIN）：预洗牌 `availableCells`
  逐格过全判（`:1249-1284`）。

| 步 | CE 行号 | web 落地 | 说明 |
|---|---|---|---|
| 1. `MF_NOT_IN_HALLWAY` | :504-510 | `cellIsFeatureCandidate` :1322-1325 | `passableArcCount > 1` 拒。**先于 origin 检查**（CE 注释明言，T10 对抗钉死）。origin 是走廊/边界 → BATO feature 无落格 → min 检查整机失败 |
| 2. `MF_NOT_ON_LEVEL_PERIMETER` | :512-516 | :1327-1331 | `x==0 ∥ x==DCOLS-1 ∥ y==0 ∥ y==DROWS-1` 拒 |
| 3. `MF_BUILD_AT_ORIGIN` | :518-524 | :1333-1339 + `findFeaturePosition` :1216-1229 | origin 恒合格（反之仅 origin）；`BP_ROOM` 的 origin 对其余 feature 不是候选（web 此前由 door 预留结构性承担，本步补上显式判定） |
| 4. `MF_BUILD_IN_WALLS` | :558-575 | :1345-1367 | 墙（四层旗标并集含 `T_OBSTRUCTS_PASSABILITY`）、非 interior、machineNumber 0 或本机、四正方向之一是 interior（非 origin）或（`BUILD_ANYWHERE` 下）非 `T_PATHING_BLOCKER` 且 machineNumber==0 |
| 5. 墙拒 | :575-576 | :1369-1372 | 未明令不得建在墙里 |
| 6. `MF_BUILD_ANYWHERE_ON_LEVEL` | :577-583 | :1374-1386 | 带 `MF_GENERATE_ITEM` 时排除 `T_OBSTRUCTS_ITEMS|T_PATHING_BLOCKER` 与 `IS_CHOKEPOINT|IN_LOOP|IS_IN_MACHINE`；否则只要求不在机器内 |
| 7. interior | :584-585 | :1388-1389 | `interior` 集合（web 的 `room.cells`，`:818`） |

CE :526-529 的 occupied 检查由调用方的 `used`/`struck` 排除承担
（`usedCells` = center/door 预留 + personalSpace + 已落格；CE 语义同集）。

### web 缺失判据的处置

- **`passableArcCount`**：web **有**——`ItemSpawnHeatMap.ts:113`（CE :171 逐句
  移植，含 `cellIsPassableOrDoor` 的密门/锁门豁免，C-4a 落地）→ 直接 import 使用。
- **`IN_LOOP`**：web **有** CE 口径移植——`LoopMap.ts:359 analyzeLoopMap`（C-0）。
  引擎内懒算一份**陈旧快照**（`getLoopMap` :1393-1398）：CE 的 pmap IN_LOOP
  同为建层期 `analyzeMap` 预计算、机器阶段不重算；失效点与 `gateAnalysisCache`
  一致（机器建成 :1056-1058、失败回滚 `restoreLevel` :1189 内）。
- **`IS_CHOKEPOINT`**：用 `analyzeChokeMap` 的 `chokepoint`（web 既有
  IS_CHOKEPOINT 等价物，`gateSite` 同源）。已知留形：其 passMap 口径是
  `terrainAllowsMove`（web 移动图）而非 CE 的 `T_PATHING_BLOCKER`。
- **`viewMap`（CE :531-535，`MF_IN_VIEW_OF_ORIGIN` 族）**：web 无载体无实现，
  生产数据零旗标 → **登记缺口**，不假装有。
- **`distanceMap` 界（CE :537-557）**：web 无 interior 路径距离直方图
  （CE :1257-1288 的 distance25/75 分位设施）。NEAR/FAR 以曼哈顿最近/最远
  选格近似（V-2b-1 已登记的留形族），距离界折叠进选格策略而非候选判定。

## 2. 其余旗标的落地（任务书 §2）

| 旗标 | CE 行号 | web 落地 |
|---|---|---|
| `MF_EVERYWHERE` | :1387-1394 | `applyBlueprint` :825-831、:856-857：`everywhere` 时循环到候选耗尽、**不掷 instanceCount**。`:1387` 的 `& ~MF_BUILD_AT_ORIGIN` 屏蔽按位直译后语义空转（见 §5.2） |
| `MF_FAR_FROM_ORIGIN` | :1340-1341 | `findFeaturePosition` :1249-1274：与 NEAR 同族的曼哈顿镜像（最远未用格）；不改 NEAR 既有行为（T11 钉死双向） |
| `MF_PERMIT_BLOCKING` / `MF_TREAT_AS_BLOCKING` | :1439、:1444-1452 | `applyBlueprint` :888-903：落地形前，无 PERMIT 且（地形 `isPathingBlocker` ∨ feature 带 TREAT）时做阻断否决——单格 blockingMap + `levelIsDisconnectedWithBlockingMap(...) === 0 && !levelIsDisconnectedOnMovementGraph(...)` 两查并列（口径依据见 §5.1）。否决失败：不落格、不占坑、不计 instance、不产物品/怪物（CE :1461 守卫语义；成功分支 `:939-1023` 重排承载） |
| `MF_IMPREGNABLE` | :1491-1493 | `applyBlueprint` :956-958：落位格进 `impregnableCells`（引擎级格键集合，随 `backupLevel`/`restoreLevel` :1147/:1169 整图快照回滚）；读口 `isImpregnable` :1404-1406。载体缺口见 §7 |
| Q 族（`MF_NO_THROWING_WEAPONS` / `MF_REQUIRE_GOOD_RUNIC` / `MF_REQUIRE_HEAVY_WEAPON`） | :1506-1509（generateItem 重掷条件） | `applyBlueprint` :974-985：随 `MF_GENERATE_ITEM` 指令下传 `itemQualifiers`（`MachineResult.itemSpawns` 扩展字段）。**消费缺口见 §7**：物品实化在 `Game.spawnBlueprintItem`（Game.ts 不在授权清单），CE 的「不合格重掷 + failsafe 1000」过滤循环未接线 |
| `MF_REPEAT_UNTIL_NO_PROGRESS` 真循环 | :1360-1670 | `applyBlueprint` :832-1031：整轮包进 do-while——每轮重掷 instanceCount（:856）、落位、`while (REPEAT && 本轮落位 ≥ min)` 续轮；min 检查只看最后一轮且被 REPEAT 豁免（:1030-1038）。旧 web 的「仅豁免 min」由 T6 的两用例（min 豁免 + RNG 记账）钉死 |
| `MF_KEY_DISPOSABLE` | — | 本轮不实现（任务书 §3 指定归 V-2b-6 钥匙轮）；载体普查钉在测试 P1 |

随带的 CE 结构还原（同段代码内）：

- **实例循环守卫**（CE :1399 的 `qualifyingTileCount` 预算）：每次拾取无条件
  消耗预算（:862 `picksLeft--`）；BATO 的候选表只含 origin → 每轮恰一次拾取
  （`instanceCount≥2` 的 BATO feature 也只落一实例——CE 字面行为；生产 BATO
  全为 [1,1]，零流影响）。该预算同时防住 EVERYWHERE+BATO 死循环。
- **候选 strike**（CE :1430-1432）：拾取即 strike（:875），成败与否本轮不再
  回头；REPEAT 每轮候选重建（`struck` 轮首重置）。
- **feature 格并入机器**（CE :1486-1488）：wall/anywhere 域的格外格在落位
  成功后补写 `machineNumber`（:952-953）。
- **基址键统一**：`usedCells`/`struck` 统一为 `cellKey` 数字键（`y*DCOLS+x`，
  与 impregnableCells/interiorSet 同口径）；`markPersonalSpace` 补 CE :1468 的
  in-map 守卫（数字键下出界格会与邻行末列碰撞，必须显式剔除）。

## 3. 生成流影响与逐旗标归因（任务书 §3/§5）

**载体普查实测**（任务书 §6.2 要求复核，测试 P1 钉死）：与任务书 §3 表一致——
4 载体旗标（PERMIT_BLOCKING×7、IMPREGNABLE×1、TREAT_AS_BLOCKING×1、
NOT_IN_HALLWAY×1）+ 本轮不实现的 KEY_DISPOSABLE×2；其余 9 种旗标零载体。
未发现任何旗标经由默认值/代码硬编码/蓝图级旗标下放等旁路进入生产路径。

**基线偏离：4/104 层**（seed20260913 D15/D19、seed31337 D11/D15，均仅
`fp` 地形指纹字段；n/species/items 无偏离）。

**逐旗标归因方法**：受控单变量——在最终代码上逐个禁用单旗标的实现
（单行 toggle），跑与基线同口径的 4 seed × D1-26 全量采集，与最终基线逐层
对比（脚本在 /tmp，不进仓库）：

| 旗标 | 实现内容 | 贡献偏离层 | 归因 |
|---|---|---|---|
| `MF_PERMIT_BLOCKING` | 阻断否决 | **4/4** | 否决落在**无 PERMIT** 的 5 条阻断地形 feature（vestibule_pit_traps / key_fire_trap / key_poison_gas 的 TRAP+PRESSURE_PLATE、key_flood_trap 的 WATER_DEEP、key_lava_moat 的 LAVA——全部 `T_PATHING_BLOCKER`）：切断关卡 → 实例否决 → 否决耗尽使 min 不达 → 整机失败换蓝图重试 → 机器构成改变。PERMIT 的 7 条载体本身走旁路（有 PERMIT 即跳过检查），不是偏离来源 |
| `MF_TREAT_AS_BLOCKING` | TREAT 项触发否决 | 0 | key_secret_room ALTAR 的候选格在 4 seed 的相关层上均不切断（禁用 TREAT 项采集与最终基线逐位一致） |
| `MF_NOT_IN_HALLWAY` | 走廊格过滤 | 0 | 同 feature 的候选格 `passableArcCount ≤ 1`（禁用过滤采集逐位一致） |
| `MF_IMPREGNABLE` | 置位（零 RNG） | 0 | 禁用置位采集逐位一致——符合预期：置位不掷骰、生成期无消费者 |

**零载体旗标的合成验证**（无生产载体 ≠ 可以不验）：27 用例全绿
（`src/test/v_2b_2a_placement_flags.test.ts`），对抗面逐条见该文件头注——
NOT_IN_HALLWAY（T1）、NOT_ON_LEVEL_PERIMETER（T2）、BUILD_IN_WALLS 含
4-正邻接与机器并入（T3）、BUILD_ANYWHERE_ON_LEVEL 含物品排除（T4）、
EVERYWHERE 含「不掷 instanceCount」的 RNG 记账（T5）、REPEAT 真循环含
RNG 记账与「跨轮不累加」（T6）、阻断否决三态 + min 失败（T7）、IMPREGNABLE
置位与整图回滚（T8）、Q 族下传（T9）、前置检查先于 origin（T10）、
FAR/NEAR 镜像（T11）。

**反向验证**（约定 §5.2，两轮，输出已留在执行记录）：

1. 注入 `NOT_IN_HALLWAY` 检查缺失（`if (false && ...)`）→
   `Tests 2 failed | 25 passed`（T1 落位断言 + T10 origin 顺序断言翻红）→ 还原。
2. 注入否决缺位（`if (false && !fFlags.has('MF_PERMIT_BLOCKING') ...)`）→
   `Tests 5 failed | 22 passed`（T7a/T7c/T7d + T1/T10，后者为同脚本失误把
   还原①覆盖，双重注入下翻红面更大）→ 全部还原（`grep -c "false &&"` = 0，
   27/27 复绿）。

## 4. 撞断的守卫与处置

| 守卫 | 表现 | 处置 |
|---|---|---|
| `blueprint_center.test.ts` b/c/e（12 seed 全局扫描） | 开发中途翻红：center 违例 1 条（WATER_DEEP） | **根因是实现 bug 而非行为变更**：`usedCells` 键格式混用（`"x,y"` 字符串 vs `cellKey` 数字串）致 center/door 预留失效。统一键格式 + `markPersonalSpace` 补边界守卫后复绿（5/5，且机器数 179→195 表明此前的预留失效确实改变了生成——修复后的全量基线以修复后的代码重捕获） |
| `generation_baseline.test.ts` | 实现完成后预期红（4 层偏离，§3 归因） | 按 §5 最后一步重捕获（seeds 不变，note 追加本轮段）；最终全量轮复绿 |
| **`c_4b_dungeon_feature.test.ts` F1（最终全量轮唯一红）** | 静态扫描抓到 DF 子系统符号进入生产代码：`engine/Generator/BlueprintEngine.ts` 引用 `createSpawnMap`（:30/:893）与 `levelIsDisconnectedWithBlockingMap`（:32/:901） | **边界冲突，按约定「宁可红，不可绕」停在申报，未动手**：该测试不在任务书 §4 授权清单。本轮把 BlueprintEngine 接到 DF 子系统的阻断否决（`DungeonFeature.ts` 只读复用）正是任务书 §2 要求的实现；F1 的白名单扩展点写在它自己的标题里（「C-4d 接线机器时再扩清单」），C-4d 未发生，本轮即首个机器侧合法消费者。**请验收方顺延**（不放宽）：往 F1 的 `allowed` 集合加一行 `'engine/Generator/BlueprintEngine.ts'`（越界守卫保留——白名单外仍全红）。扫描器对 `levelIsDisconnectedOnMovementGraph` 无匹配项，顺延时可视其是否在守护意图内一并考虑 |

执行方自省：约定「四段 grep」的第 ④ 段（拿扫描器自己的 pattern 去搜）我只对
`c_4a` 的 mechFlags/promoteType 扫描器跑过，漏了对 DF 符号扫描器
（`spawnDungeonFeature|spawnMapDF|fillSpawnMap|levelIsDisconnectedWithBlockingMap|catalogFeature|createSpawnMap|…`）
自查——若跑了，写任务书前就能发现 F1 需要提前授权。这一步缺失的责任在执行方。

## 5. 行使授权反驳之处

1. **阻断否决的判据口径（§2 表格行）**：任务书写「走 levelIsDisconnected 判定，
   web 已有该判定（`levelIsDisconnectedOnMovementGraph`，C-8 落地）」。CE 实际
   单查 `levelIsDisconnectedWithBlockingMap`（`Architect.c:1451`；提示词点名的
   是 web 移动图变体）。**处置：两查并列**——与 C-8 在 `spawnDungeonFeature`
   的 DF 落位守卫里已确立的生产惯例完全同形（`DungeonFeature.ts:738-742`，
   「任一判切断即否决」）。理由：web 移动图对 CHASM/LAVA 的可走性使 CE 单查
   存在 C-8 论证过的盲区，而 `key_lava_moat`（LAVA）正是本轮的否决作用面；
   p1_26 的端到端可达性口径是 web 移动图，单查 CE 口径可能放行会把楼梯封死
   的落格。两查皆纯泛洪零 RNG。**这是对 CE 字面的有意加严**（多否决、不多放行），
   若验收方裁决应逐字 CE 单查，改动点在 `BlueprintEngine.ts:897-899` 一处。
2. **§3 表格的机理更正**：「MF_PERMIT_BLOCKING 本轮实现 → 会动生成流」的
   实际作用路径不是它的 7 条载体（PERMIT 即旁路），而是否决检查落在**无
   PERMIT** 的 5 条阻断地形 feature 上（§3 归因表）。归因结论与表格的
   「会动」判断一致，机理不同。

## 6. 门禁输出（最终代码 + 新基线，并行口径）

### `npx vitest run`（并行、无文件参数、无 `--fileParallelism=false`）

```
 ✓ src/test/generation_baseline.test.ts (1 test) 34795ms
     ✓ 4 seed × D1-D26：地形指纹 / 怪物数 / 物种集合 / 物品数与基线一致  34794ms
 ✓ src/test/v_1c_machine_structure.test.ts (12 tests) 28769ms
[bp-center] 扫描 12 seeds × 26 层 = 312 层，共 195 台 machine，center 违例 0 条（涉及 0 层）；
不可通行 terrain 分布：（无）
[bp-center] center 上共见到 0 件宝藏：（无）；宝藏违例 0 条
 ✓ src/test/blueprint_center.test.ts (5 tests) 76770ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/test/c_4b_dungeon_feature.test.ts > C-4b F：留痕（本轮明确不做的事；C-4c 翻转） > F1 留痕：DF 子系统符号的生产引用只出现在白名单文件（C-4d 接线机器时再扩清单）
AssertionError: DF 子系统被生产代码引用（本轮是纯库）：
engine/Generator/BlueprintEngine.ts:30: createSpawnMap,
engine/Generator/BlueprintEngine.ts:32: levelIsDisconnectedWithBlockingMap,
engine/Generator/BlueprintEngine.ts:893: const blockingMap = createSpawnMap(this.grid);
engine/Generator/BlueprintEngine.ts:901: levelIsDisconnectedWithBlockingMap(this.grid, blockingMap, false) === 0: expected [ …(4) ] to deeply equal []

 ❯ src/test/c_4b_dungeon_feature.test.ts:918:77

 Test Files  1 failed | 93 passed (94)
      Tests  1 failed | 1209 passed | 8 skipped | 5 todo (1223)
 Start at  23:13:18
 Duration  475.12s (transform 3.60s, setup 0ms, import 38.99s, tests 4110.65s, environment 39ms)
```

唯一红 = §4 表格第三行申报的边界冲突（c_4b F1 留痕，白名单外引用）；
除此之外全量 1209 用例零红，含本轮 27 个新用例与重捕获后的基线。

### `npm run build`

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.43s
```

（chunk 体积警告为存量现象；类型门禁 `vue-tsc -b` 含 `noUnusedLocals` 通过。）

## 7. 与预设不符之处（只列不修，含边界冲突申报）

1. **Q 族的消费点在 `Game.spawnBlueprintItem`（Game.ts:863 起）——授权清单
   漏项申报（ conventions「漏授权」第 ② 形态的再现，第 7 起）**：CE 的
   Q 族过滤发生在物品**生成**时（`Architect.c:1506-1517` 的重掷循环）；
   web 的物品实化在 Game.populateLevel → spawnBlueprintItem（chooseKind/
   附魔掷骰都在那里），BlueprintEngine 只产指令。本轮在授权范围内完成
   **指令侧**（`itemQualifiers` 随指令下传，T9 钉死），**过滤循环本体需要
   Game.ts 改动，未动手**——请验收方在 V-2b-2b 或补授权轮把它接上
   （接法：spawnBlueprintItem 收到 qualifiers 后按 CE failsafe 1000 重掷）。
2. **`MF_IMPREGNABLE` 的位载体不存在（Grid.ts 不在授权清单）**：CE 是
   pmap.flags 位、随 copyMap 整图回滚；web Cell 无该位。本轮以引擎级
   格键集合承载（置位/回滚/读口齐全，T8 两用例钉死），**消费缺口登记**：
   web 无隧道怪/挖墙攻击，唯一潜在消费者是 `crystalizeFromPlayer`
   （Game.ts:4918 一带的 IMPREGNABLE 守卫，注释自称「该位恒 0」——该注释
   自本轮起已过时，接线归隧道轮；Game.ts 未动）。
3. **`MF_EVERYWHERE & ~MF_BUILD_AT_ORIGIN` 在现行位定义下语义空转**
   （任务书 §2 称「屏蔽不是笔误」）：`MF_EVERYWHERE = Fl(15)` 是独立位
   （`Rogue.h:2600`），不含 `MF_BUILD_AT_ORIGIN` 位（Fl(6)），故
   `flags & MF_EVERYWHERE & ~MF_BUILD_AT_ORIGIN ≡ flags & MF_EVERYWHERE`，
   「EVERYWHERE+BATO 仍铺满」。推测该屏蔽是历史定义（EVERYWHERE 曾为
   复合位）的遗存。按位直译实现（只测 EVERYWHERE），行为与 CE 现行一致。
4. **BATO 每轮单拾取**：CE 的候选表对 BATO feature 只含 origin（qTC=1），
   故 `instanceCount≥2` 的 BATO feature 每轮也只落一实例——旧 web 会落
   `count` 个（每个实例都返回 origin）。生产 BATO 全为 [1,1]，零流影响；
   已按 CE 字面落实（预算机制）并留测试注释。
5. **featureDF 分支结构性缺口**：CE :1437-1440 在落位前 spawn
   `featureDF`（其 `abortIfBlocking = !MF_PERMIT_BLOCKING` 也是 PERMIT 语义
   的一半载体）；web FeatureDef 无 featureDF 字段 → 该分支不存在，登记。
   web 的 PERMIT 消费完全走地形侧（:1443-1452）。
6. **前厅机器的 origin 可被 interior feature 选中（CE 允许）、web 因 door
   预留恒排除**——先于本轮存在的近似（door 预留是 P1-20 的修复），
   本轮未改，列登记。
7. **IS_CHOKEPOINT 的 passMap 口径**（terrainAllowsMove vs CE
   T_PATHING_BLOCKER）——沿用 analyzeChokeMap 既有留形，见 §1。

## 8. 验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| §1 七步判定逐条接入、顺序照抄 | ✅ §1 表；T10 钉「前置检查先于 origin」 |
| §1 web 缺失判据如实处置（不假装有） | ✅ §1 处置清单；viewMap/distance25/75 登记留形缺口 |
| §2 EVERYWHERE/FAR/PERMIT+TREAT/IMPREGNABLE/Q 族/REPEAT 真循环 | ✅ §2 表；Q 族仅完成指令侧（§7.1 申报） |
| §3 零载体旗标不得移动生成流 | ✅ 合成蓝图验证 + §3 归因实测（NOT_IN_HALLWAY/TREAT/IMPREGNABLE 逐位零影响） |
| §3 KEY_DISPOSABLE 本轮不实现 | ✅ 未实现；载体普查钉在测试 P1 |
| §4 授权清单（blueprints.json 零改动） | ✅ 未触碰 blueprints.json / BrogueCE-master / Game.ts / Grid.ts；**授权清单外的 c_4b F1 撞红——按约定停红申报**（§4） |
| §5 基线最后重捕获 + 逐旗标归因 | ✅ 4/104 层，全部归因阻断否决；note 追加本轮段 |
| §6 授权反驳（两条复核） | ✅ 七步顺序与 CE 逐行核对一致（无反驳必要）；零载体判定实测复核一致（§3） |
| §7 门禁两命令 + 报告 | ✅ vitest 1 red（申报的 c_4b F1）/ 1209 绿；build 绿；本报告 |

## 9. diff 摘要

```
 brogue-web/src/engine/Generator/BlueprintEngine.ts      | 607 ++++++++++++++++-----
 brogue-web/src/test/fixtures/generation_baseline.json   |  12 +-
 2 files changed, 475 insertions(+), 144 deletions(-)
未跟踪：
 ?? ai_docs/reports/v-2b-2a.report.md            （本报告）
 ?? src/test/v_2b_2a_placement_flags.test.ts     （27 用例，本轮主验证面）
```

`generation_baseline.json`：seeds 不变（424242/777/20260913/31337 × D1-26），
`note` 追加本轮段（逐旗标归因结论写入），`capturedAt` 更新为本轮。
