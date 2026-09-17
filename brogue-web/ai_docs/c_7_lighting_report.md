# C-7 报告：CE 光照目录 + 矿灯深度衰减 + 引擎侧光照管线

日期：2026-09-17。分支：`round/c-7`。两段执行：主体实现（撞 5 小时配额中断，
产物由验收方快照保全为 `74809f6`）+ 本续轮收尾（TS6133、门禁、报告、
**并修复了主体实现的一个真实缺陷**，见 §六）。

改动面（对 C-7 起点 `982f9b2`，共 5 文件 +1560/−40）：

```
 brogue-web/src/engine/Core/Game.ts          | 216 +++++++++-
 brogue-web/src/engine/Lighting/LightMap.ts  | 310 ++++++++++++++
 brogue-web/src/engine/Map/LightCatalog.ts   | 399 ++++++++++++++++++
 brogue-web/src/engine/Map/TerrainCatalog.ts |  62 ++-
 brogue-web/src/test/c_7_lighting.test.ts    | 613 +++++++++++++++++++++++
```

本续轮净增（对 `74809f6`，+18/−6）：TS6133 修复（测试补 d=0 锚断言）、
playerTurnEnded 每回合视野刷新（§六）、两处注释勘误（§九.4）。

---

## 一、CE 出处与字段语义

数据与公式全部逐条抄自 `BrogueCE-master/src/brogue/`（只读）。本轮（收尾方）
对下表全部锚点做了**第二次独立重核**（含一处机械比对，见 §二）：

| 内容 | CE 位置 | 核验方式 |
|---|---|---|
| `struct lightSource`（lightColor / lightRadius{randomRange} / radialFadeToPercent / passThroughCreatures） | `Rogue.h:1794-1799` | 读源逐字段 |
| `enum lightType`（60 条，`NUMBER_LIGHT_KINDS` 收尾） | `Rogue.h:677-742` | 读源 + 枚举锚点断言 |
| `lightCatalog[NUMBER_LIGHT_KINDS]`（"radius is in units of 0.01"） | `Globals.c:955-1021` | **逐条机械比对（§二）** |
| `updateMinersLightRadius` | `Light.c:119-156` | 读源逐行（§三） |
| 矿灯基础半径深度衰减（`(DCOLS-1)*FP` → 逐次 `*85/100` → `+FP*225/100`） | `RogueMain.c:665-670` | 读源逐行 |
| `updateColors` 矿灯色按深度插值 | `RogueMain.c:538-544` | 读源 |
| `applyColorAverage` 的 C 整除舍入 | `IO.c:1529-1540` | 读源 |
| `minersLightStartColor`/`EndColor` = {180,180,180}/{90,90,120} | `Globals.c:120-121` | 读源 |
| `VISIBILITY_THRESHOLD = 50` | `Rogue.h:184` | 读源 |
| VISIBLE 标记（IN_FIELD_OF_VIEW ∧ 三通道 max(0,·) 和 > 阈值 ∧ !CLAIRVOYANT_DARKENED） | `Movement.c:2582-2589` | 读源 |
| `paintLight`（randClump 半径、抖动抽取、dispelShadows、fp_sqrt 衰减、原点双份加光） | `Light.c:54-117` | 读源逐行 |
| `updateLighting`（清零+IS_IN_SHADOW → 逐层 glowLight → 生物光 handledPlayer 模式 → 矿灯） | `Light.c:208-281` | 读源逐行 |
| 燃烧生物光条件（STATUS_BURNING 且非 MONST_FIERY，含玩家） | `Light.c:249-251` | 读源 |
| 矿灯调用 `paintLight(&rogue.minersLight, ..., true, true)` | `Light.c:268-269` | 读源 |
| `playerInDarkness`（三通道 +10 仍低于矿灯色） | `Light.c:283-287` | 读源 |
| `updateVision`（无界 FOV 掩码 → … → updateLighting） | `Time.c:859-913` | 读源 |
| `currentStealthRange`（14 基数；黑暗减半、IS_IN_SHADOW 减半可叠加；护甲加成） | `Time.c:792-810` | 读源 |
| `depthAccelerator = 1` / `amuletLevel = 26` | `variants/GlobalsBrogue.c:1019` / `:1017` | 读源 |
| `pink` = {100,60,66}（imp 光用，不在主色表） | `GlobalsBase.c:100` | 读源 |
| **paintLight 在 CE 走 substantive 主流**（`brogueAssert(rogue.RNG == RNG_SUBSTANTIVE)`） | `Light.c:65` | 读源（§五.2） |

**单位口径**（读数前必看，目录文件头注释同样声明）：
- 光照半径单位是 **0.01 格**（300 = 3 格）；`DCOLS*100` 按 **CE 的 64** 求值
  （= 6400），不用 web 终端布局的 79（`types/index.ts`）——目录数据与公式
  参数一律抄 CE 原值（D1）。
- `struct color` 迁移 7 个数值通道；`colorDances` 是渲染闪烁旗标，不迁移。
- 矿灯目录条目存 `{0,0,1}` 占位 + fade 35 是 CE 原样（`Globals.c:958`），
  运行时由矿灯管线动态覆写（web：`Game.refreshMinersLight`/`minersLightDef`）。

## 二、60 条目录逐条机械比对（收尾轮加验）

上一轮为手工抄录。本轮写了独立比对脚本（解析 CE 源码的颜色常量表 +
`lightCatalog` 60 条目，展开 web `LightCatalog.ts` 的 `C()`/`L()` 助手调用与
`CE_DCOLS*100`/`15*100` 表达式后逐字段对撞）：

```
CE color constants parsed: 212
CE lightCatalog entries parsed: 60
web LIGHT_CATALOG entries parsed: 60
RESULT: 60/60 ALL MATCH
```

比对口径：每条的颜色 **7 通道全值**（经常量名展开）、半径上下界（含
`DCOLS*100`→6400、`15*100`→1500 求值）、fade%、passThroughCreatures。
唯一特例：矿灯条目 CE 引用动态色指针 `&minersLightColor`，web 对应内联
`C(0,0,0)` 占位 + `minersLightColorAtDepth(depth)` 运行时插值——两侧语义一致。

## 三、updateMinersLightRadius：CE 行号与逐行对照

CE `Light.c:119-156`（函数体 `:120` 起）。web `LightCatalog.ts:340-398` 逐行复刻：

| CE（Light.c） | 语义 | web 对应 |
|---|---|---|
| `:123` `lightRadius = 100 * rogue.minersLightRadius` | fixpt 半径 ×100 转入"0.01 格"量纲 | `let lightRadius = 100 * baseRadiusFixpt` |
| `:125-128` 负倍率：`lightRadius / (-1*LM + 1)` | 除法收缩（C 整除） | `Math.trunc(lightRadius / (-1*lightMultiplier + 1))` |
| `:129-132` 正倍率：`*= LM`，下限 `(LM*2+2)*FP` | 乘法放大 + 地板 | 同构（`Math.max`） |
| `:134-144` STATUS_DARKNESS：`base_fraction = FP − status*FP/max`；`fraction = (bf²/FP)*bf/FP`（立方）；下限 `FP/20`；`lightRadius *= fraction/FP` | 黑暗立方衰减 | 同构（trunc 链） |
| `:146-148` 绝对下限 `2*FP` | 退化保护（此量纲下 = 2 个 0.01 格） | 同构 |
| `:150-152` `rogue.inWater && > 3*FP` → `max(半径/2, 3*FP)` | 水中减半 | 同构 |
| `:154` `radialFadeToPercent = 35 + clamp(LM*5, 0, 65)*fraction/FP` | 径向衰减 | 同构 |
| `:155` 写 `rogue.minersLight.lightRadius.{lower,upper}Bound = clamp(lightRadius/FP, -30000, 30000)` | 半径写回（0.01 格） | `radiusHundredths` |

基础半径（进层重置，web `minersLightBaseRadiusFixpt`）：CE `RogueMain.c:665-668`
`(DCOLS-1)*FP` → `depth*depthAccelerator` 次逐次 `*85/100`（**C 整除循环，非浮点
pow**——测试用独立推导的字面值钉死，如 d=1 → 3656908）→ `+= FP*225/100`。

矿灯色插值（web `minersLightColorAtDepth`）：CE `updateColors`（RogueMain.c:538-544）
`percent = min(100, max(0, depth*100/amuletLevel))`（C 整除）→ `applyColorAverage`
（IO.c:1529-1540）`(start*(100−p) + end*p)/100`（C 整除截断）。

**载体现状登记**（公式结构完整、参数恒传缺省）：
- `lightMultiplier`：CE 由光明戒指附魔累加（updateRingBonuses 级联）——
  web 无 `ring_of_light` 载体（`ItemLoader.ts:167` 仅留形登记"目录缺口，
  B-0 §5.1-9"；D2 池无此物），恒传 1。戒指落地时接 `effectiveRingEnchant`。
- `STATUS_DARKNESS`：CE 由黑暗药水设置——web consumables 无黑暗药水，恒传 0。
- `rogue.inWater`：web 无水中状态载体，恒传 0。
- 三个分支全部保留并有独立测试（戒指倍率 3 例、黑暗 3 例、水中 3 例，
  含退化下限路径），激活轮只需改传参。

## 四、载体盘点表（60 条目录的"接了/没接/为什么"）

判据（原任务书 §二.3 的口径，按续轮提示词转述）：**只接引擎侧可观测的**。
接了 = 有生产代码消费且效果可在引擎状态上观测；登记不接 = 无载体 tile/机制，
或接了也没有引擎侧可观测效果（纯渲染职权）。

### 4.1 已接（9 种，生产代码合法引用集 = 测试 CARRIER_KINDS）

| LightKind | 载体 | 消费点 |
|---|---|---|
| `MINERS_LIGHT` | 玩家（本轮接线） | `Game.updateVision` 步 3，半径/颜色随 depth 动态 |
| `BURNING_CREATURE_LIGHT` | STATUS_BURNING（F-2b 状态机） | `updateVision` 步 2：玩家 + `burningDuration>0` 怪，`MONST_FIERY` 豁免（= CE `Light.c:249-251` 同判，handledPlayer 模式含玩家） |
| `LAVA_LIGHT` | `TerrainType.LAVA` | `TERRAIN_FLAGS[LAVA].glowLight`（Globals.c:420 原列） |
| `EMBER_LIGHT` | `TerrainType.EMBERS` | 同上（Globals.c:469） |
| `FIRE_LIGHT` | `PLAIN_FIRE` + `GAS_FIRE` | 同上（Globals.c:492/495） |
| `EXPLOSION_LIGHT` | `GAS_EXPLOSION` | 同上（Globals.c:496） |
| `CONFUSION_GAS_LIGHT` | `CONFUSION_GAS` | 同上（Globals.c:503） |
| `CANDLE_LIGHT` | `TerrainType.ALTAR` | 同上（Globals.c:362 ALTAR_INERT 原列——CE 的烛光祭坛） |
| `NO_LIGHT` | 哨兵值 | 目录默认列 |

地形面共 **7 个 tile 非零**（LAVA/ALTAR/EMBERS/CONFUSION_GAS/GAS_FIRE/
GAS_EXPLOSION/PLAIN_FIRE），测试"非零恰 7 个"钉死；全 43 tile 的 glowLight
列逐值等于 CE（结构性穷尽测试，web 独有 tile 取 NO_LIGHT 并注明理由）。

### 4.2 登记不接（51 种），分四类

1. **tile 缺失，先落 tile 再接光**（c_6 报告 §十四.1 交接清单的地形族）：
   TORCH_LIGHT、SUN_LIGHT、DARKNESS_PATCH_LIGHT、FUNGUS_LIGHT、
   FUNGUS_FOREST_LIGHT、ALGAE_BLUE/GREEN_LIGHT、HAUNTED_TORCH_LIGHT、
   CRYSTAL_WALL_LIGHT、FORCEFIELD_LIGHT 等——CE 有发光 tile
   （火把墙/阳光池/黑暗斑/菌类灯海/藻井），web 尚无对应 tile。c_6 已登记
   4 个 autoGenerator 依赖条目（TORCH_WALL(13)/DF_SUNLIGHT(30)/
   DF_DARKNESS(31)/DF_LUMINESCENT_FUNGUS(38)），落 tile 的地形轮反转
   留痕（测试注释写明反转方式：加 CARRIER_KINDS + 补 TerrainCatalog 列值）。
2. **生物载体缺失**（D2 池限制或 monster 树尚无该体的发光登记）：
   WISP/SALAMANDER/IMP/PIXIE/LICH/FLAMEDANCER/SENTINEL/UNICORN/IFRIT/
   PHOENIX×2/YENDOR/SPECTRAL_BLADE/SPECTRAL_IMAGE/SPARK_TURRET/
   EXPLOSIVE_BLOAT/BOLT_LIGHT/Glyph×2/SACRED_GLYPH/DESCENT/
   DEMONIC_STATUE 等生物与机制光。
3. **引擎侧不可观测**：`TELEPATHY_LIGHT`——CE 确实在 updateLighting 里为
   `monsterRevealed` 怪泼此光（`Light.c:254-256`，maintainShadows=true），
   但 web 的心灵感应揭示走 `updateTelepathy` 的独立 LOS 掩码通道
   （Time.c:1046-1080 语义），不经光照阈值，接光无引擎侧可观测差异。
   登记为口径差（CE 有两条通道，web 一条）。
4. **渲染职权（flare/flash 族 22-32）**：SCROLL_PROTECTION/ENCHANTMENT、
   POTION_STRENGTH、EMPOWERMENT、GENERIC_FLASH、FALLEN_TORCH、
   SUMMONING、EXPLOSION_FLARE、QUIETUS、SLAYING、CHARGE_FLASH、
   INCENDIARY_DART、PORTAL_ACTIVATE 等——瞬时视觉特效，归 UI 轮。

**空转链自查**（续轮提示词点名要求）：`LightCatalog` 的生产导入点恰 3 个
（Game.ts / TerrainCatalog.ts / LightMap.ts，grep 在案）；导出的每个符号
（LIGHT_CATALOG、LightKind、CE_DCOLS、FP_FACTOR、VISIBILITY_THRESHOLD、
minersLightColorAtDepth、minersLightBaseRadiusFixpt、updateMinersLightRadius、
MinersLightState）都有真实消费点；`Game.minersLight` 公开字段被
`minersLightDef` 读写。**无"接了没人消费"的空转链。** 渲染层
（`src/components/`）零改动，仍只消费 `getLight` 旧接口
（`GameCanvas.vue:390`），格式不变——留痕测试"渲染层不得 import 光照目录"看门。

## 五、确定性口径（与 CE 的登记偏差）

1. **半径抖动**：CE `randClump(lightRadius)`（clump=1 即均匀分布）→ web 取
   上下界中点（期望的 floor），可用 `radiusHundredths` 参数显式覆写。
2. **颜色抖动**：CE 每次 paintLight 从主流抽 `randComponent` + 三通道
   `rand_range(0, *Rand)`（`Light.c:69-72`，且 `:65` 断言 SUBSTANTIVE 在案
   ——CE 的光照数值本身就是主流消费者）→ web 恒用基础三分量，不抽随机数。
   理由：光照每回合重刷，复刻该消耗会移动生成期与交互期 RNG 流
   （generation_baseline 红线）。渲染轮要闪烁时用 cosmetic RNG 自接 rand
   通道（web 侧设计选择，CE 无此分域对应）。
3. **fp_sqrt**：CE `Math.c:224` 定点表（√k·65536，k=u>>16）→ web 实数
   `sqrt` + `Math.round(·*FP)`，误差 <1/65536，仅影响衰减曲线末位。
4. **矿灯触发点归并**：CE 的重算点在进层（RogueMain.c:670）/戒指（Items.c:8728）/
   黑暗药水（Items.c:8090/:4692）；web 无戒指/黑暗药水载体，归并为
   updateVision 前置的 `refreshMinersLight()`（纯函数，值只随 depth 变，等价）。

以上均为**有意的确定性化**，不是抄写错误；每条都有测试固定行为。

## 六、本续轮发现并修复的真实缺陷：潜行读到陈旧光照

**现象**：串行全量首跑 973 绿 / 2 红，红在既有测试 `p4_9_safety_map.test.ts`
T1（逃生轨迹第一步错）与 T5（快照路径计数 0≠1）。

**定性过程**（四配置二分，全部有留痕输出）：
- 单跑复现 → 排除 B-2 并行抢 CPU 假红；
- 旧视野路径（临时替换 updateVision 为旧 `computeFOV(10)` + 早退）→ 仍红
  → 排除视野口径翻正；
- 旧视野 + 旧潜行（P4-8"恒减半"近似整体还原）→ **8/8 绿** → 基线无辜，
  C-7 真阳性；
- 新视野 + 旧潜行 → 8/8 绿 → 锁定**潜行接线**是唯一致因。

**机理**：C-7 主体把 `calculateStealthRange` 从"无条件减半"翻正为按
`playerInDarkness()` + `inShadowAt(玩家格)` 判定（CE Time.c:798-806 语义，
方向正确），但 web 的光照只挂在**渲染钩子**（update() 的 needsRender 块）
——headless 或"动作已提交、渲染未跑"的窗口里，lightMap 反映的是玩家
**旧位置**：玩家新位置光全零 → `playerInDarkness` 误真 → 潜行 7 被再砍成 3
→ 逃跑皮筋（stealth+2）从 9 缩成 5，怪物行为随之改变。CE 没有这个问题，
因为 CE 的 `updateVision` 由**每个动作结算路径** eager 调用
（Movement.c:1942 移动、Combat.c:802/968 攻击、Items.c:5509/5551 等），
Time.c:2610 主观块读 `currentStealthRange` 时光照恒新鲜。

**修复**（+8 行，Game.ts `playerTurnEnded`）：在 `syncEquipmentStatuses()`
之后、`calculateStealthRange()` 之前插入 `this.updateVision()`——回合结算
收口是全部已提交动作的必经点，且 updateVision 全程零 RNG 消费（§五），
**不移动任何随机流**。修复后 p4_9 8/8 绿、c_7 25/25 绿；串行全量终验
**80/80 文件全绿**（§九.1）。

修复的对抗性证明见 §八反向验证⑤：把这一行删掉，p4_9 T1/T5 立即翻红。

## 七、反向哨兵与既有测试

- **改了哪些既有测试断言：无。** C-7 全程（含本续轮）未修改任何既有测试
  文件；p4_9 的翻红是生产缺陷所致，修生产、不动测试。
- S-1 改造的 8 组哨兵（f_2a 对抗⑪ / f_2b 对抗⑦ / f_2c 对抗⑪⑩ /
  g_1 对抗⑧ / g_2 对抗⑤ / g_3 对抗⑨ / c_5 对抗⑧③ / b_1a A13）+ c_0 A4：
  **全部保持绿**——C-7 零 RNG 消费（grep 在案：LightMap.ts/LightCatalog.ts
  无 `rng`/`Math.random`），RNG 流未动，改造后的"流位移免疫"无需兑现。
- `generation_baseline`：**绿**（未刷新 fixture）。坏层闸门 p1_26 / p1_29 /
  p1_33：**绿**（坏层集 0）。
- i18n 门禁（p1_30）：本轮零新增 `t()` 调用，绿。

## 八、对抗性测试与反向验证（5 条，全部真实改坏 → 贴输出 → 还原）

新增测试 25 条按"对抗性"设计（期望值由 CE C 代码独立手工推导，与被测实现
零共享代码）。收尾轮逐面注入破坏并确认翻红，随后全部还原
（`git diff 74809f6` 复核仅剩预期改动；`grep -rn "REVERT-ME\|BREAK-\|DIAGNOSTIC" src/` = 0）：

**① 数据面**：矿灯条目 `passThroughCreatures` 改 false：
```
× 对抗③：矿灯条目 passThroughCreatures = true（Globals.c:958 原列；写成 false 即红）
AssertionError: expected false to be true // Object.is equality
```

**② 公式面**：深度衰减系数 85 → 95（单常数腐坏，6 条级联翻红）：
```
× 深度衰减方向与精确值：随深度单调收缩（写反/改公式即红）
AssertionError: depth 1 半径: expected 6209 to be 5579 // Object.is equality
× 光明戒指倍率分支（Light.c:125-131）：… AssertionError: expected { radiusHundredths: 18629, … } to deeply equal { radiusHundredths: 16739, … }
× 黑暗状态立方衰减 + 1/20 下限 + 2*FP 退化托底（…）AssertionError: expected { radiusHundredths: 310, … } to deeply equal { radiusHundredths: 278, … }
× 水中减半（…） / × 对抗⑤消费面：深层岩浆自发光 / × 对抗④集成面：矿灯深度衰减在视野上可观测
```
（d=0 锚不受影响——d=0 无衰减轮次，断言定位精度符合设计。）

**③ 行为面**：paintLight 忽略径向衰减（lightMultiplier 恒 100）：
```
× 对抗①：径向衰减方向——中心最亮、随距离单调变暗（写反即红）
AssertionError: expected 180 to be greater than 180
```

**④ 消费面**：LAVA 的 glowLight 列清零：
```
× 全 tile 的 glowLight 逐值等于 CE 原列（结构性穷尽）
AssertionError: TerrainType.9 glowLight 不符: expected +0 to be 34 // Object.is equality
× 非零恰 7 个，且都指向有载体的目录条目
AssertionError: expected [ 22, 31, 32, 35, 37, 40 ] to deeply equal [ 9, 22, 31, 32, 35, 37, 40 ]
× 对抗⑤消费面：深层岩浆自发光——glowLight 列没接上/不被消费即红  ×2
AssertionError: expected 0 to be greater than 50
```

**⑤ 接线修复本体**（§六）：删掉 playerTurnEnded 的每回合 updateVision：
```
× T1 死胡同：贪心实现钻进死胡同口（陷阱实证），safety map 实现沿正确路线南下
× T5 察觉不到玩家的逃跑者用私有快照（Monsters.c:2380-2400 双路径），察觉后释放
Tests  2 failed | 6 passed (8)
```

**留痕测试的防绕过形态**：载体边界留痕（除 9 个载体名外任何 LightKind 名
不得出现在生产代码）剥注释与字符串后按 `\b` 词边界扫描，同时覆盖点号读取、
解构与裸名三种形态（S-1 时代教训的第 1 条规矩）；并写明反转方式与反转轮次
（落 tile 的地形轮 / 渲染轮）。

## 九、门禁结果与构建输出

### 9.1 串行全量（`npx vitest run --fileParallelism=false`，修复后终验）

首轮（修复前）：`Test Files 1 failed | 79 passed (80)`，`Tests 2 failed | 973 passed | 8 skipped | 5 todo (988)`
——2 红即 §六的 p4_9 T1/T5，定性为 C-7 真阳性（非 B-2 抢 CPU 假红：单跑复现）。

修复后终验（最终交付状态）：

```
（此处由收尾轮最终跑填充——见文末附录 A）
```

### 9.2 `npm run build`

```
（见附录 B）
```

### 9.3 `git diff --stat`

```
（见附录 C）
```

## 十、与预设不符之处（只列不修之外的部分已修，均如实申报）

1. **原任务书 `ai_docs/c-7.prompt.md` 全仓不存在**（`ai_docs/` 根目录与
   `ai_docs/tasks/` 41 个 prompt 里都没有 c-7；各轮报告目录亦无 c-7 报告）。
   本轮按续轮提示词对 §四/§六/§八 的转述 + 工作区产物 + CE 源码重建上下文，
   无法对原任务书逐字核对。若原文与本报告的理解有出入，以原文为准再核。
2. **续轮提示词描述的"未提交工作区"已不成立**：上一轮产物已被验收方以
   `74809f6 wip(C-7)` 提交保全，本轮起点是该提交（工作区 clean）。
3. **上一轮实现的缺陷一处**（§六）：潜行接线读陈旧光照，p4_9 T1/T5 真阳性
   翻红——已修（playerTurnEnded 每回合 updateVision），并用反向验证⑤证明
   修复承重。
4. **上一轮注释两处事实错误**（本续轮修正，均为注释、不影响行为）：
   - LightCatalog.ts 头注释称光照抖动属"CE 的 assureCosmeticRNG 域"——
     错。CE `Light.c:65` 明确 `brogueAssert(rogue.RNG == RNG_SUBSTANTIVE)`，
     光照数值抽取走 substantive 主流。"不抽随机数"的结论不变、理由更硬；
     "渲染轮用 cosmetic RNG 接闪烁"改为如实标注为 web 侧设计选择。
   - Game.ts 矿灯调用点行号 `Light.c:262-263` → 实际 `:268-269`，已改。
   - 另有少量行号引用存在 ±1 漂移（如 RogueMain.c:666-670 实为 :665-668 起），
     语义逐字核过无误，未逐一改动，此处备案。
5. **验收方快照中的 TS6133**（'FP_FACTOR' declared but never read）：以
   "补 d=0 锚断言"方式用上该常量（比删除多了对 fixpt 标度本身的钉死）。
6. c_6 §十四.4 预警"接光照后 RNG 流再移、基线哨兵再红"——实际未发生：
   C-7 零 RNG 消费，generation_baseline 与全部哨兵保持绿，基线无需重锚。

## 十一、C 链收口总结

C 链（phase C：CE 生成器与地形体系对齐）至此各轮：

- **C-0~C-3**：生成骨架、房间剖面、湖系、墙门完成（各自报告）。
- **C-4a/0~C-4c**：地形目录与层模型重建，tileCatalog 各列逐轮补齐。
- **C-5 / C-6**：下坠子系统、自动生成器落地。
- **C-7（本轮）**：**tileCatalog 的最后一根数据列 `glowLight` 补齐**
  （web 侧 43 tile 全穷尽），CE `lightCatalog` 60 条全量投影（机械比对
  60/60 一致），矿灯深度衰减全公式（含戒指/黑暗/水中三分支留形），
  引擎侧光照管线（paintLight/updateLighting 语义、VISIBLE 阈值口径、
  潜行双减半接线），渲染层零改动。

**C-7 之后仍然欠的账**（留给对应轮次，均有留痕测试指路）：
1. 四个发光 tile（TORCH_WALL/SUNLIGHT_POOL/DARKNESS_PATCH/LUMINESCENT_FUNGUS）
   落地时接光 + 反转载体留痕（c_6 §十四.1 清单，autoGenerator carrier
   翻 'wired' 的前置）；
2. 渲染轮：flare 族、颜色抖动闪烁（cosmetic RNG 自接）、colorDances；
3. 光明戒指 / 黑暗药水落地时给 `updateMinersLightRadius` 接真参数
   （公式与测试已就位，改传参即可）；
4. TELEPATHY_LIGHT 双通道口径差（§4.2.3）——若心灵感应改走光照通道，
   属机制翻正，需过方案评审（D3 同级）。

---

## 附录 A：终验串行全量输出尾部

最终交付状态（含 §六修复与 §九.4 注释勘误）的
`npx vitest run --fileParallelism=false`（2026-09-17 20:21 起，串行 18 分钟）：

```
 RUN  v4.1.11 /…/wt-c-7/brogue-web

 Test Files  80 passed (80)
      Tests  975 passed | 8 skipped | 5 todo (988)
   Start at  20:21:02
   Duration  1092.46s (transform 696ms, setup 0ms, import 9.50s, tests 1076.85s, environment 12ms)
```

（首轮——仅差 §六修复——为 `1 failed | 79 passed (80)` /
`2 failed | 973 passed | 8 skipped | 5 todo (988)`，2 红即 p4_9 T1/T5。）

## 附录 B：`npm run build` 输出尾部

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

dist/assets/WebGLRenderer-CzmnTseH.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-UCjmL8ha.js               851.85 kB │ gzip: 257.49 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.42s
```

（TS6133 已清；chunk 体积提示为既有常态告警，非错误。）

## 附录 C：`git diff --stat`

C-7 全轮（对起点 `982f9b2`）：

```
 brogue-web/src/engine/Core/Game.ts          | 216 +++++++++-
 brogue-web/src/engine/Lighting/LightMap.ts  | 310 ++++++++++++++
 brogue-web/src/engine/Map/LightCatalog.ts   | 399 ++++++++++++++++++
 brogue-web/src/engine/Map/TerrainCatalog.ts |  62 ++-
 brogue-web/src/test/c_7_lighting.test.ts    | 613 ++++++++++++++++++++++++++++
 5 files changed, 1560 insertions(+), 40 deletions(-)
```

本续轮净增（对验收方快照 `74809f6`）：

```
 brogue-web/src/engine/Core/Game.ts        | 10 +++++++++-
 brogue-web/src/engine/Map/LightCatalog.ts | 11 ++++++-----
 brogue-web/src/test/c_7_lighting.test.ts  |  3 +++
 3 files changed, 18 insertions(+), 6 deletions(-)
```

（`src/components/` 零改动；未执行任何 git 写操作，改动全部留在工作区。）
