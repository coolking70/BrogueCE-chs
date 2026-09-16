# F-0：火与气体的现状测绘报告

> 2026-09-16。纯测量轮，零生产代码改动。CE 源码以 `BrogueCE-master/src/brogue/` 为准
> （下文 `Globals.c` / `Time.c` 等均指该目录）。web 侧路径省略 `src/` 前缀。
> 读者是 F-1 / F-2 的出题人：本文按"拿着它就能直接写任务书"的标准写。

---

## 0. 结论摘要

1. **任务书给的全部数字核实无误**：`isBurning` 非测试引用 **33 处**、`Gas.ts` **288 行**、
   CE `T_IS_FIRE` 地形 **10 种**、GAS 层 DF **24 条**。
2. **`GasType.FIRE` "死枚举"需要修正为一个更糟的事实**：它零读者成立，
   但有**一个死写者**——`Game.ts:2872`（`creeping_death` 药水）往气网写入
   `type=1, density=100` 的气体：不渲染、无效果，但**占格、参与扩散、
   并按 `addGas` 混合规则挡住后到的真气**。交接文档没记这个写者。
3. **web 现行游戏里火与气体几乎从不自然发生**：5 种子 × 200 回合真实推进，
   点火 0 次、气体事件 0 次（§4.3）。防火/毒气陷阱玩家不踩、bloat 不死于视野、
   火只在外力（药水/杖/陷阱）下出现。F-1 的"逐位不变"门禁在自然曲线上是
   平凡满足的，**真正的门禁必须靠 §4 的定向注入实验**。
4. **POISON 与 CONFUSION 在 web 的消散率相同（都是 2/回合）**，实测扩散曲线逐位相同；
   CE 则是 SLOW(20%)/QUICK(50%) 二分且每回合跑两遍。这是 §5.3"两边都有但不同"的典型。
5. **CREEPING_DEATH 是 web 自创**（CE 无此气体），且实测 10 点/回合无视密度阈值，
   起始角色 2 回合致死——D2 口径下它应退出实际游戏。
6. **发现一处既有断线（只登记不修）**：`resist_fire` 药水授予的免疫键是
   `'burning'`（`Game.ts:2876`，`as any` 强塞），而火伤分支查的是
   `hasStatus('immune_fire')`（`Game.ts:6117`），`Creature.hasStatus`
   （`Creature.ts:124-126`）只读 `statusDurations`、从不读 `temporaryImmunities`
   ——**喝抗火药水对火焰伤害无效**。
7. **CE 火地形全部落 SURFACE 层**（§3.2 的 10 条火 DF 无一例外），与 web 草地同层；
   CE 靠 drawPriority（火 10 < 草 60）解决同层竞争，web 的 C-4a 四层模型已具备
   该机制。F-1 落地形**不需要**动 GAS 层（那是 G 轮的事），这缩小了 F-1 的爆炸半径。
8. **web 的 C-4c 已经把 CE 的 `CAUGHT_FIRE_THIS_TURN` 记账位镜像好了**
   （`DungeonFeature.ts:338` → `Game.ts:5463-5471` `pendingCaughtFireCells`），
   只是火侧没有消费者。F-1 接火段时这块底座是现成的。
9. **每回合两次 `updateVolumetricMedia`（Time.c:1615-1616）之谜**：CE 唯一线索是
   `Time.c:1606` 注释 `// update gases twice`，且**仅当场上存在气体时才跑**
   （Time.c:1600-1613 先探测）。机制解释（本文推断，CE 无文字）：一次调用=一轮
   8 邻体积均分扩散，两轮=气体每回合推进约 2 格、消散也×2。web 是每玩家回合
   **1** 次（`objectiveTimeBlock` → `Game.ts:5483`）。
10. **拆轮建议（§5.4，含对验收方拆法的一处反驳）**：F-1/F-2 方向正确，但
    F-2 必须内部再分 **F-2a（火机制）/ F-2b（气机制）两刀**；气体不必单独走
    G-0（本文 §2/§4 就是 G-0 的产出）。

---

## 一、`isBurning` 的 33 处引用：每一处在问什么

逐处清单（文件:行号，语义，CE 对应物）。"类别"见文末归类。

| # | 位置 | 代码/注释 | 在问什么 | CE 对应物 |
|---|---|---|---|---|
| 1 | `components/GameCanvas.vue:363` | 代码 | 渲染：这格在烧 → 字形 `*` 橙色红底 | T_IS_FIRE 地形字形成像 + FIRE_LIGHT 光照 |
| 2 | `GameCanvas.vue:373` | 代码 | 烧着的格子上毒气不画字形（背景色保留） | 同上（CE 无此压制逻辑，靠 drawPriority） |
| 3 | `GameCanvas.vue:376` | 代码 | 同上（STEAM） | 同上 |
| 4 | `GameCanvas.vue:379` | 代码 | 同上（CONFUSION） | 同上 |
| 5 | `GameCanvas.vue:382` | 代码 | 同上（CREEPING_DEATH） | 同上 |
| 6 | `Core/Game.ts:208` | 代码 | 存档接口字段声明 `isBurning: boolean` | CE 存的是 layers[]（火本身就是层内地形） |
| 7 | `Game.ts:1144` | 代码 | `entryQualifiesForPlacement`：金库/机器落位拒绝燃烧格 | `T_PATHING_BLOCKER ⊃ T_IS_FIRE`（Rogue.h:1948）→ spawnDungeonFeature 的 blocking 判定 |
| 8 | `Game.ts:5823` | 代码 | 存档写入 `isBurning/burnDuration` | 同 #6 |
| 9 | `Game.ts:5941` | 代码 | 读档恢复 `isBurning/burnDuration` | 同 #6 |
| 10 | `Game.ts:6117` | 代码 | `applyEnvironmentalEffects`：`cell.isBurning && 非火免 && 非无敌` → **固定 2 伤害** | 两段模型：踩 T_IS_FIRE → `exposeCreatureToFire`（Time.c:527-528→28-60）上 STATUS_BURNING；燃烧状态每回合 `rand_range(1,3)`（Time.c:2581-2592） |
| 11 | `Game.ts:6352` | 代码 | 测试室基线还原时清 `isBurning/burnDuration` | CE 无"基线还原"概念（最近亲：DF 重铺时层被覆盖） |
| 12 | `Map/SafetyMap.ts:161` | 代码 | 安全图：燃烧格怪物禁入、玩家非火免禁入 | CE Time.c:1869-1875（T_IS_FIRE 分支，方向正常那条） |
| 13 | `Map/WaypointMap.ts:248` | 代码 | 航点图：燃烧格 = FORBIDDEN | T_PATHING_BLOCKER（populateGenericCostMap 口径，深水/岩浆/火一律禁入） |
| 14 | `Map/LoopMap.ts:206` | 代码 | `blocksPathing`：燃烧格阻挡（IN_LOOP 环分析） | CE analyzeMap：`T_PATHING_BLOCKER && !TM_IS_SECRET`（Architect.c:200-212） |
| 15 | `Map/TerrainCatalog.ts:252` | 注释 | BOG 条目注释："复燃逻辑由 isBurning 承担" | — |
| 16 | `Map/Promotion.ts:13` | 注释 | "web 火焰由 Gas.ts 的 isBurning 系统承担" | — |
| 17 | `Map/Promotion.ts:78` | 注释 | "isBurning 系统；接 CE 火地形需……" | — |
| 18 | `Map/Grid.ts:312` | 代码 | 字段声明 `public isBurning: boolean = false` | — |
| 19 | `Environment/Gas.ts:60-61` | 代码 | `ignite()`：草/灌木/沼泽点燃，置 `isBurning=true` + `burnDuration=randRange(4,7)` | CE：可燃层被 `promoteTile(useFireDF)` 替换成火地形（Time.c:1357-1368），无时长概念 |
| 20 | `Gas.ts:65-66` | 代码 | `ignite()`：DOOR 点燃，`randRange(2,4)` | 同上（CE 门 chanceToIgnite=50，fireType=DF_EMBERS，promoteType=DF_OPEN_DOOR——门烧了先变开） |
| 21 | `Gas.ts:80` | 注释 | `igniteForced` 文档 | — |
| 22 | `Gas.ts:84` | 注释 | updateFires 行为说明 | — |
| 23 | `Gas.ts:89` | 注释 | 烧尽分支说明 | — |
| 24 | `Gas.ts:94` | 注释 | applyEnvironmentalEffects 说明 | — |
| 25 | `Gas.ts:95` | 注释 | 同上 | — |
| 26 | `Gas.ts:109-110` | 代码 | `igniteForced`：无视地形白名单强制点燃（bloat 爆炸用） | CE 对应物是 `exposeTileToFire(x,y,alwaysIgnite=true)`（Time.c:539 弹道、Items.c:5217/5445 BF_FIERY） |
| 27 | `Gas.ts:128` | 代码 | updateFires：焦土再生守卫 `!cell.isBurning` | CE 无焦土再生机制 |
| 28 | `Gas.ts:134` | 代码 | updateFires 主循环守卫 `if (!cell.isBurning) continue` | CE 火段扫的是 T_IS_FIRE 地形（Time.c:1688-1690） |
| 29 | `Gas.ts:139` | 代码 | `burnDuration<=0` → 熄灭（可燃地形变 CHARRED_FLOOR） | CE 火地形按 promoteChance 衰老（PLAIN_FIRE 5%/回合 → DF_EMBERS） |
| 30 | `Gas.ts:178` | 代码 | 蔓延守卫：`isFlammable && !ncell.isBurning`（40% 掷骰） | CE：4 邻各一次 `exposeTileToFire(false)`，按 chanceToIgnite 掷骰，每格每回合最多 12 次暴露（Time.c:1691-1699、1306-1312） |

### 归类（F-1 的直接输入）

- **A 类｜其实在问"这格是不是火地形"（CE 等价 `T_IS_FIRE`），F-1 应改成查地形/旗标**：
  #1-5（渲染）、#7（落位）、#12、#13、#14（三张寻路图）——共 **9 处**。
- **B 类｜web 燃烧状态机本体（写/推进/熄灭），CE 没有对应物、F-1 保持为火地形的镜像**：
  #19、#20、#26、#27、#28、#29、#30、#11——共 **8 处**（全在 Gas.ts + Game.ts:6352）。
- **C 类｜"格上生物被烧"**：#10——**1 处**（CE 对应物是两段模型，见 §5.3）。
- **D 类｜持久化**：#6、#8、#9——**3 处**。
- **E 类｜字段声明**：#18——**1 处**。
- **F 类｜纯注释（零行为）**：#15、#16、#17、#21、#22、#23、#24、#25——**8 处**。

9+8+1+3+1+8 = 33，与 grep 计数吻合。
**F-1 的最小改动面 = A 类 9 处读者 + B 类写点改成双写（isBurning ↔ 地形层）+ D/E 随存储形态走；C 类 F-1 不动（固定 2 伤害保留到 F-2a）。**

---

## 二、`Gas.ts`（288 行）逐功能对照 CE

### 2.1 GasType 六值对照

| web（Gas.ts:9-16） | web 行为（行号） | CE 对应物（tile 行号均在 Globals.c） | 差异要点 |
|---|---|---|---|
| `NONE=0` | 空气 | GAS 层 NOTHING | 一致 |
| `FIRE=1` | **零读者**；唯一写者 `Game.ts:2872`（见 2.2） | GAS_FIRE 地形（Globals.c:495） | web 的 FIRE 型气体不渲染不伤人；CE 的 GAS_FIRE 是真火地形 |
| `POISON=2` | `addGas` 入口众多（药水 Game.ts:2857、陷阱 :6423(80)、bloat 死亡 :5222(100)、怪物施法 :4042(100)）；效果：`density>0` 即上 `poisoned(5)` 状态（Game.ts:6142-6149），**不直接扣血** | POISON_GAS（:502）：`T_CAUSES_DAMAGE` 每百 tick `max(1, maxHP/15)` 比例伤害（Time.c:592-640）；`TM_GAS_DISSIPATES`（每次更新 20% 概率 −1）；可燃（chanceToIgnite=100，烧成 GAS_FIRE） | 伤害模型不同（状态 vs 比例伤害）；消散速率见 2.3 |
| `CONFUSION=3` | `density>20` 上状态：玩家 `hallucinating(6)` / 怪 `confused(6)`（Game.ts:6150-6158） | CONFUSION_GAS（:503）：`T_CAUSES_CONFUSION` → STATUS_CONFUSED=max(,25)（Time.c:443-470），**无密度阈值**；`TM_GAS_DISSIPATES_QUICKLY`（50%）；可燃 | web 阈值 20 是自创；状态时长 6 vs 25；**web 消散率用默认 2，与 POISON 相同——CE 是 QUICK 档** |
| `STEAM=4` | 产生：燃烧格 4/8 邻是水 → 30% `addGas(STEAM,50)`（Gas.ts:170-174）；效果：`density>20` 扣 1 血（Game.ts:6159-6166）；消散 5/回合 | STEAM（:508）：`T_CAUSES_DAMAGE` 比例伤害同毒气；`QUICKLY`；**不可燃**（ign%=0，无 T_IS_FLAMMABLE）。CE 的产生机制不同：深水/洪水/藻类湖被"点燃"（chanceToIgnite=100，fireType=DF_STEAM_ACCUMULATION，单点 325 体积/次）或 DF_STEAM_PUFF（325） | 产生路径、伤害模型、消散速率全不同 |
| `CREEPING_DEATH=5` | `creeping_death` 药水（Game.ts:2871-2873，写的是 **type=1**！见 2.2）；效果：`density>0` 即扣 **10 血**、无阈值（Game.ts:6167-6174）；消散 1/回合；扩散 25%/邻（Gas.ts:255）；不往草/灌木/沼泽上爬（Gas.ts:244-248） | **CE 无对应物**。CE 没有 creeping death 气体；最接近的视觉近亲是 STENCH_SMOKE_GAS（:505，只恶心），机制上无任何对应 | **web 自创（D2）**。10/回合实测 2 回合杀死起始角色（§4.6） |

**CE 有而 web 枚举里没有的气体**（F/G 轮要对齐的）：
ROT_GAS（:504，恶心 20，QUICKLY，可燃）、STENCH_SMOKE_GAS（:505，恶心，不可燃）、
PARALYSIS_GAS（:506，麻痹 20，QUICKLY，可燃）、METHANE_GAS（:507，**无消散旗标
（不自己散）**、TM_EXPLOSIVE_PROMOTE 爆轰链、promoteType=DF_EXPLOSION_FIRE）、
DARKNESS_CLOUD（:509，**零旗标零消散**，永久黑暗）、HEALING_CLOUD（:510，
T_CAUSES_HEALING 比例回血，QUICKLY）。

### 2.2 `GasType.FIRE` 死枚举复核（交接文档结论需要修正）

- **零读者**：仍然成立。全库（非测试）没有任何分支读 `type === GasType.FIRE`：
  渲染（GameCanvas.vue:367-384 只画 2/4/3/5）、效果（Game.ts:6141-6174 只处理 2/3/4/5）。
- **但有一个死写者**：`Game.ts:2871-2873`，`creeping_death` 药水：
  ```ts
  this.environment.addGas(this.player.loc.x, this.player.loc.y, 1, 100);
  // Will add actual caustic gas later
  ```
  `1 === GasType.FIRE`。注释自认是占位。后果：喝下药水后，一圈**不可见、无害**
  的气体以 100 密度入场，经 `updateGases` 正常扩散（Gas.ts:233 对任意 type 密度>10
  都扩散），并经 `addGas` 混合规则（Gas.ts:47-51，`amount > density` 才顶替）
  **挡住同格后到的毒气/ confusion**。玩家买了药水，得到的是一团"幽灵气"。
- 处置建议：登记进 F-2b（或更早的 D2 清理），**F-1 不动**（行为变更）。

### 2.3 扩散/消散算法：web `updateGases`（Gas.ts:208-287）vs CE `updateVolumetricMedia`（Time.c:1383-1479）

| 维度 | CE | web | 差异 |
|---|---|---|---|
| 调用次数 | 每玩家回合 **2 次**，且**仅当场上存在气体**（Time.c:1600-1616：先全场探测 `layers[GAS]` 非空才跑；注释 `// update gases twice`） | 每玩家回合 **1 次**（Game.ts:5483，无条件跑） | 速度差 ×2；web 的无条件空调越也是每回合 O(DCOLS×DROWS) 两次全图拷贝（Gas.ts:209-215 先整网深拷贝） |
| 邻域 | **8 邻**（nbDirs） | **4 邻**（Gas.ts:234） | 对角传播缺失 |
| 守恒 | 体积守恒：`sum/(1+8邻)` 均分 + `rand_range(0, numSpaces-1) < sum%numSpaces` **随机舍入**（Time.c:1408-1410）；chasm/trapdoor 格 `numSpaces++` 让气体逃出层外（Time.c:1404-1406） | 无守恒语义：`15%/邻`（CREEPING_DEATH 25%）从源头扣、加到邻居（Gas.ts:252-260），clamp 100 | 量纲不同导致"守恒"含义不同（见 2.4） |
| 阻挡 | `T_OBSTRUCTS_GAS` 旗标（门挡气但门可透视）；"存不住气的格子里的气瞬时散给能存的邻居"（Time.c:1446-1474） | `isOpaque`（Gas.ts:241）——**用视觉阻挡近似气体阻挡**：凡 web 里 isOpaque=true 的地形都被当成挡气。与 CE 旗标不一致的地形（例如高草 FOLIAGE 挡视不挡气、 SECRET_DOOR）行为会漂移 | 需要按旗标表对齐 |
| 类型竞争 | 若邻居体积更大且类型不同：本格**整体换型**为最高邻的类型；换型时若已有别的气，新体积压到 **3**（Time.c:1427-1431，注释：否则气体互动太疯） | `cell.density > neighbor.density + 20` 才顶替，顶替后邻居密度 = 实际扩散量（Gas.ts:261-267） | 完全不同的两种混液规则 |
| 消散 | `TM_GAS_DISSIPATES`：每次调用 20% 概率 −1；`TM_GAS_DISSIPATES_QUICKLY`：50% 概率 −1（Time.c:1437-1444）；methane/darkness **无旗标=永不自散** | 固定速率：默认 2/回合，STEAM 5，CREEPING_DEATH 1（Gas.ts:223-225）；**CONFUSION 落默认 2**（CE 属 QUICK 档）；任何气最终都会散光 | 消散谱系：CE 二档百分比 ×2 次/回合；web 三档定值 ×1 次/回合。**POISON 与 CONFUSION 在 web 完全同速率（实测曲线逐位相同，§4.5）** |
| 量纲 | `pmap.volume`：`unsigned short`（Rogue.h:1307，0–65535）；DF 生成时 `volume += feat->startProbability`（Architect.c:3383-3386）——**GAS 层 DF 的 startProbability 根本不是概率，是体积** | `density` 0–100 整数，`addGas` 饱和封顶（Gas.ts:44） | **不可直接对齐**。CE 常用体积：毒气云 1000、bloat 死亡 2000、dewar 20000、steam puff 325、methane puff 2、stench 50。若 G 轮保 0-100，CE 的随机舍入、体积守恒、>3 压制都会失真；建议 G 轮直接迁 CE 量纲（调用点折算一次） |

**"每回合两次"之谜的答案**（供 G 轮出题用）：CE 无文字说明，唯一线索是
`Time.c:1606` 注释。物理效果上，一次调用=一轮 8 邻均分，两轮=每回合气体推进
约 2 格（正方形边界外扩 2）、QUICK 档消散期望 −1/回合（2×50%）、SLOW 档 −0.4。
本文标记为**推断**，不是 CE 原文。

### 2.4 web `Gas.ts` 里 CE 没有的东西（D2 清单的气体半边）

- `GasType.CREEPING_DEATH` 整套（枚举值、扩散特例 25%、不爬草、1/回合消散、10 伤害、药水）。
- `addGas` 的混液规则本体（CE 没有 addGas 这个概念；气体只能经 DF / 点燃进层）。
- 密度阈值 `>20` 才上状态（CONFUSION/STEAM）。
- `updateFires` 里"烧到水冒蒸汽"（Gas.ts:169-174）——CE 的蒸汽来自水体自身
  被点燃（DF_STEAM_ACCUMULATION），不是火贴水。

---

## 三、CE 侧清单

### 3.1 十种 `T_IS_FIRE` 地形（Globals.c，已核实数目）

字段按 `floorTileType` 位置序解码（Rogue.h:1905-1921）：
`displayChar, foreColor, backColor, drawPriority, chanceToIgnite, fireType,
discoverType, promoteType, promoteChance, glowLight, flags, mechFlags`。

| tile | 行 | drawPrio | chanceToIgnite | fireType | promoteType | promoteChance | glowLight | flags 要点 |
|---|---|---|---|---|---|---|---|---|
| PILOT_LIGHT | 343 | 0 | 0 | DF_PLAIN_FIRE | — | 0 | TORCH_LIGHT | `T_OBSTRUCTS_EVERYTHING`；墙脚火把 |
| PLAIN_FIRE | 492 | 10 | 0 | — | DF_EMBERS | **500 (5%/回合)** | FIRE_LIGHT | `TM_VANISHES_UPON_PROMOTION`；通用火焰 |
| BRIMSTONE_FIRE | 493 | 10 | 0 | — | NOTHING(消失) | **2500** | BRIMSTONE_FIRE_LIGHT | 硫火，25%/回合自熄 |
| FLAMEDANCER_FIRE | 494 | 10 | 0 | — | DF_OBSIDIAN | **5000** | FIRE_LIGHT | 火舞者余焰，50%/回合凝固成黑曜石 |
| GAS_FIRE | 495 | 10 | 0 | — | NOTHING(消失) | **8000** | FIRE_LIGHT | 燃气，80%/回合自熄 |
| GAS_EXPLOSION | 496 | 10 | 0 | — | NOTHING(消失) | **10000** | EXPLOSION_LIGHT | `T_CAUSES_EXPLOSIVE_DAMAGE`：命中即 `max(15-20, 50%maxHP)` 且同格 5 回合内不重复（Rogue.h:1944） |
| DART_EXPLOSION | 497 | 10 | 0 | — | NOTHING(消失) | 10000 | INCENDIARY_DART_LIGHT | 燃烧镖 |
| ITEM_FIRE | 498 | 10 | 0 | — | DF_EMBERS | 3000 | FIRE_LIGHT | 物品火焰 |
| CREATURE_FIRE | 499 | 10 | 0 | — | DF_EMBERS | 3000 | FIRE_LIGHT | 生物火焰 |
| BRAZIER | 573 | 0 | 0 | DF_PLAIN_FIRE | — | 0 | BURNING_CREATURE_LIGHT | `T_OBSTRUCTS_PASSABILITY\|T_OBSTRUCTS_ITEMS`；火盆 |

要点：**火地形自身的 chanceToIgnite 全为 0**——点火概率住在**可燃地形**一侧
（§3.4）。火地形靠 promoteChance 衰老：每回合 `rand_range(0,10000) < promoteChance`
则 `promoteTile`（Time.c:1643-1645）。CE 的"火会自己灭"是概率衰老，不是倒计时。
**十种火 DF 无一例外全部落 SURFACE 层**（见下表）。

### 3.2 生成火地形的 DF（枚举名 ↔ Globals.c 行，条目号=目录第 N 个 `{` 条目）

| DF | 行 | 条目 | 内容 |
|---|---|---|---|
| DF_BLOAT_EXPLOSION | 654 | v=35 | `{GAS_EXPLOSION, SURFACE, 350, 100}` — 起始概率 350、每格递减 100 → 半径 3-4 圈 |
| DF_MUTATION_EXPLOSION | 659 | v=38 | 同上，带文案 |
| DF_PLAIN_FIRE | 740 | v=100 | `{PLAIN_FIRE, SURFACE, 0, 0}` — 单点，不铺 |
| DF_GAS_FIRE | 741 | v=101 | `{GAS_FIRE, SURFACE, 0, 0}` — 气体被点着时用 |
| DF_EXPLOSION_FIRE | 742 | v=102 | `{GAS_EXPLOSION, SURFACE, 60, 17}` — 甲烷爆轰铺开（半径 ~4） |
| DF_FLAMETHROWER | 746 | v=106 | `{PLAIN_FIRE, SURFACE, 100, 37}` — 火焰喷射陷阱 |
| DF_INCINERATION_POTION | 780 | v=133 | `{PLAIN_FIRE, SURFACE, 100, 37, EXPLOSION_FLARE_LIGHT}` — 焚化药水 |
| DF_ARMOR_IMMOLATION | 786 | v=137 | `{PLAIN_FIRE, SURFACE, 100, 45, radius 3, yellow}` — 护甲自燃诅咒 |
| DF_COFFIN_BURNS | 808 | v=149 | `{PLAIN_FIRE, SURFACE, 0, 0, DFF_ACTIVATE_DORMANT_MONSTER, subDF DF_EMBERS_PATCH}` |
| DF_WOODEN_BARRICADE_BURN | 821 | v=156 | `{PLAIN_FIRE, SURFACE, 0, 0}` — 路障烧毁 |

（另：STENCH_SMOKE_GAS 的两条 DF 以 subsequentDF 分别指向 DF_PLAIN_FIRE / DF_EMBERS，
干草堆燃烧 → 臭烟 → 落火。）

### 3.3 二十四条 GAS 层 DF（已核实数目；对 GAS 层 DF，`startProbability` 直接累加进 `pmap.volume`，`probabilityDecrement` 无效）

| DF（枚举值） | Globals.c 行 | 条目 | tile | startProbability (=体积) | decr | 附加 |
|---|---|---|---|---|---|---|
| DF_ROT_GAS_BLOOD (32) | 649 | | ROT_GAS | 12 | 0 | 腐肉血气 |
| DF_BLOAT_DEATH (34) | 653 | | POISON_GAS | 2000 | 0 | web 已接（Game.ts:5222，密度 100 近似） |
| DF_REPEL_CREATURES (40) | 663 | | NOTHING | 0 | 0 | `DFF_EVACUATE_CREATURES_FIRST` |
| DF_ROT_GAS_PUFF (41) | 664 | | ROT_GAS | 15 | 0 | |
| DF_STEAM_PUFF (42) | 665 | | STEAM | 325 | 0 | |
| DF_STEAM_ACCUMULATION (43) | 666 | | STEAM | 15 | 0 | 深水被点燃的持续蒸汽 |
| DF_METHANE_GAS_PUFF (44) | 667 | | METHANE_GAS | 2 | 0 | 微量沼气 |
| DF_BLOODFLOWER_POD_BURST (70) | 701 | | HEALING_CLOUD | 350 | 0 | |
| DF_DEWAR_CAUSTIC (71) | 704 | | POISON_GAS | 20000 | 0 | subDF DF_DEWAR_GLASS，半径 4 |
| DF_DEWAR_CONFUSION (72) | 705 | | CONFUSION_GAS | 20000 | 0 | 同上 |
| DF_DEWAR_PARALYSIS (73) | 706 | | PARALYSIS_GAS | 20000 | 0 | 同上 |
| DF_DEWAR_METHANE (74) | 707 | | METHANE_GAS | 20000 | 0 | 同上 |
| DF_POISON_GAS_CLOUD (125) | 770 | | POISON_GAS | 1000 | 0 | 毒气陷阱（web 已接：Game.ts:6423 密度 80 近似） |
| DF_CONFUSION_GAS_TRAP_CLOUD (126) | 771 | | CONFUSION_GAS | 300 | 0 | **web 无迷惑气体陷阱**（trapType 只有 fire/poison_gas，Game.ts:724）；最近亲是怪物药水溅射 :4044（密度 100） |
| DF_METHANE_GAS_ARMAGEDDON (129) | 774 | | METHANE_GAS | 10000 | 0 | 注释 `// debugging toy` |
| DF_POISON_GAS_CLOUD_POTION (130) | 777 | | POISON_GAS | 1000 | 0 | 半径 4 |
| DF_PARALYSIS_GAS_CLOUD_POTION (131) | 778 | | PARALYSIS_GAS | 1000 | 0 | 半径 4 |
| DF_CONFUSION_GAS_CLOUD_POTION (132) | 779 | | CONFUSION_GAS | 1000 | 0 | 半径 4 |
| DF_DARKNESS_POTION (134) | 781 | | DARKNESS_CLOUD | 200 | 0 | |
| DF_VENT_SPEW_POISON_GAS (178) | 855 | | POISON_GAS | 25 | 0 | 机器毒气喷口每回合 |
| DF_VENT_SPEW_METHANE (181) | 860 | | METHANE_GAS | 60 | 0 | 机器沼气喷口每回合 |
| DF_PARALYSIS_VENT_SPEW (184) | 865 | | PARALYSIS_GAS | 350 | 0 | subDF DF_REVEAL_PARALYSIS_VENT_SILENTLY |
| DF_STENCH_BURN (217) | 930 | | STENCH_SMOKE_GAS | 50 | 0 | subDF DF_PLAIN_FIRE（干草→臭烟→火） |
| DF_STENCH_SMOLDER (218) | 931 | | STENCH_SMOKE_GAS | 50 | 0 | subDF DF_EMBERS |

web 对这 24 条的接线现状：**确认接了 2 条**（DF_BLOAT_DEATH → Game.ts:5222
密度 100；DF_POISON_GAS_CLOUD → 毒气陷阱 :6423 密度 80），**近似接了 2 条**
（DF_POISON_GAS_CLOUD_POTION → 玩家 poison_burst 药水 :2857 密度 70；
DF_CONFUSION_GAS_CLOUD_POTION → 仅怪物药水溅射 :4044 密度 100，玩家版只上
状态不产气）。另注：explosive bloat 接的 GAS_EXPLOSION 是 SURFACE 层 DF，
不在这 24 条内。密度全部按 0-100 口径近似。
**注意 Game.ts:5198 注释说"CE 的 2000 体积"只是 bloat 一条；
目录里最大的 dewar 是 20000**——折算表要在 G 轮一次定清。

### 3.4 可燃地形全表（`T_IS_FLAMMABLE`，点火概率 = chanceToIgnite，烧成 = fireType DF）

CE 侧"什么东西能烧、多容易烧、烧成什么"的完整清单（Globals.c 行号直标）：

| tile | 行 | ign% | fireType | 备注 |
|---|---|---|---|---|
| GRASS | 447 | 15 | DF_PLAIN_FIRE | |
| DEAD_GRASS | 448 | 40 | DF_PLAIN_FIRE | |
| GRAY_FUNGUS / LUMINESCENT_FUNGUS | 449/450 | 10 | DF_PLAIN_FIRE | |
| LICHEN | 451 | 50 | DF_PLAIN_FIRE | promoteType=DF_LICHEN_GROW(10000) |
| HAY | 452 | 50 | DF_STENCH_BURN | 干草→臭烟→火链 |
| TRAMPLED_FOLIAGE / FOLIAGE | 474/472 | 15 | DF_PLAIN_FIRE | |
| DEAD_FOLIAGE | 473 | 80 | DF_PLAIN_FIRE | |
| FUNGUS_FOREST / TRAMPLED_FUNGUS_FOREST | 475/476 | 15 | DF_PLAIN_FIRE | |
| SPIDERWEB | 470 | 100 | DF_PLAIN_FIRE | |
| NETTING | 471 | 40 | DF_PLAIN_FIRE | |
| CARPET | 325 | **0** | DF_EMBERS | 只吃 alwaysIgnite，自然烧不着 |
| DOOR | 328 | 50 | DF_EMBERS | promoteType=DF_OPEN_DOOR：门先被烧穿成开 |
| OPEN_DOOR | 329 | 50 | DF_EMBERS | |
| SECRET_DOOR | 330 | 50 | DF_EMBERS | 烧密门会暴露 |
| WOODEN_BARRICADE | 341 | 100 | DF_WOODEN_BARRICADE_BURN | |
| COFFIN_CLOSED / COFFIN_OPEN | 372/373 | 20 | DF_COFFIN_BURNS / DF_PLAIN_FIRE | 棺材里跳出怪 |
| MACHINE_METHANE_VENT | 400 | 15 | DF_EMBERS | promoteType=DF_VENT_SPEW_METHANE(5000) |
| DEWAR_*（4 种） | 406-409 | 20 | DF_DEWAR_* | 烧 dewar = 引爆 20000 体积气 |
| DEEP_WATER / FLOOD_WATER_DEEP | 413/445 | 100 | DF_STEAM_ACCUMULATION | **TM_EXTINGUISHES_FIRE**：水既是"可燃"（产蒸汽）又是灭火层 |
| DEEP_WATER_ALGAE_1/2 | 521/522 | 100 | DF_STEAM_ACCUMULATION | 同上，promoteChance 500/300（藻华轮替） |
| ICE_DEEP / ICE_DEEP_MELT / ICE_SHALLOW / ICE_SHALLOW_MELT | 435-438 | 100 | 融冰 DF | 火融冰 |
| BRIDGE / BRIDGE_FALLING / BRIDGE_EDGE | 428-430 | 50 | DF_BRIDGE_FIRE / DF_BRIDGE_FALL / DF_PLAIN_FIRE | 烧桥 |
| ACTIVE_BRIMSTONE | 425 | 100 | DF_INERT_BRIMSTONE | promoteChance=10；`T_SPONTANEOUSLY_IGNITES` |
| PUDDLE | 463 | 20 | — | promoteChance=100（烧干） |
| BLOODFLOWER_STALK / POD | 513/514 | 20 | DF_PLAIN_FIRE / DF_BLOODFLOWER_POD_BURST | |
| HAVEN_BEDROLL | 517 | 50 | DF_PLAIN_FIRE | |
| ANCIENT_SPIRIT_VINES | 525 | 100 | DF_PLAIN_FIRE | |
| POISON_GAS / CONFUSION_GAS / ROT_GAS / PARALYSIS_GAS / METHANE_GAS | 502-507 | 100 | DF_GAS_FIRE | **气体本身可燃**；甲烷 TM_EXPLOSIVE_PROMOTE |

web 侧现状（TerrainCatalog.ts，C-4a 已建旗标）：`T_IS_FLAMMABLE` 已标在
DOOR(:174)、OPEN_DOOR(:181)、WATER_DEEP(:195)、GRASS(:214 附近)、FOLIAGE(:220)、
BOG(:229，webOnly)、SECRET_DOOR(:278)、WEB(:311)、BRIDGE(:334)、BRIDGE_EDGE(:340)、
INERT_BRIMSTONE(:347，T_SPONTANEOUSLY_IGNITES)。**但 Gas.ts 的点燃/蔓延白名单
是硬编码的五地形（GRASS/FOLIAGE/BOG/DOOR/WEB），没有读这些旗标**——
`ignite()` 用四地形子集（Gas.ts:59,64），蔓延用五地形（Gas.ts:177）。
**注意不对称：WEB 能被蔓延点着、却不能被 `ignite()` 直接点着**——既有行为，登记。
且 `T_IS_FIRE` 旗标（TerrainCatalog.ts:41 定义）当前**没有任何地形携带**。

### 3.5 CE 机制要点（F-1/F-2 的语义基准）

**回合次序**（`updateEnvironment`，Time.c:1590-1710；由 `playerTurnEnded`
Time.c:2695 调用，每玩家回合一次）：

1. `monstersFall()`（悬空怪坠落）
2. 全图清 `exposedToFire = 0`
3. 若全场存在 GAS 层地形 → `updateVolumetricMedia()` ×**2**（Time.c:1600-1616）
4. 随机晋升两趟（promoteChance/10000 每回合；负值=邻接生长如草；
   `CAUGHT_FIRE_THIS_TURN` 抑制本回合晋升，Time.c:1619-1662）
5. 记账趟：清 `CAUGHT_FIRE_THIS_TURN`、压力板、`TM_PROMOTES_WITHOUT_KEY`（:1665-1686）
6. **火段**（:1688-1700）：每个 `T_IS_FIRE` 且未 `CAUGHT_FIRE_THIS_TURN` 的格，
   `exposeTileToFire(i,j,false)` + **4 个正交邻**各一次 `exposeTileToFire(...,false)`
7. `updateFloorItems()`

**web 对应**（`objectiveTimeBlock`，Game.ts:5441-5490）：次序已对齐
（C-4c 的晋升两趟 → updateFires → updateGases → applyEnvironmentalEffects），
差异在：火段不存在（isBurning 状态机自养自）、气体一次、
`exposedToFire` 概念不存在。

**`exposeTileToFire(x, y, alwaysIgnite)`**（Time.c:1306-1377）：
- 非 `T_IS_FLAMMABLE` 或 `exposedToFire >= 12` → 直接 false（**每格每回合最多
  12 次点火尝试**——8 邻全火 + 自身 = 9 次，封顶一般不触）
- `exposedToFire++`
- 选"最佳灭火层"：`TM_EXTINGUISHES_FIRE` 层中 drawPriority 最小者
- `ignitionChance` = 各可燃层中（GAS 层，或 drawPriority ≤ 灭火层优先级的层）
  最大的 `chanceToIgnite`
- `alwaysIgnite || rand_percent(ignitionChance)` → 点燃：**所有可燃层依次
  `promoteTile(x, y, layer, useFireDF=!explosivePromotion)`**；GAS 层可燃物
  （五种气体）只清 `volume` 不清层（Time.c:1364-1368 注释自认的怪癖，
  为了燃气烧起来好看）
- 甲烷：`TM_EXPLOSIVE_PROMOTE` 格点燃时数 8 邻的
  `T_IS_FIRE|T_OBSTRUCTS_GAS|TM_EXPLOSIVE_PROMOTE`，≥8 → `explosivePromotion`
  （爆轰链：promoteTile 用 fireType 而非 promoteType → METHANE_GAS 的
  fireType 是 DF_GAS_FIRE，promoteType 是 DF_EXPLOSION_FIRE——**普通点燃
  变小火，链式爆轰变爆炸圈**）

**`promoteTile`**（Time.c:1244-1290）：`useFireDF ? tile->fireType : tile->promoteType`；
`TM_VANISHES_UPON_PROMOTION` 先清层（DUNGEON→FLOOR，其余→NOTHING；GAS 层清
volume），再 spawn DF。**这就是 CE 火的全部"寿命模型"：没有倒计时，只有
"被消耗的可燃物 + 概率衰老的火地形"。**

**`CAUGHT_FIRE_THIS_TURN`**（Architect.c:3230-3237）：DF 把 T_IS_FIRE 地形画上
原本不是火的格时打标；本回合抑制该格晋升、抑制火段重复处理。
**web 的 C-4c 已镜像**：`DungeonFeature.ts:338` 收集 `caughtFireCells` →
`Game.ts:5463-5471` 存进 `pendingCaughtFireCells` 喂给 `runPromotionUpdate`。
火侧消费者 F-1 才需要接。

**生物侧**（`applyInstantTileEffectsToCreature` Time.c:119-560、渐变段 560-660）：
- 踩 T_IS_FIRE（:527-528）→ `exposeCreatureToFire`（:28-60）：豁免 =
  `MB_IS_DYING | STATUS_IMMUNE_TO_FIRE | MONST_INVULNERABLE | MB_SUBMERGED |
  （非悬浮 && 踩 TM_EXTINGUISHES_FIRE 格）`；上 STATUS_BURNING=max(,7)；
  web 的对应分支（Game.ts:6117）**没有** SUBMERGED/悬浮在水的豁免（P1-28 注释已登记）
- **燃烧生物点燃所踩的可燃非火格**（:530-543，`exposeTileToFire(...,true)`）——
  着火的怪自己就是移动火种；web 无此机制
- STATUS_BURNING 结算（玩家 :2581-2592，怪对称）：`rand_range(1,3)` 伤害，
  归零时 `extinguishFireOnCreature`
- 气体状态（Time.c:421-497）：恶心 → NAUSEOUS 20；混乱 → CONFUSED 25；
  麻痹 → PARALYZED 20（**无密度阈值、每回合 max() 刷新**）
- 气体伤害/回复（:592-655）：`max(1, maxHP/15 × ticks/100)`，按 maxHP 比例
  ——**巨怪的毒气/蒸汽伤害比小怪高**；web 全部是定值

**物品侧**：BF_FIERY 弹道终点 `exposeTileToFire(x,y,true)`（Items.c:5217 "burninate"、
:5445）；火地形上的物品会被烧毁（ITEM_FIRE 落点）。web 只有岩浆烧物品
（Game.ts:6192-6200）。

---

## 四、★ 行为基线测量（F-1 "逐位不变"门禁的依据）

### 4.1 测量口径（F-1 必须用同一套口径复测）

- 工具：临时 vitest 脚本 `src/test/zz_f0_probe.test.ts`（跑完已删，**全文见附录 A**，
  可原样恢复复跑）。
- 状态快照定义：每回合结束后收集
  `burning = ["x,y,burnDuration", …]`（升序）+ `gas = ["x,y,type,density", …]`
  （density>0，升序），拼成回合签名字符串。
- 环境：`src/test/harness.ts` 的 `createHeadlessGame(seed)`（headless，空 i18n，
  文案走 defaultValue——按项目常识这是预期 fallback）；玩家动作经
  `handlePlayerAction(…, 'system')`。
- 决定性：依赖"完整生成链"（startNewGame 重播种），符合项目常识 §四。
- **四组实验**：① 同种子全等复核；② 自然推进曲线（defaultTurnPolicy，200 回合）；
  ③ 定向注入（在真实 D1 地形上 `ignite()` 草地 / `addGas()` 地板）；④ 伤害基线
  （`igniteForced`/`addGas` 于玩家脚下，只统计切比雪夫距离 >2 无活怪的"干净回合"
  的 hp 增量，以剥离怪物攻击噪声；剩余 −1 增量是自然回血）。

### 4.2 同种子决定性复核 —— **通过**

| seed | 回合数 | 两遍逐回合快照 |
|---|---|---|
| 42 | 120 | **全等** |
| 2026 | 120 | **全等** |

输出：`[DETERMINISM] seed=42 turns=120 identical=true` / `seed=2026 … identical=true`。

### 4.3 自然关卡 200 回合曲线 —— **全部为零**（这本身就是基线）

5 种子 × 200 回合（defaultTurnPolicy：相邻则打、否则随机走）：

| seed | 层内可燃地形 | 点火次数 | 最大燃烧格 | 气体新生 | 最大气格 | 焦土再生 |
|---|---|---|---|---|---|---|
| 1 | 123 | 0 | 0 | 0 | 0 | 0 |
| 42 | 122 | 0 | 0 | 0 | 0 | 0 |
| 777 | 162 | 0 | 0 | 0 | 0 | 0 |
| 2026 | 115 | 0 | 0 | 0 | 0 | 0 |
| 31337 | 84 | 0 | 0 | 0 | 0 | 0 |

**解读**：可燃地形每层 84–162 格，但 1000 回合自然推进里没有一次自然起火或
气体事件——web 火与气只在外力下出现（药水/杖/陷阱/bloat 之死），而本策略
既不喝药也不施法、且 200 回合没踩中陷阱/没看到 bloat 死亡。
**对 F-1 的含义**：自然曲线是平凡门禁；真正的逐位门禁是 4.4/4.5/4.6。

### 4.4 定向点火：真实草地上 `ignite()` 单格，原地等待 40 回合

| seed | 起点 | 燃烧格曲线（前 13 回合） | 最大半径(切比雪夫) | 全熄回合 |
|---|---|---|---|---|
| 42 | (5,20) | 3,4,7,13,12,11,9,7,5,2,1,0,… | 3 | 12 |
| 2026 | (68,14) | 4,5,12,17,20,20,17,13,9,4,2,0,… | 5 | 12 |
| 777 | (31,23) | 2,4,8,9,11,12,11,10,7,5,2,0,… | 3 | 12 |

**稳定形态**：起燃后 ~4 回合达峰（12–20 格），三条曲线全熄回合都是 12。
F-1 门禁取法：**三条曲线逐位不变 + 全熄回合 = 12**。

### 4.5 定向注气：真实地板上 `addGas(type, 100)`，等待 40 回合

| seed | type | 气格曲线（前若干） | 峰值密度 | 最大气格 | 最大半径 | 全散回合 |
|---|---|---|---|---|---|---|
| 42 | POISON | 5,12,9,12,5,5,2,1,0,… | 38 | 12 | 2 | 9 |
| 42 | CONFUSION | **5,12,9,12,5,5,2,1,0,…（与 POISON 逐位相同）** | 38 | 12 | 2 | 9 |
| 42 | STEAM | 5,12,5,1,0,… | 35 | 12 | 2 | 5 |
| 42 | CREEPING_DEATH | 4,9,15,15,17,11,11,8,8,6,2,0,… | 25 | 17 | 2 | 12 |
| 2026 | POISON | 2,5,5,5,5,5,4,5,2,5,2,2,2,2,2,1,0,… | 83 | 5 | 2 | 17 |
| 2026 | CONFUSION | （同 POISON） | 83 | 5 | 2 | 17 |
| 2026 | STEAM | 2,5,4,2,5,2,2,2,1,0,… | 80 | 5 | 2 | 10 |
| 2026 | CREEPING_DEATH | 2,5,5,5,9,9,9,7,7,7,5,5,4,4,4,4,3,3,2,1,0,… | 74 | 9 | 3 | 21 |
| 777 | POISON | 2,3,3,…,3,2,2,2,0,… | 83 | 3 | 2 | 19 |
| 777 | CONFUSION | （同 POISON） | 83 | 3 | 2 | 19 |
| 777 | STEAM | 2,3,2,3,2,3,2,2,1,0,… | 80 | 3 | 2 | 10 |
| 777 | CREEPING_DEATH | 2,3,3,4,4,4,4,4,5,5,4,5,5,4,4,4,4,4,4,4,4,4,4,4,2,1,0,… | 74 | 5 | 4 | 27 |

两个值得 F-1 注意的结构性事实：
- **POISON ≡ CONFUSION 逐位相同**（web 消散率同为 2，见 §2.3）——这不是巧合，
  是当前实现的必然；F-1 若保持不动，这条恒等式本身就是门禁的一部分。
- 半径被封在 2–4：4 邻 + 15% 单向扩散 + 密度>10 才扩 + 2/回合消散，
  100 密度只够推 2-3 格。CE 量纲下毒气云（1000）在 8 邻均分+两轮/回合下
  可达 5-8 格——**F-2b 放开后扩散半径会肉眼可见地变大**。

### 4.6 伤害基线（干净回合口径，见 4.1④）

| 实验 | seed | hp 增量序列 | 解读 |
|---|---|---|---|
| 脚下 `igniteForced(7)` | 42 | 2,2,2,2,2,2,0,0,0,0,−1,0 | **固定 2/回合**，烧 6-7 回合；−1 是自然回血 |
| 脚下 `igniteForced(7)` | 2026 | 2,2,2,2,2,0,0,0,0,−1,0 | 同上 |
| 脚下 POISON 100 | 42 | 0,0,…,0（12 回合） | 不直接扣血；`poisoned` 状态全程在挂（毒伤走状态系统，与回血相抵） |
| 脚下 STEAM 100 | 42 | 1,1,0,…,−1,0 | **1/回合**，仅密度>20 的前两回合 |
| 脚下 CREEPING_DEATH 100 | 42 | 10,10（然后死亡） | **10/回合无阈值，起始角色 2 回合致死** |
| 脚下 CONFUSION 100 | 42 | 0,…,0 | 玩家上 `hallucinating` 8 回合（注意：玩家侧的"困惑"实现为幻觉） |

### 4.7 复跑方法

从附录 A 恢复 `src/test/zz_f0_probe.test.ts`，然后：

```
npx vitest run src/test/zz_f0_probe.test.ts --silent=false --disable-console-intercept
```

所有 `[DETERMINISM] / [NATURAL] / [FIRE-NAT] / [GAS] / [DMG-FIRE] / [DMG-GAS]`
行即原始数据。本文 §4 的全部数字来自 2026-09-16 的实跑输出。

---

## 五、差异清单与拆轮建议

### 5.1 CE 有而 web 没有（G/F 轮要补的）

1. **火作为地形**（10 种 T_IS_FIRE tile + 10 条火 DF，§3.1/3.2）——web 零。
2. `exposedToFire` 每格每回合 12 次点火尝试封顶 + 按层选点火概率。
3. `chanceToIgnite` 逐地形点火概率表（§3.4 的 30+ 行表）vs web 五地形白名单+40%。
4. 火地形 promoteChance 概率衰老（PLAIN_FIRE 5%/回合→EMBERS、GAS_FIRE 80%→消失…）
   vs web burnDuration 倒计时。
5. `TM_EXTINGUISHES_FIRE` 灭火层选择（深水/洪水/藻湖既产蒸汽又灭火）；
   web 只有 immune_fire 豁免（且药水断线，见 §6）。
6. **生物燃烧状态** STATUS_BURNING（7 回合、1-3 伤害、燃烧怪点燃所踩地形、
   潜水熄灭）——web 无生物侧燃烧状态，只有格子烧。
7. 甲烷爆轰链（TM_EXPLOSIVE_PROMOTE、8 邻判定、普通火 vs 爆炸火）。
8. `T_CAUSES_EXPLOSIVE_DAMAGE` 瞬时爆炸伤害（max(15-20, 50%)，5 回合同格不重复）
   ——web 用 `igniteForced` 4 邻燃烧模拟 GAS_EXPLOSION（P4-4 登记过的缺口）。
9. 六种气体：ROT / STENCH_SMOKE / PARALYSIS / METHANE / DARKNESS_CLOUD /
   HEALING_CLOUD（§2.1 表尾）。
10. 气体体积模型（unsigned short volume、守恒均分、随机舍入、>3 换型压制、
    chasm 逃逸、每回合两次）——web 的 density 0-100 网格整条不同。
11. 气体对生物按 maxHP 比例伤害/回复。
12. 24 条 GAS DF 里 web 未接的 21 条（§3.3：dewar×4、喷口×3、药水云×4、
    暗云、疗养云、stench×2、rot×2、methane puff/armageddon、steam×2、
    repel、bloodflower）。
13. 燃烧的物品（ITEM_FIRE / BF_FIERY 弹道烧物品）。
14. PILOT_LIGHT / BRAZIER / TORCH_WALL 这类"火源家具"。

### 5.2 web 有而 CE 没有（D2：保留代码、退出实际游戏）

1. `cell.isBurning` / `burnDuration` 布尔状态机本体（F-1 后降级为镜像）。
2. 全部自创参数：`randRange(4,7)` / `randRange(2,4)` 时长、40% 蔓延、
   30% 冒蒸汽(50 密度)、0.05% 焦土再生、密度阈值 20。
3. `TerrainType.CHARRED_FLOOR` 焦土 + 再生草机制（CE 烧完是 EMBERS/ASH 表面装饰）。
4. `TerrainType.BOG`（TerrainCatalog.ts:225-229 自认 webOnly）且参与点燃白名单。
5. `GasType.CREEPING_DEATH` 整套 + `creeping_death` 药水（10/回合、2 回合杀死
   起始角色，§4.6）。
6. `GasType.FIRE` 死枚举 + 其唯一写者 `Game.ts:2872`（幽灵气，§2.2）。
7. 伤害定值化：火烧固定 2、蒸汽固定 1、毒气上固定 5 的状态（CE 全是 maxHP 比例）。

### 5.3 两边都有但规则不同（最危险，逐条列全）

| # | 主题 | CE | web | 后果 |
|---|---|---|---|---|
| 1 | 蔓延判定 | 每个燃烧格每回合向 4 邻各掷一次 `chanceToIgnite`（15–100），每格 12 次暴露封顶；`alwaysIgnite` 直燃 | 每燃烧格每回合向 **8 邻**各掷 **40%** 固定值 | 草地火势 15% vs 40%：CE 蔓延慢且随地形凋枯（DEAD_FOLIAGE 80% 反而快）；web 一律快 |
| 2 | 火的寿命 | 火地形 promoteChance 概率衰老（5%–100%/回合）；可燃物被消耗 | burnDuration 4-7（门 2-4）硬倒计时 | CE 里 PLAIN_FIRE 平均烧 ~20 回合（几何衰减），web 稳定 4-7 回合 |
| 3 | 烧完的产物 | EMBERS / OBSIDIAN / 消失 / DF 链（桥塌、棺开、冰融、门开） | 统一变 CHARRED_FLOOR | 桥不塌、门不穿、冰不融——**这些 DF 链是 F-2a 的真内容** |
| 4 | 生物燃烧 | 状态：7 回合 1-3 伤害、可被水/灭火层扑灭、会点燃所踩地形 | 无状态；站燃烧格每回合固定 2 | CE 的"着火了"是一个可交互的状态机 |
| 5 | 火免 | STATUS_IMMUNE_TO_FIRE + 怪物旗标派生 + 潜水 + 灭火层 | `hasStatus('immune_fire')`（药水断线，§6-2） | web 药水无效（既有 bug） |
| 6 | 气体扩散 | 8 邻、体积守恒、随机舍入、每回合 2 轮、chasm 逃逸 | 4 邻、15%/邻、无舍入、1 轮 | 半径与速度差 ~2×（§4.5 实测半径 2-4 vs CE 预期 5-8） |
| 7 | 气体消散 | 二档百分比（20%/50% 每轮）×2 轮；部分气永不散 | 三档定值（2/5/1）；CONFUSION 错落 SLOW 档；全部必散 | **POISON≡CONFUSION 曲线逐位相同**（§4.5）；CE 燃气类会自己烧完 |
| 8 | 气体混合 | 邻居体积更大→整体换型、压制到 3 | +20 阈值顶替 | dewar 级（20000）压过去时行为完全不同 |
| 9 | 蒸汽来源 | 水体自身 chanceToIgnite=100 被点燃 → DF_STEAM_ACCUMULATION（15/回合持续） | 火的 4/8 邻是水 → 30% addGas(50) 一次性 | CE 火烧水是持续蒸汽源，web 是一次性的 |
| 10 | 气体效果判定 | 站进即上状态，每回合 max() 刷新，无阈值 | POISON 无阈值、CONFUSION/STEAM 密度>20 阈值 | web 的 20 是自创参数 |
| 11 | 气体伤害 | `max(1, maxHP/15)` 比例 | 毒气上状态、蒸汽 1、creeping death 10 定值 | 大怪在 CE 更怕毒气 |
| 12 | 爆炸 | GAS_EXPLOSION 地形：瞬时 max(15-20, 50%) + 5 回合同格免 | igniteForced 4 邻进入普通燃烧 | P4-4 已登记的缺口，F-2a 的验收点 |

### 5.4 F-1 / F-2 拆法建议（含对验收方拆法的一处反驳）

**同意的部分**：F-0 → F-1（火焰迁成地形、行为逐位不变、蔓延仍走旧白名单）
→ F-2（放开 CE 蔓延规则）的骨架，与 architecture_note.md §四一致。
测量结果支持这个顺序：A 类 9 处读者全部是"查地形即可"的语义（§一），
且火 DF 全落 SURFACE 层（§3.2），**F-1 不需要碰 GAS 层**——C-4a-0 的
"GAS 层恒空"留痕在 F-1 全程保持有效，不必预翻。

**反驳/修正一：F-2 必须再分两刀（F-2a 火 / F-2b 气），不接受合轮。**
理由：CE 里这就是两条独立代码路径（`exposeTileToFire`+promoteChance vs
`updateVolumetricMedia`），数据模型一个挂 tile 一个挂 volume；任何一轮
同时动两者，任一半翻车都会把另一半的验收拖死。architecture_note §四.4
的"气体同理再走一遍（G-0/G-1/G-2）"里，**G-0 已经被本文替代**
（§二/§三/§四就是气体侧的测绘与基线），无需再投。
建议序列：**F-1 → F-2a（火机制）→ G-1（气体迁层+体积量纲+updateVolumetricMedia
移植）→ G-2（24 条 GAS DF 接线）**。F-2b/G-1 谁先都可以，但 G-1 依赖
F-2a 的 `exposeTileToFire`（燃气被点燃走它）。

**修正二："行为逐位不变"必须钉死为可执行的口径**，建议直接采用 §4.1：
同 seed 同操作序列下，(每回合 isBurning/burnDuration/gasGrid 快照 +
§4.4/4.5/4.6 的定向实验数字) 逐位相等。**F-1 允许的改动=存储形态**
（燃烧格在 SURFACE 层挂 T_IS_FIRE 地形，isBurning 变派生/镜像读数），
**不允许碰的参数**（留给 F-2a）：`randRange(4,7)`/`(2,4)`、40% 蔓延、
8 邻、焦土产物、30% 蒸汽、密度阈值 20、固定 2/1/10 伤害。
特别地，**F-1 不要把"烧完变 CHARRED_FLOOR"改成 EMBERS**——那是行为变更，
属于 F-2a 的 §5.3-3。

**修正三：F-1 的落地形方式有一个真实的坑，出题时要写明。**
web 火与草同层（SURFACE），CE 靠 drawPriority 压制（火 10 < 草 60）。
web 的 `DungeonFeature`/`TerrainCatalog` 已有 DRAW_PRIORITY 机制，但
`GameCanvas` 渲染读的是 `cell.terrain`（旧单值字段）而非 layers——
F-1 要么让燃烧同步改写 `terrain` 字段（快照口径不变），要么把 A 类 9 处
读者连同渲染一起切到层模型。建议前者（改写点集中、读者零改动），
把"渲染切层"留给渲染专属轮次。

**F-1 会翻红的既有测试（出题人需提前按项目规矩列入允许修改，全部实查于测试源码）**：
- `p1_24_death_sink.test.ts`：**直接写** `cell.isBurning = true`（:217-218、:384-385
  等）并断言燃烧/熄灭行为（:334-385）；:364 还有显式留痕注释。若 `isBurning`
  改为派生读数（无 setter），这些写入点会直接红——须"仅为改为经公共入口点火"。
- `p1_28_flag_channel.test.ts`：同样直接写 `cell.isBurning`（:228、:245、:263）。
- `c_4c_promotion.test.ts:416`：状态指纹包含 `isBurning ? 1 : 0` 位。
- `c_1_room_profile.test.ts:378`：读 `cell.isBurning` 作 blocked 判定（只读，
  若派生读数保持同语义则不红；列出供排查）。
- `p4_4_split_kamikaze.test.ts`：bloat 走 `igniteForced` 路径（F-1 保签名则不红，
  F-2a 改真爆炸时翻红）。
- `p4_1b_monster_casting.test.ts`：怪物火弹道点燃路径（同上，F-1 应不红）。
- `c_4a_terrain_catalog.test.ts`：目录新增 PLAIN_FIRE 等条目（"仅为新增火地形条目"）。
- 其余（p1_26/p1_29/p1_33 连通性、generation_baseline、c_2 lakes 指纹）不涉及
  燃烧状态，理论上不动——F-1 交付时以实跑为准。

**F-1 的门禁清单（出题可直接抄）**：
1. §4.2 决定性复核：两 seed 全等仍真。
2. §4.4 三条燃烧曲线逐位相等 + 全熄回合 12。
3. §4.5 气体六条曲线逐位相等 + **POISON≡CONFUSION 恒等式保持**。
4. §4.6 六条伤害序列逐位相等。
5. §4.3 自然全零保持（这会顺带验证 F-1 没让火更容易自然发生）。
6. `npm test` 全绿（除上列预告翻红项）、`npm run build` 零错。

**G-1 的量纲决策（提前暴露给出题人）**：建议直接迁 CE 的 unsigned volume
量纲，把 `addGas` 调用点按"CE DF startProbability 对照表"（§3.3）一次折算
（毒陷阱 1000、bloat 2000、药水云 1000、web 自创的 creeping_death 按 D2
退役处理），**不要**保 0-100 乘系数近似——随机舍入、守恒、>3 压制在
0-100 上全都会失真（§2.4）。

---

## 六、与预设不符之处（只列不修）

1. **任务书**："GasType.FIRE 已知是死枚举（交接文档记载，请复核）"——
   复核结论是**半对**：零读者成立，但存在唯一死写者 `Game.ts:2872`
   （`creeping_death` 药水写入 type=1 幽灵气，占格、扩散、挡真气）。
   交接文档与任务书都没记这个写者。详见 §2.2。
2. **既有断线（疑似 bug，非本轮产物）**：`resist_fire` 药水
   （`Game.ts:2876`）授予 `temporaryImmunities['burning']`（键名非法，靠
   `as any` 过编译），而火伤分支检查 `hasStatus('immune_fire')`
   （`Game.ts:6117`）；`Creature.hasStatus`（`Creature.ts:124-126`）只读
   `statusDurations`，`Player` 未覆写。`temporaryImmunities` 全库唯一读者是
   `applyMonsterOnHitStatus`（`Game.ts:4199`，守"怪物命中附加状态"），
   而 `'burning'` 根本不在 `StatusId` 联合类型里、没有怪物会附加它——
   **喝抗火药水当前对火焰伤害完全无效**（过期时倒是会打印"抗性消退"日志，
   Game.ts:5494-5496）。`Game.ts:4546` 同款问题。F-2a 应顺手修正
   （正确形态：键改 `'immune_fire'` 并让火伤分支兼查 `temporaryImmunities`）
   ——本轮不动。
3. **任务书 §二.2 的表述"CE 每回合调用它两次（Time.c:1615-1616）"**——
   证实，但要补一个条件：**仅当场上存在气体时才调用**（Time.c:1600-1613
   先全场探测）。空场回合 CE 一次都不跑。
4. **任务书 §二.3 "24 条 GAS 层 DF……各自的 tile、startProbability、
   probabilityDecrement"**——24 条核实无误；但 `probabilityDecrement`
   对 GAS 层 DF **全部无效且全部为 0**（GAS 分支不走 spawnMapDF，
   Architect.c:3381-3387：`volume += startProbability` 单点注入）。
   表里照实给出但语义是"恒 0"。
5. **Game.ts:5198 注释（C-4 时期写的）**："web 的 addGas density 上限 0-100
   （非 CE 的 2000 量纲）"——2000 只是 DF_BLOAT_DEATH 一条的体积；
   目录里毒气云 1000、dewar 20000、steam puff 325、methane puff 2。
   注释以偏概全，G-1 出题时应引用 §3.3 全表。
6. **任务书 §四 的预设"点火事件数、燃烧格数随回合的曲线……可实测"**——
   实测结果是自然推进下全部为 0（§4.3）。曲线只能在定向注入口径下测出
   （§4.4/4.5）。这不是测量失败，是 web 灰色现状本身。
7. **全量测试门禁**：`npm test` 三遍取证——全量并行两遍分别 3 红 / 5 红
   （红集不同、**全部是 `Test timed out`**、零断言失败），红文件串行重跑
   **31/31 全绿**。本轮零代码改动（probe 已删，`git status` 仅新增本文档），
   假红与本轮无关且 `vite.config.ts` 注释自证此前已有两次同型前科。
   完整数据与建议跑法见 §七。
8. **CE `exposeCreatureToFire`（Time.c:28-60）的豁免表里没有"悬浮"**——
   Game.ts:6117 上方的 C-4 时期注释已正确记载这一点，本轮复核无误，
   无反驳。列出仅为本节完整（任务书提醒过曾在此类细节翻车）。

---

## 七、门禁（npm test / npm run build / git status）

**`npm run build`（2026-09-16 08:46，exit 0）：**

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit to this warning via build.chunkSizeWarningLimit.
✓ built in 13.57s
```

**`npm test` 跑了三遍，结论：零断言失败；红全是长测试在并行负载下的超时假红。**

- 第 1 遍（全量并行，12.0 min）：`3 failed | 62 passed (65)`，
  `3 failed | 711 passed | 8 skipped | 5 todo (727)`。日志只留了尾部
  （执行命令当时误加 `| tail -15`），可辨识的失败文件之一是
  `invented_content_pool.test.ts`。
- 第 2 遍（全量并行，18.1 min，完整日志）：
  `5 failed | 60 passed (65)`，`5 failed | 709 passed | 8 skipped | 5 todo (727)`。
  **5 个失败文件的失败原因全部是 `Error: Test timed out`（1×180s、4×300s）**：
  `invented_content_pool.test.ts`、`c_2_lakes_e2e.test.ts`、
  `c_4a_terrain_catalog.test.ts`、`monster_stats_effect.test.ts`、
  `armor_model_effect.test.ts`。同一棵工作树两遍红集不同（3 ↔ 5），
  且无一断言失败——这是负载脆弱，不是逻辑回归。`vite.config.ts:12-18`
  的注释记载了同一问题的前科（"并行执行方占用 CPU 时会让它们集体假红——
  已发生两次"，2026-09-16 才把 testTimeout 从 120s 上调到 300s）。
- 第 3 遍（仅上述 5 个文件，`--fileParallelism=false` 串行，8.7 min）：
  **`5 passed (5)`，`31 passed (31)`，全绿。**

**对任务书门禁条款的回应**："65 文件 714 passed 零红"在本机并行负载下
**不可复现**——但复现不出零红的原因与本轮改动无关：本轮零生产代码改动
（工作区唯一新增是本文档，见下），且全部失败形态是超时而非断言，
敏感的 5 个文件串行即全绿。**若验收方要一个干净的"零红"基线，
建议以 `--fileParallelism=false` 跑全量**（估算 40-60 min）；
F-1 的任务书门禁也应写明这个跑法，否则下一轮还会重演今天的取证消耗。

**`git status --porcelain`（终态）：**

```
?? ai_docs/f_0_fire_gas_survey.md
```

（临时测量脚本 `src/test/zz_f0_probe.test.ts` 已删除；除本文档外工作区干净。）

---
---

## 附录 A：测量脚本全文（`src/test/zz_f0_probe.test.ts`，跑完已删）

```ts
/**
 * src/test/zz_f0_probe.test.ts — F-0 临时测量脚本（跑完即删，不入库）
 *
 * 纯只读观测：不改任何引擎代码；只通过公开入口（environment.ignite /
 * igniteForced / addGas、handlePlayerAction）触发游戏本就存在的行为。
 * 输出全部走 console.log，跑法：
 *   npx vitest run src/test/zz_f0_probe.test.ts
 */
import { describe, it } from 'vitest';
import { createHeadlessGame, runTurns } from './harness';
import type { Game } from '../engine/Core/Game';
import { TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { GasType } from '../engine/Environment/Gas';
import { rng } from '../engine/Random';

const FLAMMABLE_TERRAIN = new Set([
    TerrainType.GRASS, TerrainType.FOLIAGE, TerrainType.BOG,
    TerrainType.DOOR, TerrainType.WEB,
]);

interface Snap {
    burning: string[];   // "x,y,dur" 已排序
    gas: string[];       // "x,y,type,density" 已排序（density>0）
}

function snapshot(game: Game): Snap {
    const burning: string[] = [];
    const gas: string[] = [];
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            const cell = game.grid.getCell(x, y);
            if (cell?.isBurning) burning.push(`${x},${y},${cell.burnDuration}`);
            const g = game.environment.gasGrid[x]?.[y];
            if (g && g.density > 0) gas.push(`${x},${y},${g.type},${g.density}`);
        }
    }
    return { burning, gas };
}

function findCell(game: Game, pred: (x: number, y: number, t: TerrainType) => boolean, avoidX: number, avoidY: number, minDist: number): { x: number; y: number } | null {
    const cands: { x: number; y: number }[] = [];
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            const cell = game.grid.getCell(x, y);
            if (!cell) continue;
            if (Math.max(Math.abs(x - avoidX), Math.abs(y - avoidY)) < minDist) continue;
            if (pred(x, y, cell.terrain)) cands.push({ x, y });
        }
    }
    if (cands.length === 0) return null;
    return cands[rng.randRange(0, cands.length - 1)]!;
}

/** 无怪物骚扰（切比雪夫距离 >2 无活怪）的回合才计 hp 增量。 */
function monsterNear(game: Game, x: number, y: number, dist: number): boolean {
    return game.monsters.some(
        (m) => m.hp > 0 && Math.max(Math.abs(m.loc.x - x), Math.abs(m.loc.y - y)) <= dist
    );
}

describe('F-0 probe: 同种子决定性复核', () => {
    it('同 seed 同操作序列两遍，逐回合火/气状态全等', () => {
        const SEEDS = [42, 2026];
        for (const seed of SEEDS) {
            const run = (): string[] => {
                const game = createHeadlessGame(seed);
                const sigs: string[] = [];
                for (let t = 0; t < 120; t++) {
                    if (game.isGameOver || game.player.hp <= 0) break;
                    // 确定性策略：优先攻击相邻敌人，否则按固定顺序走第一个合法方向
                    const px = game.player.loc.x, py = game.player.loc.y;
                    const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
                    let acted = false;
                    for (const [dx, dy] of DIRS) {
                        const m = game.getMonsterAt(px + dx, py + dy);
                        if (m && m.hp > 0 && !m.isAlly) { game.handlePlayerAction('move', { x: dx, y: dy }, 'system'); acted = true; break; }
                    }
                    if (!acted) {
                        for (const [dx, dy] of DIRS) {
                            const priv = game as unknown as { canMoveTo(x: number, y: number): boolean };
                            if (priv.canMoveTo(px + dx, py + dy) && !game.getMonsterAt(px + dx, py + dy)) {
                                game.handlePlayerAction('move', { x: dx, y: dy }, 'system'); acted = true; break;
                            }
                        }
                    }
                    if (!acted) game.handlePlayerAction('wait', undefined, 'system');
                    const s = snapshot(game);
                    sigs.push(`t${t}|B:${s.burning.join(';')}|G:${s.gas.join(';')}`);
                }
                return sigs;
            };
            const a = run();
            const b = run();
            const equal = a.length === b.length && a.every((v, i) => v === b[i]);
            console.log(`[DETERMINISM] seed=${seed} turns=${a.length} identical=${equal}`);
            if (!equal) {
                for (let i = 0; i < Math.max(a.length, b.length); i++) {
                    if (a[i] !== b[i]) { console.log(`  first divergence at turn ${i}:\n    A=${a[i]?.slice(0, 200)}\n    B=${b[i]?.slice(0, 200)}`); break; }
                }
            }
        }
    });
});

describe('F-0 probe: 自然关卡 200 回合曲线', () => {
    it('多种子自然推进：点火事件、燃烧格曲线、气体事件', () => {
        const SEEDS = [1, 42, 777, 2026, 31337];
        for (const seed of SEEDS) {
            const game = createHeadlessGame(seed);
            // 关卡可燃地形底数
            let flammable = 0;
            for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
                const c = game.grid.getCell(x, y);
                if (c && FLAMMABLE_TERRAIN.has(c.terrain)) flammable++;
            }
            const burnCurve: number[] = [];
            const gasCurve: number[] = [];
            let ignitions = 0;
            let gasBirths = 0, prevGasCells = 0;
            const gasPeakByType = new Map<number, number>();
            let burnDurationSamples: number[] = [];
            let lastBurning = new Set<string>();
            let regrowEvents = 0;
            let prevCharred = 0;

            const charredCount = (): number => {
                let n = 0;
                for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
                    if (game.grid.getCell(x, y)?.terrain === TerrainType.CHARRED_FLOOR) n++;
                }
                return n;
            };
            prevCharred = charredCount();

            for (let t = 0; t < 200; t++) {
                if (game.isGameOver || game.player.hp <= 0) break;
                runTurns(game, 1);
                let b = 0, g = 0;
                const cur = new Set<string>();
                for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
                    const cell = game.grid.getCell(x, y);
                    if (cell?.isBurning) { b++; cur.add(`${x},${y}`); if (!lastBurning.has(`${x},${y}`)) { ignitions++; burnDurationSamples.push(cell.burnDuration); } }
                    const gas = game.environment.gasGrid[x]?.[y];
                    if (gas && gas.density > 0) {
                        g++;
                        const pk = gasPeakByType.get(gas.type) ?? 0;
                        if (gas.density > pk) gasPeakByType.set(gas.type, gas.density);
                    }
                }
                if (g > 0 && prevGasCells === 0) gasBirths++;
                const ch = charredCount();
                if (ch < prevCharred) regrowEvents++;
                prevCharred = ch;
                burnCurve.push(b); gasCurve.push(g);
                lastBurning = cur; prevGasCells = g;
            }
            const dur = burnDurationSamples;
            console.log(`[NATURAL] seed=${seed} turns=${burnCurve.length} flammableTerrain=${flammable} ` +
                `ignitions=${ignitions} maxBurning=${Math.max(0, ...burnCurve)} burnTurnsTotal=${burnCurve.reduce((a, b) => a + b, 0)} ` +
                `gasBirths=${gasBirths} maxGasCells=${Math.max(0, ...gasCurve)} ` +
                `gasPeakByType=${JSON.stringify(Object.fromEntries(gasPeakByType))} ` +
                `regrowEvents=${regrowEvents} ` +
                `igniteDurAvg=${dur.length ? (dur.reduce((a, b) => a + b, 0) / dur.length).toFixed(2) : 'n/a'}(${dur.join('/')}) ` +
                `burnCurve=[${burnCurve.join(',')}] gasCurve=[${gasCurve.join(',')}]`);
        }
    });
});

describe('F-0 probe: 定向注入实验', () => {
    for (const seed of [42, 2026, 777]) {
        it(`天然可燃物点火蔓延 seed=${seed}`, () => {
            const game = createHeadlessGame(seed);
            const px = game.player.loc.x, py = game.player.loc.y;
            const spot = findCell(game, (_x, _y, t) => t === TerrainType.GRASS || t === TerrainType.FOLIAGE, px, py, 8);
            if (!spot) { console.log(`[FIRE-NAT] seed=${seed} SKIPPED: 本层无可燃草地`); return; }
            game.environment.ignite(spot.x, spot.y);
            const series: number[] = [];
            let radiusMax = 0, extinctAt = -1;
            for (let t = 0; t < 40; t++) {
                if (game.isGameOver) break;
                game.handlePlayerAction('wait', undefined, 'system');
                let b = 0, r = 0;
                for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
                    if (game.grid.getCell(x, y)?.isBurning) { b++; r = Math.max(r, Math.max(Math.abs(x - spot.x), Math.abs(y - spot.y))); }
                }
                series.push(b); radiusMax = Math.max(radiusMax, r);
                if (b === 0 && extinctAt < 0) extinctAt = t + 1;
            }
            console.log(`[FIRE-NAT] seed=${seed} origin=(${spot.x},${spot.y}) burnCurve=[${series.join(',')}] maxRadius=${radiusMax} extinctAtTurn=${extinctAt}`);
        });

        it(`气体注入扩散/消散 seed=${seed}`, () => {
            for (const type of [GasType.POISON, GasType.CONFUSION, GasType.STEAM, GasType.CREEPING_DEATH]) {
                const game = createHeadlessGame(seed);
                const px = game.player.loc.x, py = game.player.loc.y;
                const spot = findCell(game, (_x, _y, t) => t === TerrainType.FLOOR, px, py, 10);
                if (!spot) { console.log(`[GAS] seed=${seed} type=${type} SKIPPED: 无地板`); continue; }
                game.environment.addGas(spot.x, spot.y, type, 100);
                let peak = 0, cellsMax = 0, radiusMax = 0, goneAt = -1;
                const series: number[] = [];
                for (let t = 0; t < 40; t++) {
                    game.handlePlayerAction('wait', undefined, 'system');
                    let cells = 0, r = 0;
                    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
                        const g = game.environment.gasGrid[x]?.[y];
                        if (g && g.type === type && g.density > 0) { cells++; peak = Math.max(peak, g.density); r = Math.max(r, Math.max(Math.abs(x - spot.x), Math.abs(y - spot.y))); }
                    }
                    series.push(cells); cellsMax = Math.max(cellsMax, cells); radiusMax = Math.max(radiusMax, r);
                    if (cells === 0 && goneAt < 0) goneAt = t + 1;
                }
                console.log(`[GAS] seed=${seed} type=${type} origin=(${spot.x},${spot.y}) cellsCurve=[${series.join(',')}] peakDensity=${peak} maxCells=${cellsMax} maxRadius=${radiusMax} goneAtTurn=${goneAt}`);
            }
        });
    }
});

describe('F-0 probe: 伤害基线（无怪物骚扰回合）', () => {
    it('脚下强制点火：每回合 hp 损失', () => {
        for (const seed of [42, 2026]) {
            const game = createHeadlessGame(seed);
            const p = game.player;
            game.environment.igniteForced(p.loc.x, p.loc.y, 7);
            const clean: number[] = [];
            for (let t = 0; t < 12; t++) {
                if (game.isGameOver || p.hp <= 0) break;
                const hp0 = p.hp;
                game.handlePlayerAction('wait', undefined, 'system');
                if (!monsterNear(game, p.loc.x, p.loc.y, 2) && !game.isGameOver) clean.push(hp0 - p.hp);
            }
            console.log(`[DMG-FIRE] seed=${seed} cleanTurns=${clean.length} hpDeltas=[${clean.join(',')}]`);
        }
    });
    it('脚下毒气/蒸汽/creeping death：每回合 hp 损失与状态', () => {
        for (const seed of [42]) {
            for (const type of [GasType.POISON, GasType.STEAM, GasType.CREEPING_DEATH, GasType.CONFUSION]) {
                const game = createHeadlessGame(seed);
                const p = game.player;
                game.environment.addGas(p.loc.x, p.loc.y, type, 100);
                const clean: number[] = [];
                const statuses: string[] = [];
                for (let t = 0; t < 12; t++) {
                    if (game.isGameOver || p.hp <= 0) break;
                    const hp0 = p.hp;
                    game.handlePlayerAction('wait', undefined, 'system');
                    const st = ['poisoned', 'confused', 'hallucinating', 'paralyzed'].filter((s) => p.hasStatus(s as never));
                    statuses.push(st.join('+') || '-');
                    if (!monsterNear(game, p.loc.x, p.loc.y, 2) && !game.isGameOver) clean.push(hp0 - p.hp);
                }
                console.log(`[DMG-GAS] seed=${seed} type=${type} hpDeltas=[${clean.join(',')}] statuses=[${statuses.join(',')}]`);
            }
        }
    });
});
```

> 附录 A 与正文 §4 的脚本行为有一处刻意简化：NATURAL 段里 `ignitions += 0; prevBurning = b;`
> 一行的 `ignitions += 0` 是无效语句（prevBurning 也未被后续使用），不影响任何计量；
> 附录保持与实际跑过的脚本一致，不做美化。
