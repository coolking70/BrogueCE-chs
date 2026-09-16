# G-3 报告：气体效果与生物侧（F-0 §5.3 第 10、11 条 + 麻痹载体链）

> 2026-09-17。执行：ZCode/GLM。CE 源码以 `BrogueCE-master/src/brogue/` 为准
> （只读；行号本轮逐条打开复核）。前置输入：G-2 §九（4 条登记）、
> G-1 §十一.6-8、F-0 §5.3 第 10、11 条。本轮对任务书有**两处修正/反驳**
> （§八），并在实现过程中被自己的对抗性测试抓出一个**真实的豁免漏洞**
> （§八.1——混乱分支漏 respiration 豁免，测试先于验收发现，已修复）。

---

## 0. 结论摘要

1. **效果判定口径重裁（F-0 §5.3-10）**：web 旧 CONFUSION/STEAM 的
   `density > 20` 阈值（0-100 时代自创参数）退役。CE 真口径是**无阈值、
   站进即判、每回合 max() 刷新**（Time.c:421-497）；web 的
   `applyStatus('refresh')` 恰为 `Math.max` 语义，直接对齐。
2. **伤害改比例（F-0 §5.3-11）**：`max(1, ⌊maxHP/15⌋)`
   （Time.c:596-597，ticks=100）。**POISON_GAS 按 CE 是 T_CAUSES_DAMAGE
   直接伤害**——旧实现"上 poisoned 状态"是 0-100 时代的自创口径，一并退役
   （CE 的毒状态走 addPoison，与气体无关）。量化对比见 §五（"大怪更怕毒气"
   成立：zombie 5/回合 vs rat 1/回合）。
3. **载体盘点（G-2 §九.1 同款方法）**：五种未接气体中只有 PARALYSIS_GAS
   有 web 载体（`potion_of_paralysis`）——tile 迁移 + 效果判定 + 药水改线
   **同轮闭环**；ROT/STENCH/DARKNESS/HEALING 四气体无载体，**只登记不迁移**
   （§三盘点表）。黑暗云的 CE 效果本体也已查清：**零地形旗标 + 负光照**
   （`darknessCloudColor = {-20,-20,-20}`，Globals.c:216/:1021），不是状态
   机制——登记时纠正了"黑暗=状态"的想当然。
4. **两个反向哨兵逐位一致**：FIRE-NAT 三曲线 + DMG-FIRE 两序列
   （改动前后各实跑一遍，与 F-2a §一/F-2b §七 三方逐位相同，§六）；G-1
   扩散算法 9000 整除注入单轮精确守恒 + G-2 蒸汽源 +15 复验（§六）。
5. **门禁**：`npm run build` 绿；全量串行 `npx vitest run
   --fileParallelism=false` 终态树零失败（73 文件 / 834 passed + 8 skipped
   + 5 todo，账目对账见 §七.4）；新测试文件 `g_3_gas_effects.test.ts`
   26 用例；反向验证 7 条（`grep -rn REVERT-ME src` = 0）。

---

## 一、效果判定与比例伤害的 CE 行号与复核要点

本轮范围 = `applyInstantTileEffectsToCreature` 的毒气段 +
`applyGradualTileEffectsToCreature` 的伤害/回复段（Time.c:405-497 / :549-663）。

### 1.1 逐段行号（本轮打开复核，非转抄）

| CE 段 | 行号 | 内容 | web 落点 |
|---|---|---|---|
| respiration 豁免包裹 | Time.c:408-424 | 玩家穿 A_RESPIRATION 符文甲时，恶心/混乱/麻痹全组进 `else`（即全被豁免）；首次触发 `autoIdentify`（:414-419） | `respirationImmune` 常量，Game.applyEnvironmentalEffects 气体段 |
| 恶心（T_CAUSES_NAUSEA） | :421-440 | STATUS_NAUSEOUS = max(…,20)；豁免 INANIMATE/INVULNERABLE/SUBMERGED | **未实现**（无载体，§三） |
| 混乱（T_CAUSES_CONFUSION） | :443-470 | STATUS_CONFUSED = max(…,25)；豁免 INANIMATE/INVULNERABLE；玩家可见且首次上状态时惊醒睡眠怪（:449-452） | confused 25 + visibleMonsters 惊醒 |
| 麻痹（T_CAUSES_PARALYSIS） | :471-497 | STATUS_PARALYZED = max(…,20)；豁免 INANIMATE/INVULNERABLE/SUBMERGED；**不惊醒**睡眠怪 | paralyzed 20 |
| 伤害（T_CAUSES_DAMAGE） | :592-640 | `damage = (maxHP/15) * ticks/100; damage = max(1, damage)`（:596-597）；玩家端 respiration 豁免在 :614-624；死亡引 tile description（:622-625 "Killed by %s"） | `Math.max(1, Math.floor(maxHp/15))` |
| 回复（T_CAUSES_HEALING） | :645-663 | 同式回血；豁免 INANIMATE/SUBMERGED（**INVULNERABLE 不豁免**）；仅 currentHP<maxHP 时 | **未实现**（无载体，§三） |

要点复核：

- **ticks 语义**：`applyGradualTileEffectsToCreature(monst, ticks)` 的 ticks
  是生物的 `ticksUntilTurn`（:2635/:2740），标准速度 = 100。web 无 tick 制
  （P2 缓办），每回合 = ticks 100，故 `max(1, ⌊maxHP/15⌋)`。
- **毒气不上毒状态**：CE 全源码中 POISON_GAS tile 的旗标是
  `T_IS_FLAMMABLE | T_CAUSES_DAMAGE`（Globals.c:502），不含
  T_CAUSES_POISON；毒**状态**（addPoison）只来自毒藤/MA_POISONS 等。web 旧
  实现（Game.ts 旧 :6495-6502 `applyStatus('poisoned', 5)`）是错抄口径，
  本轮随比例伤害一起翻正。
- **每回合 max() 刷新**：CE `status = maxStatus = max(status, N)` 每次判定
  都执行；web `applyStatus(id, N)` 默认 `'refresh'` = `Math.max(current, N)`
  （Creature.ts:140-148），且 `next === current` 时返回 false——与 CE 的
  "已是 25 不动"语义一致。
- **旗标判定不看体积**：CE 的 `cellHasTerrainFlag` 只查 tile——燃气点燃后
  volume=0 而 GAS 层 tile 暂留的收层前窗口（Time.c:1361-1368），效果判定
  照常命中。web 新代码同样只读 `cell.layers[GAS]`（对抗①第三条钉住）。

### 1.2 分派方式的重构

旧代码按 `gas.type === GasType.POISON/CONFUSION/STEAM` 逐型 if-else；新代码
按 **GAS 层 tile 的 T_CAUSES_\* 旗标**分派（CE `cellHasTerrainFlag` 语义）：
后续任何气体 tile 迁入（ROT/HEALING 等），效果判定自动就位，无需再改分派
结构。CREEPING_DEATH 的 D2 留痕分支原样保留（无层载体，结构性不可达）。

---

## 二、比例伤害实测：CE 的"大怪更怕毒气"量化（任务书 §六.3）

### 2.1 每回合伤害对比（同一体积 1000 的气云、单次 applyEnvironmentalEffects）

| 实体 | maxHp | CE 公式 max(1,⌊maxHP/15⌋) | 旧 web（毒气=上状态 0 伤 / 蒸汽=定值 1） | 新实测（毒气/蒸汽一致） |
|---|---|---|---|---|
| rat | 6 | 1 | 0 / 1 | **1** |
| goblin | 15 | 1 | 0 / 1 | **1** |
| player | 30 | 2 | 0 / 1 | **2** |
| troll | 65 | 4 | 0 / 1 | **4** |
| zombie | 80 | 5 | 0 / 1 | **5** |

探针原文（AFTER 实跑，`[GAS-QTY]`）：

```
[GAS-QTY] type=POISON monster=rat maxHp=6 damage=1 status=-
[GAS-QTY] type=POISON monster=goblin maxHp=15 damage=1 status=-
[GAS-QTY] type=POISON monster=troll maxHp=65 damage=4 status=-
[GAS-QTY] type=POISON monster=zombie maxHp=80 damage=5 status=-
[GAS-QTY] type=POISON player maxHp=30 damage=2 status=-
[GAS-QTY] type=STEAM  monster=rat maxHp=6 damage=1 status=-
[GAS-QTY] type=STEAM  monster=goblin maxHp=15 damage=1 status=-
[GAS-QTY] type=STEAM  monster=troll maxHp=65 damage=4 status=-
[GAS-QTY] type=STEAM  monster=zombie maxHp=80 damage=5 status=-
[GAS-QTY] type=STEAM  player maxHp=30 damage=2 status=-
```

**玩法结论**：F-0 §5.3-11 的预言成立——CE 口径下毒气对大怪是 5×于小怪的
持续压迫（zombie 80 HP 站 16 回合毒气即死，旧 web 下是无限站），小怪反而
只受保底 1 点。这是真实的难度曲线变化：高血量怪物（troll/troll 系、
僵尸系、巨兽系）在毒气/蒸汽面前的生存力被大幅下调，与 CE 一致。

### 2.2 阈值取消的中招窗口（玩家站 100 体积蒸汽云自然衰减）

```
BEFORE [GAS-THRESH] seed=42 affectedTurns=1  densityAtPlayer=[17,12,8,7,6,4,2,1,0,1,0,0]
AFTER  [GAS-THRESH] seed=42 affectedTurns=10 densityAtPlayer=[17,12,8,7,6,4,2,1,0,1,0,0]
```

旧阈值 >20 使云在第一轮扩散后（中心 17）就"失效"，中招窗口 1 回合；
取消后只要体积在场（含体积 1 的残气）就持续结算——中招窗口 10 回合，
单回合伤害同时从 1 升到 2。**合起来：蒸汽/毒气的实际威胁量级 ≈ 旧版的
10-20 倍**，且低体积残气不再"看着有、踩着没"。

### 2.3 效果曲线 BEFORE→AFTER 全量（`[DMG-GAS]` seed 42，玩家脚下注 100）

```
BEFORE POISON    hpDeltas=[0,0,0,0,0,0,0,0,0,0,0,0] statuses=[poisoned×12]
AFTER  POISON    hpDeltas=[2,2,2,2,2,2,2,2,2,2,1,2] statuses=[-×12]
BEFORE STEAM     hpDeltas=[1,0,0,0,0,0,0,0,0,0,-1,0] statuses=[-×12]
AFTER  STEAM     hpDeltas=[2,2,2,2,2,2,2,2,2,2,-1,0] statuses=[-×12]
BEFORE CONFUSION hpDeltas=[0×12] statuses=[hallucinating×5,...]
AFTER  CONFUSION hpDeltas=[0×12] statuses=[confused×12]（max(…,25) 持续刷新）
BEFORE PARALYSIS injected=false（无载体，addGas 拒绝）
AFTER  PARALYSIS injected=true  statuses=[paralyzed×12]（max(…,20) 持续刷新）
```

（AFTER POISON t10 的 1 与 STEAM t11 的 −1 是自然回血与伤害同回合相抵的
净值，非公式变化。）

---

## 三、载体盘点表（任务书 §门禁.4）

| 气体 | CE 载体（实测出处） | web 载体现状 | 本轮动作 |
|---|---|---|---|
| PARALYSIS_GAS | 麻痹药水：喝 Items.c:8117-8120、扔 :6994-6997 → DF_PARALYSIS_GAS_CLOUD_POTION（Globals.c:778 `{PARALYSIS_GAS, GAS, 1000, 0, 0, "", 0, &pink, 4}`）；trap  vents :865（350 体积）另条 | **有**：`potion_of_paralysis`（consumables.json，effect=paralyze_burst），旧实现直上 paralyzed 8 | **闭环落地**：tile 迁移（39 号）+ GasType.PARALYSIS + 效果判定（对抗①②）+ 药水改线（对抗⑤）。药水走 `addGas(…, 1000)` 直注（G-1 毒药水同款先例），**DF 条目不入目录**（见 §八.2） |
| ROT_GAS | zombie 双列：`bloodType = DF_ROT_GAS_BLOOD`（Globals.c:1075 列 11，血 DF 目录 :649 = 12 体积）+ `DFChance 100 / DFType = DF_ROT_GAS_PUFF`（列 14/15，目录 :664 = 15 体积/醒回合） | 无：monsters.json 的 zombie 无这两组列；web 引擎无怪物 bloodType/DFType 发射机制（Monster.ts 在禁改清单） | **只登记**。接上需先做"怪物侧 DF 发射机制"轮次（含 monsters.json 数据轮）；先迁 tile 只会造出无写入点的死数据 |
| STENCH_SMOKE_GAS | HAY 的 fireType DF_STENCH_BURN（Globals.c:452 干草→臭烟→火链）+ MUD_FLOOR 的 fireType DF_STENCH_SMOLDER（:576） | 无：web 无 HAY/MUD_FLOOR 地形（web MUD 是 LIQUID 湖体、非此 tile） | **只登记** |
| DARKNESS_CLOUD | DF_DARKNESS_POTION（Globals.c:781 `{DARKNESS_CLOUD, GAS, 200, 0, 0}`）；**效果本体**：tile 零地形旗标（:509 flags 列 = (0)），黑暗靠 glowLight `DARKNESS_CLOUD_LIGHT` = `darknessCloudColor {-20,-20,-20}` 负光照（Globals.c:216/:1021）实现，**不是状态**；STATUS_DARKNESS（药水直饮 :8088-8091）只缩矿灯半径，是另一条机制 | 无：consumables.json 无黑暗药水（数据文件禁改）；web 无光照模型，负光照无处落地 | **只登记**（双重无载体：无药水 + 无光照模型）。纠正了一个想当然：黑暗云不是"上黑暗状态" |
| HEALING_CLOUD | BLOODFLOWER_POD 的 fireType/promoteType DF_BLOODFLOWER_POD_BURST（Globals.c:514，pod 踩上/烧掉 → :701 `{HEALING_CLOUD, GAS, 350, 0, 0}`） | 无：web 无 BLOODFLOWER_STALK/POD 地形；TerrainCatalog 虽在允许清单，但地形加了也没有生成侧落点（Generator 禁改）= 空转链 | **只登记**。与效果处理器一并缓办：T_CAUSES_HEALING 在 web 目录中零载体，处理器写了也不可达 |

留痕形态：四无载体气体在 **g_2 对抗⑦**（本轮已按授权翻转：PARALYSIS 出列、
其余四气体 + 11 个无载体 DF id 的结构性缺席断言原样保留并加码 159 号）。

---

## 四、麻痹载体链细节（本轮唯一闭环的气体）

### 4.1 tile 迁移（CE Globals.c:505 逐字段）

```
PARALYSIS_GAS（TerrainType 39）：flags = T_IS_FLAMMABLE | T_CAUSES_PARALYSIS；
mechFlags = TM_STAND_IN_TILE | TM_GAS_DISSIPATES_QUICKLY；ign 100；
fireType DF_GAS_FIRE；promoteType/promoteChance 0；drawPriority 35；归属 GAS。
```

GasType.PARALYSIS 数值 = 层值（G-1 惯例）；c_4a_terrain_catalog 新增逐字段
钉死用例，c_4a_0 两张穷举表各 +1 行。

### 4.2 药水改线（Game.ts `case 'paralyze_burst'`）

旧：`applyTimedStatus(player, 'paralyzed', 8)`（直上状态，无云）。
新：`addGas(player.loc, PARALYSIS, 1000)` + 既有日志键。玩家随后由**同一套
效果判定**上 paralyzed max(…,20)——CE 的"喝麻痹药水自困"原味（Items.c:8119
原文消息即 "your muscles stiffen as **a cloud of pink gas bursts**…"）。

- 扔掷（thrown potion）路径 web 未实现药水碎裂（既有缺口，登记，非本轮范围）。
- CE 的 `&pink` 闪光半径 4 是 lightFlare 列（渲染），web 无光效列，登记不迁移。
- **消息键沿用**：`potion.paralyze_burst`（"你被定身了！"）描述的正是随后
  到来的麻痹结局，予以保留——若弃用该键会触发 p1_30 死键闸门，而
  zh_CN.legacy.json 不在允许清单，构成边界两难；取"沿用既有键、零增删"的
  折中（详见 §八.3）。

---

## 五、留形分支逐字重核声明（任务书 §五）

本轮激活的"前几轮结构性不可达"分支及逐字重核记录：

1. **T_CAUSES_PARALYSIS 效果分支**（本轮新写，非留形）：CE
   Time.c:471-497 逐行核对——豁免集（INANIMATE|INVULNERABLE + SUBMERGED，
   :473-475）、时长 max(…,20)（:495-496）、**不惊醒睡眠怪**（对比混乱段的
   :449-452 有惊醒、麻痹段无）、玩家 disturbed（:497-498）。
2. **PARALYSIS_GAS 的 fireType = DF_GAS_FIRE 链**（留形复用）：tile 的
   ign 100 + fireType 与 POISON/CONFUSION 同链（Globals.c:505 第 5/6 列），
   被点燃时走 F-2a/G-2 已通的 promoteTile(GAS) → SURFACE 落火路径——该
   路径本轮零改动（反向哨兵 §六复跑佐证），数据侧逐字符核对 tile 行：
   `100, DF_GAS_FIRE, 0, 0`（ign、fireType、discoverType、promoteType）。
3. **respiration 豁免包裹结构**（Time.c:408-424）：`if (player…A_RESPIRATION)
   {…autoIdentify…} else { 恶心 + 混乱 + 麻痹三段 }`——**三段全在 else 里**；
   且整块的**前置**是 `cellHasTerrainFlag(…, T_RESPIRATION_IMMUNITIES)`
   （:409-412），组外气体不进块。本轮实现初版两处都抄漏（混乱分支未包、
   组外气体触发鉴定），分别被对抗⑦与交付前 diff 复核抓出后修复——这正
   是任务书 §五 要求逐字重核的价值实证。
4. **GasType.PARALYSIS 的 addGas 载体校验通路**：isGasTerrain 查
   TERRAIN_HOME_LAYER === GAS——PARALYSIS_GAS 入归属表后自动放行，无新代码。

---

## 六、两个反向哨兵的逐位比对（任务书 §六.1/2）

探针 `src/test/zz_g3_probe.test.ts`（沿 F-0 附录 A 口径适配现行引擎；
改动前后各实跑一遍，跑完即删）。

### 6.1 火侧哨兵：PASS（三方逐位一致）

```
[FIRE-NAT] seed=42   origin=(5,20)
  BEFORE [1,1,1,2,3,5,6,6,6,6,7,6,6,7,7,7,7,7,6,6,6,6,6,5,6,6,5,5,5,5,5,5,5,5,5,6,6,6,5,5]
  AFTER  [1,1,1,2,3,5,6,6,6,6,7,6,6,7,7,7,7,7,6,6,6,6,6,5,6,6,5,5,5,5,5,5,5,5,5,6,6,6,5,5]
  ≡ F-2a §一 发表值
[FIRE-NAT] seed=2026 origin=(68,14)
  BEFORE [1,2,3,3,4,4,5,5,6,7,9,9,10,11,11,13,12,12,13,14,13,13,15,15,15,14,12,11,8,8,8,8,5,5,5,5,5,4,4,4]
  AFTER  [1,2,3,3,4,4,5,5,6,7,9,9,10,11,11,13,12,12,13,14,13,13,15,15,15,14,12,11,8,8,8,8,5,5,5,5,5,4,4,4]
  ≡ F-2a §一 发表值
[FIRE-NAT] seed=777 origin=(31,23)
  BEFORE [1,1,1,1,1,0,…] 全熄@6，31 位
  AFTER  同上 ≡ F-2a §一 发表值
[DMG-FIRE] seed=42   BEFORE hpDeltas=[1,2,3,3,3,2,2,1,3,1,2,0] AFTER 同 ≡ F-2b §七
[DMG-FIRE] seed=2026 BEFORE hpDeltas=[3,1,3,2,3]               AFTER 同 ≡ F-2b §七
```

（反向验证 R6 实证了哨兵敏感性：把 GRASS chanceToIgnite 15→50，两条
FIRE-NAT 立即翻红，见 §七.1。）

### 6.2 G-1 扩散算法 + G-2 气源哨兵：PASS

```
[GAS-DIFF] before=7200 after=7200 equal=true diagEqual=true d1=800 d2=800   （BEFORE=AFTER）
```

- 扩散算法本体 `updateGases` 零 diff；行为复验：9000 整除注入甲烷单轮
  updateGases → 3×3 块恰各 1000、总量 9000、块外 0（**种子无关**的精确
  相位；g_2 对抗⑥ 的"2 轮 9000"经本轮复核是其种子 20260916 下的特例——
  第 2 轮起出现 randRange 进位余数后总量变种子相关 ± 漂移，本轮实测
  自己的种子下 2 轮 = 9001。该特例的断言未在本轮改动，仍是绿的）。
- G-2 蒸汽源复验：深水被火段直燃 → GAS 层 +15（DF_STEAM_ACCUMULATION），
  与 g_2 对抗②同口径，绿。
- 新增"效果结算零 RNG 消耗"守卫：CE 的气体效果无掷骰，web 若在效果路径
  加 roll 会移动全局 RNG 流（项目常识 §四）——以
  `rng.randomNumbersGenerated` 计数器钉死为 0 增量。
- 既有哨兵 g_1 对抗⑧ / g_2 对抗⑤⑥ / f_2a/f_2b 的 GAS_BASELINE 全绿
  （全量输出见 §七.2）。

---

## 七、对抗性测试、反向验证与门禁

### 7.1 对抗性测试（新文件 `src/test/g_3_gas_effects.test.ts`，26 用例全绿）

| # | 捕获的错误实现 | 断言锚点 |
|---|---|---|
| ①阈值 | 阈值没取消（低密度不生效）/ 体积 0 窗口漏判 | 体积 1 的蒸汽必造成 2 伤；体积 1 的麻痹气必上 20；tile 在 + volume 0 照结算（3 用例） |
| ②比例 | 伤害仍是定值 | 玩家蒸汽 2（非 1）；zombie 毒气 5；troll 毒气 4（3 用例） |
| ③下限 | `max(1,…)` 钳制漏掉 | rat（maxHp 6）恰受 1 点而非 ⌊6/15⌋=0 |
| ④刷新 | max() 写成叠加或覆盖 | 连站两回合混乱恒 25（stack→50 翻红）；先 confused 40 后仍 40（覆盖→25 翻红）；麻痹同式（3 用例） |
| ⑤药水 | 麻痹药水仍直上状态 | 喝后脚下 GAS 层 = PARALYSIS_GAS 且云真实铺开；时长经效果判定为 19/20 而非旧路径的 7（2 用例） |
| ⑥毒口径 | 毒气仍上 poisoned 状态 | 站毒气 hp−2 且无状态；致死归因 lastDamageSource='caustic gas'（Time.c:622-625）（2 用例） |
| ⑦豁免 | respiration 符文甲不豁免 / 豁免前置越界 | 穿甲站毒气不掉血 + autoIdentify；混乱/麻痹同豁免；无甲对照掉 2；**组外气体（甲烷）不触发自动鉴定**（CE Time.c:409-412 的 cellHasTerrainFlag 前置）（4 用例）——**本组抓出过实现初版的真 bug（§八.1），组外鉴定一例是 §八.2 的 diff 复核产物** |
| ⑧结构 | 无载体被偷接 / 字段抄错 | PARALYSIS_GAS 旗标组合（有 PARALYSIS、无 DAMAGE/CONFUSION、可燃、QUICK 消散）；MONST_INANIMATE 三不沾（2 用例） |
| ⑨火哨兵 | 火侧被意外改动 | FIRE-NAT seed2026 全 40 位 + seed777 全 31 位逐位基线（2 用例） |
| ⑩G 哨兵 | G-1 扩散 / G-2 气源被意外改动 | 9000 单轮精确守恒 + 3×3 块分布；蒸汽源 +15；效果路径零 RNG 消耗（3 用例） |
| 验收 | 载体链断裂 | GasType.PARALYSIS ≡ TerrainType 值；isGasTerrain；addGas 通路 + 镜像（1 用例） |

### 7.2 反向验证（7 条，真实改坏 → 真实失败输出 → 还原；`grep -rn REVERT-ME src` = 0）

**R1 阈值回潮（效果门加 `&& cell.volume > 20`）→ 对抗① 3 处翻红：**

```
AssertionError: 密度 1 的蒸汽必须造成 max(1,⌊30/15⌋)=2 伤害（CE 无阈值）: expected 30 to be 28
AssertionError: 密度 1 也必须上麻痹（max(…,20)）: expected +0 to be 20
AssertionError: tile 在 + volume 0：CE 旗标判定命中，伤害照结算: expected 30 to be 28
Tests  3 failed | 22 passed (25)
```

**R2 比例回退定值（damage = 1）→ 8 处翻红：**

```
AssertionError: 蒸汽对玩家（maxHp 30）= 2/回合，不是旧定值 1（定值实现翻红）: expected 29 to be 28
AssertionError: 毒气对 zombie（maxHp 80）= 5/回合，不是 1: expected 79 to be 75
AssertionError: 毒气对 troll（maxHp 65）= 4/回合: expected 64 to be 61
（另 5 处同链：阈值组两用例、毒口径组两用例、无甲对照）
Tests  8 failed | 17 passed (25)
```

**R3 下限漏掉（damage = Math.floor(maxHp/15)）→ 精确 1 处翻红：**

```
AssertionError: 下限 1：rat（maxHp 6）受 1 点而不是 ⌊6/15⌋=0（漏钳制 → 0 伤害翻红）
Tests  1 failed | 24 passed (25)
```

**R4 max() 刷新写成叠加（confused 走 'stack'）→ 2 处翻红：**

```
AssertionError: 第二回合刷新后仍 25，不得叠到 50: expected 50 to be 25
AssertionError: max(40,25)=40——覆盖成 25 的实现翻红: expected 65 to be 40
Tests  2 failed | 23 passed (25)
```

**R5 效果路径注入掷骰（rng.randPercent(50)）→ 零 RNG 守卫翻红：**

```
AssertionError: applyEnvironmentalEffects 不得消耗任何 RNG 抽取: expected 1 to be +0
Tests  1 failed | 24 passed (25)
```

**R6 火侧改坏（GRASS chanceToIgnite 15→50；另试过暴露封顶 12→6，
后者在 FIRE-NAT 场景 40 回合内不可观测、哨兵不红——已一并还原）→
两条 FIRE-NAT 翻红：**

```
AssertionError: expected [ 1, 3, 5, 6, 10, 13, 15, 16, …(32) ] to deeply equal [ 1, 2, 3, 3, 4, 4, 5, 5, 6, 7, …(30) ]   (seed2026)
AssertionError: expected [ Array(40) ] to deeply equal [ Array(31) ]                                                       (seed777)
Tests  2 failed | 23 passed (25)
```

**R7 麻痹药水回退直上状态（applyTimedStatus 8）→ 2 处翻红：**

```
AssertionError: CE DF_PARALYSIS_GAS_CLOUD_POTION：麻痹气云落在脚下: expected +0 to be 39
AssertionError: expected [ 19, 20 ] to include 7
Tests  2 failed | 23 passed (25)
```

七条全部还原并复绿（25/25）。

### 7.3 既有测试改动逐条清单（全部在授权清单内，守卫性质未放宽）

| 文件 | 改动 | 为什么到期 | 守卫性质未放宽 |
|---|---|---|---|
| c_4a_0_layer_model.test.ts | 两张穷举 toEqual 全量表各 +1 行（PARALYSIS_GAS: GAS 层 / prio 35） | 任务书授权清单；新增地形必打红穷举表（任务书 §四预告） | 穷举性质不变（全键 toEqual 原样，只添新键） |
| c_4a_terrain_catalog.test.ts | names 39→40 + 注释；新增"G-3 新增条目：PARALYSIS_GAS 逐字段钉死"用例（含错误实现注释：漏 PARALYSIS 旗标/消散档抄 SLOW/漏可燃）；import 补 T_CAUSES_PARALYSIS | 同上 | 逐字段钉死 = 穷尽断言；既有 G-1/G-2 钉死用例零改动 |
| g_2_gas_df_wiring.test.ts | 对抗⑦按 G-2 §九.1 预告翻转：PARALYSIS 出列（tile 名单、GasType 名单），加两条正向在位断言（isGasTerrain(PARALYSIS_GAS)、names['PARALYSIS_GAS']）；无载体 DF id 集合 10→11（+159）；测试名与注释注明"PARALYSIS_GAS 已于 G-3 反转"、原断言内容存档 | 授权清单 + 该断言记录的前提（五气体无载体）被本轮的载体落地翻转——正是"留痕反转"标准流程 | 四气体缺席半边原样；DF 缺席名单只增不减；DF_MISSING_TILES 恰 7 条断言原样（本轮未动 DF 目录） |
| f_1_fire_as_terrain.test.ts | GAS 层守卫白名单 +PARALYSIS_GAS（正向枚举集合随目录同步，G-2 对 METHANE_GAS 的同款先例），注释续写"G-3 扩集合" | 授权清单；该守卫是正向枚举（"GAS 层只允许列出的气体地形"），新气体 tile 迁移后守卫集合必须与目录同步，否则下一个在场景里合法注入麻痹气的测试会误红 | 守卫半边原样（非气体地形出现在 GAS 层仍翻红；PLAIN_FIRE 禁入 GAS 层原样）；只扩合法气体集合，不放宽判定 |
| p1_24_death_sink.test.ts | :251 行尾注释"density>20 才结算"→"G-3 起无阈值站进即结算；rat maxHp=6 → max(1,⌊6/15⌋)=1，伤害不变" | 该注释描述的阈值机制本轮退役；断言本体（1 HP rat 被 50 体积蒸汽精确归零）在新口径下数值不变、继续成立 | **断言零改动**，仅注释翻新 |

f_2a / f_2b / c_4b / c_4c / p4_4 / monster_stats_effect /
hunger_regen / p1_30：**零改动**（授权未动用）——全量实测全绿。特别地：
f_2b 的 GAS_BASELINE 四型曲线是
扩散快照、与效果判定解耦，实测逐位不动；monster_stats_effect /
hunger_regen 两个重型长跑实测不受影响（自然关卡无外力不产气——F-0 §4.3
同款结论）。f_1 的白名单扩集合（上表）是授权清单内的守卫同步，其实测
场景（只注入 POISON）本来就不会踩到 PARALYSIS_GAS——扩集合是随目录
同步的口径一致性动作，不是翻红修复。

### 7.4 门禁逐条（任务书 §六）

1. **火侧逐位不变：PASS**（§六.1 三方逐位比对）。
2. **G-1 扩散/G-2 气源不变：PASS**（§六.2；算法零 diff + 行为复验）。
3. **量化对比：见 §五**（阈值取消前后中招窗口 1→10 回合；比例伤害
   zombie 5× rat 的实测表）。
4. **载体盘点表：见 §三**（做 1 / 登记记 4，取舍理由在表内）。
5. **决定性复验 + generation_baseline 绿 + 坏层闸门 0**：全量串行内
   c_1/c_2/generation_baseline/p1_26/p1_29/p1_33 实测绿（§七.5 输出）。
6. **build / npm test**：见下。

```
npm run build（exit 0）：
(!) Some chunks are larger than 500 kB after minification. …
✓ built in 1.4s
```

```
全量串行 npx vitest run --fileParallelism=false（终态树——探针已删后复跑）：
 Test Files  73 passed (73)
      Tests  834 passed | 8 skipped | 5 todo (847)
（账目对账：G-2 终态 72 文件 / 820 用例（807 passed + 8 skipped + 5 todo）
  → 本轮 +1 文件（g_3_gas_effects，26 用例）+ c_4a_terrain_catalog
  +1 用例（G-3 新增条目钉死）= 73 文件、820+27=847 用例；
  807+26+1=834 passed、8 skipped、5 todo 逐项对上。）
```

---

## 八、与预设不符之处 / 对任务书的修正与反驳（只列事实）

1. **★ 实现初版的真 bug，被本轮自己的对抗性测试抓出**：respiration 豁免
   包裹（CE Time.c:408-424 的 `else` 结构）初版只套住了麻痹/伤害两段，
   **混乱段漏豁免**——对抗⑦"同甲对混乱/麻痹也豁免"立即翻红
   （`expected true to be false`）。已修复（混乱分支加 `!respirationImmune`）。
   该豁免是任务书范围外的自选实现（web 有 respiration 符文载体、CE 判定
   条款的一部分），但从立项到修复都在本轮测试网内，如实登记。
1b. **★ diff 复核抓出的第二处保真度问题（同属 respiration 判定）**：初版
   的 `respirationImmune` 对**任意** GAS 层 tile 都成立——甲烷
   （T_IS_FLAMMABLE，不在 T_RESPIRATION_IMMUNITIES 组）也会触发护甲自动
   鉴定。CE 的豁免块有前置 `cellHasTerrainFlag(…, T_RESPIRATION_IMMUNITIES)`
   （Time.c:409-412），组外气体根本不进该块。已修复（判定加组旗标前置）
   并补对抗用例"甲烷不触发自动鉴定"钉住。两例合训：豁免类逻辑的
   "包裹结构"与"触发前置"都要逐行对 CE，任务书 §五 的重核要求正是为此。
2. **任务书 §二.3 说"麻痹药水……参照 CE Items.c:6994/8118
   （DF_PARALYSIS_GAS_CLOUD_POTION，1000 体积、半径 4）"——其中"半径 4"
   实为 CE 目录行的 flashColor/effectRadius 列（&pink 光效半径，Globals.c:778
   倒数第 2 列），不是气体铺展半径**；气云的铺展由体积扩散自然长出（G-1
   折算口径）。按"半径 4 = 铺展参数"理解会造出自创扩散逻辑。药水云的
   注入口径取 addGas(1000)（G-1 毒药水先例），**DF 条目未入目录**：C-4b E2
   的闭包自洽断言（目录键集 == 地形字符串起点 + subsequentDF 闭包）会把
   游戏侧引用的孤立条目判为"闭包外多一条"而翻红——直注与 DF 生成的
   GAS 分支行为逐位等价（G-1 §三 实测过等价性），故不为此扩测试授权面。
   DF#159 的缺席已在 g_2 对抗⑦ 加码登记（F-2c/数据轮若要归线，按当时
   断言重新对账）。
3. **i18n 边界两难（已取折中，请验收方裁定）**：药水改线使
   `potion.paralyze_burst` 的旧文案（"你被定身了！"）与 CE 原文
   （"your muscles stiffen as a cloud of pink gas bursts from the open
   flask!"）不再对应。改文案需要改既有键值（超出"仅增键"）；弃用该键会
   触发 p1_30 死键闸门（归档到 zh_CN.legacy.json 又不在允许清单）。
   取折中：**沿用该键**，其文案描述的正是随后到来的麻痹结局（玩家同回合
   经效果判定麻痹 20），语义不假。CE 的双消息结构（药水消息 + 麻痹消息）
   在 web 得到保留。本轮实际新增键仅 2 个：
   `runic.armor.respiration_gas`、`death.caustic_gas`。
4. **G-2 §九.3 的登记（毒气陷阱调用点改走 DF 管线）本轮未做**：trap 仍
   直呼 addGas(1000)。本轮聚焦效果侧；消息双播问题原样存续，登记链不变。
5. **G-2 §九.4 的"效果阈值 >20 体积口径重裁"预告与 F-0 §5.3-10 的表述
   有一处偏差**：F-0 表中"web 现状"写"POISON 无阈值"——实测旧代码里
   POISON 走的是"无阈值但上 5 回合中毒状态"，其偏差本质不是阈值而是
   **效果类型错挂**（T_CAUSES_DAMAGE 被实现成毒状态）。本轮按 CE 把两条
   一起翻正，§5.3-10/11 两行实为同一处错抄的两个侧面。
6. **玩家侧 confused 无行为消费者**（仅侧栏显示）：CE 混乱气体会让玩家
   乱走（STATUS_CONFUSED 的输入错乱），web 的玩家混乱行为影响未实现
   （entities/ 禁改，亦非本轮效果判定范围）。旧的"玩家上 hallucinating"
   实为借幻觉视觉曲线模拟混乱的做法，随重裁退役；幻觉视觉对混乱气的
   覆盖随之消失（CE 原本也不给幻觉），登记为玩家体感变化。
7. **怪物侧 applyStatusToMonster 的抗性/免疫折减**仍沿用既有 web 口径
   （statusResistTurns 减时长、statusImmunities 全免、'gas' 源静默）——
   CE 气体对怪物无抗性掷骰，但该口径是先前轮次的既定翻译层，本轮沿用
   不新开偏差；'gas' 源静默语义与 CE 的"gas 不打印免疫消息"吻合
   （applyStatusToMonster 源参数注释）。
8. **PARALYSIS 麻痹下玩家动作封锁的回合推进语义**（paralyzed 时 wait 被
   拒、时间不流动 → 云不消散、状态不递减）是 web 既有麻痹机制（P 轮起
   即如此），本轮未动。CE 的麻痹是"时间照流、只是动不了"，两者在
   "站自己毒云里"场景下表现不同（web：状态恒 20；CE：20 回合后自然苏醒
   且云已散）。属既有机制缺口，登记不扩大。
9. **探针测量口径登记**：BEFORE 轮 `[GAS-QTY]` 的怪物侧 damage 字段打了
   剩余 hp（公式笔误），BEFORE 数据按 hp 余量解读（rat 5=zombie 系…即
   各 -1），与 F-0 §4.6 的发表值吻合；AFTER 轮已修正公式。哨兵三类输出
   （FIRE-NAT/DMG-FIRE/GAS-DIFF）两轮脚本逐字节相同，比对有效。
10. **`zz_g3_probe.test.ts` 已删**（临时探针不入库，交付前复核
    `git status`）；其输出全文已录入本报告 §五/§六。

---

## 九、给 F-2c / 后续轮的登记清单

**F-2c（爆炸，下一轮）**：
1. DF_EXPLOSION_FIRE 条目已备（G-2，start 60/decr 17，tile null）——迁
   GAS_EXPLOSION tile（Globals.c:496，T_IS_FIRE|T_CAUSES_EXPLOSIVE_DAMAGE）、
   填 tile、摘 DF_MISSING_TILES 后爆轰圈自动成形。**提示**：GAS_EXPLOSION
   flags 含 T_CAUSES_EXPLOSIVE_DAMAGE（不在 T_RESPIRATION_IMMUNITIES 组），
   本轮的旗标分派不会误吸它；爆炸的瞬时伤害模型（max(15-20, 50%) +
   5 回合同格免，Time.c:343-345）是独立机制，勿复用本轮的 T_CAUSES_DAMAGE
   比例路径。
2. 爆炸伤害若走 applyEnvironmentalEffects 的旗标分派，需处理
   "T_CAUSES_EXPLOSIVE_DAMAGE ≠ 持续伤害"的语义（瞬时 + 豁免表）——建议
   独立分支，勿并。
3. c_4a 两张全量表、c_4a_terrain_catalog 钉死用例、FIRE_TERRAIN_TYPES
   判定集同步（同 G-2 流程）。

**怪物侧 DF 发射轮（ROT_GAS 载体）**：
4. zombie 双列（bloodType DF_ROT_GAS_BLOOD=12 体积血气；DFChance 100/
   DFType DF_ROT_GAS_PUFF=15 体积/醒回合）+ monsters.json 数据轮 +
   Monster.ts 的发射机制（醒回合掷骰、受击/死亡喷血气）。
   monsters.json / entities/ 现均在禁改清单，需任务书提前授权。
   届时 T_CAUSES_NAUSEA 的效果处理器（含 vomit 机制，Monsters.c:3742
   25% 呕吐断行动 / Movement.c:1236,1423）一并落地——**注意**：恶心不在
   T_RESPIRATION_IMMUNITIES……更正：**在**（Rogue.h:1956 四旗标含
   T_CAUSES_NAUSEA），且 web 的 respiration 豁免结构已预留旗标分派扩展点。
5. 'nauseous' 不在 StatusId 联合（Creature.ts 禁改）——届时按 F-2b
   statusDurations 逃生舱键先例 + statusConfig 显示条目处理。

**黑暗/疗养轮（若立项）**：
6. DARKNESS_CLOUD 需要：黑暗药水（consumables.json 新条目）+ 渲染侧
   负光照模型（CE darknessCloudColor {-20,-20,-20} 500 半径）——纯状态
   化实现是错抄（STATUS_DARKNESS 只服务矿灯半径，Globals.c:8088-8091、
   Light.c:132-140）。
7. HEALING_CLOUD 需要：血花草地形对（STALK/POD，Globals.c:513/514）+
   生成侧落点 + T_CAUSES_HEALING 效果处理器（max(1, maxHP/15) 同式回血，
   Time.c:645-663——比例公式本轮已在伤害侧验证，复制时注意豁免集差异：
   healing 不豁免 INVULNERABLE）。

**数据/文案轮**：
8. `potion.paralyze_burst` 文案与 CE 原文的对应关系（§八.3 的折中）请
   文案轮裁定；若改键值，需一并处理"仅增键"边界的显式授权。
9. 扔掷药水（thrown potion 碎裂产云，Items.c:6977-6997：POISON/
   CONFUSION/PARALYSIS/INCINERATION 四类）是 web 既有缺口——麻痹药水的
   扔掷路径若实装，直接复用本轮的 addGas(1000) 口径。
10. 玩家 confused 的行为侧（输入错乱/乱走）与 web 麻痹的"时间冻结"语义
    （§八.8）是两个既有缺口，建议独立玩家状态轮，勿搭气体轮。

---

## 十、文件边界自查

```
git status --porcelain（终态，探针删除后）：
 M brogue-web/src/engine/Core/Game.ts               ← 允许清单
 M brogue-web/src/engine/Environment/Gas.ts         ← 允许清单
 M brogue-web/src/engine/Map/Grid.ts                ← 允许清单
 M brogue-web/src/engine/Map/TerrainCatalog.ts      ← 允许清单
 M brogue-web/src/locales/zh_CN.json                ← 允许清单（仅增 2 键）
 M brogue-web/src/test/c_4a_0_layer_model.test.ts   ← 授权既有测试
 M brogue-web/src/test/c_4a_terrain_catalog.test.ts ← 授权既有测试
 M brogue-web/src/test/g_2_gas_df_wiring.test.ts    ← 授权既有测试
 M brogue-web/src/test/p1_24_death_sink.test.ts     ← 授权既有测试（仅注释）
 M brogue-web/src/test/f_1_fire_as_terrain.test.ts  ← 授权既有测试（白名单扩集合）
?? brogue-web/src/test/g_3_gas_effects.test.ts      ← 新增测试（允许）
未触碰：BrogueCE-master/、src/data/*.json、src/entities/、src/components/、
src/engine/Generator/、src/engine/Random.ts、vite.config.ts、
src/test/fixtures/*、src/test/harness.ts、zh_CN.legacy.json、
DungeonFeatureCatalog.ts（addGas 直注方案使其零改动）。
git 写操作：零（status/diff/log 只读）。
```
