# parity_gap_analysis.md 核验报告（2026-09-13 复核）

复核方式：对 `brogue-web/src` 与 `BrogueCE-master/src` 逐条取证（读源码、跑 node 统计、跑 `npm run build`）。

**总体结论：文档可信，可作为重构基线使用。** 抽查的 20 余条论断中，绝大多数逐字命中源码事实，且多处数字精确到个位（如"132 条 horde 仅 15 条可用、深度 1 只有 4 条、D26 只有 2 条"，实测完全一致）。下面只列**需要更正、需要加严或被低估**的条目。

---

## A. 已逐条证实（抽查通过，无需改动）

| 论断 | 取证 |
|---|---|
| `monsters.json` 无 accuracy/defense/regen/moveSpeed/attackSpeed | 实测 67 条，字段仅 hp/damage/minDepth/maxDepth/…；`Monster.ts:104-109` 全落 `?? 100 / ?? 0` |
| `monsters_ce2.json` / `monsters_ce.json` 全仓库无引用 | `grep` 全部 import 点，只有 monsters/hordes/mutations/blueprints/weapons/armors/consumables/arcana 被引用 |
| `Time.ts` 事件队列死代码 | `Game.ts` 只用 `timeSystem.currentTick += 100`（27 处），`scheduleEvent/eventQueue` 零调用 |
| `moveSpeed/attackSpeed` 仅用于展示 | 唯一消费点是 `DetailGenerator.ts:149-150`，不进任何调度 |
| horde 132 条 → 可用 15 条；D1=4、D26=2；均匀随机不带权 | 实测一致；`Game.ts:730` 注释自认 `Should be weighted random, but using uniform for now` |
| 数量对齐表（武器 12、药水 16、卷轴 14、魔杖 7、法杖 7、戒指 6、护符 6） | 实测 JSON 条数完全一致 |
| 卷轴 5/14 有效果，9 个纯打日志 | `Game.ts:2107-2165` switch：teleport/protect_weapon/protect_armor/negate/sanctuary/shatter/discord/summon/amnesia 分支体内只有 `logger.log` |
| 外观池 8 色药水配 16 种、8 标题配 14 种 | `ItemLoader.ts:60-83`，且 `forEach` 里 `if (index < shuffled.length)` — 超出部分**永久无 flavor** |
| 护符 speed 给 levitating | `Game.ts:2207` `applyTimedStatus(this.player, 'levitating', 20)` |
| 符文触发率线性近似 `7+4e` / `5+3e` | `CombatFormulas.ts:133-146`，注释自认 "Formula approximation" |
| 不生成走廊，`corridorChance` 定义后从未使用 | `Architect.ts:42` 定义，全仓库无读取；`attachRooms` 只做房间贴合 |
| 湖泊只有 blob 深浅水/草/植被/泥/网，无岩浆湖无深渊 | `Architect.ts:333-385` `designEnvironmentOvelays` |
| 地形枚举 26 种 | `Grid.ts:9-34` NOTHING..MUD = 26 |
| CHASM 枚举存在但从不生成 | 枚举有，overlays/blueprint 生成路径均无 |
| 深水即死 | `Game.ts:3674` 非飞行直接 `triggerGameOver` / `entity.die()` |
| CE 常数 STOMACH_SIZE 2150 / 350 / 150 / 50、TURNS_FOR_FULL_REGEN 300 | `Rogue.h:1123-1127` 一致 |

`npm run build` 当前**全绿**（vue-tsc + vite，1.4s，零错误），可作为回归基线。

---

## B. 需要更正的条目

### B1. 「饱腹 10 回合回 1HP，比 CE 快 ~30 倍」— **错误**

`Player.ts:83-84`：`nutrition > 6000` 时 `healThreshold = 10`，即 10 回合回 1 HP。初始 `maxHp = 30` → 满血耗时 **300 回合**，与 CE `TURNS_FOR_FULL_REGEN = 300` **完全一致**，不存在 30 倍差距。

真正的偏差是另外三点，应改写为：
1. **不随 maxHp 缩放**：CE 是"无论多少上限，300 回合回满"；网页版固定 10 回合/HP，maxHp 一旦成长就**比 CE 慢**。
2. **阈值语义错**：CE 的 350/150/50 是 Hungry/Weak/Faint 提示与惩罚阈值，**不改变回血速度**；网页版拿 6000/2000 当回血档位，是自创机制。
3. **无中毒禁回血**：CE 中毒期间 regen 归零，网页版无此判定。

### B2. 「CE 力量 12」暗示网页版不是 12 — **网页版已是 12**

`Player.ts:16` `strength = 12`。normal 模式无偏差；偏差只在 easy(14)/wizard(18)，属刻意设计。此条应从"初始状态不符"清单中移除。

### B3. 「horde 117 条被 flag 过滤排除」— **归因错误**

过滤器本身是**忠于 CE 的**（CE 同样不在常规刷怪中使用 CAPTIVE/SUMMONED/MACHINE_* horde）。真正的缺陷在**数据提取**：

- CE `hordeCatalog_Brogue` 共 **175 条**，其中常规可刷 **58 条**；
- `hordes.json` 只有 **132 条**，常规可刷仅 **15 条**——即 56 条 captive 一条不落地导进来了，而 **43 条常规 horde 被漏掉**。

更严重的是这 15 条的构成：

```
RAT ×2, KOBOLD ×2, JACKAL ×2, EEL ×2, VAMPIRE_BAT, BOG_MONSTER ×2,
NAGA, SALAMANDER, KRAKEN ×2
```

**D5 和 D10 各只有 4 条可用，且以水生怪为主**（EEL/BOG_MONSTER/KRAKEN 需要深水，而深水只是 0-2 团 blob）。结论应加严为：**中深层地牢事实上接近空场**——goblin/ogre/troll/wraith 等陆生主力**完全不会自然刷出**，只能靠笼子和蓝图偶发出现。这比文档表述的"数量偏少"严重得多，应提升为与"数据断层"同级的 P0。

### B4. 「无初始飞镖」— **严重低估：玩家初始背包完全为空**

`Game.ts:272-318` `startNewGame()` 只 `new Player(...)`，**没有任何 `inventory.addItem`**。玩家赤手空拳、无甲、无口粮开局。

CE（`RogueMain.c:420-443`）：口粮 ×1 + 匕首（已鉴定、已装备）+ 飞镖 ×15 + 皮甲（已鉴定、已装备，`STATUS_DONNING = 0`）。

这是**改动量最小、体感差异最大**的一条，应列为 Phase A 首批。

### B5. 头部统计数字不准

- 「brogue-web/src 22,667 行 TS」：实际 **TS 9,164 行 + Vue 2,745 行 = 11,909 行代码**；22,733 是把 JSON 数据表算进去的目录总行数。
- 「BrogueCE-master 41,356 行 C」：`.c` 实际 **48,691 行**，含 `.h` 为 52,791。

不影响任何结论，但"15-20% 还原度"这个数字是基于错误分母算的，建议改为定性表述或按**功能点**而非行数计。

---

## C. 文档未提及、但应补入的缺口

1. **无任何测试基础设施**。`package.json` 无 test script，无 vitest/jest，`playwright` 只在 devDependencies 里躺着，全仓库零 `*.test.ts`。**在开始任何移植之前这是最高优先级**——没有确定性回归网，Phase A/B 的公式改动无法验收，也无法证明没有破坏现有可玩性。
2. **`ai_docs/parity_plan.md` 与 `task.md` 已严重过期**（仍写"monsters.json 4 条""weapon 2、armor 2"），与现状矛盾。应标注废弃，统一以 `parity_gap_analysis.md` + 本报告为准，否则会误导执行方。
3. **`DetailGenerator.ts` 已经在消费 `monsters_ce2.json` 的 description 字段的翻译成果**（progress.md 2026-03-07 条目），说明 ce2 是**有人维护的活数据**，只是没接进运行时。这强化了"合并 ce2"作为单点最高回报改动的判断。
4. **rng 与存档的结构性冲突**：文档 §9 提到"存档不保存 levels 缓存"，但没点破后果——`Game.ts` 用 `this.levels` 做楼层持久化，读档后重生成会让**同一 seed 的同一层内容改变**，这同时**摧毁回放的可行性**。回放修复必须以存档序列化 levels + 固定 RNG 消耗顺序为前提，不能并行推进。
