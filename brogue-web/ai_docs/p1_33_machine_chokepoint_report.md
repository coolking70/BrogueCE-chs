# P1-33 交付报告：机器阶段把关卡切断（+ P1-36 护栏元断言）

> 分支 `round/p1-33`（独立 worktree）。工作目录 `brogue-web/`；
> CE 事实来源 `../BrogueCE-master/src/brogue/`（只读）。
> 本轮**未执行任何 git 写操作**（无 add/commit/checkout）；为满足报告刚需
> 仅运行了只读的 `git diff --stat`（任务书"不要执行任何 git 命令"与常识
> §5.3 的报告模板冲突，取只读折中，在此声明，请验收方裁决）。

---

## 0. 一句话结论

**15 种子 × D1-D26 = 390 层端到端复验：坏层 5 → 0**（含任务书点名的
424242/D19、20260916/D16、999/D18，及扩展取样新增的 3/D17、7/D6）。
机器总数 1920 → 1576（4.92 → 4.04/层，非塌缩，有测试下限看守）。
`npm test` 553 过 / 1 红（`generation_baseline`，预设内的预期红），
`npm run build` 绿。

修复不是单点：CE 的 chokeMap 门位选址（本轮主体）之外，还必须有
**8 向洪泛**、**锁门验证泛洪**、**密库地板退出楼梯牌堆** 三件 web 口径下
的必要配套——缺一不可，每件都有反向验证证明其承重（见 §6/§7）。

---

## 1. chokeMap 的实现与归属选择

**归属：扩展 `src/engine/Map/LoopMap.ts`，不新建文件。** 理由：

1. CE 里 IN_LOOP 与 chokeMap 是**同一个函数** `analyzeMap`（Architect.c:192-336）
   的前后两段，共用同一张 passMap；C-0 的 LoopMap.ts 头注已明确预留了
   "calculateChokeMap 分支（246-336）本轮显式不做"的口子，本轮就是兑现它。
2. `checkLoopiness` / `auditLoop` / `cDirs` / `nbDirs` 等基建已在该文件，
   新建文件要么复制要么跨模块导出私有件。本轮把 analyzeMap 步骤 2+3
   提取为模块内共用件 `pruneLoopMarkings`，`analyzeLoopMap`（C-0 出口）
   行为逐位不变，`analyzeChokeMap`（新增出口）复用同一段。

**新增出口**：`analyzeChokeMap(grid, isMachineCell?) → { passMap, chokepoint, gateSite, chokeMap }`
（分别对应 CE 的 passMap 变量、IS_CHOKEPOINT、IS_GATE_SITE、chokeMap 全局）。
确定性纯函数，不消费 RNG。

**与 analyzeLoopMap（C-0）的有意口径分歧**（详见 §2）：
CE 的 analyzeMap 用同一张 passMap（`!T_PATHING_BLOCKER && !TM_IS_SECRET`）。
`analyzeChokeMap` 的 passMap 改用 **`terrainAllowsMove`（Game.canMoveTo 的
镜像，P1-29 已钉死的判据）**。理由：chokeMap 的唯一消费者是"锁门封死角"，
而验收口径是 canMoveTo 泛洪——分析口径与验收口径不一致时会漏切
（例：CE 视密门为通路、web 视为死墙，分析认为"只封住小死角"、实际封住
更大区域）。Game 运行期的 IN_LOOP 消费者（怪物/寻路语义）不受影响，
`analyzeLoopMap` 保持 CE 口径一字未动。

## 2. CE 行号对照（本轮读到的事实，供验收方复核）

| 内容 | CE 位置 | web 落点 |
|---|---|---|
| chokepoint 标记（跳变 >2 + 上下/左右夹缝） | Architect.c:246-270 | `analyzeChokeMap` 步骤 4 |
| chokeMap 初始化 + 机器格剔除洪泛 | Architect.c:279-288 | 步骤 5 开头 |
| 门位扫描（堵门 → 逐侧洪泛计数 → ≥4 才记账） | Architect.c:291-335 | 步骤 5 主循环 |
| `floodFillCount` | Architect.c:140-165 | `floodFillCount`（8 向 + 早停，见 §3） |
| 机器选址（IS_GATE_SITE ∧ !IS_IN_MACHINE ∧ roomSize 窗口，候选上限 50） | Architect.c:1080-1095（`rand_range(0,totalFreq-1)` 在 1110；无候选放弃 1108-1122） | `BlueprintEngine.findGateRoom` |
| 内部映射（触他机即弃；`chokeMap[新] ≤ chokeMap[起]` 扩展） | Architect.c:404-434（中止 409-413，扩展 416-421） | `mapMachineInterior`（导出供测） |
| IS_CHOKEPOINT / IS_GATE_SITE 定义 | Rogue.h:1103-1104 | — |
| **楼梯回避 IS_IN_MACHINE** | Architect.c:3712、3738（`avoidedFlags` 含 `IS_IN_MACHINE`）；validStairLoc 579-582 | web 无对应 → §3 的 CHARRED_FLOOR 机制 |
| 随机物品/怪群回避 IS_IN_MACHINE | 3597（populateItems）、3543（spawnHorde） | 同上（牌堆机制一并覆盖） |

## 3. 蓝图尺寸字段对应、以及三件必要的 web 口径配套

**roomSize：web 数据已有，语义本轮对齐 CE。** `blueprints.json` 全部 20 条
都有 `roomSize: [min, max]`。CE 里 room machine 的 roomSize 就是"门位候选
的 chokeMap 窗口"（1088-1089）；web 旧实现把它挪用为"BFS 房间面积区间"。
本轮起恢复 CE 语义（`roomSize[0] ≤ chokeMap[门] ≤ roomSize[1]`），
**没有新造任何 CE 没有的字段**。附带发现：`BP_NO_INTERIOR_FLAG` 三条
（area_swamp/area_bloodflower/area_camp）在 web 引擎里本就无对应代码路径
（旧引擎把 20 条蓝图全当 room machine 处理），本轮维持单一门位路径，
此三项一并走门位选址——是"维持 web 现状"而非"新发明"，特此说明。

**三件配套（CE 无逐字对应、但为 CE 语义在 web 口径下的必要补全）：**

1. **洪泛 8 向**（CE 是 4 向递归）。web 移动是 8 向且 canMoveTo 无对角
   穿墙限制（P1-29 已确立同口径并写入 Connectivity.ts 头注）。4 向洪泛
   看不见斜向连通，斜向挂在口袋上的子区域拿不到 chokeMap 值 → 不进机器
   内部 → 地板不退出楼梯牌堆 → 楼梯抽进口袋 → 锁门封死上楼梯。
   **seed31337/D12 的坏层正是这个成因**（key_lava_moat 的护城河封死了
   上楼梯所在的整个左上区域，实测解剖见 §7 RV 之前的记录）。
2. **锁门验证泛洪 `gateSealsOnlyInterior`**（放置前证明"这把锁只封内部"）：
   假想堵门后做 8 向泛洪，任何"未达 ∧ 可走 ∧ 非本机器内部 ∧ 非既有机器"
   的格都否决该门位。这是 P1-29 湖泊闸门"放置前证明不切断"语义在机器
   锁门上的对应物。CE 割点体系在 8 向移动下存在"夹带口袋"盲区
   （一个割点两侧各挂死角时，锁门只把小侧立为机器、大侧被夹带封死），
   CE 自己靠 4 向移动 + 楼梯回避掩盖了这一点，web 必须显式验证。
3. **密库地板退出楼梯牌堆**：CE 的楼梯（placeStairs）、随机物品
   （populateItems）、怪群（spawnHorde）全都回避 IS_IN_MACHINE
   （3543/3597/3712/3738）；web 的这些内容统一出自 Game.populateLevel 的
   `terrain === FLOOR` 牌堆，而 **Game.ts 本轮禁改**。机器内部裸地板转为
   `CHARRED_FLOOR`（机械惰性：web 仅燃烧余烬写入它；canMoveTo 可通行；
   渲染与余烬一致），把机器内部整体退出牌堆——一并消除了"钥匙掉进锁死
   的密库""护符抽进锁门宝库"两个潜在软锁。反向验证 RV4 证明它承重：
   删掉它，390 层扫描立刻爆出大量坏层（424242/D19 可达仅 28 格）。

**CE 的死分支不移植**：floodFillCount 的 `passMap==2 → 5000`（analyzeMap
对 passMap 只赋 true/false，无写入点）与 IS_IN_AREA_MACHINE 计 10000 惩罚
（web 机器格已在洪泛前剔除、且 web 无 area/room 双轨）。

**性能优化（决策等价，因既有测试 `invented_content_pool` 贴 120s 超时线）**：
洪泛计数早停封顶 `CE_CHOKE_COUNT_CAP = 41`（>40 的区域一律记 41）；
印戳式访问表替代每次清全图；洪泛集列表化更新替代 CE 的全图回扫。
等价性论证：chokeMap 的消费者只有门位窗口（数据表 roomSize[1] 最大 40，
41 恒窗外）、门位赋值（41 < 30000 照常）、内部扩展（41 大于任何 ≤40 门值，
照常拒入）；截断后未访问格保持 30000，与 41 决策等价。前提
"roomSize[1] ≤ 40" 由新增元断言（测试 c2）看守。优化后机器阶段实测
131ms/26 层，`invented_content_pool` 独立运行 49.6s（初版实现下该测试在
全量并发中超时，机器统计逐位不变证明等价：1576/1053/16）。

## 4. 修复前后的坏层数与机器数量对比

同一 15 种子（424242, 777, 20260913, 31337, 20260916, 1, 42, 999,
20260915, 55555, 2, 3, 5, 7, 11）× D1-D26 = 390 层，修复前后各跑一遍
（探针脚本跑完即删，方法与判据同 p1_26/p1_29：canMoveTo 8 向泛洪
上楼梯 → 下楼梯）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 机器总数 | 1920 | 1576 |
| 平均每层 | 4.92 | 4.04 |
| 零机器层 | 15 | 16 |
| 锁门机器 | 1318 | 1053 |
| 机器格总数 | 41664 | 31081 |
| **坏层** | **5**（424242/D19、20260916/D16、999/D18、3/D17、7/D6） | **0** |

机器数下降 18% 是门位选址天然更严的直接结果（CE 同样如此：没有合格
门位就放弃该蓝图换下一个），**不是**靠少放机器蒙混——锁门宝库仍有
1053 台，且测试 a) 里钉了防塌缩下限（机器 ≥1200、锁门 ≥700、零机器层
≤40），静默拒绝一切的错误实现会立刻翻红。

## 5. 15 种子复验汇总

```
[p1_33] 修复后 15 种子 × D1-D26 = 390 层：坏层=无；
        机器 1576 台（平均 4.04/层，零机器层 16），锁门机器 1053 台。
        修复前基线：1920 台（4.92/层）、坏层 5。
```

交叉印证（同一提交内全绿）：
- `p1_29` 端到端 10 种子 × 260 层：坏层集合 = 空集（原 3 层已清）；
  湖泊阶段 15 种子合同不受本轮影响（机器阶段在 generateTerrain 之后）。
- `p1_26` 5 种子 × 130 层：下楼梯不可达 = 0；可走占比区间、决定性、
  楼梯存在性等其余不变量全绿。
- `blueprint_center` 12 种子 × 312 层：1269 台机器 center/door 合同 0 违例；
  center 宝藏 410 件全部可通行（样本源变化见 §10.4）。

## 6. 对抗性测试与对应错误实现（`src/test/p1_33_machine_chokepoint.test.ts`，442 行）

| 用例 | 被钉死的错误实现 | 断言手段 |
|---|---|---|
| b) AD1 | 选址退回任意 BFS 块（旧 findSuitableRoom） | ① 同一张纯走廊图上旧路径**真实切层**（LOCKED_DOOR 落在唯一通路，两端不通）作齿；② 生产守卫：`buildMachines` 运行期间 `findSuitableRoom` 调用数必须为 0（回退接线即红）+ 走廊+口袋图上两端始终互通 |
| c) AD2 | chokeMap"被封区域大小"取了外侧而非内侧 | 合成割点图（大厅 154 — 走廊 — 门位 G — 口袋 9）上精确断言：`chokeMap[G]=9`（外侧实现得 41/154 → 红）；`gateSites` 精确集合；割点语义钉死（**直走廊格也是割点**——CE 跳变计数为 4，只有"邻开阔格"的割点才被洪泛赋值） |
| d) AD3 | 内部扩展丢掉 `chokeMap[新] ≤ chokeMap[起]` | 内部必须**恰好**等于 G+口袋 10 格（删约束即吞掉全图 2291 格 → 红）；触及他机（machineNumber≠0）返回 null（CE 409-413） |
| c2) | 洪泛封顶 `CE_CHOKE_COUNT_CAP=41` 的前提被破坏 | 元断言：blueprints.json 全部 `roomSize[1] ≤ 40`（引入更大密库必须同步上调，否则大门位被静默排除） |
| blueprint_center d) AD4 | isCenterTreasure 判据腐烂（id 拼错/退池/前缀整族消失） | 元断言：点名 id 必须在 consumables/arcana 数据表中存在；`ring_`/`charm_`/`wand_` 前缀必须仍命中真实物品 |

全部行为断言打在真实生成关卡上（用例 a/f 走完整 `createHeadlessGame`
链路），合成图仅用于错误实现的精确定位。

## 7. 反向验证（真实改坏 → 真实失败输出 → 还原；4 条，超出 2 条要求）

**RV1（删内部扩展约束）** → 用例 d 红：

```
AssertionError: 内部必须恰好是 G + 口袋（10 格）；实际 2291 格：
(23,9)(23,8)(23,10)(22,9)(24,9)…(0,0)
: expected false to be true
```

**RV2（洪泛不堵门，值取到外侧）** → 用例 c 红：

```
AssertionError: 全图恰有两个门位：G(23,9) 与大厅侧的 (16,9):
expected [] to deeply equal [ '16,9', '23,9' ]
```
（值得记录的机制：门格未被堵住时被自己的洪泛覆盖，按 CE 322-330 的
次序被清出门位集——CE 原文的次序语义在这里自己证明了自己。）

**RV3（元断言 id 拼错）** → blueprint_center 用例 d 红：

```
AssertionError: isCenterTreasure 点名的 id 在数据表中不存在（拼写错误或已删项）
……scroll_of_enchant: expected [ 'scroll_of_enchant' ] to deeply equal []
```

**RV4（删密库地板退出牌堆）** → 用例 a（390 层扫描）红：

```
AssertionError: 端到端存在不可达层（机器阶段仍在切断关卡）：
424242/D17（可达 814 格）
424242/D19（可达 28 格）      ← 楼梯被封进密库的典型形态
777/D3（可达 17 格）
777/D21（可达 932 格） …
```

四条均已还原（`grep RV` 残留 = 0），还原后目标测试复绿。

## 8. 门禁输出（完整尾部）

**`npm test`**（227.83s）——**除 `generation_baseline` 外全绿**：

```
 Test Files  1 failed | 53 passed (54)
      Tests  1 failed | 553 passed | 8 skipped | 5 todo (567)
   Start at  21:32:50
   Duration  227.83s (transform 2.42s, setup 0ms, import 14.34s, tests 1342.35s, environment 15ms)
```

- **红的 1 条**：`generation_baseline.test.ts` —— 4 seed × D1-D26 的
  fp/怪物数/物种集/物品数全面漂移。**成因**：机器阶段 RNG 消费改变
  （旧 `shuffleList(candidates)` 消失、新增门位 `randRange(0, K-1)`、
  成功台数变化）导致 RNG 流自 buildMachines 起移动，populateLevel 的
  楼梯/钥匙/物品/怪物落点全部改变。**按边界未刷新 fixture**，
  请验收方授权重捕获（先例：P1-29、C-0 各重采一次）。
- 8 skipped / 5 todo 为既有状态，与本轮无关。

**`npm run build`** —— 绿：

```
dist/assets/WebGLRenderer-BjPG0Ofc.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-DeAPcokF.js               753.15 kB │ gzip: 229.38 kB

(!) Some chunks are larger than 500 kB after minification. Consider: …
✓ built in 2.86s
```
（chunk 体积警告为既有状态。）

## 9. git diff --stat（另有 1 个未跟踪新文件）

```
 brogue-web/src/engine/Generator/BlueprintEngine.ts | 202 ++++++++++++++++-
 brogue-web/src/engine/Map/LoopMap.ts               | 249 +++++++++++++++++--
 brogue-web/src/test/blueprint_center.test.ts       |  76 ++++++-
 brogue-web/src/test/p1_26_invariants.test.ts       |  31 +--
 .../src/test/p1_29_lake_connectivity.test.ts       |  19 +-
 5 files changed, 516 insertions(+), 61 deletions(-)
```
未跟踪新文件：`src/test/p1_33_machine_chokepoint.test.ts`（442 行）。
调试探针（基线/解剖/地图/性能 4 个 scratch）均已在交付前删除并复核。

## 10. 与预设不符之处（只列不修）

1. **"仅 chokeMap 门位选址达不成坏层归零"**——任务书的病灶诊断
   （"LOCKED_DOOR 或特征水放在唯一通路上"）正确但不完整。实测归因：
   旧坏层中既有"锁在通路上"，也有"楼梯/钥匙牌堆与密封口袋的交互"
   （Game.populateLevel 从全图 FLOOR 牌堆随机放楼梯，CE 以 IS_IN_MACHINE
   回避避免、web 无此机制）。三件配套（§3）缺一则 15 种子复验不复为零，
   均有反向验证或坏层解剖实证。若验收方认为某件越权，请明确裁决删除哪件
   ——删除后坏层必然回升（RV4 输出即为预期形态）。
2. **CE 割点语义与任务书的隐含预期不同**：任务书把门位候选理解为
   "走廊割点"；CE 实现里**每个直走廊格都是 IS_CHOKEPOINT**（跳变数 4>2），
   但只有"邻着开阔（非割点）格"的割点会被洪泛赋值、成为有值的
   IS_GATE_SITE。走廊中段格 chokeMap 恒 30000，天然落选。用例 c 把这一
   语义钉死。
3. **`invented_content_pool` 初版超时**：我的第一版实现让该 520 层测试
   在全量并发下顶破 120s（既有测试，禁改）。已用决策等价优化解决
   （§3 末），机器统计逐位不变。此条说明"为什么改了性能而不只是功能"。
4. **blueprint_center 用例 c 的样本源**：修复前 `treasuresAtCenter` 的样本
   实为"随机通用掉落恰好落在 center 坐标"的巧合（牌堆当时含机器格）；
   修复后巧合消失，样本改由 Game 旧式机器循环的**魔杖分支**供给
   （12 种子 410 件）。为此给 `isCenterTreasure` 补了 `wand_` 前缀——
   该前缀同时受新元断言看守（P1-36 的 `wand_of_fire` 正是 wand 族的
   退池案例，现在整族消失会立刻翻红）。守卫没有削弱：非空转护栏
   （>0）原样保留且更真实。
5. **Game.ts 的 `spawnScroll('scroll_of_enchanting')` 拼写错误仍在**
   （ItemLoader 查无此 id 返 null，机器宝藏的 scroll 分支恒死）。
   P1-36 修了测试侧列表、没修 Game.ts 调用侧；Game.ts 本轮禁改，
   登记待后续轮次。
6. **`git diff --stat` 与"不要执行任何 git 命令"的冲突**：报告模板刚需
   此项，采用了只读调用（见报告头部声明）。
7. 任务书说验收方判断"C-0/C-1 落地后坏层可能自然消失"已被证伪——
   实测 C-1 后坏层 3/260（10 种子），15 种子扩展后为 5/390，任务书
   的"不能再等"判断正确，本轮如约归零。

## 11. 验收条款逐条对照

| 条款 | 状态 | 证据 |
|---|---|---|
| 实现 chokeMap（analyzeMap 246-336） | ✓ | LoopMap.ts `analyzeChokeMap`；归属选择与理由见 §1 |
| 机器选址改用 chokeMap（IS_GATE_SITE + roomSize 窗口） | ✓ | `findGateRoom`；roomSize 字段已有，语义对齐 CE，未造新字段（§3） |
| p1_29 已知坏层集 → 空集且真绿 | ✓ | `KNOWN_MACHINE_STAGE_BAD_LEVELS = []`，10 种子端到端全绿 |
| p1_26 KNOWN_UNREACHABLE_STAIRS_LEVELS → 0 且真绿 | ✓ | 改为 0，130 层 0 不可达 |
| 兜底条款（无法归零时报告） | 不适用 | 完全归零（390/390） |
| P1-36 元断言 | ✓ | blueprint_center 用例 d + CENTER_TREASURE_IDS/PREFIXES 常量化 |
| 不做 C-2 液体/镶边/建桥；不动 Game.ts、SafetyMap、WaypointMap | ✓ | diff 仅 5 改 1 增，全部在允许清单内 |
| 不刷新 fixtures；generation_baseline 变红如实报告 | ✓ | 未动 fixtures；§8 说明成因与重捕获请求 |
| 对抗性 ≥4 条 | ✓ | AD1-AD4 + c2 元断言（§6） |
| 全部行为断言打真实生成关卡 | ✓ | 用例 a/f 全链路；合成图仅用于错误实现定位 |
| ≥15 种子 × D1-D26 零不可达，报告贴汇总 | ✓ | §5（390 层，坏层=无） |
| 反向验证 ≥2 条（真实失败输出） | ✓ | 4 条（§7） |
| 决定性（同种子同图有测试锁住） | ✓ | 用例 e：D1-D8 机器布局 digest + 地形指纹逐一一致 |
| 不靠少放机器蒙混（前后数量对比） | ✓ | §4 表 + 防塌缩下限断言 |
| 新测试可在具体错误实现下失败 | ✓ | 每条对应错误实现见 §6；RV1-4 实证 |
| 既有测试不改（除授权三件） | ✓ | p1_29/p1_26 仅动已知集与注释（断言结构未削弱）；blueprint_center 仅加元断言及必要的常量化/前缀补充（§10.4） |
| RNG 流移动须在报告说明 | ✓ | §8 红条成因；generateTerrain/湖泊/环路阶段（p1_29 合同、决定性指纹）不受影响 |
