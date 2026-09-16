# G-1 报告：气体迁入 GAS 层 + CE 的体积量纲与扩散/消散模型

> 2026-09-16。执行：ZCode/GLM。CE 源码以 `BrogueCE-master/src/brogue/` 为准
> （只读；行号本轮逐条打开复核）。前置输入：F-0 §2.3/§3.3/§5.3-6/7/8/10/11/§5.4、
> F-2b 报告 §十。本轮对任务书/F-0 有**三处实测反驳**（§八：DF_GAS_FIRE 的
> layer 列、F-0 §3.2 表的 layer 缺记、旧 GasType 值与存档兼容），
> 请验收方重点看 §八。

---

## 0. 结论摘要

1. **§5.3-6/7/8 落地**：`Gas.updateGases()` 现在是 CE `updateVolumetricMedia`
   （Time.c:1383-1479）的逐行移植——8 邻体积均分、随机舍入、chasm 逃逸、
   类型竞争 + 3 体积压制、二档百分比消散（读 tile 机械旗标）、被困气瞬时散逸。
   气体的"是什么"住在 `Cell.layers[GAS]`（新地形 POISON_GAS/CONFUSION_GAS/STEAM），
   "有多少"住在 `Cell.volume`（CE pmap.volume，unsigned short 语义）。
2. **量纲一次折算**：全部 `addGas` 调用点按 F-0 §3.3 对照表换算成 CE 体积
   （§四折算表）。接受 F-0 §5.4 的建议（不保 0-100 近似），未发现反驳理由。
3. **P1-45 幽灵气按 D2 处置**：占位写入（`addGas(x,y,1,100)`）删除、
   `GasType.FIRE` 死枚举退役；`creeping_death` 药水整体退出生成池
   （Game 侧两处抽取点过滤——权威的 json `excludeFromGeneration` 机制在
   禁改数据文件里，按 `GENERATED_*_RUNICS` 的代码侧排池先例办理，§六）。
   `GasType` 改基到 GAS 层地形值，addGas 自带载体校验（幽灵气结构性防复发）。
4. **门禁全过（零红）**：火侧哨兵逐位一致（FIRE-NAT 三曲线 = F-2a §一；
   DMG-FIRE = F-2b §七）；决定性 identical=true×2；自然推进 5 种子全零 +
   可燃底数 123/122/162/115/84 逐格一致；**POISON ≢ CONFUSION 恒等式如任务书
   预期破缺**（消散档位 SLOW 20%/轮 vs QUICK 50%/轮）；build 绿；
   全量串行 **71 文件 / 789 passed | 8 skipped | 5 todo，零失败**
   （§七.3——含 p4_4：其验收 3 已在 F-2b 提交内由验收方翻正，
   本轮开局时对"仍红"的判断基于 F-2b 报告的过时认知，§八.10 如实登记）。
5. **对抗性测试 16 条**（新文件 `g_1_gas_volumetric.test.ts`，任务书点名的
   八类错误实现全覆盖）+ **反向验证 5 条**（超出要求的 4 条）：真实改坏、
   真实失败输出、全部还原（`grep -rn REVERT-ME src` = 0，§九）。
6. **RNG 流移动登记**（项目常识 §四）：有气体的回合，updateVolumetricMedia
   每格每轮消耗一次随机舍入掷骰（+有体积格的消散掷骰），且生产节奏从每回合
   1 次变为 2 次——同 seed 的掉落/刷怪在气体存在时会与旧引擎分岔。
   无气体回合零消耗（CE 的探测守卫原样移植），生成期基线不受影响
   （generation_baseline 实测绿，§七.2）。

---

## 一、CE `updateVolumetricMedia` 复核（任务书 §七第 1 条）

`Time.c:1383-1479`（`static void updateVolumetricMedia()`），本轮逐行实读。
实现要点（web 侧逐条对应）：

| CE 事实 | 行号 | web 对应 |
|---|---|---|
| `unsigned short newGasVolume[DCOLS][DROWS]` 双缓冲 | :1387 | `Uint16Array`（复刻 uint16 回绕语义） |
| 邻域 = 自身 + 8 邻（`nbDirs`，GlobalsBase.c:38）里不挡气的在图格 | :1402-1422 | 同（`sum`/`numSpaces`/`highestNeighborVolume`/`gasType`） |
| `T_AUTO_DESCENT`（chasm/trapdoor）格 `numSpaces++` → 气体逃出层外 | :1404-1406 | 同（对抗⑪ 行使） |
| `newGasVolume += sum/max(1,numSpaces)`；`rand_range(0,numSpaces-1) < sum%numSpaces` 时 +1（**随机舍入**） | :1408-1410 | 同；守恒在期望意义上成立 |
| 类型竞争：本格类型 ≠ 邻域最大体积者类型且新体积 >3 → 整体换型；换型前已有别的气 → **新体积 `min(3,…)`**（注释 "otherwise interactions between gases are crazy"） | :1427-1431 | 同（对抗⑦ 行使） |
| 换型不触发（类型相同或 nv≤3）且层非空而 nv<1 → 收层（层 NOTHING、体积可暂存——**不可见残气**） | :1432-1436 | 同 |
| 消散二档：旧体积>0 时，`TM_GAS_DISSIPATES_QUICKLY` 50%/轮 −1、否则 `TM_GAS_DISSIPATES` 20%/轮 −1；**旗标读的是"当前"层的 tile**（换型/收层之后） | :1437-1444 | 同（档位数据在 TerrainCatalog 气体条目） |
| `T_OBSTRUCTS_GAS` 格里有体积（门关进了气）→ 整除散给可存气邻居、够 1 体积才换型，自身清零 | :1446-1474 | 同（对抗⑫ 行使） |
| 终局写回 `pmap.volume = newGasVolume` | :1476-1478 | 同 + 全量镜像重建 |

**"为什么每回合调用两次"（任务书点名）**：CE 无文字说明，唯一线索是
`Time.c:1606` 的注释 `// update gases twice` 与其上的探测循环（:1600-1613，
全场扫描 `layers[GAS]` 非空才跑）。机制解释（标记为**推断**，CE 无原文）：

1. **传播速度**：一次调用 = 一轮 8 邻均分，气体边界每轮外推约 1 格；
   两轮 = 每玩家回合推进约 2 格（对抗③ 实测：单轮到不了切比雪夫距离 2）。
2. **消散速率翻倍**：QUICK 档每轮 50%−1 → 每回合期望 −1.0；SLOW 档 → −0.4。
   这与 F-0 §2.3 的推断一致，并被 §五.2 的新旧对照表实测支持
   （CONFUSION 可见期 8-10 回合 vs POISON 15-26 回合）。
3. **探测守卫的工程意义**（本轮实测复核出的硬事实）：updateVolumetricMedia
   对**每个不挡气的格**无条件消耗一次 `rand_range`（随机舍入），与有没有气无关
   （:1408 在体积分支内、体积判断之外）。空场回合直接跑会白烧
   2×DCOLS×DROWS 次抽取并移动后续一切随机事件——CE 的探测就是防这个的。
   web 原样移植（Game.objectiveTimeBlock：`hasVolumetricGas()` 才连调两次）。

---

## 二、落地形态：气体成为 GAS 层地形

| 载体 | web 形态 | CE 出处 |
|---|---|---|
| 气体"是什么" | `Cell.layers[GAS]` ∈ {POISON_GAS, CONFUSION_GAS, STEAM}（TerrainType 尾部追加，34/35/36） | Globals.c:502/503/508（drawPriority 同为 35） |
| 气体"有多少" | `Cell.volume`（0-65535；CE uint16 回绕 → web 写入口钳 65535，偏离登记 §八.4） | Rogue.h:1307 `unsigned short volume` |
| 消散档位 | 气体 tile 的 `TM_GAS_DISSIPATES(_QUICKLY)` 旗标 | Globals.c:502-508 mechFlags 列 |
| 可燃性 | POISON/CONFUSION 带 `T_IS_FLAMMABLE`（ign 100）、STEAM 不可燃 | 同上 flags 列 |
| `GasType` 枚举 | 成员值 = 对应 GAS 层 TerrainType 值（NONE=0；CREEPING_DEATH=250 哨兵值在值域外） | — |
| gasGrid | **只读镜像**（渲染/存档/效果查询），同步点 = addGas（单格）/updateGases（每轮末）/syncGasMirror（外部直写后）/clearGasAt | CE 无镜像；web 渲染在禁改文件（GameCanvas） |

**为什么 `terrain` getter 固定 skipGas（本轮最重的结构决定）**：CE 的
"含气 effective terrain"（`highestPriorityLayer(x,y,false)`）只服务显示/风味/
记忆与 respiration 判定（Movement.c:106/113 tileFlavor/tileText、:188
standsInTerrain、:2569 storeMemories、Items.c:7030、Time.c:69）；玩法逻辑
（通行/寻路/伤害/AI）全部走 `cellHasTerrainFlag` 的四层旗标并集。web 的
`.terrain` 读者（寻路/安全图/生成器/落位，30+ 处）对应的正是旗标并集世界——
若让气体（prio 35）参与 getter 竞争，"毒气盖着的岩浆"会被当成毒气放行。
显示侧的气体语义由两处补齐：渲染走 gasGrid 覆盖层（既有）；hover 地形名
优先 GAS 层（Game.ts，对齐 CE tileText 语义）。c_4a_0 的 skipGas 用例
已按 B-1 范本翻正（断言新事实，`highestPriorityLayer(x,y,*)` 本体不动）。

**火侧的燃气 quirk 接线**（CE Time.c:1361-1368）：exposeTileToFire 对 GAS 层
可燃物先 `volume = 0`（"Flammable gas burns its volume away"）再 promoteTile；
promoteTile 的 vanish 在 GAS 层连 volume 清零（:1262-1264，Promotion.ts 已接，
当前无 VANISHES 载体、G-2 行使）。火焰点燃毒气 → 毒气消失 + DF_GAS_FIRE 走
缺 tile 缓办（GAS_FIRE tile 未迁移，G-2）——差一个"地上留火"的表现，机制半边
（燃气被消耗）本轮已真实生效。

---

## 三、"每回合两次"与客观块接线（Game.objectiveTimeBlock）

```ts
if (this.environment.hasVolumetricGas()) {
    this.environment.updateGases();
    this.environment.updateGases();
}
```

时序保持 F-2b 定下的块序（applyEnvironmentalEffects → tickCreatureStatuses →
晋升驱动 → updateFires → **气体两轮**）：环境段取本块演化前的气（F-2b §五.8
的取态语义不变）。另加晋升链的 `gasVolumeAdded > 0` 对账（syncGasMirror）——
当前目录无已接线 GAS DF，分支今天不可达，G-2 接线后即为活路径。

---

## 四、量纲折算表（任务书 §五.3 / §七.3）

每个 `addGas` 调用点：旧值（0-100 密度）→ 新值（CE volume）→ CE 出处：

| # | 调用点 | 旧值 | 新值 | CE 出处（startProbability） |
|---|---|---|---|---|
| 1 | poison_burst 药水（Game.ts） | 70 | **1000** | DF_POISON_GAS_CLOUD_POTION（Globals.c:779） |
| 2 | 怪物毒液溅射（Game.ts） | 100 | **1000** | DF_POISON_GAS_CLOUD_POTION（Globals.c:779；F-0 §3.3 记的最近亲） |
| 3 | 怪物困惑溅射（Game.ts） | 100 | **1000** | DF_CONFUSION_GAS_CLOUD_POTION（Globals.c:779） |
| 4 | bloat 死亡（Game.ts） | 100 | **2000** | DF_BLOAT_DEATH（Globals.c:653，`{POISON_GAS, GAS, 2000, 0}`，本轮实测复核；Game.ts 原注释写 654 为行号漂移，已翻正） |
| 5 | 毒气陷阱（Game.ts triggerTrap） | 80 | **1000** | DF_POISON_GAS_CLOUD（Globals.c:770） |
| 6 | 火贴水冒蒸汽（Gas.ts updateFires，web 自创机制） | 50 | **325** | DF_STEAM_PUFF（Globals.c:665）——机制本身的 CE 对应物（水体被点燃→DF_STEAM_ACCUMULATION）归 G-2 |
| 7 | ~~creeping_death 药水~~ | 100（type=1 幽灵气） | **删除**（P1-45，§六） | — |

要点：
- **不保 0-100 近似**（接受 F-0 §5.4 建议）：随机舍入（0-100 上 `sum%numSpaces`
  恒为小整数，舍入噪声占比失控）、体积守恒、>3 压制（在 0-100 上等于"几乎全灭"）
  在 CE 量纲上才不失真。0-100 → volume 无通用线性映射（CE 各 DF 从 2 到 20000），
  只能逐调用点对表折算——上表即一次折算的全部。
- **addGas 的混合语义**随量纲换成 CE GAS-DF 特例形态（Architect.c:3384-3386）：
  `volume += amount`（加法累加）+ `layers[GAS] = type`（无条件换型）。
  web 旧的"amount > density 才顶替"随 0-100 量纲退役。类型间的混合判定
  全部交给 updateVolumetricMedia 的竞争/压制规则（CE 本来就没有 addGas）。
- 效果阈值（`density > 0` / `> 20`）按任务书 §三 保持字面不动——量纲位移的
  后果（>20 更容易/更早被穿越、POISON 状态挂得更久）在 §五.2 对照表中如实
  呈现，阈值本身的重新裁定归 G-3。

---

## 五、行为实测

### 5.1 火侧哨兵——逐位比对（任务书 §五.1）：**PASS**

F-0 探针（附录 A）恢复复跑（适配同 F-2b：igniteForced 去时长实参；CREEPING_DEATH
注入返回 false 是预期新行为），与 **F-2a 报告 §一** / **F-2b 报告 §七** 逐字节比对：

```
[FIRE-NAT] seed=42   origin=(5,20)  [1,1,1,2,3,5,6,6,6,6,7,6,6,7,7,7,7,7,6,6,6,6,6,5,6,6,5,5,5,5,5,5,5,5,5,6,6,6,5,5]  ≡ F-2a §一
[FIRE-NAT] seed=2026 origin=(68,14) [1,2,3,3,4,4,5,5,6,7,9,9,10,11,11,13,12,12,13,14,13,13,15,15,15,14,12,11,8,8,8,8,5,5,5,5,5,4,4,4] ≡ F-2a §一
[FIRE-NAT] seed=777  origin=(31,23) [1,1,1,1,1,0,…] 全熄@6 半径0                                                      ≡ F-2a §一
[DMG-FIRE] seed=42   cleanTurns=12 hpDeltas=[1,2,3,3,3,2,2,1,3,1,2,0]   ≡ F-2b §七
[DMG-FIRE] seed=2026 cleanTurns=5  hpDeltas=[3,1,3,2,3]                 ≡ F-2b §七
```

决定性：`[DETERMINISM] seed=42 turns=120 identical=true` / `seed=2026 … identical=true`
（任务书 §五.4）。自然推进 5 种子 × 200 回合：点火/气体事件全零，可燃底数
123/122/162/115/84 与 F-0 §4.3 逐格一致（⇒ 生成链未动，generation_baseline 的
实测佐证见 §七.2）。

### 5.2 新旧气体曲线对照表（任务书 §五.2 / §七.2 核心交付）

探针口径：真实 D1 地板单点 `addGas(type, 100)`（**新口径下 100 = 100 体积**；
旧表 100 = 满密度——量纲本身在变，对照读法见各注）：

| seed | type | 旧（0-100 密度模型，F-0 §4.5） | 新（CE 体积模型） | 变化 ⇄ CE 规则 |
|---|---|---|---|---|
| 42 | POISON | cells [5,12,9,12,5,5,2,1,0…] peak38 maxCells12 半径2 散@9 | cells **[14,14,16,16,16,16,16,13,12,9,4,3,2,3,0…]** peak14 maxCells16 **半径3** 散@15 | 8 邻均分→格数更多、更远（§5.3-6）；消散 2/回合定值 → 20%/轮−1（两轮）⇒ 存活期 ×~1.7（§5.3-7） |
| 42 | CONFUSION | **与 POISON 逐位相同**（恒等式） | [14,14,16,15,13,9,5,3,2,0…] peak13 散@10 | **恒等式破缺**：QUICK 档（50%/轮）先散尽——任务书 §五.2 预言实测兑现 |
| 42 | STEAM | [5,12,5,1,0…] peak35 散@5 | 与 CONFUSION 同曲线（同 QUICK 档）散@10 | CE 消散只有二档：CONFUSION/STEAM 同 QUICK（Globals.c:503/508） |
| 42 | CREEPING_DEATH | [4,9,15,…] 散@12 | **accepted=false，全程 0** | D2：无 CE tile 载体，addGas 拒绝（§六） |
| 2026 | POISON | [2,5,5,…] 散@17 peak83 | cells [7,7,7,7,7,7,7,6,7,5,1,1,1,1,1,0…] peak17 散@16 | 同上（半径 2、残气拖尾更长） |
| 2026 | CONFUSION/STEAM | 同 POISON / 散@10 | [7,7,7,7,7,6,1,0…] 散@8 | QUICK 档 |
| 777 | POISON | [2,3,3,…] 散@19 peak83 | [3,4,4,5,5,…,6,6,…,2,1,0…] peak42 maxCells6 **半径5** 散@26 | 障碍地形下的 8 邻绕行与慢消散 |
| 777 | CONFUSION/STEAM | 散@19/10 | 散@16（maxCells5 半径4） | QUICK 档 |

**注一（读法）**：新表的 peak 绝对值变小不是"气体变弱"——注入同为 100，
但 100 现在是体积（被 9 格均分，每格 ~11），而旧模型 100 是封顶密度。
生产口径的注入口径也换了量纲（毒云 1000-2000、蒸汽 325，§四）：f_2a 对抗⑪
新基线（100 体积注入）之外，1000 体积的云形实测为 **7×7 全可见、格均 5-17
体积、半径 3+ 的持续毒气云**（测量记录见 §九.3 G1TRUTH 样例）——CE 的
"毒气陷阱糊一脸"体感由量纲折算表保证，不由探针的 100 注入代表。
**注二（不可见残气）**：新曲线尾部的 `type=0,density=1` 条目是 CE 随机舍入的
体积孤儿（层 NOTHING、无消散旗标、可被后续云团以 >3 收编）——CE 同款行为
（:1432-1436 结构性后果），已按原样入档 f_2a/f_2b 新基线并在其注释中说明。
**注三（效果窗口）**：[DMG-GAS] 实测——POISON：`poisoned` 状态挂满 12 回合
（旧 ~9）；STEAM（100 体积）：仅第 1 回合越过 >20 阈值 [1,0,0,…]（旧
[1,1,1,0]，F-2b 后口径）——均分摊薄比定值消散更快跌破小阈值；CONFUSION：
hallucinating 5 回合（旧 8）。阈值语义本轮未动（任务书 §三），G-3 重裁时
应以"体积 > 阈值"的口径对照 CE 无阈值设计（§5.3-10）。

### 5.3 POISON ≡ CONFUSION 恒等式：**已破缺**（任务书 §五.2 预期）

机制根因：旧模型两者消散率同为定值 2/回合（web 自创）；新模型读 tile 旗标——
POISON_GAS = TM_GAS_DISSIPATES（20%/轮），CONFUSION_GAS = TM_GAS_DISSIPATES_QUICKLY
（50%/轮）。哨兵：f_2a 对抗⑪ / f_2b 对抗⑦ 的新基线中两者曲线已不同；
g_1 对抗⑥ 另钉一条"20 回合后两者存活体积不得相同"。

---

## 六、P1-45 幽灵气与 creeping_death 的 D2 处置（任务书 §二）

1. **幽灵气写入删除**：`creeping_death` 药水 case 里的
   `addGas(x, y, 1, 100) // Will add actual caustic gas later` 删除。
   字面量 `1` 在旧枚举里是 `GasType.FIRE`（不渲染、无效果、占格扩散、挡真气）；
   新枚举里 1 = GRANITE——任何残留写法都会被 addGas 的载体校验拒绝（对抗⑩）。
2. **`GasType.FIRE` 死枚举退役**（零读者 + 唯一写者都消失；F-0 §5.2-6 的 D2 清单项）。
3. **药水退出生成池（D2：保留代码、退出实际游戏）**：
   - 效果 case 分支、日志文案（zh_CN 3 个键）、死亡原因、气体效果分支
     （applyEnvironmentalEffects 的 CREEPING_DEATH 支，已标注 D2 留痕注释）、
     渲染分支——**全部保留**；
   - `Game.ts` 两处随机抽取点（'POTION' 类目抽取、开局物资 randType===2）
     按 `D2_EXCLUDED_POTIONS` 过滤。**为什么不走 json**：权威机制
     （consumables.json 的 `excludeFromGeneration: true` + invented_content_pool
     测试）在禁改数据文件里；ItemLoader.ts 也不在授权清单。按
     ItemLoader.`GENERATED_*_RUNICS` 的"代码侧排池"先例在抽取点过滤，
     池子大小变化不改变每格抽取次数（每次仍是 1 次 randRange）——生成期
     RNG 流不动，generation_baseline 实测绿。数据侧收口（json 标记 +
     genPotions 收口 + invented 清单增补）登记给数据文件轮次（§十.6）。
4. **`GasType.CREEPING_DEATH` 枚举保留**（渲染/效果代码引用它，D2 保留代码），
   数值改取 250（TerrainType 值域外哨兵：误写入层会让 TERRAIN_FLAGS 查表
   undefined 响亮崩溃，而不是静默污染）；**无层载体**，addGas 拒绝（对抗⑩ 留痕）。
5. **旧存档**：0-100 口径的旧枚举值（2/3/4/5）与幽灵气（1）都不是合法 GAS 层
   地形值，loadSnapshot 经 addGas 校验统一丢弃（气体不迁移——量纲不同本就
   无忠实映射，登记 §八.3）。type=NONE 的不可见残气不入档（save 侧跳过）。

---

## 七、门禁（任务书 §五 逐条）

**1. 反向哨兵——火侧逐位不变：PASS**（§5.1 全部输出；三条 FIRE-NAT 与
F-2a §一逐位一致、DMG-FIRE 与 F-2b §七一致、可燃底数逐格一致）。

**2. 新气体行为实测：PASS**（§5.2 对照表 + §5.3 恒等式破缺）。

**3. 量纲折算表：见 §四。**

**4. 决定性复验：PASS**——`[DETERMINISM] seed=42 turns=120 identical=true`、
`seed=2026 turns=120 identical=true`。

**5. generation_baseline：PASS（绿）**——气体是回合期现象，生成链零改动；
D2 排池不改变抽取次数。全量串行内确认。

**6. 坏层闸门 p1_26 / p1_29 / p1_33：PASS（全绿）**，坏层计数仍为 0
（全量串行内确认）。

**7. build / npm test**：

- `npm run build`（exit 0）：

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
...
✓ built in 1.43s
```

- 全量串行 `npx vitest run --fileParallelism=false`（终态树跑了两遍，
  数字完全一致；**零失败**）：

```
 Test Files  71 passed (71)
      Tests  789 passed | 8 skipped | 5 todo (802)
（第 1 遍 21:37–21:54，Duration 994.94s；第 2 遍 22:05–22:22，
  Duration 1000.88s——两遍之间仅有的改动是 g_1 测试文件内部的
  断言记账清理与一行未用 import 删除，两遍全绿互为复证。EXIT=0）
```

账目对账：F-2b 提交（bb2073c）终态 70 文件 / 785 用例（771 passed
+ 8 skipped + 5 todo + 1 failed = 785；p4_4 验收 3 当时红）。**该红在本轮
开局前已被验收方在 bb2073c 内翻正**（现测试名"F-2b 翻正：站在爆炸格上的生物，
环境段挂燃烧状态、状态段真的掉血"，双段驱动+双段断言）——本轮开局时依据
F-2b 报告 §六.3 以为它仍红，是过时认知，实测开局基线即全绿。本轮 +1 文件
（g_1_gas_volumetric，16 条）+1 用例（c_4a_terrain_catalog 气体条目钉死）
= 71 文件 / 802 用例（789 passed，789−771=18 = 16 新用例 + 1 新用例 +
1 条 p4_4 由 failed 转 passed），逐项可对上。

---

## 八、与预设不符之处 / 对任务书与 F-0 的反驳（只列事实）

1. **★ DF_GAS_FIRE 的 layer 是 SURFACE，不是 GAS**（任务书与 F-0 均未记其
   layer；本轮实测）：CE Globals.c:741 `{GAS_FIRE, SURFACE, 0, 0}`——GAS_FIRE
   是十种 T_IS_FIRE **地形**之一（Globals.c:495，drawPriority 10），不在
   "// gas layer" 注释块（501 行起）内。燃气被点燃时 CE 是把**火地形**铺到
   SURFACE 层、同时清 GAS 层体积（:1361-1368）。web 目录条目按 SURFACE 登记
   （c_4b E3 有逐字段钉死）。
2. **★ 气体 tile 的 drawPriority = 35 与 `terrain` getter 的冲突**（任务书
   未预见）：气体迁层后若 getter 含 GAS 层，所有 `.terrain` 玩法读者
   （寻路/安全图/生成器）会把"毒气盖着的岩浆"当毒气。本轮裁定 getter 固定
   skipGas、hover 单独优先 GAS 层（§二 的 CE 调用面论证）。c_4a_0 的
   skipGas 用例按自带授权翻正。
3. **旧存档气体不可迁移**（任务书未提）：GasType 改基后，旧档的 2/3/4/5
   不再是合法 GAS 层地形值，且 0-100 → volume 无忠实映射。loadSnapshot
   统一丢弃旧气体（§六.5）。若验收方要求迁移，需要单独的折算决策，
   本轮不擅自定。
4. **volume 钳 65535 而非 uint16 回绕**（有意偏离）：CE `volume +=` 回绕在
   单格 ≥65536 时翻转（约 4 支 dewar 叠同一格才触到）；web 钳制。登记为
   实际不可达的偏离。
5. **`randRange(0,0)` 不消耗抽取**（web Random 既有语义）：CE `rand_range(0,0)`
   消耗一次。只影响流位置记账（numSpaces=1 的孤立格），web 流本就独立于 CE，
   行为无差。登记。
6. **一轮内的不可见残气**（§5.2 注二）：CE 随机舍入的结构性后果——层
   NOTHING、体积 1-3 的"影子气"可在云散后长期留存（无旗标不消散，可被
   后续云团收编）。这是 CE 忠实行为而非 web 发明，但视觉效果是"密度>0 的
   NONE 条目"（渲染不画、存档跳过），f_2a/f_2b 新基线里占大量条目。
   若验收方认为应记录为 CE 潜在 bug 单，登记给 G-2 裁量。
7. **测量脚本事故（如实登记）**：基线测量期间，本执行方在临时脚本里把曲线
   输出多包了一层 `[...]`，导致首批基线以嵌套数组形态写入 f_2a/f_2b、
   连续多轮"曲线漂移"假红，一度误判为引擎非确定性。定位为**测量脚本自身
   缺陷**（`[${JSON.stringify(curve)}]` 双重包裹）后修正；引擎决定性由
   [DETERMINISM] identical=true×2 与 g_1 全绿独立证明。临时脚本已删。
8. **p1_24 无需翻正**（任务书授权清单给了，实际零改动）：其 STEAM 用例
   注入 50（新口径 = 50 体积）仍越过 >20 阈值、bloat 用例的 `GasType.POISON`
   枚举名比较在新值下自动成立。授权未动用。
9. **zh_CN.json 零改动**（授权"仅增键"，实际无需增键）：P1-45 删除的是调用
   点不是文案（药水日志保留，D2）；无新增 i18next 调用点。
10. **"p4_4 验收 3 仍红"是过时认知**（任务书与 F-2b 报告均基于其 §六.3 申报
    时点）：实测该断言已由验收方在 F-2b 提交（bb2073c）内按申报建议翻正
    （双段驱动 + 双段断言，守卫语义保留）。本轮全量门禁因此是**零红**，
    且本轮对 p4_4 的唯一改动只剩 GasType 字面量翻正（§十）。F-2c 的登记
    （§十一.9）相应改为纯增量工作。

---

## 九、对抗性测试与反向验证

### 9.1 对抗性测试（新文件 `src/test/g_1_gas_volumetric.test.ts`，16 用例全绿）

| # | 捕获的错误实现 | 断言锚点 |
|---|---|---|
| ① | 扩散仍用 4 邻（漏对角） | 单轮均分后对角邻体积 >0（9000/9 整除口径） |
| ② | 仍用 15%/邻 固定比例 | 中心份额 ≤1800（均分 ~1000；15% 实现留 5400）+ 总量精确守恒 |
| ③ | 每回合只跑一轮（漏两轮） | 一次 wait 后切比雪夫距离 2 处有气 |
| ③b | 探测守卫被拆（无气回合空跑烧 RNG） | 清气后回合抽取数回到无气水位（< 注气回合的 1/4） |
| ④ | 体积不守恒 | 整除注入（7200）单轮总量逐位不变 |
| ⑤ | 随机舍入被抹成 floor/ceil | 9044 注入后 9 格必须同时出现 1004 与 1005；总量 ∈ [9036,9045] |
| ⑥ | 消散用定值而非百分比档位 | 同种子下 QUICK（CONFUSION）20 回合损耗严大于 SLOW（POISON） |
| ⑥b | POISON≡CONFUSION 恒等式回潮 | 两者存活体积不得相同 |
| ⑦ | 混合判据写反 / 漏 3 压制 | 弱气格换型为强气类型且体积 ≤3（无压制 ≈567）；强气格保持 |
| ⑧ | 火侧被本轮意外改动（回归哨兵） | FIRE-NAT seed42 40 回合燃烧格曲线逐位等于 F-2a 基线（含取景点 (5,20) 复核） |
| ⑨ | GAS 层写入与 gasGrid 脱钩（只改一边） | addGas/updateGases/GAS-DF 特例三时点后，镜像 ≡ layers[GAS]+volume 全场扫描；truth 必须真被演化 |
| ⑩ | addGas 载体校验缺失（幽灵气防复发） | CREEPING_DEATH/NONE/1(GRANITE) 全拒、层与体积零写入、哨兵值在值域外 |
| ⑪ | chasm 逃逸分支缺失 | 深渊格注气 900 单轮后总量 <900（逃出层外） |
| ⑫ | 被困气散逸分支缺失 | 门格（T_OBSTRUCTS_GAS）900 体积单轮清零、8 邻各 112 |
| 存档 | 存档往返丢气体/体积 | toSnapshot→loadSnapshot 层与体积逐格还原 |
| 基线 | clearGasAt 清镜像不清真相 | 清后真相归零、重建镜像不复活 |

（任务书 §六.2 点名的八条全数覆盖：①②③⑤⑥⑦⑧⑨。）

### 9.2 反向验证（5 条，真实改坏 → 真实失败输出 → 还原；`grep -rn REVERT-ME src` = 0）

**R1 砍掉对角（4 邻化）→ 对抗①：**

```
AssertionError: 对角邻 (3,3) 必须参与均分: expected 0 to be greater than 0
Tests  1 failed | 15 skipped (16)
```

**R2 漏掉第二轮 → 对抗③：**

```
AssertionError: 两轮均分：距离 2 的格当回合就该有气（漏掉第二轮的实现到不了）: expected 0 to be greater than 0
Tests  1 failed | 15 skipped (16)
```

**R3 抹掉随机舍入（`if (false && …)`）→ 对抗⑤：**

```
AssertionError: 必须存在随机进位的 1005（抹平成 floor 的实现翻红）: expected false to be true // Object.is equality
Tests  1 failed | 15 skipped (16)
```

**R4 删 3 体积压制 → 对抗⑦：**

```
AssertionError: 换型前已有别的气：新体积必须压到 3（漏压制的实现 ≈566）: expected 567 to be less than or equal to 3
Tests  1 failed | 15 skipped (16)
```

（567 与预估的 566 差 1 = 随机舍入进位，实测自证了断言算式的正确性。）

**R5 addGas 只写镜像不写真相 → 对抗⑨：**

```
AssertionError: 镜像 type 脱钩 (4,4): expected 34 to be +0 // Object.is equality
Tests  1 failed | 15 skipped (16)
```

五条全部还原并复绿（g_1 16/16）。R5 首次尝试因替换串没算上中间注释行而未
生效（改坏没发生、测试照常绿——**无效改坏不计入反向验证**），修正匹配串后
重做，以上为生效版本的真实输出。

### 9.3 测量过程记录（G1TRUTH 样例）

1000 体积毒气（POISON_GAS）注入后 6 回合的层真相（`x,y,L34,v…`，L34 =
POISON_GAS）：7×7 全可见云、格均 5-17 体积——CE 生产口径（毒云 1000-2000）
下的云形佐证（§5.2 注一）。

---

## 十、既有测试改动逐条清单（含守卫性质论证）

| 文件 | 改动 | 为什么到期 | 守卫性质未放宽 |
|---|---|---|---|
| c_4a_0_layer_model.test.ts | ①skipGas 用例：`cell.terrain` 期望 GRASS→BLOOD（getter 固定 skipGas）；②两张全量表 toEqual 各 +3 行（POISON_GAS/CONFUSION_GAS/STEAM 归属 GAS、prio 35）；③"GAS 层恒空"留痕翻转为双向（生成后仍恒空 + 注气后层必须非空） | 任务书授权清单；气体迁层使"恒空"前提到期（①③），"新增气体地形打红穷尽式全量表"为任务书预告（②） | ① `highestPriorityLayer(x,y,*)` 语义本体零改动（skipGas 形参仍逐位照搬）；② 穷尽性质不变（全键 toEqual）；③ 守卫半边（生成不产气）原样保留 |
| c_4a_terrain_catalog.test.ts | ①names 34→37；②E 组 `.mechFlags` 读者白名单 + Gas.ts（注明理由）；③新增三条气体 tile 的逐字段钉死用例 | 任务书授权清单；①同上预告；② updateVolumetricMedia 读消散旗标（CE :1437-1444）必然引用 mechFlags；③新条目需要对位钉死 | ②按留痕规矩白名单化并写明理由（不是绕形态）；③穷尽字段断言（flags/mechFlags/ign/fireType/prio/归属） |
| c_4b_dungeon_feature.test.ts | ①E1/E2 目录条目 20→21 + DF_GAS_FIRE=101 钉死；②E3 增 DF_GAS_FIRE 条目抽查（layer SURFACE）；③E4 缺 tile 9→10 | 任务书授权清单；气体 tile 的 fireType 引用 DF_GAS_FIRE（E2 闭包自洽断言的要求） | E2 闭包集合相等断言原样（多抄/漏抄/悬空仍全翻红）；E4 的"missing 必须 tile=null + 抛错点名"原样 |
| f_1_fire_as_terrain.test.ts | 对抗⑦翻转："注气全过程 GAS 层不得被写" → "注气必须写入 GAS 层（层持有 POISON_GAS+体积）+ 火侧不写 GAS 层守卫保留 + GAS 层只许气体地形" | 任务书授权清单；C-4a-0 留痕随迁层到期（B-1 范本：断言新事实 + 保留越界守卫） | 火侧守卫半边原样保留（PLAIN_FIRE 出现在 GAS 层仍翻红）；非气体地形出现在 GAS 层同样翻红 |
| f_2a_fire_mechanics.test.ts | 对抗⑪：GAS_BASELINE 四型曲线按 G-1 实跑重录（含 CREEPING_DEATH 恒空 + 注释说明恒等式破缺/残气/小注入口径） | 任务书授权清单 + F-2b §十.4 预告（"G-1 改气体时两处一起翻"） | 硬编码逐位哨兵性质不变（14 回合全场签名）；破缺的恒等式以独立断言（g_1 ⑥b）接岗 |
| f_2b_creature_burning.test.ts | 对抗⑦：同上（同一基线的第二份等价实现） | 同上 | 同上 |
| p4_4_split_kamikaze.test.ts | 仅验收 3 内 bloat 用例的 `type toBe(2)` → `toBe(GasType.POISON)`（字面量随枚举改基到期）；其余零触碰（验收 3 的燃烧双段断言已由验收方在 bb2073c 翻正，本轮开局即绿，§八.10） | 任务书授权清单（"各自的气体断言"） | `density toBeGreaterThan(0)` 原样；deathEffectTriggered 断言原样；p4_4 其余气体断言（对抗⑤双触发、三组对照组）零改动且全绿 |
| p1_24_death_sink.test.ts | **零改动**（授权未动用，§八.8） | — | — |

---

## 十一、给 G-2 / G-3 / F-2c / 后续轮的登记清单

**G-2（24 条 GAS 层 DF 接线）**：
1. `TerrainType` 已备好 POISON_GAS/CONFUSION_GAS/STEAM；ROT_GAS/STENCH_SMOKE_GAS/
   PARALYSIS_GAS/METHANE_GAS/DARKNESS_CLOUD/HEALING_CLOUD 六 tile 未迁移
   （DF_MISSING_TILES 注释已注明哪些是"tile 未迁移"、哪些是"tile 已在、
   接线未做"）。DF_POISON_GAS_CLOUD / DF_STEAM_ACCUMULATION / DF_METHANE_GAS_PUFF
   的 tile 列填上即自动走 DungeonFeature 的 GAS 分支（volume 累加已接、
   镜像对账路径已备）。
2. `DF_GAS_FIRE`（tile null）待 GAS_FIRE tile 迁移后接线：promoteTile 缓办
   撤除后，"燃气烧完地上留火（80%/回合自熄）"完整成形；exposeTileToFire 的
   volume 清零半边本轮已接。
3. 蒸汽源（§5.3-9）：水体 chanceToIgnite=100 被点燃 → DF_STEAM_ACCUMULATION
   （15 体积/回合持续）接线后，可退役 Gas.updateFires 的"火贴水 30% 冒蒸汽"
   web 自创分支（本轮已折算为 325=DF_STEAM_PUFF 口径）。
4. 深水/藻湖被点燃的 fireType 链、dewar 引爆（20000 体积）、甲烷爆轰
   （TM_EXPLOSIVE_PROMOTE 载体落地后 exposeTileToFire 的爆轰分支即活）、
   DARKNESS_CLOUD/HEALING_CLOUD 的效果落地（G-3 侧）。
5. Game 侧 `gasVolumeAdded > 0 → syncGasMirror` 对账分支已埋（今天不可达，
   接线后自动成为活路径）。

**G-3（气体效果与生物侧）**：
6. 效果阈值 >20 是 0-100 时代的自创参数，本轮字面保留但语义已漂移
   （体积口径下更容易被穿越；DMG-GAS 实测窗口变化见 §5.2 注三）。CE 的
   真口径是无阈值、站进即上状态 + 每回合 max() 刷新（Time.c:421-497），
   伤害/回复按 `max(1, maxHP/15)` 比例（:592-655）。
7. 六种 CE 效果未接：恶心（ROT/STENCH）、麻痹（PARALYSIS_GAS）、
   爆炸伤害归 F-2c、黑暗、疗养。
8. 不可见残气（§八.6）若被裁定为需要压制（例如"nv<1 才收层"改为"nv<2"），
   属偏离 CE 的自创行为，需验收方明示。

**F-2c（爆炸）**：
9. p4_4 验收 3 已由验收方翻正、当前绿（§八.10）——F-2c 落地
   GAS_EXPLOSION 的 `T_CAUSES_EXPLOSIVE_DAMAGE` 瞬时伤害 + 5 回合同格免时
   属纯增量替换（届时按当时断言重新对账）；GAS_EXPLOSION 的
   `T_CAUSES_EXPLOSIVE_DAMAGE` 瞬时伤害 + 5 回合同格免落地时，爆炸铺开的
   GAS_EXPLOSION 地形（SURFACE 层）与气体层无交互（GAS_EXPLOSION 不带
   T_OBSTRUCTS_GAS），无新增耦合。

**数据文件轮次**：
10. `potion_of_creeping_death` 的 `excludeFromGeneration: true` 标记 +
    invented_content_pool 测试的 INVENTED.potions 增补 + 本轮 Game.ts 两个
    抽取点过滤的退役（三件事一起做）。

**渲染/门轮次（沿 F-2a/F-2b 登记）**：
11. 气体的记忆渲染：CE storeMemories 记住含气 effective terrain（Movement.c:2569），
    web 的 memory 显示走 terrain getter（skipGas）——被探索但不可见的格子
    上的气不进记忆画面。hover 已按 CE 语义补（GAS 层优先）。
12. 气体 tile（35）的门/网优先级竞争在渲染层未消费（web 用 gasGrid 覆盖层），
    CE 的"网(19) 盖住毒气(35)"差异登记。

---

## 十二、文件边界自查

```
git status --porcelain（终态）：
 M brogue-web/src/engine/Core/Game.ts
 M brogue-web/src/engine/Environment/Gas.ts
 M brogue-web/src/engine/Map/DungeonFeature.ts
 M brogue-web/src/engine/Map/DungeonFeatureCatalog.ts
 M brogue-web/src/engine/Map/Grid.ts
 M brogue-web/src/engine/Map/Promotion.ts
 M brogue-web/src/engine/Map/TerrainCatalog.ts
 M brogue-web/src/test/c_4a_0_layer_model.test.ts
 M brogue-web/src/test/c_4a_terrain_catalog.test.ts
 M brogue-web/src/test/c_4b_dungeon_feature.test.ts
 M brogue-web/src/test/f_1_fire_as_terrain.test.ts
 M brogue-web/src/test/f_2a_fire_mechanics.test.ts
 M brogue-web/src/test/f_2b_creature_burning.test.ts
 M brogue-web/src/test/p4_4_split_kamikaze.test.ts
?? brogue-web/src/test/g_1_gas_volumetric.test.ts
?? brogue-web/ai_docs/g_1_gas_volumetric_report.md
```

- 生产改动全部在允许清单内（Gas/Grid/TerrainCatalog/DungeonFeatureCatalog/
  DungeonFeature/Promotion/Game）。**禁改文件零 diff**（BrogueCE-master/、
  src/components/、src/entities/、src/data/、src/engine/Map/ 其余文件、
  Random.ts、vite.config.ts、harness.ts、fixtures/）。
- 既有测试改动 7 个文件，全部在授权清单内；p1_24/f_2a 其余断言/f_2b 其余
  断言零触碰。
- 测量脚本（zz_g1_measure / zz_f0_probe）恢复→复跑→已删；
  `grep -rn REVERT-ME src` = 0；未执行任何 git 写操作。
