# flaky 测试修复报告：monster_stats_effect.test.ts

- 日期：2026-09-14
- 对象：`src/test/monster_stats_effect.test.ts`（本轮**唯一**改动的文件；未触碰任何 src/ 实现文件、其他 .test.ts、src/data/ 下 json；未执行任何 git 写操作）
- 结论：脆弱断言改为统计区间断言，**10/10 连续通过**；三种"改坏"场景反向验证均能报警且已还原；`npm test` 145 passed 保持；`npm run build` 通过。

---

## 1. 问题与修复方式

原 L194：`expect(legacy.hits).toBe(legacy.attacks)`（严格相等）。

失败机制（已在实测中复现两种）：

1. `Monster.ts` 混乱游走分支（L291/293）与 WANDERING 游走分支（L510/512）使用
   **未播种的 `Math.random()`**，同 seed 不可复现，打乱整条遭遇序列；
2. `Game.ts:1944` 幻态绊趔：`hallucinating` 状态下 35% 概率把移动方向随机偏转
   （`rng.randPercent(35)`），把"预期的攻击"变成一次移动 → `hits < attacks`。
   （归因细节见 §5 第 2 条：该掷骰本身是 seeded，不可复现性经"是否处于幻态"间接来自 (1)。）

修复（只动测试文件）：

- L194 改为 `未命中数 ≤ max(5, ceil(5% × attacks))` 的区间断言，失败消息中完整写明
  为什么不能用严格相等（未播种 Math.random + 幻态绊趔 + 实测假失败数据 + 根治方向）；
- **同文件另发现两条同类脆弱断言**（详见 §4）：原 L198 `wired.hits < wired.attacks`
  与原 L199 `wired 命中率 < legacy 命中率`，实测均会被合法噪声击穿，一并改为：
  - 接线证据（保留原断言）：`wired.attacksOnDefended > 0`、`wired.maxDefenseSeen > 0`；
  - 效果证据（新增）：`wired 未命中数 ≤ max(6, ceil(15% × attacks))`；
  - 移除原 L199 严格序比较（理由见 §4）。
- 测试文件头部注释补充：根治需把 `Monster.ts` 的 `Math.random()` 收编进 seeded rng，
  那是回放系统的前置条件，属会改变 RNG 流结构、使全部既有确定性测试（地形指纹等）
  失效的结构性改动，必须单独排期，不在本测试文件可修范围内。
- `REPEATS` 16 → 32（回合数 500 不变）：样本翻倍以压缩聚合比率噪声（任务只禁止
  降低样本量）。该测试文件单次运行 2.3s → ~4.4s。

未采用的方式：加重试循环（会掩盖不稳定）；降低样本/回合；改 `Monster.ts`
（RNG 流结构性改动，须单独排期）。

---

## 2. 验收①：连续 10 次运行全部通过

命令：`npx vitest run src/test/monster_stats_effect.test.ts`，连续 10 次：

```
RUN 1: ✅ PASS  [legacy: runs=32 turns=13007 died=7 maxDepth=5 attacks=365 hits=365 rate=100.0%]  [wired : runs=32 turns=15191 died=2 maxDepth=5 attacks=466 hits=454 rate=97.4%]  Tests: 2 passed (2)
RUN 2: ✅ PASS  [legacy: runs=32 turns=13802 died=5 maxDepth=5 attacks=382 hits=382 rate=100.0%]  [wired : runs=32 turns=13501 died=6 maxDepth=5 attacks=455 hits=449 rate=98.7%]  Tests: 2 passed (2)
RUN 3: ✅ PASS  [legacy: runs=32 turns=13706 died=5 maxDepth=3 attacks=404 hits=404 rate=100.0%]  [wired : runs=32 turns=14283 died=4 maxDepth=5 attacks=411 hits=396 rate=96.4%]  Tests: 2 passed (2)
RUN 4: ✅ PASS  [legacy: runs=32 turns=12818 died=7 maxDepth=4 attacks=357 hits=357 rate=100.0%]  [wired : runs=32 turns=13088 died=7 maxDepth=5 attacks=496 hits=486 rate=98.0%]  Tests: 2 passed (2)
RUN 5: ✅ PASS  [legacy: runs=32 turns=13403 died=6 maxDepth=5 attacks=402 hits=399 rate=99.3%]  [wired : runs=32 turns=13406 died=6 maxDepth=5 attacks=442 hits=426 rate=96.4%]  Tests: 2 passed (2)
RUN 6: ✅ PASS  [legacy: runs=32 turns=13688 died=5 maxDepth=3 attacks=336 hits=332 rate=98.8%]  [wired : runs=32 turns=13407 died=6 maxDepth=5 attacks=435 hits=419 rate=96.3%]  Tests: 2 passed (2)
RUN 7: ✅ PASS  [legacy: runs=32 turns=13459 died=6 maxDepth=5 attacks=400 hits=400 rate=100.0%]  [wired : runs=32 turns=14303 died=4 maxDepth=5 attacks=394 hits=390 rate=99.0%]  Tests: 2 passed (2)
RUN 8: ✅ PASS  [legacy: runs=32 turns=12877 died=7 maxDepth=4 attacks=343 hits=343 rate=100.0%]  [wired : runs=32 turns=13834 died=5 maxDepth=5 attacks=446 hits=435 rate=97.5%]  Tests: 2 passed (2)
RUN 9: ✅ PASS  [legacy: runs=32 turns=13330 died=6 maxDepth=4 attacks=415 hits=415 rate=100.0%]  [wired : runs=32 turns=12697 died=8 maxDepth=5 attacks=470 hits=450 rate=95.7%]  Tests: 2 passed (2)
RUN 10: ✅ PASS [legacy: runs=32 turns=13826 died=5 maxDepth=5 attacks=369 hits=369 rate=100.0%]  [wired : runs=32 turns=14681 died=3 maxDepth=5 attacks=411 hits=396 rate=96.4%]  Tests: 2 passed (2)
=== TOTAL: 10/10 passed, 0 failed ===
```

其中一次的完整原始输出（含逐目标 tally）：

```
[monster_stats_effect] legacy: runs=32 turns=13405 died=6 maxDepth=5 attacks=372 hits=372 rate=100.0% damageTaken=398 kills=157
[monster_stats_effect]   legacy 目标: Jackal(def=0):67攻/67中 Kobold(def=0):119攻/119中 Rat(def=0):126攻/126中 Acid mound(def=0):4攻/4中 Bloat(def=0):9攻/9中 Monkey(def=0):21攻/21中 Goblin(def=0):24攻/24中 Pit bloat(def=0):2攻/2中
[monster_stats_effect] wired : runs=32 turns=13454 died=6 maxDepth=5 attacks=441 hits=429 rate=97.3% damageTaken=402 kills=167
[monster_stats_effect]   wired 目标: Jackal(def=0):65攻/65中 Kobold(def=0):130攻/130中 Rat(def=0):140攻/138中 Monkey(def=17):42攻/37中 Bloat(def=0):9攻/9中 Goblin(def=10):26攻/22中 Pink jelly(def=0):22攻/22中 Eel(def=27):3攻/2中 Toad(def=0):2攻/2中 Pit bloat(def=0):2攻/2中
[monster_stats_effect] troll 接敌: attempts=30 hits=13 rate=43.3%
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

---

## 3. 验收②：反向验证（改坏 → 报警 → 还原）

因严格边界禁止触碰 src/ 实现文件，未采用"直接改实现压命中率"，而是用测试自身
的数据注入点模拟数据被改坏——被改坏的值同样流经真实的 Combat 命中掷骰路径，
对"断言能否检出命中率崩塌"的验证效果等价。三组验证均**已还原**（还原确认见每组末行；
还原后的最终状态即 §2 的 10/10 与 §6 的 npm test / build）。

**① legacy defense 数据改坏（0 → 70，命中率应塌至 ~40%）** —— 报警 ✅

```
[monster_stats_effect] legacy: runs=32 turns=8063 died=17 maxDepth=3 attacks=458 hits=176 rate=38.4% damageTaken=694 kills=70
AssertionError: legacy 应近乎全中（acc=100 × defenseFraction(0)=1），实测未命中 282/458（允许 ≤23）。
不能用严格相等的原因：Monster.ts 游走分支的未播种 Math.random + Game.ts 幻态绊趔（hallucinating 时 35% 偏转移动方向）
会把预期攻击变成一次移动，同 seed 不可复现，严格相等实测约 1/3 概率假失败（143/146、163/168、185/186）。
根治需把 Math.random 收编进 seeded rng（回放系统前置条件，另行排期）。
若未命中数远超阈值，说明 legacy 语义或命中公式被破坏，请勿简单放宽阈值。
: expected 282 to be less than or equal to 23
```
还原：`LEGACY_DEFAULTS.defense` 已恢复为 `0`。

**② wired defense 数据整体改坏（全部 → 90）** —— 报警 ✅

```
[monster_stats_effect] wired : runs=32 turns=9597 died=14 maxDepth=3 attacks=608 hits=200 rate=32.9% damageTaken=639 kills=85
AssertionError: wired 命中率不应崩塌，实测未命中 408/608（允许 ≤92）。…: expected 408 to be less than or equal to 92
```
还原：临时 else 分支已整体删除，恢复原始代码形态。

**③ wired defense 数据未接线（全部 → 0）** —— 接线探测器报警 ✅

```
AssertionError: expected 0 to be greater than 0
 ❯ src/test/monster_stats_effect.test.ts:244:41   // expect(wired.attacksOnDefended).toBeGreaterThan(0)
```
还原：同上，临时 else 分支已删除。

---

## 4. 同文件其他脆弱断言的排查结果

| 断言（原行号） | 形式 | 结论 | 处理 |
|---|---|---|---|
| L194 `legacy.hits` **toBe** `legacy.attacks` | 严格相等 | 脆弱（实测 163 vs 168 假失败） | 改为未命中数 ≤ max(5, 5%·attacks) |
| L198 `wired.hits` **toBeLessThan** `wired.attacks` | 严格序 | **脆弱（基线复跑 RUN1 即假失败 145 vs 145）**：浅层 wired 目标几乎全为 def=0，对 def=17 Monkey 的 2 次攻击全中（概率 ~64%）是完全正常的结果 | 移除；其检出职责由"接线证据 + wired 未命中上限"承担 |
| L199 `wired 命中率` **toBeLessThan** `legacy 命中率` | 严格序 | **脆弱（基线复跑 RUN5 的数据 legacy 97.0% < wired 98.9% 即为合法噪声反转）**：n≈150-450 时两比率的抽样噪声（±2-3pp）大于真实间距 | 移除。按数据性质 wired 逐攻击命中率恒 ≤ legacy（def ≥ 0 点态成立），无需断言 |
| L196/197 `attacksOnDefended/maxDefenseSeen` **> 0** | 下界 | 稳健且是"接线"探测的关键：32 聚合下对 def>0 目标的攻击每轮必现（Monkey def=17 恒在浅层），归零即 defense 未接线 | 保留（反向验证③证明其报警能力） |
| L191/192 `attacks` **> 0** | 下界 | 稳健（计数 ~330-500） | 保留 |
| troll 组 L247/249/251（attempts ≥ 25；0 < hits < attempts） | 下界/严格序 | 统计上稳健：该路径完全在 seeded rng 上，实测数十次恒为 30/13/43.3%；P(全中)≈0.4³⁰≈1e-12，P(全不中)≈0.6³⁰≈2e-7 | 保留未动 |

---

## 5. 放宽后的阈值及检出能力论证

当前合法噪声观测（32 seed × 500 回合聚合，共 18 次完整运行）：

- legacy 未命中：最差 **4/336 = 1.2%**（10 连跑 RUN6）；历史 16-seed 聚合最差 5/168 = 3.0%；其余全部 0-1 次。
- wired 未命中：最差 **20/470 = 4.3%**（10 连跑 RUN9）；特征化 8 跑区间 0.5%-3.8%。

| 断言 | 阈值 | 噪声侧裕度 | 检出能力（报警侧） |
|---|---|---|---|
| legacy 未命中 ≤ max(5, 5%·attacks) | n≈340-420 → 允许 17-21 | ≥ 4× 当前观测最差（4），≥ 1.7× 历史最差（3.0%） | legacy 命中率跌破 95% 即触发：全局引入 ≥6% 固定 miss（均值 ~0.5%，5% 阈值 ≈ 10σ 外）必触发；defense 整体泄漏进 legacy（本测试守护的接线语义被破坏）时命中率向 wired 深层水平（~93-96%）塌缩，触发裕度数倍起。反向验证①实测 61.6% 未命中，超阈值 12× |
| wired 未命中 ≤ max(6, 15%·attacks) | n≈390-500 → 允许 59-75 | ≥ 3.3× 观测最差（4.3%） | wired 命中率崩至 85% 以下即触发：defense 整体改坏为 90 的演练中未命中 67.1%，超阈值 ~5.6×（反向验证②）；命中率减半类公式回归同样远超阈值 |
| attacksOnDefended > 0 且 maxDefenseSeen > 0 | 每轮聚合必现 def>0 攻击（Monkey def=17 恒在） | 归零概率可忽略 | defense 数据未接线（全部归 0）时确定性报警（反向验证③） |

已知盲区（如实列出）：若回归方向是"wired 命中率异常**升高**"（如 defense 符号翻转变成加成），
wired 未命中会趋近 0，15% 上限不触发，且原 L199 严格序被移除后无对应探测器。
该方向原本也只在 ~几个百分点的噪声裕度内有效（RUN5 已证其自身不稳），故视为未覆盖，
如需覆盖建议后续在 troll 定向接敌组上扩展（该组样本可控、完全可复现）。

---

## 6. 其余验收项

- `npm test`：`Test Files 18 passed (18)，Tests 145 passed | 1 expected fail | 7 todo (153)`
  —— **145 passed 保持不减少**（"1 expected fail / 7 todo"为仓库既有标记，非本次引入）。
- `npm run build`：`✓ built in 1.34s`（chunk >500kB 警告为既有现象，非错误）。
- `git status`：仅 `M src/test/monster_stats_effect.test.ts`（+ 新增本报告）。

---

## 7. 与预设不符之处（只列不修）

1. **Math.random 行号漂移**：预设为 Monster.ts 约 291/293/482/484 行；实际当前代码为
   **L291/293（混乱分支）与 L510/512（WANDERING 分支）**。文件已在此前提交中发生行号位移。
2. **幻态绊趔的随机性归因**：`Game.ts:1944` 的 35% 偏转掷骰用的是**已播种的**
   `rng.randPercent(35)`，并非直接的不可复现源；不可复现性经由"玩家此刻是否处于
   hallucinating"这个状态位间接来自 Monster.ts 未播种游走所打乱的遭遇序列。
   结果形态（hits < attacks 偶发）与预设一致，但根治点确实只在 Monster.ts 一处。
3. **脆弱断言不止"严格相等"一条**：预设只点名 L194；实测发现 L198/L199 的严格序
   断言同样会被合法噪声击穿（基线复跑 6 次中就各命中一次），已按任务第 2 条
   "一并处理"改为区间断言/移除，并保留接线探测断言承担原语义。
4. **REPEATS 16 → 32**：为压缩聚合比率噪声把样本翻倍（回合数、seed 起点不变，
   任务仅禁止降低样本量）。这是超出"仅放宽断言"的附加改动，单次文件运行
   2.3s → ~4.4s，如不可接受可回退至 16（阈值裕度论证按 32 给出，回退需复核 §5）。
5. **反向验证的实现方式**：任务示例为"改坏实现"，因严格边界禁止触碰 src/，
   改用测试自身数据注入点（LEGACY_DEFAULTS / wired 临时改写）模拟三类数据损坏，
   走同一条 Combat 命中路径，验证效果等价。
