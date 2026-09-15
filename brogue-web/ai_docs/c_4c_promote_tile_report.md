# C-4c 报告：promoteTile + 每回合两趟驱动

> 执行：ZCode/GLM，2026-09-16。CE 源 = `BrogueCE-master/src/brogue/`（只读）。
> 本轮是 C-4 链第一个真改行为的轮次：门开/自动关门、踩楼梯晋升、硫矿/泥沼掷骰，
> 自本轮起全部按 CE 生效。

---

## 一、CE 行号与复核要点（全部本轮逐条打开核对）

### 1.1 promoteTile 本体 = Time.c:1244-1287

| CE 行 | 内容 | web 落点（Promotion.ts） |
|---|---|---|
| :1250 | `tile = &tileCatalog[pmap[x][y].layers[layer]]` | 读该层当前地形表项 |
| :1252 | `DFType = useFireDF ? fireType : promoteType` | 同式；目录名字符串 → DF 枚举（`resolveDFName`） |
| :1254-1257 | `TM_VANISHES_UPON_PROMOTION` → 清层；清 T_PATHING_BLOCKER 时 `rogue.staleLoopMap = true` | `setTerrainLayer` + 结果对象 `staleLoopMap` 登记（LoopMap.ts 禁改） |
| :1258-1261 | 清层目标：`layer == DUNGEON ? FLOOR : NOTHING`（"even the dungeon layer implicitly has floor underneath it"） | 同式（对抗测试 A2 钉死两支） |
| :1262-1264 | GAS 层连 `volume` 清零 | web Cell 无 volume（Grid.ts 禁改）、GAS 恒空，登记不实现 |
| :1267-1269 | `spawnDungeonFeature(x, y, &catalog[DFType], true, false)` | `spawnDungeonFeature(grid, x, y, catalogFeature(df), true)` |
| :1271-1286 | `TM_IS_WIRED` → `activateMachine`（含 IS_POWERED 扫清、`circuitBreakersPreventActivation` :1230-1242） | **显式未实现**（C-4d）：结果对象 `wiredBranchHit` 留痕，静态守卫测试 A6 钉死生产代码零接线符号 |

**先清层再 spawn 的机制**：DOOR(drawPriority 8) 晋升 OPEN_DOOR(25) 时，vanish 先把
DUNGEON 层写成 FLOOR(95)，随后 fillSpawnMap 的判据 `旧优先级数字 >= 新数字`
（95 ≥ 25）放行。跳过 vanish 直接 spawn 会被优先级判据挡住——A1 用例专打这条。

### 1.2 两趟驱动 = updateEnvironment（Time.c:1590-1705）中的 :1619-1663

- **第一趟（:1622-1651）只记位**：`promotions[i][j] |= Fl(layer)`。
  `Fl` = Rogue.h:97（`1 << N`）；被注释掉的 `// promoteTile(i, j, layer, false);`
  （:1647）是作者从一趟改两趟留下的痕迹。
- **promoteChance 两种算法**（任务书自承描述可能不准，以下按源码）：
  - `tile->promoteChance < 0`（扩散型，:1627-1640）：从 0 起，对 **4 向**邻居
    （`nbDirs` 前 4 项）逐个检查——在图内（:1630）&& 邻格四层旗标无
    `T_OBSTRUCTS_PASSABILITY`（:1632-1634）&& 邻格**同层**地形 ≠ 本格同层地形
    （:1635-1636）&& 本格未置 `CAUGHT_FIRE_THIS_TURN`（:1637，在邻居循环**内部**）——
    每个合格邻居 `promoteChance += -1 * tile->promoteChance`。
  - 否则（普通型，:1642）：`promoteChance = tile->promoteChance`。
  - 掷骰（:1644-1645）：`promoteChance && !(CAUGHT_FIRE_THIS_TURN) &&
    rand_range(0, 10000) < promoteChance`——**守卫短路在掷骰之前**（起火格不消耗
    RNG），**promoteChance=0 的层不掷骰**。两条都被对抗测试钉死（B2/B5）。
- **第二趟（:1652-1663）落地**：x→y→layer 序逐个 promoteTile。CE **不复查**
  "该层是否仍可晋升"（:1657-1658 的检查被作者注释掉），web 同样不复查。
- **记账趟（:1665-1684）**：清全图 `CAUGHT_FIRE_THIS_TURN`（:1668）；清无主
  `PRESSURE_PLATE_DEPRESSED`（:1669-1673，web 无格旗标，登记不实现）；
  `TM_PROMOTES_WITHOUT_KEY && !keyOnTileAt()`（Items.c:4062）逐层晋升
  （:1674-1682）。**清除在 WITHOUT_KEY 循环之前**——该循环引发的起火会存活到
  下一回合，web 的 `caughtFireRemaining` → `pendingCaughtFireCells` 回喂机制
  复刻了这个跨回合语义。
- **火势循环（:1686-1701）未移植**：web 火焰由 Gas.ts 的 isBurning/burnDuration
  系统承担。CE 火地形（PLAIN_FIRE 等）的 tile 在 web 缺失，接 CE 火需另立轮次
  （见 §四"与 CE 的差异"）。
- **CE updateEnvironment 的调用位置** = Time.c:2695，在客观块内
  （monster DFChance 之后、decrementPlayerStatus 之前）；web 对应位置 =
  `Game.objectiveTimeBlock()`，驱动插在 `tickCreatureStatuses()` 之后、
  `updateFires()` 之前，保持"晋升在火之前"的 CE 次序。

### 1.3 spawnDungeonFeature 第 4 参：任务书与源码不符（授权反驳）

任务书称"C-4b 已查明 CE spawn 时 `abortIfBlocking = false`"。**源码不是这样**：
Time.c:1268 字面为 `spawnDungeonFeature(x, y, &dungeonFeatureCatalog[DFType],
true, false)`，第 4 参 **abortIfBlocking = true**（第 5 参 refreshMap = false）。
按"以 CE 为准"条款照抄 true。该分歧对本轮无行为影响：晋升链全部 19 条 DF 的
tile 都不带 `T_PATHING_BLOCKER`、也不带 `DFF_TREAT_AS_BLOCKING`，blocking 判据
（Architect.c:3377-3381）两种传法下都为 false。

---

## 二、★ §五实测影响报告（本轮真正的判据）

测量工具：`src/test/c_4c_promotion.test.ts` E 组（console.log，可复跑）。
口径：`wait` 站桩 = 每动作 100 tick = 每回合恰好一个客观块；行走 = harness 默认策略。

### 2.1 每回合 promote 频谱（真实关卡、7 种子 × 40 回合）

| 深度 | 客观块 | 掷骰总数 | 平均掷骰/块 | 晋升按源地形 |
|---|---|---|---|---|
| D1 | 270 | 0 | 0.00 | （无——浅层地图上没有 promoteChance≠0 的地形） |
| D20 | 151 | 1677 | **11.11** | INERT_BRIMSTONE=45，MUD=11 |

- D20 平均每回合掷 11 次骰，全部来自硫矿湖（800/万）与机器房泥沼（100/万）。
- 全部 56 次中签晋升**无一例外被缓办**（见 2.2）——所以 D20 四层地形在 40 回合
  里逐格未变（硫矿 17 格 → 17 格）。
- 站桩不产生踩踏事件；踩踏链实测见 2.4。

### 2.2 硫矿点火链实测结论（C-2 欠账的答案）

**INERT_BRIMSTONE 在 web 今天点不着——链断在缺 tile 上，且这是当前目录下的
正确行为而非漏接。** CE 的链是：

```
INERT_BRIMSTONE --promoteChance 800/万--> DF_ACTIVE_BRIMSTONE(tile=ACTIVE_BRIMSTONE)
ACTIVE_BRIMSTONE(T_IS_FIRE) --exposeTileToFire--> DF_BRIMSTONE_FIRE(tile=BRIMSTONE_FIRE) …
INERT_BRIMSTONE --fireType--> DF_INERT_BRIMSTONE(tile=INERT_BRIMSTONE) --subseq--> DF_BRIMSTONE_FIRE(缺)
```

（CE Globals.c:425/426，ACTIVE_BRIMSTONE = T_IS_FIRE|T_SPONTANEOUSLY_IGNITES、
promoteChance 10 退回 INERT。）

web 现状：`DF_ACTIVE_BRIMSTONE`（tile null）与 `DF_BRIMSTONE_FIRE`（tile null）
都是 C-4b 登记的缺 tile 条目。晋升在**任何 mutation 之前**做整链预检，整次缓办：

- 实测（D20，7 种子）：ACTIVE_BRIMSTONE 缓办 45 次，硫矿格 17 → 17，无一格变化；
- 每个硫矿格每回合照常掷 8% 的骰（CE 语义：晋升没发生，下回合继续）；
- 不会崩、不会出现"半晋升态"——反向验证 RV5 证明：去掉缓办，promoteTile 直接
  抛出 C-4b 的响亮错误（真实关卡有硫矿时会砸穿游戏循环）。

**要让硫矿真烧起来，需要新增 tileType：`ACTIVE_BRIMSTONE`（+`BRIMSTONE_FIRE`）**
——这是后续新增地形轮次的输入，登记在 `DF_MISSING_TILES` 已有条目上。

### 2.3 死数据盘点（§五.3：哪些 promoteChance 永远不会触发）

31 地形静态盘点（E3）：

- **活的只有 3 条**：OPEN_DOOR:10000→DF_CLOSED_DOOR；MUD:100→DF_METHANE_GAS_PUFF
  （实测有载体：机器房蓝图）；INERT_BRIMSTONE:800→DF_ACTIVE_BRIMSTONE。
- **负值（扩散型）载体：0 条**。CE 11 种负值地形（ICE_DEEP/ICE_SHALLOW、HOLE 系、
  FLOOD_WATER 系、FORCEFIELD 系、LAVA_RETRACTING、WORM_TUNNEL_MARKER_ACTIVE、
  HOLE_EDGE）全不在 web 31 地形内——**驱动里的四邻累加分支在当前内容下是死数据**，
  为 CE 保真保留，靠 B3 注入式对抗测试钉语义。
- **fireType 轴整体休眠**：web 火焰不走 promoteTile（Gas.ts 自成体系），且
  fireType 指向的 DF 几乎全部缺 tile（DF_PLAIN_FIRE/DF_EMBERS/DF_STEAM_ACCUMULATION/
  DF_BRIMSTONE_FIRE）；仅 DF_OBSIDIAN（LAVA fireType）与 DF_INERT_BRIMSTONE 有 tile，
  可达路径（exposeTileToFire）未移植。接 CE 火 = 独立轮次。
- MUD 的晋升目标 DF_METHANE_GAS_PUFF（tile METHANE_GAS 缺失）同样永远缓办——
  泥沼在 web 会持续掷骰但永远不长沼气。

### 2.4 触发源实测计数（§五.4）

**接上的（4 个）**：

| 触发源 | CE 位置 | web 接线点 | 实测 |
|---|---|---|---|
| TM_PROMOTES_ON_STEP（玩家侧） | Time.c:278-288 pressurePlate | `handleSpecialTileEntry` 尾部 `promoteOnStep` | 60 回合随机行走 3 种子：OPEN_DOOR 开→自动关 2/0/1 次（E2）；每次关门即一次开门的中签证据（OPEN_DOOR promoteChance=10000，开门后同回合客观块必关） |
| （驱动，随回合）OPEN_DOOR 自动关门 | updateEnvironment :1622-1663 | objectiveTimeBlock | 同上；单次踩门动作内完成"开→关"闭环（D1 端到端） |
| （驱动，随回合）TM_PROMOTES_WITHOUT_KEY 记账 | Time.c:1674-1682 | 驱动内（keyOnTileAt 回调查地面 KEY 类物品） | 当前 31 地形零载体 → 触发 0 次（B4 注入式钉语义） |
| TM_PROMOTES_ON_ITEM_PICKUP / ON_ITEM | Items.c:819-829 / 1278-1286 | `pickup` / `dropItem` 成功路径 | 零载体 → 结构性忠实调用，触发 0 次 |

**未接的（4 个）与缺失原因**：

| 触发源 | CE 位置 | 不接的原因 |
|---|---|---|
| TM_PROMOTES_WITH_KEY | Movement.c:616-638 useKeyAt | web **有**事件（解锁，Game.ts 旧路径直写 OPEN_DOOR），但晋升目标 DF_OPEN_IRON_DOOR_INERT tile 缺失——接线后整链缓办=门被吃掉/原地不动，**砸坏现有解锁功能**。保持现状，登记 |
| TM_PROMOTES_ON_ELECTRICITY | Time.c:1289-1304（调用点 Items.c:5456） | web 闪电 bolt 只结算伤害，无"电弧曝格"事件点；且 31 地形零载体 |
| TM_PROMOTES_ON_PLAYER_ENTRY（拉杆） | Items.c:6932-6934 + Movement.c:1152-1158 + Time.c:290-299 | web 没有"撞上挡路格"事件（canMoveTo=false 即无动作），需 Movement 结构改动——任务书禁止为触发源改事件结构；且零载体 |
| TM_PROMOTES_ON_STEP（怪物侧） | Time.c:278-288（moveCreature→pressurePlate） | **怪物踩门开门**在 web 无事件点（Monster.takeTurn 无特化格入口）；接它 = 改 entities/（禁改）。CE 行为差异如实登记：web 的门只对玩家开 |

### 2.5 决定性复验（§五.5）

D3：同种子（20260916）同操作序列（固定左右走 30 回合）跑两遍，每回合对全图
四层 + isBurning 做快照，**逐回合全等**。两趟驱动的 RNG 消耗顺序在两次运行中
逐位一致（B5 钉死"掷骰数 = promoteChance≠0 且未起火的层次数"）。

---

## 三、单层不变式与 C-4a-0 留痕的边界（任务书 §三第 2 条）

**setTerrain 的"写归属层 + 清空其余三层"一字未动**；按层写入只发生在
promoteTile 的 vanish 与 fillSpawnMap（C-4b）——两者的边界：

- **fillSpawnMap**：按 feat.layer 写目标地形，判据只看该层旧值；不碰其他层。
- **promoteTile vanish**：只清/写被晋升的那一层（DUNGEON→FLOOR，其余→NOTHING）。
- **缓办路径**：不写任何层。

**生产路径上不变式今天仍成立**，论证：本轮可达的晋升 DF 全部是单格 DF
（startProbability=0 → spawnMapDF 不扩散），且落点层与源内容同层——
DF_OPEN_DOOR/DF_CLOSED_DOOR 落在门所在的 DUNGEON 层（vanish 后该层=FLOOR）；
DF_REPEL_CREATURES 是 tile=NOTHING 的无地形 DF（不写层）。没有任何本轮可达
路径把第二层写进一个已有内容的格子。c_4a_0 的 F3 留痕（生成路径单层 + GAS
恒空）实测仍绿。

**何时会破、到时要怎么改**：接 CE 火路径（exposeTileToFire）时，
DF_PLAIN_FIRE（SURFACE）会落在 DUNGEON=FLOOR 的格上——那将是第一次合法的
"一格两层"，届时需要把 c_4a_0 的单层不变式留痕从"每格至多一层非空"翻转为
"生成路径每格至多一层非空；回合期允许 SURFACE/GAS 叠加"（按 B-1 反转范本，
保留越界守卫）。本轮未到那一步，不动它。
本轮对 c_4a_0 的唯一改动是 `setTerrainLayer` 允许清单加入
`engine/Map/Promotion.ts`——该留痕自己的注释预授权了这一步。

---

## 四、因行为变化而翻红的既有测试（逐条申报）

既有**玩法**测试：零翻红。`generation_baseline` 仍绿（promote 只在回合期，
未漏进生成期——任务书预警的失败模式没有发生）。p1_26 / p1_29 / p1_33
坏层闸门全绿（手动复跑确认 0 坏层）。

翻红的是 C-4b 留痕文件的 2 条，**均非回归、非 CE 行为问题，而是留痕前提
按其自身设计到期**：

| 测试 | 断言 | 现状 | 处置 |
|---|---|---|---|
| `c_4b_dungeon_feature.test.ts` F1 | "DF 子系统符号的生产引用只出现在 Map/ 两个新文件" | Promotion.ts 成为合法第 3 个引用文件（+ 后续 Game.ts 若扩白名单） | **停下来申报**：该文件不在本轮允许修改清单，且"其它既有测试文件"在禁改清单。建议验收方翻转：allowed 集合加入 `engine/Map/Promotion.ts`（如接 Game.ts 直引 DF 符号则一并加） |
| 同上 F2 | "promoteTile 本体不存在" | promoteTile 存在于 Promotion.ts:206（Time.c:1244-1287 的移植） | 同上。建议翻转为"promoteTile 定义只出现在 engine/Map/Promotion.ts"（白名单式，防别处私造） |

两条的 describe 标题本身就写着"本轮明确不做的事；**C-4c 翻转**"——但按
project_conventions 刚立的规矩（第 6 起冲突后的"宁可红，不可绕"），执行方
（我）对不在允许清单的留痕**停手申报**，不自行翻转、不把代码扭成扫描看不见的
形态。这是该系统性冲突的第 **7** 次发生：任务书提前把 c_4a 的两个文件放了进来，
但漏了 c_4b 自己的这两个留痕。

---

## 五、对抗性测试与反向验证

新增 `src/test/c_4c_promotion.test.ts`：21 条全绿。对抗性 ≥8 条（任务书点名的
8 类全在）：

| # | 用例 | 能抓住的错误实现 |
|---|---|---|
| 1 | A1 DOOR→OPEN_DOOR 端到端 | 跳过 vanish（被优先级判据挡住，门开不了）；vanish+spawn 顺序颠倒 |
| 2 | A2 vanish 清层目标 | DUNGEON 清成 NOTHING / 非 DUNGEON 清成 FLOOR |
| 3 | A3 fireType/promoteType 选择 | 两路取反、写死一路（两路缓办记录不同：链断点分别在第一环与中段） |
| 4 | A4 缓办不改地形 | "先 vanish 再发现缺 tile"的半晋升态（门被吃成 FLOOR） |
| 5 | A5+A6 接线分支 | 误实现 activateMachine（行为 + 静态双守卫：生产代码零接线符号） |
| 6 | B1 一趟连锁 | 驱动写成一趟（同回合先改格影响后判格） |
| 7 | B2 起火守卫 | 守卫漏掉（多晋升+多耗一次 RNG） |
| 8 | B3 扩散累加 | 邻居累加写反/不累加/把挡通行或同层同地形计入 |
| 9 | B5 RNG 口径 | 掷骰数与 promoteChance≠0 层数不符（多掷/漏掷移动 RNG 流） |
| 10 | C1 probDec 闸门 | 目录里混进 probDec=0 的非 GAS 扩散条目（spawnMapDF 死循环），钉在数据层 |
| 11 | B4 WITHOUT_KEY | keyOnTileAt 接反/记账趟漏写 |
| 12 | D1/D2/D3 Game 集成 | 事件没接上（无开门关门记录）、楼梯链断裂、驱动破坏决定性 |

### 反向验证（强制条款；真实失败输出节选，均已还原）

- **RV1 两趟改一趟**（记位后立即 promoteTile）：
  `B1 AssertionError: A：OPEN_DOOR 晋升关闭: expected 5 to be 4`
  （A 被二次晋升开回 OPEN_DOOR、B 被连锁挤掉不晋升——一趟的双重失真都被抓到）
- **RV2 清层目标写反**（DUNGEON 也清 NOTHING）：
  `A2 AssertionError: expected +0 to be 2`（0=NOTHING，应为 2=FLOOR）
- **RV3 删起火守卫**：
  `B2 AssertionError: 起火格本回合不得晋升: expected 1 to be +0`
- **RV4 累加方向写反**（丢 `-1 *`）：
  `B3 AssertionError: 1 合格邻居 ×10000 → 必晋升: expected 2 to be 5`
- **RV5 去掉缺 tile 缓办**：
  `A3 Error: DF#66（ACTIVE_BRIMSTONE）引用了 web 尚不存在的 tileType，登记未实现（C-4b 目录）…`
  ——证明无缓办时真实关卡（D17+ 硫矿湖）的游戏循环会被 C-4b 的响亮错误砸穿。

每次注入后单跑对应用例见红、还原后全绿，未执行任何 git 写操作（还原全部为
反向编辑）。

---

## 六、门禁输出

### npm run build（尾部）

```
dist/assets/index-DrbPcPh6.js               784.40 kB │ gzip: 239.12 kB
(!) Some chunks are larger than 500 kB after minification. Consider:
-   Using dynamic import() to code-split the application
✓ built in 1.38s
```

### npm test（尾部）

```
 Test Files  1 failed | 64 passed (65)
      Tests  2 failed | 712 passed | 8 skipped | 5 todo (727)
   Start at  07:03:01
   Duration  244.66s (transform 2.31s, setup 0ms, import 16.68s, tests 1899.15s, environment 17ms)
```

唯一失败的 1 文件 2 条 = c_4b F1/F2（§四：留痕到期，待验收方翻转）。
generation_baseline 单跑绿；p1_26_invariants / p1_29_adversarial_gate /
p1_29_lake_connectivity / p1_33_machine_chokepoint 单跑全绿。

### git diff --stat

```
 brogue-web/src/engine/Core/Game.ts               | 62 ++++++++++++++++++++++++
 brogue-web/src/engine/Map/DungeonFeature.ts      |  7 ++-
 brogue-web/src/test/c_4a_0_layer_model.test.ts   |  1 +
 brogue-web/src/test/c_4a_terrain_catalog.test.ts |  3 +-
 4 files changed, 70 insertions(+), 3 deletions(-)
新增（未跟踪）：
 src/engine/Map/Promotion.ts        （promoteTile + 两趟驱动 + 旗标触发循环）
 src/test/c_4c_promotion.test.ts    （21 条：对抗 12 + 目录防线 2 + 集成 3 + 测量 4）
```

改动说明：DungeonFeature.ts 仅将 cellTerrainFlags/cellTerrainMechFlags 两个
CE 谓词由私有改为导出（Promotion.ts 复用同一份实现，避免两处 OR 循环漂移）；
Game.ts 仅含任务书许可的三类改动：回合驱动挂接点（objectiveTimeBlock）、
web 已有事件点的触发（handleSpecialTileEntry / pickup / dropItem）、以及
跨回合起火集的持有字段。Gas.ts 未动（无冲突：web 火焰系统与驱动无共享状态，
CE 火路径未移植）。

---

## 七、与预设不符之处（只列不修）

1. **任务书"C-4b 已查明 spawn 时 abortIfBlocking = false"与 CE 源码不符**：
   Time.c:1268 第 4 参字面为 `true`。对当前晋升链全部 DF 无行为差别（见 §1.3），
   但对抗测试条目 4"abortIfBlocking 传了 true（DOOR→OPEN_DOOR 被优先级挡住）"
   的因果不成立——能挡住门晋升的是**跳过 vanish**（优先级判据），不是
   abortIfBlocking 的取值；A1 按真实机理设防。
2. **任务书漏把 `c_4b_dungeon_feature.test.ts` 列入允许修改清单**——它的 F1/F2
   正是本轮必然到期的留痕（系统性冲突第 7 起）。已按规矩停手申报（§四），
   npm test 因此保留 2 条红，请验收方翻转。
3. **任务书 §二.2 对扩散型 promoteChance 的描述**（"按四邻中'同层地形不同且
   不阻挡'的邻居数做负向累加"）漏了第三个条件"本格本回合未起火"（:1637 在邻居
   循环内部）与"守卫短路在掷骰之前"（:1644）——已按源码实现并写进 B2/B3。
4. **FOLIAGE 踩踏晋升在 web 实际不可达**：FOLIAGE promoteType=DF_TRAMPLED_FOLIAGE
   tile 缺失 → 整链缓办，灌木踩不掉（CE 会踩成 TRAMPLED_FOLIAGE）。零半晋升态
   是对的，但意味着"踩平灌木"这个 CE 行为在补 tile 前不存在。
5. **CE 楼梯的 DF_REPEL_CREATURES 每次踏入都触发且 CE 会真的驱离生物**
   （evacuateCreatures）；web 按任务书不搬怪，只登记 `evacuationRequired`——
   玩家踩楼梯时周围怪不会被推走，与 CE 存在行为差（C-4b 差异表既有条目，本轮
   首次变得可观测）。
6. **怪物踩门开门未实现**（无事件点、entities/ 禁改，见 §2.4 未接清单）——
   web 的门只对玩家开；CE 里怪物开门/关门是常见的堵路手段，此差异请验收方
   记入 P1-42 一类的已知偏离清单。
7. 测量口径注：E1 的"期望 ≈ 0.08×格数×块数"按聚合数估算会偏高——格数与块数
   在种子间负相关（硫矿多的种子玩家站桩死得快）。45 次缓办对应的逐种子期望
   与观测一致，不构成异常。

---

## 八、留给后续轮次的输入

- **补 tile 清单**（按本轮实测的触发紧迫度排序）：ACTIVE_BRIMSTONE + BRIMSTONE_FIRE
  （硫矿链，2.2）；METHANE_GAS（泥沼）；TRAMPLED_FOLIAGE（踩灌木）；
  PLAIN_FIRE + EMBERS（CE 火，与 exposeTileToFire 移植同轮）。
- **C-4d 接线机器**：promoteTile 的 wiredBranchHit 分支已留痕，A6 静态守卫
  钉死生产代码零 `activateMachine` / `circuitBreakersPreventActivation` /
  `IS_POWERED` 符号。
- **CE 火路径**（exposeTileToFire + 火势循环 Time.c:1686-1701）与 Gas.ts 的
  归并/共存需要方案评审——涉及 D3（tick 制）与 P1-39（深水）多处口径。
