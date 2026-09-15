# C-3 交付报告：墙面与门的收尾（finishWalls / finishDoors / removeDiagonalOpenings）

- 分支：`round/c-3`（worktree，未执行任何 git 写操作）
- 新增：`src/engine/Map/WallDoorFinish.ts`、`src/test/c_3_walls_doors.test.ts`（15 用例全绿）
- 修改：`src/engine/Generator/Architect.ts`（仅挂载 + 观测字段，`git diff --stat`：40+/1-）
- 事实来源：`BrogueCE-master/src/brogue/Architect.c`（只读，未动）

---

## 一、CE 行号对照（本轮逐一以 grep/sed 核实，修正了任务书的近似值）

| 内容 | CE 位置 |
|---|---|
| `removeDiagonalOpenings()` 函数 | Architect.c:**1913-1949**（判据 1922-1927；`rand_percent(50)` 与推开侧选择 1929-1936；`HAS_MONSTER`+`machineNumber==0` 守卫 1938；`do…while(diagonalCornerRemoved)` 1917/1948） |
| `finishDoors()` 函数 | Architect.c:**2733-2756**（`secretDoorChance` 2735；`DOOR && machineNumber==0` 2738-2739；孤儿判据一 2740-2744；孤儿判据二 2745-2751；密门升级 2752-2754） |
| `finishWalls(boolean)` 函数 | Architect.c:**2480-2518** |
| `digDungeon` 第 5 步 `finishWalls(false)` | Architect.c:**2909**（任务书写 2907） |
| `digDungeon` 第 8 步 `removeDiagonalOpenings()` | Architect.c:**2936**（任务书写 2929——那是函数体内 `rand_percent(50)` 一带） |
| `digDungeon` 第 13 步 `finishDoors()` | Architect.c:**2971**（任务书写 2969） |
| `digDungeon` 第 14 步 `finishWalls(true)` | Architect.c:**2974**（任务书写 2973） |

**`finishWalls` 两次调用的实参语义**：第 5 步（2909）`false`——只查**四正方向**
暴露，发生在湖泊之前，把房间/走廊两侧的裸花岗岩立成 WALL；第 14 步（2974）
`true`——**含对角暴露**，发生在机器之后，既补最后的裸墙、也把完全埋没
（8 邻全不暴露）的 WALL 退回 GRANITE。T3 在"对角唯一暴露"夹具上证明两个
实参行为确实不同（这是 T4 实参断言的牙）。web 两次调用与 CE 同位：
`false` 在 generateTerrain 门位落位后、湖泊前；`true` 在 generateLevel
机器阶段后。实参由 `Architect.finishWallsCalls` 观测字段钉死（T4）。

## 二、`amuletLevel` 实际数值与出处

`gameConst->amuletLevel = AMULET_LEVEL = 26`：
`variants/GlobalsBrogue.c:1017`（`.amuletLevel = AMULET_LEVEL`）←
`variants/GlobalsBrogue.c:43`（`#define AMULET_LEVEL 26`）。
故 `secretDoorChance = clamp((depth-1)*67/25, 0, 67)`（C 整除）：
D1=0、D2=2、D3=5、D5=10、D10=24、D14=34、D20=50、D26=67（封顶）。
（任务书要求自查——查了，26 与转述一致；`Architect.ts` 既有的
`AMULET_LEVEL = DEEPEST_LEVEL = 26` 同值。）

## 三、`T_OBSTRUCTS_DIAGONAL_MOVEMENT` 的 web 近似（取舍说明）

web 移动是 8 向且 `canMoveTo` 无对角穿墙限制，**没有**对角阻挡概念。
CE 里同时带 `T_OBSTRUCTS_PASSABILITY` 与 `T_OBSTRUCTS_DIAGONAL_MOVEMENT`
的地形（Globals.c 目录逐条核对）就是"墙类"：GRANITE / WALL / SECRET_DOOR
（`T_OBSTRUCTS_EVERYTHING`，Globals.c:322/327/330）+ CRYSTAL_WALL/FORCEFIELD
（web 无）。近似取同一地形集：

- `obstructsDiagonalMovement(t)` = {GRANITE, WALL, SECRET_DOOR}；
- **WATER_DEEP 不收**：CE 深水可踏入（`T_IS_DEEP_WATER` 只进
  `T_PATHING_BLOCKER`）。若按 web canMoveTo 把它当阻挡物，
  removeDiagonalOpenings 会推开湖角、finishDoors 会把临水门全判孤儿
  ——都是 CE 不存在的行为，且会改坏 C-2 刚落地的湖形。代价（显式登记）：
  web 玩家仍可沿深水湖角对角穿行——这是 web 移动模型的既有 quirk，
  修它要动 Game.ts（禁改），不属本轮。
- LOCKED_DOOR 收进 passability 但不收对角：其 CE 最近对应 PORTCULLIS
  带通行旗、不带对角旗（Globals.c:339）。

其余旗标映射（详见 WallDoorFinish.ts 头注；测试 T2 对 31 个 TerrainType
× 4 谓词全枚举钉死）：

| CE 旗标 | web 地形集 |
|---|---|
| `T_OBSTRUCTS_PASSABILITY` | GRANITE / WALL / SECRET_DOOR / LOCKED_DOOR |
| `T_OBSTRUCTS_VISION` | GRANITE / WALL / DOOR / SECRET_DOOR（= web isOpaque 集；对 exposure 判据 `!vision‖!pass` 与 CE 逐地形结果等价） |
| `T_PATHING_BLOCKER`（Rogue.h:1948） | 上者 ∪ WATER_DEEP / LAVA / CHASM / INERT_BRIMSTONE / TRAP（映射先例：LakeSystem.ceTerrainFlags） |

CE 1938 的 `HAS_MONSTER` 守卫无 web 对应物：三函数运行时（populateLevel
之前）场上无怪物，web Cell 亦无怪物位——模型差异，登记。

## 四、"属于机器"的判据

用 `Cell.machineNumber !== 0`。依据：`BlueprintEngine.applyBlueprint`
（BlueprintEngine.ts:418）给 `room.cells` 全体写入机器号，与 CE 的
`pmap[][].machineNumber` 同名同义，且 LoopMap / LakeSystem / Game.ts 已有
三处同款消费先例。任务书提到的 P1-33 `CHARRED_FLOOR` 权宜是"机器内部裸
地板退出楼梯/钥匙牌堆"的标记，与"该格属机器"的判定无关（后者
machineNumber 直接可查），不重复该权宜。机器门豁免在当前数据下是双保险：
blueprints.json 全部 10 张蓝图 `doorTerrain` 都是 `LOCKED_DOOR`（非 DOOR），
本就进不了 finishDoors 的处理集；豁免对未来 `doorTerrain: DOOR` 的蓝图
生效（T6d 钉住）。

## 五、两个风险点的裁决与理由

### 风险点 1：密门 × 连通性判据 —— web 有发现机制，按 CE 口径如实生成

**查明：web 有密门发现机制。** `Game.ts:6246-6249`：玩家移动后对四正邻接
`SECRET_DOOR` 以 30% 概率揭示并 `setTerrain(DOOR)`（`Cell.isDiscovered`）。
比 CE 的主动搜索粗糙但存在 → 落入任务书"有"分支。

**CE 旗标核实（任务书括号之问，答案是"带"）**：SECRET_DOOR 的 terrain
flags = `T_OBSTRUCTS_EVERYTHING ⊇ T_OBSTRUCTS_PASSABILITY ⊂
T_PATHING_BLOCKER`（Globals.c:330、Rogue.h:1948/1954）——字面上**带**
T_PATHING_BLOCKER。若按字面"与 T_PATHING_BLOCKER 口径对齐"会得出
"密门=阻断物"，与裁决本意相反。**但** CE 一切连通性/环分析的真实判据是
`T_PATHING_BLOCKER && !TM_IS_SECRET`（Architect.c:199-210 checkLoopiness、
Architect.c:53 cellIsPassableOrDoor），web 已有同款对应物
`LoopMap.blocksPathing`（注释明言"SECRET_DOOR → TM_IS_SECRET 豁免 →
不阻挡，环分析视作通路"）。即 **CE 自己在分析口径下就把密门视作可通行**，
任务书裁决的落点（视作可通行）与 CE 一致，采纳；措辞按 CE 修正（§九-2）。

**据此**：按 CE 概率如实生成密门（D26 封顶 67%），不因 canMoveTo 的字面
排除而少生成——实测 5 种子 × D1-26 合计 327 扇，分布见 §八。
**结构后果（必须申报）**：p1_26 / p1_29 / p1_33 的既有断言用 canMoveTo
字面口径（密门=墙）量连通性，且三文件本轮禁改。实测：

| 测试 | 口径 | 实测 | 定性 |
|---|---|---|---|
| 本轮 T12（15 种子×D1-26） | canMoveTo ∪ SECRET_DOOR | **坏层 0/390** | 闸门通过 |
| 本轮 T12 同批 | p1_33 f 修正版（可走格单一连通块，洪泛穿密门） | **违例 0** | 闸门通过 |
| 本轮 T12 同批 | canMoveTo 字面 | 68/390 坏层 | 密门假阳性 |
| p1_26（5 种子） | canMoveTo 字面 | 22 坏层翻红 | 同上（明细逐层对得上） |
| p1_29 e2e（10 种子） | canMoveTo 字面 | 47 坏层翻红 | 同上 |
| p1_33 a/f（15 种子） | canMoveTo 字面 | 翻红 | 同上 |

假阳性定性成立：每层把密门视作门（=发现后即可通行，web 有该机制）后
全部完全连通。按《留痕测试与文件边界》惯例（第五次系统性冲突），
**p1_26 / p1_29 / p1_33 三文件的判据需验收方补刀重校准**：洪泛谓词改为
`canMoveTo(t) || terrain === SECRET_DOOR`（与 blocksPathing 口径对齐），
断言阈值（严格 0）无需放宽。注意 p1_29 的失败信息自述"合并了会移动
RNG 流的轮次请更新 KNOWN_MACHINE_STAGE_BAD_LEVELS"——**不要**把这些
密门层填进该常量（它们不是机器阶段缺陷），改判据才是对的。
任务书"若变红，停下来报告，不许改常量"——遵照：不动三文件、不动
`KNOWN_UNREACHABLE_STAIRS_LEVELS`。

**"不许少生成密门绕过"——遵守**。web 的 placeTraps 另有一批自创密门
（depth≥4 最多 3 扇，非 CE 机制），本轮未动（边界外，§九-5）；实测它们
可能被机器墙围成孤格，故 T12 的"必须可达集"严格取 p1_33 f 同款可走格
集合、仅洪泛允许穿密门——语义与 p1_33 f 完全对齐，无放宽。

### 风险点 2：孤儿门移除 × C-0 门数统计 —— 未击穿

孤儿门移除只把 DOOR 改 FLOOR（仍可走），不减少可走格；新开门数统计
（A1/A6）发生在 addLoops 时刻，先于本轮所有阶段。**实测 c_0 全文件绿，
无任何阈值重校准**。另以 T13 把 E1 的"门位不落回墙"延伸到全管线。

## 六、CE → web 管线挂载位置

| CE digDungeon 步骤 | web 挂载点 |
|---|---|
| 5 `finishWalls(false)`（2909） | `generateTerrain`：门位落位后、`designEnvironmentOvelays` 前 |
| 8 `removeDiagonalOpenings()`（2936） | `designEnvironmentOvelays`：`fillLakes` 后、`cleanUpLakeBoundaries` 前 |
| 13 `finishDoors()`（2971） | `generateLevel`：`buildMachines` 后 |
| 14 `finishWalls(true)`（2974） | `generateLevel`：finishDoors 后 |

既有偏差（C-2 已登记，非本轮引入）：web 的 cleanUpLakeBoundaries/架桥在
机器**前**执行（CE 在机器后）——Game.ts 禁改无法交错。挂载后完整顺序：
carve → 落位 → addLoops → **finishWalls(false)** → overlays → fillLakes →
**removeDiagonalOpenings** → cleanUpLakeBoundaries → 桥 → placeTraps(web 自创) →
机器 → **finishDoors** → **finishWalls(true)**。

## 七、对抗性测试与反向验证

### 对抗性测试（任务书第 4 条五项全覆盖 + 补充）

| # | 被捕获的错误实现 | 用例 | 牙的机理 |
|---|---|---|---|
| AD1 | removeDiagonalOpenings 只扫一遍（无 do-while） | T9 | 2×2 pattern 的上阻挡格挂 machineNumber，首趟掷骰命中机器侧时不改动；do-while 依赖同趟另一 pattern 的改动触发重扫、第二趟重掷后推开自由侧。种子扫描锁定"首趟落空、重掷解决"的种子：生产 removed=2、passes≥3；单趟变体 removed=1、残留 pattern |
| AD2a | 孤儿判据一写反（&&→|| 等） | T6a | 十字皆通的门必须移成 FLOOR（orphanFlooredCross==1） |
| AD2b | 孤儿判据二阈值写错（≥4/≤3） | T6b | 恰 3 阻挡 → FLOOR；同夹具 2 阻挡的正常门必须存活（防阈值错另一半） |
| AD3a | 密门概率不随深度 | T6c | D1 恒 0 升级（概率 0）；恒 67 的变体立即红 |
| AD3b | clamp 上界写错 | T1 | 概率表逐深度钉死 + D40 封顶 67 + 单调性 |
| AD3c | 恒不升级密门 | T6c 比率带 + T12 密门分布 | 100 扇独立门 D26 升级率 50%~85% 带（CE 期望 67%）；真实关卡 D1-5=8 → D20-26=150 |
| AD4 | machineNumber==0 守卫漏掉 | T6d | 机器号门原样保留、不进 eligibleDoors、不耗骰 |
| AD5 | finishWalls 两次实参写反 | T3+T4 | T3 证明 false/true 在对角唯一暴露夹具上行为不同（牙）；T4 钉生产实参记录 |
| 补 | 旗标集成员拼错/枚举名写错 | T2 | 31 TerrainType × 4 谓词全枚举快照 |
| 补 | 花岗岩补墙漏扫/判据写反 | T5 | 真实关卡不变量：终态 GRANITE 的 8 邻必全不暴露 |
| 补 | 对角穿缝未消净 | T10 | 真实关卡残余 pattern==0 且总移除数>0（非空转） |
| 补 | C-3 阶段混入非种子随机源 | T11 | 同种子两次全管线指纹+C-3 统计逐一一致 |

### 反向验证（生产代码真实改坏 → 真实失败输出 → 还原；3 条）

| RV | 改坏点 | 真实失败输出（节选） | 还原复核 |
|---|---|---|---|
| RV1 | do-while → `while (false)`（单趟） | `T9 × AssertionError: 前 2000 个种子内应存在"P2 首趟命中机器侧、重掷后解决"的种子…: expected -1 to be greater than 0` | 还原后 T9 绿；`grep RV` 无残留 |
| RV2 | `secretDoorChance` 恒返 67 | `T1 × AssertionError: D1 密门概率: expected 67 to be +0`；`T6c × AssertionError: expected 67 to be +0` | 同上 |
| RV3 | 第 14 步 `finishWalls(this.grid, true)` → `false` | `T4 × AssertionError: seed424242/D2 第 14 步实参应为 true: expected false to be true`；`T5 × AssertionError: seed424242/D2：存在 8 邻暴露却未补成 WALL 的花岗岩…: expected [ { x: 3, y: 22 } ] to deeply equal []` | 同上 |

三处改坏均已还原；最终 `git diff` 仅含交付改动，c_3 文件复跑 15/15 绿。

## 八、实测汇报（任务书第 7 条）

- **坏层复验（15 种子 × D1-D26 = 390 层）**：
  - 修正口径（canMoveTo ∪ SECRET_DOOR ≈ CE `T_PATHING_BLOCKER &&
    !TM_IS_SECRET`）：**坏层 0**（T12 断言）；
  - 非机器可走格单一连通块（p1_33 f 修正口径）：**违例 0**（T12 断言）；
  - canMoveTo 字面口径（p1_26/p1_29/p1_33 现行判据）：68/390 坏层
    （T12 观测打印；明细见 §五表格与测试输出）。
- **孤儿门移除数**（5 种子 × D1-26，130 层合计）：十字判据 5、封死判据 22。
- **密门数随深度**（同 130 层合计）：D1-5=8、D6-13=68、D14-19=101、
  D20-26=150（合计 327）——随深度递增，与 `clamp((d-1)*67/25,0,67)` 一致。
- **对角穿缝消除数**（同 130 层合计）：22 处；消除后残余 0（T10 另在
  3 种子 × D1-8 逐层复验残余 0）。
- 环路门位经全管线后无一落回墙（T13，3 种子 × D1-12）。
- T12 console 原文：
  ```
  [c_3] 实测（5 种子 × D1-D26 合计）：孤儿门移除 十字=5 封死=22；密门 D1-5=8 D6-13=68 D14-19=101 D20-26=150；对角穿缝消除=22
  [c_3] 连通性：修正口径（密门视作通路）坏层=无；canMoveTo 字面口径坏层=68（seed424242/D7、seed424242/D8、seed424242/D24、seed424242/D25、seed777/D18、seed777/D20、seed777/D23、seed20260913/D4、seed20260913/D8、seed20260913/D15、seed20260913/D23、seed20260913/D25…）
  ```

## 九、与预设不符之处（只列不修）

1. **任务书行号偏差**：`finishWalls(false)` 实为 2909（书 2907）、
   `removeDiagonalOpenings()` 调用实为 2936（书 2929）、`finishDoors()`
   实为 2971（书 2969）、`finishWalls(true)` 实为 2974（书 2973）；
   函数体末行亦差 1-2 行（实测 1949 / 2756 / 2518）。代码注释一律以实测为准。
2. **风险点 1 的括号措辞需修正**：CE 密门字面上**带** T_PATHING_BLOCKER
   （经 T_OBSTRUCTS_PASSABILITY），"与 T_PATHING_BLOCKER 口径对齐"若按
   字面执行会得出"密门=阻断物"，与裁决本意相反；CE 实际分析判据是
   `T_PATHING_BLOCKER && !TM_IS_SECRET`（Architect.c:199-210）。本轮按
   CE 执行，与裁决落点（密门视作可通行）一致。
3. **p1_26 / p1_29 / p1_33 结构性翻红（预期内、本轮禁改）**：canMoveTo
   字面口径 vs 密门，见 §五。第五次系统性冲突——任务书"允许修改"清单
   未列入这三份（c_2 留痕同理见下条），按规矩停下申报：不动文件、
   不动常量、不放宽断言。
4. **c_2_lakes_e2e.test.ts 留痕断言翻红**（"留痕（C-3）：removeDiagonalOpenings
   未做，斜向豁口仍存在"，实测 `expected 0 to be greater than 0`）：该断言
   自述"C-3 落地后此断言应翻转为 0"，但文件不在"允许修改"清单。验收方
   合并时把该断言翻转为 0（或删除）即可；本测试文件的 T10 已用同判据
   钉住"真实关卡残余对角穿缝==0 且移除数>0"。
5. **p1_20_item_placement 真失败（既有潜伏缺陷被 RNG 流移动暴露，非本轮
   回归）**：`seed=777 D7 scroll_of_enchantment @ (26,12) terrain=LAVA`。
   实证链：(26,12) 的 `machineNumber=2`——属机器格；岩浆来自
   blueprints.json 的 `key_lava_moat` 蓝图特征（全库唯一 FLOOR→LAVA
   写入者，机器阶段落位）；机器宝物落格池未排除 LAVA 地形（canMoveTo
   对岩浆放行），卷轴因此落在护城河岩浆上。两处代码（populateLevel 的
   宝物落格在 Game.ts、blueprints.json）均在禁改清单，本轮只登记：
   建议后续轮次给机器宝物落格加 `terrain !== LAVA`（或把该特征格排除出
   牌堆）。C-3 三函数不产岩浆、不碰机器落位。
6. **armor_model_effect 超时假红**：套件并行下 `Test timed out in
   180000ms`；**单独重跑 55s 全绿**（2/2 passed）。属任务书预警的
   "两边抢 CPU 集体假红"类，非真失败。
7. **generation_baseline 全线变红（预期内）**：C-3 三阶段消耗 RNG
   （removeDiagonalOpenings 每合格 pattern 一次 50% 骰、finishDoors 每次
   升级判定一次 rand_percent——`Random.randPercent` 与 CE `rand_percent`
   同为"恒耗骰"语义），全部后续随机流移动，基线指纹失效。按任务书要求
   不刷新 fixtures。c_0/c_1/c_2/p1_29 的自洽型决定性测试（同代码两遍
   比对）不受影响，实测全绿。
8. **removeDiagonalOpenings 的 do-while 在数学上冗余**（每步只把阻挡格改
   可通行，pattern 集合单调收缩，理论上一趟收敛；CE 原文如此）。本轮照
   CE 保留，且 T9 证明它在"机器守卫落空"场景下有可观测行为（重掷），
   非死代码。

## 十、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| 三函数按 CE 实现、挂 digDungeon 对应位置 | ✅（§一、§六） |
| `finishWalls` 两次调用实参语义查清并报告 | ✅（§一） |
| 密门概率用真实 `amuletLevel`（自查） | ✅（§二，26） |
| `T_OBSTRUCTS_DIAGONAL_MOVEMENT` web 近似查清并说明取舍 | ✅（§三） |
| "属于机器"判据选择并说明 | ✅（§四，machineNumber） |
| 风险点 1 裁决（查明机制、核实旗标、不少生成） | ✅（§五；括号口径按 CE 修正，§九-2） |
| 风险点 2（C-0 门数统计不放宽） | ✅（§五，c_0 全绿、零重校准） |
| 明确不做 ×4 留痕 | ✅（T14；C-5 由 c_2 留痕覆盖不重复） |
| 连通性闸门（坏层仍 0，按风险点 1 裁决口径） | ✅ 修正口径 0/390（T12）；p1_26/p1_29/p1_33 字面口径翻红已申报（§五、§九-3） |
| 对抗性测试 ≥5 条 | ✅ 12 条（§七） |
| 反向验证 ≥2 条（真实失败输出） | ✅ 3 条（§七） |
| 决定性锁 | ✅ T11 + 既有 D1/B1 |
| 实测汇报 4 项 + 坏层复验（15 种子 × D1-D26） | ✅（§八） |
| 门禁：`npm run build` 绿 | ✅ |
| 门禁：`npm test` 除 generation_baseline 外全绿 | ⚠️ 见 §十二定性表：4 个预期红（baseline、c_2 留痕、p1_26/p1_29/p1_33 密门口径冲突——均需验收方按 §五补刀）、1 个既有潜伏缺陷暴露（p1_20，§九-5）、1 个超时假红（armor 单跑绿）。除上述外全绿 |

## 十一、验收方合并清单（建议）

1. `p1_26_invariants.test.ts` / `p1_33_machine_chokepoint.test.ts`（用例 a/f）/
   `p1_29_lake_connectivity.test.ts`（e2e）：连通性洪泛谓词改为
   `canMoveTo(t) || terrain === SECRET_DOOR`，阈值不动。
2. `c_2_lakes_e2e.test.ts`：删除"留痕（C-3）"用例或把断言翻转为
   `toBe(0)`（其自述即如此设计）。
3. `generation_baseline`：按常规流程重采（fixtures 本轮未动）。
4. p1_20 的机器宝物×岩浆潜伏缺陷：另立任务（Game.ts 解禁后修）。

## 十二、`npm test` / `npm run build` 输出尾部

### npm test（全量，第二轮完整日志；第一轮受本报告撰写期间注释行编辑影响作废）

```
 ❯ src/test/p1_20_item_placement.test.ts (1 test | 1 failed) 57076ms
 ❯ src/test/generation_baseline.test.ts (1 test | 1 failed) 59638ms
 ❯ src/test/c_2_lakes_e2e.test.ts (6 tests | 1 failed) 181483ms
 ❯ src/test/p1_26_invariants.test.ts (5 tests | 1 failed) 217434ms
 ❯ src/test/p1_33_machine_chokepoint.test.ts (7 tests | 2 failed) 225401ms
 ❯ src/test/armor_model_effect.test.ts (2 tests | 1 failed) 300831ms
 ❯ src/test/p1_29_lake_connectivity.test.ts (7 tests | 1 failed) 359296ms
 Test Files  7 failed | 53 passed (60)
      Tests  8 failed | 611 passed | 8 skipped | 5 todo (632)
 Start at  01:40:59
 Duration  487.91s (transform 4.35s, setup 0ms, import 25.90s, tests 3547.22s, environment 22ms)
```

定性（逐条）：
- `generation_baseline`：预期红（fixtures 禁刷新，RNG 流移动，§九-7）；
- `c_2_lakes_e2e`：预期红（C-3 留痕断言按自述翻转，§九-4）；
- `p1_26` / `p1_29` / `p1_33`：预期红（canMoveTo 字面口径 vs 密门假阳性，
  §五/§九-3）；
- `p1_20`：**真失败**，但为既有潜伏缺陷（key_lava_moat 岩浆 × 机器宝物
  落格）被 RNG 流移动暴露，修复代码在禁改文件，§九-5；
- `armor_model_effect`：**超时假红**（180s 超时；单独重跑 55s 2/2 全绿）。

### npm run build（vue-tsc + vite build）

```
dist/assets/index--88o4HGP.js               764.40 kB │ gzip: 232.98 kB
(!) Some chunks are larger than 500 kB after minification. Consider:
- …
✓ built in 2.29s
```

（构建期 `vue-tsc -b` 无类型错误——C-2 教训的枚举成员拼写风险已由
T2 全枚举快照 + build 双保险覆盖。）

### 单文件复跑（区分超时/真失败）

```
npx vitest run src/test/armor_model_effect.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
 Duration  54.79s

npx vitest run src/test/c_3_walls_doors.test.ts   （RV 还原后终验）
 Test Files  1 passed (1)
      Tests  15 passed (15)
 Duration  111.55s
```

## 十三、git 留痕

```
$ git diff --stat
 brogue-web/src/engine/Generator/Architect.ts | 41 ++++++++++++++++++++++++-
 1 file changed, 40 insertions(+), 1 deletion(-)

$ git status --short
 M src/engine/Generator/Architect.ts
?? ai_docs/c_3_walls_and_doors_report.md
?? src/engine/Map/WallDoorFinish.ts
?? src/test/c_3_walls_doors.test.ts
```

调试探针（zz_probe.test.ts，用于 p1_20 定性）已删除；三处 RV 改坏已还原
（`grep -n "RV1\|RV2\|RV3"` 零命中）。
