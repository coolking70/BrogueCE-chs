# C-6 报告：runAutogenerators —— digDungeon 的最后一步

日期：2026-09-17。分支：`round/c-6`。执行：ZCode/GLM。
并行轮次：B-1b（鉴定持久化，文件边界已划开）。

---

## 一、CE 表的实际位置、条目数与赋值点（任务书 §二.1 交办）

任务书只找到 `Globals.c:50` 的指针声明。实际位置：

| 内容 | CE 位置 |
|---|---|
| `autoGenerator` 结构体 | `Rogue.h:2754-2772` |
| 指针声明（variant-specific） | `Globals.c:50`、extern 在 `Globals.h:82` |
| **brogue 变体表本体** | **`variants/GlobalsBrogue.c:111-171`** `autoGeneratorCatalog_Brogue[]`，**49 条**（下标 0-48） |
| 条目数 | `GlobalsBrogue.c:1047` `.numberAutogenerators = sizeof(...)/sizeof(autoGenerator)` |
| 指针赋值 | `GlobalsBrogue.c:1072`（`initializeBrogueVariant`）`autoGeneratorCatalog = autoGeneratorCatalog_Brogue;` |
| 同构另两份 | RapidBrogue `GlobalsRapidBrogue.c:111` / BulletBrogue `GlobalsBulletBrogue.c:110`（参数不同、结构相同） |

web 侧全量抄录为 `src/engine/Map/AutoGenerator.ts` 的 `AUTO_GENERATOR_CATALOG`（49 条，每条带 `ceLine`），数值列与 CE 原行的逐条对照钉死在 `c_6_autogenerators.test.ts` 的 `CE_ROWS` 表（49 行 × 6 数值字段）。

### ★ 授权反驳发现 1：CE 表下标 0 是永不执行的上游死条目

CE 循环是 `for (AG=1; AG<numberAutogenerators; AG++)`（`Architect.c:1786`）——**从下标 1 起**。
而 brogue 表下标 0 是一条真实条目（`DF_GRANITE_COLUMN`，GlobalsBrogue.c:114），RapidBrogue/BulletBrogue 同病（表首同为真实条目、无 `{0}` 占位）。全 CE 源码 grep 确认 `DF_GRAMITE_COLUMN` 除枚举定义与该表外零引用——**granite column 在真实 Brogue CE 里从不生成**。

按 D1（一律按 CE）：web 原样保留该条目，标 `carrier: 'dead-index0'`，循环同样从 1 起，**没有"修"它**。反转条件唯一：上游改循环起点或补占位（留痕 T5 写明）。

---

## 二、runAutogenerators 本体：CE 行号与复核要点

CE `Architect.c:1780-1863`；digDungeon 调用点 `Architect.c:2933`（false）与 `2952`（true）。
web 移植：`src/engine/Map/AutoGenerator.ts` `runAutogenerators()`；接线 `Generator/Architect.ts`
（false 趟在 `designEnvironmentOvelays` 的 fillLakes 之后、removeDiagonalOpenings 之前；
true 趟在 `generateLevel` 的机器阶段之后、finishDoors 之前——见 §六接线说明）。

逐条复核要点（均已按 CE 落地并有对抗断言）：

1. **两趟分流**：`(gen->machine > 0) == buildAreaMachines`（:1791，C 关系优先级高于相等）。
   AD-1 用合成目录证明分支写反必翻红。
2. **深度窗口含两端**（:1795-1797）。AD-5 钉死 5/8 边界可生成、4/9/40 不可。
3. **数量公式**：`count = min((intercept + depth*slope)/100, maxNumber)`（:1799，C 整数除法
   **向零截断**——web 用 `Math.trunc`；count 可为负，CE 原样）。AD-2 钉死：
   深度 1 草 = trunc(920/100)=9（漏 /100 得 10 → 翻红）、深度 14 = trunc(-120/100) = **-1**
   （floor 会得 -2，翻红）、封顶失效翻红。
4. **frequency 追加**：`while (rand_percent(frequency) && count < maxNumber) count++`（:1800，
   **掷骰在前、封顶判断在后**——count 已满时每次迭代仍掷骰）。写成 if → AD-3 翻红
   （实测 "expected 1 to be 5"）。
5. **落点原语** `randomMatchingLocation(..., -1)`（:3822-3845）：拒绝采样 500 次；
   要求 `layers[DUNGEON]==reqDungeon && layers[LIQUID]==reqLiquid`（NOTHING=0 也是真约束，
   拒绝一切带液体格）；CE 的 `HAS_PLAYER|HAS_MONSTER|HAS_STAIRS|HAS_ITEM|IS_IN_MACHINE`
   五旗标在生成期恒空（CE/web 同理：生物/物品/楼梯都在 dig 之后落位），web 投影为
   `machineNumber !== 0`；foundation 自身不带 `T_OBSTRUCTS_ITEMS` 时（FLOOR），拒绝四层
   旗标并集带 `T_OBSTRUCTS_ITEMS` 的格。**CE 越界细节照抄**：第 500 次抽出的坐标即使合法
   也返回 false（do-while 先自增再判断）——AD-6 钉死"恰消耗 1000 个随机数、返回 null"。
6. **DF 先落**：`spawnDungeonFeature(x, y, &DF, false, true)`（:1812，refreshCell=false 属
   游戏侧、web 签名无此参已登记；abortIfBlocking=true 对应 web 第 4 参 true）。
7. **terrain 分支（留形，见 §四）**：drawPriority 门槛（:1823）+ 单格连通性否决
   （:1826-1831）+ `layers[layer] = terrain`（:1833）。web 逐字对照见 §四。
8. **机器尝试在选点 if 之外**（:1852-1855，机器自找位置）。web 无 CE 机器系统，
   真实目录下此分支不可达（载体登记），合成目录下计入统计。

---

## 三、载体盘点表（49 条逐条裁决）

裁决规则（SESSION_HANDOFF「这一轮做了会不会是空壳？」）：只接全链有载体的条目；
**未接条目在循环里先于任何 RNG 消耗跳过**——自动生成器是无条件掷骰系统，
先选点再发现没载体就是 C-4c 硫矿式空转链。

| 下标 | CE 行 | 内容 | 裁决 | 理由 |
|---|---|---|---|---|
| 0 | 114 | DF_GRANITE_COLUMN | **dead-index0** | CE 上游死条目（§一 ★） |
| 1 | 115 | DF_CRYSTAL_WALL | no-tile | CRYSTAL_WALL tile 无 |
| 2 | 116 | DF_LUMINESCENT_FUNGUS | no-tile | tile 无（且牵光照） |
| **3** | **117** | **DF_GRASS** | **wired** | tile GRASS 已有；DF 条目本轮补入目录 |
| 4,5 | 118/119 | DF_DEAD_GRASS ×2 | no-tile | DEAD_GRASS 无（还有 DF_DEAD_FOLIAGE 链） |
| 6 | 120 | DF_BONES | no-tile | BONES 无 |
| 7 | 121 | DF_RUBBLE | no-tile | RUBBLE 无 |
| **8** | **122** | **DF_FOLIAGE** | **wired** | tile FOLIAGE 已有；DF 条目本轮补入 |
| 9 | 123 | DF_FUNGUS_FOREST | no-tile | FUNGUS_FOREST 无 |
| 10 | 124 | DF_BUILD_ALGAE_WELL | no-tile | 藻井三 tile 全无；光照属 C-7 |
| 11,12 | 125/126 | STATUE_INERT（墙/地板基座） | no-tile | tile 无 |
| 13 | 127 | TORCH_WALL | **c7-light** | 火把的全部语义是光照，C-7 不做 |
| 14-20 | 130-136 | 显陷阱 7 种（毒气/网/麻痹机/警报/混乱/喷火/灌水） | no-tile | CE 陷阱是独立 tile（T_IS_DF_TRAP + 显隐两态）；web 通用 TRAP+trapType 是自创语义，**不得冒充载体** |
| 16,23 | 132/141 | MT_PARALYSIS_TRAP_AREA(_HIDDEN) | no-machine | CE 机器系统 web 无对应物 |
| 21-28 | 139-146 | 隐陷阱 7 种 | no-tile | 同显陷阱（TM_IS_SECRET 态） |
| 29 | 147 | MT_SWAMP_AREA | no-machine | web 有 BOG tile 但 MT_SWAMP_AREA 是整机蓝图 |
| 30,31 | 148/149 | DF_SUNLIGHT / DF_DARKNESS | **c7-light** | 光斑液体，C-7 |
| 32 | 150 | STEAM_VENT | no-tile | tile 无（气体机制已有，tile 不在） |
| 33 | 151 | CRYSTAL_WALL（最深层直铺） | no-tile | 同 1 |
| 34-37 | 154-157 | DEWAR 四兄弟（+DF_CARPET_AREA） | no-tile | 玻璃容器 tile 无、CARPET tile 无（气体链 G 已收口） |
| 38 | 160 | DF_LUMINESCENT_FUNGUS（最深层灯海） | no-tile | 同 2 |
| 39-48 | 161-170 | MT_BLOODFLOWER/SHRINE/IDYLL/REMNANT/DISMAL/BRIDGE_TURRET/LAKE_PATH_TURRET/TRICK_STATUE/SENTINEL/WORM | no-machine | 同 16 |

**接入集 = {3, 8}**（`WIRED_AUTOGENERATOR_INDEXES`，测试钉死）。零空转哨兵：
真实目录机器趟零 RNG 消耗、零条目（AD-7）；统计里出现非 wired 下标即翻红（AD-8）。

---

## 四、留形分支逐字重核声明（任务书 §五）

本轮激活的留形分支：**无**（G-2 的 ALL_DIRS8 / C-2 的 pathingDistance 都是前轮留形、
本轮未激活新分支）。但本轮**写下**了一个新的留形分支，按「写留形时能固定就固定」处理：

- **terrain 分支**（AutoGenerator.ts，CE Architect.c:1822-1838）：当前真实目录无 wired
  的 terrain 条目（全部 no-tile/c7-light），分支只被测试合成目录行使。
  已逐字符重核 CE：
  - :1823 `tileCatalog[旧 layers[layer]].drawPriority >= tileCatalog[gen->terrain].drawPriority`
    → web `DRAW_PRIORITY[cell.layers[gen.layer]] >= DRAW_PRIORITY[gen.terrain]`（≥ 方向一致）；
  - :1826-1831 `zeroOutGrid + 单格标记 + !(T_PATHING_BLOCKER) || !levelIsDisconnected(...)`
    → web `createSpawnMap 单格 + (!blocker || levelIsDisconnectedWithBlockingMap(...)===0)`；
  - :1833 `pmapAt(...)->layers[gen->layer] = gen->terrain` → web `setTerrainLayer(x,y,layer,terrain)`。
  代码注释里已标"激活轮必须逐字符重核"。
- **CE 表数值列**（纯数据）已整表钉死：`CE_ROWS` 49 行 × 6 字段，另抽查死条目、
  深水基座枚举名（`TerrainType.WATER_DEEP`——任务书预警的 `DEEP_WATER` 陷阱未踩）、
  dewar 双列、wired 集恰为 {3,8}。
- **MT_* 数值**（MT_BLOODFLOWER_AREA=58 … MT_SENTINEL_AREA=71）为 Rogue.h:2668-2753
  逐位推算，注释与留痕 T3 都写明"激活轮重核"。

---

## 五、实测：实际生成数随深度分布（门禁 3）

`c_6_autogenerators.test.ts` 实测用例（2 种子 × D1-D26，built 口径，`--reporter=verbose` 可复跑）：

```
[c_6] 草/树生成数随深度分布（2 种子合计，built 口径）:
D1	grass=18	foliage=14
D2	grass=16	foliage=8
D3	grass=14	foliage=0
D4	grass=12	foliage=0
D5	grass=12	foliage=0
D6	grass=10	foliage=0
D7	grass=8	foliage=0
D8	grass=6	foliage=0
D9	grass=4	foliage=0
D10	grass=4	foliage=0
D11-D26	grass=0	foliage=0
```

草曲线与 CE 公式 `(1000-80d)/100` 逐层精确吻合（D1=9/层×2种子=18 … D10=2×2=4）。
树：公式只在 D1=6、D2=3 为正，D3 起为 0/负，只剩 frequency 15% 追加（这两个种子
D3-8 未掷中——断言按 CE 语义写，不要求 D3-8 必有）。

**F-0 附录 A 探针复跑**（恢复→跑→已删，`--disable-console-intercept`）：

```
[DETERMINISM] seed=42 turns=120 identical=true        （改动后）
[DETERMINISM] seed=2026 turns=120 identical=true      （改动后）
[DMG-GAS] seed=42 type=34 hpDeltas=[2,2,2,2,2,2,2,2,2,2,1,2]   ← 改动前后逐位一致
[DMG-GAS] seed=42 type=250 hpDeltas=[0,0,0,0,0,0,0,0,0,0,0,0]  ← 逐位一致
[DMG-GAS] seed=42 type=35 statuses=[confused×12]               ← 逐位一致
```

改动前基线（用 `git show HEAD:` 在仓库外搭的 HEAD 副本跑同一探针，只读 git）：
gas 注入曲线机制值不变；**FIRE-NAT 取景点全部移位**（42:(5,20)→(21,2)、
2026:(10,10)→(48,18)、777:(14,5)→(51,4)）——地图组成的直接证据。
**NATURAL 段 flammableTerrain（D1 可燃地形数）：84-162 → 347-466**——CE 草/树
自动生成使 D1 可燃物翻约 3 倍（真实 Brogue 的草原层正是如此），这是本轮最大的
玩法可见变化，火系威胁随之上升，属 CE 忠实的预期后果。

---

## 六、接线位置与 CE 顺序差异（沿 C-2/C-3 既登记项）

CE digDungeon：fillLakes → **runAuto(false)** → removeDiagonalOpenings → addMachines →
**runAuto(true)** → cleanUpLakeBoundaries → bridges → finishDoors → finishWalls(true)。

web（Game.generateLevel 结构不动，Game.ts 禁改）：
`generateTerrain`：… → fillLakes → **runAuto(false)** → removeDiagonalOpenings →
cleanUpLakeBoundaries → bridges（false 趟与 CE 相对位置一致）；
`generateLevel`：placeTraps（web 自创，保留）→ 机器 → **runAuto(true)** → finishDoors →
finishWalls(true)（true 趟与 addMachines 的相对位置一致；湖泊清理/架桥前移是
C-2 头注既登记的结构差，本轮未新增偏差）。

---

## 七、既有测试断言的到期更新（逐条说明）

允许清单 ①② 内、只改因本轮行为变化而到期的断言，未放宽任何守卫：

1. **c_3_walls_doors T14**：删除 `runAutogenerators` 留痕断言（其自带指示：
   "C-6 落地后删除本断言"）。原断言内容存档于注释；overlay 占位退出的复核结论
   也写在原位（保留 web 自创 overlay，理由见 §九）。
2. **c_4b E1**：目录条目数 26 → 28（C-6 增 DF_GRASS/DF_FOLIAGE），新增两枚举 id 对位断言。
3. **c_4b E2**：闭包起点增 C-6 二起点（autoGenerator 表 index 3/8 的 DFType 列），
   闭包 26 → 28。守卫（集合恰好相等）原样。
4. **c_4a_0 setTerrainLayer 白名单**：按断言自带指示把 `engine/Map/AutoGenerator.ts`
   加进 ALLOWLIST（terrain 留形分支是新的合法调用点）。越界守卫保留。
5. **c_4b F1 白名单**：同上加 AutoGenerator.ts（runAutogenerators 是 DF 子系统的新
   生产消费者）。越界守卫保留。
6. **c_4b F3**：前提前提——"生产生成路径每格至多一层非空"被 C-6 合法推翻
   （草/树落 SURFACE、DUNGEON 保持 FLOOR，CE 语义：草长在地板上）。
   翻转后守卫更细：两层格必须满足 CE fillSpawnMap 优先级门（基座 whitelist
   {DUNGEON:FLOOR, LIQUID:WATER_SHALLOW/CHASM_EDGE/OBSIDIAN} × DRAW_PRIORITY 比较），
   **GAS 恒空断言原样保留**。实测出现的三种两层形态：
   `FLOOR+GRASS`、`FLOOR+FOLIAGE`、`WATER_SHALLOW+FOLIAGE`、`CHASM_EDGE+GRASS`
   ——后两种是 CE :3228 优先级门（80≥60、55≥45）的忠实产物。
7. **c_5 对抗①**：坠落回合 RNG 消耗 pin 7550 → 12327。这不是坠落行为断言：
   pin 值 = "D2 一层的固定生成成本"，C-6 的 DF 传播骰（spawnMapDF 每波逐格掷骰）
   + 选点抽取合法地计入了生成账；断言结构（坠落消耗 == 生成成本，多一分即
   坠落门漏 return）原样，机制断言（rat 不推进、坠落掉血）全绿。
8. **horde_terrain_spawn**：`terrain === FLOOR` → `layers[DUNGEON] === FLOOR`。
   原断言前提（生成期不存在"地板上的表面覆盖物"）被 C-6 推翻：草盖的地板是
   CE 的合法落怪点。守卫本意（落格必是真实地板，墙/液体/渊照旧翻红）保留。

---

## 八、反向验证（真实改坏 → 红输出 → 还原，共 6 处 ≥ 要求的 4 处）

全部改在 `AutoGenerator.ts`，每次改后跑 `c_6_autogenerators.test.ts`，记录真实失败输出后还原：

| # | 突变 | 真实失败输出（节选） |
|---|---|---|
| M1 | 两趟分流 `!==` → `===`（写反） | `AD-1 ×`：false 趟 entries 变 `[2]`（应为 `[1]`）等 8 处翻红 |
| M2 | 数量公式删 `/100` | `深度 1：trunc((1000-80)/100)=9（漏 /100 得 10）: expected 10 to be 9` |
| M3 | `while` → `if` | `frequency 100 追加到 maxNumber=5: expected 1 to be 5` |
| M4 | 删载体跳过（`if (false && …)`） | `统计里出现了非 wired 条目 index 4`；`expected [ { index: 39, count: 1, … } ] to deeply equal []`（机器趟空转） |
| M5 | 整个 foundation 判据禁用 | `草落在非 FLOOR 基座 (17,6)`；`草落在无深水基座的格 (2,4)` |
| M6 | 深度窗口 `depth < min ‖ depth > max` → 写反 | `AD-5 ×`：窗口外 [4,9,40] 生成、窗口内 [5,8] 不生成 |

还原后 17/17 全绿；`git status` 复核无残留。
另有一处**计划外发现**：只禁用 DUNGEON 子句（M5 第一形态）不翻红——
墙格被 `T_OBSTRUCTS_ITEMS` 检查兜住（FLOOR 基座拒一切带物品阻挡旗标的格），
两条子句互为冗余之一；整段禁用才翻红。此冗余与 CE 一致，是 CE 的双重防线，非 web 缺陷。

---

## 九、门禁逐条对照

1. **反向哨兵（火/气体曲线、坠落/桥断言不变）**：未触碰任何火/气体/坠落代码
   （diff 文件清单为证）。f_1 / f_2a 机制用例 / f_2b 机制用例 / f_2c 机制用例 /
   c_5 坠落机制用例全绿；**翻红的均为"锚定流位置/真实地图"的基线哨兵**（见 §十），
   与 C-5 轮 FIRE-NAT 翻红同构，且对照实验（HEAD 副本 98/98 绿）证明翻红
   全部由本轮流位移引起、无机制变化。
2. **载体盘点表 + 取舍**：§三。
3. **实测生成数随深度分布**：§五。
4. **坏层闸门 p1_26 / p1_29 / p1_33 = 0**：单跑复验通过（串行批量内
   `p1_26_invariants` / `p1_29_lake_connectivity` / `p1_33_machine_chokepoint` 全绿）——
   新增自动生成物（草/树，非阻断地形，且 spawnDungeonFeature 连通性否决在位）
   未切断任何关卡。
5. **generation_baseline 预期变红，未刷新**：4 seed × D1-D26 的 fp/怪物/物种/物品
   全部偏离（diff 数百行）。**请验收方授权重捕获**（重捕获脚本口径见该测试头注）。
6. **npm run build 绿**：`✓ built in 5.20s`（输出尾部见 §十二）。

---

## 十、全量门禁结果与剩余红灯清单（如实报告）

`npx vitest run --fileParallelism=false`（串行，全量）终态（尾部输出见 §十二）：
**12 文件 16 用例翻红 | 893 绿**。逐条甄别（对照实验：HEAD 副本上同批文件 98/98 全绿）：

### A. 预期红——锚定 RNG 流位置 / 真实地图的基线哨兵（机制未变，需验收方处置）

| 文件 | 用例 | 红的成因 | 处置建议 |
|---|---|---|---|
| generation_baseline | 4seed×D1-26 全量 | 任务书明示预期 | 验收方授权重捕获 |
| g_1 / g_2 / g_3 / f_2c 对抗⑩ | FIRE-NAT seed42/2026/777 曲线 | 文件自带指示："任何改变生成的轮次都会翻红，需同样重捕获，两处一起改"（C-5 先例：验收方重捕获） | 同一程序：重捕获 5 处取景点+曲线 |
| f_2a 对抗⑪ / f_2b 对抗⑦ / f_2c 对抗⑪ | 气体注入合成房间曲线 ±1 漂移 | 气体消散/重铺本身消费 RNG（Gas.ts:394/416/418），注入时刻的流位置因 C-6 新增生成骰而后移 | 重录三条基线（机制断言 f/g 链全绿为独立证据） |
| c_5 对抗⑧ | 合成场景火曲线 | 场景铺完虽复位流，但 14 回合内怪物 AI 与火共享全局流——地图变 → 怪物耗骰形态变 → 火骰漂移。该哨兵的"不受地图生成变化影响"声明对流位移不成立（结构性误设，非本轮过错） | 验收方决定：重录曲线，或把场景彻底隔离（不推荐在本轮动） |
| c_5 对抗③ | 落地伤害样本方差 0.522（<0.5 不成立） | 40 个种子对应的 40 次伤害骰因流位移整体换样；机制的 [8,10] 边界断言仍过，纯抽样运气（新样本集的经验方差落在拒绝域） | 复跑核验后重锚（或扩样本数降噪） |
| armor_model_effect | 5档×20seed×400回合聚合 | 400 回合游玩聚合对地图组成/流位移敏感 | 验收方决定阈值口径 |
| b_1a_identification A13 | **B-1b 的 RNG 流哨兵** | 本轮移动了 RNG 流（A13 明文禁止——对 B-1b 轮次而言）。**B-1b 并行协调项**：两轮合并时该哨兵必红一次，需与 B-1b 验收方对齐重捕获顺序 | 与 B-1b 合并处置 |
| p2_1 B2b | spy 计数 2≠1 | 场景前提"数组第一只非笼怪"随怪池变化，其余怪的 tick 速度谱改变调度迭代数；tick 机制本身不受影响（B2a 等机制用例绿） | 验收方复核后改用确定性注入场景 |
| c_0 A4 | 判据写反变体门位 2057 vs 正确 691（比 2.978 < ×3） | 比值守卫在随机地图上本就临界（门位数随流位移重抽）；「阈值不许松」适用，本轮不动 | 验收方重校倍数或改锚定合成输入 |

### B. 到期更新后已翻绿（§七 所列 8 处）

c_3 T14（删留痕）、c_4a_0 白名单、c_4b E1/E2/F1/F3、c_5① pin、horde 落点判据。

---

## 十一、对抗性测试清单（c_6_autogenerators.test.ts，17 用例）

- AD-1 两趟分流写反（合成目录双向验证）
- AD-2 数量公式 /100、maxNumber 封顶、负数向零截断（三向）
- AD-3 frequency 追加写成 if / 漏掉
- AD-4a 落点不检查 DUNGEON 基座（草铺上墙）
- AD-4b 落点不检查 LIQUID 基座（深水基座只落深水格）
- AD-5 深度约束写反 / 边界含端写错
- AD-6 randomMatchingLocation：500 次全败 null + 恰 1000 抽 + 机器格占用拒绝
- AD-7 表保真（49 行 × 6 字段全量对照 + 死条目 + 深水枚举名 + wired 集）
- AD-7 哨兵：真实目录机器趟零 RNG 消耗（空转链翻红点）
- AD-8 接线存在性与统计归位（generateTerrain/generateLevel 两趟）
- 实测：草/树随深度分布 + 深度窗口核对 + 反真空
- 哨兵 S-1：wired 集只含草/树（火/气体/坠落条目被接时必先过其哨兵套件）
- 留痕 T1-T5：光照（C-7）、陷阱族、机器族、装饰/dewar 族、index 0 死条目——
  每条写明激活轮与反转条件

---

## 十二、`npm test` 与 `npm run build` 输出尾部 / git diff --stat

全量串行（`npx vitest run --fileParallelism=false`）终态尾部：

```
 Test Files  12 failed | 65 passed (77)
      Tests  16 failed | 893 passed | 8 skipped | 5 todo (922)
 Start at  10:04:02
 Duration  408.21s (transform 3.14s, setup 0ms, import 33.09s, tests 3420.54s, environment 33ms)
```

16 条红 = §十.A 预期清单，逐一核对无计划外失败：
generation_baseline(1)＋FIRE-NAT 族（g_1×1、g_2×2、g_3×2、f_2c⑩×1）＋
气体流位移哨兵（f_2a×1、f_2b×1、f_2c⑪×1）＋c_5⑧③×2＋
armor_model_effect×1＋b_1a A13×1＋p2_1 B2b×1＋c_0 A4×1。
§七 的全部到期更新（c_3 T14、c_4a_0 白名单、c_4b E1/E2/F1/F3、c_5①、horde）
与 c_6 新测试 17 用例均绿。

```
 brogue-web/src/engine/Generator/Architect.ts       | 37 +++++++++++--
 brogue-web/src/engine/Map/DungeonFeatureCatalog.ts | 31 ++++++++++-
 brogue-web/src/test/c_3_walls_doors.test.ts        | 15 ++++--
 brogue-web/src/test/c_4a_0_layer_model.test.ts     |  3 ++
 brogue-web/src/test/c_4b_dungeon_feature.test.ts   | 60 +++++++++++++++++++---
 brogue-web/src/test/c_5_fall_subsystem.test.ts     |  9 +++-
 brogue-web/src/test/horde_terrain_spawn.test.ts    | 13 +++--
 7 files changed, 145 insertions(+), 23 deletions(-)
新增（未跟踪）：src/engine/Map/AutoGenerator.ts、src/test/c_6_autogenerators.test.ts
```

build：`✓ built in 5.20s`（vite 7，仅既有的 chunk 体积警告）。

---

## 十三、与预设不符之处（只列不修；含对任务书的反驳）

1. **任务书没找到表**——在 `variants/GlobalsBrogue.c:111`（§一）。
2. **CE 表下标 0 死条目**：任务书暗示 granite column 是可接条目（示例里提到它）；
   实际它在 CE 永不执行，接了反而违背 CE。未接，留痕 T5。
3. **"C-7 光照不做"之外**，DF_SUNLIGHT/DF_DARKNESS 连 tile 都没有
   （SUNLIGHT_POOL/DARKNESS_PATCH 未迁），C-7 落地时需先补 tile 再接表。
4. **web 自创 overlay 与 CE 草/树并存**：c_3 T14 留痕让"复核 overlay 占位退出"，
   但深水 overlay 是 C-2 湖泊管线的 lakeMap 来源（拔除=管线级重构），且
   c_2_lakes/p1_29 等既有测试锚定其行为——本轮只登记不退出，**建议验收方
   单独立轮决定 overlay 退池的方式与顺序**（D2 口径：从生成池移除而非删除）。
5. **placeTraps（web 自创陷阱散布）与 CE 陷阱表并存**：本轮未接任何 CE 陷阱
   条目（无 tile 载体），placeTraps 维持现状。CE 陷阱 tile 落地后应按 D2 退池。
6. **fillLakes/湖泊走覆盖式 setTerrain**（C-2 现状）：湖格 DUNGEON=NOTHING，
   与 CE（DUNGEON=FLOOR + LIQUID=水）不同。对本轮无影响（两种形态都被
   foundation 检查拒绝），但 C-4a 的"每格多层"路线图中宜一并校正。
7. **f_2a 在允许清单①里但它的红灯是"气体断言一字不许动"的范围**——
   清单①的意图（"凡新增地形/DF 必打红"的结构性穷尽表）全部绿；红的是
   流位移类基线哨兵，不在"到期更新"授权内。按限定未动。
8. **c_0 A4 / c_5③ / armor_model / p2_1** 的红是**随机量守卫对流位移的脆弱性**
   （conventions §四已知问题的又一实证：单次抽样断言会因流位移假红——
   这次不是假红，是确定性真红，但成因同源：守卫锚定了会合法移动的量）。

---

## 十四、给 C-7 的登记清单

1. **待接条目**（c_6 留痕 T1）：TORCH_WALL(13)、DF_SUNLIGHT(30)、DF_DARKNESS(31)、
   DF_LUMINESCENT_FUNGUS 深层灯海(38)——carrier 翻 'wired' 的前置：先落
   SUNLIGHT_POOL/DARKNESS_PATCH/LUMINESCENT_FUNGUS/TORCH_WALL 四 tile +
   CE 光照目录（lightFlare/flashColor 数据已在 DF 目录登记但未实现）。
2. **CE 光照机制入口**：tile 目录 NO_LIGHT/LUMINESCENT_ALGAE_BLUE_LIGHT 等列
   尚无 web 投影；autoGenerator 之外，藻井链(10)与菌类(2)也依赖光照。
3. **翻转入口**：c_6 留痕 T1 + AutoGenerator.ts carrier 字段 + c_6 测试 AD-7 的
   wired 集断言（{3,8} → 加入新下标）。
4. **注意**：接 13/30/31/38 后 RNG 流再移，§十.A 的基线哨兵将再次翻红——
   建议与 B-1b 合并时的基线重捕获一次性做掉（对齐 §十 的协调项）。
