# G-2 报告：GAS 层 DF 接线 + 蒸汽源 + 燃气烧完留火

> 2026-09-16。执行：ZCode/GLM。CE 源码以 `BrogueCE-master/src/brogue/` 为准
> （只读；行号本轮逐条打开复核）。前置输入：G-1 报告 §十一（本轮范围 = 那 5 条）、
> F-0 §3.3/§5.3-9。本轮对任务书/G-1 有**四处实测反驳/修正**（§八），
> 并发现并修复了一个**真实的方向数组 bug**（§八.1，ALL_DIRS8）。

---

## 0. 结论摘要

1. **四条 DF 接线 + 两个 tile 迁移**：`DF_POISON_GAS_CLOUD` / `DF_STEAM_ACCUMULATION`
   / `DF_METHANE_GAS_PUFF` / `DF_GAS_FIRE` 的 tile 列填上；`GAS_FIRE`（SURFACE
   火地形）与 `METHANE_GAS`（第六种气体）两个 tile 迁入目录；新增
   `DF_EXPLOSION_FIRE` 条目登记（tile 缺，归 F-2c）。G-1 §十一 的 1–4 条全部落地。
2. **G-1 预测验收：成立**（§三）——"tile 列填上即自动走 GAS 分支"在目录、
   管线、镜像对账三个层面全部实测成立；唯一不成立的子预测（"promoteTile 的
   GAS 层 VANISHES 分支会因 GAS_FIRE 落地而生效"）见 §八.2。
3. **蒸汽源换代**：CE 持续源（水体被火段点燃 → DF_STEAM_ACCUMULATION，
   每回合 +15）接通；web 自创"火贴水 30% 冒 325"一次性分支**退役**。
   新旧曲线对比见 §四——旧形态是注入即衰减的烟团，新形态是随火存续的
   持续源（火熄后 QUICK 档散尽）。
4. **两个哨兵逐位一致**：FIRE-NAT 三条曲线（42/2026/777）与 F-2a §一、与
   本轮改动前实测**逐位相同**；DMG-FIRE 与 F-2b §七相同（本轮探针实测，
   §五）——蒸汽分支退役没有移动这些场景的 RNG 流。扩散算法哨兵：整除
   注入守恒 + 对角均分复验通过（g_2 对抗⑥ + g_1 既有 16 条全绿）。
5. **载体盘点**（§二）：六个未迁移气体 tile 中只迁了 METHANE_GAS
   （载体 = MUD 的 promoteType，数据自 C-4a 起就在、本轮 tile 齐备后链条
   真实行走）；其余五个（ROT/STENCH/PARALYSIS/DARKNESS/HEALING）**只登记
   不迁移**——无 web 载体，迁了就是空转链。甲烷爆轰分支激活（TM_EXPLOSIVE_PROMOTE
   载体落地），爆轰落点 DF_EXPLOSION_FIRE 因 GAS_EXPLOSION tile 未迁移而
   缓办（登记 F-2c）；dewar 无载体，只登记。
6. **门禁**：`npm run build` 绿；全量串行 `npx vitest run --fileParallelism=false`
   在终态树零失败（§七.2，数字以实跑输出为准）；对抗性测试 17 条（新文件
   `g_2_gas_df_wiring.test.ts`）+ 反向验证 5 条（§六，`grep -rn REVERT-ME src`
   = 0）。

---

## 一、接了哪些 DF（tile / layer / CE 行号）

| DF | Globals.c 行 | 条目（tileType, layer, start, decr） | tile 接线 | 生产生效路径 |
|---|---|---|---|---|
| DF_POISON_GAS_CLOUD | :770 | `{POISON_GAS, GAS, 1000, 0}` | `tile: POISON_GAS` | 目录管线可用；陷阱调用点仍直呼 `addGas(1000)`（G-1 折算同量，§八.3） |
| DF_STEAM_ACCUMULATION | :666 | `{STEAM, GAS, 15, 0}` | `tile: STEAM` | **真实生产路径**：深水（chanceToIgnite 100、fireType 本 DF）被火段点燃 → promoteTile(LIQUID) → GAS 分支 +15/回合 |
| DF_METHANE_GAS_PUFF | :667 | `{METHANE_GAS, GAS, 2, 0}` | `tile: METHANE_GAS` | **真实生产路径**：MUD.promoteType（promoteChance 100 = 1%/回合，D3+ 泥格）经晋升两趟驱动 → GAS 分支 +2 |
| DF_GAS_FIRE | :741 | `{GAS_FIRE, SURFACE, 0, 0}` | `tile: GAS_FIRE` | **真实生产路径**：可燃气体（POISON/CONFUSION/METHANE，ign 100）被点燃 → promoteTile(GAS) → SURFACE 落火 + 上游体积清零（Time.c:1362）；promoteChance 8000 = 80%/回合自熄 |
| DF_EXPLOSION_FIRE（新增条目） | :742 | `{GAS_EXPLOSION, SURFACE, 60, 17}` | `tile: null`（登记） | METHANE_GAS 的爆轰 promoteType（TM_EXPLOSIVE_PROMOTE + 8 邻全 `T_IS_FIRE\|T_OBSTRUCTS_GAS\|TM_EXPLOSIVE_PROMOTE` 时选用）；落地因 GAS_EXPLOSION tile 未迁移而缓办，**登记 F-2c** |

新增目录条目使 DF 目录 21 → **22** 条；`DF_MISSING_TILES` 10 → **7**
（摘除 4 条已接线、增补 DF_EXPLOSION_FIRE）。

tile 迁移（TerrainType 尾部追加，既有枚举值不变）：
- **GAS_FIRE = 37**（CE Globals.c:495）：`T_IS_FIRE`、(STAND_IN_TILE |
  VANISHES_UPON_PROMOTION | VISUALLY_DISTINCT)、ign 0、promoteChance **8000**、
  drawPriority 10、归属 **SURFACE**。进 `FIRE_TERRAIN_TYPES`（isBurning 派生集）。
- **METHANE_GAS = 38**（CE Globals.c:507）：`T_IS_FLAMMABLE`（ign 100）、
  (STAND_IN_TILE | **TM_EXPLOSIVE_PROMOTE**)、fireType DF_GAS_FIRE、promoteType
  DF_EXPLOSION_FIRE、**无消散旗标（永不自散）**、prio 35、归属 GAS。
  `GasType.METHANE` 同步入枚举（数值 = 层值，同 POISON 等惯例）。

---

## 二、载体盘点表（任务书 §门禁.3）

| 项 | CE 载体（实测出处） | web 今天有载体吗 | 本轮做了什么 |
|---|---|---|---|
| METHANE_GAS tile | **MUD.promoteType = DF_METHANE_GAS_PUFF**（Globals.c:415，promoteChance 100）；web MUD 自 C-4a 起携带同款数据，且 MUD 在 D3+ 真实生成（Architect.ts:747） | **有**（链条一直在掷骰，只是落地被缺 tile 缓办） | **迁移 tile + 接线**——对抗⑨ 游戏级验证晋升链产气 + 镜像对账 |
| 甲烷爆轰 | TM_EXPLOSIVE_PROMOTE（Globals.c:507）+ exposeTileToFire :1347-1356 | 分支代码在（F-2a 留形），载体缺 | **载体随 METHANE_GAS 落地，分支激活**；爆轰落地（DF_EXPLOSION_FIRE）缓办登记 F-2c；**顺带修复 ALL_DIRS8 方向 bug**（§八.1） |
| ROT_GAS | **zombie**：`bloodType = DF_ROT_GAS_BLOOD`（血即腐气，Globals.c:1075 列 11）+ `DFChance 100 / DFType = DF_ROT_GAS_PUFF`（每醒回合冒 15 体积，列 14/15）；web monsters.json:658 有 zombie 但**未实现**这两组列 | 无（怪物侧机制未实现） | **只登记**。接上需先实现怪物 bloodType/DFType/DFChance 发射机制——归 G-3/怪物侧轮次；先迁 tile 只会造出无写入点的死数据 |
| STENCH_SMOKE_GAS | HAY 的 fireType（Globals.c:452 干草→臭烟→火链）+ DF_STENCH_SMOLDER | 无（web 无 HAY 地形） | **只登记** |
| PARALYSIS_GAS | 麻痹药水的 DF（Items.c:6994/8118——CE 喝麻痹药水是在脚下铺麻痹气云） | 半个（web 有 potion_of_paralysis，但直上状态不产气；改产气=效果侧改动，且 G-3 效果未落地前云是惰性的=空转链） | **只登记**，效果与药水改线一起归 G-3 |
| DARKNESS_CLOUD | DF_DARKNESS_POTION（Items.c:7004） | 无（consumables.json 无黑暗药水） | **只登记** |
| HEALING_CLOUD | BLOODFLOWER_POD 的 fireType/promoteType（Globals.c:514） | 无（web 无血花草） | **只登记** |
| dewar 引爆 | DEWAR_* 四个地形 tile（Globals.c:406-409，TM_PROMOTES_ON_PLAYER_ENTRY 踩上即爆 20000 体积）+ DF_DEWAR_*（71-74） | 无（无 dewar 地形、无 dewar 物品） | **只登记**（tile 与 DF 都不入目录；zh_CN.legacy.json 的 dewar 文案是 C 版遗档，非代码引用） |
| 深水蒸汽 | DEEP_WATER ign 100 + fireType DF_STEAM_ACCUMULATION（Globals.c:413）；SHALLOW_WATER ign 0 不可燃（:414） | 数据在（C-4a 照抄），缺 tile | **接线**（浅水不可燃同步实测钉死，g_2 对抗②） |

登记形态：对抗⑦（g_2 文件）以**结构性断言**留痕——五个未迁移气体名在
`TerrainType`/`GasType` 中不存在成员、十条无载体 DF 不在目录、
`DF_MISSING_TILES` 恰 7 条含 DF_EXPLOSION_FIRE。

---

## 三、G-1 预测的验收结论（任务书 §门禁.4）

G-1 §十一.1 预测："DF_POISON_GAS_CLOUD / DF_STEAM_ACCUMULATION /
DF_METHANE_GAS_PUFF 的 tile 列填上即自动走 DungeonFeature 的 GAS 分支
（volume 累加已接、镜像对账路径已备）"。**逐层验证，成立**：

1. **目录层**：tile 填上前 `catalogFeature` 抛错点名；填上后 4 条 DF 全部
   正常转换（c_4b E4 翻正位实测）。
2. **管线层**：`spawnDungeonFeature` 的 GAS 分支（DungeonFeature.ts:581-594，
   G-1 已接）对填充后的 DF 真实累加 volume 并写 GAS 层——实测
   POISON_GAS_CLOUD +1000、STEAM_ACCUMULATION +15、METHANE_GAS_PUFF +2
   （g_2 对抗②③④⑥的单元断言）。
3. **镜像对账层**：Game.objectiveTimeBlock 的
   `gasVolumeAdded > 0 → syncGasMirror` 分支（Game.ts:5661-5664，G-1 埋的
   "今天不可达"路径）接线后自动成为活路径——对抗⑨ 把 MUD promoteChance
   临时抬到 10000 驱动一个真实客观块：晋升命中 → `lastPromotionUpdate`
   里该次晋升 `spawn.gasVolumeAdded === 2`、全场镜像 ≡ 层真相（逐格扫描）。
4. **火段层（本轮新增的生效路径）**：深水点燃 → DF_STEAM_ACCUMULATION
   同样走 G-1 已接的管线，蒸汽随后由块尾 `updateGases` 的全量镜像重建
   覆盖对账。

**不成立的子预测**（G-1 §Promotion.ts 注释）：GAS 层 VANISHES 连 volume
清零的分支"G-2 的 GAS_FIRE 落地时生效"——实测 GAS_FIRE 是 SURFACE 层
火地形，它的 VANISHES 走通用清层路径（清 SURFACE、不动 volume）；GAS 层
VANISHES 分支在 CE 现目录下依然无载体（CE 的 GAS tile 均无该旗标）。
注释已翻正，分支按 CE 原样保留留形（§八.2）。

---

## 四、蒸汽源：新旧曲线对比 + web 自创分支退役

**退役**：`Gas.updateFires` 第 3 步（燃烧格 8 邻逐格 30% 掷骰 → `addGas(STEAM, 325)`
一次性）已删。CE 蒸汽源经既有火段（runFireUpdate → exposeTileToFire →
promoteTile(LIQUID, useFireDF)）自动发生，无需 Gas.ts 任何新代码。

探针口径：合成场景（D1 上深水一格 + 草地一格正交相邻，`ignite` 草地，
等待 40 回合，记录全场 STEAM 体积总量/格数）。改动前后各实跑一遍：

```
[STEAM-CURVE] 改动前 seed=42  total/cells [250/10 206/14 181/17 148/17 121/18 88/18 67/18 45/18 32/18 24/18 10/17 1/4 1/1 1/1 0/0 …]（注入即衰减，14 回合散尽）
[STEAM-CURVE] 改动前 seed=2026 total/cells [0/0 253/13 188/17 151/22 376/23 611/34 810/41 750/42 962/46 905/49 866/51 … 45/31 22/26 6/11 0/0 …]（多次 30% 掷中的阶梯，火熄后单调衰减）
[STEAM-CURVE] 改动后 seed=42  total/cells [1/1 7/3 12/4 15/4 15/5 19/5 20/5 18/5 27/6 31/7 34/8 31/8 … 43/10 42/10 42/10 41/10]（+15/回合持续注入，火存续则总量爬升）
[STEAM-CURVE] 改动后 seed=2026 total/cells [3/1 5/3 9/4 13/5 15/5 15/5 15/5 18/5 21/6 26/7 … 20/10 9/10 10/10 7/7 5/5 2/2 0/0 …]（火于 ~t23 熄 → 源断 → QUICK 档散尽）
```

读法与说明：
- 旧形态的一次性 325 烟团单回合注入量大，但与火寿**无关**（火还烧着也
  不续）；新形态 +15/回合与火段每回合的重暴露精确挂钩——火是源开关。
- 新形态绝对注入量低约一个量级（15 vs 325×30%期望≈97/回合），但
  **持续**且随火寿累积；QUICK 档消散（50%/轮×2 轮，期望 −1/格/回合）
  在 5-10 格的云上每回合吃掉 5-10，故净增速 ~+5-10/回合（实测含随机
  舍入噪声）。
- 火熄后曲线形状一致（QUICK 档散尽）；区别只在火存续期间。
- **RNG 流登记**（项目常识 §四）：退役的 30% 掷骰从"火贴水"场景的流里
  消失；同时水体点燃消耗 `rand_percent(100)` 每回合一次。同 seed 的
  后续事件在"火贴水"场景会与旧引擎分岔。FIRE-NAT 三场景（草地点火）
  实测不含水邻格 → 三条曲线逐位未动（§五），generation_baseline 不受
  影响（生成期无火）。

---

## 五、两个哨兵的逐位比对（任务书 §门禁.1/2）

**火侧哨兵：PASS。** F-0 探针协议（适配现行引擎：无 burnDuration、
igniteForced 无时长实参），改动前后各复跑一遍，三条曲线三方一致
（F-2a §一 ⇄ 改动前 ⇄ 改动后）：

```
[FIRE-NAT] seed=42   origin=(5,20)  [1,1,1,2,3,5,6,6,6,6,7,6,6,7,7,7,7,7,6,6,6,6,6,5,6,6,5,5,5,5,5,5,5,5,5,6,6,6,5,5] ≡ F-2a §一 ≡ 改动后
[FIRE-NAT] seed=2026 origin=(68,14) [1,2,3,3,4,4,5,5,6,7,9,9,10,11,11,13,12,12,13,14,13,13,15,15,15,14,12,11,8,8,8,8,5,5,5,5,5,4,4,4] ≡ F-2a §一 ≡ 改动后
[FIRE-NAT] seed=777  origin=(31,23) [1,1,1,1,1,0,…] 全熄@6 半径0                                                      ≡ F-2a §一 ≡ 改动后
[DMG-FIRE] seed=42   cleanTurns=12 hpDeltas=[1,2,3,3,3,2,2,1,3,1,2,0]   ≡ F-2b §七 ≡ 改动后
[DMG-FIRE] seed=2026 cleanTurns=5  hpDeltas=[3,1,3,2,3]                 ≡ F-2b §七 ≡ 改动后
[DMG-GAS]  seed=42 STEAM hpDeltas=[1,0,…] / POISON hpDeltas=[0,…]       ≡ 改动前（直注入场景不受本轮影响）
```

（测试侧哨兵：g_1 对抗⑧ seed42 逐位断言全绿；g_2 对抗⑤ 新钉 seed2026
全 40 位 + seed777 31 位——位宽 31 是 wait-only 策略下玩家 31 回合死亡的
确定性截断，与 F-0 探针同形。）

**扩散算法哨兵：PASS。** 算法本体（updateGases）零改动（diff 可证）。
行为复验：7200 整除注入单轮守恒（探针 `[GAS-DIFF] before=7200 after=7200
equal=true`）；g_1 既有 16 条（8 邻均分/守恒/随机舍入/二档消散/3 压制/
chasm/被困气/镜像）全绿；f_2a/f_2b 的 GAS_BASELINE 四型曲线逐位哨兵全绿
（新气源初值不同是预期的，算法没动）。

**本轮新发现的算法性质（登记，不是偏差）**：updateVolumetricMedia 在
`T_OBSTRUCTS_GAS`（墙/门）邻域存在**期望漂移**——整除注入 9000 在封闭
房间内扩散，前两轮精确守恒（9000），从体积触及墙界起总量逐轮上漂
（t3=9683 → t6=10528，实测）。这是 CE 算法原样（每格独立随机进位 +
边界格 numSpaces 变小的结构后果），web 逐行移植含此性质，非本轮引入。
g_2 对抗⑥ 的守恒断言因此只取"内部相位"（2 轮、体积未触界）。

---

## 六、对抗性测试与反向验证

### 6.1 对抗性测试（新文件 `src/test/g_2_gas_df_wiring.test.ts`，17 用例全绿）

| # | 捕获的错误实现 | 断言锚点 |
|---|---|---|
| ①目录 | DF 的 tile 填错层（GAS 的填进 SURFACE 或反之） | 三条 GAS DF：layer=GAS 且 tile 归属层=GAS；DF_GAS_FIRE：layer=SURFACE 且 tile 归属层=SURFACE（交叉双锁） |
| ①行为 | DF_GAS_FIRE 按 GAS 层接线 | 点燃毒气后 GAS_FIRE 落 SURFACE；全场扫描 GAS 层绝不出现 GAS_FIRE |
| ② | 蒸汽源写成一次性/注入点错格 | 火段暴露一次即在被点燃水格 GAS 层 +15（updateGases 之前观测）；浅水（ign 0）不产蒸汽；火贴水期间总量 v1<v3<v6 单调增 |
| ③ | 体积清零怪癖写错位置/漏写 | 点燃后 volume=0 + GAS 层类型暂留（:1361-1368）+ 下一轮收层（:1432-1436） |
| ④ | promoteTile 的缓办没撤除（tile 已在却仍缓办） | promoteTile(GAS, useFireDF) → deferred=null、spawn.succeeded、gasVolumeAdded=0、GAS_FIRE 留地；深水同链 +15 |
| ⑤ | 火侧被本轮意外改动（回归哨兵） | FIRE-NAT seed2026 全 40 位 + seed777 31 位逐位基线（与 g_1 对抗⑧ 的 seed42 互补） |
| ⑥ | G-1 的扩散算法被本轮意外改动 | DF 管线注入 9000 单轮守恒 + 对角均分；甲烷静态消散旗标 = 0 + 整除注入 2 轮逐位 9000 |
| ⑦ | 无载体的 tile 被接成空转链 | 五个未迁移气体名无 TerrainType/GasType 成员；十条无载体 DF 不在目录；DF_EXPLOSION_FIRE 在 DF_MISSING_TILES 且 catalogFeature 抛错点名 GAS_EXPLOSION |
| ⑧ | 爆轰分支选路错 / ALL_DIRS8 方向数组错 | 8 邻全火 → 走 promoteType（缓办点名 GAS_EXPLOSION、不留 GAS_FIRE）；唯 (1,1) 角为地板的 7 邻 → **不**爆轰、走 fireType 留 GAS_FIRE（错误方向数组把 (1,-1) 数两次、(1,1) 不查 → 误爆轰翻红） |
| ⑨ | G-1 预测"填上即自动生效"回潮 | MUD promoteChance 抬 10000 驱动真实客观块：晋升命中 → spawn.gasVolumeAdded=2 → 镜像逐格 ≡ 真相 |

（任务书 §六.2 点名的七类全覆盖：填错层①、一次性蒸汽②、GAS_FIRE 按
GAS 层接线①③④、缓办没撤除④、火侧哨兵⑤、扩散哨兵⑥、空转链⑦。）

### 6.2 反向验证（5 条，真实改坏 → 真实失败输出 → 还原；`grep -rn REVERT-ME src` = 0）

**R1 DF_GAS_FIRE.tile 改回 null（缓办回潮）→ g_2 5 处翻红：**

```
AssertionError: tile 已迁：缺 tile 缓办必须撤除: expected { x: 4, y: 4, layer: 2, df: 101, …(4) } to be null
AssertionError: 燃气之火落 SURFACE（CE Globals.c:741）: expected +0 to be 37 // Object.is equality
（另 3 处：目录 tile 断言、promoteTile spawn 断言、爆轰 7 邻断言同翻红）
Tests  5 failed | 12 passed (17)
```

**R2 DF_STEAM_ACCUMULATION.tile 改回 null（蒸汽源断线）→ f_2a ⑨翻红：**

```
AssertionError: 蒸汽落在被点燃水格的 GAS 层: expected +0 to be 36 // Object.is equality
Tests  1 failed | 11 passed (12)
```

**R3 DF_GAS_FIRE.layer 改成 GAS（任务书点名的错误实现）→ g_2 5 处翻红：**

```
AssertionError: expected 2 to be 3 // Object.is equality            （目录 layer 断言）
AssertionError: 燃气之火落 SURFACE（CE Globals.c:741）: expected +0 to be 37   （GAS_FIRE 被写进 GAS 层，SURFACE 为空）
（另 3 处同链翻红）
Tests  5 failed | 12 passed (17)
```

**R4 ALL_DIRS8 回退错误形态（{1,-1} 重复、{1,1} 缺失）→ 对抗⑧翻红：**

```
AssertionError: 7 邻不构成爆轰：燃气之火必须留地: expected +0 to be 37 // Object.is equality
Tests  1 failed | 16 passed (17)
```

**R5 FIRE_TERRAIN_TYPES 漏登记 GAS_FIRE → c_4a 恒等断言翻红：**

```
AssertionError: 本断言失败 = 目录里的火地形集合变了: expected [ 31, 37 ] to deeply equal [ 31 ]
Tests  1 failed | 19 passed (20)
```

五条全部还原并复绿（g_2 17/17 + c_4a 20/20）。

---

## 七、既有测试改动逐条清单 + 门禁

### 7.1 既有测试改动（全部在授权清单内，守卫性质未放宽）

| 文件 | 改动 | 为什么到期 | 守卫性质未放宽 |
|---|---|---|---|
| c_4a_0_layer_model.test.ts | 两张穷尽式 toEqual 全量表各 +2 行（GAS_FIRE: SURFACE/10；METHANE_GAS: GAS/35）；SURFACE 归属循环 +GAS_FIRE | 任务书授权清单 + 任务书预告（"新增任何地形必打红那两张穷尽式全量表"） | 穷尽性质不变（全键 toEqual 原样，只添新键） |
| c_4a_terrain_catalog.test.ts | names 37→39；新增"G-2 新增条目"逐字段钉死用例（GAS_FIRE/METHANE_GAS 全字段 + 错误实现注释）；TM_EXPLOSIVE_PROMOTE 入 import | 同上 | FIRE_TERRAIN_TYPES 恒等断言本体零改动（双向锁自动吸纳 GAS_FIRE）；逐字段钉死 = 穷尽断言 |
| c_4b_dungeon_feature.test.ts | E1 21→22 + DF_EXPLOSION_FIRE=102 对位；E2 闭包 21→22；E3 增 4 条 tile 接线断言 + DF_EXPLOSION_FIRE 条目抽查 + gasFire.tile 翻正；E4 缺 tile 10→7 + 4 条翻正位 | 任务书授权清单；目录数据变化是本轮本体 | E2 集合相等断言原样（多抄/漏抄/悬空仍全翻红）；E4 的"missing 必须 tile=null + 抛错点名"原样；**DF_EXPLOSION_FIRE 的 tile=null + 抛错是新增守卫不是放宽** |
| c_4c_promotion.test.ts | B5 注释翻新（"泥的晋升目标 tile 缺失被缓办"→"tile 齐备，掷中真冒气，泥不消耗"） | 授权清单；该断言的行为前提（MUD 晋升）本轮落地 | **断言零改动**（rngDraws 3/1 两次掷骰口径在两种形态下都成立），只改注释 |
| f_1_fire_as_terrain.test.ts | 对抗⑦的 GAS 层守卫白名单 +METHANE_GAS | 授权清单；METHANE_GAS 是合法第六种气体，守卫集合必须与目录同步 | 守卫半边原样（非气体地形出现在 GAS 层仍翻红） |
| f_2a_fire_mechanics.test.ts | 对抗⑨按自带授权翻转："水体不可被点燃" → "水体被点燃产出持续蒸汽"（直燃一次 +15 + 火贴水总量单调增 + 水层不消耗） | 授权清单 + 该测试注释自带的翻转许可（"G-1 接 CE 蒸汽来源（§5.3-9）时本断言到期"——实际到期于本轮，任务书 §二.3 即此事） | 水层不消耗（CE：水是源不是燃料）为新守卫；无任何阈值放松 |

p1_24 / p4_4 / f_2b / g_1：**零改动**（授权未动用）——全量门禁实测它们的
既有断言在本轮行为下全部继续成立（蒸汽分支退役没有触及它们的注入式
场景；p1_24 的 STEAM 直接注入与 p4_4 的 bloat 注入均不经火段）。

### 7.2 门禁逐条（任务书 §五）

1. **反向哨兵——火的蔓延/寿命不变：PASS**（§五：FIRE-NAT 三曲线 + DMG-FIRE
   逐位一致；蒸汽相关的 STEAM-CURVE/DMG-GAS 按预告变化，单独说明见 §四）。
2. **G-1 的扩散/消散算法不得改动：PASS**（updateGases 零 diff；行为复验 §五；
   边界期望漂移为 CE 原样性质的登记，见同节）。
3. **载体盘点表：见 §二。**
4. **G-1 预测验收：成立**（§三；唯一不成立的子预测 §八.2）。
5. **决定性复验 + generation_baseline 绿 + 坏层闸门 0：见下方全量输出**
   （c_1/c_2/generation_baseline/p1_26/p1_29/p1_33 均在全量串行内）。
6. **build / npm test**：见下。

```
npm run build（exit 0）：
(!) Some chunks are larger than 500 kB after minification. …
✓ built in 1.37s
```

```
全量串行 npx vitest run --fileParallelism=false（终态树——探针已删后复跑；EXIT=0）：
 Test Files  72 passed (72)
      Tests  807 passed | 8 skipped | 5 todo (820)
（账目对账：G-1 终态 71 文件 / 802 用例（789 passed + 8 skipped + 5 todo）
  → 本轮 +1 文件（g_2_gas_df_wiring，17 用例）+ c_4a_terrain_catalog
  +1 用例（G-2 新增条目钉死）= +18 用例；f_2a 对抗⑨ 为 1:1 翻转（数量
  不变）、其余改动文件用例数不变。789+18=807 passed、802+18=820 total、
  71+1=72 文件，逐项可对上。）
```

---

## 八、与预设不符之处 / 对任务书与 G-1 的反驳（只列事实）

1. **★ Promotion.ts `ALL_DIRS8` 方向数组抄错（真实 bug，本轮修复）**：
   原文 `[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,-1]`——
   **`{1,-1}` 出现两次、`{1,1}` 缺失**；CE nbDirs（GlobalsBase.c:38）为
   `{0,-1},{0,1},{-1,0},{1,0},{-1,-1},{-1,1},{1,-1},{1,1}`。该数组只被
   爆轰分支的邻居计数消费，F-2a 引入时分支不可达故无观测后果；本轮
   TM_EXPLOSIVE_PROMOTE 载体落地使分支激活，**不修就会把"7 邻火 +
   (1,1) 空角"的甲烷格误判爆轰**（(1,-1) 数两次凑满 8）。这正是项目常识
   里 dirs8 漏 `[1,1]` 的历史事故形态。已按 CE 修正 + 对抗⑧回归钉 +
   反向验证 R4。Promotion.ts 在允许清单内。
2. **G-1 子预测不成立**："GAS 层 VANISHES 连 volume 清零分支会因 GAS_FIRE
   落地而生效"——GAS_FIRE 在 SURFACE 层，其 VANISHES 走通用清层路径；
   CE 现目录的 GAS tile 均无 VANISHES，该分支仍是忠实留形（注释已翻正，
   Promotion.ts）。CE 行号实据：Time.c:1262-1264 的 `if (layer == GAS)`
   在 VANISHES 分支内部，与 GAS_FIRE 无关。
3. **任务书 §二.1 的"三条已有 tile 的 DF"含 DF_METHANE_GAS_PUFF，但其
   tile（METHANE_GAS）在 G-1 的六未迁清单里**——两处合读时"已有 tile"
   实为"两条已有 + 一条需先迁 tile"。按任务书 §二.2 的授权（METHANE_GAS
   有真载体：MUD）先迁 tile 再接线，两个条款同时满足。若验收方本意是
   "三条中 METHANE_PUFF 只登记"，本轮的实现是超集——多迁的 tile 有
   真实生产载体，不是空转链。
4. **毒气陷阱调用点未改走 DF 路径**（任务书未硬性要求，G-1 注释预告
   "接线本身归 G-2"的解读登记）：Game.triggerTrap 仍直呼
   `addGas(x, y, POISON, 1000)`——体积结果与 DF 管线逐位等价（G-1 已按
   DF_POISON_GAS_CLOUD 折算）；改走 DF 会叠加一条 CE 原文消息
   （"a cloud of caustic gas sprays upward from the floor!"）与既有
   i18n 陷阱文案的双播问题，属游戏侧文案归并，登记给 G-3/数据轮。
   DF 本体的目录接线（本轮交付物）不受影响。
5. **任务书 §门禁.1 说"蒸汽相关的 DMG/曲线本轮预期会变"——实测 DMG-FIRE
   逐位未变**：两条 DMG-FIRE 场景（玩家脚下点火）的火邻域不含水格，
   蒸汽源既不注入也不消耗这些场景的 RNG。变化只发生在火贴水场景
   （STEAM-CURVE，§四）。
6. **甲烷 2 体积 puff 会很快变成"不可见残气"**（G-1 §八.6 登记的同一
   机制）：2 体积在 9 格均分下 nv≤3，类型不随体积传播（CE :1427-1431
   只在 nv>3 时换型），源格 nv<1 即收层——一两轮后体积仍在（守恒/漂移）
   但层已 NOTHING。CE 同款（泥沼在 CE 里也因此不显示沼气雾）。本轮按
   CE 原样处理，不压制；对抗⑨ 的断言 accordingly 锁"体积在场 + 镜像
   一致"而非"可见类型"。
7. **`randPercent(100)` 的消耗**：水体每回合点燃消耗一次掷骰（CE
   rand_percent 同）。空场景无影响，已在 §四 RNG 登记合并说明。
8. **zh_CN.json 零改动**（授权"仅增键"，实际无需）：本轮没有新增任何
   i18next 调用点；DF description 的消费路径（晋升消息直记 CE 原文）
   沿 F-2a 既有口径，本轮无新消息。

---

## 九、给 G-3 / F-2c / 后续轮的登记清单

**G-3（气体效果与生物侧）**：
1. 六种效果（恶心/麻痹/黑暗/疗养 + 伤害/回复比例）仍未接——
   ROT/STENCH/PARALYSIS/DARKNESS/HEALING 五气体的 tile 迁移与效果落地
   应**同轮做**（各自载体见 §二盘点表：zombie 双列、麻痹药水改线、
   黑暗药水需新增、血花草需新增地形）。
2. 麻痹药水（web 有 potion_of_paralysis）改产 PARALYSIS_GAS 云时，
   参照 CE Items.c:6994/8118（DF_PARALYSIS_GAS_CLOUD_POTION，1000 体积，
   半径 4）。
3. 毒气陷阱调用点若统一改走 DF 管线，需处理 DF 消息与 i18n 文案的双播
   （§八.4）。
4. 效果阈值 >20 的体积口径重裁（G-1 §十一.6-7 原登记继续有效）。

**F-2c（爆炸）**：
5. DF_EXPLOSION_FIRE 目录条目已备（start 60/decr 17，tile null）——
   迁移 GAS_EXPLOSION tile、填 tile、摘 DF_MISSING_TILES 后，甲烷爆轰圈
   自动成形（爆轰判定与选路已实测可达，见对抗⑧）。
6. GAS_EXPLOSION 地形（Globals.c:496，T_CAUSES_EXPLOSIVE_DAMAGE）落地时
   同步进 FIRE_TERRAIN_TYPES 判定集与 c_4a 两张全量表。

**后续轮**：
7. 甲烷 puff 的"快速隐身"特性（§八.6）在渲染侧无可见性承诺——若要
   泥沼冒气的视觉提示，需在渲染轮单独裁定（CE 里同样不可见）。
8. 浅水不可燃已实测钉死（g_2 对抗②）；藻湖（DEEP_WATER_ALGAE_*）未迁，
   其 promoteChance 500/300 的藻华轮替属生成侧/数据侧轮次。

---

## 十、文件边界自查

```
git status --porcelain（终态，探针删除后）：
 M brogue-web/src/engine/Environment/Gas.ts
 M brogue-web/src/engine/Map/DungeonFeatureCatalog.ts
 M brogue-web/src/engine/Map/Grid.ts
 M brogue-web/src/engine/Map/Promotion.ts
 M brogue-web/src/engine/Map/TerrainCatalog.ts
 M brogue-web/src/test/c_4a_0_layer_model.test.ts
 M brogue-web/src/test/c_4a_terrain_catalog.test.ts
 M brogue-web/src/test/c_4b_dungeon_feature.test.ts
 M brogue-web/src/test/c_4c_promotion.test.ts
 M brogue-web/src/test/f_1_fire_as_terrain.test.ts
 M brogue-web/src/test/f_2a_fire_mechanics.test.ts
?? brogue-web/src/test/g_2_gas_df_wiring.test.ts
?? brogue-web/ai_docs/g_2_gas_df_wiring_report.md
```

- 生产改动全部在允许清单内（Gas/Grid/TerrainCatalog/DungeonFeatureCatalog/
  Promotion）。**禁改文件零 diff**（BrogueCE-master/、src/components/、
  src/entities/、src/data/、src/engine/Map/ 其余文件、Generator/、
  Random.ts、vite.config.ts、harness.ts、fixtures/）。
- 既有测试改动 6 个文件，全部在授权清单内；p1_24/p4_4/f_2b/g_1 零触碰。
- 探针（zz_g2_probe.test.ts / zz_g2_scratch*.test.ts）恢复→复跑→已删；
  `grep -rn REVERT-ME src` = 0；未执行任何 git 写操作。
