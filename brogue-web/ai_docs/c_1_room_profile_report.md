# C-1 轮次报告：房间剖面与深度曲线对齐 CE

> 2026-09-15。分支 `round/c-1`（worktree，未执行任何 git 命令，改动留工作区）。
> CE 事实来源：`../BrogueCE-master/src/brogue/`（只读）。所有行号均打开核实。

---

## 一、改动清单

| 文件 | 状态 | 内容 |
|---|---|---|
| `src/engine/Generator/Architect.ts` | 重写生成主体（480→780 行） | 见 §二 |
| `src/engine/Generator/RoomBuilder.ts` | 扩充（241→323 行） | 见 §三 |
| `src/test/c_1_room_profile.test.ts` | **新增**（410 行） | 见 §五、§六 |

未动 `LoopMap.ts`、任何既有 `src/data/*.json`、`src/engine/Random.ts`、`Systems/`、其他既有测试。
未创建数据文件：剖面目录只有 2 个剖面 × 9 个数，以带 CE 行号注释的导出常量
（`DUNGEON_PROFILE_CATALOG`）落在 Architect.ts 内，与消费点同址，供测试直接导入。

### 架构变化（generateTerrain 流水线）

```
旧：填花岗岩 → 固定十字首房(0,0) → attachRooms(dpBasic, 40, 15) → addLoops → 湖泊叠加
新：填花岗岩 → carveDungeon（CE Architect.c:2456-2478：首房间剖面 + attachRooms(35,35)）
    → translateWorkGridToTerrain（CE digDungeon 2898-2905：1→FLOOR；2→60% 门）
    → addLoops → 湖泊叠加（P1-29 闸门原样保留）
```

carveDungeon 在 CE 语义的短整 work grid（0 花岗岩/1 地板/2 门位）上进行，
attachRooms 是 CE 2367-2423 的完整移植：洗牌滑移、`chooseRandomDoorSites`（四向门位 +
10 格射线验证）、`attachHallwayTo`（横 5-15/竖 2-9，末 5 次尝试不接走廊）、
`roomFitsAt` 3×3 光环净空、`insertRoomAt` 连通泛洪。RNG 全部走种子化 `rng`。

**一处 web 合同适配（非 CE 内容，已在代码注释声明）**：Game.ts:424 把 D1 玩家出生点、
populateLevel 把 D1 上楼梯钉死在画布中心 (39,14)，而 CE 入口房在底部中央、不覆盖该点
（CE 自己把 D1 上楼梯锚在 `(DCOLS-1)/2-1, DROWS-2`，RogueMain.c:246-247，靠
getQualifyingGridLocNear 就近落位）。故 D1 在中心凿 3×3 前厅 + 3 宽走廊向下接入入口房
竖臂（x=39 与竖臂共线，仅 y∈[15,16] 两行 + 前厅 9 格）。初版 1 宽走廊导致出生点
8 邻域仅 1 格可走（monster_stats_effect 接敌场景实测 attempts=1，属真实开局退化），
已加宽修复。

## 二、与 CE 的逐项对照

| CE 事实 | CE 位置 | web 实现 |
|---|---|---|
| `dungeonProfileCatalog[DP_BASIC]` = `{freq:{2,1,1,1,7,1,0,0}, corridor:10}` | **Globals.c:946** | `DUNGEON_PROFILE_CATALOG.DP_BASIC`（逐值一致） |
| `dungeonProfileCatalog[DP_BASIC_FIRST_ROOM]` = `{freq:{10,0,0,3,7,10,10,0}, corridor:0}` | **Globals.c:947** | `DP_BASIC_FIRST_ROOM`（逐值一致） |
| `adjustDungeonProfileForDepth`：descent=clamp(100(d-1)/25,0,100)；[0]+=20·(100-descent)/100；[1]+=10；[3]+=7；[5]+=10·descent；corridor+=80·(100-descent)/100（全部 C 整数除法） | Architect.c:2425-2434 | `adjustDungeonProfileForDepth`（`Math.floor` 复刻截断；测试黄金值逐项核对） |
| `adjustDungeonFirstRoomProfileForDepth`：d=1 全清零 + [7]=1；否则 [6]+=50·descent/100 | Architect.c:2436-2448 | `adjustDungeonFirstRoomProfileForDepth` |
| `designRandomRoom(grid, false, NULL, firstRoomDP.freq)` 首房间直接画入 | Architect.c:2465 | 同构（doorSites=null 调用） |
| `attachRooms(grid, &theDP, 35, 35)` | Architect.c:2473 | `attachRooms(work, theDP, 35, 35)`（常量 `CE_ROOM_ATTACH_ATTEMPTS`/`CE_MAX_ROOM_COUNT`） |
| corridorChance 消费点：`roomsAttempted <= attempts-5 && rand_percent(corridorChance)` | Architect.c:2381 | 同构 |
| 门位落位 `grid==2 → rand_percent(60) && depth<最深层 ? DOOR : FLOOR` | digDungeon Architect.c:2898-2905 | `translateWorkGridToTerrain`（复用 LoopMap 的 `LOOP_DOOR_PERCENT`/`DEEPEST_LEVEL`） |

### ★ dungeonProfileCatalog 基准值出处（任务书要求自查，与验收方转述有一处分歧）

任务书 §常识 三、速查表把目录类指向 `Globals.c`/`variants/GlobalsBrogue.c`。本轮实测
**本仓 CE 布局中 `dungeonProfileCatalog` 在 `src/brogue/Globals.c:934-947`**
（`src/brogue/GlobalsBrogue.c` 不存在；`hordeCatalog_Brogue` 才在 variants——
常识表本身对 monsterCatalog 的定位正确，DP 目录的位置表里没有，此处补记）。
DP_BASIC/DP_BASIC_FIRST_ROOM 的数值与任务书附录的转述**一致**，另有两个机器专用
剖面 `DP_GOBLIN_WARREN`/`DP_SENTINEL_SANCTUARY`（Globals.c:948-949）——本轮不移植，
理由：web 机器走数据驱动 BlueprintEngine，与 CE addMachines 不同源（C-0 已有先例口径）。

## 三、8 种房型完备性（必做 #5）

web `RoomType` 枚举下标与 CE `roomFrequencies` 注释（Globals.c:935-943）一一对应，无错位。
改动前各型的真实实现状态与本轮处理：

| 下标 | CE 房型 | 改动前 web 状态 | 本轮处理 |
|---|---|---|---|
| 0 | Cross room | 有实现，但为"双矩形居中"简化版，与 CE 的偏移十字（w2 可达 20、偏移掷骰）不同 | **按 CE 2023-2041 重写** |
| 1 | Small symmetrical cross | ❌ **无实现**（映射到 designSmallRoom 占位） | **按 CE 2043-2061 新增** `designSymmetricalCrossRoom` |
| 2 | Small room | 有，与 CE 一致（3-6×2-4 居中） | 保留 |
| 3 | Circular room | 有，与 CE 一致（5% 大圆 + 50% 环形） | 保留 |
| 4 | Chunky room | ❌ **无实现**（fallback designSmallRoom） | **按 CE 2091-2124 新增** `designChunkyRoom` |
| 5 | Cave | 部分：仅 1 个固定变体 (4,12,4,12)；CE 为 rand_range(0,2) 三选一 | **按 CE 2301-2312 补齐三变体**：(3,12,4,8)/(3,12,15,DROWS-2)/(20,DROWS-2,4,8) |
| 6 | Cavern（满层洞窟） | 有 designCavern 调用但尺寸不符 CE：(15,77,10,27)，CE 是 (CAVE_MIN_WIDTH=50, DCOLS-2, CAVE_MIN_HEIGHT=20, DROWS-2)（Rogue.h:1157-1158） | **对齐 CE 尺寸** (50,77,20,27) |
| 7 | Entrance room | ❌ **无实现**（fallback designSmallRoom）——必做 #4"深度 1 恒入口房"在旧代码下只是名义的 | **按 CE 2005-2021 新增** `designEntranceRoom`（倒 T：竖 8×10 + 横 20×5，底部中央） |

另：`designCavern` 的元胞自动机出生串旧实现为 `"ffffftttt"`，CE（Architect.c:1990-1991）
为 `"ffffffttt"`/`"ffffttttt"`，已纠正。**没有为填表造任何 CE 不存在的房型。**

## 四、五项实测（本轮验收核心）

口径：5 种子（424242/777/20260913/31337/20260916）× D1-D26 = 130 层。
"改动前"数据为本轮开工前以**同口径临时探针**复测（当时验收方给的深水 12.7 格/层
与本探针完全吻合，证明口径一致）；探针用完即删，未入库。

### 1. 房间数（attach 成功落位数，不含首房间）

| | 改动前 | 改动后 |
|---|---|---|
| 每层 attach 数 | ≤14（roomsBuilt=1 起步 + maxRooms=15 的硬顶；实测几乎打满） | **均值 16.1，峰值 24，硬上限 35** |
| floor+door 格数/层 | 均值 **156.8**（7.8%~22.5%） | **均值 683**（≈30%，个别层达 45%） |

attach 均值只从 ~14 升到 16.1：CE 滑移算法的 3×3 光环净空比旧实现的无光环硬贴**严格得多**，
35 次尝试中约半数找不到合规落位（CE 同算法同画布，行为同源）。房间数没有翻倍，但
**房间面积**（洞穴/洞窟/碎块/入口房全部真实化）与**走廊**使地板总量达原来的 4.4 倍。

按深度明细（5 种子均值，`Dxx: attach / 走廊 / 环门 / floor / 深水`）：

```
D1: 17.0/12.2/5.4/734/9.4   D10: 17.6/ 5.6/4.2/668/19.8  D19: 15.6/2.0/2.0/641/24.4
D2: 15.0/11.2/4.4/729/11.4  D11: 16.6/ 5.8/4.8/747/ 0.0  D20: 17.0/1.6/3.4/664/ 3.8
D3: 15.4/ 9.4/4.8/684/ 9.0  D12: 21.2/ 8.8/4.2/612/18.0  D21: 18.6/2.0/3.0/641/12.2
D4: 19.6/11.2/5.0/624/12.8  D13: 14.4/ 4.4/3.8/699/19.8  D22: 13.8/1.6/3.0/714/30.6
D5: 16.2/ 8.6/3.4/628/23.6  D14: 16.2/ 5.2/3.8/667/12.4  D23: 17.2/1.0/3.0/728/10.2
D6: 13.2/ 7.8/3.6/726/11.2  D15: 15.4/ 3.4/3.6/717/12.4  D24: 15.0/0.8/2.6/737/21.4
D7: 17.8/ 9.0/5.4/706/25.4  D16: 16.0/ 5.4/3.4/669/30.4  D25: 14.4/0.2/3.0/693/ 2.6
D8: 14.8/ 8.0/4.0/634/29.6  D17: 11.6/ 2.2/4.0/711/13.8  D26: 15.4/1.0/3.2/652/19.6
D9: 15.4/ 7.6/3.2/709/12.2  D18: 19.4/ 4.0/4.0/620/24.0
```

### 2. 走廊占比随深度（CE corridorChance 90→10 的行为验证）

走廊房（经 attachHallwayTo 落位）每层均值：**浅层 D1-5 = 10.5，深层 D20-26 = 1.2**
（比值 8.75×）。逐深度：12.2(D1) → 8.0(D8) → 5.2(D14) → 2.0(D19) → 0.8(D24) → 1.0(D26)，
单调衰减与 CE 曲线一致。改动前该值为**恒 0**——旧实现 `corridorChance` 字段
**从未被任何代码消费**（全仓 grep 证实），本轮才首次接上。

### 3. 房型分布随深度（抽取口径，130 层合计 3600 次）

浅层 D1-10（n=1800）：**十字 42.0%、洞穴 5.7%**；
深层 D17-26（n=1800）：**十字 18.2%、洞穴 35.1%**——分布显著翻转。
逐深度十字房占比：47%(D1) → 34%(D16) → 21%(D23) → 4%(D26)，与 CE 深度曲线（浅层
+20/descent、深层靠 [5] 上升）吻合。大洞窟（下标 6）**只在首房间剖面**出现（CE 调整
从不触碰 attach 池的 [6]，实测 60/130 层的首房间是洞窟，全部在深层）；入口房（下标 7）
只在 D1 抽取（恰 5 次/130 层）。

### 4. ★ 环路收益（对照 C-0 基线：门均 2.7 扇）

- **addLoops 新开环门：491 扇/130 层 = 均值 3.8（基线 351 扇、2.7）→ +40%**。
  分种子：424242=104、777=95、20260913=100、31337=92、20260916=100（各 26 层）。
  且逐深度基线全部抬升：D1 均值 5.4 扇（原 seed777/D1 为 0）。
- **IN_LOOP 绝对格数：16,614 vs 基线 5,899 → 2.8 倍**。
  分种子：3507/3344/3190/3189/3384 格。
- **IN_LOOP 占比（loop/可通行）：14.2% vs 基线 13.9%——几乎持平。**
  这是**分母稀释**，不是机制失灵：可通行格从 42,302 涨到 ~116,700（2.8×），环标记
  集中在走廊/房间边缘而大开间内部本就不在环上。验收方预期"IN_LOOP 显著上升"在
  **占比口径下不成立、在绝对格数口径下成立（+182%）**——测试 B9 以绝对格数断言，
  占比仅作观测打印。safety map 的 -=10 支路消费的是逐格布尔，绝对格数才是 AI 可感收益。

### 5. 深水总量

**均值 13.2 格/层 vs 基线 12.7**（+4%，与 floor 面积 4.4× 的增长相比可忽略）。
P1-29 湖泊闸门未动；增长来自"湖只能盖在 FLOOR 上、FLOOR 变多了"的自然结果。

## 五、测试（`src/test/c_1_room_profile.test.ts`，14 条全绿）

纯函数组（CE 整数算术黄金值）+ 行为组（全部打在真实生成关卡）：

| # | 断言 | 捕获的错误实现 |
|---|---|---|
| U1 | descentPercent 黄金值（1→0, 14→52, 26→100, **40→clamp 100**） | 整数除法取错、clamp 缺失 |
| U2 | DP_BASIC 调整后频率表/corridorChance 在 D1/14/26 的逐值黄金值；[6]/[7] 恒 0 | **频率表下标错位**、增量算错、把 6/7 混进 attach 池 |
| U3 | 首房间剖面黄金值（D1 全零+[7]=1；[6] 随深度 36/60） | 首房间剖面照抄 DP_BASIC |
| U4 | **对抗**：depth=40 与 depth=26 剖面完全一致 | **descentPercent 的 clamp 缺失**（漏 clamp 时 [0] += ⌊20·(−56)/100⌋ 变负频率） |
| U5 | **对抗**：corridorChance/freq[0] 全深度单调不增、freq[5] 单调不减、D1/D26 端点严格差 | **深度曲线写反**（深层走廊多）、曲线写平 |
| B1 | **对抗**：5 种子 D1 首房间恒=7；D2+ 恒∉{1,2,7} | **首房间未固定为入口房**（freq[7]=0 的表抽不到 7，5 种子必偏） |
| B2 | **对抗**：逐层 `draws[6] ≡ (首房是洞窟)`、`draws[7] ≡ (D1)`；入口房合计恰 5 | attach 池混入 6/7 号房 |
| B3 | **对抗**：attach 峰值 ≥20（旧实现硬顶 14）且 ≤35（CE 上限）；均值 >14.5；计数器与物理地板量（≥200+5×rooms）交叉印证 | **maxRoomCount/attempts 未生效**（15 硬顶绝达不到 20；无上限会破 35） |
| B4 | **对抗**：浅层走廊房均值 >4（实测 10.5）、深层 <4（实测 1.2）、比值 >2.5 | **corridorChance 写反/未消费**（旧实现恒 0；写反则深层爆炸） |
| B5 | 浅层十字占比 > 洞穴×2（42.0% vs 5.7%）；深层洞穴 > 十字（35.1% vs 18.2%）；深层洞穴 > 浅层洞穴 | 下标错位、曲线写反。阈值取自 CE 曲线本身的形状（D17 十字仍有 29%），避免忠实实现假红 |
| B6 | D1 work grid 上入口房整臂全长（横臂 y=24 x∈[28,47] 20 格、竖臂 x=39 y∈[17,26]）+ 中心前厅/走廊全部=1 | 首房间形状任意偏（房型格一旦凿出不可被覆盖，断言稳定） |
| B7 | 决定性：同种子两次生成，attach/走廊/房型抽取/环门位/地形指纹逐位一致 | 混入非种子随机源 |
| B8 | 环门合计 > 基线 351×1.15（实测 491） | 增密未转化为环路收益 |
| B9 | IN_LOOP 绝对格数 > 5899×1.25（实测 16,614）；深水均值 <38.1 且 >0 | 环路收益回退；湖泊语义被波及 |

### 反向验证（强制条款；改坏 → 真实失败输出 → 还原，均已在生产代码上执行并回滚）

**RV1 深度曲线写反**（`corridorChance += 80·descent/100`）：

```
AssertionError: 浅层（D1-5）走廊房均值=2.1——corridorChance 未消费或曲线写平:
expected 2.12 to be greater than 4
Tests: 1 failed | 13 skipped
```

**RV2 首房间未固定为入口房**（注释掉 depth-1 清零）：

```
AssertionError: 首房间房型违反 CE 深度剖面：
seed424242/D1 首房间=6
seed777/D1 首房间=3
seed20260913/D1 首房间=6
seed31337/D1 首房间=6
seed20260916/D1 首房间=0: expected [...] to deeply equal []
```

**RV3 maxRoomCount 回退 15**：

```
AssertionError: 单层 attach 峰值=15，未超过旧实现的硬顶 14+1——maxRoomCount=35 未生效:
expected 15 to be greater than 19
```

三处均已还原，还原后 c_1 套件 14/14 绿。

## 六、门禁（"其余全绿"与"哪几条红、为什么"分开写）

### 绿

- `npm run build`：**绿**（vue-tsc -b + vite build 通过；chunk >500kB 警告为既有）。
- 本轮新增 c_1 套件 14/14 绿。
- p1_29 的**湖泊阶段**断言（15 种子 × D1-D26 全连通）绿——湖泊闸门合同未破。
- c_0 的 A1/A2-A6/B1/B2/B4/C1/C2/D1/E1/B3/B4 等 13/14 条绿（含门位契约、生产锚定、
  真环边、IN_LOOP 只标非阻挡格、safety map 集成）。
- monster_stats_effect（D1 前厅加宽后恢复）、p1_29 AD1-AD3、blueprint_center a)/b)、
  p4_7/p4_8/p4_10/p2_*/horde 等其余 47 个文件绿。

### 红（确定性 6 条，三次全量跑复现一致）

| 失败 | 是否豁免 | 原因与证据 |
|---|---|---|
| `generation_baseline`（4 seed 指纹/怪物/物品全偏离） | **是**（任务书预期内） | C-1 移动 RNG 流，全部地图改变。**未刷新**，等验收方授权重捕获。 |
| `p1_26`「上楼梯能走到下楼梯」断言"恰好 1 层" | **是**（任务书第 6 条预留） | 实测坏层 4：777/D10（588/802 可达）、777/D21（762/787）、20260916/D12（**19/936**）、20260916/D24（716/887）。p1_29 的**湖泊阶段**断言全绿 → 切割者全部是机器阶段（LOCKED_DOOR/特征水深水，即 P1-33 已知缺陷）：地图增密后 BlueprintEngine 可落位点变多，同一缺陷命中率上升。坏层**集合**已随 RNG 流移动（任务书：如实报告、不改常量、由验收方裁决）。 |
| `p1_29` 端到端坏层集合（钉死 `['1/D12','20260916/D23']`） | **是**（同上） | 新集合（10 种子）：`20260915/D3、20260916/D12、20260916/D24、42/D12、777/D10、777/D21、999/D18`——7 层，与 p1_26 的 4 层为同口径的超集（p1_29 多 5 个种子），成因同上，全部机器阶段。 |
| `p1_26`「每层可走格占比 ≤40%」 | **否**，见 §七-1 | 58/130 层落在 40.2%~46.6%。 |
| `c_0 C3`「单层割点率峰值 <8%」 | **否**，见 §七-2 | 实测峰值 9.7%（均值断言 <5% 仍绿）。 |
| `blueprint_center c)`「center 宝藏非空转护栏」 | **否**，见 §七-3 | treasuresAtCenter=0（违例断言本体为空、b) 的 center 可通行断言绿）。 |

### 红（偶发 2 条，非确定性）

| 失败 | 现象 | 根因 |
|---|---|---|
| `p4_9 T2`（-40 vs -30） | 文件级 6 连跑 4 红 2 绿，全量跑 3 次中 2 红 | **既有测试隔离缺陷被 C-1 放大**，完整证据链见 §七-4。 |
| `invented_content_pool` D2 扫描 | 全量跑 1/3 次红；单跑 3/3 绿 | 单次偶发，与全量并行负载相关（本项目 vite.config.ts 注释记载过三次同类假失败）。未复现第二例，建议验收方门禁时关注。 |

## 七、与预设不符之处（只列不修；含任务书与既有代码的错误）

1. **`p1_26` 的可走格上限（≤40%）与 CE 忠实密度冲突**。实测 58/130 层 40.2%~46.6%
   （峰值 20260916/D23 = 46.6%）。这不是生成器失灵：CE 同款剖面/算法/画布下，深层单个
   大洞窟（50×20 最小生成尺寸）自身就占画布 43%，浅层多房+走廊的地板占比同样 30%+。
   该上限是 P1-26 时代基于旧稀疏生成器（7.8%~22.5%）标定的"留 2 倍余量"。**修法属于
   p1_26 常量修订（含 fixture note），不在本轮边界内**，请验收方裁决：要么按 CE 密度
   放宽上限（建议 0.55~0.6 并记录原因），要么明确接受 Phase C 期间该条持续红。
   下限 3% 未受影响（最疏层 ~28%）。

2. **`c_0 C3` 的单层割点率阈值（<8%）被机器阶段缺陷击穿**。峰值层 9.7%。割点集中在
   机器锁门切断的走廊段——与 §六 p1_26/p1_29 的坏层**同根因**（P1-33 待修）：增密让
   机器落位点变多，缺陷暴露率上升。C-0 自身的 A6/C1/C2（新开门数锚定、真环边、
   树状对照）全部仍绿，说明 addLoops 机制未被波及。裁决建议：P1-33 修复前把 8% 上限
   与坏层集合一样显式留痕，或授权随 P1-33 一并收敛。

3. **`blueprint_center c)` 的非空转护栏建立在坐标巧合上，且其判据集合里有两类"永不可能"
   的宝藏**。解剖（全部既有代码，与本轮无关）：
   - populateLevel 的机器宝藏 50% 分支 spawnScroll(`'scroll_of_enchanting'`)——
     `consumables.json` 里只有 `scroll_of_enchantment`（无 "ing"）→ `spawnScroll` 恒返回
     null，**该分支从未产出过物品**（历史数据键错误）；
   - 另 50% 分支从 `genWands` 抽取，但 `isCenterTreasure` 钉死的是 `wand_of_fire`——
     该杖已被 D2 决策打上 `excludeFromGeneration: true` 退出生成池 → 抽中也不计入；
   - `potion_of_life`/`ring_*`/`charm_*` 走 trapVault/altar 路径，落点是 vault.center/
     altar 格，与 machine center 重合纯属不同生成器间的坐标巧合。C-1 移动 RNG 流后
     78 层扫描内巧合归零 → 护栏红。**本体断言（宝藏落格可通行）仍绿**，且 b) 已独立
     钉住"所有 machine center 可通行"。修复需改该测试或补数据键，均在边界外。

4. **`p4_9 T2` 的间歇失败是既有"test 模式 loopMap 陈旧"缺陷，被 C-1 的环路增密放大**。
   证据链：① `Game` 构造器先以**时间种子**跑一局普通模式 startNewGame，其
   `generateDepth` 末尾置 `this.loopMap = analyzeLoopMap(grid)`（Game.ts:674）；
   ② 测试的 `startNewGame({seed, mode:'test'})` 走 test 分支**提前 return**（Game.ts:592-600），
   **不重算 loopMap** → 留下时间种子那局地牢的残留（实测某秒残留 40 个 IN_LOOP 格）；
   ③ T2/T1/T7 在绝对坐标上筑竞技场后调 `updateSafetyMap()`，isInLoop 读到残留标记时
   值恰好差 −10（-40 = -30−10，与实捕获输出吻合）。C-0 时代残留环少、竞技场 rarely
   被击中；C-1 环路格 2.8 倍后命中率升至 ~50%，且随进程启动的墙钟秒（时间种子）抖动。
   **修法**：test 分支补 `this.loopMap = analyzeLoopMap(this.grid)`，或 p4_9 测试自置
   `game.loopMap = emptyLoopMap()`——Game.ts 与该测试都在本轮禁区，不动。

5. **任务书转述与 CE 的一处分歧（授权反驳条款）**：任务书必做 #2 末尾括注"例如下标 6、7
   对应的（房型缺失）"——实测 web 的下标 6（CAVERN）**有**实现（尺寸不符 CE，已对齐），
   真正缺的是 1/4/7。另：任务书说 `corridorChance 从 90 降到 10`，CE 基准 10 + 80·浅层
   修正，D1=90、D26=10，两端吻合，无异议。`dungeonProfileCatalog` 在 **Globals.c:934**
   而非任务书速查表暗示的任何位置（速查表本身没写它的位置，已补记 §二）。

6. **旧实现的三处"名同实异"**（本轮纠正，供归档）：① `corridorChance` 字段从被引入起
   就无任何消费点；② attachRooms 的 `roomsBuilt=1` 起步把首房间计入 maxRooms=15；
   ③ 门位落位是 `rand_percent(40)` 门 + 50% 开门（OPEN_DOOR），CE 是 60% 关门/40% 地板、
   生成期不存在开着的门（OPEN_DOOR 属运行态）。本轮统一为 CE 的 60% 规则。

7. **IN_LOOP 占比口径**：验收方预期"IN_LOOP 点亮比例显著上升"——实测占比 13.9%→14.2%
   基本持平（分母稀释），绝对格数 +182%。若验收方以占比为准，则本轮的环路收益结论
   应表述为"环门 +40%、IN_LOOP 格数 2.8 倍、占比持平"；测试 B9 已按绝对格数断言并在
   注释中说明口径取舍理由。

## 八、给验收方的裁决请求

1. `generation_baseline.json` 重捕获授权（任务书已预告必然变红，未刷新）。
2. `p1_26` 可走格上限（§七-1）与 `c_0 C3` 峰值阈值（§七-2）的处置。
3. `p1_26`/`p1_29` 坏层集合常量的更新授权（新集合见 §六；理想修复在 P1-33）。
4. `p4_9` 测试隔离缺陷与 `blueprint_center c)` 护栏（§七-3/4）的修复排期（均在禁区）。
5. `scroll_of_enchanting` 数据键错误是否单独立一轮（一行数据修复 + 一处调用点改名）。
