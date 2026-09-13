# P1-6 回归修复报告：存档 quantity 丢失 + 详情面板伤害显示错误

日期：2026-09-14
范围：`src/engine/Core/Game.ts`、`src/engine/UI/DetailGenerator.ts`（仅此两处源码改动）

---

## 一、修复内容概述

### 缺陷 ①：存档快照丢失 quantity

上一轮 `Item` 新增 `quantity` 字段（默认 1，开局飞镖 15），但 `GameSnapshotItem`
未序列化该字段，读档后 15 支飞镖回落为 1。

修法：接口加可选字段 `quantity?: number`，`serializeItem` 写入、`deserializeItem`
读出，旧存档缺字段时回落为 1（`?? 1`）。

### 缺陷 ②：详情面板维护了第二套伤害解析

`DetailGenerator.ts` 本地 `parseDamage`（正则 `/(\d+)d(\d+)/`，返回 `[n, n*d]`）
不认 `1dN+M` 记法的 `+Z` 后缀，导致每件武器详情面板区间显示错误：

| 武器 | damage 串 | 修复前面板 | 修复后面板 |
|---|---|---|---|
| Mace | `1d5+15` | 1~5 | 16~20 |
| War Hammer | `1d11+24` | 1~11 | 25~35 |
| Dagger | `1d2+2` | 1~2 | 3~4 |

修法（按任务要求，非补正则）：**删除**本地 `parseDamage`，两处调用点统一改用
`CombatSystem.parseDamageString`（`src/engine/Combat/Combat.ts:180`，返回
`{min, max, clumping}`），消灭第二套解析。战斗结算原本就走
`CombatSystem`，不受影响。

三件武器的 damage 串已对照 `src/data/weapons.json` 核实：
`Dagger 1d2+2`、`Mace 1d5+15`、`War Hammer 1d11+24`，测试断言值与实况一致。

---

## 二、修改前后代码对照

### Game.ts（+4 行）

**接口 `GameSnapshotItem`（原 37-60 行区域）：**

```diff
     category: number;
     loc: Pos;
     weight: number;
+    quantity?: number;
     damage?: string;
```

**序列化点 `serializeItem`（原 Game.ts:3454 附近）：**

```diff
             loc: { x: item.loc.x, y: item.loc.y },
             weight: item.weight,
+            quantity: item.quantity,
             damage: item.damage,
```

**反序列化点 `deserializeItem`（原 Game.ts:3488 附近）：**

```diff
         item.weight = s.weight;
+        // 旧存档无 quantity 字段，回落为 Item 默认堆叠数 1
+        item.quantity = s.quantity ?? 1;
         item.damage = s.damage;
```

### DetailGenerator.ts（+7/-16）

**新增 import：**

```diff
 import { hitProbability, netEnchant, damageFraction, strengthModifier } from '../Combat/CombatFormulas';
+import { CombatSystem } from '../Combat/Combat';
```

**调用点 1（怪物侧，原 :176）：**

```diff
-    // Parse monster damage
-    const mDmg = parseDamage(dmgStr);
+    // Parse monster damage（复用 CombatSystem.parseDamageString，与战斗结算同一套解析）
+    const mDmg = dmgStr ? CombatSystem.parseDamageString(dmgStr) : null;
     if (mDmg && playerHP > 0) {
-        const avgDmg = (mDmg[0] + mDmg[1]) / 2;
+        const avgDmg = (mDmg.min + mDmg.max) / 2;
         ...
-        const hitsToKill = Math.max(1, Math.ceil(playerHP / Math.max(1, mDmg[1])));
+        const hitsToKill = Math.max(1, Math.ceil(playerHP / Math.max(1, mDmg.max)));
```

**调用点 2（物品侧，原 :279）：**

```diff
         if (item.damage) {
-            const [lo, hi] = parseDamage(item.damage) || [0, 0];
+            const { min: lo, max: hi } = CombatSystem.parseDamageString(item.damage);
             statsLines.push({ text: `基础伤害: ${item.damage} (${lo}~${hi})` });
```

（下游「实际伤害」行用 lo/hi 乘附魔系数，修复前同样继承错误区间，现随本修一并纠正。）

**删除本地 `parseDamage`（原 :385-393）及其空的 `// ---------- Helper ----------` 注释头。**

---

## 三、「parseDamageString 回落行为 vs 原 null 判空」处理说明

原 `parseDamage` 语义：入参 falsy 或不匹配 `NdM` 时返回 `null`，调用点各自判空：
怪物侧 `if (mDmg && ...)`（跳过整段战斗分析行），物品侧 `|| [0, 0]`（显示 `(0~0)`）。

`CombatSystem.parseDamageString(ds: string)` 语义：**永不返回 null**——
`NdM`/`NdM+Z` 走骰子分支；`X-Y` 走区间分支；其余回落为常量
`{min: max: parseInt(ds,10) || 1}`；且参数类型为 `string`，传 undefined 会在
`ds.match` 处直接抛 TypeError。

处理方式（逐调用点）：

1. **物品侧**：调用本来就位于 `if (item.damage)` 内，undefined/空串到不了
   `parseDamageString`，无崩溃可能；原 `|| [0,0]` 兜底随之删除。行为差异：
   非骰子串（如纯数字 `"5"`）旧显示 `基础伤害: 5 (0~0)`，现显示 `5 (5~5)`，
   比旧兜底更合理（旧值本身就是错的）。
2. **怪物侧**：保留 falsy 守卫 `dmgStr ? CombatSystem.parseDamageString(dmgStr) : null`
   + 原 `if (mDmg && playerHP > 0)`——undefined/空串时 `mDmg` 为 null，与原
   `parseDamage` 返回 null 的行为**逐位一致**（跳过「平均每击/最坏几击」两行），
   不会崩。对非空但非骰子格式的串（`X-Y`、纯数字），旧行为是静默跳过该两行，
   新行为是给出正确的区间/常量数值——属修复面内的合理改进。

**现网数据零影响验证**：`src/data/monsters.json` 全部 67 个怪物的 damage 串
均为纯 `NdM` 记法（无 `+Z`、无 `X-Y`、无常量串），怪物侧面板输出对实际游戏
数据逐字不变；且 `NdM` 下两套解析对 min/max 的结果一致（`n` / `n*d`）。

---

## 四、新增测试

**`src/engine/Core/snapshotQuantity.test.ts`（2 条）**
- 往返：起新局（seed 20260914）→ 断言飞镖 quantity=15 → `toSnapshot`（断言快照内
  飞镖条目 quantity=15，覆盖序列化点）→ `loadSnapshot` 到全新实例（断言返回 true）→
  飞镖 quantity 仍为 15（覆盖反序列化点）。
- 旧存档兼容：快照内所有物品 `delete s.quantity`（并守卫断言字段确实删净）→ 读入 →
  全部物品 quantity === 1 且 `Number.isFinite`，非 undefined/NaN。

**`src/engine/UI/DetailGenerator.test.ts`（5 条）**
- `it.each` 三组：`"1d5+15"`→`基础伤害: 1d5+15 (16~20)`、`"1d11+24"`→`(25~35)`、
  `"1d2+2"`→`(3~4)`（整行精确断言）。
- `item.damage` 为 undefined：不抛异常；「武器属性」段存在但无伤害行（既有行为）。
- `monster.damageString` 为 undefined：不抛异常；「战斗分析」段正常生成。

---

## 五、验证结果

### npm test（输出尾部）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web


 Test Files  8 passed (8)
      Tests  64 passed | 1 expected fail | 7 todo (72)
   Start at  01:22:03
   Duration  746ms (transform 530ms, setup 0ms, import 797ms, tests 602ms, environment 1ms)
```

基线为 57 passed + 1 expected fail + 7 todo；现 64 passed = 原 57 + 新增 7，
**原有用例无一减少、无一改动**。`1 expected fail` 为基线既有项，保持不变。

### npm run build（输出尾部）

```
dist/assets/WebGLRenderer-DTUQhzen.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-DzCJelFU.js               852.94 kB │ gzip: 272.78 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.37s
```

`vue-tsc -b` 类型检查随构建通过；chunk 体积警告为构建既有现象，非本次引入。

### git diff --stat

```
 brogue-web/src/engine/Core/Game.ts          |  4 ++++
 brogue-web/src/engine/UI/DetailGenerator.ts | 23 ++++++-----------------
 2 files changed, 10 insertions(+), 17 deletions(-)
```

新增未跟踪文件：`src/engine/Core/snapshotQuantity.test.ts`、
`src/engine/UI/DetailGenerator.test.ts`。未触碰任何禁改文件，未执行任何
git 写操作，仓库内无临时文件。

---

## 六、与预设不符之处（只列不修）

1. **怪物侧行为差异比提示词描述的更宽**：提示词只要求确认「damage 为 undefined
   时不崩」。实际差异是：非骰子但可解析的串（`X-Y` 区间、纯数字常量）从旧行为
   「静默跳过两行分析」变为「显示正确数值」。已核实对 monsters.json 现网 67 条
   数据零影响（全部为 `NdM`），故未做额外收窄；如需逐字保持旧行为可在调用点
   加格式白名单，但这会重新引入第二套格式判断，与本次修复目标相悖。
2. **物品侧 `|| [0, 0]` 兜底被删后**，无法解析的串显示常量值而非 `(0~0)`。
   `(0~0)` 本身是错误展示（伤害不可能是 0~0），判定为改善而非回归；仅列出以备
   审阅。
3. **提示词行号微偏**：`serializeItem` 的对象字面量起于 Game.ts:3452-3454
   （`id: item.id,` 确在 3454，与提示词一致）；`deserializeItem` 的
   `item.enchantment = s.enchantment;` 在 3488，亦与提示词一致。无实际偏差，
   此条仅作核对记录。
4. **仓库外既有未跟踪目录 `../output/`**（相对 brogue-web）：在任务开始的
   gitStatus 快照中即存在，非本次产生，未触碰。
