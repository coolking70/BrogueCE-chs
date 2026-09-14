# P4-8 报告：气味图（scent map）

日期：2026-09-15
工作目录：`brogue-web/`；CE 事实来源：`../BrogueCE-master/src/brogue/`（只读）

---

## 〇、与任务书预设不符之处（只列不修）

1. **"看不见就傻站"的病灶描述不精确。** 改动前的旧实现是：HUNTING 怪物在
   看不见玩家但直线距离 ≤ `playerDetectRange + 2` 时，**无视遮挡直接向玩家
   坐标作弊寻路**（`Pathfind.findPath` 直指玩家现坐标）；超过该距离才掉回
   WANDERING。即"近了开挂穿墙追、远了直接放弃"，不是"傻站"。两种毛病本轮
   一并修掉。
2. **"web 目前不保留离开层的状态"不成立。** `generateDepth` 会把离开层的
   grid/environment/fov/lightMap/monsters/items 存进内存 `levels` Map，重返
   旧层时恢复。web 缺的只是**气味图**的跨层留存（本轮按"明确不做"未加入
   LevelState，重返旧层拿到全新空白气味图，见"未实现项"第 1 条）。
3. **半径描述小误差**：CE `getFOVMask` 的半径实参是 `DCOLS * FP_FACTOR`
   （Time.c:770-771），不是 `DCOLS` 本身——效果上同为"无圆形截断的整图"。
   web 取 `DCOLS + DROWS`（≥ 地图对角线 84），同样不截断任何格。
4. **任务书未提及、但 CE 存在且已一并实现的机制**（非冲突，补充登记）：
   - 隐身时 `scentTurnNumber += 10`（否则 `+= 3`），Time.c:2506-2509；
   - `rogue.scentTurnNumber` 初值 1000（RogueMain.c:378）；
   - `> 20000` 触发回卷的门（Time.c:2511-2513）；
   - `scentDirection` 的**对角弥散重试**（Monsters.c:2884-2896，会写入
     scentMap，确定性）与 `isLocalScentMaximum` 死路判定（Monsters.c:2820-2840）。
5. **任务书所列 CE 行号全部核实无误**（scentDistance Time.c:756-762、
   updateScent Time.c:764-782、addScentToCell Movement.c:2875-2882、
   updateScent 调用点 Time.c:2610、15000 回卷 Time.c:2924-2942）。

---

## 一、改动清单

| 文件 | 改动 |
|---|---|
| `src/engine/Map/Scent.ts`（新增） | `scentDistance` / `obstructsScent` / `obstructsPassability` / `ScentMap`（turnNumber、addScent、update、resetTurnNumber、isLocalScentMaximum、stepDirection） |
| `src/engine/Lighting/FOV.ts` | 新增 `computeFOVMask` + `castLightMask`：按自定义遮挡谓词算全图 FOV 掩码。现有 `computeFOV`/`castLight` 一字未动（掩码版是刻意的结构复制，遮挡判定换成谓词、输出写掩码） |
| `src/engine/Core/Game.ts` | `scent` 字段；两层生成处换新 ScentMap；`playerTurnEnded` 主观块挂 `scentTurnNumber` 推进 + `updateScent` |
| `src/entities/Monster.ts` | `givenUpOnScent` 字段；HUNTING 重见玩家清闩锁；**删除**旧"距离 > 阈值即弃追"判定；移动分支接入气味梯度 + 死路规则 |
| `src/test/p4_8_scent_map.test.ts`（新增） | 10 条测试（含 5 类对抗性 + 绕拐角 + 决定性 + 对照组） |

禁改文件（DetailGenerator.ts、data/*.json、fixtures/*、Random.ts、Gas.ts）
均未触碰；未执行任何 git 写操作；无临时文件残留。

## 二、CE 行号对照

| CE | web |
|---|---|
| `scentDistance` Time.c:756-762 | `Scent.ts scentDistance`（长轴×2+短轴，逐行对照） |
| `updateScent` Time.c:764-782 | `ScentMap.update`（掩码遍历盖章 + 玩家格单独写 0） |
| `getFOVMask(..., T_OBSTRUCTS_SCENT, 0, false)` Time.c:770-771 | `Game.playerTurnEnded` → `fov.computeFOVMask(px, py, DCOLS+DROWS, obstructsScent)` |
| `addScentToCell` Movement.c:2875-2882 | `ScentMap.addScent`（`||` 条件原样照抄） |
| 主观块 `scentTurnNumber += 3 / += 10（隐身）` Time.c:2506-2509 | `playerTurnEnded` 内 `this.scent.turnNumber += player.hasStatus('invisible') ? 10 : 3` |
| `> 20000 → resetScentTurnNumber` Time.c:2511-2513 + Time.c:2924-2942 | 同位置 `resetTurnNumber()`（单层版：值 >15000 减 15000，否则清零） |
| `updateScent()` 调用点 Time.c:2610（主观块、怪物循环前） | `playerTurnEnded` 内、animation/advancement 分叉之前 |
| `isLocalScentMaximum` Monsters.c:2820-2840 | `ScentMap.isLocalScentMaximum`（省略 diagonalBlocked，见§六） |
| `scentDirection` Monsters.c:2842-2900（nbDirs 顺序 GlobalsBase.c:38） | `ScentMap.stepDirection`（同序 N S W E NW SW NE SE、严格大于、并列取先、对角弥散重试一次） |
| 追击移动 Monsters.c:3447-3486 | `Monster.takeTurn` HUNTING 移动分支（见§四） |
| `MB_GIVEN_UP_ON_SCENT` Monsters.c:3466-3481（置位）/ 2101、3234（清除） | `Monster.givenUpOnScent`（死路且 ALWAYS_HUNTING 置位 → 直寻；重见玩家清除） |

## 三、`T_OBSTRUCTS_SCENT` 的 web 近似方案

CE（Rogue.h:1947）：
`T_OBSTRUCTS_SCENT = PASSABILITY | VISION | AUTO_DESCENT | LAVA_INSTA_DEATH | IS_DEEP_WATER | SPONTANEOUSLY_IGNITES`

web `obstructsScent(cell)`：
`!cell.isPassable || cell.isOpaque || terrain ∈ {CHASM, LAVA, WATER_DEEP}`

- `PASSABILITY → !isPassable`（WALL/GRANITE/SECRET_DOOR）
- `VISION → isOpaque`（含 DOOR——web 与 CE 同构：CE 的关闭门带
  T_OBSTRUCTS_VISION（Globals.c:328）而不带 T_OBSTRUCTS_PASSABILITY）
- `AUTO_DESCENT → CHASM`、`LAVA_INSTA_DEATH → LAVA`、`IS_DEEP_WATER → WATER_DEEP`
- `SPONTANEOUSLY_IGNITES`：CE 全表仅 brimstone（Globals.c:425-426）持有，
  web 无对应地形，无近似对象（已登记，未凑数）。

`addScentToCell` 第二个条件的 `T_OBSTRUCTS_PASSABILITY` → `obstructsPassability = !isPassable`。

## 四、`||` 条件的照抄说明

CE Movement.c:2877-2878 原文：

```c
if (!cellHasTerrainFlag((pos){x, y}, T_OBSTRUCTS_SCENT) ||
    !cellHasTerrainFlag((pos){x, y}, T_OBSTRUCTS_PASSABILITY)) {
```

**照抄，未"修正"。** 写值条件 = `!挡气味 || !挡通行`，即只有"既挡气味又挡
通行"的格子才完全不留味。

**我认为这不是笔误，而是刻意设计**：CE 的关闭门挡视线（T_OBSTRUCTS_VISION ∈
T_OBSTRUCTS_SCENT）但不挡通行（推门即过，Globals.c:328 的 DOOR 无
T_OBSTRUCTS_PASSABILITY），深水同样"挡味不挡通行"。靠这条 `||`，门格与
深水格会留下气味——怪物才能"隔着关着的门闻到你"，把门当作气味跳板一路
追进门里。若改成 `&&`，门格永远 0 值，怪物在门前死路、追踪在门口断裂，
与 CE"顺着你走过的路追上来"的手感正好相反。T3/T5 两条测试把这个行为锁死
（T5 里怪物确实踩过门格贴脸）。

## 五、怪物接入点的选择理由

接入点：**`Monster.takeTurn` 的 HUNTING 移动分支**（贴脸近战/保持距离/
几何射线判定之后、直寻 Pathfind 之前），选择理由：

1. CE 的对应逻辑（Monsters.c:3447-3486）就在同构位置——怪物移动决策内部、
   近战判定之后；web 的 HUNTING 分支是唯一语义对齐的挂点。
2. 触发条件取 `!canSeePlayer`（任务书口径"看不见玩家时顺气味梯度"）；
   可见时维持既有直寻不变（可见追击行为与既有测试零回归，全量套件已验证）。
3. **同时删除了旧的 `!canSeePlayer && distToPlayer > playerDetectRange + 2 →
   WANDERING` 早退判定**。理由：CE 没有按直线距离丢目标的机制，它的"丢目标"
   就是死路规则本身；留着距离阈值会把还在气味梯度上的怪物提前掐死，绕拐角
   追击（本轮的核心价值）在中途必被该阈值杀死。
4. 死路规则照 CE（Monsters.c:3475-3484）：`stepDirection` 无路 +
   `isLocalScentMaximum` 为真时——
   - `MONST_ALWAYS_HUNTING`：置 `givenUpOnScent`，改走直接寻路
     （CE pathTowardCreature + MB_GIVEN_UP_ON_SCENT 兜底，Monsters.c:3466-3481）；
   - 其余：不在玩家视野内 → 回 WANDERING；在玩家视野内 → 原地保持追踪
     （CE 的"may just stand motionless but hunting"）；
   - 有更浓邻格但进不去（被占/不可进）→ 本回合原地（CE 同，isLocalScentMaximum
     为假、scentDirection 为 null 的中间态）。
5. 移动准入回调（monsterAvoids 的 web 近似）与既有直寻/移动完全同口径：
   飞行 `!isOpaque`、限液怪只进液体、其余 `isPassable`，一律要求无怪物、
   非玩家格。气味步经由 `tryMoveTo` 落地，自动获得 P4-6 的鞭/矛移动钩子
   与蛛网挣扎（与 CE 把几何检查挂在 moveMonster 内同构）。

**主动省略（行为偏差，如实登记）**：CE `awareOfTarget`/`awarenessDistance`
（Monsters.c:1636-1694）的数值感知包络（`perceived > stealthRange*3 → 弃追`、
`stealthRange < perceived ≤ 3×` 时每回合 3% 掷骰丢目标）未移植。原因：
(a) 3% 掷骰会消耗种子化 RNG，移动 RNG 流、作废既有种子基线（项目常识§四）；
(b) web 的 `calculateStealthRange`（3~7）与 CE（基准 14，暗处/阴影减半，
7~14+）标度不同，直接移植数值包络会让 web 怪物比 CE 早 2~4 倍丢目标，
失真比"只用死路规则"更大。后果：web 追踪怪比 CE 更"咬定青山不放松"
（沿梯度追到死路为止），这是已知并接受的偏差。

## 六、已知简化与未实现项清单

1. **跨层气味留存**（CE `levels[d].scentMap`，Time.c:2924-2942 遍历各层）
   ——明确不做。web 换层即换新 ScentMap，重返旧层为空白图；15000 回卷的
   **单层部分**已实现（`resetTurnNumber`），跨层遍历无对象。
2. **awarenessDistance/awareOfTarget 数值包络与 3% 丢目标**——见§五末，
   以死路规则替代。
3. **闻味醒来**：CE 中 WANDERING 怪可经 awareOfTarget（25% 掷骰）凭气味
   进入追踪；web 醒 Monterey 仍需 LOS + 探测距离（未改，超范围且含 RNG）。
4. **wanderToward(lastSeenPlayerAt)**（CE 死路后走向最后目击点）——web 无
   lastSeen 记账，退化为普通 WANDERING（Monsters.c:3484 的简化）。
5. **canPass**（CE 怪物互相穿行的占用豁免）——scentDirection 的占用检查用
   "目标格无怪物"近似（与既有 Pathfind 谓词同口径）。
6. **diagonalBlocked**（对角墙角）——web 全局无该机制，scentDirection/
   isLocalScentMaximum 两处邻接检查均省略（P4-5/P4-6 以来同口径）。
7. **T_SPONTANEOUSLY_IGNITES**（brimstone）——web 无对应地形，见§三。
8. **MONST_ALWAYS_HUNTING 数据面**：monsters.json 现无任何怪物携带该标志
   （grep 仅有 MONST_NEVER_SLEEPS），`givenUpOnScent` 闩锁路径对真实数据
   当前不可达，机制按 CE 语义就位。
9. **气味调试可视化**（IO.c:1437-1495）——明确不做。

## 七、测试与对抗性对照（`src/test/p4_8_scent_map.test.ts`，10 条全绿）

| 测试 | 捕获的错误实现 |
|---|---|
| T1 | `scentDistance` 写成欧氏/切比雪夫/曼哈顿——用长短轴不等的点对 (0,0)→(3,1)：CE=7、切比雪夫=3、欧氏取整=3、曼哈顿=4，三者/四者互斥 |
| T2 | 气味值符号写反（"越新越小"→ tn+d）或把距离当值——对多处格断言精确值 `1003-d` |
| T3 | `addScentToCell` 的 `||` 被"修正"为 `&&`——门格与深水格在 `&&` 下永远 0（CE 关门正是靠 `||` 留味）；附带验证门对气味仍遮挡（门后 0）与浅水对照 |
| T4 | `updateScent`/`scentTurnNumber` 挂到 100-tick 客观块——haste（50 tick/动作）两动作后：主观实现 tn=+6、参考格=998；客观块实现 tn=+3、参考格=995，双断言双杀（含"+=3 主观但 update 客观"的混合错误） |
| T5 | 怪物顺梯度走成**下坡**（argmin 背离玩家）、原地打转、或因 `&&` 在门前死路——走廊 + 门场景断言 x 严格推进到 ≥52（踩过门格）、贴脸、全程 HUNTING |
| T6 | **绕拐角**：L 形墙（竖臂 x=52 y∈[4..22]、横臂 y=22 x∈[52..64]）两侧不可见、起点距玩家 22——旧实现（距离阈值弃追）在起跑线即死；断言最终贴脸 + 轨迹不踩墙 + 确实从南走廊穿越 x=52 墙线 + 到达过横臂东端以东 |
| T7 | 决定性：同种子同操作序列两跑 → 气味图 FNV 哈希、怪物轨迹、结果全等（气味链路零随机：updateScent/stepDirection/addScent 无任何 rng 调用） |
| T8 | 对照组：玩家静止 N 回合——脚下恒等于当前 `turnNumber`；视野内远处格 = `tn - d`；被遮挡格冻结在旧值、相对年龄单调递增 |
| T9 | 隐身 +10/回合遗漏（Time.c:2506-2509） |
| T10 | 20000 回卷未接或顺序错（应先回卷后盖章：tn=5001、脚下=5001、邻格=4999） |

T6 实测轨迹（43 步，全 HUNTING，零 RNG）：

```
37,7 → 38,8 → … → 50,20（对角气味锥直插）→ 50,21 → 51,22 → 52,23（钻过拐角）
→ 53,23 → … → 61,23 → 62,24 → 63,23 → 64,23 → 65,22（翻过横臂东端）
→ 64,21 → … → 58,10 → 58,9（贴脸，捕获）
```

一个有意思的实测发现：横臂西侧 (51,22) 是开阔地，玩家等待时气味锥从拐角
"漏"进左区，怪物借这条泄漏锥从 (51,22)→(52,23) 直接钻过弯——这与 CE 的
线状气味传播物理一致（气味绕角），不是穿墙。

## 八、反向验证（真实失败输出）

**R1：`scentDistance` 改坏为曼哈顿距离（`dx + dy`）→ T1 失败，共 7 条失败：**

```
 ❯ src/test/p4_8_scent_map.test.ts (10 tests | 1 failed) 111ms
     × T6 绕拐角：L 形墙隔断视线，怪物沿气味轨迹绕过横臂东端贴脸玩家 23ms
（改坏后重跑）
 ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … > T1 scentDistance 是"长轴×2+短轴"，与欧氏/切比雪夫/曼哈顿全部可区分
 AssertionError: expected 4 to be 7 // Object.is equality
 - Expected  + Received
 - 7
 + 4
```

**R2：`addScent` 的 `||` 改坏为 `&&` → 恰好只有 T3 失败：**

```
 ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … > T3 addScentToCell 的 || 条件（Movement.c:2877）：门与深水留味，门后无味
 AssertionError: expected +0 to be 991 // Object.is equality
 - Expected  + Received
 - 991
 + 0
 ❯ src/test/p4_8_scent_map.test.ts:139:40
```

两处改坏均已还原，还原后全量套件恢复 433 通过。

## 九、门禁输出（完整尾部）

**`npm test`（`npx vitest run --no-file-parallelism`，上一轮 423 通过 → 本轮 433）：**

```
 Test Files  41 passed (41)
      Tests  433 passed | 7 skipped | 5 todo (445)
   Start at  02:16:02
   Duration  35.24s (transform 347ms, setup 0ms, import 1.52s, tests 30.58s, environment 6ms)
```

**`npm run build`：**

```
dist/assets/WebGLRenderer-BEo8956m.js        68.42 kB │ gzip:  18.72 kB
dist/assets/index-ll5lYdOm.js               922.52 kB │ gzip: 291.06 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit this warning via build.chunkSizeWarningLimit.
✓ built in 1.38s
```

（chunk 体积警告为既有现象，非本轮引入；`vue-tsc -b` 类型检查零错误。）

**`git diff --stat`（新增文件不入 stat，见 git status）：**

```
 brogue-web/src/engine/Core/Game.ts    | 29 +++++++++++++
 brogue-web/src/engine/Lighting/FOV.ts | 80 ++++++++++++++++++++++++++++++++++-
 brogue-web/src/entities/Monster.ts    | 65 ++++++++++++++++++++++++++--
 3 files changed, 169 insertions(+), 5 deletions(-)
```

新增（未跟踪）：`src/engine/Map/Scent.ts`、`src/test/p4_8_scent_map.test.ts`。

## 十、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| scentMap + scentTurnNumber，每玩家回合更新，挂主观块（不得挂 100-tick 客观块） | ✅ `playerTurnEnded` 主观块（ticks 调整后、animation/advancement 分叉前）；T4 双断言锁死 |
| scentDistance / addScentToCell / updateScent 照 CE 实现 | ✅ 逐行对照（§二）；`||` 原样 |
| 怪物追踪态看不见玩家时顺气味梯度（朝相邻最大气味格） | ✅ HUNTING 移动分支（§五），含 CE 对角弥散与死路规则 |
| `T_OBSTRUCTS_SCENT` 无则用最近语义近似并说明 | ✅ §三（web 无该标志集合，用 isPassable/isOpaque + CHASM/LAVA/WATER_DEEP 近似；brimstone 无对应已登记） |
| 明确不做三项（跨层留存 / ALWAYS_HUNTING 嗅觉特判 / 调试可视化） | ✅ 均未做；跨层的单层回卷部分顺带实现（更贴 CE），跨层遍历未做并说明 |
| 对抗性测试 ≥5 条、覆盖指定五类错误实现 | ✅ T1-T5 恰好五类，另有 T9/T10 |
| 绕拐角测试（L 形墙、互不可见、走到拐角而非贴墙打转） | ✅ T6（含轨迹实证） |
| 反向验证 ≥2 条、真实失败输出入报告 | ✅ R1/R2（§八） |
| 决定性：无未播种随机、同种子同操作同图，有测试锁 | ✅ 气味链路零 rng 调用；T7 哈希+轨迹双锁 |
| 对照组：静止 N 回合，远处格相对变旧、脚下恒当前值 | ✅ T8 |
| 门禁：test 不低于上一轮、build 绿、两条输出尾部入报告 | ✅ 433 ≥ 423；build 绿（§九） |
| 文件边界 | ✅ 仅动 Game.ts / Monster.ts / FOV.ts（新增入口）/ Map 新文件 / 新测试；禁改清单零触碰 |

---

# 十一、验收打回后的补做（2026-09-15 第二轮）

> 本节是 P4-8 验收打回的返工记录。主体验收已通过的部分不重复。
> 打回要点：只实现了"气味死路"一条放弃路径，漏了 CE `awareOfTarget`
> （Monsters.c:1658-1690）的"气味太陈旧/太远"判定与 3% 丢目标；
> 且 `calculateStealthRange` 是自创公式，直接拿去算 `awareness*3` 会把
> 皮筋做短约三倍。另更正验收人两处事实认定的**确认**：
> ① 3% 写作 `rand_percent(97)`（Monsters.c:1677），上一轮我搜 `rand_percent(3)`
> 未命中是我的检索错误；② 上一轮报告指出任务书三处不准，验收人已接受。

## 11.1 实现（必做清单 1-5 逐项）

**① `awarenessDistance`（Scent.ts，照 Monsters.c:1630-1654）**

```
perceivedDistance = scentTurnNumber − scentMap[观察者格]
观察者在玩家 FOV 内 → min(perceivedDistance, scentDistance(观察者→玩家))
perceivedDistance = min(perceivedDistance, 1000)
perceivedDistance < 0 → 1000
```

CE 的 `target != &player && openPathBetween(...)` 分支不存在（web 单玩家）。
`IN_FIELD_OF_VIEW` 用 web 的 `cell.isVisible`（同为学生 FOV 标志的既有口径）。

**② `awareOfTarget`（Scent.ts，照 Monsters.c:1658-1690，分支顺序原样）**

1. `MONST_ALWAYS_HUNTING` → 恒 true
2. `MONST_IMMOBILE` → `perceived <= awareness`（无掷骰）
3. `perceived > awareness*3` → false（"out of awareness range, even if hunting"）
4. 追踪态：`perceived > awareness` → `rng.randPercent(97)`，否则 true
5. 观察者不在玩家 FOV → false
6. `perceived <= awareness` → `rng.randPercent(25)`（CE 唤醒掷骰，web 本轮
   唤醒路径未接线，见 11.3 取舍——分支本身照抄存在）
7. 其余 → false

**③ 丢失路径接线（Monster.takeTurn，唤醒判定之后、confused 之前）**

```
state===HUNTING && !MONST_ALWAYS_HUNTING →
  !awareOfTarget(...) → state = WANDERING（不 return：本回合以新状态
  继续行动，与 CE updateMonsterState 只改状态、移动照做的结构同构）
```

- `wanderToward(lastSeenPlayerAt)`：web 无 lastSeen 记账，退化为普通
  WANDERING（与死路分支同口径），登记。
- ALWAYS_HUNTING 短路在 awareOfTarget **调用之前**：CE 里该类怪物在
  updateMonsterState 首分支就 return，awareOfTarget 根本不执行——短路
  同时保证不消耗 RNG 流。

**④ `calculateStealthRange` 对齐 CE `currentStealthRange()`（Game.ts）**

逐项：隐身恒 1（Time.c:795-797）✅；基数 14（Time.c:793）✅；
IS_IN_SHADOW 减半 ✅ 近似为恒减半（见 11.3-3）；护甲
`max(0, strengthRequired − 12)`（Time.c:784-790，armors.json 直接有该字段）
✅；`justRested` 向上取整减半（Time.c:813-815）✅ 近似为"本回合输入是
wait"（CE IO.c:2521-2527 的 REST/PERIOD/NUMPAD5；web 在
handlePlayerAction 入口清零、wait 分支置位）； aggravating 与戒指
stealthBonus ❌ 略去（web 无实装，ring_of_stealth 属 D2 自创池）；下限
钳制 2/1（Time.c:826-829）✅。

**⑤ 3% 走 `rng.randPercent`（RNG_SUBSTANTIVE，同种子可复现）**：
T14 用 `rng.randomNumbersGenerated` 增量恰为 500 做了硬证据，并验证
同种子 500 次掷骰逐位复现。

## 11.2 ★ 与任务书预设的重大不符：T6 原场景在 CE 规则下不可能发生

返工前我先照任务书预期"原 T6 必须原样通过"推演，发现矛盾，实现后实测确认：
**照 CE 忠实实现的第一版，原 T6 失败（`res.caught` 为 false，老鼠第 1 回合
即被切回 WANDERING）。** 这不是实现错误，是场景构造与 CE 机制的事实冲突：

- 气味每主观回合老化 +3（Time.c:2506-2509，CE 原文核实）；
- 原场景：玩家走完全程 68 步**之后**才把老鼠放到轨迹起点 (36,6)，该格气味
  最后一次盖章约在第 47 步（此后玩家绕进竖臂东侧，视线被挡、不再保鲜）；
- 追击开始时 `perceivedDistance = tn − scent(36,6) ≈ 1204 − 1047 ≈ 157`；
- CE 硬截断 = `awareness*3 = stealthRange*6`：即便按全亮 14 算也只有 84，
  阴影下（本实现口径 7）是 42。**157 > 84**：任何 CE 忠实实现都会在第 1
  回合放弃。CE 里"缀在 30 多回合前的陈迹上继续追击"本就不会发生——
  awarenessDistance 源码注释明言"After that, we switch to wandering"。

**处理**：按任务书授权（"若翻车的是测试写死了自创公式的数值，按 CE 修正
该测试并在报告说明"——原 T6 写死的正是"无截断追击"这一自创行为预期），
把 T6 场景修正为 CE 可行的等价物，**墙体、断言种类全部保留**：

- 玩家路线改为南下 16 → 东行 30 → 在 x=66 北折 8，终点 (66,16)；
- 老鼠在第 47 步（玩家在 (66,23) 时）放到南走廊 (62,24)——模拟 CE 真实的
  绕拐角追击："怪物一直缀在队尾，玩家刚拐过臂端 4 回合"。此时该格
  perceived ≈ 33 < 42（截断内），且 (65,22) 起进入玩家每回合保鲜区
  （perceived ≤ 14，连 3% 掷骰都不触发）；
- 保留断言：贴脸 caught、终态 HUNTING、全程不踩墙、x=52 穿越仅限 y≥23、
  绕过横臂东端（轨迹达 x≥65）、T7 同种子决定性。

修正后的 T6 + T7 + 全部旧测试通过（含 T5：种子在 6 次 97% 掷骰下保住
老鼠，实测验证）。**任务书"新鲜痕迹不会被误甩"的本意——绕拐角能力不被
感知判定掐死——由修正后的 T6 承接；"原场景必须原样通过"在 CE 语义下
无法成立**，以上算术供复核。

## 11.3 取舍与已知分歧（逐项）

1. **唤醒路径未改接 awareOfTarget**：CE 的 ASLEEP→唤醒 / WANDERING→警觉
   走 25%/回合掷骰（Monsters.c:1784-1786 + awareOfTarget 第 6 分支）；web
   保持既有"可见且 dist ≤ stealthRange 即刻唤醒"。stealthRange 数值已按 CE
   对齐（7~14+护甲），但"即刻 vs 25%/回合"仍是分歧，登记不改——改动会
   全面移动 RNG 流并波及全部交战测试，超出本轮授权。
2. **IMMOBILE 感知分支未接线**：CE 的炮塔类 !aware → SLEEPING、aware →
   TRACKING（updateMonsterState IMMOBILE 分支）；web 的 IMMOBILE 怪在
   takeTurn 早退（862 行），无沉睡/唤醒状态机。awareOfTarget **函数内**
   分支照抄存在（T13 直调验证），但 takeTurn 不为炮塔消费它。接线会改变
   p4_1b 炮塔测试的前提（炮塔在玩家出视野时停火/沉睡），留待专项。
3. **IS_IN_SHADOW 近似为"恒处于阴影"**：CE 里矿灯不驱散阴影
   （Light.c:70-71），玩家只有在岩浆/火把等地形光源下才解除；web 目前唯一
   光源就是玩家自己的火把（LightMap 无地形光源、`Cell.light` 全工程无写入
   方——旧公式的 `LIT→+4` 实为死代码，顺带查明）。故恒减半：基数 14 → 7。
   将来接入地形光源后应改为查询玩家格。
4. **playerInDarkness 略去**：web 无"矿灯可被调暗"概念（无 STATUS_DARKNESS、
   无潜水光衰减）。
5. **远距 discordant+HUNTING 的窄场景**：CE 的 discord 撕咬按 status 判定、
   不受 creatureState 门控（monsterWillAttackTarget，Monsters.c:330-365），
   WANDERING 也咬；web 把咬人逻辑关在 HUNTING 分支内（上一轮的结构选择）。
   本轮截断会让"距玩家超截断的 discordant+HUNTING"怪先掉 WANDERING、
   随之停止撕咬——CE 里它掉 WANDERING 但**继续咬**。该结构缺口系既有，
   被截断暴露的窗口很窄（discord 弹道本身要求玩家可见目标），按边界纪律
   只登记不动手。
6. **awareOfTarget 第 6 分支（rand_percent(25)）暂无消费方**：唤醒路径未接
   （取舍 1），分支照 CE 保留并有直调测试路径。

## 11.4 对既有测试的改动（按授权，逐处说明）

| 文件 | 改动 | 归类依据 |
|---|---|---|
| `p4_8_scent_map.test.ts` T6/T7 | 场景修正（11.2），断言种类全保留 | 测试写死"无截断追击"自创行为预期 |
| `scroll_effects.test.ts` discord 两条 | 舞台补一行气味盖章（全真掩码） | 测试写死"HUNTING 无条件保持"：直调 takeTurn 且玩家从未行动 → 气味图全空 → perceived=1000 → CE 判定必然丢目标。CE 语义下"追踪怪保持追踪的前提是气味可达"，补章即舞台自洽（perceived 4/9 ≤ awareness 16，不引入掷骰、不移动 RNG 流） |
| `p2_3_objective_time.test.ts` | **未动** | 见 11.5，fixture 在禁区 |

## 11.5 p2_3 基线失败：预期之中、本轮不可修，需下一轮重捕获

`p2_3_baseline.json` 在 `src/test/fixtures/*`——本轮**禁改**（任务书明令
"不许重新捕获"）。本轮改动按项目常识 §4 移动了 RNG 流：

- 新增 3% 丢目标掷骰（追踪态且 awareness < perceived ≤ awareness*3 时
  每回合消耗 1 次实质随机数）；
- 怪物按 CE 提前放弃追踪（400 回合内的位置/存活序列改变）；
- stealthRange 口径变化改变唤醒/惊觉时机（间接移动流）。

失败内容：4 seed × 400 回合的玩家位置/怪物清单与旧基线全面偏离（输出见
门禁小节）。这不是回归，是**被本轮授权改动必然移动的基线**；该测试标题
自述"（本轮后的新基准）"，设计上就等授权轮重捕获。**请下一轮任务书明确
授权重捕获 `p2_3_baseline.json`**（及复核 `generation_baseline.json` 是否
受影响——本轮未触碰任何生成期代码，生成指纹测试全绿，预期不受影响）。

## 11.6 新增测试（T11-T14，对抗性说明随测）

| 测试 | 钳制的错误实现 |
|---|---|
| T11 陈旧痕迹必须能甩掉（**验收核心**） | 返工前的实现（无感知判定，只认死路）：perceived 402 ≫ 42 仍永追；冻结格构造复用 T8 手法（墙西侧盖章→玩家过墙→纪元拉快 132 回合） |
| T12 `awareness*3` 硬截断 "even if hunting" | "截断只对非追踪态生效"的错误实现；可见 + 每回合保鲜仍被截 |
| T13 ALWAYS_HUNTING 对照组 | "截断无差别适用"的错误实现；直调 awareOfTarget 恒真 + 端到端陈旧格仍 HUNTING（phylactery：数据表唯一朴素 ALWAYS_HUNTING，兼 IMMOBILE/INANIMATE——恰与 CE 一致地绕开本轮未接线的 IMMOBILE 分支） |
| T14 3% 固定种子统计 | 三类错误同时钳制：`rand_percent(50)`（kept≈250）、写反 `rand_percent(3)`（≈15）、忘掷骰恒 true（500）；`rng.randomNumbersGenerated` 增量恰 500 证明走实质流；同种子逐位复现 |

任务书要求的"绕拐角回归闸门"由修正后的 T6/T7 承接（11.2）。

## 11.7 反向验证（真实改坏 → 真实失败 → 还原）

**RV1：`awareness*3` 改坏为 `awareness`**（Scent.ts 单行注入）：

```
 × T5 追踪怪顺梯度上坡、把门当气味跳板，直至贴脸（下坡/原地/弃味实现皆败） 11ms
 × T14 追踪态 3% 丢目标：走 RNG_SUBSTANTIVE（500 次计数可证）、同种子逐位可复现、统计上远高于半数保持 5ms
  Tests  2 failed | 12 passed (14)
```

截断过紧：T5 门廊追击起跑 perceived 22 > 14 即弃；T14 掷骰分支永不可达
（kept=0）。T11/T12 不区分 ×1/×3（perceived 402/50 都远超两者）——钳制
×1 的职责由 T5/T14 承担，四条互锁。

**RV2：`perceivedDistance` 符号搞反**（`get − turnNumber`，恒负 → 1000）：

```
 × T5 追踪怪顺梯度上坡、把门当气味跳板，直至贴脸（下坡/原地/弃味实现皆败） 12ms
 × T6 绕拐角：L 形墙隔断视线，怪物顺气味锥钻过拐角、绕过横臂东端贴脸玩家 25ms
 × T12 awareness*3 硬截断在 HUNTING 态也生效（"even if hunting"）——可见也截 5ms
 × T14 追踪态 3% 丢目标：走 RNG_SUBSTANTIVE（500 次计数可证）、同种子逐位可复现、统计上远高于半数保持 5ms
  Tests  4 failed | 10 passed (14)
```

符号反 = 全场视为彻底失踪，一切追踪立即崩塌。还原后 14/14 恢复，注入
痕迹 grep 为零，最终 diff 已复核。

## 11.8 门禁输出尾部

**`npm test`（并行）与 `--no-file-parallelism` 双口径一致**（并行本轮未复现
负载抖动；验收口径仍按记忆惯例用串行复核过一次）：

```
 Test Files  1 failed | 40 passed (41)
      Tests  1 failed | 436 passed | 7 skipped | 5 todo (449)
```

唯一失败即 11.5 的 p2_3 基线（fixture 禁区，本轮不可修）。

```
 FAIL  src/test/p2_3_objective_time.test.ts > P2-3 F: p2_3_baseline 一致性 > 4 seed × 400 回合玩法状态与 p2_3_baseline 一致（本轮后的新基准）
AssertionError: expected [ …(20) ] to deeply equal []
```

**`npm run build`**：

```
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.35s
```

（chunk 体积警告为既有现象；`tsc --noEmit` 零错误。）

**`git diff --stat`（含上一轮未提交的 P4-8 主体，新增文件不入 stat）：**

```
 brogue-web/src/engine/Core/Game.ts         | 89 ++++++++++++++++++++++++++----
 brogue-web/src/engine/Lighting/FOV.ts      | 80 ++++++++++++++++++++++++++-
 brogue-web/src/entities/Monster.ts         | 86 +++++++++++++++++++++++++++--
 brogue-web/src/test/scroll_effects.test.ts | 13 +++++
 4 files changed, 253 insertions(+), 15 deletions(-)
```

新增（未跟踪）：`src/engine/Map/Scent.ts`、`src/test/p4_8_scent_map.test.ts`
（本轮返工追加 awareOfTarget/awarenessDistance 与 T11-T14）。

## 11.9 验收条款逐条对照（打回单必做清单 + 测试要求）

| 打回单条款 | 状态 |
|---|---|
| 1. awarenessDistance 照 CE（陈旧度 + FOV 内取 min + 上限 1000 + 负值转 1000） | ✅ §11.1①；T12 断言感知值精确为 50 |
| 2. awareOfTarget 分支照 CE（恒真/IMMOBILE/×3 截断/97%） | ✅ §11.1②，分支序原样；rand_percent(25) 分支照抄（消费方未接线已登记） |
| 3. 追踪怪 !awareOfPlayer → WANDERING（Monsters.c:1776-1779） | ✅ §11.1③；wanderToward 退化已登记；T11 端到端 |
| 4. calculateStealthRange 对齐 CE currentStealthRange | ✅ §11.1④；缺概念项逐项说明（§11.3-2/3/4） |
| 5. rand_percent(97) 走 RNG_SUBSTANTIVE、同种子可复现 | ✅ T14：500 次计数硬证据 + 逐位复现 |
| 测试1 陈旧痕迹必须能甩掉（验收核心） | ✅ T11 |
| 测试2 绕拐角回归闸门重跑 | ⚠️ 场景按 11.2 修正后通过——原样无法通过（CE 机制下该追击不可能发生），算术已列 |
| 测试3 ×3 截断 even if hunting | ✅ T12 |
| 测试4 ALWAYS_HUNTING 对照组 | ✅ T13 |
| 测试5 3% 固定种子、统计断言 | ✅ T14 |
| 测试6 反向验证 ≥2（×3→×1、符号反） | ✅ §11.7，真实失败输出 |
| 边界（可改 4 文件+新测试；禁改清单） | ✅ Game.ts/Monster.ts/Scent.ts/FOV.ts（上轮入口，本轮未再动）+ 两个测试文件；fixtures/data/Random/Gas/DetailGenerator 零触碰（p2_3 基线因禁区不可修，11.5） |
| 门禁 test ≥433、build 绿 | ✅ 436 ≥ 433（串行/并行双口径一致）；build 绿；唯一红项为禁区 fixture，已申报 |
| 报告追加本轮末尾、标明补做 | ✅ 本节 |
