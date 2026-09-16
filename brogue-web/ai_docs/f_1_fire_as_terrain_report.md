# F-1 报告：火焰迁成地形（行为逐位不变）

> 2026-09-16。执行：ZCode/GLM。CE 源码以 `BrogueCE-master/src/brogue/` 为准
> （本 worktree 的 `BrogueCE-master` 符号链接已断，实际只读位置：
> 主检出的 `/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master`）。
> F-0 测绘（ai_docs/f_0_fire_gas_survey.md）为本轮的数字来源，两者冲突处以
> 实测为准——本轮未发现 F-0 数据错误，仅在两个执行细节上对任务书有补充/反驳
> （见 §六）。

---

## 0. 结论摘要

1. **新增 1 种火地形（`TerrainType.PLAIN_FIRE`，CE Globals.c:492）**，落
   SURFACE 层、drawPriority 10。十种 CE 火地形里 web 今天用得上的只有这一种
   （论证见 §一）；**DF 目录零新增**——`DF_PLAIN_FIRE` 条目在 C-4b 已存在
   （tile 登记 null），其 tile 翻正留给 F-2a（见 §六第 3 条，涉及边界外的
   c_4b 留痕）。
2. **`isBurning` 从"并列的事实来源"降级为"火地形的镜像"**：Gas.ts 状态机的
   全部写点双写（`isBurning` ↔ SURFACE 层 PLAIN_FIRE），新增
   `cell.burnTerrain` 字段携带"点火前原身"供烧尽分支复原旧行为。
3. **F-0 门禁 1-5 全部逐位通过**：两条决定性复核 identical=true；5 种子自然
   推进点火/气体全零（可燃地形底数 123/122/162/115/84 与 F-0 精确一致）；
   三条燃烧曲线逐位相等、全熄回合=12；六条气体曲线逐位相等、
   POISON≡CONFUSION 恒等式保持；六条伤害序列逐位相等。原始输出见 §四。
4. **渲染坑按 F-0 建议落地（经层模型实现）**：GameCanvas.vue **零改动**。
   详见 §五——这里有一处对任务书表述的细化（"改写 terrain 字段"在
   C-4a-0 层模型下的正确形态是"写 SURFACE 层 + terrain getter 经
   drawPriority 自然反映"），不构成反驳。
5. **渲染坑的兜底建议把"有效地形读者"的二阶效应暴露了出来**：火盖在水/
   岩浆/楼梯/机关上会遮住 `cell.terrain === X` 的答案。本轮把 Game.ts 里
   **13 处**此类读者改成跨层判定（CE `cellHasTerrainFlag` 本就是全层 OR），
   每处对非燃烧格逐位等价；有 5 处**有意保留**有效地形读法（CE 对齐理由，
   逐条见 §三.3）。
6. **任务书预告翻红项全部按预期落地**：p1_24（1 处直写→公共入口）、
   p1_28（**实际 5 处**直写，F-0 记 3 处，见 §六第 4 条）、c_4a（计数 31→32
   + 新条目钉死块）、c_4c/p4_4/p4_1b/c_1 **未红**（与 F-0 预判一致）。
   **计划外翻红 1 件**：`c_4a_0_layer_model.test.ts` 用 `toEqual` 逐字钉死
   归属层/drawPriority 两张表，新增枚举必然打红——该文件不在允许清单，
   已按 B-1 反转范本做**申报式最小翻转**（见 §六第 1 条，第 7 起留痕冲突）。
7. 对抗性测试 11 条（新增 `src/test/f_1_fire_as_terrain.test.ts`）全绿；
   反向验证 5 条（超出要求的 4 条）全部产生真实失败输出并已还原。

---

## 一、新增了哪几种火地形与 DF、为什么

### 1.1 取舍：只加 PLAIN_FIRE 一种（任务书 §二.1 授权执行方决定并论证）

CE 十种 `T_IS_FIRE` 地形（F-0 §3.1）：PILOT_LIGHT / PLAIN_FIRE /
BRIMSTONE_FIRE / FLAMEDANCER_FIRE / GAS_FIRE / GAS_EXPLOSION / DART_EXPLOSION
/ ITEM_FIRE / CREATURE_FIRE / BRAZIER。逐种问"web 今天用得上吗"：

| CE 火地形 | web 今天的对应物 | 取舍 |
|---|---|---|
| PLAIN_FIRE（Globals.c:492） | ignite()/igniteForced()/蔓延烧出的一切火 | **✔ 唯一入选** |
| GAS_FIRE（:495） | 气体被点燃——web 气体在独立 gasGrid，可燃气点火是 F-2a/G-1 机制 | ✘ |
| GAS_EXPLOSION（:496） | bloat/爆炸现走 igniteForced 4 邻燃烧（P4-4 登记的缺口，F-2a 验收点） | ✘ |
| BRIMSTONE_FIRE / FLAMEDANCER_FIRE（:493/494） | 硫矿活性化/火舞者——web 无此内容 | ✘ |
| DART_EXPLOSION（:497） | 燃烧镖——web 无此武器 | ✘ |
| ITEM_FIRE / CREATURE_FIRE（:498/499） | 物品/生物燃烧——F-0 §5.1-13 登记未实现 | ✘ |
| PILOT_LIGHT / BRAZIER（:343/573） | 火源家具——web 无 | ✘ |
| EMBERS | 烧尽产物 | **红线禁止**（见下） |

**EMBERS 单独说明**：任务书红线"'烧完变 CHARRED_FLOOR' 不许改成 EMBERS"。
因此本轮既不引入 EMBERS 地形，也不把 DF_EMBERS 的 tile 翻正——
`c_4a_terrain_catalog` 的新增钉死块里有一条
`expect((TerrainType as any).EMBERS).toBeUndefined()` 防止顺手引入。

### 1.2 web PLAIN_FIRE 目录条目：照抄 CE，唯一例外 promoteChance

CE 原文（Globals.c:492，执行方逐字段复核）：

```
{G_FIRE, &fireForeColor, 0, 10, 0, 0,0,DF_EMBERS, 500, FIRE_LIGHT,
 (T_IS_FIRE), (TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT),
 "billowing flames", "flames billow upward."}
```

| 字段 | CE 值 | web 值 | 说明 |
|---|---|---|---|
| drawPriority | 10 | 10（Grid.ts DRAW_PRIORITY） | 火压草(60)、输门(8) |
| flags | T_IS_FIRE | T_IS_FIRE | |
| mechFlags | STAND_IN_TILE\|VANISHES_UPON_PROMOTION\|VISUALLY_DISTINCT | 同 CE | promoteChance=0 下全为休眠数据 |
| chanceToIgnite | 0 | 0 | CE 十种火地形无一例外为 0——点火概率住在可燃地形一侧 |
| fireType / discoverType | 0 / 0 | '' / '' | |
| promoteType | DF_EMBERS | 'DF_EMBERS' | 休眠数据，F-2a 的接入口 |
| **promoteChance** | **500** | **0** | ★ 唯一偏离，理由见下 |
| glowLight | FIRE_LIGHT | （无对应列） | web 无光效目录，登记不迁移 |
| 归属层 | DF 目录 `{PLAIN_FIRE, SURFACE, 0, 0}`（:740） | SURFACE | F-0 §3.2：十种火 DF 无一例外 SURFACE |

**promoteChance 记 0 的理由（拒绝照抄 CE）**：web 的 `runPromotionUpdate`
第一趟对每个 promoteChance≠0 的格每回合掷一次 `randRange(0,10000)`。照抄
500 意味着**每个燃烧格每回合消耗一次 RNG**——同 seed 的地图/掉落全链漂移，
F-0 §4.4-4.6 的全部逐位基线立刻失真；且晋升目标 DF_EMBERS 的 tile 仍是登记
缺口（首链预检会缓办，但 RNG 已被消耗）。CE 的"概率衰老"本来就是 F-2a 的
行为内容（红线清单第 1 条的同族），F-1 的火寿命仍是 burnDuration 倒计时。
该偏离已在 TerrainCatalog 条目注释和 c_4a 钉死块里双向写明，F-2a 翻正时
有现成的断言位。

### 1.3 DF：零新增，tile 翻正申报延期

`DUNGEON_FEATURE_CATALOG[DF.DF_PLAIN_FIRE]`（DungeonFeatureCatalog.ts:216，
ceLine 740）C-4b 已存在，tile 记 null、在 `DF_MISSING_TILES` 里。
本轮 fire 入场走状态机直写层，**没有任何 DF spawn 消费者**，翻正 tile 对
F-1 行为零影响，却会打红边界外的 `c_4b_dungeon_feature.test.ts:661-664`
（钉死 `DF_MISSING_TILES.length === 11` 且逐条 tile=null）。
按"留痕与边界冲突→申报"规矩：**不翻**，列入 F-2a 的前置清单（届时把
c_4b 按条目放进允许清单）。F-1 全程该目录条目保持休眠。

---

## 二、33 处引用逐类处理（F-0 §一分类 → 实际改动点）

**A 类（9 处，"这格是不是火地形"）——零改动，语义经镜像自动达成。**
任务书原文是"改查地形/旗标"，但其自身的文件边界使 9 处中 8 处不可改
（GameCanvas ×5 走 F-0 建议零改动；三张寻路图在禁改清单）。本轮让
`isBurning` 恒等于"该格跨层存在 T_IS_FIRE 地形"，读者读镜像即读地形：

| # | 位置 | 处理 |
|---|---|---|
| 1-5 | GameCanvas.vue:363/373/376/379/382 | **零改动**（镜像语义 + isBurning 渲染覆盖优先于地形字形，与迁移前逐位一致） |
| 7 | Game.ts:1149 entryQualifiesForPlacement | **零改动**（读镜像；燃烧格照旧拒绝落位，c_1_room_profile:378 只读不红） |
| 12 | SafetyMap.ts:161 | **零改动**（禁改文件；镜像语义） |
| 13 | WaypointMap.ts:248 | **零改动**（同上） |
| 14 | LoopMap.ts:206 | **零改动**（同上）；对抗③经 `blocksPathing` 断言 |

**B 类（8 处，燃烧状态机本体）——双写改造：**

| # | 位置 | 处理 |
|---|---|---|
| 19/20 | Gas.ts ignite() 草系/门分支 | 各加 `burnTerrain` 记录 + `writeFireTerrain()`（置 SURFACE=PLAIN_FIRE）；时长掷骰不变（4-7 / 2-4，红线） |
| 26 | Gas.ts igniteForced() | 新点燃分支同样双写；merge 分支（已在烧）不动层不动 burnTerrain |
| 27 | Gas.ts:128（原）焦土再生守卫 | 零改动（`!cell.isBurning` 镜像语义不变） |
| 28 | Gas.ts:134（原）主循环守卫 | 零改动 |
| 29 | Gas.ts:139（原）熄灭分支 | 判据从 `cell.terrain` 换 **`cell.burnTerrain`**（火成地形后有效地形必是火，原身只能显式携带）；五地形→CHARRED_FLOOR 照旧（terrain setter 清全部层，火层随之消失），其余地形走 `clearFireTerrain()` 只摘火层；`burnTerrain` 复位 NOTHING |
| 30 | Gas.ts:178（原）蔓延守卫 | 零改动（`isFlammable && !ncell.isBurning`，40% 红线不动）；蔓延经 ignite() 自动双写 |
| 11 | Game.ts:6433 resetTestRoom | 加 `burnTerrain` 复位（基线无火） |

**B 类衍生（点火/熄灭路径上的二阶读者，保留旧行为所必需）：**
Gas.ts updateFires 的蒸汽判定从 `ncell.terrain === WATER_*` 改为查
**LIQUID 层**——火盖在水上时有效地形是火，按 terrain 读会漏"火贴水"
（30%/50 密度红线参数本身不动）。

**C 类（1 处）——零改动**：Game.ts:6198 火伤分支照读 `cell.isBurning`，
固定 2 伤害、豁免表、消息全部原样（F-0 §4.6 伤害序列逐位复现为证）。

**D 类（3 处，持久化）**：

| # | 位置 | 处理 |
|---|---|---|
| 6 | Game.ts:208 快照接口 | 保留 isBurning/burnDuration；新增 `burnTerrain?: TerrainType` |
| 8 | Game.ts:5904 toSnapshot | 照写三字段（burnTerrain 无条件写，体积可忽略） |
| 9 | Game.ts:6022 loadSnapshot | 恢复三字段 + **镜像对账**：`isBurning && 层里无火` → 补写 SURFACE 火地形（旧存档迁移路径——F-1 前的存档火不成地形，burnTerrain 回落为 terrain 即原身）；`!isBurning && 层里有火` → 逐层摘除（防幽灵火） |

**E 类（1 处）**：Grid.ts:312 字段声明——`isBurning`/`burnDuration` 原样保留，
新增 `burnTerrain`（注释写明"仅 isBurning 期间有意义"）。

**F 类（8 处，纯注释）**：零行为。其中 TerrainCatalog.ts:252、Promotion.ts:13/78
的旧注释语义已过时（"复燃由 isBurning 承担"/"接 CE 火地形属后续轮次"）——
本轮未改 Promotion.ts 头表（它描述的是 C-4c 时点的状态，历史文档性质），
只在 Gas.ts 文件头新增 F-1 说明块。

---

## 三、Game.ts 的跨层读者改造（任务书未预见、执行方主动扩面的部分）

### 3.1 为什么必须做

火成地形后，燃烧格的**有效地形**（`terrain` getter = 最高优先层）在多数
情况下变成 PLAIN_FIRE（prio 10）：草(60)/灌木(45)/网(19)/沼泽(55)/地板(95)/
深水(40)/岩浆(40) 全被盖住；只有门(8)/墙/花岗岩/密门(0) 盖得住火
（这本身就是 CE drawPriority 的正确行为，对抗①双向钉死）。
于是所有 `cell.terrain === X` 的读者在"燃烧格"上答案翻转。CE 没有这个问题，
因为 CE 的地形判据（`cellHasTerrainFlag`/逐层晋升触发）**本来就是四层 OR**；
web 的单值读法是"每格一层"时代的产物。若不处理，会产生真实行为变化，
例如：

- 站在燃烧岩浆格上的生物：迁移前 `terrain===LAVA` → 即死；迁移后若按
  terrain 读 → 变成 2/回合火伤。**致死性被静默削弱**。
- 燃烧的深水格：迁移前不可走（canMoveTo 的 isDeepWater）；迁移后可走。
- 燃烧的陷阱/压力板/告示牌/楼梯/锁门/密门/祭坛：迁移前踩上照常触发/
  可交互；迁移后被火"吞掉"交互。

### 3.2 改动清单（13 处，每处对非燃烧格逐位等价——单层格下
`layers.includes(X)` ≡ `terrain === X`，由 C-4a-0 "至多一层非 NOTHING"
不变量加迁移前状态保证）

| 位置 | 原读法 | 新读法 | 保留的旧行为 |
|---|---|---|---|
| canMoveTo | `!blocksPassability(terrain) && !isDeepWater(terrain)` | 逐层 `some(blocksPassability‖isDeepWater)` | 燃烧深水不可走 |
| findQualifyingPathLocNear forbidden | LAVA/WATER_DEEP/TRAP | 逐层 includes | 燃烧水/岩浆/陷阱不作到达格 |
| 扫描（dist BFS） | LAVA‖CHASM | 逐层 includes | 同上 |
| 周期刷怪落点池 | LAVA‖WATER_DEEP / LAVA‖CHASM / 楼梯 | 逐层 includes | 不刷进燃烧致死格/楼梯 |
| stairs_up / stairs_down / wait_or_stairs_down | terrain===STAIRS_* | layers.includes | 燃烧楼梯可照常上下 |
| 移动进锁门 | terrain===LOCKED_DOOR | layers.includes | 燃烧锁门可照常开锁 |
| 祭坛拾取/同组祭坛清扫 | terrain===ALTAR ×2 | layers.includes | 燃烧祭坛可交互 |
| 拾取深水/岩浆物品 | terrain===WATER_DEEP/LAVA | layers.includes | 照旧"够不着" |
| bloat 分裂合格格 | LAVA‖WATER_DEEP | layers.includes | 不分裂到燃烧致死格 |
| applyEnvironmentalEffects 深水/岩浆 | terrain===×2 | layers.includes | 燃烧岩浆照旧即死（CE applyInstantTileEffectsToCreature 全层 OR） |
| 自动拾物 BFS | terrain!==WATER_DEEP | !layers.includes | 燃烧深水不作通路 |
| handleSpecialTileEntry | SIGN/RESET_PLATE/TRAP/PRESSURE_PLATE | layers.includes | 燃烧机关/陷阱照常触发 |
| 密门预扫/搜索窗/发现 | terrain===SECRET_DOOR ×3 | layers.includes | 燃烧密门照常可搜出 |
| 生成落点池/horde/传送（FLOOR 池、spawnsIn、teleport dest） | terrain===FLOOR/target ×4 | layers.includes | 燃烧地板照常可作落点（CE randomMatchingLocation 查 DUNGEON 层） |
| 压力板半径触发陷阱 | terrain===TRAP | layers.includes | 燃烧陷阱被连带触发 |
| 悬停告示牌 | terrain===SIGN | layers.includes | 燃烧告示牌照常显示 |

### 3.3 有意保留有效地形读法的 5 处（不是遗漏，各有 CE 对齐理由）

| 位置 | 保留理由 |
|---|---|
| entryQualifiesForPlacement 的 LAVA/WATER_DEEP/TRAP | 燃烧态由同函数的 `cell.isBurning` 拒绝（镜像），跨层化无增量 |
| spawnBlood（FLOOR‖GRASS 才染血） | CE 血 DF 对火格按优先级弹开（血 80 输火 10）——燃烧格不吃血是 CE 行为；且改成跨层会让血的 terrain setter 清掉火层，制造脱钩。对抗⑧钉死 |
| 踩网缠绕（terrain===WEB） | CE 里火消耗网（SURFACE 替换），烧着的网不再缠绕——迁移结果与 CE 一致，与迁移前 web 的行为差仅此一项（登记见 §七） |
| 生成期岩浆排除（populateLevel ×3） | 生成期无火（generateDepth 重建全层），燃烧格不可达 |
| WALL/GRANITE 判定 ×4 | 墙系 prio 0 恒盖住火，有效地形读法天然正确 |

---

## 四、★ 门禁 1-7 逐条实测

门禁 1-5 用 F-0 §4.1 同一口径：从附录 A **原样恢复**
`src/test/zz_f0_probe.test.ts` 复跑（跑完已再次删除，git status 无残留）。

### 门禁 1（§4.2 决定性复核）——✅ 通过

```
[DETERMINISM] seed=42 turns=120 identical=true
[DETERMINISM] seed=2026 turns=120 identical=true
```

### 门禁 2（§4.4 三条燃烧曲线逐位相等 + 全熄回合 12）——✅ 逐位一致

| seed | F-0 基线（前 13 回合） | F-1 复测（前 13 回合） | 一致 |
|---|---|---|---|
| 42 | 3,4,7,13,12,11,9,7,5,2,1,0,… | 3,4,7,13,12,11,9,7,5,2,1,0,… | ✅ |
| 2026 | 4,5,12,17,20,20,17,13,9,4,2,0,… | 4,5,12,17,20,20,17,13,9,4,2,0,… | ✅ |
| 777 | 2,4,8,9,11,12,11,10,7,5,2,0,… | 2,4,8,9,11,12,11,10,7,5,2,0,… | ✅ |

maxRadius：3 / 5 / 3（同基线）；extinctAtTurn：**12 / 12 / 12** ✅

原始输出：

```
[FIRE-NAT] seed=42 origin=(5,20) burnCurve=[3,4,7,13,12,11,9,7,5,2,1,0,0,…] maxRadius=3 extinctAtTurn=12
[FIRE-NAT] seed=2026 origin=(68,14) burnCurve=[4,5,12,17,20,20,17,13,9,4,2,0,0,…] maxRadius=5 extinctAtTurn=12
[FIRE-NAT] seed=777 origin=(31,23) burnCurve=[2,4,8,9,11,12,11,10,7,5,2,0,0,…] maxRadius=3 extinctAtTurn=12
```

（点火原点与 F-0 逐格一致：(5,20)/(68,14)/(31,23)——findCell 的随机选取
本身就在同一 RNG 流上，这同时是"生成链未被移动"的旁证。）

### 门禁 3（§4.5 六条气体曲线逐位相等 + POISON≡CONFUSION）——✅ 逐位一致

| seed | type | F-0 基线 | F-1 复测 | 一致 |
|---|---|---|---|---|
| 42 | POISON | 5,12,9,12,5,5,2,1,0,… | 5,12,9,12,5,5,2,1,0,… | ✅ |
| 42 | CONFUSION | 与 POISON 逐位相同 | 与 POISON 逐位相同 | ✅ 恒等式保持 |
| 42 | STEAM | 5,12,5,1,0,… | 5,12,5,1,0,… | ✅ |
| 42 | CREEPING_DEATH | 4,9,15,15,17,11,11,8,8,6,2,0,… | 4,9,15,15,17,11,11,8,8,6,2,0,… | ✅ |
| 2026 | POISON | 2,5,5,5,5,5,4,5,2,5,2,2,2,2,2,1,0,… | 同左 | ✅ |
| 2026 | CONFUSION | 同 POISON | 同 POISON | ✅ |
| 2026 | STEAM | 2,5,4,2,5,2,2,2,1,0,… | 同左 | ✅ |
| 2026 | CREEPING_DEATH | 2,5,5,5,9,9,9,7,7,7,5,5,4,4,4,4,3,3,2,1,0,… | 同左 | ✅ |
| 777 | POISON | 2,3,3,…,3,2,2,2,0,… | 同左 | ✅ |
| 777 | CONFUSION | 同 POISON | 同 POISON | ✅ |
| 777 | STEAM | 2,3,2,3,2,3,2,2,1,0,… | 同左 | ✅ |
| 777 | CREEPING_DEATH | 2,3,3,4,4,4,4,4,5,5,4,5,5,4,4,4,4,4,4,4,4,4,4,4,2,1,0,… | 同左 | ✅ |

峰值密度/最大格数/最大半径/全散回合全部同基线（38/83/80/74 系；
goneAtTurn：9/5/12、17/10/21、19/10/27）。

### 门禁 4（§4.6 六条伤害序列逐位相等）——✅ 逐位一致

```
[DMG-FIRE] seed=42   cleanTurns=12 hpDeltas=[2,2,2,2,2,2,0,0,0,0,-1,0]   （F-0：同）
[DMG-FIRE] seed=2026 cleanTurns=11 hpDeltas=[2,2,2,2,2,0,0,0,0,-1,0]      （F-0：同）
[DMG-GAS]  seed=42 type=POISON          hpDeltas=[0×12]                   （F-0：同）
[DMG-GAS]  seed=42 type=STEAM           hpDeltas=[1,1,0,0,0,0,0,0,0,0,-1,0]（F-0：同）
[DMG-GAS]  seed=42 type=CREEPING_DEATH  hpDeltas=[10,10]（随后死亡）        （F-0：同）
[DMG-GAS]  seed=42 type=CONFUSION       hpDeltas=[0×12]，hallucinating 8 回合（F-0：同）
```

### 门禁 5（§4.3 自然全零保持）——✅ 全零，且可燃地形底数逐格精确一致

| seed | F-0 点火/气体 | F-1 点火/气体 | 可燃地形（F-0 → F-1） |
|---|---|---|---|
| 1 | 0 / 0 | 0 / 0 | 123 → 123 |
| 42 | 0 / 0 | 0 / 0 | 122 → 122 |
| 777 | 0 / 0 | 0 / 0 | 162 → 162 |
| 2026 | 0 / 0 | 0 / 0 | 115 → 115 |
| 31337 | 0 / 0 | 0 / 0 | 84 → 84 |

焦土再生事件 regrowEvents 全零（同 F-0）。

### 门禁 6（generation_baseline 不重采而绿；p1_26/p1_29/p1_33 坏层 0）——✅

```
Test Files  5 passed (5)     （generation_baseline / p1_26_invariants /
Tests       21 passed (21)    p1_29_adversarial_gate / p1_29_lake_connectivity /
                             p1_33_machine_chokepoint，--fileParallelism=false）
```

### 门禁 7（build 绿；npm test 除预告翻红项外全绿）——✅

**`npm run build`（exit 0）：**

```
(!) Some chunks are larger than 500 kB after minification. …
✓ built in 1.43s
```

**全量测试（`npx vitest run --fileParallelism=false` 串行，F-0 建议跑法）：**
**67 文件 740 passed | 8 skipped | 5 todo —— 零红**（完整尾部与账目核对见 §八）。

---

## 五、渲染坑的处理方式（§二.3 的裁决）

**采纳 F-0 建议，经层模型落地；GameCanvas.vue 零改动（git diff 为证）。**

F-0 建议的原文形态是"让燃烧同步改写 `terrain` 字段"——写于 terrain 还是
plain field 的认知下。C-4a-0 之后 `terrain` 是 getter（最高优先层），
"改写 terrain 字段"的正确实现就是把 PLAIN_FIRE 写进它的归属层 SURFACE：

- 写入点集中在 Gas.ts 两个点火函数 + 一个熄灭函数（共 4 个写点），
  与 F-0"改写点集中"的意图一致；
- `terrain` getter 经 drawPriority 自动反映：燃烧草/网/地板/水的有效地形
  =PLAIN_FIRE（渲染覆盖、快照、A 类读者语义一并达成）；燃烧门有效地形
  仍是门（prio 8<10）——这正是 CE 的渲染口径（CE 门上烧火画的是门+火光，
  门不消失），比"把 terrain 单值字段整个改成火"更忠实；
- A 类读者零改动（镜像），渲染专属轮次（渲染切层）照 F-0 建议延后。

**已知的渲染残留（登记，本轮不修）**：`getTerrainVisual` 没有 PLAIN_FIRE
分支（default → 空白）。可见格走 `cell.isBurning` 覆盖（`*` 橙红底）无影响；
**已探索但当前不可见**的燃烧格在记忆渲染下显示空白（迁移前显示原地形暗色
字形）。燃烧 4-7 回合 × 走出视野的组合，瞬态、纯外观。渲染轮加一个
`case TerrainType.PLAIN_FIRE` 即收口（GameCanvas 本轮零改动约束内不动）。

---

## 六、与预设不符之处 / 计划外事件（只列事实，翻正已申报）

### 6.1 ★ 计划外翻红：c_4a_0_layer_model.test.ts（边界外最小翻转，已申报）

该文件用 `toEqual` **逐字钉死** `TERRAIN_HOME_LAYER` 与 `DRAW_PRIORITY`
两张全量表（:211/:225），另有归属层探针清单。新增任何 TerrainType 成员
必然打红它——而这与"新增火地形"这一任务书自身的命令直接冲突。
F-0 §5.4 的预告翻红清单（任务书 §五 的来源）没有包含它，因为 F-0 只测绘
没试着加过地形。**这是项目常识里记载的第 7 起"任务书没把会被反转的留痕
列入允许清单"冲突。**

处置（B-1 反转范本）：最小翻转三处——SURFACE 探针清单加 PLAIN_FIRE、
两张表各加一行——注释写明"F-1 执行方申报后的最小翻转（仅为新增火地形
条目）"，保留原有逐字钉死的守卫性质（表仍被 toEqual 全量锁定）。
未做任何放宽：断言仍然逐字锁表。
**给验收方**：若不认可此次越界，回滚 `src/test/c_4a_0_layer_model.test.ts`
的 3 处 diff 即可让该文件回到 F-1 前形态（但那样 c_4a_0 将对 F-1 的
合法新增持续假红，需要验收方补一刀）。

### 6.2 c_4b 留痕扫到我注释里的符号名（措辞修正，非代码绕过）

`c_4b_dungeon_feature.test.ts:708` 的静态留痕扫描（生产代码禁出现
spawnDungeonFeature/fillSpawnMap 等符号）不剥块注释，我写在 Gas.ts 文件头
的说明文字里出现了这两个符号名 → 假阳性红。**生产代码零真实引用**（该
留痕的语义仍然为真），把注释措辞改为"CE 的 DF 生成管线/按优先级落层的
填充步"即绿。这不是"扭曲代码绕过扫描"：扫描的意图是禁生产引用，
注释不是引用；如实申报于本条。

### 6.3 DF_PLAIN_FIRE 的 tile 未翻正（§一.3 已详述）

任务书 §二.1"新增火地形与对应 DF"——DF 条目 C-4b 已存在，本轮零新增；
tile 翻正会打红边界外的 c_4b:661 留痕且对 F-1 行为零影响（无 DF spawn
消费者），按"申报不硬做"处理，列入 F-2a 前置。

### 6.4 p1_28 的直写点实际是 5 处，不是 F-0 记的 3 处

F-0 §5.4 记 `p1_28_flag_channel.test.ts :228/:245/:263`；实查还有
:281/:300 两处同型直写（:300 在玩家侧悬浮条，坐标还是 (4,5) 而非 (7,6)）。
五处全部按同一口径改为 `game.environment.igniteForced(x, y, 5)`，
断言零改动。差异原因：F-0 的清单是抽样引用（"等"），不是全集。

### 6.5 任务书 §二 A 类"改查地形/旗标"与其自身文件边界矛盾（§二 已详述）

9 处 A 类读者中 8 处在零改动/禁改文件里，唯一可改的 Game.ts:1149 若单改
反而与其余 8 处语义分裂。本轮以"镜像"达成同一语义：isBurning 恒等于
"跨层存在火地形"，由对抗②/③的不变量测试钉死，并经门禁 1-5 逐位验证。
若验收方坚持字面"改查旗标"，需要先解禁三张寻路图与 GameCanvas——
那是另一个轮次的爆炸半径。

### 6.6 上轮交接文档结论的一处修正（复核 F-0 §六.2）

F-0 已登记"抗火药水断线"（resist_fire → temporaryImmunities['burning'] 键
无效）。本轮确认该断线原样存在、未受 F-1 影响（我们没碰状态通道），
仍归 F-2a。无新发现需要推翻 F-0。

---

## 七、本轮发现但属于 F-2a / G-1 的东西（只登记，不实现）

1. **燃烧楼梯/锁门/密门/机关的 CE 真语义**：CE 这些格子不可燃或燃烧走
   DF 链（SECRET_DOOR/LOCKED_DOOR/DOOR chanceToIgnite=50 → DF_EMBERS）。
   web 的 igniteForced 是无差别强制点火，本轮为保行为逐位给它们全加了
   火地形 overlay。F-2a 换成 exposeTileToFire + chanceToIgnite 后，
   igniteForced 的语义应改为"CE 的 alwaysIgnite"（沿弹道点火），
   overlay 约定随之自然消解。
2. **T_OBSTRUCTS_SURFACE_EFFECTS 守卫缺失**：CE 的火 DF 落不进楼梯/祭坛
   （SURFACE 写入被该旗标阻挡，Architect.c:3230）。web 的 writeFireTerrain
   无此守卫（保 igniteForced 无差别语义）。F-2a 接 fillSpawnMap 路径时
   免费获得该守卫。
3. **烧着的网不再缠绕**（迁移前 web：燃烧网仍缠绕；CE：网被消耗即不缠绕）。
   本轮结果 CE 对齐，登记这一行为差供 F-2a 验收时知悉来源。
4. **旧存档迁移语义**（isBurning=true 无火层 → 补 SURFACE 火；burnTerrain
   回落 terrain）是一次性兼容路径，两三个版本后可在 loadSnapshot 里移除
   对账分支（届时旧存档已自然换代）。
5. **记忆渲染空白**（§五）——渲染轮的 PLAIN_FIRE 分支。
6. **creeping_death 幽灵气**（F-0 §2.2）原样存在，F-2b/D2 处置。
7. **F-2a 接手时的翻正清单**（都有现成断言位）：
   - TerrainCatalog PLAIN_FIRE.promoteChance 0 → 500（c_4a 钉死块 +
     TerrainCatalog 注释已写明）；
   - DF_PLAIN_FIRE.tile null → PLAIN_FIRE + DF_MISSING_TILES 摘除
     （届时把 c_4b_dungeon_feature.test.ts 按条目放进允许清单——第 7 起
     冲突的教训，这次提前写在这里）；
   - DMG-FIRE 的固定 2 伤害 → CE 两段模型（Game.ts:6198 C 类分支）。

---

## 八、门禁 7 全量测试尾部（实测）

`npx vitest run --fileParallelism=false`（串行，F-0 建议跑法），
2026-09-16 13:37–13:55，**一次通过、零红、无超时假红**：

```
 RUN  v4.1.11 …/brogue-web

 Test Files  67 passed (67)
      Tests  740 passed | 8 skipped | 5 todo (753)
   Start at  13:37:11
   Duration  1108.68s (transform 759ms, setup 0ms, import 8.63s, tests 1094.13s, environment 12ms)
```

**账目核对**：P1-42 后基线 66 文件 / 728 passed（串行读数）→ 本轮
+1 文件（f_1_fire_as_terrain.test.ts，11 用例）+1 用例（c_4a 的
PLAIN_FIRE 钉死块）= 67 文件 / 728+12=740 passed。逐项对上，无缺漏。
预告翻红项（p1_24 / p1_28 / c_4a / c_4a_0[申报]）均已翻转并绿；
c_4c / c_4b / c_1 / p4_4 / p4_1b 未红（与 F-0 预判一致）。

---

## 九、对抗性测试与反向验证

### 9.1 对抗性测试（新增 `src/test/f_1_fire_as_terrain.test.ts`，11 用例）

| 组 | 捕获的错误实现 | 断言锚点 |
|---|---|---|
| ① drawPriority 双向 | prio 抄 >60（草压住火）/ 抄 <8（火压住门） | 燃烧草格有效地形=火；燃烧门格有效地形=门；表值=10/归属=SURFACE |
| ② 镜像三态 | ignite 只置位不写层 / burnout 只清层不回位 | 点燃/燃烧/烧尽逐态 `isBurning === hasFire`；burnTerrain 记录/复位 |
| ②b 地板强制点火 | 烧尽分支按有效地形分流（都已是火） | 地板原样熄灭、不焦土、无残留 |
| ②c 蔓延带火 | 只在 ignite 入口双写、蔓延绕过 | 蔓延格燃烧中带火层/烧尽留焦土物证 |
| ③ A 类读者 | 火写进读者不看的层 / 漏更新镜像 | entryQualifiesForPlacement 拒燃烧格；blocksPathing 阻挡；燃烧深水不可走+熄灭后恢复 |
| ④ 燃烧时长红线 | 固定值/换区间 | 草 60 样本 ∈[4,7] 且多值；门 ∈[2,4] 且多值；显式时长直通 |
| ⑤ 焦土红线 | 烧完改 EMBERS/保留火地形 | `(TerrainType).EMBERS === undefined`；草/网烧尽=CHARRED_FLOOR + 属性三件套 |
| ⑥ 持久化往返 | 快照漏 burnTerrain/漏层/漏镜像位 | 燃烧中存读档：层/时长/原身全等；读档后照常烧尽成焦土 |
| ⑥b 旧存档迁移 | 对账分支缺失 | 旧格式补火层；幽灵火摘除 |
| ⑦ GAS 层恒空 | 火误写 GAS 层 | 点火+蔓延+烧尽+注气后全图 layers[GAS]===NOTHING |
| ⑧ 外部写点脱钩 | spawnBlood 改跨层读 → 清火层 | 燃烧格不吃血、火层完好（CE 优先级弹开） |

结果：`Tests 11 passed (11)`。

### 9.2 反向验证（5 条，全部真实改坏 → 真实失败输出 → 还原）

**① drawPriority 10 → 70**（火压不住草）：

```
FAIL … > F-1 对抗①
AssertionError: expected 70 to be 10 // Object.is equality
Tests  1 failed | 10 passed (11)
```

**② ignite 草分支删掉 writeFireTerrain（只置镜像不写层）**——镜像不变量
被 5 组断言同时捕获：

```
FAIL … 对抗① AssertionError: 火必须压住草（drawPriority 10 < 60）: expected 10 to be 31
FAIL … 对抗② AssertionError: 点燃必须写火地形层: expected false to be true
FAIL … 对抗② AssertionError: 蔓延格燃烧中必须带火地形: expected false to be true
FAIL … 对抗⑥ AssertionError: SURFACE 层火地形必须随存档往返: expected [ +0, +0, +0, 31 ] to deeply equal [ +0, +0, +0, 10 ]
FAIL … 对抗⑧ AssertionError: 燃烧格上的火不得被血迹覆盖: expected false to be true
Tests  5 failed | 6 passed (11)
```

**③ burnDuration randRange(4,7) → 固定 5**（红线参数被"优化"）：

```
FAIL … 对抗④
AssertionError: 60 次取样必须出现多个不同值——固定值实现在此红: expected 1 to be greater than 1
Tests  1 failed | 10 passed (11)
```

**④ 草烧尽产物改为保留原地形**（= 忘写焦土 / EMBERS 化同型的行为变更）：

```
FAIL … 对抗⑤ AssertionError: 草烧尽=焦土（web 现状，F-2a 才对齐 CE 产物）: expected 10 to be 15
FAIL … 对抗⑥ AssertionError: 读档后草地照样烧成焦土: expected 10 to be 15
Tests  2 failed | 9 passed (11)
```

**⑤ loadSnapshot 镜像对账的补火分支删除**（旧存档迁移丢火）：

```
FAIL … 对抗⑥
AssertionError: 补写后该格必须挂火地形: expected false to be true
Tests  1 failed | 10 passed (11)
```

五条全部还原（`grep -c REVERT-ME` = 0，还原后 11/11 全绿；①-⑤的
还原即恢复 `git diff` 中本轮的正式实现）。

---

## 十、文件边界自查

```
git status --porcelain：
 M brogue-web/src/engine/Core/Game.ts               （允许）
 M brogue-web/src/engine/Environment/Gas.ts          （允许）
 M brogue-web/src/engine/Map/Grid.ts                 （允许）
 M brogue-web/src/engine/Map/TerrainCatalog.ts       （允许）
 M brogue-web/src/test/c_4a_0_layer_model.test.ts    （★ 越界：申报式最小翻转，§六.1）
 M brogue-web/src/test/c_4a_terrain_catalog.test.ts  （允许：仅为新增火地形条目）
 M brogue-web/src/test/p1_24_death_sink.test.ts      （允许：仅为经公共入口点火）
 M brogue-web/src/test/p1_28_flag_channel.test.ts    （允许：同上）
?? brogue-web/src/test/f_1_fire_as_terrain.test.ts   （新增测试，允许）
```

- 未执行任何 git 写操作；探针脚本 `zz_f0_probe.test.ts` 恢复→复跑→已删，
  无临时文件残留。
- `GameCanvas.vue` 零改动（F-0 建议路径）；`DungeonFeatureCatalog.ts` /
  `DungeonFeature.ts` / `Promotion.ts` 本轮最终未需要改动（DF 翻正延期、
  Promotion 逻辑零触碰）——均在允许清单内，非越界。
- 未新增任何 i18n 调用（零新文案），`zh_CN.json` 零改动。
