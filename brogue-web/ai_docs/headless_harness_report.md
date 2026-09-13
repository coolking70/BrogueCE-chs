# P0-2 headless 测试 harness 与冒烟测试 — 验收报告

- **日期**：2026-09-13
- **项目**：`brogue-web/`（前置：P0-1 vitest 4.1.11 已合入）
- **结论**：✅ harness 与冒烟测试完成，`npm test` / `npm run build` 全绿，实现文件零改动（dist 产物与基线逐字节一致）。
  **一处与任务预设不符的重要发现**：用例 c 的字面断言（每层 monsters.length > 0）实测恒真，无法诚实地以 it.fails 落地红灯 —— 详见 §5.1；hordes.json 数据缺陷的显形是**种类偏斜**（水生怪主导）而非空层，§6 逐层表即 P1-2 修复前基线。

---

## 1. 交付内容

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/test/harness.ts` | 新建 | 导出 3 个函数：`createHeadlessGame` / `runTurns` / `terrainFingerprint` |
| `src/test/smoke.test.ts` | 新建 | 冒烟用例 a/b/c（另 1 条 it.todo 记录 c 的占位意图，见 §5.1） |
| `ai_docs/headless_harness_report.md` | 新建 | 本文档 |

**零改动**：src/ 下任何实现文件、vite.config.ts、tsconfig*、package.json。游戏逻辑一行未动，证据见 §8（dist 产物逐字节一致）。

### harness API 摘要

```ts
createHeadlessGame(seed: number, mode?: GameMode): Game
// i18next 幂等最小 init（空资源 + fallbackLng:false + initImmediate:false 同步初始化，
// 全部文案走引擎自带的 defaultValue）→ new Game() → startNewGame({seed, mode})。
// 每次返回独立实例，不复用 activeGame 单例。

runTurns(game, n, policy?): { turnsRun, died, logCount }
// 默认 policy：有相邻敌人(8向/存活/非盟友)则走向它=攻击；否则用项目 rng 随机选一个
// 合法方向移动（canMoveTo 且无怪占据），无路可走则 wait。
// 以 'system' source 调用 handlePlayerAction（跳过输入录制与回放拦截）。
// 玩家死亡（isGameOver 或 hp<=0）提前返回，died 如实报告，不吞不掉不外挂。

terrainFingerprint(grid): string
// 整层 terrain 逐格拼串（含宽高前缀）→ FNV-1a 32 位稳定哈希 + 串长后缀。
// 只取 terrain，不含光照/探索/可见位。
```

## 2. npm test 输出尾部（最终全绿）

```
 ✓ src/engine/Combat/CombatFormulas.test.ts (30 tests | 6 todo) 11ms
stdout | src/test/smoke.test.ts > ... > a) 固定 seed 20260913 连跑 2000 回合 ...
🌐 i18next is maintained with support from Locize ...
[smoke] turnsRun=2000 died=false logCount=29 deathReason=""

 ✓ src/test/smoke.test.ts (4 tests | 1 todo) 497ms

 Test Files  3 passed (3)
      Tests  32 passed | 1 expected fail | 7 todo (40)
   Start at  23:55:55
   Duration  778ms (transform 215ms, setup 0ms, import 269ms, tests 521ms, environment 1ms)
```

（`1 expected fail` 是 P0-1 的 armorProtection it.fails 占位；`7 todo` = P0-1 的 6 条 + 本次的 c 占位 todo。）

## 3. npm run build 输出尾部

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.41s
```

（chunk 警告为基线既有。测试文件被 `vue-tsc -b` 类型检查覆盖，全绿。）

## 4. 2000 回合冒烟实测数据（seed 20260913）

| 指标 | 实测值 |
| --- | --- |
| turnsRun | **2000（跑满）** |
| 是否中途死亡 | **否**（died=false），死因/死亡回合不适用 |
| 推进耗时 | **约 215 ms**（runTurns 净耗时；vitest 内整用例约 0.5s） |
| logger 消息条数 | **29 条**（harness 包装计数，不受 Logger 50 条封顶影响） |
| 击杀 | 5（开局层 D1 的全部怪物） |
| 所在层 / 血量 | D1 / 30/30（满血） |

过程解读（非外挂、如实呈现）：默认策略不含"走楼梯"动作，玩家在 D1 清完 5 只 Rat 后
持续随机游走，无新事件故日志量低（29 条 ≈ 视野消息 + 5 次击杀的战斗消息）。
生成链路的深层数据由用例 b/c 覆盖。

## 5. 与任务预设不符的发现（只列不修）

### 5.1 用例 c 无法以 it.fails 诚实落地（重要）

任务预设「D1..D26 每层 monsters.length === 0 会出现」并要求 it.fails 红灯占位。
**实测不成立**：

- 100 个连续 seed（1..100）× D1..D26 = **2600 层扫描：空怪层 0 个**，单层怪物数最少 1、最多 28；
- 另抽 10 个常用 seed（1/7/42/123/999/20260913/424242/987654321/31337/55555）逐层复核，同样无空层。

即字面断言 `monsters.length > 0` **当前恒真**。若强行 it.fails，vitest 会以
"Expect test to fail" 判套件失败，与「npm test 必须全绿」直接冲突。

**处置**（测试文件内均有注释说明）：
- 用例 c 以**正式断言**落地（当前即绿，锁住"无空层"这一底线）；
- 另立 `it.todo`（c-placeholder）记录原定红灯占位意图，P1-2 重新提取 hordes.json 后把断言**加固**为更有牙齿的形态（如"每层非水栖怪数 > 0"或最低数量下限），届时按实际数据决定 it()/it.fails 形态。

### 5.2 数据缺陷的真实显形：种类偏斜

「常规可刷 horde 仅 15 条且以水生怪为主」的缺陷是真实存在的，但它显形为
**D9+ 普遍由 Eel / Bog monster / Kraken 等水栖系主导**（见 §6 逐层表：
D11 Eel×11、D12 Eel×6+Bog monster×5、D24 Bog monster×8 等），而非空层。
Game.ts:711-723 的 flag 过滤器忠于 CE，问题在数据侧——本次未动过滤、未动生成。

### 5.3 生成链路之外的 Math.random()（供未来回放系统参考）

用例 b 未发现**生成链路**中的非 seed 随机源（正因如此 b 通过）。但引擎存在
生成链路之外的 Math.random() 调用，回放系统落地前需要知晓（本次不修）：

- `src/entities/Monster.ts:291,293,482,484` —— 怪物行为分支（影响战斗/游走的确定性）
- `src/entities/Creature.ts:24` —— 实体 id 生成（id 每次运行都不同）

## 6. D1-D26 逐层怪物数量与种类表（P1-2 修复前基线）

条件：seed = 424242（与用例 c 一致），逐层首次生成（无缓存复用）后立即采样；
种类按数量降序，`前缀词`（juggernaut/infested/vampiric/explosive/agile/reflective/grappling/toxic）为变异个体。

| 层 | 数量 | 种类 |
| --- | --- | --- |
| D 1 |  9 | Rat×9 |
| D 2 | 17 | Rat×9, Kobold×5, Jackal×2, Eel×1 |
| D 3 |  5 | Rat×2, Jackal×2, Kobold×1 |
| D 4 | 14 | Kobold×5, Jackal×4, Spider×3, Goblin mystic×1, Eel×1 |
| D 5 |  6 | Jackal×3, Kobold×2, Pit bloat×1 |
| D 6 | 11 | Vampire bat×4, Rat×3, Eel×2, Spider×1, Jackal×1 |
| D 7 | 12 | Rat×5, Spider×3, Vampire bat×2, Eel×1, Bog monster×1 |
| D 8 | 21 | Rat×10, Eel×10, Bog monster×1 |
| D 9 |  7 | Eel×5, Vampire bat×2 |
| D10 |  6 | Bog monster×2, Eel×2, Spark turret×1, Spider×1 |
| D11 | 17 | Eel×11, Vampire bat×3, Spider×2, Pit bloat×1 |
| D12 | 11 | Eel×6, Bog monster×5 |
| D13 | 11 | Bog monster×5, Pixie×2, Eel×2, Pit bloat×1, explosive Eel×1 |
| D14 | 12 | Bog monster×5, Eel×3, Pixie×2, Underworm×1, Naga×1 |
| D15 | 15 | Bog monster×6, Eel×5, Naga×1, juggernaut Bog monster×1, infested Bog monster×1, vampiric Bog monster×1 |
| D16 | 11 | Bog monster×3, Explosive bloat×2, vampiric Wraith×1, vampiric Acidic jelly×1, Fury×1, Pixie×1, Kraken×1, Salamander×1 |
| D17 |  9 | Bog monster×4, Eel×3, Kraken×2 |
| D18 | 18 | Bog monster×9, Eel×3, Kraken×2, Tentacle horror×1, Lich×1, Pixie×1, Dar priestess×1 |
| D19 | 10 | Salamander×4, Dar battlemage×2, Golem×1, Dragon×1, Underworm×1, Naga×1 |
| D20 | 11 | Eel×6, Bog monster×3, agile Naga×1, vampiric Eel×1 |
| D21 | 15 | Bog monster×3, Golem×2, juggernaut Bog monster×2, Fury×1, infested Fury×1, Black jelly×1, agile Underworm×1, explosive Lich×1, reflective Lich×1, Kraken×1, explosive Kraken×1 |
| D22 | 17 | Bog monster×4, Eel×3, Golem×2, Kraken×2, Lich×1, Tentacle horror×1, explosive Kraken×1, explosive Bog monster×1, grappling Eel×1, infested Kraken×1 |
| D23 | 11 | Bog monster×7, Kraken×2, vampiric Bog monster×1, toxic Kraken×1 |
| D24 | 12 | Bog monster×8, infested Bog monster×2, Kraken×1, juggernaut Bog monster×1 |
| D25 | 18 | Bog monster×10, Kraken×2, infested Golem×1, explosive Golem×1, Golem×1, juggernaut Tentacle horror×1, infested Bog monster×1, vampiric Bog monster×1 |
| D26 | 14 | Kraken×3, Bog monster×3, vampiric Golem×1, vampiric Revenant×1, Golem×1, toxic Revenant×1, vampiric Tentacle horror×1, grappling Golem×1, infested Kraken×1, vampiric Bog monster×1 |

偏斜量一目了然：D9 起 Eel/Bog monster/Kraken 在多数层占比过半，D12、D17、D20、D23、D24 几乎全水栖系。

## 7. 用例 b 结果与 headless stub 清单

**用例 b（确定性）**：✅ 通过。seed 987654321 两次完整生成，D1..D5 指纹两两相等：

```
D1 8ef1b24d:4616   D2 55b83bfa:4679   D3 cff47523:4694   D4 a0e39e4f:4690   D5 9982529a:4744
```

生成链路未发现非 seed 随机源（详见 §5.3 的链路外 Math.random 备注）。

**headless 化 stub 清单**：引擎运行时**零 stub**——Game.ts 依赖树（Grid/Architect/
Entities/Combat/Items/Environment/FOV/LightMap/…）无 window/document/localStorage
依赖（唯一碰 window 的 Input.ts 不在依赖图内），Game.ts:4320 的既有 window 守卫已就位。
实际做的装配只有三处，均为测试侧、不触实现：

| 装配点 | 性质 | 说明 |
| --- | --- | --- |
| i18next 最小 init（harness 内，幂等） | 任务内定职责 | 空资源 + initImmediate:false 同步初始化；已实测 i18next v25 未初始化时 t() 返回 undefined 不抛错，故 Game.ts 模块加载期构造 activeGame 单例不阻塞导入 |
| logger.log 实例方法包装 | 计数用 stub | Logger 单例封顶保留 50 条，包装实例方法统计真实调用数，用后还原（删除实例属性、还原原型分发） |
| 私有成员只读访问（`canMoveTo`/`generateDepth`） | 类型层转换 | `Omit<Game,…> & {…}` 绕开 TS5.9 的 private 交叉归约为 never 的问题；运行时无任何绕行 |

另：`process` 经 `globalThis` + 本地最小接口类型获取——因为 tsconfig.app 有意排除
@types/node 全局（`types: ["vite/client"]`），不应为测试污染 App 类型作用域。

## 8. 改动范围证据

brogue-web/ 在父仓库中整体未跟踪（本任务开始前即如此），`git diff --stat` 无跟踪文件改动可显示：

```
$ git status --short
?? brogue-web/src/test/    ← 本次新增（harness.ts / smoke.test.ts）
?? output/
$ git diff --stat
（空——没有已跟踪文件被改动）
```

按任务要求给出 dist 产物比对（实现未改动 ⇒ 应与基线完全一致，实测一致）：

```
基线:  dist/assets/index-CJfYM-Zw.js / 851777 bytes
本次:  dist/assets/index-CJfYM-Zw.js / 851777 bytes
sha256: eb4bf9786005ae9cb955c0334c9e284bf1d5c7f7  （重建前后一致）
```

## 9. 验收复现指引

```bash
cd brogue-web
npm test            # 期望：3 passed (3)；32 passed | 1 expected fail | 7 todo (40)
npm run build       # 期望：✓ built in ~1.4s；dist 与基线逐字节一致
```

D1-D26 逐层表复现（seed 424242，报告 §6 即其输出）：

```ts
import { createHeadlessGame } from 'src/test/harness';
const game = createHeadlessGame(424242);
// D1 已随 startNewGame 生成；此后每层：game.depth = d; (game as any).generateDepth(false, false);
// 然后读 game.monsters（元素含 name/hp/isAlly 等）。
```
