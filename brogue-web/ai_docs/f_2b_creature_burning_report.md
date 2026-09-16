# F-2b 报告：生物燃烧状态机 + 火免通道修复（F-0 §5.3-4/5）

> 2026-09-16。执行：ZCode/GLM。CE 源码以 `BrogueCE-master/src/brogue/` 为准
> （只读；行号均实测复核）。前置输入：F-0 §5.3、F-2a 报告。本轮对任务书有
> **两处反驳/细化**（§六.1 客观块次序、§六.2 药水时长）与**一处停下申报**
> （§六.3 p4_4 验收 3，禁改文件前提到期），请验收方重点看 §六。

---

## 0. 结论摘要

1. **§5.3-4 生物燃烧状态机落地**：着火 = 生物自身状态
   `statusDurations['burning']`（CE STATUS_BURNING，Rogue.h:2000）。踩火格
   `exposeCreatureToFire`（Time.c:28-61 逐条移植）上状态 `max(,7)` 刷新非叠加；
   每客观块 `rand_range(1,3)` 伤害（Monsters.c:1877-1901 / 玩家 Time.c:2581-2591）；
   蹚 TM_EXTINGUISHES_FIRE 扑灭（Time.c:226-232）；着火生物点燃所踩可燃格
   （Time.c:529-540，`Gas.ignite` = CE :539 alwaysIgnite 直燃，F-2a 入口直接复用）。
   离开火格继续烧到自然熄灭——"站火格扣血"的格子绑定模型退役。
2. **§5.3-5 / P1-44 火免通道修复**：抗火药水改 `applyTimedStatus('immune_fire', 150)`
   + 在烧即灭（CE Items.c:8188-8193；150 = GlobalsBrogue.c:672 range{150,150,0} 的
   randClump，**web 旧值 50 同为自创，一并按 CE 翻正**）。
   `'burning' as any` 全库清零（药水处修复 + Game.ts:4617 respiration 死键行删除）。
   **不需要动 StatusId 联合**（§二.3 申报）。
3. **门禁 §四 全过**：F-0 探针复跑——**气体 12 条曲线逐位一致**（含
   POISON≡CONFUSION 恒等式）；**火地形 3 条曲线与 F-2a §一逐位一致**
   （seed42/2026/777，燃烧状态机零扰动火侧）；可燃底数 123/122/162/115/84
   逐格一致；决定性 identical=true×2。DMG-FIRE 如预期变为 1-3 随机（新曲线已记）。
   build 绿；全量串行见 §七（唯一红 = §六.3 申报的 p4_4 验收 3，其余全绿）。
4. **对抗性测试 13 条**（新增 `f_2b_creature_burning.test.ts`，含 8 组任务书点名项
   + 玩家/怪物烧死 + 伤害支撑带）+ p1_28/p1_24 翻正后全绿；**反向验证 6 条**
   （超出要求的 4 条）真实改坏、真实失败输出、已还原（`grep REVERT-ME src` = 0，§九）。
5. **客观块重排**（§六.1）：`applyEnvironmentalEffects` 上移到 `tickCreatureStatuses`
   之前——CE 客观块怪物轨的原序（Time.c:2671 tile → :2677 decrement）。
   这是"踩火当块挂状态且掉血、蹚水当块先灭后结"的 CE 语义根据，
   也是 p4_4 之外唯一的行为性重排（后果已登记：DMG-GAS 的 STEAM 曲线 +1 格）。

---

## 一、CE 实现要点复核（任务书 §六第 1 条）

全部行号本轮打开源码逐行实读（Time.c / Monsters.c / Items.c / Rogue.h）：

| 内容 | CE 位置 | 复核出的要点 |
|---|---|---|
| `exposeCreatureToFire` | Time.c:28-61 | 豁免五条（:30-35）：`MB_IS_DYING ‖ STATUS_IMMUNE_TO_FIRE ‖ MONST_INVULNERABLE ‖ MB_SUBMERGED ‖ (!STATUS_LEVITATING && cellHasTMFlag(TM_EXTINGUISHES_FIRE))`；上状态 :59-60 |
| **★ `!levitating` 括号的正确读法** | Time.c:34-35 | 源码 `((!monst->status[STATUS_LEVITATING]) && cellHasTMFlag(monst->loc, TM_EXTINGUISHES_FIRE))`——**括号只包住这两条的合取**，它是"豁免五条"里的**第五条**，不是对前四条的修饰。语义：非悬浮者站在灭火层上免于**被点燃**；悬浮者悬在水上方，**不被水豁免**（火盖水的格子照烧它）。同一守卫在灭火侧重现：Time.c:227-231 的 `!STATUS_LEVITATING`（蹚水只灭踩在水里的火） |
| 上状态语义 | Time.c:59-60 | `status = maxStatus = max(status, 7)`——**刷新而非叠加**：剩余 <7 补到 7，>7 保留（靠暴露本身到不了 >7，"保留"半边不可达）。首回合（原 status==0）才播报"着火"（玩家/可见怪） |
| 蹚水灭火 | Time.c:226-232 | `TM_EXTINGUISHES_FIRE && burning && !levitating && !MONST_ATTACKABLE_THRU_WALLS && !MONST_FIERY` → `extinguishFireOnCreature`（:2088-2098：清零 + 玩家一句提示） |
| 燃烧生物点燃所踩格 | Time.c:529-540 | **else if**（已火格不重复）：`T_IS_FLAMMABLE && !(GAS 层 volume==0 怪癖) && burning && !(MB_SUBMERGED\|MB_IS_FALLING)` → `exposeTileToFire(x,y,true)`。注意 **无 levitating 条款**——悬浮的燃烧生物照样点燃脚下草 |
| 玩家燃烧结算 | Time.c:2581-2591（playerTurnEnded :2468 内） | **每玩家动作一次**：`rand_range(1,3)` 先掷、`!IMMUNE_TO_FIRE` 后查（免疫者照掷不扣血），然后 `!--status` 归零灭火。伤害在递减之前 |
| 怪物燃烧结算 | Monsters.c:1877-1901（decrementMonsterStatus :1834 内） | `if (burning)`：**非 MONST_FIERY 才递减**（FIERY 永烧）→ `rand_range(1,3)` → `!IMMUNE && !INVULNERABLE` 才扣血 → ≤0 灭火（静默） |
| **★ 客观块内次序** | Time.c:2668-2678 | `applyInstantTileEffectsToCreature(怪物)`（:2671，点火/灭火/点燃所踩格）**先于** `decrementMonsterStatus(怪物)`（:2677，燃烧伤害）——**同一块内"踩火当块既挂状态又掉血"**。玩家 tile 在 :2698（updateEnvironment :2695 与 decrementPlayerStatus :2697 之后）；玩家伤害在 per-action 的 playerTurnEnded（:2581），不在客观块 |
| 药水 | Items.c:8188-8193 | `status[IMMUNE_TO_FIRE] = maxStatus = magnitude`；**若在烧立即 extinguish**；magnitude = `randClump(range)`（Items.c:7902 附近），火免药水 range = **{150,150,0}**（GlobalsBrogue.c:672）⇒ 恒 **150 回合** |
| MONST_FIERY 出生态 | Monsters.c:3280/3912 | FIERY 怪出生自带 `burning=1000`（"won't decrease"）——行走火种。web 侧载体在禁改的 `syncFlagDerivedStatuses`，本轮登记不实现（§二.4） |

---

## 二、载体盘点表（任务书 §一.1 ★）

| 载体 | web 现状 | 处置 |
|---|---|---|
| 悬浮（STATUS_LEVITATING） | **有**：玩家药水 `levitating`；怪物 `MONST_FLIES` → 派生永久 `levitating`（P1-28） | **接通**：点燃豁免第五条的合取、灭火的 `!levitating` 守卫、火焰地形不豁免（CE 原样，p1_28 对抗⑥ 已钉） |
| 无敌（MONST_INVULNERABLE） | **有**：`Monster.isInvulnerable()`（P4-3，全数据仅 Warden） | **接通**：点燃豁免 + 伤害豁免（`resolveBurningDamage`），两处都查 |
| 火免旗标（MONST_IMMUNE_TO_FIRE） | **有**：P1-28 起派生永久 `immune_fire` 状态 | **接通**：`exposeCreatureToFire` 与 `resolveBurningDamage` 查 `hasStatus('immune_fire')`，旗标怪经派生通道自然生效（wisp 等 20 种零改动受益） |
| 灭火层（TM_EXTINGUISHES_FIRE） | **有**：WATER_SHALLOW / WATER_DEEP（TerrainCatalog :189/:196，C-4a 照抄 CE :413/:414） | **接通**：点燃豁免 + 蹚水灭火。查询复用 `DungeonFeature.cellTerrainMechFlags`（C-4b 白名单读者，见 §六.4） |
| 潜水（MB_SUBMERGED） | **无**：全库无潜水簿记（Monster.ts `generallyValidBoltTarget` 注释同款登记；TM_ALLOWS_SUBMERGING 只是目录旗标） | **登记不实现**（任务书明示不改 entities/）。退化后果：CE "潜水者免于被点燃"在 web 无触发面——水格本身不可燃 + 蹚水灭火分支已把"在水里还烧着"的窗口封死 |
| 坠落（MB_IS_FALLING） | **无**（无坠层中态） | **登记退化**：CE :538 点燃所踩格的守卫之一；web 无触发面 |
| MONST_ATTACKABLE_THRU_WALLS | **无** | **登记退化**：CE :229 灭火守卫之一；全 CE 该旗标怪（过墙爪）web 数据未载 |
| MONST_FIERY | **有旗标无派生**：monsters.json 5 只带 `MONST_FIERY`（behaviorFlags），**全部同时带 MONST_IMMUNE_TO_FIRE** | 旗标已接（灭火豁免的 FIERY 条件）；**出生自带燃烧 1000 未实现**（派生点在禁改的 Monster.ts）——因全部 FIERY 怪同时火免、永不入烧，该缺口当前不可观测，登记给旗标派生轮 |
| 死亡（MB_IS_DYING） | **有等价物**：hp<=0（Creature.die 归零口径，P1-24） | **接通**：`exposeCreatureToFire`/`resolveBurningDamage` 首行守卫 |

---

## 三、P1-44 修复方式与 StatusId 申报（任务书 §三 ⚠️ 的回答）

**结论：不需要动 `StatusId` 联合，本轮零改动 `src/entities/`。**

- **药水通道**：伤害端的读者（Game.ts 火格分支、熔岩分支、熔岩烧物品、
  火免 hover 字段、Monster 的 fiery bolt 目标筛选）查的全部是
  `hasStatus('immune_fire')`——而 `'immune_fire'` **本来就在 StatusId 联合里**
  （Creature.ts:9），写入走既有 `applyTimedStatus`（Player/Monster 通用）。
  断线的原因从来不是"缺键"，而是药水写进了**没有任何读者的**
  `temporaryImmunities['burning']`（三重断线见 §0.2）。修复 = 换成
  `applyTimedStatus('immune_fire', 150)` + 灭火，**不新造状态键**。
- **燃烧状态载体**：`'burning'` 确实不在联合里。选择**不走 Creature 状态系统**，
  而是 `statusDurations` 的逃生舱键——复用 `Monster.ts` `SHIELD_STATUS_KEY`
  （P4-5）的既有模式（`Record<string, number>` 视角读写）。收益：
  - `tickStatuses` 对全键的每块递减恰好就是 CE 的燃烧寿命递减
    （Time.c:2588 / Monsters.c:1880），零新增递减代码；
  - 玩家/怪物快照的 `statusDurations` 整对象往返（Game.ts:5971/5988/6088/6120）
    使存档免费携带燃烧态；
  - Sidebar 状态栏遍历 `statusDurations` 查 `STATUS_CONFIG`，`burning` 条目
    （statusConfig.ts，键联合扩为 `StatusId | 'burning'`——**改动完全在授权
    文件内**）即显示"燃烧"。
  - 代价：`tickStatuses` 返回的 `StatusId[]` 在运行时可能含 `'burning'`
    （类型口径的已知越界，与 SHIELD 同族；比较处按字符串比较并注释）。
  若验收方认为燃烧应升格为正式 `StatusId`（获得 `statusImmunities` 互通、
  `isStatusPermanent` 钩子等），那是一行联合扩键 + 各表加条目的机械改动，
  登记给放行 `Creature.ts` 的轮次——**本轮未擅动**。
- 顺带：`Game.ts:4617` respiration 符文的 `grantTemporaryImmunity('burning' as any, 1)`
  行删除（temporaryImmunities 对燃烧无读者，纯死代码；行为零变化，原注释的
  "CE 语义不同、本轮保留现状"登记原样有效）。`'burning' as any` 全库清零。

---

## 四、生产改动清单（按文件）

### Game.ts（+225/-51 中的生产部分）
- **燃烧状态机组**（`applyEnvironmentalEffects` 前）：`BURNING_DURATION_TURNS=7`、
  `burningDuration`/`setBurningDuration`（逃生舱键）、`cellExtinguishesFire`
  （复用 `DungeonFeature.cellTerrainMechFlags`，见 §六.4）、
  `extinguishCreatureFire`（Time.c:2088-2098）、
  `exposeCreatureToFire`（Time.c:28-61 逐条）、
  `resolveBurningDamage`（Monsters.c:1877-1901，先掷后查的 RNG 序原样）。
- **applyEnvironmentalEffects 火分支重写**：灭火（:227）→ 踩火上状态（:527-528）
  → else-if 点燃所踩格（:529-540，`environment.ignite`）。平扣 2 与其死伤消息退役。
- **tickCreatureStatuses**：前置 `resolveBurningDamage`（玩家+怪物）；
  playerExpired 增 `burning` → "你身上的火熄灭了。"
- **objectiveTimeBlock 重排**（§六.1）：环境段上移至状态段之前（晋升驱动之前），
  映射注释同步改写。
- **P1-44**：药水 `resist_fire` 分支重写（§三）；respiration 死键行删除。

### statusConfig.ts
- 键联合扩为 `StatusId | 'burning'`，新增 `burning` 条目（label 燃烧，硬编码中文，
  与既有条目同模式——本文件无 t() 调用，不经 i18n gate）。Sidebar 零改动
  （`Record<string, …>` 视角 + fallback 兜底）。

### zh_CN.json（+3/−1）
- 新增：`status.player.burning_on`（你着火了）、`status.player.burning_off`
  （你身上的火熄灭了。）、`status.monster.burning_on`（{{monster}}着火了——
  CE Time.c:49-55 的中文分支就是 `%s着火了`，无句柄句号，原样照抄）。
- 删除：`env.player_burning`（唯一调用点随平扣 2 退役；p1_30 死键闸门要求
  处置。闸门自带的指示是"移入 zh_CN.legacy.json 归档"，但该文件不在本轮
  授权清单——按最小边界原则直接删除，考古留此报告 + git 历史。**申报**）。

### Promotion.ts / TerrainCatalog.ts / Gas.ts / DungeonFeature.ts / Grid.ts
- **零改动**。点火入口（`Gas.ignite` = exposeTileToFire(true)）F-2a 已就位，
  直接复用；`ignite` 攒的 newly-caught 登记仍由 `takeNewlyCaughtFire()` 在
  晋升驱动前排干（时序检验：着火生物点燃的草同样走该队列，f_2b 对抗⑥ 下
  无"起火当块衰老"复现）。

---

## 五、行为变化登记（每条：变化 + CE 出处 + 实测锚点）

| # | 变化 | CE 出处 | 实测/锚点 |
|---|---|---|---|
| 1 | 站火格从"每回合固定 −2"变为"挂 STATUS_BURNING(≤7)，每块 rand_range(1,3)" | Time.c:527→:59-60；Monsters.c:1877-1901 | f_2b 对抗⑧（30 rat 支撑带 [30,90]）；DMG-FIRE 新曲线 `[1,2,3,3,3,2,2,1,3,1,2,0]`（seed42） |
| 2 | **离开火格后继续烧 ~7 块**，到时自然熄灭并停伤 | Time.c:59-60 + :2588 递减 | f_2b 对抗①（离火后 burning=5 续掉血、≤7 块烧干、之后 hp 冻结） |
| 3 | 蹚浅水/深水扑灭；悬浮者不被水扑灭、不被水豁免点火 | Time.c:226-232、:34-35 | f_2b 对抗③④a④b④c |
| 4 | 着火生物点燃所踩可燃格（移动火种）；未着火不点燃 | Time.c:529-540 | f_2b 对抗⑥（着火 rat 上草 → 草燃；冷 rat 对照 → 不燃） |
| 5 | 抗火药水真实生效：immune_fire 150 + 立即灭火 | Items.c:8188-8193；GlobalsBrogue.c:672 | f_2b 对抗⑤⑨（站火 8 块不掉血不上状态；带火喝药双断言） |
| 6 | 免疫者**可以**带着燃烧状态（免伤不免递减）；旗标火免怪**永不入烧** | Time.c:2582-2588、Monsters.c:1882-1883 | p1_28 对抗④⑤（wisp/warden 原命题保持绿） |
| 7 | **客观块重排**：环境段（点火/灭火/点燃所踩格/毒气上状态/岩浆）先于状态递减段 | Time.c:2671 → :2677 | 块序本身由 p4_4 验收 3（怪物同块掉血，红→见 §六.3）与 f_2b 对抗①（burning==6）双向锁定 |
| 8 | 重排的次级后果：**环境段改用本块火/气演化前的取态**（CE :2671 先于 updateEnvironment :2695 的同款取态）——DMG-GAS 的 STEAM 由 `[1,1,0,…]` 变 `[1,1,1,0,…]`（>20 阈值晚一块穿越；env 时密度 +2） | Time.c:2671/:2695 取态差 | 探针复跑 §七（气体**格曲线**不受影响，逐位一致） |
| 9 | RNG 流移动（燃烧伤害掷骰新增；仅在有生物燃烧的场合消耗） | 真改玩法轮预期内 | 决定性 identical=true（新流下确定）；可燃底数逐格一致；气体曲线逐位一致（燃烧掷骰不落入气体试验） |

**有意保留的 web 现状**（零改动，登记）：药水相邻时长漂移（levitate 30 vs CE 100、
speed 30 vs 25、invisibility 30 vs 75——同族漂移归物品表轮）；respiration 符文的
受击触发形态（原注释登记）；火贴水冒蒸汽（web 自创，归 G 链裁决）。

---

## 六、与预设不符之处 / 对任务书的反驳与申报（只列事实）

### 6.1 ★ 客观块"环境→状态"重排——任务书未预见、但它是 CE 块内序的必要落地
任务书 §一.1 只要求状态机本身。实测发现**块内次序有两种 CE 依据相反的读法**：
- 玩家轨：playerTurnEnded 的燃烧伤害（:2581，per-action）先于客观块的
  玩家 tile（:2698）——"先伤后点"；
- **怪物轨：:2671 tile（点火）先于 :2677 decrementMonsterStatus（伤害）——
  "先点后伤"，且同块生效**。

web 的 P2-3 合并口径把玩家/怪物状态都收进客观块（Game.ts 映射注释既有登记），
单一块序必须二选一。取**怪物轨**（[环境段] → [状态段]）的理由：
(a) 它是 CE 客观块内实际发生的次序；(b) p4_4 验收 3（"站在爆炸格上的生物走
完整回合结算后真的掉血"）在该序下保持绿（见 §六.3——该文件禁改）；(c) 与
P2-3 既有合并登记同族。**已登记的偏离**：合并后玩家着火的首块伤害比 CE
玩家轨提前一个动作出现。p1_28 翻正断言与 f_2b 全部时序断言按此口径书写，
双向锁定（怪物同块掉血 ⇔ p4_4；块内 7→6 递减 ⇔ f_2b 对抗①②）。

### 6.2 药水时长 50 → 150（任务书未提，CE 依据）
任务书只要求"喝了药水站进火里真的不掉血"。原断线行里的 `50` 同为自创：
CE 的 magnitude 来自 `randClump(range)`，火免药水 range={150,150,0}
（GlobalsBrogue.c:672）⇒ 恒 150。按 D1（平衡取舍一律按 CE）翻正为 150。
相邻药水的同族漂移（levitate 30/CE 100、speed 30/CE 25、invisibility 30/CE 75）
**不在本轮触碰**，登记给物品表轮。

### 6.3 ★★ 停下申报：p4_4 验收 3 前提到期，但文件禁改
`p4_4_split_kamikaze.test.ts` "验收打回修正：站在爆炸格上的生物走完整回合结算后
真的掉血（不是只读 isBurning）"——驱动是 `triggerDeathFeatures()` +
**只调一次 `applyEnvironmentalEffects()`**，断言 victim.hp 下降。其前提
"环境段即伤害段"随燃烧状态机到期（伤害现在住在状态段的
`resolveBurningDamage`）。该文件**不在任务书允许清单**（违反即本轮作废），
按项目留痕规矩**停下申报，未动它一字**。
- 这是第 7 起"本轮实现翻转既有断言但任务书漏放行"（项目常识记录在案的
  前六起全是这个形状；任务书 §三 给 p1_24/p1_28 提前放行了，漏了这条）。
- **CE 侧的实质**：CE 里 bloat 爆炸对生物的伤害来自 GAS_EXPLOSION 地形的
  `T_CAUSES_EXPLOSIVE_DAMAGE` 瞬时伤害（Globals.c:496 + DF_BLOAT_EXPLOSION
  :654）——那是 F-2c 的授权工作（任务书 §二 明确"不做爆炸，归 F-2c"），
  与燃烧状态无关。p4_4 的旧断言实际上锁的是"web 用平扣 2 近似爆炸伤害"
  这个 F-2a 报告 §十.4 已登记的缺口，F-2a 并已预告"届时 p4_4 进允许清单"。
- **建议的翻法**（供验收方直接采用，B-1 范本）：驱动改为
  `applyEnvironmentalEffects()` → `tickCreatureStatuses()`（新块序），
  断言改双段：环境段后 `burningDuration(victim) > 0`（爆炸格挂上状态）、
  状态段后 `victim.hp < hpBefore`（燃烧结算掉血）；测试名注明
  "F-2b 翻正：伤害随燃烧状态机迁至状态段；GAS_EXPLOSION 瞬时伤害归 F-2c"。
  原"hp 必须下降"的守卫语义完整保留，未放宽。
- **本轮门禁账目**：全量串行 70 文件 = 1 failed（仅此条）| 771 passed |
  8 skipped | 5 todo。除 p4_4 外全绿（§七）。

### 6.4 `.mechFlags` 读者白名单——按规矩走复用，不扩留痕
新增的 TM 旗标查询如果写在 Game.ts（`.mechFlags` 点号读取）会打红 c_4a E 组
留痕（生产读者白名单只有 DungeonFeature.ts/Promotion.ts）。处置：**复用
`DungeonFeature.cellTerrainMechFlags`**（C-4b 建立的合法读者，CE
cellHasTMFlag 同义），Game.ts 只做按位与——零新读者、零留痕改动、
零"改写形态绕过"（c_4a E 本轮未动一字而保持绿）。

### 6.5 zh_CN.json 删除了 1 个键（超出"仅增键"的字面）
`env.player_burning` 的唯一调用点随平扣 2 退役，p1_30 死键闸门红。
闸门自带指示"移入 zh_CN.legacy.json"，但 legacy 文件不在授权清单——
按最小边界在授权文件内删除。考古：本报告 §四 + git 历史。

### 6.6 任务书 §三 预言的 StatusId 撞点——实际没撞上
任务书预警"改 StatusId 联合才能修 P1-44"。实测**不需要**：药水通道的
正确键 `immune_fire` 已在联合里；燃烧状态走逃生舱键后同样不需要
（§三）。`src/entities/` 三文件零改动。

### 6.7 F-0 §六.2/F-2a 登记的"抗火药水断线"——本轮兑现，并超额一处
修复本身按登记执行；超额处 = 时长按 CE 翻正为 150（§6.2）+ respiration
死键行清理（§三）。

---

## 七、门禁（任务书 §四逐条）

**1. 反向哨兵——气体曲线逐位不变：PASS。**
F-0 附录 A 探针原样恢复（唯一适配同 F-2a：`igniteForced` 去时长实参），
复跑输出与 F-0 §4.5 / F-2a §一 逐字节比对：

```
[GAS] seed=42   type=2(POISON)  [5,12,9,12,5,5,2,1,0,…]          peak38  maxCells12 半径2 散@9   ≡ F-0
[GAS] seed=42   type=3(CONFUSION) 与 POISON 逐位相同（恒等式保持）                              ≡ F-0
[GAS] seed=42   type=4(STEAM)   [5,12,5,1,0,…]                  peak35          散@5    ≡ F-0
[GAS] seed=42   type=5(CREEP)   [4,9,15,15,17,11,11,8,8,6,2,0,…] peak25 maxCells17 散@12  ≡ F-0
[GAS] seed=2026 全四型  peak 83/83/80/74  散@17/17/10/21                        ≡ F-0
[GAS] seed=777  全四型  peak 83/83/80/74  散@19/19/10/27                        ≡ F-0
```

（哨兵活性由反向验证 R6 单独证明：消散 2→3 即翻红。）

**2. 火的蔓延/寿命曲线与 F-2a §一一致：PASS（逐位）。**

```
[FIRE-NAT] seed=42   origin=(5,20)  [1,1,1,2,3,5,6,6,6,6,7,6,6,7,7,7,7,7,6,6,6,6,6,5,6,6,5,5,5,5,5,5,5,5,5,6,6,6,5,5]  ≡ F-2a
[FIRE-NAT] seed=2026 origin=(68,14) [1,2,3,3,4,4,5,5,6,7,9,9,10,11,11,13,12,12,13,14,13,13,15,15,15,14,12,11,8,8,8,8,5,5,5,5,5,4,4,4] ≡ F-2a
[FIRE-NAT] seed=777  origin=(31,23) [1,1,1,1,1,0,…] 全熄@6 半径0                                            ≡ F-2a
```

（可燃底数 123/122/162/115/84 与 F-0 逐格一致 ⇒ 生成链未动；燃烧掷骰只发生在
有生物燃烧时，三次试验中无生物入火，RNG 流未受扰动。）
**DMG-FIRE（如预期变化）**：seed42 `[1,2,3,3,3,2,2,1,3,1,2,0]`（11 块 1-3 + 回血
−1 尾巴）、seed2026 `[3,1,3,2,3]`——平扣 2 的旧曲线退役。
**DMG-GAS**：POISON/CONFUSION/CREEP 与 F-0 一致；STEAM `[1,1,1,0,…]` 比 F-0
的 `[1,1,0,…]` 多一格——§五.8 登记的重排取态后果。

决定性：`[DETERMINISM] seed=42 turns=120 identical=true` / `seed=2026 … identical=true`。
自然推进 5 种子 200 回合点火/气体全零。探针跑完已删（`git status` 无残留）。

**3. 新行为实测：PASS**——着火持续分布（30 rat × 1 块伤害 ∈[1,3]，f_2b 对抗⑧；
时长 max(,7) 刷新、站火恒 6，对抗②）；离开火格仍烧 ≤7 块后自然熄灭（对抗①）；
进水即灭且入水块不再掉血（对抗③）；喝抗火药水站火 8 块掉血为 **0**
（对抗⑤，immune_fire=149 生效中）。见 §九真实输出。

**4. generation_baseline / p1_26 / p1_29 / p1_33：PASS**（全量串行内全绿；
可燃底数逐格一致见门禁 2）。

**5. build / npm test：**
- `npm run build`（exit 0）：`✓ built in 1.71s`（>500kB chunk 警告为既有常态）。
- 全量串行 `npx vitest run --fileParallelism=false`（**终态树**，2026-09-16 20:05–20:22）：

```
 Test Files  1 failed | 69 passed (70)
      Tests  1 failed | 771 passed | 8 skipped | 5 todo (785)
   Start at  20:05:02
   Duration  1032.37s
```

  唯一 failed = `p4_4_split_kamikaze.test.ts` 验收 3（§六.3 申报项，终态树上
  单独复跑确认红；f_2b 13/13 绿同批确认）。账目：F-2a 基线 69 文件 /
  759 passed → +1 文件（f_2b，13 条）、p4_4 一条由 passed 转 failed
  = 771 passed + 1 failed，逐项对上。

---

## 八、既有测试改动逐条清单（含守卫性质论证）

| 文件 | 改动 | 为什么到期 | 守卫性质未放宽 |
|---|---|---|---|
| p1_28_flag_channel.test.ts | ①helper `tickEnvironment` 改双段并按新块序（环境→状态）；②对照组 rat 翻为"挂 6、同块 1-3、续烧恒 6"；③对抗⑥ bat/玩家翻为"悬浮照样点燃+掉血"；④文件头 F-2b 翻正记录（原平扣断言以注释留档） | 任务书 §三 明示授权；"平扣 2"红线随状态机到期 | wisp/warden 豁免断言一字未动；翻正后的"恒 6"是**新方向加严**（叠加/重置实现都红） |
| p1_24_death_sink.test.ts | 对抗③：`hp=2 一烧即死`→`hp=1 + 双段驱动`，die() 精确归零守卫原样 | 同上（任务书授权文件）；"环境段即伤害段"前提到期 | `hp toBe(0)` 精确归零、`burns to death` 恰 1 条——两条守卫原样保留 |
| p4_4_split_kamikaze.test.ts | **零改动（禁改）**——验收 3 翻红，§六.3 申报 | — | — |
| f_1 / f_2a / c_4a / c_4b / c_4c / 其余 62 文件 | **零改动** | 授权清单给了但断言未到期（f_1/f_2a 的"固定 2 伤害红线"实际不落在它们的断言里——两文件的 .hp 断言为零） | 全绿（除 §六.3 申报项） |

---

## 九、对抗性测试与反向验证

### 9.1 对抗性测试（新增 `src/test/f_2b_creature_burning.test.ts`，13 用例）

| # | 捕获的错误实现 | 断言锚点 |
|---|---|---|
| ① | 状态没挂上（旧平扣形态：伤害绑在火格上） | 踩火块 burning==6 且掉血；**离火后 burning=5 继续掉血**；≤7 块烧干；之后 hp 冻结 |
| ② | 时长叠加而非刷新 | 站火 12 块每块末 burning==6（叠加实现 → 12/18/24…） |
| ③ | TM_EXTINGUISHES_FIRE 灭火失效（站水里还在烧） | 入水块 burning==0 且不掉血；之后永不掉血 |
| ④a | 火盖水格：非悬浮者被点燃（豁免漏灭火层条件） | 非 levitating rat 在火盖水格 burning==0、hp 不动 |
| ④b | **`!levitating` 括号读反**（悬浮者也免点火） | 派生悬浮 bat 同格 burning==6 且掉血 |
| ④c | 灭火侧漏 `!levitating`（悬在水上的火被水灭） | 悬浮燃烧 bat 移到浅水上仍 burning>0 |
| ⑤ | **抗火药水仍无效（P1-44 回归哨兵）** | 喝药后 immune_fire==149；站火 8 块 hp 不动、burning 恒 0 |
| ⑥ | 着火生物不点燃所踩地形 / 漏 burning 前置 | 着火 rat 上草→草燃；冷 rat 对照→不燃 |
| ⑦ | 气体被本轮意外改动（回归哨兵） | 四型 ×14 块签名逐位等于 2026-09-16 硬编码基线（POISON≡CONFUSION 恒等式在内） |
| ⑧ | 伤害量级走样（0 伤或 ≥4/块） | 30 只独立 rat 单块总伤 ∈ [30,90]（支撑带，带外概率 0） |
| ⑨ | 只加免疫不灭 existing 火（半实现） | 带火喝药：burning==0 且 immune_fire==149 |
| ⑩ | 玩家烧死链断（漏 lastDamageSource / 死因错报） | hp≤0、lastDamageSource=='fire'、finishTurnEpilogue → isGameOver |
| ⑪ | 怪物烧死不收口 | hp 精确 0、尸符 '%'、`burns to death` 恰 1 条 |

（任务书 §五.2 点名的七条全数覆盖：①②③④b⑤⑥⑦。）

### 9.2 反向验证（6 条，真实改坏 → 真实失败输出 → 还原；`grep -rn REVERT-ME src` = 0，Gas.ts diff 为零）

**R1 状态没挂上（exposeCreatureToFire 里改回平扣直扣）→ 对抗①（-t 对抗① 同时命中②）：**

```
AssertionError: expected +0 to be 6 // Object.is equality
AssertionError: 第 1 块后剩余时长必须恒为 6（刷新非叠加）: expected +0 to be 6
Tests  2 failed | 11 skipped (13)
```

**R2 刷新改叠加（max → current+7）→ 对抗②：**

```
AssertionError: 第 2 块后剩余时长必须恒为 6（刷新非叠加）: expected 12 to be 6
Tests  1 failed | 12 skipped (13)
```

**R3 灭火侧删 `!levitating`（那个括号写反）→ 对抗④c：**

```
AssertionError: expected 0 to be greater than 0
Tests  1 failed | 12 skipped (13)
```

**R4 药水复旧 `grantTemporaryImmunity('burning' as any, 50)`（P1-44 断线复现）→ 对抗⑤：**

```
AssertionError: expected false to be true // Object.is equality   （immune_fire 没挂上）
AssertionError: expected 6 to be +0                               （燃烧照样挂上）
Tests  2 failed | 11 skipped (13)
```

**R5 点燃所踩地形断线（删 else-if 分支体）→ 对抗⑥：**

```
AssertionError: expected false to be true   （草地没有燃起来）
Tests  1 failed | 12 skipped (13)
```

**R6 气体消散 2→3（哨兵试金石）→ 对抗⑦：**

```
AssertionError: type=2 气体曲线漂移: expected [ …(14) ] to deeply equal [ …(14) ]
Tests  1 failed | 12 skipped (13)
```

六条全部还原并复绿（f_2b 13/13 + 火系簇 63/63 通过）。

---

## 十、给 F-2c / G-1 / 后续轮的登记清单

**F-2c（爆炸）**：
1. **p4_4 验收 3 等待翻转**（§六.3，含建议翻法）——真爆炸落地时 p4_4 进允许清单，
   GAS_EXPLOSION 的 `T_CAUSES_EXPLOSIVE_DAMAGE` 瞬时伤害（max(15-20, 50%)、
   5 回合同格免）将取代"燃烧状态近似"。
2. bloat 的 `igniteForced` ×5 现在会让挨炸生物**着火**（CE 同：爆炸铺火，
   火再点燃生物）——F-2c 落地时留意两段伤害的叠加口径。

**G-1（气体）**：
3. 客观块环境段现取**本块演化前**的气体状态（§五.8）——G-1 迁体积模型时
   DMG-GAS 的 STEAM 基线以本文 §七的新曲线为准（`[1,1,1,0,…]`）。
4. 气体曲线哨兵现在有两份等价实现：f_2a 对抗⑪ 与 f_2b 对抗⑦（同一硬编码基线）。
   G-1 改气体时两处一起翻。

**旗标派生轮（Monster.ts 放行时）**：
5. MONST_FIERY 出生自带 `burning=1000`（Monsters.c:3912）未实现（§二.4）——
   落地后 FIERY 怪成为移动火种（点燃所踩格的机制本轮已就位，到时直接生效）；
   届时 `resolveBurningDamage` 需补"FIERY 不递减"（Monsters.c:1879-1881）。
6. 若升格 `burning` 为正式 StatusId（§三）：一行联合扩键 + STATUS_CONFIG 键联合
   收窄 + 逃生舱键退役。

**物品表轮**：
7. 药水时长同族漂移：levitate 30/CE 100、speed 30/CE 25、invisibility 30/CE 75
   （fire immunity 已在本轮按 CE 翻正为 150）。

**渲染/门轮次（沿 F-2a 登记）**：
8. 燃烧状态在怪物身上无视觉表现（CE 是火色渲染 + 光照）；玩家 Sidebar 有
   "燃烧"标签。EMBERS/ASH/PLAIN_FIRE 渲染缺口沿 F-2a §十.9 原样。

---

## 十一、文件边界自查

```
git status --porcelain（终态）：
 M brogue-web/src/engine/Core/Game.ts
 M brogue-web/src/engine/Status/statusConfig.ts
 M brogue-web/src/locales/zh_CN.json
 M brogue-web/src/test/p1_24_death_sink.test.ts
 M brogue-web/src/test/p1_28_flag_channel.test.ts
?? brogue-web/ai_docs/f_2b_creature_burning_report.md
?? brogue-web/src/test/f_2b_creature_burning.test.ts
```

- 允许清单内生产文件：Game.ts、statusConfig.ts、zh_CN.json。
  **Promotion.ts / TerrainCatalog.ts / DungeonFeature.ts / Gas.ts / Grid.ts 零 diff**
  （点燃接线复用既有 Gas.ignite；TM 查询复用 DungeonFeature.cellTerrainMechFlags）。
- 既有测试改动：p1_24 / p1_28（均在授权清单）；**p4_4 红而未动**（§六.3 申报）。
- 探针 `zz_f0_probe.test.ts` 恢复→复跑→已删；反向验证 6 条全部还原
  （`grep -rn REVERT-ME src` = 0）；未执行任何 git 写操作。
