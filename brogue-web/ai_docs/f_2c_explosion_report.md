# F-2c 报告：爆炸 `GAS_EXPLOSION`（F/G 链收口轮）

日期：2026-09-17。
前置输入：G-2 §九（登记 5/6）、G-3 登记清单、F-2b §十.1-2（p4_4 等待翻转与两段伤害叠加口径）。
本报告与三份前置文档冲突处，以本轮实测与 CE 源码为准，并已逐条注明。

---

## 〇、结论摘要

1. **G-2 的预测成立**：迁移 `GAS_EXPLOSION` tile（Grid/TerrainCatalog）、
   给 `DF_EXPLOSION_FIRE` 填 tile、摘 `DF_MISSING_TILES` 之后，甲烷爆轰圈
   经既有 spawnMapDF→fillSpawnMap 管线**自动成形**，零额外接线（对抗⑦
   端到端实测 + g_2 对抗⑧ 翻转后断言）。
2. **爆炸瞬时伤害落地**（`Time.c:343-353` 逐条移植），三个触发点齐备：
   落格瞬间（fillSpawnMap refresh 分支的 web 等价）、每客观块
   （applyEnvironmentalEffects）、bloat 死亡 DF。免疫窗 = **生物身上的
   状态 5 回合**（CE 语义，见 §二.2 的任务书勘误）。
3. **bloat 改走 CE 原链**：`igniteForced×5` 近似退役，改铺
   `DF_BLOAT_EXPLOSION`（Globals.c:654，start 350/decr 100）+ 落格瞬时
   爆炸伤害。瞬时伤害与后续燃烧伤害是**两笔**，测试逐笔钉死。
4. p4_4 的三条断言按 F-2b 预告翻转（任务书 §二.3 提前授权）；结构性
   穷尽表 9 处翻正；全部门禁绿（§七）。
5. **对任务书的两处实质反驳**（§二）：爆炸伤害是 `max(15-20, maxHP/2)`
   ——**最大生命**的一半，不是"当前血量的 50%"；免疫窗是**按生物记账**
   （`monst->status[STATUS_EXPLOSION_IMMUNITY]`），不是"按格记账"。
   均按 §5.4 以 CE 为准处理，含对应的对抗性测试改向。

---

## 一、CE 复核要点（任务书 §八第 1 条）

### 1.1 `GAS_EXPLOSION`（`Globals.c:496`，本轮逐字段打开复核）

```c
/*GAS_EXPLOSION*/ {G_FIRE, &yellow, 0, 10, 0, 0,0,0, 10000, EXPLOSION_LIGHT,
 (T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE),
 (TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT),
 "a violent explosion", "the force of the explosion slams into you."},
```

与任务书转述一致：drawPriority 10、promoteChance 10000（100%/回合必定
晋升 = 瞬时地形）、flags `T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE`、
mechFlags 含 `TM_VANISHES_UPON_PROMOTION`。补充两项转述未提的字段：
`TM_STAND_IN_TILE | TM_VISUALLY_DISTINCT`（一并照抄）与 flavorText
（"the force of the explosion slams into you."——玩家受击文案，已接线）。
glowLight（EXPLOSION_LIGHT）web 无光照模型，登记不迁移。

### 1.2 `T_CAUSES_EXPLOSIVE_DAMAGE`（`Rogue.h:1944`）

注释原文："is an explosion; deals higher of 15-20 or 50% damage instantly,
but not again for five turns"。**结算点 `Time.c:342-396`
（`applyInstantTileEffectsToCreature` 爆炸段）**，逐条：

```c
if (cellHasTerrainFlag(..., T_CAUSES_EXPLOSIVE_DAMAGE) &&
    !monst->status[STATUS_EXPLOSION_IMMUNITY] &&
    !(monst->bookkeepingFlags & MB_SUBMERGED)) {
  damage = rand_range(15, 20);
  damage = max(damage, monst->info.maxHP / 2);      // ← 最大生命的一半
  monst->status[STATUS_EXPLOSION_IMMUNITY] = 5;      // ← 生物身上的状态
  // 玩家：flavorText + rogue.disturbed + A_DAMPENING 吸收分支(:352-359)
  //   + inflictDamage + "Killed by a violent explosion"（gameOver）
  // 怪物：睡眠惊醒(:369-371) + inflictDamage + 死亡/幸存消息
}
```

**免疫窗的递减**：玩家 `Time.c:2298-2300`（每客观块 −1）；怪物走
`updateMonsterStatus`（Monsters.c ~:2138-2142）的 **default 分支** −1。
CE 的 status 名表里该状态名字为空（`Globals.c:1811`）⇒ 不进侧栏显示。

**触发路径**（CE 三条）：① tile 落到生物脚下——`fillSpawnMap` refresh
分支 `Architect.c:3255-3260` 当场调 `applyInstantTileEffectsToCreature`
（killCreature 播死亡 DF 用 `refreshCell=true`，`Combat.c:1965-1967`；
promoteTile 也是 `refreshCell=true`，`Time.c:1268`）；② 怪物每回合行动
（`Monsters.c:3348/3701`）；③ 玩家客观块（`Time.c:2671`）。

### 1.3 DF 目录条目（位置表，枚举序号经锚点验证）

| DF | 枚举值（Rogue.h） | 表行（Globals.c） | 内容 |
|---|---|---|---|
| `DF_EXPLOSION_FIRE` | 102（:1594，G-2 已对） | :742 | `{GAS_EXPLOSION, SURFACE, 60, 17, 0}` |
| `DF_BLOAT_EXPLOSION` | **35**（:1508，本轮新对） | **:654** | `{GAS_EXPLOSION, SURFACE, 350, 100, 0, "", EXPLOSION_FLARE_LIGHT}` |

序号 35 的验证：枚举从 `DF_GRANITE_COLUMN = 1` 起顺序编号，三个既有
锚点（DF_SHOW_DOOR=13、DF_REPEL_CREATURES=40、DF_METHANE_GAS_PUFF=44，
与 web 既有目录逐一对上）反推 DF_BLOAT_EXPLOSION=35，与表行 :654
（"// monster effects" 段第 4 条）交叉一致。:654 的 `""` 说明 CE 的
bloat 自爆**没有 DF 消息**（玩家看到的消息全部来自爆炸伤害结算段）。
:659 同 tile 的 `{…350, 100, "The corpse detonates…"}` 是
`DF_MUTATION_EXPLOSION`（=38，explosive 突变用，Globals.c:1398）——
与 bloat 无关，不要混淆。

### 1.4 甲烷爆轰分支（激活轮逐字重核，任务书 §五声明）

本轮该分支首次真实可达，已逐字符对照 CE 重核：

- `ALL_DIRS8`（Promotion.ts）≡ `nbDirs`（`GlobalsBase.c:38`）：
  `{0,-1},{0,1},{-1,0},{1,0},{-1,-1},{-1,1},{1,-1},{1,1}`——八向各异、
  序同。G-2 修复后的形态无再错抄（F-2a 的 `{1,-1}`×2/`{1,1}`×0 已不复存在）。
- 分支本体（`Time.c:1347-1360`）：`cellHasTMFlag(TM_EXPLOSIVE_PROMOTE)`
  守卫 ✓；计数条件 `T_IS_FIRE | T_OBSTRUCTS_GAS`（flags）**或**
  `TM_EXPLOSIVE_PROMOTE`（mechFlags）✓；阈值 `>= 8` ✓；GAS 层
  `volume = 0` 怪癖 ✓；`promoteTile(x, y, layer, !explosivePromotion)`
  选路 ✓（爆轰走 promoteType、普通点燃走 fireType）。
- `DF_EXPLOSION_FIRE` 目录条目（G-2 留形）：web 条目 start 60/decr 17/
  layer SURFACE ≡ CE :742，本轮只填 tile。

---

## 二、与任务书不符之处 / 对任务书的反驳（只列事实）

1. **"15-20 与当前血量 50% 取较大者"——转述错误，以 CE 为准**：
   `Time.c:346` 是 `max(damage, monst->info.maxHP / 2)`，**maxHP 是最大
   生命**。Rogue.h:1944 注释的 "50% damage" 指 maxHP 的 50%。已按 CE
   实现为 `Math.max(damage, Math.floor(entity.maxHp / 2))`，对抗①
   （maxHp=200 已损至 60 的怪必须当场死亡）把"当前血量 50%"的误读钉死。
2. **"五回合免疫窗需要按格记账"——转述错误，以 CE 为准**：CE 的免疫
   是 `monst->status[STATUS_EXPLOSION_IMMUNITY] = 5`，**生物身上的状态**
   （Time.c:347），不是任何按格的簿记。后果有二：
   - 实现走 F-2b 'burning' 同款 statusDurations 逃生舱键（'explosion_
     immunity'，src/entities 禁改不能扩 StatusId 联合），tickStatuses
     全键递减恰好复刻 CE 玩家/怪物两条递减轨；
   - 任务书 §七.2 点名的对抗性测试"免疫窗按生物而非按格记账"的前提
     不成立，**反转为**："免疫跟着生物走——挨炸后移动到另一格爆炸地形
     仍免疫；按格记账（Set<格>）的实现翻红"（对抗③a）。它对按格错误
     实现的杀伤力等价于原要求，只是方向相反。
3. **任务书 §二.1 说 "T_CAUSES_EXPLOSIVE_DAMAGE 的注释写明语义…
   结算点在 Time.c:343-353 附近"**——行号正确；补充：该段实际延伸到
   :396（玩家/怪物分支的文案与击杀结算），本轮一并移植。
4. **任务书 §二.2 说 bloat "现在 igniteForced ×5（F-2b §十.2 登记）"**
   ——正确；F-2b §十.2 的"两笔伤害叠加口径"提醒已落实（对抗⑤ +
   p4_4 翻转测试）。
5. **p1_24_death_sink 在授权清单里但零改动**：清单按"两段 grep"法生成
   是防御性的；实测该文件的断言不因本轮行为变化而到期，未动。

### 已申报的退化/登记项（不实现，边界或载体不允许）

- `MB_SUBMERGED`（潜水）守卫：web 无潜水簿记，F-2b 同款登记退化。
- `rogue.disturbed`（爆炸打断自动探索）：web 无该系统，登记。
- `EXPLOSION_LIGHT`/`EXPLOSION_FLARE_LIGHT`：web 无光照模型，登记。
- fillSpawnMap refresh 分支的其余副作用（玩家脚下 flavorMessage、
  `KNOWN_TO_BE_TRAP_FREE`、火地形点燃物品 `burnItem`）：只移植了
  爆炸结算与 CAUGHT_FIRE 登记；其余属 C-4b 差异表既有登记，不扩。
- 怪物爆炸消息的视野门控：CE 无可见性门控（直发 message），web 沿
  F-2b 既有口径按 `cell.isVisible` 门控（防不可见爆炸刷屏），差异登记。
- **Sidebar 兜底显示**：'explosion_immunity' 无 STATUS_CONFIG 条目，
  玩家挨炸后 ≤5 回合侧栏会以裸键名显示（Sidebar.vue:55 的 fallback）。
  statusConfig.ts / components 在本轮禁改清单——只列不修，归 UI 轮
  （CE 该状态名为空本就不显示，理想处置是加空显示条目或过滤）。
- **RNG 流登记**（约定 §四）：bloat 死亡（spawnMapDF 掷骰 + 伤害掷骰）、
  甲烷爆轰（60/17 波前掷骰）、爆炸伤害 rand_range(15,20)、爆炸格存活期
  的晋升掷骰，都是本轮新增/改形的随机消耗——发生场景仅限爆炸事件，
  无爆炸的既有曲线（火侧/气体侧/生成基线）不受影响，实测见 §六。

---

## 三、生产改动清单（按文件）

| 文件 | 改动 |
|---|---|
| `Map/Grid.ts` | +`TerrainType.GAS_EXPLOSION`（尾部追加，既有枚举值不变）；DRAW_PRIORITY **10**（:496 第 4 列）；TERRAIN_HOME_LAYER **SURFACE**（:742/:654 DF layer 列同证）；`FIRE_TERRAIN_TYPES` +GAS_EXPLOSION（T_IS_FIRE 载体，注释同步） |
| `Map/TerrainCatalog.ts` | +GAS_EXPLOSION 条目：`T_IS_FIRE|T_CAUSES_EXPLOSIVE_DAMAGE`、`STAND_IN_TILE|VANISHES_UPON_PROMOTION|VISUALLY_DISTINCT`、ign 0、promoteType ''、promoteChance **10000**——全字段照抄 :496 |
| `Map/DungeonFeatureCatalog.ts` | `DF_EXPLOSION_FIRE` 填 tile=GAS_EXPLOSION（:742）；**新增** `DF.DF_BLOAT_EXPLOSION = 35` 与目录条目（:654，350/100，EXPLOSION_FLARE_LIGHT）；`DF_MISSING_TILES` 摘除 DF_EXPLOSION_FIRE（7 → 6） |
| `Map/Promotion.ts` | `ExposeTileResult`/`FireUpdateResult` 加 `explosiveSpawnCells`（加性字段，零行为变化）：exposeTileToFire 在 promoteTile 的 spawn 落格后按 `T_CAUSES_EXPLOSIVE_DAMAGE` 旗标登记 builtCells；runFireUpdate 透传。爆轰分支两处注释从"缓办登记 F-2c"翻正为"已落地" |
| `Environment/Gas.ts` | `explosiveSpawnQueue`（加性）：updateFires 收集火段的爆炸落格；`Gas.ignite`（直燃路径）同步入队；`takeExplosiveSpawnCells()` 供 Game 排干（复刻 CE fillSpawnMap refresh 分支的落格瞬时结算数据源） |
| `Core/Game.ts` | ① F-2c 块：`explosionImmunityDuration`/`setExplosionImmunityDuration`（statusDurations 逃生舱键 'explosion_immunity'，时长 5）；`resolveExplosionDamage`（Time.c:343-396 逐条：守卫/伤害/免疫/玩家 flavor+dampening 吸收+铭牌/怪物惊醒+文案）；`applyInstantExplosionAt`（fillSpawnMap refresh 分支的 web 等价）。② checkEntity 火段与气段之间插入爆炸结算（CE 同函数内爆炸段先于毒气段的次序）。③ triggerDeathFeatures 的 explosive_bloat 分支改走 `catalogFeature(DF_BLOAT_EXPLOSION)` + `spawnDungeonFeature` + 落格瞬时结算 + caughtFire 并入 pendingCaughtFireCells。④ objectiveTimeBlock 火段后排干爆炸落格（晋升趟 spawn 防御性同覆盖——CE promoteTile 亦 refreshCell=true） |
| `locales/zh_CN.json` | 仅增 4 键：`env.player_explosion_hit` / `env.monster_dies_in_explosion` / `env.monster_engulfed_explosion` / `runic.armor.dampening_explosion`（p1_30 门禁静态扫描通过，无死键无缺键） |

---

## 四、G-2 预测的验收结论（门禁 §六.2）

**预测原文**（G-2 §九.5）："迁移 GAS_EXPLOSION tile、填 tile、摘
DF_MISSING_TILES 后爆炸圈自动成形"。

**结论：成立，逐字兑现。**爆轰判定与选路（TM_EXPLOSIVE_PROMOTE 计数
≥8 → promoteTile 走 promoteType）G-2 时已实测可达，唯一堵点是
DF_EXPLOSION_FIRE 的 tile=null（promoteTile 整链预检缓办）。本轮填
tile 后：缓办路径自然退役，spawnMapDF 以 60/17 波前扩散、fillSpawnMap
按 drawPriority 落 SURFACE、caughtFireCells 照常登记、VANISHES +
promoteChance 10000 使爆炸格在下一个晋升趟消失——全程零额外代码。
实测锚点：g_2 对抗⑧ 翻转测试（8 邻全火 → 原点格 SURFACE 变
GAS_EXPLOSION、体积清零怪癖保持、explosiveSpawnCells 非空）+ f_2c
对抗⑦（花岗岩口袋端到端：直燃甲烷 → 客观块内受害者上免疫、掉血）。

---

## 五、爆炸实测（门禁 §六.3）

### 5.1 伤害值分布：哪个分支生效

伤害 = `max(rand_range(15, 20), ⌊maxHP/2⌋)`：

| maxHP | ⌊maxHP/2⌋ | 实际伤害 | 生效分支 |
|---|---|---|---|
| ≤ 42 | ≤ 21 | 恒 15-20 | 掷骰分支（小怪） |
| 100 | 50 | 恒 50 | maxHP 分支（测试主锚点） |
| 200 | 100 | 恒 100 | maxHP 分支 |

对抗①实测：maxHp=200、hp=60 的怪站爆炸格 → 当场死亡（若按"当前血量
50%"或按 15-20，它都活）——maxHP 分支压倒掷骰分支的实锚。p4_4 翻转
测试与对抗⑤实测：maxHp=100 的受害者 hp 恰好 100→50，**逐位等于
⌊maxHP/2⌋**，与 seed 无关（max 分支吞掉掷骰）。

### 5.2 五回合免疫窗的实际行为

对抗③b（env+tick 逐块推进，maxHp=200）：

| 块 | 免疫值（结算时） | 结果 |
|---|---|---|
| 1 | 0 → 上免疫 5 | 掉 100（hp 200→100） |
| 2 | 4 | 不掉 |
| 3 | 3 | 不掉 |
| 4 | 2 | 不掉 |
| 5 | 1 | 不掉 |
| 6 | 0 | 掉 100（hp 100→0，死亡） |

即 **5 个块的免疫窗**（受击块 + 3 个完整块 + 第 5 块受击后重新上窗）。
对抗③a 实测：挨炸后把怪移动到**另一格**爆炸地形上，免疫照常生效——
按格记账的实现（错误方向）在此翻红。

### 5.3 爆炸圈半径（探针实测：开阔石板房、原点 (15,10)、40 seed）

| DF | 波前参数 | 单次格数 | 最大 BFS 距离 |
|---|---|---|---|
| `DF_BLOAT_EXPLOSION`（bloat 自爆） | 350/100 | 31-40 格（均值 ≈36） | **4**（40/40 seed 达到；距离 ≤3 必达——波 1/2/3 概率 350/250/150 ≥ 100 恒真，波 4 概率 50%） |
| `DF_EXPLOSION_FIRE`（甲烷爆轰） | 60/17 | 1-14 格（均值 ≈8） | 0-4（均值 ≈2.9；仅原点必达，60% 波全空时只剩原点——40 seed 中 2 例） |

（探针为一次性调试件，跑完即删；数据在此存档。）

### 5.4 两笔伤害的分离

对抗⑤实测（bloat 在 (7,6) 死亡、maxHp=100 受害者在 (8,6)）：

1. **第 1 笔（瞬时）**：`triggerDeathFeatures` 内 deathDF 落格 → 受害者
   hp 恰 50（max(15-20, 50)），此刻 `burningDuration == 0`——**不经
   燃烧状态、不等客观块**；
2. **环境段**：爆炸铺的火（GAS_EXPLOSION 带 T_IS_FIRE）点燃幸存者
   （burning 7），爆炸本身被免疫窗挡住、不再扣——hp 仍 50；
3. **第 2 笔（燃烧）**：状态段结算 rand_range(1,3)——hp 落到 [47,49]。

两笔分离的对抗覆盖：只点燃烧不瞬伤（合并形态 A）在第 1 笔断言翻红
（hp 会是 100）；燃烧段再爆一次 50（合并形态 B）在第 2 笔断言翻红
（hp 会 ≤0 而非 [47,49]）。

---

## 六、门禁（任务书 §六逐条）

### 1. 三组反向哨兵逐位不变：PASS

哨兵即既有测试的硬编码基线断言（运行 = 逐位比对）。干净全量门禁中：

```
[FIRE-NAT]  g_1_gas_volumetric 对抗⑧（seed42，F-2a §一 基线 40 点）   ✓ 绿
[FIRE-NAT]  g_2_gas_df_wiring 对抗⑤（seed2026 / seed777 逐位）        ✓ 绿
[FIRE-NAT]  g_3_gas_effects   对抗⑨（seed2026 / seed777 逐位）        ✓ 绿
[DMG-FIRE]  f_2a 对抗⑪ / f_2b 对抗⑦（气体四型 14 回合全格基线，两份等价实现）✓ 绿
[气体曲线]  g_1（消散档位/破缺哨兵/镜像同步）+ g_2 对抗⑥（守恒）+ g_3 对抗   ✓ 绿
```

另：f_2c_explosion.test.ts 内置两条独立复刻哨兵（对抗⑩ FIRE-NAT
seed42 全量 40 点、对抗⑪ 气体紧凑签名 5 块——2026-09-17 实跑存档
`center=[11,5,3,2,1]`、`total=[98,86,89,99,102]`），与既有哨兵互为冗余。

### 2. G-2 预测验收：成立（§四）

### 3. 爆炸实测：见 §五（伤害分布 / 免疫窗 / 半径 / 两笔分离）

### 4. 决定性复验；generation_baseline 仍绿；坏层闸门 0：PASS

- `generation_baseline`（4 seed × D1-D26 指纹/怪物/物种/物品数）✓ 绿——
  本轮不动生成链、不动 RNG 消耗次序的非爆炸路径；
- `p1_33` 端到端 15 seed × D1-D26 零不可达 ✓ 绿（`toEqual([])` 通过）。

### 5. `npm run build` 绿；`npm test` 全绿：PASS

`npm run build`（vue-tsc -b && vite build）尾部：

```
dist/assets/WebGLRenderer-lCSs4dTn.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-D2_c9fzi.js               795.45 kB │ gzip: 242.09 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to chunk...
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 1.45s
```

（chunk 体积警告为既有状态，非本轮引入。）

`npm test`（`npx vitest run --fileParallelism=false` 串行全量）尾部：

```
 Test Files  74 passed (74)
      Tests  848 passed | 8 skipped | 5 todo (861)
 Start at  03:42:59
 Duration  1037.26s (transform 622ms, setup 0ms, import 8.42s, tests 1022.96s, environment 12ms)
```

> 说明：本轮共跑两次全量。第一次 1 失败
> `armor_model_effect.test.ts`（180s 超时）——该测试是 5 档 × 20 seed ×
> 400 回合的重型配对对照，失败发生时后台另有探针/复跑任务并发抢占 CPU
> （该次 tests 总耗时 2452s vs 首次 1010s）；单独复跑 92s 通过。判定为
> 负载 flake 而非回归：首轮全量（同一生产代码）该文件即绿，且爆炸代码
> 路径在该测试场景中不触发。第二次全量（无并发）如上，全绿。
> 时序披露：第二次全量运行期间对 Promotion.ts 做过一次**纯缩进**修正
> （两行空白，语义零差异），修正后重建 + 受影响四文件（f_2c/p4_4/g_2/
> c_4c）复跑 72/72 绿——esbuild/vitest 按文件加载时点取内容，空白变更
> 不构成行为差异，如实记录。

---

## 七、既有测试改动逐条清单（授权清单内；守卫性质未放宽）

### p4_4_split_kamikaze.test.ts（任务书 §二.3 预告授权；3 条）

| 测试 | 到期原因 | 翻转方式与守卫论证 |
|---|---|---|
| "explosive bloat 死亡在原地及四方向邻格点燃火焰（GRASS…）" | igniteForced×5 形态退役：落的是 GAS_EXPLOSION 而非 PLAIN_FIRE | 五格（死亡格+四邻）必中守卫**原样保留**（波 1 350%≥100 恒真），判据换 GAS_EXPLOSION 落格 + isBurning；穷尽性未放宽（命中的格集合断言数量不变） |
| "验收打回修正：…石地板上也必须点燃死亡格与四方向邻格"（对抗⑥） | 同上 | 守卫意图（石头地上也要炸）原样保留，判据换 GAS_EXPLOSION。**原"对角格不应被点燃"断言删除**——那是 igniteForced×5 形态自带的形状，CE 爆炸圈是概率 BFS（(8,5) 的 BFS 距离为 2，波 2 250%≥100 必中）：该断言对 CE 本就是错的，属"断言与 CE 冲突以 CE 为准"（约定 §5.4），非放宽 |
| "F-2b 翻正：环境段挂燃烧状态、状态段真的掉血" | F-2b 注释预告的本轮任务：真爆炸落地后伤害结构变为两笔 | 翻成"第 1 笔瞬时 50 不经燃烧 → 环境段挂燃烧且免疫窗内不重复扣 → 状态段燃烧掉 1-3"，三段各自断言、漏一段即红；受害者改 maxHp=100 使伤害确定性化。守卫强度：原两断言（挂状态、掉血）全部保留且加密（精确数值） |

### c_4a_0_layer_model.test.ts（结构性穷尽表；2 处）

- SURFACE 归属组扩 1 行（GAS_EXPLOSION）；两张 `toEqual` 全量表各扩 1 行
  （HOME_LAYER=SURFACE / DRAW_PRIORITY=10，CE 行号在注释）。**穷尽性质
  不变**：`toEqual` 仍须全键命中，新增枚举不登记即红——这正是本轮它
  翻红的原因，翻正只是把新事实写进表。

### c_4a_terrain_catalog.test.ts（结构性穷尽表；1 处）

- 全键覆盖计数 40 → 41（GAS_EXPLOSION 入列）。字段结构逐项检查不变。
  （FIRE_TERRAIN_TYPES 恒等断言未改且自动保持双向锁定——两侧同加。）

### c_4b_dungeon_feature.test.ts（结构性穷尽表；5 条）

- **E1**：目录条数 22 → 23；增 `DF_BLOAT_EXPLOSION = 35` 对位断言
  （Rogue.h:1508）。
- **E2**：闭包自洽——DF_BLOAT_EXPLOSION 不经 TerrainCatalog 字符串
  （tile 条目三链字段全空），按**第二起点**登记（怪物侧 monsterCatalog
  的 DFType 列，Globals.c:1084，web 消费点 Game.triggerDeathFeatures）；
  目录键集仍须与闭包恰好相等，多抄/漏抄照旧翻红。
- **E3**：DF_EXPLOSION_FIRE 抽查 tile 从 null 翻正为 GAS_EXPLOSION；
  新增 DF_BLOAT_EXPLOSION 抽查（:654，350/100，SURFACE，description 空、
  flare 名）。
- **E4**：缺 tile 名单 7 → 6；翻正位补两条 catalogFeature 正常转换断言
  （放回 missing 即红）。
- **F1 留痕**：白名单扩 `engine/Core/Game.ts`（本轮给它接上第一个
  DF 生产消费者：bloat 死亡 DF 的 catalogFeature+spawnDungeonFeature）。
  留痕机制按设计工作：断言标题自写扩清单条件，白名单外的引用仍全红。

### g_2_gas_df_wiring.test.ts（本轮主题；2 条）

- **对抗⑦ 留痕翻转**："DF_EXPLOSION_FIRE 登记为缺 tile（爆炸归 F-2c）"
  的前提（tile=null）失效 → 翻成"已接线：不在名单 + catalogFeature 正常
  转换且 tile/start/decr 正确"。名单长度守卫保留（恰 6 条），防"接线
  顺手删登记"。
- **对抗⑧ 翻转**："8 邻全火 → 爆轰路 → 因缺 tile 缓办" → 翻成"爆炸圈
  真实落地"：原点 SURFACE = GAS_EXPLOSION（选路守卫加强：不走 fireType
  的 GAS_FIRE）、体积清零怪癖断言原样保留、explosiveSpawnCells 非空
  （落格瞬时结算的数据源）。

### 未动的授权文件

f_1_fire_as_terrain / f_2a_fire_mechanics / p1_24_death_sink /
g_1_gas_volumetric / g_3_gas_effects：零改动零到期（结构性穷尽断言对
新枚举的覆盖由 c_4a 两张全量表 + c_4b 目录闸门承担；火侧/气体侧行为
断言全部原样绿）。

---

## 八、对抗性测试与反向验证（新增 `f_2c_explosion.test.ts`，14 条全绿）

### 对抗清单（每条指名它杀死的错误实现）

| # | 断言 | 杀死的错误实现 |
|---|---|---|
| ① | maxHp=200 已损至 hp=60 的怪站爆炸格必须**当场死亡**（伤害=max(15-20,100)=100） | 取 15-20；取 min；按"当前血量 50%"折算（三者的受害者都活） |
| ② | 同格连续两个客观块不重复扣血 | 免疫窗缺失 |
| ③a | 挨炸后**换一格**爆炸地形仍免疫 | 按格记账（任务书原要求方向的反转，CE 依据见 §二.2） |
| ③b | 免疫窗逐块推进：第 2~5 块被挡、第 6 块恢复受击 | 时长记 3（第 5 块就掉血）；记 10/无限（第 6 块不掉血） |
| ④ | GAS_EXPLOSION 在一个晋升趟内清层消失（promotions 恰 1、vanished、df=null） | promoteChance 记 0；漏抄 VANISHES |
| ④b | 落地块被 CAUGHT_FIRE_THIS_TURN 豁免（跳过）、下一趟消失 | 漏豁免（爆炸圈闪现一帧） |
| ⑤ | 两笔分离：瞬时 50（burning==0）→ 环境段挂燃烧且免疫不重复扣 → 状态段燃烧 1-3 | 只点燃烧不瞬伤；燃烧段再爆 50 |
| ⑥ | 石地板上死亡格必为 GAS_EXPLOSION，BFS 距离 2/3 的格必中（含对角 (8,5)、距离 3 的 (10,6)） | 退回 igniteForced×5（PLAIN_FIRE、距离 1）；参数错记 60/17（距离 2 仅 43%、距离 3 仅 26%） |
| ⑦ | 花岗岩口袋甲烷直燃 → 真实 objectiveTimeBlock 内爆轰落地 + 受害者上免疫掉血 | 走 fireType（GAS_FIRE）选路；无瞬时结算 |
| ⑧ | **悬浮**生物照吃爆炸伤害 | 误抄熔岩/深水的悬浮豁免（CE 爆炸段无此守卫） |
| ⑨a | 玩家受击掉 max(15-20, maxHP/2) 且 lastDamageSource='violent explosion' | 玩家分支漏铭牌链 |
| ⑨b | dampening 符文完全吸收 + 自动鉴定（Time.c:352-359） | 漏 dampening 分支（照扣血） |
| ⑩ | FIRE-NAT seed42 火侧曲线逐位（哨兵） | 本轮意外改动火侧/RNG 流 |
| ⑪ | POISON 紧凑签名逐位（哨兵） | 本轮意外改动气体侧/客观块次序 |

### 反向验证（真实改坏 → 真实失败输出 → 还原；4 条，REVERT-ME 已清零）

**反向①：`Math.max` → `Math.min`（取小者）。**
8 条对抗翻红，典型输出：

```
AssertionError: max(rand_range(15,20), maxHP/2)=100 ≥ hp=60：应当场死亡。
存活说明实现取了 15-20、或按当前血量折算（两者都是错误实现）:
expected 44 to be less than or equal to 0
AssertionError: 第一块：max(15-20, 100) = 100: expected 183 to be 100
```

**反向②：注释掉 `setExplosionImmunityDuration(...)`（免疫不上）。**
5 条翻红：

```
AssertionError: 免疫窗内第二块不得重复扣血: expected +0 to be 100
AssertionError: 免疫是生物状态：换格不得重置/失效（按格记账的实现在此翻红）: expected +0 to be 100
AssertionError: 第 2 块仍在免疫窗内（时长记短了的实现在此翻红）: expected +0 to be 100
AssertionError: 免疫窗内不得重复扣爆炸伤害: expected +0 to be 50
AssertionError: 受害者吃过爆炸伤害（上了免疫）——没有瞬时结算的实现翻红: expected false to be true
```

**反向③：TerrainCatalog 的 promoteChance `10000 → 0`（爆炸地形不消失）。**
恰 2 条翻红：

```
AssertionError: 10000 = 100%/回合：本趟必晋升: expected +0 to be 1
AssertionError: 下一趟（登记已被记账趟清掉）：必晋升消失: expected +0 to be 1
```

**反向④：explosive_bloat 分支整体退回 `igniteForced×5`（旧形态回归）。**
跨两文件 5 条翻红：

```
AssertionError: 第 1 笔瞬时爆炸伤害恰 50（不瞬伤的合并实现在此翻红）: expected 100 to be 50
AssertionError: 死亡格（种子格无条件）: expected false to be true
AssertionError: 爆炸瞬时伤害 = max(15-20, maxHP/2) = 50——不瞬伤的实现在此翻红: expected 100 to be 50
```

每条反向验证后均还原并复跑至绿（最后两文件 34/34 通过）；
`grep -rn REVERT-ME src` = 0。

---

## 九、F/G 链收口总结

**F-0 → F-1 → F-2a → F-2b → G-1 → G-2 → G-3 → F-2c 全部落地。**
火侧（地形/寿命/燃烧状态机）、气体侧（体积模型/DF 接线/效果与生物侧）、
爆炸（GAS 层气体点燃 → SURFACE 层火地形 → 瞬时伤害）三块互锁闭环。

### 仍欠的登记项（各归其轮）

| 登记项 | 出处 | 归属轮 |
|---|---|---|
| 四种无载体气体（ROT/STENCH/DARKNESS/HEALING）的 tile 迁移与效果 | G-3 §三载体盘点表 | 怪物侧 DF 发射机制轮（含 monsters.json 数据轮）；黑暗云还需光照模型轮 |
| 毒气陷阱调用点统一改走 DF 管线（消息双播） | G-2 §九.3 / G-3 | 调用方接线轮 |
| 甲烷 puff"快速隐身"的视觉提示 | G-2 §九.7 | 渲染轮 |
| 藻湖（DEEP_WATER_ALGAE_*）promoteChance 500/300 藻华轮替 | G-2 §九.8 | 生成侧/数据侧轮 |
| MONST_FIERY 出生自燃（Monsters.c:3912）+ resolveBurningDamage 的 FIERY 不递减 | F-2b §十.5 | Monster.ts 旗标派生放行轮 |
| `burning` / `explosion_immunity` 升格正式 StatusId（联合扩键 + STATUS_CONFIG 收窄 + 逃生舱键退役） | F-2b §十.6 + 本轮申报 | entities 放行轮 |
| **Sidebar 对 explosion_immunity 的显示**（裸键名兜底 ≤5 回合；CE 该状态名为空不显示） | 本轮申报 | UI 轮（statusConfig.ts / Sidebar.vue 在本轮禁改清单） |
| 药水时长同族漂移（levitate 30/100、speed 30/25、invisibility 30/75） | F-2b §十.7 | 物品表轮 |
| 燃烧状态与 EMBERS/ASH/PLAIN_FIRE 的渲染缺口 | F-2a §十.9 / F-2b §十.8 | 渲染轮 |
| DART_EXPLOSION（燃烧镖，Globals.c:497）与 ITEM_FIRE/CREATURE_FIRE/BRIMSTONE_FIRE/FLAMEDANCER_FIRE 等其余火地形 | F-2c 新登记 | 物品/战斗/生成侧各轮（web 无燃烧镖与燃烧物品载体） |
| 深水冲走携带物并随机移位（Time.c:556-590） | applyEnvironmentalEffects 注释 | 独立环境轮 |
| 掷出药水碎裂路径（thrown potion） | G-3 登记 | 物品投掷轮 |

### 本轮给后人的两条新锚

- 爆炸地形的"瞬时"语义 = promoteChance 10000 + VANISHES + promoteType 0
  的组合，实测寿命 = 落地块 + 1（对抗④b 的 CAUGHT_FIRE 豁免时序）；
  未来任何"想让爆炸圈多留几回合"的改动都在动 CE 行为，先看 :496。
- 免疫窗的记账主体是**生物**不是格；换实现时对抗③a/③b 是守门断言，
  别只看"不重复扣血"。

---

## 十、文件边界自查

```
git status --porcelain（终态；探针 zz_f2c_probe.test.ts 已删）：
 M brogue-web/src/engine/Core/Game.ts
 M brogue-web/src/engine/Environment/Gas.ts
 M brogue-web/src/engine/Map/DungeonFeatureCatalog.ts
 M brogue-web/src/engine/Map/Grid.ts
 M brogue-web/src/engine/Map/Promotion.ts
 M brogue-web/src/engine/Map/TerrainCatalog.ts
 M brogue-web/src/locales/zh_CN.json          （仅增 4 键）
 M brogue-web/src/test/c_4a_0_layer_model.test.ts
 M brogue-web/src/test/c_4a_terrain_catalog.test.ts
 M brogue-web/src/test/c_4b_dungeon_feature.test.ts
 M brogue-web/src/test/g_2_gas_df_wiring.test.ts
 M brogue-web/src/test/p4_4_split_kamikaze.test.ts
?? brogue-web/src/test/f_2c_explosion.test.ts   （新增）
?? brogue-web/ai_docs/f_2c_explosion_report.md  （本报告）
```

- 生产改动全部在允许清单（TerrainCatalog / DungeonFeatureCatalog /
  DungeonFeature / Grid / Promotion / Gas / Game / zh_CN.json 仅增键）。
- 既有测试改动 5 个文件，全部在授权清单内；f_1/f_2a/p1_24/g_1/g_3
  授权而未动（无到期断言）。
- 禁改文件零 diff：BrogueCE-master/、src/engine/Map/ 其余文件、
  Generator/、entities/、components/、src/data/*.json、Random.ts、
  vite.config.ts、test/fixtures/*、test/harness.ts、其余既有测试。
- 调试探针（zz_f2c_probe.test.ts）已删除；`grep -rn REVERT-ME src` = 0；
  未执行任何 git 写操作（status/diff/log 只读）。

---

## 附记

干净门禁复跑（第二次全量，无并发负载）真实输出已在 §六.5 粘贴；
本次运行前另有一次全量（与探针/其它任务并发）除一个负载超时外全绿，
两次的失败差异均已逐条核因并记录在 §六.5 说明块内。
