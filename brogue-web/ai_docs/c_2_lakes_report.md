# C-2 轮次报告：湖泊四类液体 + 浅水镶边 + 边界打通 + 建桥

日期：2026-09-15　分支：`round/c-2`（独立 worktree）
改动文件：`src/engine/Generator/Architect.ts`、`src/engine/Map/Grid.ts`（仅新增枚举值）、
`src/engine/Map/LakeSystem.ts`（新增，502 行）、
`src/test/c_2_lakes.test.ts`（新增，单元契约 + 构造性对抗）、
`src/test/c_2_lakes_e2e.test.ts`（新增，真实关卡扫描 + 留痕 + 统计）、
`src/test/c_2_lakes_determinism.test.ts`（新增，决定性）

---

## 〇、与预设不符之处（只列不修）

### 0.1 任务书事实核对结果：全部成立，但有一处**必然后果任务书未言明**

- `liquidType`（Architect.c:2518-2550）、`fillLake`（2554-2570）、`createWreath`
  （2692-2707）、`fillLakes`（2709-2730）、`cleanUpLakeBoundaries`（1856-1912）、
  `buildABridge`（2786-2876）、`digDungeon`（2926-2966）行号**逐一核实无误**。
- **★ 必然后果**：CE 的 `T_CAN_BE_BRIDGED = T_AUTO_DESCENT`（Rogue.h:1953）——
  **CE 的桥只架在深渊上，深水不可架桥**。按风险裁决 1 本轮不生成 CHASM
  （见 §一），因此**真实生成中 BRIDGE/BRIDGE_EDGE 恒 0、`buildABridge` 每层
  空转**（RNG 消耗与 CE 一致：比值 2 抽 + 列/行两张洗牌）。buildABridge 按
  CE 忠实实现并以构造场景测试钉死判据（C-5 解除 CHASM 禁令后桥梁自动
  开始出现）。这不是"没做完"，是裁决 1 的逻辑结论，请验收方知悉。
- 任务书引文的 `gameConst` 三个常量留空要求自查——已查（见 §二）。
- CE 的 **DOOR 没有 T_OBSTRUCTS_PASSABILITY**（Globals.c:328，CE 的门可通行），
  因此 cleanUpLakeBoundaries 的主体判据天然不会溶解门格——任务书未提，
  已按 CE 原样实现并有单元用例钉住。

### 0.2 本轮开发中发生的一个"假绿"陷阱（方法论记录）

`TerrainType` 枚举成员是 `WATER_DEEP`；实现早期误写为 `TerrainType.DEEP_WATER`
（不存在），**运行时求值为 undefined 而非编译错**——第一轮测试出现一连串
怪异失败（D10 "出现硫矿"、深水镶边 [27,2] 等），且临时的 vue-tsc 调用方式
没有真正跑起来、给了假绿。教训两条：**(a)** 跨文件枚举引用用机械扫描核对
（本轮用一次性 node 脚本扫了全仓 `TerrainType.*` 引用，含测试）；**(b)** 类型
门禁以 `npm run build`（vue-tsc）为准，不用临时 tsc 命令。

### 0.3 测试环境：全局 120s testTimeout 在满载下会误伤既有重测试

第一轮全量 `npm test`（23:42，机器 5 分钟负载均值 16.5/10 核）出现 6 个
失败文件，**全部是 `Test timed out`**——包括 p1_29、invented_content_pool
等既有测试；负载回落后的同一代码全量复跑（23:54）**只剩 generation_baseline
一个预期内红、0 超时**（本轮所有新增重用例已显式声明 300s 超时）。据此把
一轮超时潮如实归因为环境噪声而非代码回归。另：本轮曾写过一个端到端
坏层闸门测试，与 p1_33 的 15 种子 × D1-D26 扫描**同驱动、同判据、决定性
相同**，是纯冗余 CPU 且加剧了上述超时挤压——已删除，坏层复验以 p1_33
（15 种子）+ p1_26（5 种子）在套件内保持绿为准 + 本轮自测捕获的实测数据
（§五.4）。

### 0.4 任务书"全部行为断言打在真实生成的关卡上"的执行口径

cleanUpLakeBoundaries 与 buildABridge 的**判别性微结构**（异类湖恰好隔 1 格
墙相邻、深渊带的走向与绕行距离）在真实关卡上不可控、也不可在固定种子集
上稳定复现，判据测试只能在构造网格上钉死；这些构造场景的**布局参数**
（如桥梁场景的比值阈值 211%~322%）全部按 CE 公式现算并在用例注释里写明
推导。真实关卡上的行为断言（液体分布、深度门槛、黑曜石镶边、连通性
合同、清理幂等、留痕）全部在 `c_2_lakes_e2e.test.ts` 的 15 种子 × D1-D26
扫描上。两文件分工已在其头部注释声明。

---

## 一、三个风险点的裁决

### 裁决 1：CHASM（深渊）——**不生成**，取值域收窄 + 留痕

- CE 事实：CHASM 带 `T_AUTO_DESCENT`（Globals.c:416），踩上坠到下一层；
  `T_CAN_BE_BRIDGED = T_AUTO_DESCENT`（Rogue.h:1953）。
- web 事实：**坠落子系统不存在**（P1-22/C-5）；而"让 CHASM 暂等价于不可
  通行"必须改 `Game.canMoveTo`（本轮禁改文件）；`Connectivity.ts` 的
  `terrainAllowsMove` 既有语义禁改、且它与 canMoveTo 的全枚举一致性被
  p1_29 既有测试钉死（CHASM 在 canMoveTo 里**可走**——生成深渊即"踩上去
  无声无息"，正是任务书明令禁止的形态）。
- 实现：`liquidType` 保持 CE 结构（randMin/randMax/最深层覆盖），把候选域
  中的 2（CHASM）显式剔除、在剩余候选上均匀抽一个。分布：D1-3 恒深水、
  D4-16 岩浆/深水各半、D17-39 三者均分、D40 强制深水。CE 的 case 2 分支
  原样保留作对照，C-5 落地后把 2 加回即可。
- 留痕：`c_2_lakes_e2e`「深渊族地形恒 0」+ 单元「liquidType 全深度域永不
  产生 CHASM/CHASM_EDGE」，失败消息写明解除条件（C-5）。

### 裁决 2：LAVA（岩浆）——**生成**

- 即死通道已在 P1-28 落地（`applyEnvironmentalEffects`，豁免 = 悬浮 /
  火焰免疫 / MONST_INVULNERABLE，对齐 CE Time.c:183-190）。
- **"不可达"与"走过去就死"要分开**：canMoveTo 不排除岩浆（P1-25）→ 岩浆格
  按连通性口径是干地，岩浆湖**不可能制造不可达**；闸门在验证时把整湖当
  阻断物（P1-29 语义），干地（含楼梯落点）必有完全不穿湖的路径。
  "走过去就死"是玩家主动踏入湖体的后果——CE 同样如此（T_LAVA_INSTA_DEATH
  只进 T_PATHING_BLOCKER，挡 AI 寻路、不挡玩家直接走进岩浆）。
- 实测：D4+ 岩浆 2224 格 / 120 层有岩浆，端到端坏层仍为 0（§五.4）。
- 既有语义外的已知缺口（边界外只列不修）：CE 怪物寻路避开岩浆
  （T_PATHING_BLOCKER），web 怪物寻路若不含此偏好，岩浆湖可能成为怪物
  死地——属 P1-25 既定口径的下游效应，非本轮引入。

### 裁决 3：INERT_BRIMSTONE（惰性硫矿）——**生成 + 显式登记点火链缺失**

- CE 事实：INERT_BRIMSTONE 只有 `T_SPONTANEOUSLY_IGNITES`（Globals.c:426，
  TM 列为 0）——**踩上去无即时后果**；该旗标只进 T_LAKE/T_PATHING_BLOCKER
  （影响 AI 寻路偏好与可燃性，不挡玩家直接移动）。生成"惰性态"本身忠于
  CE。
- 缺失部分：点火 → ACTIVE_BRIMSTONE → 爆炸 → 黑曜石的 DF 链，属 C-4
  （promoteTile/DF 系统）范围。web 的火系统碰不到它 = 永远惰性。
- 实测：D17+ 硫矿 871 格 / 47 层，黑曜石镶边 705 格，每格都在某硫矿的
  圆盘半径 2 内（AD-B3 逐格校验）。

---

## 二、CE 行号对照与 gameConst 实际数值

### gameConst（经典 Brogue = `brogueGameConst`，variants/GlobalsBrogue.c:1005-1075；
游戏经 `initializeGameVariantBrogue()` 选择该变体）

| 常量 | 数值 | 出处 |
|---|---|---|
| `minimumLavaLevel` | **4** | GlobalsBrogue.c:1021 |
| `minimumBrimstoneLevel` | **17** | GlobalsBrogue.c:1022 |
| `deepestLevel` | **40**（= `DEEPEST_LEVEL`） | GlobalsBrogue.c:1016 + 43-44 |
| `depthAccelerator` | **1**（建桥比值用） | GlobalsBrogue.c:1019 |

（P1-7 教训执行：常量全部展开成数值再比对/再写测试。RapidBrogue=2/5、
BulletBrogue=2/? 的变体值**不采用**。注意 web 的 LoopMap.DEEPEST_LEVEL=26
实为 CE 的 amuletLevel；CE 的 deepestLevel=40 在 web 的 D1-26 域内永不触发，
但 liquidType(40) 仍按 CE 实现，由单元用例直接驱动验证。）

### 实现对照（web = `src/engine/Map/LakeSystem.ts`）

| CE | 行号 | web |
|---|---|---|
| `liquidType` | 2518-2550 | `liquidType(depth)`（候选域剔除 2，见裁决 1） |
| `fillLake` | 2554-2570 | `fillLake`（显式栈复刻 ±4 递归闭包，结果集等价） |
| `createWreath` | 2692-2707 | `createWreath`（欧氏圆盘；只盖 FLOOR/DOOR，见 §四） |
| `fillLakes` | 2709-2730 | `fillLakes`（raster 序逐组件抽液体） |
| `lakeDisruptsPassability` 调用 | 2659-2663 | P1-29 闸门原样复用（20 次尝试、耗尽跳过） |
| `designLakes` 的 lakeMap 累积 | 2674-2681 | `placeGatedLakeBlob` 增可选 `lakeMap` 参数（成功记入 lakeMap 而非直接落地；已有测试的 3 参调用行为逐字不变） |
| `cleanUpLakeBoundaries` | 1856-1912 | `cleanUpLakeBoundaries`（旗标位映射 + 交替方向扫 + failsafe 100） |
| `buildABridge` | 2786-2876 | `buildABridge`（含比值 C 整数算术、foundExposure、k-i>3、pathingDistance 比值） |
| `pathingDistance` | Dijkstra.c:252 + calculateDistances:198-231 | 8 向均匀代价 BFS（代价全 1 时与 CE 的 pdsMap 等价），PDS_FORBIDDEN=-1 |
| `digDungeon` 湖泊后管线 | 2926-2966 | `designEnvironmentOvelays` 末尾：fillLakes → cleanUp → while(buildABridge) |

---

## 三、管线与数据流

```
generateTerrain（P1-29 合同范围，返回时干地全连通）
├─ carveDungeon → 落位 → addLoops（C-0/C-1，未动）
├─ designEnvironmentOvelays
│   ├─ 浅水/草/树/泥/网叠加（web 自创对应物，跳过 lakeMap 格——
│   │   与"深水先落地、后续叠加只盖 FLOOR"的旧行为逐格等价）
│   ├─ 深水 blob → P1-29 闸门（20 次尝试/耗尽跳过，闸门验证把
│   │   lakeMap 已收录格一并视作阻断 = CE lakeFloodFill 的 !lakeMap[..]）
│   │   → 成功记入 lakeMap（不再直接落地）
│   ├─ fillLakes：逐连通组件 liquidType → fillLake(±4 合并) → createWreath
│   ├─ cleanUpLakeBoundaries（同类湖 1 格边界打通；web 可走性守卫）
│   └─ while (buildABridge())（本轮 CHASM 不生成 → 恒空转、RNG 照消耗）
└─（机器/陷阱/楼梯在 Game.generateLevel，本轮未动）
```

与 CE digDungeon 的顺序差异（登记）：CE 的清理与架桥在 addMachines 之后；
web 的机器阶段在 Game.generateLevel 里位于 generateTerrain 之后（Game.ts
本轮禁改，无法交错）。影响面：清理/架桥阶段 web 恒无机器格
（machineNumber 恒 0，CE 的 IMPREGNABLE 豁免在 web 侧为空洞但已实现）。

---

## 四、与 CE 的结构性差异（web 单层地形模型，均已实现并在测试钉住）

1. **createWreath 不把浅水画上墙**。CE 的 wreath 只检查 LIQUID 层
   ==NOTHING，会把浅水画在**墙格**的 LIQUID 层上——但玩法旗标仍来自
   DUNGEON 层的墙（cellHasTerrainFlag 三层 OR），纯渲染无玩法效果。web
   一格一 terrain，照搬会把墙变成可走地形、直接击穿 P1-29 连通性合同，
   故只盖 FLOOR/DOOR（门被浅水覆盖时门消失 = CE 2703-2705 的对应物）。
   单元用例「镶边只落在 FLOOR/DOOR 上」钉住。
2. **cleanUpLakeBoundaries 增加"不可降低可走性"守卫**。CE 四种液体全是
   pathing blocker，清理永不改变可走拓扑；web 的岩浆/硫矿可走而深水不可
   走，[深水][岩浆][深水] 若照 CE 复刻会删掉一个可走格。守卫 = 主体可走
   ∧ 目标不可走时跳过。反向验证 RV4：去守卫 → 守卫用例红；**如实记录：
   390 层真实关卡扫描对守卫不敏感**（该模式在样本内未造成破坏），守卫的
   依据是 CE 语义对齐 + 单元用例，不是真实关卡观察。
3. **桥的两端桩点（BRIDGE_EDGE）落在 terrain 上**（CE 落在 SURFACE 层，
   DUNGEON 层保持原地形）；门作为落点被覆盖时门消失——CE 会保留门。
   生成期桥数恒 0，此差异暂不可观察，登记备查。

---

## 五、实测数据（15 种子 × D1-D26 = 390 层，种子集同 P1-26/29/33：
424242, 777, 20260913, 31337, 20260916, 1, 42, 999, 20260915, 55555, 2, 3, 5, 7, 11）

### 5.1 四类液体随深度的分布（湖泊阶段扫描，最终代码实跑）

```
[c_2] 湖泊阶段扫描：390 层，闸门 placed=369 skipped=7
[c_2] 液体分布：
D1-3:   层数=45  深水=494(均值11.0) 浅水=3125  岩浆=0    硫矿=0   黑曜石=0   有岩浆层数=0   有硫矿层数=0
D4-9:   层数=90  深水=670(均值7.4)  浅水=5293  岩浆=610  硫矿=0   黑曜石=0   有岩浆层数=35  有硫矿层数=0
D10-16: 层数=105 深水=615(均值5.9)  浅水=5870  岩浆=1067 硫矿=0   黑曜石=0   有岩浆层数=52  有硫矿层数=0
D17-26: 层数=150 深水=836(均值5.6)  浅水=10108 岩浆=547  硫矿=871 黑曜石=705 有岩浆层数=33  有硫矿层数=47
```

深度门槛严格成立：岩浆只在 D≥4，硫矿/黑曜石只在 D≥17；D1-3 恒深水
（候选域 {1}）。

### 5.2 镶边格数

浅水镶边与 web 既有浅水叠加 blob 在网格上不可区分（同地形），总量
24396 格（含叠加层）；**黑曜石是硫矿镶边的独有标记**：705 格，全部在
某硫矿的切比雪夫 2 格内（AD-B3 逐格校验，欧氏圆盘半径 2 按 CE 2702-2704）。

### 5.3 桥数与深渊族

```
[c_2] 留痕：390 层深渊族地形总数 = 0（CHASM 不生成 → 桥无料可架，buildABridge 每层空转）
端到端复验：390 层，深渊=0 桥=0
```

`buildABridge` 的判据全部由构造场景测试覆盖（§六 AD-A5 系列）——架桥
功能性、深水不可架、比值否决、全程贴墙否决、全高深渊（pathingDistance
=-1）不架、决定性。

### 5.4 坏层 = 0 复验（本轮最重要的回归闸门）

- **p1_33_machine_chokepoint**（15 种子 × D1-D26 端到端）：绿。
- **p1_26_invariants**（5 种子 × D1-D26，含坏层严格 0、可走占比、楼梯
  存在性、决定性）：绿。
- **p1_29_lake_connectivity**（15 种子湖泊阶段全连通 + 10 种子端到端 +
  闸门 AD2/AD3）：绿——P1-29 的合同在 C-2 新管线（液体/镶边/清理/桥）
  下原样成立。
- 本轮自测捕获（写测试时的运行输出，与上同代码）：
  `端到端复验：390 层，坏层=无`。该测试与 p1_33 同驱动同判据，因纯冗余
  CPU 已从套件移除（§〇.3），数据保留在此。

### 5.5 湖泊阶段合同 + 清理幂等（真实关卡）

390 层干地全部单连通块（terrainAllowsMove 口径、8 向）；每层
`cleanUpLakeBoundaries` 饱和后重跑零改动。

### 5.6 留痕（C-3）

```
[c_2] 留痕（C-3）：斜向豁口总数 = 36，分布层数 = 34/390
```

removeDiagonalOpenings 未做（C-3），斜向豁口在真实关卡持续存在；断言
>0 并写明翻转条件。

---

## 六、对抗性测试 ↔ 错误实现映射（≥5 条）

单元契约 + 构造场景：`src/test/c_2_lakes.test.ts`（17 用例）；
真实关卡：`src/test/c_2_lakes_e2e.test.ts`（6 用例）。

| # | 错误实现 | 捕获者 | 实测 |
|---|---|---|---|
| AD-A1 | **深度门槛写反**（浅层放岩浆/硫矿、深层禁硫矿） | 单元 AD-A1 + 真实关卡 AD-B1 | RV1（复做）：单元红「D1-3 应恒深水…expected false to be true」；e2e 红「D1-3 出现岩浆格：expected 121 to be +0」 |
| AD-A2 | **最深层未强制深水**（删 CE 2526-2528 覆盖） | 单元「最深层特例」：liquidType(40) × 400 抽（种子 904）全必须深水；缺失分支时 D40 候选 {0,1,3} 必然出非水 | 绿（该用例为确定性种子化抽样，同族错误已由 RV1 实证捕获路径） |
| AD-A3 | **镶边按液体取错**（岩浆不该有镶边） | 单元「液体→镶边契约」全深度域契约 + 真实关卡 AD-B3（黑曜石只随硫矿） | RV2：红「D4 岩浆不得有镶边（CE case 0：NOTHING/0）；得到 WATER_SHALLOW×2: expected [6,2] to deeply equal [0,0]」 |
| AD-A4 | **cleanUpLakeBoundaries 把不同类的湖打通**（去掉旗标相等判据） | 单元「异类湖不通融」（[深水][墙][岩浆] 布景） | RV3：红「同类（深水\|深水）之间的夹墙应被打通成深水: expected 9 to be 7」——类型无视使异类串色污染了同类墙 |
| AD-A5 | **桥架错地方 / 架完连通性变差** | 单元 AD-A5a-d：a) 值得架的深渊带必须架桥且两岸寻路距离变短（pathingDistance 口径）；b) 深水带不可架桥（T_CAN_BE_BRIDGED=深渊独占）；c) 绕行不够（比值 200% < 阈值 211%~322%）不架；d) 全程贴墙（无开敞段）不架；e) 全高深渊 pathingDistance=-1 不架不崩 | 全绿；错误实现（架深水/无视比值/无视 exposure/无视 -1）分别被对应用例直接判红 |
| 守卫 | **清理删除可走格**（[深水][岩浆][深水] 照 CE 转换） | 单元「web 守卫」 | RV4：红「守卫必须跳过: expected 7 to be 9」（岩浆被改成深水） |
| 留痕 | ——（显式登记"明确不做"） | 「深渊族恒 0」（解除条件 C-5）、「C-3 斜向豁口仍存在」（390 层 36 处，C-3 落地后翻转 0） | 绿（留痕态） |

其余钉子：createWreath 只盖 FLOOR/DOOR 不碰墙；scanWidth=4 合并（≤4 切比
雪夫距离的第二湖并组件）；门不是清理边界（CE DOOR 无 OBSTRUCTS）；清理
幂等（构造 + 真实关卡双轨）；湖泊阶段合同（真实关卡 390 层全连通）；
决定性（同种子两次生成指纹 + 四类液体计数逐一一致，3 种子）。

---

## 七、反向验证（4 条，真实改坏 → 跑红 → 还原；`grep "临时改坏"` 无残留）

> 注：RV1 首次捕获时测试文件自身尚有 §〇.2 的枚举名笔误，为排除污染，
> 修复后在干净基线上**复做**了一次，以下 RV1 输出为复做所得；
> RV2/RV3/RV4 的输出与该笔误无关（各自断言不涉及该枚举成员）。

**RV1：liquidType 深度门槛写反**（randMin/randMax 的两个三目各反转）——

```
FAIL … 对抗 AD-A1：深度门槛——D1-3 无岩浆/硫矿（恒深水），D4-16 无硫矿，D17-39 三类齐现
AssertionError: D1-3 应恒深水；出现别的液体 = 深度门槛写反或 CHASM 禁令失守:
expected false to be true

FAIL … 对抗 AD-B1：深度门槛实测——D1-3 无岩浆/硫矿/黑曜石；…（真实关卡 390 层）
AssertionError: D1-3 出现岩浆格（minimumLavaLevel=4 被写反或漏判）: expected 121 to be +0
```

**RV2：岩浆错误镶浅水边**（case 0 返回 WATER_SHALLOW×2）——

```
FAIL … 对抗 AD-A3：液体→镶边契约——岩浆不镶边、深水镶浅水×2、硫矿镶黑曜石×2
AssertionError: D4 岩浆不得有镶边（CE case 0：NOTHING/0）；得到 WATER_SHALLOW×2:
expected [ 6, 2 ] to deeply equal [ +0, +0 ]
```

**RV3：清理去掉旗标相等判据**（两侧只要都是湖阻断物就打通）——

```
FAIL … 对抗 AD-A4：[深水][墙][岩浆] 异类湖之间的墙不得被打通；[深水][墙][深水] 则打通
AssertionError: 同类（深水|深水）之间的夹墙应被打通成深水: expected 9 to be 7
```

**RV4：清理去掉可走性守卫**——

```
FAIL … web 守卫：[深水][岩浆][深水] 的岩浆不得被改成深水（可走格不可删，登记的模型差异）
AssertionError: CE 会把该岩浆改成深水（两层模型下不改变可走性）；web 单层模型下这会
删掉一个可走格、可能切断干地——守卫必须跳过: expected 7 to be 9
```

附带观察（如实记录）：RV4 状态下 390 层真实关卡合同测试**仍绿**——见 §四.2。

每次 RV 后逐字还原，最终 `grep -rn "临时改坏" src/` 零命中，两文件复跑
全绿（17 + 7 用例）。

---

## 八、门禁输出尾部

### 红项声明（分开写）

`npm test`（最终轮，23:54，机器负载平稳后）：58 文件，**57 全绿，
1 失败**——

1. `src/test/generation_baseline.test.ts`：**预期内红，唯一红项**。
   本轮在湖泊管线新增 RNG 消耗（每组件一次 liquidType 抽签 + 每层
   buildABridge 的比值 2 抽与列/行两张洗牌 + D1-3 候选域单元素时
   randRange 短路不消耗——CE 对应调用恒消耗，又一处流移动源），同种子
   地图与全部下游发放（怪物/物品）按设计改变。397 处偏离（fp/n/species/
   items 全类目），样例：`seed424242 D1 fp: 基线=6e2946a0:4731 现在=b6aec106:4731`。
   **按任务书未刷新 fixture**，由验收方授权重捕获。
2. **无其它红项**。p1_26 / p1_29 / p1_33 / invented_content_pool /
   blueprint_center / horde_terrain_spawn 等既有闸门全部绿。
3. 附注（§〇.3）：23:42 的一轮曾出现 6 文件超时（含既有测试），机器
   5 分钟负载均值 16.5/10 核；同一代码负载平稳后复跑 0 超时。本轮新增
   重用例均已显式声明 300s 超时，不再依赖全局 120s。

### npm test 尾部（最终轮）

```
 Test Files  1 failed | 57 passed (58)
      Tests  1 failed | 587 passed | 8 skipped | 5 todo (601)
   Start at  23:54:42
   Duration  246.84s (transform 2.15s, setup 0ms, import 16.71s, tests 1495.89s, environment 26ms)
```

新增 24 用例（c_2_lakes 17 + c_2_lakes_e2e 6 + c_2_lakes_determinism 1）
全绿。

### npm run build 尾部（绿，vue-tsc 通过）

```
dist/assets/CanvasRenderer-ZRtZ0Uf4.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-CZR81Qjh.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-DCndgb1_.js           41.30 kB │ gzip:  10.82 kB
dist/assets/RenderTargetSystem-BaByLGU8.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-CVxrRnhh.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-Bn150Aev.js               760.11 kB │ gzip: 231.65 kB
(!) Some chunks are larger than 500 kB after minification. …
✓ built in 1.52s
```

（chunk 体积警告为既有现象。）

### git diff --stat（已跟踪文件）

```
 brogue-web/src/engine/Generator/Architect.ts | 69 ++++++++++++++++++++++++----
 brogue-web/src/engine/Map/Grid.ts            |  9 +++-
 2 files changed, 69 insertions(+), 9 deletions(-)
```

未跟踪新增：`src/engine/Map/LakeSystem.ts`（502 行）、
`src/test/c_2_lakes.test.ts`（365）、`src/test/c_2_lakes_e2e.test.ts`（265）、
`src/test/c_2_lakes_determinism.test.ts`（47）。

```
 M src/engine/Generator/Architect.ts
 M src/engine/Map/Grid.ts
?? src/engine/Map/LakeSystem.ts
?? src/test/c_2_lakes.test.ts
?? src/test/c_2_lakes_determinism.test.ts
?? src/test/c_2_lakes_e2e.test.ts
```

无任何 git 写操作；调试探针（zz_probe.test.ts）已删除，无仓库内临时文件；
改动全部留在工作区。

---

## 九、验收条款逐条对照

| 任务书要求 | 状态 |
|---|---|
| 1. liquidType 四类液体（深度门槛 + 最深层特例），按三个风险点裁决实现 | ✅ CE 结构 + 候选域剔除 CHASM（裁决 1）；LAVA/BRIMSTONE 生成（裁决 2/3）；gameConst 实际值 4/17/40 已展开（§二） |
| 2. createWreath 浅水镶边（宽度按液体种类） | ✅ 水×2 / 岩浆 0 / 硫矿黑曜石×2（渊缘×1 分支保留但不可达）；欧氏圆盘照 CE；只盖 FLOOR/DOOR（§四.1） |
| 3. cleanUpLakeBoundaries | ✅ CE 1856-1912 逐条移植（旗标相等判据、TM_IS_SECRET 豁免、IMPREGNABLE→machineNumber、交替扫、failsafe 100）+ web 可走性守卫（§四.2） |
| 4. buildABridge | ✅ CE 2786-2876 逐条移植（比值、exposure、k-i>3、落点判据、pathingDistance、机器格豁免、while 循环）；真实生成恒 0 桥 = 裁决 1 必然后果（§〇.1），判据由 6 个构造场景钉死 |
| 明确不做 + 显式留痕测试 | ✅ 深渊族恒 0（C-5 解除条件写明）；C-3 斜向豁口留痕（36/34 层，翻转条件写明）；runAutogenerators（C-6）与坠落本身的无实现由上述留痕与报告承载——CE 的 finishDoors/finishWalls 无 web 侧可观察签名可作断言，见 §十 说明 |
| 对抗性测试 ≥5 条（指定五类） | ✅ AD-A1+A2（门槛/最深层）、AD-A3（镶边）、AD-A4（异类湖）、AD-A5a-e（桥）、AD-B1/B3（真实关卡）；每条对应具体错误实现（§六） |
| 反向验证 ≥2 条真实失败输出 | ✅ 4 条（RV1-RV4），真实输出见 §七，已还原无残留 |
| 决定性测试 | ✅ 同种子两次生成指纹 + 四类液体计数逐一一致（3 种子 × D1-26 × 2 遍） |
| 连通性不得退化（最重要闸门） | ✅ p1_33（15 种子）/p1_26/p1_29 坏层断言全部保持绿（§5.4）；未改它们的常量 |
| 实测汇报（分布/镶边/桥数/坏层 0） | ✅ §五（390 层，placed=369 skipped=7） |
| 报告：CE 行号对照 / 常量数值出处 / 三风险点裁决 / 实测 / 对抗映射 / RV 输出 / 基线红情况 | ✅ §二/§一/§五/§六/§七/§八 |
| 边界：只动允许清单；无 git 写操作；无临时文件 | ✅ §八 git status；Game.ts / Combat / Items / data/*.json / fixtures / Random.ts / 既有测试零改动；LoopMap/SafetyMap/WaypointMap/Connectivity 零改动 |

## 十、给验收方与下一轮的建议

1. **generation_baseline 重捕获**：待授权（397 处偏离，fixture 未动）。
   建议重捕获时在 fixture note 记"因 C-2（液体管线 RNG 移动）"。
2. **C-3**（removeDiagonalOpenings/finishDoors/finishWalls）落地时应同步
   翻转「斜向豁口 > 0」留痕断言。说明：finishDoors/finishWalls 在 web 侧
   没有独立可观察签名可写断言（门的孤立的判定标准依赖门系统语义），
   本轮只对 removeDiagonalOpenings 写了留痕。
3. **C-5**（坠落）落地时：把 liquidType 候选域中的 2 加回（case 2 分支已
   原样保留：深渊/渊缘×1），删除「深渊族恒 0」留痕，桥自动开始出现在
   深渊湖上（buildABridge 已就绪）；同时让 AI 寻路与 pathingDistance 的
   CHASM 语义接受坠落豁免（悬浮）。
4. **C-4**（DF/promoteTile）落地时补硫矿点火链（INERT → ACTIVE → 爆炸 →
   黑曜石），与火焰传播共用通道。
5. 岩浆湖的 AI 寻路缺口（§一 裁决 2 末段）建议随任意触碰 Combat/寻路的
   轮次一并处理。
