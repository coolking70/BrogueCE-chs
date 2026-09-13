# vitest 引入与战斗公式 / RNG 黄金值回归测试 — 验收报告

- **日期**：2026-09-13
- **项目**：`brogue-web/`（Vite + Vue 3 + TS）
- **参考基线（只读）**：`BrogueCE-master/src/brogue/`（Combat.c / PowerTables.c / Math.c / Items.c / Rogue.h）
- **结论**：✅ 任务完成。测试 29 通过 + 1 预期失败（不符项占位）+ 6 todo，共 36 条；`npm run build` 全绿（1.38s，与基线一致）；反向验证确认测试网可捕获公式漂移；`src/` 下实现文件一行未改。

---

## 1. 任务要求与完成对照

| 任务要求 | 状态 |
| --- | --- |
| package.json 添加 devDependency vitest | ✅ `vitest@^4.1.11`（配套现有 vite 7.3.1） |
| scripts：`test` = vitest run、`test:watch` = vitest | ✅ |
| vitest 配置复用现有 vite.config.ts | ✅ 未新建任何配置文件；vitest 直接读取 vite.config.ts，默认 include 覆盖 `src/**/*.test.ts`；tsconfig 亦无需改动 |
| `CombatFormulas.test.ts` 覆盖全部 8 个导出函数 | ✅ 见 §4 明细 |
| 黄金值从 CE Combat.c / PowerTables.c 推导，断言注明源文件与行号 | ✅ 每条断言上方注释均标注（含 PowerTables.c 表格下标） |
| clumpedRoll：固定 seed 跑 10000 次，均值区间 + 理论边界 + 钟形分布，不断言单次结果 | ✅ seed=1234/5678/4321，min=0、max=10、均值∈(4.9,5.1)、中间桶(4-6)显著高于两端 |
| 边界必测：netEnchant [-20,50] 钳制 | ✅ 含恰好落在界内/越界/经力量修正越界三种 |
| 边界必测：strengthModifier 欠力量 -2.5/点 | ✅ `(15,16)→-2.5`、`(10,16)→-15` |
| 边界必测：defenseFraction(0) 恰好等于 1 | ✅ `toBe(1)` 精确断言 |
| `Random.test.ts`：同 seed 1000 个数快照锁序列 | ✅ seed=987654321 × `randRange(1,100)` × 1000，内联数组固化 |
| 同一 seed 两次初始化产生完全相同序列 | ✅ 另加异 seed 序列必不同（防呆） |
| 不修改 src/ 现有实现（一行不改） | ✅ 反向验证的临时改动已精确还原（`CombatFormulas.ts:39` 现为 `Math.pow(1.065, netEnch)`） |
| 公式与 CE 不符时不顺手修，只立 it.todo / it.fails 占位并单独列出 | ✅ 见 §5 |
| npm run build 保持全绿 | ✅ 见 §4.2 |

## 2. 交付文件清单（共 4 个）

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `package.json` | 修改 | devDependency `vitest@^4.1.11`；scripts 增加 `test` / `test:watch` |
| `package-lock.json` | 修改 | `npm install -D vitest` 产物 |
| `src/engine/Combat/CombatFormulas.test.ts` | 新建 | 战斗公式黄金值回归测试（30 条，其中 1 条 it.fails 占位 + 1 条 it.todo + 5 条 it.todo） |
| `src/engine/Random.test.ts` | 新建 | RNG 序列锁定测试（6 条） |

未改动：`vite.config.ts`、`tsconfig*.json`、`src/` 下任何实现文件。

## 3. 黄金值推导说明（供验收核对）

web 端 `CombatFormulas.ts` 以 float 近似 CE 的 16.16 定点表（`Rogue.h:99-101`：`FP_BASE=16`，`FP_FACTOR=65536`），因此 float 断言用 `toBeCloseTo(…, 12)`；CE 表格与 float 理想值间仅存在定点截断噪声（<0.02%，注释中已给出对应表格下标）。

推导过程中的关键事实——**CE 内部 defense 为 ×10 定点值**：

- 物品字段 `armor` 存 ×10 值，显示换算为 `armor/10 + enchant1`（`Items.c:1544`）；
- 玩家防御公式 `(armor*FP_FACTOR + enchant*10)/FP_FACTOR`（`Items.c:8519`），即内部值 = (基础+净附魔)×10；
- 怪物目录同样 ×10：ogre 目录值 60 = 显示 6，goblin 10 = 1（`Globals.c`）；
- 因此 `PowerTables.c:202` 索引式 `netDefense*4/10/FP_FACTOR + 80` 中 `/10` 是还原 ×10 标度，`*4` 换成 0.25 步进，最终每点防御指数恰为 0.1 → 表格基数 `0.877347265 = 0.987^10` → **`defenseFraction(d) = 0.987^d`**，与 web 端一致（`Combat.c:36` 头注释亦为此式）。

黄金值抽样（float 精确值，测试内固化到 12 位以上）：

| 函数 | 输入 | 期望值 | CE 对照 |
| --- | --- | --- | --- |
| accuracyFraction | 0 | 1 | 表下标 80 = 65536 |
| accuracyFraction | 10 | 1.877137465269359 | 下标 120 = 123020 |
| accuracyFraction | -20 | 0.2837970289214204 | 下标 0 = 18598 |
| damageFraction | 10 | 1.877137465269359 | `PowerTables.c:138-159` 与 accuracy 同表 |
| defenseFraction | 0 | 1（精确） | 下标 80 = 65536 |
| defenseFraction | 10 | 0.877347265250301 | 下标 84 = 57497 |
| defenseFraction | 100 | 0.270218617040487 | 下标 120 = 17709 |
| hitProbability | (100, 10) | 88（raw 87.7347） | `Combat.c:140` |
| hitProbability | (100, 0, 10) | 100（上限钳制） | `Combat.c:141-142` |
| netEnchant | (60,16,16) / (-30,16,16) | 50 / -20 | `Combat.c:81-82` |
| strengthModifier | (15,16) | -2.5 | `Combat.c:71-73` |

clumpedRoll 统计口径：`clumpedRoll(0,10,3)` 按 CE 分解为 1×d(0..4)+2×d(0..3)（`Math.c:48-56`；`Combat.c:53-55` 注释 "1d4 + 2d3"），理论均值 5.0，边界 [0,10]，理论桶概率 ≈ 0.19/0.50/0.31。

## 4. 验证记录

### 4.1 npm test（最终全绿输出尾部）

```
> brogue-web@0.0.0 test
> vitest run

 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 ✓ src/engine/Random.test.ts (6 tests) 11ms
 ✓ src/engine/Combat/CombatFormulas.test.ts (30 tests | 6 todo) 10ms

 Test Files  2 passed (2)
      Tests  29 passed | 1 expected fail | 6 todo (36)
   Start at  23:22:35
   Duration  127ms (transform 46ms, setup 0ms, import 62ms, tests 22ms, environment 0ms)
```

完整用例清单（`vitest run --reporter=verbose`，36 条）：

```
 ✓ Random.test.ts > seed=987654321 连续 1000 个 randRange(1,100) 与黄金序列完全一致
 ✓ Random.test.ts > 同一 seed 两次初始化产生完全相同的序列
 ✓ Random.test.ts > 不同 seed 产生不同序列（防呆：确认锁的不是常量）
 ✓ Random.test.ts > 序列值域在 [1, 100] 且边界可达（均匀性抽查）
 ✓ Random.test.ts > substantive 计数器与 randRange 调用次数一致（Math.c:164-166）
 ✓ Random.test.ts > randRange 恒定区间时每次消耗 ≥1 个原始随机数（拒绝采样，Math.c:125-136）
 ✓ strengthModifier > 力量盈余每点 +0.25
 ✓ strengthModifier > 力量欠缺每点 -2.5（边界必测）
 ✓ strengthModifier > 力量恰好相等时为 0
 ✓ netEnchant > 附魔 + 力量修正的叠加
 ✓ netEnchant > 钳制到 [-20, 50]
 ✓ accuracyFraction > 0 附魔 → 恰好 1（表格下标 80 = 65536）
 ✓ accuracyFraction > 正附魔按 1.065^x 放大
 ✓ accuracyFraction > 负附魔按 1.065^x 衰减
 ✓ damageFraction > 0 附魔 → 恰好 1
 ✓ damageFraction > 伤害缩放与命中缩放同表同值
 ✓ defenseFraction > defense=0 时必须恰好等于 1（边界必测；表格下标 80 = 65536）
 ✓ defenseFraction > 防御减伤系数 0.987^defense（CE 表格：下标 84=57497, 88=50445, 92=44258, 120=17709）
 ✓ hitProbability > 零防御 → 命中率等于 accuracy
 ✓ hitProbability > 防御减伤（未提供武器附魔）
 ✓ hitProbability > 武器附魔放大 accuracy 后再乘防御系数
 ✓ hitProbability > 上限钳制到 100
 ✓ armorProtection > 当前实现（乘法 1.065^netEnch）的行为快照
 ✓ armorProtection > 【与 CE 不符】当前乘法实现返回 5，CE 加法公式的黄金值是 6.5（Items.c:8519）   ← it.fails 占位
 □ armorProtection > armorProtection 待按 CE 加法公式重写后断言 base + netEnchant（钳 0）
 ✓ clumpedRoll > 固定 seed 下 10000 次的均值落在理论均值 5.0 附近
 ✓ clumpedRoll > 最小值/最大值等于理论边界 [0, 10]
 ✓ clumpedRoll > 分布呈钟形：中间桶计数高于两端
 ✓ clumpedRoll > clumping=1 退化为均匀分布
 ✓ clumpedRoll > min >= max 时原样返回
 ✓ clumpedRoll > 余数骰：clumpedRoll(0,10,4) = 2×d(0..3) + 2×d(0..2)，均值 5
 □ runicWeaponChance：web 为 7+4*ench 线性近似；CE 为按符文类型分表的 100-(1-k)^x（PowerTables.c:220-345）
 □ weaponSlowDuration：web 为 3+floor(ench/2)；CE 为 (ench+2)^2/3（PowerTables.c:102）
 □ weaponConfusionDuration：web 为 3+floor(ench*0.75)；CE 为 max(3, ench*3/2)（PowerTables.c:100）
 □ weaponImageCount：web 为 1+floor(ench/3)；CE 为 clamp(ench/3, 1, 7)（PowerTables.c:103）
 □ weaponForceDistance：web 为 floor(ench/2)+2（min 1）；CE 为 max(4, ench*2+2)（PowerTables.c:101）
```

### 4.2 npm run build（最终全绿输出尾部）

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.38s
```

chunk 体积警告为**改动前基线既有**（基线 build 输出相同警告，用时 1.50s），非本次引入。测试文件被 `tsconfig.app.json` 的 `include: src/**/*.ts` 纳入 `vue-tsc -b` 类型检查，全绿通过。

### 4.3 反向验证：1.065 → 1.06（真实输出）

**第一步**：将 `CombatFormulas.ts` 中 `accuracyFraction` 的基数 `1.065` 临时改为 `1.06`，运行 `npm test`：

```
 FAIL  ... > accuracyFraction — CE PowerTables.c:161-182 > 正附魔按 1.065^x 放大
AssertionError: expected 1.06 to be close to 1.065, received difference is 0.004999999999999893, but expected 5e-13
 ❯ src/engine/Combat/CombatFormulas.test.ts:81:37

 FAIL  ... > accuracyFraction — CE PowerTables.c:161-182 > 负附魔按 1.065^x 衰减
AssertionError: expected 0.9433962264150942 to be close to 0.9389671361502347, received difference is 0.004429090264859492, but expected 5e-13
 ❯ src/engine/Combat/CombatFormulas.test.ts:91:38

 FAIL  ... > hitProbability — CE Combat.c:116-147 > 武器附魔放大 accuracy 后再乘防御系数
AssertionError: expected 56 to be 57 // Object.is equality
 ❯ src/engine/Combat/CombatFormulas.test.ts:151:42

 Test Files  1 failed | 1 passed (2)
      Tests  3 failed | 26 passed | 1 expected fail | 6 todo (36)
   Start at  23:21:58
   Duration  130ms
```

漂移被捕获：除 `accuracyFraction` 自身两条外，组合使用它的 `hitProbability` 也连带失败（56 ≠ 57），证明测试网对间接漂移同样有效。Random.test.ts 不受影响（RNG 未动），符合预期。

**第二步**：还原为 `1.065`（按原字符串精确还原），重新运行：

```
 ✓ src/engine/Random.test.ts (6 tests) 11ms
 ✓ src/engine/Combat/CombatFormulas.test.ts (30 tests | 6 todo) 10ms

 Test Files  2 passed (2)
      Tests  29 passed | 1 expected fail | 6 todo (36)
   Start at  23:22:35
```

同轮 `npm run build` → `✓ built in 1.38s`，全绿恢复。

## 5. 发现的与 CE 不符项（只列不修，均未改动实现）

### 必测清单内（已在测试中占位）

1. **`armorProtection`（CombatFormulas.ts:81-91）— 结构性不符**
   - CE 为**加法**：`defense = (armor*FP_FACTOR + netEnchant*10)/FP_FACTOR`，armor 字段为 ×10 定点（`Items.c:8519`；显示换算 `Items.c:1544`；钳 0 见 `Items.c:8520-8521`）→ 每点净附魔恰好 **+1 防御**。
   - web 端为**乘法**：`baseArmor × 1.065^netEnch`。
   - 反例：scale armor(4) +2 附魔、力量盈余 +0.5 → CE 得 6（内部 60），web 得 5。
   - 占位方式：`it.fails` 钉住「当前返回 5 ≠ CE 黄金值 6.5」+ `it.todo` 作为按 CE 重写后的正式断言工作项。

### 必测清单外（引擎调用层或未列入清单的导出）

2. **伤害附魔的乘法位置（Combat.ts:116-119）**：CE 在 roll **之前**把伤害上下界乘 `damageFraction`（定点截断，`Items.c:8505-8506`）再 `randClump`；web 先按基础区间 roll，再乘 `damageFraction` 并四舍五入——分布与具体数值均有偏差（截断 vs 四舍五入 + 缩放位置不同）。
3. **武器 clumping 被忽略（Combat.ts:45,108-113）**：CE `randClump` 使用武器条目的 clumpFactor（`Combat.c:1245-1246`）；Combat.ts 硬编码 `clumping = 1`，`parseDamageString` 返回的 clumping 从未被使用。纯函数 `clumpedRoll` 本身与 CE 一致。
4. **护甲被当作减伤公式（Combat.ts:141-151）**：CE 护甲只通过 defense 降低命中率（`Combat.c:140`），**没有**固定减伤；web 把 armorProtection 直接从伤害中扣除（`damage -= protection`）。
5. **`hitProbability` 舍入差异（数值级，非结构性）**：CE 两级定点截断（`Combat.c:137-140`），web float 计算 + round；个别输入会差 1（如 accuracy 100 / defense 10：CE 定点 87，web 88）。
6. **其余导出公式**（测试中以 `it.todo` 立占位）：
   - `weaponSlowDuration`：web `3+⌊e/2⌋`；CE `(e+2)²/3`（`PowerTables.c:102`）
   - `weaponConfusionDuration`：web `3+⌊0.75e⌋`；CE `max(3, 3e/2)`（`PowerTables.c:100`）
   - `weaponImageCount`：web `1+⌊e/3⌋`；CE `clamp(e/3, 1, 7)`（`PowerTables.c:103`）
   - `weaponForceDistance`：web `max(1, ⌊e/2⌋+2)`；CE `max(4, 2e+2)`（`PowerTables.c:101`）
   - `runicWeaponChance`：web 线性近似 `7+4e`；CE 按符文类型分表 `100-(1-k)^x`，且依赖武器基础伤害与攻速修正（`PowerTables.c:220-345`）

### 与 CE 逐行一致、已锁黄金值的部分

`strengthModifier`、`netEnchant`、`accuracyFraction`、`damageFraction`、`defenseFraction`、`clumpedRoll`，以及整个 RNG（`ranval`/`raninit`/`range`/`rand_range`/seed 逻辑，`Math.c:97-191`，web 端 `Random.ts` 逐行对应，32 位 seed 下等价）。

## 6. 改动范围与 git 证据

事实说明：**brogue-web/ 在父仓库中整体处于未跟踪状态**（任务开始前即为 `?? brogue-web/`），因此 `git diff --stat` 无跟踪文件改动可显示：

```
$ git status --short
?? brogue-web/
?? output/

$ git diff --stat
（空输出 —— 没有任何已跟踪文件被改动）
```

本次会话实际写入的文件全清单（共 4 个，与 §2 一致）：`package.json`、`package-lock.json`、`src/engine/Combat/CombatFormulas.test.ts`（新建）、`src/engine/Random.test.ts`（新建）。`src/` 实现文件零改动——反向验证的临时修改（1.065→1.06）已按原字符串精确还原，可复核：

```
$ grep -n "1.06" src/engine/Combat/CombatFormulas.ts
35: * CE formula: 1.065 ^ netEnchant
39:    return Math.pow(1.065, netEnch);
44: * CE formula: 1.065 ^ netEnchant
```

## 7. 验收复现指引

```bash
cd brogue-web
npm test            # 期望：2 passed (2)；29 passed | 1 expected fail | 6 todo (36)
npm run build       # 期望：✓ built in ~1.4s，仅既有 chunk 体积警告
npm run test:watch  # 可选：watch 模式
```

漂移捕获能力复现（验证后请还原）：

```bash
# 把 src/engine/Combat/CombatFormulas.ts:39 的 1.065 改成 1.06
npm test   # 期望：3 failed（accuracyFraction ×2 + hitProbability ×1）
# 还原为 1.065
npm test   # 期望：恢复全绿
```
