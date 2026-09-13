# 占位卷轴实装报告（5/9）：teleport / protect_weapon / protect_armor / summon / discord

日期：2026-09-14
范围：本轮实装 9 个纯占位卷轴中的 5 个。其余 4 个（negate_burst / sanctuary_burst /
shatter_burst 需魔法剥夺与地形改造系统；amnesia 为 web 自创、CE 无此卷轴）未动，
处置建议见 §7。

---

## 1. 自测结果

### 1.1 npm test 输出尾部

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  17 passed (17)
      Tests  140 passed | 1 expected fail | 7 todo (148)
   Start at  03:59:44
   Duration  2.83s (transform 1.11s, setup 0ms, import 2.02s, tests 7.96s, environment 3ms)
```

- 原有 130 passed 全部保留；新增 `src/test/scroll_effects.test.ts` 10 个用例
  （130 + 10 = 140）。`1 expected fail | 7 todo` 为改动前既有的存量基线。
- 覆盖验收项 1-5：teleport 落格合法性、protect 的 isProtected/解咒/无装备不崩、
  isProtected 快照往返与旧存档回落、summon 数量与 HUNTING 状态、discord 状态施加
  与 discordant 怪物的目标选择（含 §9 的八方向回归用例）。

### 1.2 npm run build 输出尾部

```
dist/assets/browserAll-F0x0Ibcp.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-A81yeXrZ.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-YD5iwtVG.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-C8g8H5ZK.js               874.52 kB │ gzip: 276.09 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.34s
```

（chunk 体积警告为改动前既有现象，非本轮引入。）

### 1.3 git diff --stat

```
 brogue-web/src/engine/Core/Game.ts           | 139 ++++++++++++++++++++++++---
 brogue-web/src/engine/Items/Item.ts          |   2 +
 brogue-web/src/engine/Status/statusConfig.ts |   4 +-
 brogue-web/src/entities/Creature.ts          |   2 +-
 brogue-web/src/entities/Monster.ts           |  28 ++++++
 5 files changed, 161 insertions(+), 14 deletions(-)
```

另有新增文件：`src/test/scroll_effects.test.ts`（测试）与本报告，未触碰任何
边界外文件（Combat.ts / CombatFormulas.ts / Architect.ts / BlueprintEngine.ts /
Gas.ts / Bolt.ts / ItemLoader.ts / Player.ts / DetailGenerator.ts / src/data/*.json
均未改动；未执行任何 git 写操作）。

---

## 2. 五个卷轴的 CE 出处与实现对照

| 卷轴 | CE 出处（BrogueCE-master/src/brogue/Items.c） | web 实现位置 | 对照说明 |
|---|---|---|---|
| teleport_random | Items.c:7803 `teleport(&player, INVALID_POS, true)` | Game.ts:2350-2354 case → 复用既有 `teleportPlayerRandom()`（Game.ts:4416） | 与传送陷阱同一实现：候选 = 全图可通行、无怪物、非玩家当前格；保留原日志 |
| protect_weapon | Items.c:7922-7938 | Game.ts:2379-2382 case → `protectEquippedGear()`（Game.ts:3020） | 打 `isProtected`（对应 `ITEM_PROTECTED`）+ 单件解咒 |
| protect_armor | Items.c:7906-7921 | Game.ts:2383-2386 case → 同一 `protectEquippedGear()` | 同上 |
| summon_monsters | Items.c:7977-7990 | Game.ts:2400-2403 case → `summonMonstersAroundPlayer()`（Game.ts:3078） | 25 轮 × 8 邻格 × 10% 掷骰，总数 ≤3，复用 horde 系统按深度抽种，生成后置 HUNTING（CE `wakeUp`，Items.c:7987） |
| discord_burst | Items.c:8011 → `discordBlast("the scroll", DCOLS)`（Items.c:4883-4902） | Game.ts:2396-2399 case → `discordBlastFromPlayer()`（Game.ts:3047） | 视野内怪物施加 discordant 30 回合；`MONST_INANIMATE`/`MONST_INVULNERABLE` 豁免（Items.c:4896） |

### protect 细节（重要）

- CE `uncurse`（Items.c:7740-7746）**只清 `ITEM_CURSED` 标志，不重置负附魔**。
  web 实现同样只置 `isCursed = false`，`enchantment` 保持不动（测试锁定）。
- 未复用既有的 `removeCurseFromInventory()`：那是"整包解咒"且会把 enchantment
  负值清零，与 CE 单件语义不同（提示词已预警，未复用）。
- 无对应装备时打 CE 文案 "A protective golden light surrounds you, but it
  quickly disperses."，卷轴照常消耗（readItem 开头即 removeItem）。
- 解咒成功时额外打 "A malevolent force leaves your X."（Items.c:7915/7931）。

### summon 细节与一处刻意偏差

- CE 每次 `spawnHorde(0, pos, HORDE_LEADER_CAPTIVE | HORDE_NO_PERIODIC_SPAWN |
  HORDE_IS_SUMMONED | HORDE_MACHINE_ONLY, 0)` 成功后 `numberOfMonsters++`，
  但 `spawnHorde` 本身会落下**整队**（领袖+成员），故 CE 单次召唤的实际怪物数
  可以超过 3。web 按本轮验收口径"新增 1-3 只"钳制总数，每只取抽中 horde 的
  **领袖种类**生成。这是与 CE 的刻意偏差（验收标准优先），已在代码注释注明。
- 种类抽取完全复用 P1-2b 落地的 horde 系统：`rollSpawnDepth()`（10% out-of-depth，
  深度 1 不触发，与 CE spawnHorde 内部逻辑一致）→ `hordeCandidates(depth, 禁用集)`
  → `pickHordeType()`（frequency 加权）。summon 的 CE 禁用集恰好与既有
  `HORDE_PERIODIC_FORBIDDEN_FLAGS`（Monsters.c:1133 的调用形态）逐项一致，直接复用。
- 落格条件：格子可通行（web `isPassable` ≈ CE `!T_OBSTRUCTS_PASSABILITY`）且无
  怪物。注意 web 的 `isPassable` 允许熔岩/深水（CE 亦然——summon 只查阻挡通行
  位），生成的怪可能站在熔岩上；CE 中非火免怪会随之烧死，web 尚无怪物环境伤害
  逻辑（不在本轮范围），表现为站立不动。

---

## 3. `isProtected` 当前实际生效范围（如实说明）

**当前 `isProtected` 没有任何游戏机制读取它——它唯一的"生效"是 protect 卷轴自身
的写入与存读档持久化。** 逐项核对：

| CE 中 ITEM_PROTECTED 的作用 | web 现状 |
|---|---|
| 防酸怪腐蚀（`MA_HIT_DEGRADE_ARMOR` 降护甲附魔时应豁免） | web 已有该能力的怪物攻击逻辑（Monster.ts:434 附近，直接 `enchantment -= 1`），**不检查 isProtected**。该处位于 Monster.ts 战斗分支，本轮边界明确限定 Monster.ts 仅可改 discord 目标选择一处，故未接入 |
| 防负附魔（`checkForDisenchantment` 豁免） | web 尚无 checkForDisenchantment / 负附魔剥夺系统，无从豁免（如提示词所预期） |
| 存读档 | 已接入：`GameSnapshotItem.isProtected?`（可选字段，旧存档缺省回落 false）、`serializeItem`/`deserializeItem` |

即：读保护卷轴后装备会显示"已保护"并随存档保留，但在当前游戏机制下没有任何
事件会因这个标志而改变行为。这不是遗漏——腐蚀系统不在本轮边界内，待后续实装
酸蚀豁免/负附魔系统时消费该标志即可。

---

## 4. discord 持续时间的 CE 出处

**CE 没有名为 `discordDuration` / `DISCORD_DURATION` 的独立常量**（提示词预设有，
实际无，见 §8）。`discordBlast`（Items.c:4899）直接硬编码：

```c
monst->status[STATUS_DISCORDANT] = monst->maxStatus[STATUS_DISCORDANT] = 30;
```

即 **30 回合**。web 侧在 Game.ts 顶部定义 `const DISCORD_DURATION = 30` 并注明
出处行号；持续时间走既有 `tickCreatureStatuses()` 每回合递减，到期自动移除。

---

## 5. discord 在 AI 侧的接入点与改动说明

- **状态接入**：`StatusId` 新增 `'discordant'`（src/entities/Creature.ts:9）；
  `statusConfig.ts` 新增 `discordant: { label: '不和', color: '#c084fc',
  isDebuff: true }`（CE `discordColor` 为暗紫 {25,0,25,66}，web 取紫色系高亮值
  供 UI 状态条显示）。
- **AI 接入点**：`Monster.takeTurn()` 的 `MonsterState.HUNTING` 分支**开头**
  （src/entities/Monster.ts:343 附近），位于"丢失视野掉回 WANDERING"判定之前——
  使看不到玩家的 discordant 怪也会转身攻击身边同类。逻辑：扫描 8 邻格，发现其他
  存活怪物即发起 `CombatSystem.attack(this, other)` 并 return（命中打
  "turns on ... for N damage" 日志 + 飘字 + 血迹，未命中打 miss 日志）。
- **CE 对照**（Monsters.c:343-360 `monsterWillAttackTarget` / :390
  `monstersAreEnemies`）：attacker 或 defender 任一 discordant 即互为合法目标。
  本轮按任务要求实现 **attacker 侧**（discordant 怪把相邻怪物当攻击目标）这一
  最小改动；**defender 侧**（健康怪主动攻击身边的 discordant 怪）未实现——
  那需要改动普通怪的玩家追击分支，超出"最小改动"边界，留待后续。
- onHit 附加状态（毒/弱化/幻觉等）在怪互斗时不应用（web 的
  `applyMonsterOnHitStatus` 目前面向玩家），与 CE 有差距，如实注明。

---

## 6. 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/engine/Items/Item.ts` | 新增 `isProtected: boolean = false` 字段 |
| `src/entities/Creature.ts` | `StatusId` 联合类型新增 `'discordant'` |
| `src/engine/Status/statusConfig.ts` | 新增 discordant 的 label/颜色/debuff 条目 |
| `src/engine/Core/Game.ts` | 5 个卷轴 case 接入实现；新增 `protectEquippedGear` / `discordBlastFromPlayer` / `summonMonstersAroundPlayer` 私有方法；`DISCORD_DURATION` 常量；快照三处（接口 + 序列化 + 反序列化回落 false） |
| `src/entities/Monster.ts` | 仅一处：HUNTING 分支开头的 discordant 目标选择 |
| `src/test/scroll_effects.test.ts` | 新增，10 个验收用例（含 §9 八方向回归用例） |

---

## 7. amnesia 处置建议（单列，未实现未删除）

- **事实**：CE（BrogueCE-master）不存在 amnesia 卷轴；web 的
  consumables.json:scroll_of_amnesia 与 Game.ts:2404 的 `case 'amnesia'` 为自创
  （parity_gap_analysis.md §10.4 已登记）。
- **本轮处置**：按提示词要求，未实现、未删除，保持原占位日志行为。
- **建议**：由验收方决定去留——
  1. **删除**（对齐 CE）：删 consumables.json 条目 + case 分支。代价：涉及
     src/data/（本轮禁改），且旧存档里已生成的该卷轴会变成无 effect 的孤儿物品
     （会落到 default 分支打 "The runes fade."，不崩）。
  2. **保留为自创内容**：如产品上有意保留，建议从 parity 清单移出、单独立项，
     并补 CE 语义的近似实现（CE 无直接对应物；最接近的精神替代是
     SCROLL_MAGIC_MAPPING 的反向）。
  本报告倾向方案 1（删除），因为 parity 是本项目当前主线目标。

---

## 8. 与预设不符之处（只列不修，含提示词本身的偏差）

1. **提示词说 discord 持续时间"查 CE 的 `discordDuration`/`DISCORD_DURATION` 常量"**
   ——CE 没有该常量，Items.c:4899 在 `discordBlast` 内硬编码 30。web 侧自建
   `DISCORD_DURATION = 30` 常量并注明出处。
2. **CE summon 实际可超 3 只**：CE 每次 `spawnHorde` 落整队（领袖+成员），
   `numberOfMonsters < 3` 限制的是 spawnHorde 调用次数而非怪物数。提示词与
   验收标准均按"新增 1-3 只怪物"设定，web 按验收口径实现（钳制总数 ≤3、每只取
   horde 领袖），与 CE 原行为存在刻意偏差（见 §2 summon 细节）。
3. **提示词说 summon "复用 HORDE_IS_SUMMONED 之外的常规规则"**——CE summon 的
   禁用集是 `HORDE_LEADER_CAPTIVE | HORDE_NO_PERIODIC_SPAWN | HORDE_IS_SUMMONED |
   HORDE_MACHINE_ONLY`（Items.c:7981），并非"排除 HORDE_IS_SUMMONED 的常规规则"
   （那是开局铺怪 `HORDE_POPULATE_FORBIDDEN_FLAGS` 的口径）；它与 web 既有的
   `HORDE_PERIODIC_FORBIDDEN_FLAGS` 逐项一致，实现按前者复用。
4. **视野判定的实现选择**：CE discordBlast 用 `IN_FIELD_OF_VIEW` 标志 + 欧氏距离
   ≤ DCOLS 双条件；web 用 `hasLineOfSight(玩家→怪)` + 同款距离公式。原因：web 的
   `cell.isVisible` 由渲染流程刷新，卷轴生效时点可能读到过期缓存（开发中实测
   坐标直改后 isVisible 不更新）。语义等价（都是"玩家看得见"）。
5. **DCOLS 数值差异**：CE DCOLS=50，web `DCOLS = 100 - 20 - 1 = 79`（types/index.ts:52）。
   discord 的距离上限因此比 CE 宽约 1.6 倍，但实际受视线遮挡约束，通常不影响
   可感知行为。属 web 坐标系与 CE 的既有整体差异，非本轮引入。
6. **CE 的 discord 是双向敌意**（defender discordant 也会被健康怪主动攻击），
   web 本轮仅实现 attacker 侧（见 §5），任务要求"最小改动"，如实说明。
7. **`uncurse` 不清负附魔**：提示词表述"解除诅咒"正确，但需强调 web 既有
   `removeCurseFromInventory` 会把 enchantment 负值清零——那与 CE 不同且未复用；
   protect 的单件解咒严格只清 `isCursed`。
8. **无装备时的文案**：原占位实现为 "You have no weapon to protect."，CE/任务
   要求 "...but it quickly disperses."，已按 CE 改写（i18n key `scroll.protect_fail`
   不变，defaultValue 更新）。
9. **summon 落格可能在熔岩/深水**：CE 只查 `!T_OBSTRUCTS_PASSABILITY`，web
   `isPassable` 同样放行熔岩；CE 后续由环境伤害烧死非火免怪，web 无怪物环境
   伤害逻辑（越界），表现为站在熔岩上不受损。见 §2 summon 细节。
10. **原有 130 passed 基线核对**：改后 139 passed = 130 + 新增 9，无存量用例
    被删减或改写（1 expected fail / 7 todo 为既有存量）。

---

## 9. 修正记录（首轮验收返工）：discord 八方向数组缺陷

### 9.1 缺陷与修复

首轮实现中 `Monster.takeTurn()` discordant 分支的方向数组把右下写错：

```ts
// 缺陷版：[1,-1]（右上）出现两次，[1,1]（右下）缺失
const dirs8 = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,-1]];
```

后果：discordant 怪物永远不会攻击右下方的相邻怪物，右上方向被检查两次
（单次 takeTurn 只攻击第一个命中目标，故重复检查只是概率偏差而非双重攻击）。

修复（src/entities/Monster.ts:349）：改为完整 8 方向，顺序与同文件既有
confused 分支（:292）与 WANDERING 分支（:510）的 `dirs` 完全一致，并加注释
指明对齐关系。

### 9.2 复用调研：为什么仍是就地字面量（查过哪里）

按"优先复用现成常量"的要求，逐处排查了项目内八方向定义：

| 位置 | 形态 | 结论 |
|---|---|---|
| `src/types/index.ts:26` `Direction` 枚举 | 语义方向（UP/UPLEFT/…），非 (dx,dy) 位移对 | 不适合邻格遍历，需另建映射，反而多一层 |
| `src/engine/Generator/RoomBuilder.ts:62` `nbDirs` | (dx,dy) 数组，**内容正确** | 模块私有未导出；导出需改 RoomBuilder.ts（禁区文件），且实体层 import 生成器模块在架构上是反向依赖 |
| `src/test/harness.ts:52` `DIRS8` | (dx,dy) 数组，正确 | 位于测试目录，生产代码不应反向 import 测试文件 |
| `Monster.ts:292/:510`、`Game.ts` 多处 | 内联字面量 | 项目既有惯例即 case 内内联；其中 Game.ts 有的是错的（见 9.4） |

结论：**项目内不存在可被生产代码 import 的现成八方向常量**。建立共享常量的
正确位置应是 types/index.ts 或新公共模块，但那超出本轮"只许改 Monster.ts 与
测试文件"的边界。故就地修正并对齐同文件既有写法；建议后续单独立项把八方向
收敛为共享常量（届时 Game.ts:3079 的同款错误也会被一并消除）。

### 9.3 新增回归测试及有效性验证

`src/test/scroll_effects.test.ts` 新增用例"AI 目标选择覆盖全部 8 个相邻方向"：

- 组合断言：8 个位移去重后恰为 8 个、且都在 `{-1,0,1}² \ {(0,0)}` 内；
- 行为断言：对每个方向独立构造场景（discordant 怪居中、仅该方向邻格有一只怪），
  `takeTurn` 后必须把该方向的怪选为攻击目标（命中或 miss 的日志都算"选中"），
  漏掉任何方向都会以 `方向 (dx,dy) 未被选中` 报错。

有效性已实测：把缺陷数组临时放回原样跑测试，新用例**精确失败**并报出
`方向 (1,1)`；恢复修复后全绿。该用例对"漏方向"类错误具备捕捉能力。

### 9.4 如实披露：Game.ts summon 处存在同款缺陷（未修）

排查中发现 `Game.ts:3079`（`summonMonstersAroundPlayer` 的 `nbDirs`）有完全
相同的错误：`[1,-1]` 重复、`[1,1]` 缺失——首轮 summon 落格永远不含玩家右下方
格、右上方向概率翻倍。影响评估：summon 每轮 8 个方向入口中 1 个失效，
25 轮 × 10% 掷骰下仍几乎必然召满 3 只（首轮验收亦按此通过），实际游戏体验
影响轻微。

未修原因：该处位于 Game.ts，本轮返工边界明确只允许改 `Monster.ts` 与
`src/test/scroll_effects.test.ts`，且 summon 相关行为已验收通过。**留待下一轮
放开 Game.ts 时一行修正**（与本报告 §9.2 的共享常量建议可合并处理）。

### 9.5 返工后自测

```
 Test Files  17 passed (17)
      Tests  140 passed | 1 expected fail | 7 todo (148)
✓ built in 1.34s
```

（140 = 130 存量 + 首轮 9 + 本轮 1；改动文件仅 Monster.ts 与
scroll_effects.test.ts，边界未破。）
