# F-2a 报告：放开 CE 的火焰蔓延与寿命模型（真改玩法）

> 2026-09-16。执行：ZCode/GLM。CE 源码以 `BrogueCE-master/src/brogue/` 为准
>（只读；行号均实测复核）。F-0 测绘 / F-1 报告 / architecture note 为前置输入，
> 冲突处以 CE 实测为准——本轮对任务书有**两处已采纳先例的细化**（§六.1/§六.2），
> 其中一处改变了 §二.4 第一条的落点（igniteForced 的语义去向），请验收方重点看。

---

## 0. 结论摘要

1. **§5.3-1/2/3 三条全部接通**：蔓延 = 4 正交邻 × 逐地形 `chanceToIgnite` +
   每格每回合 12 次暴露封顶（Time.c:1688-1700 / :1332-1345 / :1308-1311，
   移植为 `Promotion.exposeTileToFire` / `runFireUpdate`）；火的寿命 =
   `PLAIN_FIRE.promoteChance` **0 → 500** 的概率衰老（C-4c 两趟驱动驱动，
   F-1 备好的翻正位）；烧完产物 = **EMBERS → ASH**（CE Globals.c:469/461，
   新增两种地形 + DF_ASH 目录条目），CHARRED_FLOOR 不再由火烧尽生产。
2. **F-1 交接的翻正全部落地**：`promoteChance` 500；`DF_PLAIN_FIRE.tile`
   null → `PLAIN_FIRE` 并摘出 `DF_MISSING_TILES`（11 → 9）；`DF_EMBERS.tile`
   → `EMBERS`。**F-1 两条预测双双验证成立**：`T_OBSTRUCTS_SURFACE_EFFECTS`
   守卫经 fillSpawnMap 免费获得（f_2a 对抗⑤ + 反向验证 R4）；
   `igniteForced` 的 overlay 约定消解——但消解方式对任务书 §二.4 有一处
   **有据细化**（§六.1）：`igniteForced` 去 CE 的**火 DF 生成家族**
   （药水/爆炸），`ignite` 去 CE 的 **alwaysIgnite 直燃**（弹道）——
   两个 CE 机制各归各位，而不是把 igniteForced 改成 alwaysIgnite。
3. **门禁 §五 全过**：F-0 探针复跑（附录 A 原样恢复、跑完已删）——
   决定性两 seed identical=true；自然推进 5 种子全零且可燃地形底数
   **逐格精确一致**（123/122/162/115/84）；**气体全部曲线逐位不变**
   （含 POISON≡CONFUSION 恒等式）；伤害仍固定 2/回合；
   燃烧曲线如预期全面改变且逐条可归因（§四对照表）。
   `generation_baseline` 绿；p1_26/p1_29/p1_33 全绿；build 绿；
   全量串行 68 文件全绿（§七）。
4. **对抗性测试 12 条**（新增 `f_2a_fire_mechanics.test.ts`）+
   **f_1 翻正后 11 条**全绿；**反向验证 6 条**（超出要求的 4 条）全部
   真实改坏、真实失败输出、已还原（`grep REVERT-ME` = 0，§九）。
5. 既有测试翻正 7 个文件、全部限于任务书授权与"本轮必然到期"的断言，
   逐条清单与守卫性质论证见 §八。**无计划外翻红**（p4_4/p4_1b/c_1/c_4c
   未动一字而全绿，与 F-0 §5.4 预判一致）。

---

## 一、燃烧曲线新旧对照（门禁 §五.1 核心交付）

F-0 附录 A 探针原样恢复复跑（唯一适配：DMG-FIRE 段 `igniteForced(x,y,7)` →
`igniteForced(x,y)`，时长参数已退役）。`[FIRE-NAT]` 三条曲线：

| seed | F-0 旧曲线（burnDuration 4-7 / 8 邻 / 40%） | F-2a 新曲线（promoteChance 500 / 4 邻 / 15%） | CE 归因 |
|---|---|---|---|
| 42 (5,20) | `3,4,7,13,12,11,9,7,5,2,1,0,…` 峰 13，半径 3，**全熄@12** | `1,1,1,2,3,5,6,6,6,6,7,6,6,7,7,7,7,7,6,6,6,6,6,5,6,6,5,5,5,5,5,5,5,5,5,6,6,6,5,5`（40 回合仍未熄）峰 7，半径 3 | ①起燃慢：单点草邻每回合各一次 15% 掷骰（旧：8 邻 × 40%），起燃后可燃层被消耗、火地形概率衰老；②烧得久：PLAIN_FIRE 5%/回合几何衰老（均值 ~20 回合）+ 火段持续点燃新草——草场火从"一阵爆燃"变成 CE 的"慢慢啃" |
| 2026 (68,14) | `4,5,12,17,20,20,17,13,9,4,2,0,…` 峰 20，半径 5，**全熄@12** | `1,2,3,3,4,4,5,5,6,7,9,9,10,11,11,13,12,12,13,14,13,13,15,15,15,14,12,11,8,8,8,8,5,5,5,5,5,4,4,4`（40 回合仍未熄）峰 15，半径 5 | 同上；半径同为 5（地块边界决定），但到达半径的时间从 ~4 回合拉长到 ~16 回合 |
| 777 (31,23) | `2,4,8,9,11,12,11,10,7,5,2,0,…` 峰 12，半径 3，**全熄@12** | `1,1,1,1,1,0,…` **全熄@6，半径 0** | **CE 的诚实行为**：孤立单格草没有蔓延成功过（15%/邻），源格自己 5%/回合衰老熄灭。旧模型"必烧 4-7 回合并外扩"是 web 自创的确定论；CE 里孤火经常就这么灭了 |

**CE 寿命模型的验证锚点**（任务书 §五.1 要求"实测均值明显长于 4-7"）：
- 统计口径（非单曲线）：f_2a 对抗⑥——60 个火格推 60 客观块后 **>40/60 离场**
  （0.95^60≈4.6% 存活的分布带），promoteChance=0 的永生实现得 0/60（反向 R5 红）；
- f_1 对抗④——8 回合后 60 格中 >20 仍在烧（4-7 倒计时模型 0 存活）。
- 曲线口径：seed 42/2026 的火 40 回合不熄（旧模型 12 回合必熄）。

**伤害序列**（§三不动项）：

| 实验 | F-0 旧 | F-2a 新 | 归因 |
|---|---|---|---|
| DMG-FIRE seed 42 | `2,2,2,2,2,2,0,0,0,0,-1,0` | `2,2,2,2,2,2,2,0,0,0,-1,0` | 每回合伤害值不变（Game.ts:6227 固定 2 未动，§三红线）；燃烧回合数按几何分布波动（本样本 7 回合，单格分布内正常） |
| DMG-FIRE seed 2026 | `2,2,2,2,2,0,0,0,0,-1,0` | `2,2,2,2,0,0,0,0,0,0,-1,0` | 同上（本样本 4 回合） |
| DMG-GAS 全部 4 条 | — | **逐位一致** | 气体子系统零改动 |

**气体六条曲线（§五.1"应当不变"项）——全部逐位一致**：

```
seed 42  POISON      [5,12,9,12,5,5,2,1,0,…]      ≡ F-0
seed 42  CONFUSION   与 POISON 逐位相同            ≡ F-0（恒等式保持）
seed 42  STEAM       [5,12,5,1,0,…]               ≡ F-0
seed 42  CREEP_DEATH [4,9,15,15,17,11,11,8,8,6,2,0,…] ≡ F-0
seed 2026 / 777 全部四型                              ≡ F-0（含 goneAtTurn 17/10/21、19/10/27）
```

**决定性**：`[DETERMINISM] seed=42 turns=120 identical=true` / `seed=2026 … identical=true`。

**自然推进**（§五.5/§五.6 的前置）：5 种子 200 回合点火/气体**全零**，且
可燃地形底数 **123/122/162/115/84 与 F-0 逐格一致**——生成链未被移动的
直接证据（火是回合期现象，生成期零火）。

**蔓延速率对比**（§五.2）：同一起点、同口径见上表。量化结论：
- 起燃速度：旧 40%×8 邻使 4 回合内达到峰（13-20 格）；新 15%×4 邻下波前
  期望 ~6.7 回合推进一格，峰被拉平到 7-15 格且延后 ~10 回合；
- 火势规模：峰从 13/20/12 → 7/15/0——**单场火的瞬时规模变小**；
- 持续时间：全熄回合从恒 12 → 40+ / 40+ / 6——**火的日历寿命大幅变长**
  （正是 CE"promoteChance 几何衰老"取代"burnDuration 硬倒计时"的玩法含义）。

---

## 二、§二.3 载体盘点表（先盘点、后施工）

逐地形问"它的 fireType 今天有没有落地载体"，**只做有载体的**：

| 地形（web） | CE fireType | 载体现状（本轮前） | 本轮处置 |
|---|---|---|---|
| GRASS / FOLIAGE / WEB / BRIDGE_EDGE | DF_PLAIN_FIRE | PLAIN_FIRE 地形 F-1 已有 | **接通**：promoteTile(fireDF) → 火地形落 SURFACE |
| PLAIN_FIRE（衰老轴） | promoteType DF_EMBERS | **EMBERS 缺失 → 硬前置** | **新增 EMBERS 地形**（CE Globals.c:469 逐字段），promoteChance 500 接通 |
| EMBERS（衰老轴） | promoteType DF_ASH | **DF_ASH + ASH 缺失 → 链断即永烬** | **新增 ASH 地形**（:461）+ DF_ASH 目录条目（id 49，:672）——衰老链 PLAIN_FIRE→EMBERS→ASH 全通 |
| DOOR / OPEN_DOOR / SECRET_DOOR / LOCKED_DOOR | DF_EMBERS | EMBERS 缺失 | **接通**（随 EMBERS 落地）：门被火烧穿——DUNGEON 层 VANISH 回 FLOOR、EMBERS 落 SURFACE（CE :328-331 门系全部 fireType=DF_EMBERS） |
| WATER_DEEP / WATER_SHALLOW | DF_STEAM_ACCUMULATION | GAS 层 STEAM tile 缺失（G 链） | **不做**：promoteTile 对缺 tile DF **整链缓办**（C-4c 机制兜底，水格原样、零副作用）；f_2a 对抗⑨显式留痕，G-1 翻转 |
| LAVA | DF_OBSIDIAN | OBSIDIAN ✔ 但 LAVA **无 T_IS_FLAMMABLE**（CE :420 同） | 无需做：exposeTileToFire 的可燃先决使该轴结构性不可达（CE 同）；目录数据本就照抄 |
| BOG | ''（webOnly，CE 无此物） | 目录无点火数据 | **不做**（不做假数据）：直燃 promoteTile 无 DF 可落 → BOG 不可点燃（web 旧白名单行为退役，D2 口径）；f_2a 对抗⑩留痕 |
| BRIDGE / BRIDGE_EDGE 轴上的桥塌 | DF_BRIDGE_FIRE → DF_BRIDGE_FALL → DF_BRIDGE_FALL_PREP（tile 缺失） | 链断 | **不做**（任务书明示）：BRIDGE_EDGE 走 DF_PLAIN_FIRE 照常烧；BRIDGE 本体点燃会被整链预检缓办（不塌）——C-5 坠落子系统落地时翻转 |
| INERT_BRIMSTONE | DF_INERT_BRIMSTONE（灭火自冷） | DF 有 tile | 不可达（chanceToIgnite=0，CE 同）；其自发晋升链的空转是 C-4c 既有登记，本轮未碰 |
| ICE_* | 融冰 DF | web 无 ICE 地形 | **不做**（任务书明示） |
| 五种可燃气体 | DF_GAS_FIRE | 气体在独立 gasGrid（G 链） | **不做**（任务书归 G-1） |

**炸点预检（C-4b 隐含约定）**：本轮新增/翻正的 DF（DF_PLAIN_FIRE /
DF_EMBERS / DF_ASH）全部 startProbability=0——spawnMapDF 的
`while(madeChange && startProb>0)` 不执行、零 RNG、无 probDec 死循环可能；
c_4c C1 目录级闸门继续覆盖未来合成条目（f_2a 对抗⑧钉死三条火 DF 的零 start）。

---

## 三、生产改动清单（按文件）

### Grid.ts
- `TerrainType` 尾部追加 `EMBERS`、`ASH`（既有枚举值不动——terrainFingerprint
  数值哈希稳定）；`DRAW_PRIORITY` 加 70/80（CE 原值）、`TERRAIN_HOME_LAYER`
  加两条 SURFACE（CE DF 目录 :747/:672）。
- `Cell.exposedToFire` 新增（CE pmap.exposedToFire 的 web 对应物，由
  runFireUpdate 独占读写）。
- **`isBurning` 从 F-1 的双写镜像位改为纯派生 getter**（跨层存在
  FIRE_TERRAIN_TYPES 成员即 true）。火地形全部经 DF 生成管线进出后，
  "另一个事实来源"不存在了，镜像脱钩类 bug 结构性消失；判据集合
  `FIRE_TERRAIN_TYPES` 导出并放在 Grid（TerrainCatalog→Grid 的依赖方向
  不允许反向 import），由 c_4a 新增的恒等断言与旗标载体集合双向锁死。
- `burnDuration` / `burnTerrain` 字段随倒计时模型退役删除。

### TerrainCatalog.ts
- `PLAIN_FIRE.promoteChance` **0 → 500**（任务书 §二.2 指定翻正位），
  注释改写为"无偏离照抄 CE"。
- 新增 `EMBERS`（flags 0、STAND_IN_TILE|VANISHES_UPON_PROMOTION、
  fireType DF_PLAIN_FIRE、promoteType DF_ASH、promoteChance 300——
  CE Globals.c:469 逐字段）与 `ASH`（零旗标、STAND_IN_TILE、零衰老——
  :461 逐字段）。

### DungeonFeatureCatalog.ts
- `DF.DF_ASH = 49` 新增（Rogue.h:1524 对位）；DF_PLAIN_FIRE/DF_EMBERS 的
  tile 翻正（null → PLAIN_FIRE / EMBERS）；新增 DF_ASH 条目
  `{ASH, SURFACE, 0, 0}`（ceLine 672）；`DF_MISSING_TILES` 11 → 9。

### Promotion.ts（CE Time.c 火段与 promoteTile 同文件同置）
- `exposeTileToFire(grid, x, y, alwaysIgnite)`：CE Time.c:1306-1377 逐段移植
  （可燃先决 → 12 次封顶 → 灭火层优先级 → 逐层最大 chanceToIgnite →
  alwaysIgnite 旁路 → 可燃层逐层 promoteTile(useFireDF=!explosivePromotion)）。
  甲烷爆轰分支照抄留形（web 无 TM_EXPLOSIVE_PROMOTE 载体 + GAS 层恒空，
  结构性不可达，G-1 行使）；GAS 层只清 volume 的 CE 怪癖登记不实现。
- `runFireUpdate(grid, opts)`：CE Time.c:1688-1700 火段——先清全图
  exposedToFire（:1598-1603），再 i 外 j 内扫描：每个未登记起火的 T_IS_FIRE 格
  暴露自身 + 4 正交邻；段内即时并入新登记的起火格（CE 旗标活性）。
  返回新登记集（CE Architect.c:3235 的 CAUGHT_FIRE_THIS_TURN 增量）。

### Gas.ts（火侧状态机退役，只剩三个入口 + 气体本体）
- `ignite(x, y)` = `exposeTileToFire(x, y, true)`——CE burninate 直燃
  （Items.c:5217/5445）；`igniteForced(x, y)` = `spawnDungeonFeature(DF_PLAIN_FIRE)`
  ——CE 火 DF 生成家族（duration 参数随倒计时模型退役）；
  `updateFires(caughtFireCells?)` = 复燃分支（web 自创，原样保留）+
  CE 火段 + 蒸汽分支（web 自创"火贴水 30% 冒 50 密度蒸汽"，8 邻口径
  原样保留，§5.3-9 归 G 链）。
- `takeNewlyCaughtFire()`：ignite/igniteForced 攒下的起火登记队列，
  **必须在客观块晋升驱动之前**排干并入 Game 的 skip 集（§三.1 的实测教训：
  不并就会"起火当块被衰老成 EMBERS、永不蔓延"）。
- 烧尽分支（CHARRED_FLOOR 五地形分流）整体删除；writeFireTerrain /
  clearFireTerrain 删除。

### Game.ts
- `objectiveTimeBlock`：晋升驱动前 `takeNewlyCaughtFire()` 并入
  `pendingCaughtFireCells`；`updateFires(pending)` 的返回值并入
  `pendingCaughtFireCells`（CE :1665-1668 记账趟语义：遗留集清空、
  WITHOUT_KEY 新点的火跨回合存活、火段新登记喂下一块）。
- 快照：接口与读写去掉 `burnDuration` / `burnTerrain`；`isBurning` 照写
  （派生读数）；旧存档对账分支保留，判据改读存档数据里的 `c.isBurning`
  （cell 上已无可写位）。旧存档迁移语义不变：isBurning=true 无火层 →
  补写 SURFACE 火；幽灵火 → 摘除。
- `resetTestRoom`：原 isBurning/burnDuration/burnTerrain 直写三行删除
  （派生读数，基线无火自动为 false）。
- **点火源家族重映射**（CE 出处逐条）：
  - `fire_burst` 药水（喝）×3 格、`fire_burst` 投掷 ×9 格、fire 陷阱 ×5 格：
    `ignite` → **`igniteForced`**——CE 焚化/火焰喷射家族是 DF 生成
    （DF_INCINERATION_POTION :781、DF_FLAMETHROWER :746——火地形直接铺上，
    不看底下可燃性；web 保留原 3/9/5 格的覆盖形状，只换机制）；
  - 火杖/火系弹道落点与弹迹、怪物火弹（BoltEffect.FIRE/DRAGONFIRE）：
    `ignite` 语义变为 `exposeTileToFire(true)`——正是 CE BF_FIERY 的
    burninate（弹道终点直燃、可燃才着）；这些调用点**一行未改**，
    语义随入口定义收正。

### i18n
零新增文案（`zh_CN.json` 零改动）；本轮生产改动无任何新 `t()` 调用。

---

## 四、F-1 两条预测的验证结果（任务书 §二.4）

### 4.1 `T_OBSTRUCTS_SURFACE_EFFECTS` 守卫"免费获得"——**成立，已测**
火 DF（DF_PLAIN_FIRE）经 `spawnDungeonFeature → fillSpawnMap` 落地，
fillSpawnMap 的 `layer===SURFACE && cellHasTerrainFlag(T_OBSTRUCTS_SURFACE_EFFECTS)`
判据（C-4b 移植，Architect.c:3230）原样生效：楼梯/祭坛拒绝火 DF
（f_2a 对抗⑤），对照地板照常落火。反向验证 R4：临时删掉守卫判据 →
对抗⑤红（"楼梯必须拒绝火 DF: expected true to be false"）→ 还原。
锁门/密门的同旗标由 vanish-先于-spawn 的 CE 次序自然处理（烧穿后旗标随
门消失、EMBERS 才落）——c_4b 的 fillSpawnMap 移植注释原文即此判据，
本轮零改动。

### 4.2 `igniteForced` overlay 约定"自然消解"——**成立，但消解方式有一处细化**
F-1 §七.1 的预测：igniteForced 改 CE alwaysIgnite 后，"给楼梯/祭坛/锁门
盖火 overlay"的约定随之消失。**实测成立**——但把 igniteForced 直接改成
`exposeTileToFire(true)` 与两组 CE 事实冲突：

1. **p4_4（禁改文件）钉死"bloat 的强制点燃不看地形白名单"**：石地板上的
   bloat 爆炸必须留火。CE 里这不是 exposeTileToFire——爆炸铺的是
   `GAS_EXPLOSION` 火地形 DF（DF_BLOAT_EXPLOSION，Globals.c:654），DF 生成
   路径天然不看可燃性。若 igniteForced = exposeTileToFire(true)，p4_4 六条
   断言翻红，而该文件不在允许清单——且那正是任务书留给 F-2c 的
   "改真爆炸时翻红"，本轮不应提前引爆。
2. **CE 本就存在两条点火机制**：弹道直燃 `exposeTileToFire(x,y,true)`
   （Items.c:5217 "burninate"、:5445、Time.c:539 燃烧生物所踩格）与
   DF 生成家族（药水/爆炸/陷阱，火地形无视可燃性直接铺，仅受
   drawPriority + T_OBSTRUCTS_SURFACE_EFFECTS 约束）。F-0 §3.2 的十条火 DF
   全是后者。

**据此的落法**（§六.1 请验收方裁决）：
- `ignite()` = `exposeTileToFire(x, y, true)`——火杖/火弹/怪物火系（弹道家族）；
- `igniteForced()` = `spawnDungeonFeature(DF_PLAIN_FIRE)`——药水/爆炸/火陷阱
  （DF 家族；GAS_EXPLOSION 本体仍是 F-2c 的活，web 现以 PLAIN_FIRE 单点近似
  其火地形半边，伤害半边缺口 P4-4 已登记）；
- overlay 约定随两个入口的定义自然消解：楼梯/祭坛在两条路径下都拿不到火
  （一个被守卫拒、一个不可燃），门/密门/锁门在直燃下按 CE 烧穿成 EMBERS。

---

## 五、行为变化登记（每条：变化 + CE 出处 + 实测）

| # | 变化 | CE 出处 | 实测/测试锚点 |
|---|---|---|---|
| 1 | 蔓延 8 邻 × 40% → 4 正交邻 × 逐地形 chanceToIgnite（草/灌木 15、网 100、门系 50） | Time.c:1688-1700、:1332-1345；Globals.c 各 tile 行 | §一 曲线表；f_2a 对抗①（斜连烧不到）/②（15% 分布带）/⑦ |
| 2 | 每格每回合 12 次暴露封顶 + 每回合清零（新概念 exposedToFire） | Time.c:1308-1317、:1598-1603 | f_2a 对抗③ + 反向 R2 |
| 3 | alwaysIgnite 直燃旁路落地（弹道家族） | Items.c:5217/5445 | f_2a 对抗④ + 反向 R3 |
| 4 | 火寿命 4-7/2-4 硬倒计时 → promoteChance 500 几何衰老（均值 ~20 回合） | Time.c:1643-1645、:1244-1290；Globals.c:492 | §一 曲线表（全熄 12 → 40+/40+/6）；f_1 对抗④、f_2a 对抗⑥ + 反向 R5 |
| 5 | 烧尽产物 CHARRED_FLOOR（一律）→ EMBERS →（300）→ ASH；ASH 永久留存 | Globals.c:492/469/461；DF 目录 :740/:747/:672 | f_1 对抗②/⑤、f_2a 对抗⑥ |
| 6 | 门/密门/锁门被直燃烧穿：门消失（DUNGEON→FLOOR）+ EMBERS 落地（旧：门盖火 overlay、熄灭后变焦土） | Globals.c:328-331 fireType=DF_EMBERS + VANISHES_UPON_PROMOTION 次序 | f_1 对抗①（F-2a 翻正半边） |
| 7 | 火落不进楼梯/祭坛（旧：igniteForced 照烧） | Architect.c:3230（经 fillSpawnMap） | f_2a 对抗⑤ + 反向 R4 |
| 8 | 药水/投掷火/火陷阱从"白名单点燃"变为"火地形直接铺上"（石地板上现在真的着火） | DF_INCINERATION_POTION :781、DF_FLAMETHROWER :746（DF 家族语义） | Game.ts 调用点重映射；f_2a 对抗⑤的地板对照半边 |
| 9 | 网（WEB）现在可被直燃点燃（旧白名单只许蔓延点它——F-0 §3.4 登记的不对称） | Globals.c:470 SPIDERWEB ign=100 | f_2a 对抗⑦ 场景 B |
| 10 | BOG 不再可点燃（旧白名单成员；webOnly 地形无 CE 火数据） | 目录无 fireType（C-4a 如实记录） | f_2a 对抗⑩（留痕） |
| 11 | 深水暴露不产蒸汽（旧"火贴水 30% 冒汽"保留，但水体自身被点燃→DF_STEAM_ACCUMULATION 的 CE 链不接） | Globals.c:413（ign=100、fireType=DF_STEAM_ACCUMULATION）；§5.3-9 归 G-1 | f_2a 对抗⑨（留痕） |
| 12 | 玩家/怪物在火格上的伤害值不变（2/回合），但暴露时长随几何寿命显著变长 | §三红线（Game.ts:6227 未动）；CE 两段模型归 F-2b | §一 DMG-FIRE 对照 |
| 13 | RNG 流移动（点火/衰老掷骰集变化；旧 igniteForced 默认时长骰删除）——同 seed 地图/掉落全链漂移 | 任务书预期内（真改玩法轮） | 决定性复核 identical=true（新流下确定）；可燃底数逐格一致（生成期零火骰） |

**有意保留的 web 自创行为**（零改动，登记）：火贴水冒蒸汽（30%/50 密度，
8 邻口径）；焦土再生草（substrate 只剩火陷阱自转化）；CHARRED_FLOOR 地形与
其目录条目（D2 保留代码）；creeping_death 幽灵气（F-0 §2.2，归 F-2b/D2）。

---

## 六、与预设不符之处 / 对任务书的反驳与细化（只列事实）

### 6.1 ★ §二.4"igniteForced 语义改为 CE 的 alwaysIgnite"——按上节细化执行
不是照字面把 igniteForced 改成 exposeTileToFire(true)，而是把 CE 的两条
点火机制各归各位（弹道直燃→ignite，DF 生成→igniteForced）。理由：CE 的
爆炸/药水火从来不是 exposeTileToFire（是 GAS_EXPLOSION/PLAIN_FIRE 的 DF 铺设），
照字面执行会使 p4_4（禁改）翻红且方向本身偏离 CE。F-1 §七.1 的预测
（overlay 消解）以更完全的方式成立：两个入口下楼梯/祭坛都拿不到火。
**此条沿用本项目"授权反驳"先例（F-0 重排拆链、F-1 拒 promoteChance=500）。**

### 6.2 任务书 §二.2 的表述"接上后由 C-4c 的每回合两趟驱动自然驱动"——
方向正确，但**差一处接线**：C-4c 驱动只消费 Game 的 `pendingCaughtFireCells`
作 skip 集，而玩家动作期间 ignite/igniteForced 攒下的登记如果不在晋升驱动
**之前**并入，新火格会在同一客观块被立即衰老（实测：起火当块即变 EMBERS、
火永不起势，f_1 对抗②c 曾因此红）。CE 的旗标在点燃瞬间生效
（Architect.c:3235），web 等价物必须经 `takeNewlyCaughtFire()` 在晋升前排干。
已按 CE 语义接线并有对抗⑦钉 skip 集行为。

### 6.3 F-0 §六.2 预告的"抗火药水断线顺手修正"——本轮未做
任务书 §三把火免修复划归 F-2b（生物燃烧状态机一起），以 §三为准：未碰
`resist_fire` / `hasStatus('immune_fire')` 通道。F-0 的登记继续有效。

### 6.4 任务书 §四把 `p1_24`/`p1_28` 列入允许清单时预设"断言到期"——
实际两者的断言**一条都不需要改**：它们经 `igniteForced` 点火（F-1 改写时
已走公共入口），新实现下火照常落、2 伤照常结算；只需把调用处的 duration
实参删掉（签名退役）。翻正量比预期小，如实记录。

### 6.5 c_4b 的 F1 留痕（DF 子系统符号生产引用白名单）需要扩 Gas.ts——
任务书 §四只点名了"DF_PLAIN_FIRE tile 翻正"这一条 c_4b 断言，未点名 F1
扫描。按项目常识"凡本轮会给某个留痕接上第一个消费者的，提前把测试文件
放进允许清单"的规矩，c_4b 文件整体在允许清单内，F1 白名单扩展属于该
留痕自带指示（"C-4d 接线机器时再扩清单"）的同型操作：Gas.ts 成为火侧
第一个消费者。越界守卫保留（白名单外仍全红）。另有两处**块注释措辞**
被扫描正则命中（Grid.ts 注释提到 promoteTile、DungeonFeatureCatalog.ts
注释出现 `.promoteType`——注释不是引用），按 F-1 §六.2 同款处理：改写
注释措辞，未动任何代码形态。

### 6.6 f_1 对抗②c 的蔓延断言在"单列草带"布局下会在 CE 语义里**合法地**失败：
15%/邻 × 5%/回合衰老下，孤波前会烧尽在中途（§一 seed 777 的曲线就是这个
形态）。测试布局改为 5×3 草块（多路波前）。这不是放宽——被测事实
（蔓延格必带火地形物证）不变，改的是让"错误实现能被看见"的舞台亮度。

### 6.7 探针复跑的适配量比"原样恢复"多两处（如实申报）：
DMG-FIRE 的 `igniteForced(x,y,7)` 去掉字面量（参数退役）；快照读
`cell.burnDuration`（字段已删）保留原样——运行时读 undefined，
对"燃烧格计数"口径无影响（vitest/esbuild 不检查，项目常识已知陷阱）。
其余与附录 A 逐字一致；跑完已删，无残留。

---

## 七、门禁（npm run build / 全量串行 / git status）

**`npm run build`（exit 0）**：

```
✓ built in 1.46s
（chunk >500kB 警告为既有常态）
```

**全量测试（`npx vitest run --fileParallelism=false` 串行，2026-09-16 16:25–16:42，一次通过、零红、无超时假红）**：

```
 RUN  v4.1.11 …/brogue-web

 Test Files  69 passed (69)
      Tests  759 passed | 8 skipped | 5 todo (772)
   Start at  16:25:08
   Duration  1007.66s (transform 720ms, setup 0ms, import 7.64s, tests 994.72s, environment 10ms)
```

**账目核对**：开工前 HEAD（F-1 提交 c27af27 工作树）实际含 **68 个测试文件 /
745 用例**——本轮 +1 文件（f_2a_fire_mechanics.test.ts，12 用例）+2 用例
（c_4a 的 EMBERS/ASH 钉死块与 FIRE_TERRAIN_TYPES 恒等断言）= 69 文件 /
759 passed，逐项对上，无缺漏。
（按"如实报告"指出：F-1 报告 §八 记"67 文件 / 740"与其提交树差 +1 文件
+5 用例——p1_46_keybindings.test.ts 是 P1-46 轮新增的 5 用例文件，
F-1 的账目从它 P1-42 时代的基线起算时漏计了它。差异在本轮开工前就存在，
与本题无关，已在此对平。）

**`git status --porcelain`（终态）**：

```
 M brogue-web/src/engine/Core/Game.ts
 M brogue-web/src/engine/Environment/Gas.ts
 M brogue-web/src/engine/Map/DungeonFeatureCatalog.ts
 M brogue-web/src/engine/Map/Grid.ts
 M brogue-web/src/engine/Map/Promotion.ts
 M brogue-web/src/engine/Map/TerrainCatalog.ts
 M brogue-web/src/test/c_4a_0_layer_model.test.ts
 M brogue-web/src/test/c_4a_terrain_catalog.test.ts
 M brogue-web/src/test/c_4b_dungeon_feature.test.ts
 M brogue-web/src/test/f_1_fire_as_terrain.test.ts
 M brogue-web/src/test/p1_24_death_sink.test.ts
 M brogue-web/src/test/p1_28_flag_channel.test.ts
?? brogue-web/ai_docs/f_2a_fire_mechanics_report.md
?? brogue-web/src/test/f_2a_fire_mechanics.test.ts
```

---

## 八、既有测试改动逐条清单（含守卫性质论证）

| 文件 | 改动 | 为什么到期 | 守卫性质未放宽 |
|---|---|---|---|
| c_4a_terrain_catalog.test.ts | ①地形计数 32→34；②PLAIN_FIRE 钉死块 promoteChance 0→500；③新增 EMBERS/ASH 逐字段钉死块；④新增 FIRE_TERRAIN_TYPES ≡ 旗标载体恒等断言 | 新增地形 + 任务书 §二.2 指定翻正位 | 计数仍精确等值；钉死块仍逐字段；新恒等断言是**加严**（新方向） |
| c_4a_0_layer_model.test.ts | SURFACE 探针清单 +2；两张 toEqual 全量表各 +2 行 | 授权预判的"新增地形必然打红全量表" | 两表仍 toEqual 逐字穷尽 |
| c_4b_dungeon_feature.test.ts | ①E1 目录计数 19→20 + DF_ASH id 钉死；②E2 闭包 19→20；③E4 missing 11→9 + DF_PLAIN_FIRE/EMBERS/ASH 转换成功断言；④F1 白名单 + Gas.ts；⑤两处注释措辞（6.5） | tile 翻正（任务书点名）+ 火侧首个消费者（项目规矩预授权） | E4 对 missing 仍逐条 toBeNull+抛错；白名单外仍全红 |
| f_1_fire_as_terrain.test.ts | 见文件头翻转记录：寿命/产物/门 overlay/时长红线四组断言反转为 CE 新事实；镜像、A 类读者、GAS 恒空、持久化、旧档迁移、血迹弹开原样保留 | 任务书 §四明示"它的红线断言本轮到期" | 保留的断言一字未松；翻转后的断言反向加严（如 EMBERS→ASH 链逐级钉死） |
| p1_24_death_sink.test.ts | 1 处 `igniteForced(7,6,5)` 去掉时长实参 | 签名退役（§六.4） | 断言零改动 |
| p1_28_flag_channel.test.ts | 5 处同型去时长实参 | 同上 | 断言零改动（含 2 伤平扣锁定） |
| p4_4 / p4_1b / c_1 / c_4c / 其余 60 文件 | **零改动** | — | 全绿（预判命中） |

---

## 九、对抗性测试与反向验证

### 9.1 对抗性测试（新增 `src/test/f_2a_fire_mechanics.test.ts`，12 用例全绿）

| # | 捕获的错误实现 | 断言锚点 |
|---|---|---|
| ① | 蔓延仍用 8 邻 | 五组"火格+对角草"独立试验，对角草必须幸存（8 邻下必被烧） |
| ② | 仍用固定 40% | 325 互不相邻草格各暴露一次，点燃数 ∈[29,72]（15% 二项带；40%→期望 130 红、100%→325 红、永不燃→0 红） |
| ③ | 12 次封顶漏掉 / 清零漏掉 | exposedToFire=12 时直燃被拒且不计数；runFireUpdate 后清零恢复 |
| ④ | alwaysIgnite 旁路失效 | 30 草格直燃 30/30（旁路丢失→~4-5） |
| ⑤ | 守卫失效（绕开 DF 管线直写） | 楼梯/祭坛拒火 DF；对照地板照落；直燃路径不消耗不可燃格的暴露计数 |
| ⑥ | promoteChance 没接上（火永生） | 60 火格 60 块后 >40 离场；产物 ∈ {EMBERS, ASH, PLAIN_FIRE} |
| ⑦ | 火段忽略 skip 集 / 蔓延丢 CAUGHT 登记 | skip 集内不暴露邻居（网幸存）；无 skip 时 100% 网必燃且有新登记 |
| ⑧ | 火链 DF 带扩散参数（RNG 漂移/死循环） | DF_PLAIN_FIRE/EMBERS/ASH 三条 start=0、SURFACE；c_4c C1 闸门继续覆盖 |
| ⑨ | （留痕）水体本轮不可点燃 | 直燃深水原样缓办、无 GAS 层写入；G-1 接 §5.3-9 时翻转 |
| ⑩ | （留痕）BOG 不可点燃 | webOnly 无火数据；给 BOG 定火数据前须先改目录 |
| ⑪ | 气体被本轮意外改动 | 四型气体 ×14 回合全场签名逐位等于 2026-09-16 硬编码基线（POISON≡CONFUSION 恒等式含在内） |
| ⑫（f_1 对抗④） | 倒计时模型复活 | 8 块后 60 格 >20 仍在烧（4-7 倒计时 0 存活） |

### 9.2 反向验证（6 条，真实改坏 → 真实失败输出 → 还原；`grep -rn REVERT-ME src` = 0）

**R1 火段改 8 邻**（FIRE_DIRS4 添 4 个对角）→ 对抗①：

```
FAIL … 对抗①：蔓延只用 4 正交邻 …
AssertionError: 对角草 (7,7) 必须原样幸存（4 邻蔓延烧不到它）: expected 33 to be 10
Tests  1 failed | 11 skipped (12)
```

**R2 删 12 次封顶**（去掉 `|| cell.exposedToFire >= 12`）→ 对抗③：

```
FAIL … 对抗③：每格每回合 12 次暴露封顶 …
AssertionError: 封顶后连直燃都必须被拒: expected true to be false
Tests  1 failed | 11 skipped (12)
```

**R3 alwaysIgnite 旁路失效**（丢掉 `alwaysIgnite ||`）→ 对抗④：

```
FAIL … 对抗④：alwaysIgnite 直燃旁路 …
AssertionError: 直燃旁路：30 格必须全部点燃（实测 4）: expected 4 to be 30
Tests  1 failed | 11 skipped (12)
```

**R4 删 fillSpawnMap 的 SURFACE 守卫** → 对抗⑤：

```
FAIL … 对抗⑤：T_OBSTRUCTS_SURFACE_EFFECTS 守卫 …
AssertionError: 楼梯必须拒绝火 DF（T_OBSTRUCTS_SURFACE_EFFECTS）: expected true to be false
Tests  1 failed | 1 passed | 10 skipped (12)
```

**R5 promoteChance 打回 0**（衰老断线 = F-1 原状）→ 对抗⑥：

```
FAIL … 对抗⑥：衰老驱动必须真正接通 …
AssertionError: 60 回合后必须大半火格已衰老离场（实测 0/60）: expected 0 to be greater than 40
Tests  1 failed | 11 skipped (12)
```

**R6 气体消散 2→3**（哨兵试金石）→ 对抗⑪：

```
FAIL … 对抗⑪：气体子系统回归哨兵 …
AssertionError: type=2 气体曲线漂移: expected [ …(14) ] to deeply equal [ …(14) ]
Tests  1 failed | 11 skipped (12)
```

六条全部还原并复绿（f_2a + f_1 共 23/23 通过）。

---

## 十、给 F-2b / F-2c / G-1 的登记清单

**F-2b（生物燃烧状态机 + 火免）**：
1. Game.ts:6227 固定 2 伤害仍在（§三红线保持）；CE 两段模型
   （踩 T_IS_FIRE → exposeCreatureToFire 上 STATUS_BURNING；燃烧生物
   `rand_range(1,3)`/回合、可被水扑灭、**点燃所踩地形 exposeTileToFire(true)**
   ——入口已就位，Time.c:530-543）。
2. F-0 §六.2 的 resist_fire 药水断线原样存在（本轮未碰）。
3. creeping_death 幽灵气（Game.ts:2872 写 type=1）原样存在。

**F-2c（爆炸）**：
4. bloat 仍走 `igniteForced`（现 = DF_PLAIN_FIRE 单点 ×5）；CE 的
   GAS_EXPLOSION 地形（`T_CAUSES_EXPLOSIVE_DAMAGE` max(15-20, 50%)，
   Globals.c:496 + DF_BLOAT_EXPLOSION :654）未实现——p4_4 预告在真爆炸
   落地时翻红（届时 p4_4 进允许清单）。
5. 甲烷爆轰链的 exposeTileToFire 爆轰分支已留形（结构性不可达），
   TM_EXPLOSIVE_PROMOTE 载体落地即可行使。

**G-1（气体）**：
6. f_2a 对抗⑨：水体被点燃（DF_STEAM_ACCUMULATION）留痕——接蒸汽链时
   把"深水不可点燃"翻成"水消耗 + 蒸汽落地"，并连带处理 TM_EXTINGUISHES_FIRE
   的灭火层选择（exposeTileToFire 的选择逻辑已移植，届时自然生效）。
7. f_2a 对抗⑪ 的气体基线可作 G-1 的"改前"参照（连同 F-0 §4.5 六条曲线）。
8. 火贴水冒蒸汽（web 自创）与 CE 蒸汽来源并存中——G-1 按 §5.3-9 裁决。
9. 新地形 EMBERS/ASH 无渲染分支（getTerrainVisual default → 记忆渲染空白；
   连同 F-1 登记的 PLAIN_FIRE 同款，渲染轮一并收口）。燃烧销毁的门/密门/
   锁门遗留 stale isOpaque（setTerrainLayer 不动启发式，C-4c 既有口径）——
   视觉/气体阻挡的残迹，登记给门/渲染轮次。

**桥/冰（C-5 后）**：
10. BRIDGE 的 fireType 链（DF_BRIDGE_FIRE→FALL→FALL_PREP）tile 缺失 +
    坠落子系统依赖，整链缓办中；ICE_* web 无地形。

---

## 十一、文件边界自查

```
git status --porcelain：见 §七（6 个允许清单内生产文件 + 6 个授权测试文件
+ 2 个新增：本报告与 f_2a_fire_mechanics.test.ts）。
```

- 允许清单内的生产文件：Grid.ts / TerrainCatalog.ts / DungeonFeatureCatalog.ts /
  DungeonFeature.ts（仅反向验证临时改坏，终态零 diff）/ Promotion.ts /
  Gas.ts / Game.ts。
- 既有测试：授权清单内 7 个（§八）；**无清单外文件被改**（反向验证的
  DungeonFeature.ts 改坏已还原，终态 diff 为零）。
- 探针 `zz_f0_probe.test.ts` 恢复→复跑→已删；未执行任何 git 写操作。
