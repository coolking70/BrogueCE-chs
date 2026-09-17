# B-3 报告：三张占位卷轴补实（negation / sanctuary / shattering）

日期：2026-09-17。执行：ZCode（开发方）。任务书见本轮提示词；
CE 事实来源 `BrogueCE-master/src/brogue/`（只读，本轮 0 改动）。

---

## 一、对任务书的反驳

按 §0 逐条打开核对了：`Items.c:4465`（negate）、`:4827-4881`（negationBlast）、
`:4883-4902`（discordBlast 范本）、`:4904-4939`（crystalize）、`:7941-7944`
（SCROLL_SANCTUARY）、`:8004-8010`（NEGATION/SHATTERING 分支）、`:8016-8026`
（自动鉴定）、`Globals.c:338/477/478/479`（四个 tile）、`Globals.c:603-680`
（DF 目录 + 枚举对齐）、`Rogue.h:1469-1531`（DF 枚举）、`Rogue.h:2933`
（spawnDungeonFeature 五参签名）、`Time.c:1791-1843`（updateSafetyMap 的
T_SACRED 分支在 :1813-1817）、`Time.c:3278-3330`（spawnMapDF 对 start=0 的
处理）、`Architect.c:938`（IMPREGNABLE 唯一置位源）。结论：任务书的 CE 事实
**绝大多数准确**，以下为分歧与修正：

1. **DF_SHATTERING_SPELL 的目录条目是 `{RUBBLE, SURFACE, 0, 0,
   DFF_ACTIVATE_DORMANT_MONSTER}`（`Globals.c:679`）**。任务书只说"新增该
   DF 条目"，未给出内容。行号由枚举（Rogue.h:1531 DF_SHATTERING_SPELL=56）
   对目录表逐行对齐推得，并受 :677（DF_LICHEN_GROW）/ :678（DF_TUNNELIZE）
   双重锚定；对齐方法已用 web 已有的六条 ceLine（624/654/663/666/667/672）
   交叉验证。**web 无 RUBBLE 地形**，故 web 目录条目记 `tile: null` 并加入
   `DF_MISSING_TILES`（6→7）；crystalize 的调用点对 null tile 跳过 spawn
   （catalogFeature 对 null tile 按设计抛错，C-4b E4）。CE 里该 DF 的效果
   是"晶化格脚下落一格碎石"（start=0 → spawnMapDF 只标记原点，零 RNG）。
2. **对抗③的字面在 web 不可观测，做了可观测的等价替换**。任务书 ③ 要求
   "把边界覆写与 DF 落地的顺序对调 → 边界格断言必须红"。由于上述碎石 DF
   在 web 是登记的 no-op，对调它与边界覆写不产生任何可观测差异（首轮实验
   证实：对调后 21 测试仍全绿）。CE 里该顺序真正承载的是"碎石能否落地"：
   先覆写 CRYSTAL_WALL 再 spawn 碎石会被其 T_OBSTRUCTS_SURFACE_EFFECTS 拒绝
   （Architect.c:3230）。web 侧 ③ 改为**把边界覆写挪到 FORCEFIELD 赋值之前**
   （同一格的写入顺序，末值语义），断言"边界格 = CRYSTAL_WALL（非
   FORCEFIELD）"翻红，见 §四。若验收方坚持字面 ③，需先给 RUBBLE 落地。
3. **IMPREGNABLE 守卫无载体（结构性为真），登记不实现**。CE 的
   `pmap.flags & IMPREGNABLE`（Items.c:4912）唯一置位源是机器蓝图
   `BP_IMPREGNABLE`（Architect.c:938），web 无机器系统。crystalize 循环保留
   CE 条件位置并注释说明；任务书 §7.6 的"IMPREGNABLE 格不变"断言因无法
   构造载体格而未写，按 §2 的指示在此登记（非默默略过）。
4. **"地面上盖了 SURFACE 层的墙会被漏判"的方向性修正**。任务书 §4.3 第 2 步
   的论据方向不完全准确：现有目录中没有任何 SURFACE/LIQUID 地形能在
   drawPriority 上胜过 DUNGEON 层的墙（墙族全是 0），所以"读 cell.terrain"
   并不会漏判带覆盖物的墙。真正的分歧场景是反向的：**DUNGEON 层的 DOOR
   (prio 8) 被圣徽 SACRED_GLYPH (prio 7) 盖住时，有效地形是圣徽（不挡视线）**，
   读 cell.terrain 的实现会漏判该门。CE 的字面要求（读 layers[DUNGEON]，
   Items.c:4914）照抄无疑；对抗②按此场景构造并实证翻红（见 §四）。
5. **CE 行号微漂**（不影响结论）：negationBlast 实际 :4827-4881（任务书
   :4827-4879）；crystalize 实际 :4904-4939（任务书 :4904-4935）；
   SCROLL_SANCTUARY case 块 :7941-7944（spawn+消息在 :7942-7943，与任务书
   一致）。
6. **negation 对地面物品还会清 `timesUsed`（≈CE enchant2）**：任务书字段表
   写了 `enchant1 = enchant2 = charges = 0`，实现照抄（web `timesUsed = 0`），
   并按任务书要求在代码注释点明武器/护甲 charges 是熟悉度倒计时复用位
   （CE Items.c:275/285）。此条非反驳，确认任务书正确。

## 二、载体盘点复核

| 载体 | 任务书结论 | 复核结论 |
|---|---|---|
| `negate()` 语义 | 已有两处（Game.ts BoltEffect.NEGATION） | ✅ 属实（原 :4116 / :4341）。已抽成 `negateCreatureMagic()` 三方共用，未复制第三份；对玩家目标也走清状态支（修正了我首次改写时的短路 bug，见 diff 历史） |
| AoE 扫描范本 | discordBlastFromPlayer 同构 | ✅ 照其骨架写（FOV 用 `hasLineOfSight` 实时视线判定 + 欧氏距离²） |
| 物品侧字段 | magicDetected/isCursed/runicType/runicKnown/charges/isProtected 已有 | ✅ 字段名逐一核对 Item.ts；`timesUsed` ≙ enchant2、`maxChargesKnown` ≙ ITEM_MAX_CHARGES_KNOWN |
| SACRED_GLYPH 地形 | 无，需新增 | ✅ 已新增（真地形，非借显示位） |
| T_SACRED 消费者 | isSacred 恒 false 死分支 | ✅ 已激活为真读位；`Time.c:1813-1817` 逐字核对（玩家 1 / 怪物 PDS_FORBIDDEN，分支体原样正确）；**SafetyMap 有活消费者**（逃跑 AI，Monster.ts:1141-1142 getSafetyMapForMonster → safetyNextStep），非空转链 |
| FORCEFIELD/CRYSTAL_WALL | 全无，需新增 | ✅ 已新增（含 FORCEFIELD_MELT） |
| DF 条目 | 全无（28 条） | ✅ 新增 3 条（28→31）；DF_FORCEFIELD_MELT 由 FORCEFIELD.promoteType 自动入闭包，另两条以卷轴调用点为第二起点 |
| 光照 | LightCatalog 已有 51/52/57 | ✅ 新地形 glowLight 直接挂接；updateVision 的发光地形扫描自动点亮（c_7 的载体边界留痕按其自带指示翻转，三光名入 CARRIER_KINDS） |
| Promotion 负 promoteChance | 待核对 | ✅ **C-4c 已照抄**（Promotion.ts:431-448：负值扩散型 = 首趟对合格 4 向开敞邻居 `+= -promoteChance`，非零才掷 `randRange(0,10000)`）——本轮无需补洞 |
| CE 无背包循环 | 任务书要求拿行号反驳 | ✅ 确认 negationBlast 只遍历 `floorItems`（Items.c:4847），背包/装备不受影响 |
| charmRechargeDelay | 无则登记 deferral | ✅ web 无护身符充能延迟系统，CHARM 分支登记 deferral（不做"清零充能"的假实现——CE 语义是重置为再充能延迟） |
| colorFlash / flashMonster / displayLevel / refreshSideBar | 任务书预授权跳过 colorFlash | 其余三者同批登记无载体（纯视觉） |
| pmap ITEM_DETECTED + refreshDungeonCell（:4858-4859） | 未提及 | 登记 deferral：web 无 per-cell 物品探知标记（detect magic 走实例旗标 magicDetected，已清） |
| freeCaptivesEmbeddedAt（:4925） | 无载体则登记 | ✅ 登记 deferral（机器嵌墙俘虏系统缺口）；MONST_ATTACKABLE_THRU_WALLS 致死支已实现 |

## 三、改动清单

**生产代码（6 文件）：**
- `src/engine/Core/Game.ts`
  - 新增私有 `negateCreatureMagic(target)`：CE negate() 的清魔法本体
    （diesIfNegated → 致死；否则清状态 + syncFlagDerivedStatuses +
    refreshSpeeds），原两处 bolt 分支改为调用它（分支内消息保留）；
  - 新增 `negationBlastFromPlayer(emitter)`：消息 → negate(&player) →
    怪物循环（FOV+欧氏²；死/剥离消息）→ 地面物品循环（CE :4847-4880
    逐类分派）；
  - 新增 `sanctuaryFromPlayer()`：`spawnDungeonFeature(DF_SACRED_GLYPHS)`
    （abortIfBlocking=false）→ 消息（CE 顺序：先 DF 后消息）；
  - 新增 `crystalizeFromPlayer(radius)`：欧氏²+IMPREGNABLE（登记无载体）→
    **读 `layers[DUNGEON]`** 判 T_OBSTRUCTS_PASSABILITY|T_OBSTRUCTS_VISION →
    直写 FORCEFIELD → DF_SHATTERING_SPELL（null tile 跳过）→
    ATTACKABLE_THRU_WALLS 致死 → 边界覆写 CRYSTAL_WALL（DF 之后）→
    逐格启发式同步（isPassable/isOpaque，FOV 读的是这两个字段）→
    `updateVision()` 当场重算；
  - 卷轴三分支接线（原占位日志删除；shatter 的消息提前到 crystalize 之前，
    同 CE :8008-8009）；
  - 导入 `blocksVision`、`DUNGEON_FEATURE_CATALOG`。
- `src/engine/Map/Grid.ts`：TerrainType 尾部追加 `FORCEFIELD / FORCEFIELD_MELT
  / CRYSTAL_WALL / SACRED_GLYPH`；DRAW_PRIORITY 0/0/0/7；TERRAIN_HOME_LAYER
  SURFACE/SURFACE/DUNGEON/SURFACE（CE DF 目录 layer 列同证）。
- `src/engine/Map/TerrainCatalog.ts`：四个 tile 条目，逐字段照抄
  Globals.c:477/478/479/338，含 CE 行号注释（FORCEFIELD.promoteChance=-200、
  FORCEFIELD_MELT=-10000、CRYSTAL_WALL 的 TM_REFLECTS_BOLTS + fireType
  DF_PLAIN_FIRE、SACRED_GLYPH 的 T_SACRED + glowLight）。
- `src/engine/Map/DungeonFeatureCatalog.ts`：DF 枚举 +52/53/56；目录三条
  （:675 FORCEFIELD_MELT、:676 SACRED_GLYPHS 100/100 + EMPOWERMENT_LIGHT、
  :679 SHATTERING_SPELL = RUBBLE null-tile + DFF_ACTIVATE_DORMANT_MONSTER）；
  `DF_MISSING_TILES` 6→7。
- `src/engine/Map/SafetyMap.ts`：`isSacred` 激活为 `TERRAIN_FLAGS[cell.terrain]
  .flags & T_SACRED`；文件头过时注释更新；激活时分支体已按 CE :1813-1817
  逐字重核（无遗漏条件）。
- `src/locales/zh_CN.json`：`scroll.negate_burst` / `scroll.sanctuary` /
  `scroll.shatter` 三个键保留键名、文案换 CE 原文的中文语序翻译；新增
  `scroll.negation_monster_dies` / `scroll.negation_stripped`（p1_30 门禁绿）。

**测试（5 文件，全在授权清单内）：**
- `src/test/scroll_effects.test.ts`：+9 用例（negation×3、sanctuary×2、
  shattering×3、RNG 哨兵×3——见下节；文件共 21 用例全绿）。
- `src/test/c_4a_terrain_catalog.test.ts`：43→47；B-3 两块逐字段钉死；
  D 组等价断言按 B-1 反转范本引入 `POST_LEGACY_TILES`（迁移后新增的墙族
  tile 无旧判据，跳过等价比较、另立 CE 正向断言块）。
- `src/test/c_4a_0_layer_model.test.ts`：两张全量表 +4 行；SURFACE/DUNGEON
  归属列表 +4。
- `src/test/c_4b_dungeon_feature.test.ts`：E1 28→31 + 三个 id 断言；E2
  第二起点 +DF_SACRED_GLYPHS/DF_SHATTERING_SPELL、闭包 28→31；E3 +三条
  字段抽查；E4 6→7。
- `src/test/c_7_lighting.test.ts`：EXPECTED_GLOW +4 行；非零清单 7→10；
  SIGN 注释修正（"非 SACRED_GLYPH"→"借用显示位，真 SACRED_GLYPH 另列"）；
  载体边界留痕按其自带指示翻转（三光名入 CARRIER_KINDS）。

`p4_9_safety_map.test.ts` 在授权清单内但无需改动（isSacred 无既有断言）；
sanctuary 行为终点断言写在本轮主场 scroll_effects.test.ts。

## 四、对抗性测试与反向验证

三条对抗断言（+哨兵验证），每条都真实改坏生产代码 → 跑测试 → 还原；
`grep -rn "REVERT-ME" src/` 终态 **0 条**。

**① 距离判据改切比雪夫**（negationBlastFromPlayer 怪物循环）：

```
× 视野内+距离内的怪被清魔法；diesIfNegated 的当场死；距离外的完全不受影响
AssertionError: expected false to be true
  ❯ src/test/scroll_effects.test.ts:361:41
    359|         expect(wisp.hp).toBeLessThanOrEqual(0);
```
（远处怪 (77,27)：欧氏²=6452>6241 应豁免，切比雪夫 76≤79 会命中——断言
`far.hasStatus('hasted')` 收到 false。）

**② crystalize 读 `cell.terrain` 而非 `layers[DUNGEON]`**：

```
× 对抗②场景：DUNGEON 层的 DOOR 被圣徽盖住（glyph prio 7 < door 8，有效地形是圣徽）仍须被晶化——读 layers[DUNGEON] 而非 cell.terrain
AssertionError: expected 4 to be 43
  ❯ src/test/scroll_effects.test.ts:517:72
```
（4=DOOR 未被晶化，43=FORCEFIELD 期望值——圣徽盖住的门被漏判。）

**③ 边界覆写与（CE :4916-:4929 区段内的）写入顺序对调**（覆写提前到
FORCEFIELD 赋值之前）：

```
× 半径 9 内的墙变 FORCEFIELD；半径外的墙不变；边界格变 CRYSTAL_WALL（非 FORCEFIELD）
AssertionError: expected 43 to be 45
  ❯ src/test/scroll_effects.test.ts:480:71
```
（45=CRYSTAL_WALL 期望值，边界格被后来的 FORCEFIELD 盖掉。首次实验曾把
覆写"复制"而非"移动"，21 测试仍绿——正是这次失败让 ③ 的实现细节得到确认：
该顺序在 web 的可观测载体是 DUNGEON 层的末值写入，不是碎石 DF（见 §一.2）。）

**④ 交互期哨兵验证**（B-1c 教训的落实：哨兵必须被真掷骰打红）：
往 `negationBlastFromPlayer` 注入一次 `rng.randPercent(1)`：

```
× negation：读一次消耗 0 次随机数（CE negationBlast 全程零掷骰）
AssertionError: expected 1 to be +0
```

哨兵口径：`rng.randomNumbersGenerated` 增量（对流位移免疫），场景 =
`createHeadlessGame(seed, 'test')` 合成层 + 全图铺平 + 清怪清物 + 重播种
（periodic spawn 在 test 模式短路，回合结算零噪声）。钉死值：negation=0、
sanctuary=4（DF_SACRED_GLYPHS 100/100 十字波前：4 正邻各掷一次
rand_percent(100)）、shattering=0。

## 五、需要追加授权的测试

全量 `npx vitest run` 有 **2 个清单外红灯**，均为项目常识「漏授权形态①：
结构性穷举表被新增条目撞红」。按 §6 规矩**未改**，请验收方处置：

1. **`src/test/c_4c_promotion.test.ts` E3「静态盘点」**（`:568-570`）：
   ```
   AssertionError: C-5 后负值载体必须是且仅是 CE 洞族两条（HOLE:-1000/HOLE_EDGE:-500）:
   expected [ 'FORCEFIELD:-200', …(3) ] to deeply equal [ 'HOLE:-1000', 'HOLE_EDGE:-500' ]
   ```
   该守卫把 `TERRAIN_FLAGS` 中 promoteChance<0 的载体钉死为恰两条洞族。
   本轮按 CE 原值新增 FORCEFIELD:-200 / FORCEFIELD_MELT:-10000
   （Globals.c:477/478 原列，任务书 §4.3 明文要求的数据），必然撞红。
   翻转建议（B-1 范本）：expected 更新为四条、断言名改"CE 负值扩散族
   恰为洞族+力场族四条"，注明 B-3 轮次。
2. **`src/test/g_2_gas_df_wiring.test.ts`「F-2c 翻转」**（`:448`）：
   ```
   AssertionError: expected [ 61, 66, 104, 83, 98, 154, 56 ] to have a length of 6 but got 7
   ```
   该断言把 `DF_MISSING_TILES` 钉死为恰 6 条。本轮按任务书要求新增
   DF_SHATTERING_SPELL（RUBBLE 无载体）入列 → 7 条，必然撞红。
   翻转建议：`toHaveLength(7)` + 注明 B-3 增 DF_SHATTERING_SPELL
   （RUBBLE 待 RUBBLE 地形轮次翻正摘除）。

除此之外全量绿：`Test Files 2 failed | 79 passed (81)；Tests 2 failed |
1005 passed | 8 skipped | 5 todo (1020)`——两个失败即上述两条，
`p4_9_safety_map.test.ts` 在授权清单内但无需改动。

## 六、门禁结果

命令（§8 一级门禁定向子集）：

```
npx vitest run src/test/scroll_effects.test.ts src/test/c_4a_terrain_catalog.test.ts \
  src/test/c_4a_0_layer_model.test.ts src/test/c_4b_dungeon_feature.test.ts \
  src/test/c_7_lighting.test.ts src/test/p4_9_safety_map.test.ts \
  src/test/p1_30_i18n_gate.test.ts src/test/c_6_autogenerators.test.ts \
  src/test/generation_baseline.test.ts src/test/invented_content_pool.test.ts
```

输出尾部：

```
 Test Files  10 passed (10)
      Tests  169 passed (169)
   Start at  23:25:03
   Duration  68.22s (transform 1.72s, setup 0ms, import 5.28s, tests 222.74s, environment 2ms)
```

全量套件（`npx vitest run`）尾部：

```
 Test Files  2 failed | 79 passed (81)
      Tests  2 failed | 1005 passed | 8 skipped | 5 todo (1020)
   Start at  23:26:25
   Duration  355.09s (transform 3.78s, setup 0ms, import 33.53s, tests 3051.09s, environment 1ms)
```

（2 个失败即 §五 登记的两条清单外结构性穷举表，本轮未改。）
`npx tsc --noEmit`：零输出（无错误）。
`generation_baseline` / `c_6_autogenerators` / `invented_content_pool`
三者绿、`generation_baseline.json` 未重新捕获（git status 无该 fixture）。
本轮无生成期改动（AutoGenerator.ts 0 字节改动）。

`git diff --stat`：

```
 brogue-web/src/engine/Core/Game.ts                 | 276 ++++++++++++++++++---
 brogue-web/src/engine/Map/DungeonFeatureCatalog.ts |  49 ++++
 brogue-web/src/engine/Map/Grid.ts                  |  38 ++-
 brogue-web/src/engine/Map/SafetyMap.ts             |  16 +-
 brogue-web/src/engine/Map/TerrainCatalog.ts        |  52 ++++
 brogue-web/src/locales/zh_CN.json                  |   8 +-
 brogue-web/src/test/c_4a_0_layer_model.test.ts     |  14 +-
 brogue-web/src/test/c_4a_terrain_catalog.test.ts   |  88 ++++++-
 brogue-web/src/test/c_4b_dungeon_feature.test.ts   |  59 ++++-
 brogue-web/src/test/c_7_lighting.test.ts           |  19 +-
 brogue-web/src/test/scroll_effects.test.ts         | 261 ++++++++++++++++++-
 11 files changed, 827 insertions(+), 53 deletions(-)
```

改动文件全部在 §6 授权清单内；未新建任何仓库文件（本报告除外）；
BrogueCE-master/ 零改动。

## 七、遗留与登记

**Deferral（登记未实现，均无载体）：**
1. `colorFlash` / `flashMonster` / `displayLevel` / `refreshSideBar`——纯视觉。
2. IMPREGNABLE 守卫（Items.c:4912）——机器蓝图系统缺口，结构性为真。
3. DF_SHATTERING_SPELL 的碎石落地 + DFF_ACTIVATE_DORMANT_MONSTER——RUBBLE
   tile 缺口（DF_MISSING_TILES #7）。
4. freeCaptivesEmbeddedAt（Items.c:4925）——嵌墙俘虏系统缺口。
5. CHARM 的 `charmRechargeDelay`（Items.c:4874）——web 无护身符充能系统；
   不做清零充能的假实现。
6. pmap ITEM_DETECTED 清除 + refreshDungeonCell（:4858-4859）——web 的探魔
   走实例旗标（已清），无 per-cell 载体。
7. negate() 的 abilityFlags/bolts/NEGATABLE_TRAITS/mutation 剥离——P1-28
   既有登记（本轮未扩大）。

**给 B-4 的交接：**
- `AutoGenerator.ts:149-153` 与 `:406-411` 的两条待激活缺口（DF_CRYSTAL_WALL
  序 1 / CRYSTAL_WALL 序 33）**地形侧已全部就位**：`CRYSTAL_WALL` tile +
  `DF_CRYSTAL_WALL`（Globals.c:607，`{CRYSTAL_WALL, DUNGEON, 200, 50,
  DFF_CLEAR_OTHER_TERRAIN}`）？——注意：**DF_CRYSTAL_WALL 本身尚未入 web
  目录**（本轮闭包不含它，属 C-6 缺口的生成期半边），B-4 接线时需连 DF 条目
  一起补（E1 将 31→32，E2 需为它登记第二起点：autoGenerator 表 index 1）。
- FORCEFIELD_MELT 的消融链（promoteChance -200/-10000）已由
  runPromotionUpdate 的既有负值机制自然驱动，回合期每趟晋升扫描会自动消费；
  但**周期晋升趟的驱动频率**在 web 与 CE 的对齐情况未经本轮验证（F-2a 的
  既有口径），首次实测消融手感时留意。
- 圣徽是十字 5 格（中心+4 正邻），不是单格——做显示/UI 时按波前语义来。

**本轮自查记录（供验收参考）：**
- `negateCreatureMagic` 抽取时曾写出 `!isPlayer && ...` 短路导致玩家分支
  不执行的 bug，提交前自审发现并修正（怪物施法打玩家的 negation 行为与
  改写前逐位一致）。
- sanctuary 行为终点断言初版误把"玩家格 =0"当 CE 语义——实际上玩家格按
  CE 玩家格修正（monsterCost=PDS_FORBIDDEN）最终落 30000；断言改为
  "圣徽旁普通格保持有限值"（Time.c:1833-1843 顺序下的正确口径）。
