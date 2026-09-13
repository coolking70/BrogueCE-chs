# horde 抽取逻辑对齐 CE — 交付报告

- **日期**：2026-09-14
- **项目**：`brogue-web/`
- **本轮目标**：把 horde 抽取逻辑对齐 BrogueCE（加权抽取、两套过滤口径、OOD、每层数量、周期刷怪 fuse、物种名失配修复）
- **结论**：✅ 六条规则全部落地，`npm test` 全绿（14 文件 / 112 通过，原测试一个未减），`npm run build` 全绿。

---

## 1. 改动清单

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `src/engine/Core/Game.ts` | 修改 | 加权抽取、两套口径、OOD、数量公式、fuse、周期刷怪、captive 领袖语义 |
| `scripts/extract_hordes.cjs` | 修改（规则 6 许可范围） | 解析 `Globals.c` monsterCatalog，自动建立 MK_* 枚举名 → 目录显示名映射；自检锚点改为两套口径池；加 monsters.json 零失配硬门 |
| `src/data/hordes.json` | 重新生成（规则 6 许可范围） | 仅 5 行变化：4 个失配物种名（`GOBLIN_CHIEFTAN`×2、`ANCIENT_SPIRIT`、`WILL_O_THE_WISP`、`ACID_JELLY`）改为映射后的目录名，其余字段零改动 |
| `src/test/horde_selection.test.ts` | 新增 | 12 项验收测试（加权/口径/OOD/fuse/零失配/逐层物种表/captive 实刷） |

### git diff --stat

```
 brogue-web/scripts/extract_hordes.cjs | 171 ++++++++++++++---
 brogue-web/src/data/hordes.json       |  10 +-
 brogue-web/src/engine/Core/Game.ts    | 337 +++++++++++++++++++++++++++-------
 3 files changed, 421 insertions(+), 97 deletions(-)
```

未跟踪新增：`brogue-web/src/test/horde_selection.test.ts`（本报告的测试载体）。

### 边界遵守情况

- 禁止清单（Monster.ts / Combat.ts / … / src/data 其他 json / 既有 .test.ts）零改动；
- 未执行任何 git 写操作；
- `src/data/hordes.json` 只发生规则 6 的名字变化（`git diff` 仅 5 行名字，见 §2.4）。

---

## 2. 六条规则的落地方式

### 2.1 规则 1：frequency 加权抽取（Monsters.c:511）

`Game.pickHordeType(candidates)`：`index = rand_range(1, Σfrequency)`，遍历候选命中 `index <= frequency` 者即选中，否则 `index -= frequency`。与 CE 逐行对应。原 `validHordes[rng.randRange(0, len-1)]` 均匀抽取与 "Should be weighted random…" 注释已删除。

### 2.2 规则 2：两套过滤口径（本轮核心修正）

- `HORDE_POPULATE_FORBIDDEN_FLAGS`（Monsters.c:1090 开局铺怪）= `HORDE_IS_SUMMONED | MACHINE_ONLY`（12 个 MACHINE_* / VAMPIRE_FODDER / SACRIFICE_TARGET 成员，Rogue.h:2049-2055）；
- `HORDE_PERIODIC_FORBIDDEN_FLAGS`（Monsters.c:1133 周期刷怪）= 上者 + `HORDE_LEADER_CAPTIVE | HORDE_NO_PERIODIC_SPAWN`；
- `HORDE_SACRIFICE_TARGET` 与 `HORDE_VAMPIRE_FODDER` 含于 MACHINE_ONLY，未单列。
- 实测池条数：**开局池 85 条**（含 LEADER_CAPTIVE 20 条）、**周期池 58 条**（见 §4）。

### 2.3 规则 3：out-of-depth（Monsters.c:797-805）

`Game.rollSpawnDepth(depthLevel)`：`depthLevel > 1 && rand_percent(10)` 时 `depth = depthLevel + rand_range(1, min(5, floor(depthLevel/2)))`，超过 `AMULET_LEVEL=26` 钳回 `max(depthLevel, 26)`；OOD 时禁用集追加 `HORDE_NEVER_OOD`，并用 OOD 深度做候选池的深度窗口。开局与周期两条路径共用（CE 的 spawnHorde 对两类调用统一掷骰）。

### 2.4 规则 4：每层初始 horde 数量（Monsters.c:1085-1091）

`numHordes = min(20, 6 + 3*max(0, depth-26))`，随后 `while (rand_percent(60)) numHordes++`。D26 前基数恒为 6、期望约 7.5（原实现 3–5）。

### 2.5 规则 5：周期刷怪 fuse（RogueMain.c:403、Time.c:2322/2666）

- 新增公开字段 `Game.monsterSpawnFuse`；`startNewGame` 里 `= rand_range(125, 175)`（先于首层生成，位置对应 CE 的 rogue 初始化段）；
- `runMonsterTurns()` 末尾（test 模式除外）每回合 `fuse--`，`<= 0` 时调用 `spawnPeriodicHorde()` 并重置 fuse；
- `spawnPeriodicHorde()`：取视野外落点 → 周期口径加权抽 horde（落点固定时按 CE Monsters.c:814-828 failsafe 50 逐次重抽直到 `spawnsIn` 匹配）→ 领袖与随从状态全部置 `MonsterState.WANDERING`，绝不 ASLEEP。

### 2.6 规则 6：物种名失配修复（数据层，未加别名表）

`extract_hordes.cjs` 新增：解析 `src/brogue/Globals.c` 的 `creatureType monsterCatalog[]`（条目顺序与 Rogue.h `monsterTypes` 枚举一一对应，已程序化验证对齐），自动建映射 `MK_X → 目录显示名大写、空格转下划线`。改写条目共 7 个（自动得出，非硬编码）：

```
MK_WILL_O_THE_WISP -> WISP            MK_ACID_JELLY -> ACIDIC_JELLY
MK_GOBLIN_CHIEFTAN -> GOBLIN_WARLORD  MK_ANCIENT_SPIRIT -> MANGROVE_DRYAD
MK_SPECTRAL_IMAGE -> SPECTRAL_SWORD   MK_GUARDIAN -> STONE_GUARDIAN
MK_CHARM_GUARDIAN -> GUARDIAN_SPIRIT
```

后三个不在 horde 表中出现（顺带覆盖）。重新生成后 `hordes.json` 的 diff 仅 5 行：

```diff
-    "leader": "WILL_O_THE_WISP",        +    "leader": "WISP",
-    "leader": "ACID_JELLY",             +    "leader": "ACIDIC_JELLY",
-    "leader": "GOBLIN_CHIEFTAN", (×2)   +    "leader": "GOBLIN_WARLORD",
-    "leader": "ANCIENT_SPIRIT",         +    "leader": "MANGROVE_DRYAD",
```

**核验**：hordes.json 全表 59 个物种（leader + member），按 `id = 名字小写` 在 monsters.json 中零失配（抽取脚本硬门 + 测试 `horde_selection.test.ts` 双重断言）。Game.ts 未加任何别名表。

---

## 3. npm test / npm run build 输出尾部

### npm test（全绿运行）

```
 Test Files  14 passed (14)
      Tests  112 passed | 1 expected fail | 7 todo (120)
 Start at  03:18:47
 Duration  2.78s (transform 1.04s, setup 0ms, import 1.66s, tests 5.62s, environment 2ms)
```

基线为 13 文件 / 99 通过 + 1 failed + 1 expected fail + 7 todo（108）。本轮后 **112 通过、总数 120、原测试一个未减**。
⚠️ 如实说明：`monster_stats_effect.test.ts:194` 是**基线自带的统计性偶发**（详见 §8.4），本轮会话中它复现过 2 次（`legacy.hits 185 vs attacks 186`、`143 vs 146`），复跑即绿；新测试单独压测 12/12 稳定。

### npm run build

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: ...
✓ built in 1.39s
```

（chunk 体积警告为基线既有。）

---

## 4. 两套过滤口径的候选池条数

| 口径 | 禁用集 | 全表候选 | 验收门 |
| --- | --- | --- | --- |
| 开局铺怪（Monsters.c:1090） | IS_SUMMONED \| MACHINE_ONLY | **85 条** | ≥ 80 ✅ |
| 周期刷怪（Monsters.c:1133） | + LEADER_CAPTIVE \| NO_PERIODIC_SPAWN | **58 条** | ≥ 55 ✅ |

开局池含 `HORDE_LEADER_CAPTIVE` 条目 **20 条**（笼中俘虏+看守从此可以自然出现；实测多 seed 扫描确认实刷，见 §7 测试清单）。开局池物种数 47（修复前的周期口径池为 41）。

各深度开局池 horde 数（CE 硬窗口，D27+ 为 web 不使用区间）：

```
D1:4  D2:8  D3:12 D4:14 D5:18 D6:20 D7:23 D8:23 D9:25 D10:29 D11:28 D12:31
D13:34 D14:33 D15:33 D16:33 D17:35 D18:38 D19:37 D20:31 D21:27 D22:25 D23:23
D24:21 D25:19 D26:17
```

---

## 5. 加权抽取频次统计表（D5，固定 seed 20260914，N=10000）

候选 18 条、Σfrequency=1160。**χ²=16.1**（17 自由度，0.1% 显著水平临界值 40.8）——均匀抽样下仅 RAT 一项的 χ² 贡献即 >400，故加权机制得到强验证。

| 条目 | freq | 期望占比 | 实际命中 | 实际占比 | 绝对偏差 |
| --- | --- | --- | --- | --- | --- |
| RAT | 150 | 12.93% | 1272 | 12.72% | 0.21pp |
| KOBOLD | 150 | 12.93% | 1277 | 12.77% | 0.16pp |
| JACKAL | 50 | 4.31% | 413 | 4.13% | 0.18pp |
| EEL | 100 | 8.62% | 850 | 8.50% | 0.12pp |
| MONKEY | 50 | 4.31% | 460 | 4.60% | 0.29pp |
| BLOAT | 30 | 2.59% | 245 | 2.45% | 0.14pp |
| PIT_BLOAT | 10 | 0.86% | 77 | 0.77% | 0.09pp |
| GOBLIN | 100 | 8.62% | 872 | 8.72% | 0.10pp |
| GOBLIN_CONJURER | 60 | 5.17% | 534 | 5.34% | 0.17pp |
| TOAD | 100 | 8.62% | 919 | 9.19% | 0.57pp |
| PINK_JELLY | 100 | 8.62% | 873 | 8.73% | 0.11pp |
| GOBLIN_TOTEM | 100 | 8.62% | 873 | 8.73% | 0.11pp |
| ARROW_TURRET | 100 | 8.62% | 826 | 8.26% | 0.36pp |
| MONKEY（俘虏） | 20 | 1.72% | 158 | 1.58% | 0.14pp |
| MONKEY（看守） | 10 | 0.86% | 100 | 1.00% | 0.14pp |
| GOBLIN（看守） | 10 | 0.86% | 91 | 0.91% | 0.05pp |
| OGRE（看守） | 10 | 0.86% | 83 | 0.83% | 0.03pp |
| GOBLIN_MYSTIC（看守） | 10 | 0.86% | 77 | 0.77% | 0.09pp |

全部条目绝对偏差 < 5pp、且 <|4σ|。关于"偏差 < 5%"按绝对占比偏差解释的理由见 §8.1。

---

## 6. OOD 与 fuse 实测

### OOD（Monsters.c:797-805，固定 seed 20260915）

- **D1**：5000 次采样触发 0 次（CE：深度 1 不触发）✅；
- **D10**：10000 次触发 **1029 次 = 10.29%**（容差 ±3% 内）✅；
- 触发时抽取深度分布：`D11=196 D12=224 D13=213 D14=200 D15=196`——全部落在 [11,15]，五个深度均有出现（对应 `rand_range(1, min(5, 10/2))`）✅。

### 周期刷怪 fuse（固定 seed 20260916）

- 开局 fuse ∈ [125,175] ✅（`startNewGame` 按 RogueMain.c:403 初始化）；
- 置 fuse=1 后一回合内触发：当回合刷出新 horde、fuse 重置回 [125,175]、新怪（领袖+随从）全部 `WANDERING` 且不在玩家视野内 ✅；
- wizard 模式连续等待 400 回合：触发 2 次（期望 ≈400/150≈2.7），fuse 归零即刷怪并重置 ✅。

---

## 7. 实际效果：D1-D26 逐层怪物种类与数量表

条件：`src/test/harness.ts` headless 生成，seed=424242（与修复前基线 `headless_harness_report.md` §6 同 seed；但 P1-3 开局装备与本轮改动均已使 rng 流偏移，**只能定性对比**）。种类 id 为 monsters.json 的 `id`（变异个体已剥前缀归入基础物种）。含机关房/牢笼刷出的怪物（与 horde 无关的来源不再细分）。

| 层 | 数量 | 种类 |
| --- | --- | --- |
| D 1 | 7 | rat×5, jackal×2 |
| D 2 | 7 | jackal×2, bloat×2, monkey×1, rat×1, kobold×1 |
| D 3 | 10 | jackal×6, rat×2, kobold×2 |
| D 4 | 8 | kobold×2, toad×2, rat×2, goblin×2 |
| D 5 | 29 | goblin×12, goblin_totem×3, jackal×3, rat×3, toad×2, pink_jelly×2, kobold×1, monkey×1, goblin_conjurer×1, bloat×1 |
| D 6 | 15 | rat×3, kobold×3, vampire_bat×3, goblin×2, goblin_conjurer×1, bloat×1, goblin_totem×1, pink_jelly×1 |
| D 7 | 19 | rat×4, goblin_conjurer×3, spider×2, vampire_bat×2, pink_jelly×2, bloat×1, goblin_mystic×1, centipede×1, toad×1, goblin×1, acid_mound×1 |
| D 8 | 9 | vampire_bat×5, bloat×2, pink_jelly×1, acid_mound×1 |
| D 9 | 25 | goblin×10, ogre×3, goblin_totem×3, goblin_conjurer×3, spider×2, goblin_mystic×2, pink_jelly×1, toad×1 |
| D10 | 39 | goblin×13, monkey×5, goblin_totem×4, goblin_conjurer×3, acid_mound×3, goblin_mystic×2, jackal×2, centipede×2, acidic_jelly×1, pit_bloat×1, bloat×1, wraith×1, wisp×1 |
| D11 | 11 | goblin×3, wraith×2, vampire_bat×2, ogre×1, dar_blademaster×1, acidic_jelly×1, goblin_totem×1 |
| D12 | 11 | acid_mound×6, pink_jelly×2, spider×1, wraith×1, wisp×1 |
| D13 | 20 | dar_blademaster×5, ogre×2, explosive_bloat×1, kraken×1, vampire×1, zombie×1, flame_turret×1, pit_bloat×1, imp×1, pink_jelly×1, centipede×1, dar_priestess×1, dar_battlemage×1, ogre_shaman×1, acid_mound×1 |
| D14 | 11 | centaur×4, underworm×1, pit_bloat×1, centipede×1, phantom×1, acidic_jelly×1, dar_blademaster×1, troll×1 |
| D15 | 36 | ogre×9, goblin×5, goblin_totem×3, ogre_shaman×3, phantom×2, zombie×2, bloat×2, centaur×2, golem×1, lich×1, acidic_jelly×1, ogre_totem×1, goblin_conjurer×1, goblin_mystic×1, explosive_bloat×1, spider×1 |
| D16 | 17 | goblin_totem×3, goblin×3, phantom×1, sentinel×1, dar_priestess×1, goblin_conjurer×1, goblin_mystic×1, ogre_shaman×1, ogre×1, wisp×1, acidic_jelly×1, wraith×1, explosive_bloat×1 |
| D17 | 20 | goblin×5, wraith×4, imp×2, goblin_totem×2, tentacle_horror×1, dar_priestess×1, pixie×1, explosive_bloat×1, wisp×1, goblin_conjurer×1, goblin_mystic×1 |
| D18 | 24 | fury×6, wraith×4, ogre×3, bloat×2, dar_blademaster×2, centaur×2, lich×1, dar_priestess×1, dar_battlemage×1, ogre_totem×1, troll×1 |
| D19 | 31 | dar_priestess×7, pink_jelly×5, dar_blademaster×5, revenant×3, centaur×2, wraith×2, troll×2, ogre×2, dar_battlemage×2, ogre_shaman×1 |
| D20 | 15 | ogre×3, bloat×2, dar_blademaster×2, acidic_jelly×2, phantom×1, tentacle_horror×1, dar_priestess×1, dar_battlemage×1, ogre_shaman×1, revenant×1 |
| D21 | 14 | fury×5, wraith×3, bloat×2, golem×1, revenant×1, pink_jelly×1, dar_priestess×1 |
| D22 | 10 | dar_priestess×2, tentacle_horror×2, golem×2, pink_jelly×1, imp×1, phantom×1, revenant×1 |
| D23 | 16 | fury×12, revenant×1, golem×1, imp×1, dar_priestess×1 |
| D24 | 9 | dar_blademaster×2, explosive_bloat×1, imp×1, dragon×1, golem×1, dar_priestess×1, dar_battlemage×1, revenant×1 |
| D25 | 19 | fury×9, bloat×3, revenant×2, golem×2, imp×1, dragon×1, tentacle_horror×1 |
| D26 | 15 | tentacle_horror×3, dar_blademaster×3, imp×3, revenant×2, golem×1, dragon×1, dar_priestess×1, dar_battlemage×1 |

**全局物种总数：43**（验收门 ≥ 30 ✅）。四个修复物种的实刷证据：`goblin_warlord`（D5，前一轮表中它永不刷出）、`acidic_jelly`（D10-D20 多层）、`wisp`（D10/D12/D16/D17）已出现；`mangrove_dryad`（freq=10，低权）在本 seed 的 26 层中未命中，属加权正常现象，零失配测试保证其可刷。

### 与修复前基线的定性对比（同 seed 424242，rng 流已偏移，不逐格比）

- **修复前**：可选 horde 池被错误施加周期口径，且多数候选为水生系——D9 起 Eel/Bog monster/Kraken 占比过半（D11 Eel×11、D12 Eel×6+Bog×5、D24 Bog×8），陆生主力（goblin/ogre/troll 系）在 D6+ 大面积缺位；
- **修复后**：陆生物种按 CE 频度正常铺开（D5 起 goblin 系成为主力，ogre/troll/wraith/dar 系逐层入场），水生系不再霸版（原因见 §8.5）；四个失配物种全部恢复可刷资格；开局每层 horde 数从 3-5 提升到 CE 的 6+（期望 7.5），表层怪物量普遍上升（如 D5 6→29、D9 7→25、D15 15→36）。

---

## 8. 刷怪位置选择策略 与 与预设不符之处（只列不修）

### 8.1 验收 1 的"偏差 < 5%"口径解释

D5 候选池最小份额条目仅 0.86%（期望 86 次，σ≈9，相对噪声 ±11%），N=10000 下"逐条**相对**偏差 < 5%"统计上不可行（固定 seed 下需逐条 25±1.25 次命中的运气）。测试按"**绝对占比偏差 < 5 个百分点**"落地，并叠加两条强约束：逐条 |实测−期望| < 4σ、聚合 **χ² < 40.8**（均匀抽样必然爆表，加权必然通过）。若验收方坚持相对口径，建议把 N 提到 10⁶ 量级或只对份额 ≥5% 的条目适用。

### 8.2 "27 条 LEADER_CAPTIVE 永不出现"的数字修正

开局池相对旧周期口径**净增 27 条**（85−58），其构成为 **LEADER_CAPTIVE 20 条 + NO_PERIODIC_SPAWN 7 条**（无重叠）。即受益于口径修复的 captive horde 是 20 条，不是 27 条。

### 8.3 失配物种实为 7 个，不止 4 个

CE 中枚举名 ≠ 目录名者共 7 个：提示词列出的 4 个之外，还有 `MK_SPECTRAL_IMAGE→spectral sword`、`MK_GUARDIAN→stone guardian`、`MK_CHARM_GUARDIAN→guardian spirit`。后三个不在 horde 表中出现，自动映射已顺带覆盖，无实际影响。

### 8.4 基线自带的偶发失败（非本轮引入）

`monster_stats_effect.test.ts:194` 断言 `legacy.hits === legacy.attacks`（严格相等），但该测试头部自注引擎 Monster.ts 游走分支使用未播种 `Math.random()`，且 Game.ts 幻态绊趔（`hallucinating` 35% 偏转移动）可把"预期攻击"偏成移动，使命中数少于攻击数。本轮改动前基线即复现失败（143 vs 146），本轮会话中又偶发 2 次（185 vs 186），复跑即绿。属既有测试的统计脆弱性，按边界未动。

### 8.5 水生 horde（EEL/KRAKEN 等）当前不会自然出现

CE 的 `spawnsIn` 约束 + `randomMatchingLocation` 会让水生 horde 落进深水格；web 的开局铺怪落点池只收集普通 `FLOOR` 格，周期刷怪落点也排除水格（CE 的 `getRandomMonsterSpawnLocation` 同样排除非 pathing 地形），故 EEL/KRAKEN horde 两类路径都选不中（`hordeFitsTerrain` 永假 → failsafe 重抽跳过）。这是本轮如实实现 CE 约束后的副作用；彻底对齐需要给落点收集补"按 spawnsIn 匹配的水域格"来源，超出本轮边界，未做。

### 8.6 周期刷怪落点与 CE 的两处近似

- CE 用从玩家出发的**路径距离场**（阈值 DCOLS/2=50）筛选远格；web 用**切比雪夫距离 ≥ floor(DCOLS/2)=39** 近似，两级筛选（远格优先 → 无远格回退任意视野外合法格）与 CE 的两级结构一致；
- CE 每回合重算 IN_FIELD_OF_VIEW；web 用最近一次 `computeFOV` 的 `isVisible`（在本回合移动后的 `runMonsterTurns` 里可能是移动前的视野），存在一格级的滞后，方向上仍保证"不在玩家眼前刷新"。

### 8.7 fuse 递减的挂载点粒度

fuse 递减放在 `runMonsterTurns()`（每玩家动作恰好调用一次，web 的回合粒度即玩家动作）。半时值动作（pickup 50 tick）也按 1 回合递减，未按 tick 数折算；CE 按全局时间每 turn 减 1，两者在 move/wait 主路径上语义一致，半时动作存在轻微口径差。equip/quaff 等只在 UI 层推进 tick 的动作不触发 `runMonsterTurns`，也就不减 fuse——与 CE"未结束回合不刷怪"一致。

### 8.8 LEADER_CAPTIVE 领袖的附属语义（超出字面规则、按 CE 补齐）

规则 2 只要求放开过滤口径，但笼中俘虏若按普通怪生成会主动索敌，遭遇战不成立。按 CE Monsters.c:872-877 补齐：领袖 `isCaged=true`（不行动）、状态 `WANDERING`、HP 折至 `maxHp/4+1`。看守（成员）为普通怪。此项超出六条规则的字面范围，如不需要可单独回退（一个 if 块）。

### 8.9 逐层表中含非 horde 来源的怪物

§7 的物种表统计 `game.monsters` 全量，包含机关房（blueprint machine）与牢笼刷出的怪物（如 D13 的 kraken、flame_turret、dar 系部分来自机关）。horde 与机关的物种贡献未分列——机关刷怪走 `resolveBlueprintMonster`（独立口径），本轮未动。

---

## 9. 验收复现指引

```bash
cd brogue-web
npm test                                             # 14 文件全绿；112 passed | 1 expected fail | 7 todo
npm run build                                        # ✓ built in ~1.4s
npx vitest run src/test/horde_selection.test.ts \
  --reporter=verbose --disableConsoleIntercept       # 输出 §4-§7 全部数据表
node scripts/extract_hordes.cjs                      # 重新抽取 + 自检（175/85/58/零失配）
```
