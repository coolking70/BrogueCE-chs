# 护甲模型对齐 CE：从"减伤"改为"命中概率"——交付报告

日期：2026-09-14
任务：把 web 端护甲从「乘法减伤值 + 命中后扣血」改为 CE 的「加法防御值 ×10 标度，只进命中率公式」。

---

## 1. 改动概述

CE 的真实模型（已逐行核对 BrogueCE-master 源码）：

- `Items.c:8515-8523`（recalculateEquipmentBonuses）：
  `player.info.defense = (theItem->armor * FP_FACTOR + enchant * 10) / FP_FACTOR; <0 则钳 0`，
  其中 `theItem->armor` 是 ×10 定点（leather=30，显示值 = armor/10 + enchant1，`Items.c:1544`），
  `enchant = netEnchant(theItem)`（含力量修正）。即 **内部防御值 = (显示护甲 + 净附魔) × 10，纯加法**。
- 该防御值**只**喂命中率公式 `Combat.c:140`（`hitProbability = accuracy * defenseFraction(defense * FP) / FP`，
  `defenseFraction = 0.987^d`，`PowerTables.c:184-204`）。
- **CE 全源码没有"护甲从伤害里扣点数"的实现。**

web 原实现（两处均错，本次均已修）：

| 位置 | 原实现 | 问题 | 现实现 |
|---|---|---|---|
| `CombatFormulas.armorProtection()` | `round(baseArmor × 1.065^netEnch)` | 乘法；CE 是加法（每点净附魔恰好 +1 显示防御 = +10 内部防御） | 函数改名 **`playerDefense()`**，返回 `(armor + netEnchant) × 10`，钳 0 |
| `Combat.ts` 命中后结算 | `damage -= armorProtection(...)`（141-151 行） | CE 无此步骤 | **整块删除**；防御值只进 `hitProbability` 的 `defenderDefense` |

### 代码改动明细

1. **`src/engine/Combat/CombatFormulas.ts`**：`armorProtection` 重写并更名为 `playerDefense(baseArmor, enchantment, playerStrength, requiredStrength)`。内部防御值 = `max(0, (baseArmor + netEnchant(…)) × 10)`。注释注明 CE 行号（Items.c:8515-8523 / 1544，Combat.c:140，PowerTables.c:184-204）。
2. **`src/engine/Combat/Combat.ts`**：
   - 怪物攻击玩家路径（`Monster.ts:379/410 → CombatSystem.attack(monster, player)`）：`defenderDefense` 由 `playerDefense(...)`（×10 标度）计算，喂给 `hitProbability`；
   - 删除了整个"Apply armor reduction"块（原 141-151 行），命中后按伤害骰全额扣血；
   - `AttackResult.hit` 的注释同步修正（"伤害被护甲减到 0"的语义不复存在）。
3. **`src/engine/Combat/CombatFormulas.test.ts`**：原 `armorProtection` describe 块替换为 `playerDefense — CE Items.c:8515-8523（加法模型）`（详见 §4）。
4. **新增 `src/test/armor_model_effect.test.ts`**：前后配对对照（详见 §5）。

---

## 2. 验收自查（对应验收条款 1-3）

1. **it.fails 转正式断言并通过**：`it.fails('【与 CE 不符】…黄金值是 6.5…')` →
   `it('黄金值：scale(4) +2 附魔、力量盈余 +0.5 → 内部防御 65（Items.c:8519）')`，
   断言 `expect(playerDefense(4, 2, 16, 14)).toBe(65)`，通过。
   （提示词示例经复核**正确**：4 + 2.5 = 6.5 显示 → 内部 65。）
2. **it.todo 落地**：落地为 `it('加法模型黄金值：base + netEnchant（×10 标度）')`（leather/plate/0.25 步进/负附魔/基础 0 共 6 组黄金值）。
3. **新增断言**：
   - `it('每点净附魔使内部防御值 +10（含 0.25 步进的 +2.5）')`：附魔 +1 → +10；力量盈余 +4 → +10；力量欠缺 -1 → -25；0.25 步进 → +2.5；
   - `it('净防御为负时钳到 0（Items.c:8520-8522，边界必测）')`：-10→0、恰好 0 保留、-170→0、欠缺 3 力量 15 保留 / 欠缺 4 → 0。
4. **Combat.ts 无减伤路径**（自查证据）：
   - `grep -n "armor\|protection\|damage -=" src/engine/Combat/Combat.ts` → `armor` 仅出现在 `defenderDefense` 计算处（73-76 行）与注释；无任何 `damage -=` 护甲代码；
   - `grep -rn "armorProtection" src/` → **0 条**（函数已删净）。

---

## 3. 新旧公式对照表

确定性黄金值（非随机采样）。旧"减伤值" = `round(armor × 1.065^netEnch)`，命中后伤害再减该值（下限 1）；
新内部防御值 = `(armor + netEnch) × 10`，命中后全额伤害。命中率 = `hitProbability(100, 防御值)`。

| 组合 armor/+ench/力量/需求 | netEnch | 旧减伤值 | 新防御值（内部/显示） | 旧命中率 | 新命中率 |
|---|---|---|---|---|---|
| leather 3/+0/10/10 | 0 | 3 | 30 / 3.0 | 96% | 68% |
| leather 3/+0/12/10（盈余+2 力量） | +0.5 | 3 | 35 / 3.5 | 96% | 63% |
| leather 3/+3/10/10 | +3 | 4 | 60 / 6.0 | 95% | 46% |
| scale 4/+2/16/14（提示词示例） | +2.5 | 5 | 65 / 6.5 | 94% | 43% |
| chain 5/+0/13/13 | 0 | 5 | 50 / 5.0 | 94% | 52% |
| banded 7/+0/15/15 | 0 | 7 | 70 / 7.0 | 91% | 40% |
| splint 9/+0/17/17 | 0 | 9 | 90 / 9.0 | 89% | 31% |
| plate 11/+0/19/19 | 0 | 11 | 110 / 11.0 | 87% | 24% |
| plate 11/+3/19/19 | +3 | 13 | 140 / 14.0 | 84% | 16% |
| plate 11/+3/12/19（欠缺 7 力量） | -14.5 | 4 | 0（钳 0）/ 0 | 95% | 100% |

体感示例（期望每击伤害 = 命中率 × E[damage]，旧模型再 -减伤值、下限 1）：

- 弱怪 1d3（acc 80）vs 皮甲+0：旧 `0.8×0.96×max(1, 2−3→1) ≈ 0.77` → 新 `0.8×0.68×2 ≈ 1.08`（**+40%，被弱怪磨血变多**）；
- 强怪 6d6（acc 100）vs 板甲+3：旧 `1.0×0.84×max(1, 21−13=8) ≈ 6.7` → 新 `0.16×21 ≈ 3.4`（**−49%，强怪打重甲明显变弱**）。

---

## 4. 测试改动说明（CombatFormulas.test.ts）

原 `armorProtection` describe 块含 3 条：旧实现的"行为快照"（1 条正式断言）、`it.fails` 占位、`it.todo` 占位。
本次落地后该块共 **4 条正式断言**（黄金值 65 / 加法黄金值组 / 每 +1 附魔 +10 / 负值钳 0），全部通过。

> 边界说明（如实报告）：任务边界写"仅限把 it.fails/it.todo 落地"，但"行为快照"逐行锁定旧乘法公式，
> 与函数改名 + 按决策改行为后必然编译/断言双失败（其自身注释也写明用途是"在无决策的情况下防漂移"，
> 本次即该决策）。故该快照随决策一并替换为锁定**新**行为的断言，未削弱任何既有验证强度。

文件头注释的口径（float 理想值 vs CE 定点截断 ≤0.02%）沿用未动。剩余 5 条 `it.todo` 为任务范围外的
其他 CE 不符项占位（runicWeaponChance / weaponSlowDuration 等），保持原样。

---

## 5. 前后配对对照数据（行为层影响量化）

方法：新增 `src/test/armor_model_effect.test.ts`（沿用 `monster_stats_effect.test.ts` 的 legacy/wired 配对聚合模式）。

- **legacy = 改造前 `Combat.ts attack()` 的逐行忠实复刻**（乘法护甲公式 + 命中后 `damage -= protection` 都保留），
  通过临时替换静态方法 `CombatSystem.attack` 注入引擎，跑完在 `finally` 中还原；wired = 真实引擎。
- 5 个护甲档位 × 20 个固定 seed（88301-88320）× 400 回合/局，`createHeadlessGame + runTurns`，
  策略"相邻敌人则攻击，否则向楼下推进"；档位力量取该甲力量需求（盈余 0，隔离护甲边际效应）。
- 指标：怪物→玩家攻击数 / 被命中率 / 累计受伤（按攻击结果精确求和）/ 死亡次数 / 最大深度。

### 5.1 聚合结果（最终代码状态的一次完整捕获）

| 档位（旧防御值→新防御值） | 模式 | 攻击 | 被命中率 | 累计受伤 | 受伤/击 | 死亡 | 回合 | 最大深度 |
|---|---|---|---|---|---|---|---|---|
| 无护甲（0→0） | legacy | 173 | 80.9% | 321 | 1.86 | 6/20 | 5912 | 4 |
| | wired | 168 | 84.5% | 332 | 1.98 | 6/20 | 6034 | 5 |
| 皮甲+0（3→30） | legacy | 357 | 75.6% | 276 | 0.77 | 4/20 | 6647 | 4 |
| | wired | 220 | 53.2% | 303 | 1.38 | 7/20 | 5399 | 5 |
| 皮甲+3（4→60） | legacy | 331 | 76.4% | 253 | 0.76 | 4/20 | 6603 | 4 |
| | wired | 299 | 36.5% | 264 | 0.88 | 3/20 | 6989 | 4 |
| 板甲+0（11→110） | legacy | 249 | 73.9% | 184 | 0.74 | 2/20 | 7459 | 7 |
| | wired | 278 | 19.4% | 140 | 0.50 | 1/20 | 7709 | 5 |
| 板甲+3（13→140） | legacy | 256 | 71.5% | 183 | 0.71 | 1/20 | 7705 | 6 |
| | wired | 355 | 11.3% | 118 | 0.33 | 2/20 | 7431 | 6 |

### 5.2 定向验证（引擎级，与 Monster.ts:379/410 同路径直调）

monkey（monsters.json acc=100, def=17）对玩家 60 次挥击（确定性，无 Math.random 参与）：

- 无护甲：**60/60 全中**（无甲 → 防御 0 → 命中率 100%，证明无甲时不泄漏任何防御值）；
- 板甲+3 legacy：47/60 = 78.3%（理论 0.987^13 ≈ 84.5%，二项噪声内）；
- 板甲+3 wired：5/60 = 8.3%（理论 0.987^140 ≈ 15.9%，-1.6σ，噪声内）。

### 5.3 结论（如实报告，未调参）

- **被命中率**是改动最直接、最剧烈的变化：同档位下 wired 被命中率全面大幅下降
  （皮甲+0：75.6%→53.2%；板甲+3：71.5%→11.3%），命中率随防御指数衰减（×0.987/点），边际收益递减。
- **护甲边际收益曲线的形状变化**：
  - 旧模型护甲价值 ≈ 线性减伤，且因"伤害下限 1"存在免伤平台——减伤值 ≥ 攻击均值时弱怪完全失效化
    （皮甲+0 对 1-3 伤小怪近似无敌），低档护甲的边际收益被严重高估；
  - 新模型护甲价值 = 命中率指数衰减，对强怪大幅变强（单击越大，旧减伤占比越小），对弱怪相对变弱
    （不再有钳 1 免伤）。
- **综合受伤量与死亡**：板甲两档 wired 明显更优（累计受伤 184→140、183→118；死亡持平或更低）；
  皮甲+0 wired 每击伤害反而更高（0.77→1.38）、累计受伤略高（276→303）、死亡 4→7——**低级护甲对弱怪群
  的体验变差，重甲对强敌的体验变好**。这与 CE 模型的理论预期一致，方向合理，未做任何平衡性调参。
- **死亡次数的置信度说明**：每格死亡数为 0-7/20 的小样本，且 legacy/wired 轨迹因怪物游走的未播种
  `Math.random`（Monster.ts:291/482，既有事实）自由发散，死亡数字只作参考、不作方向性断言。
- 运行间波动：同一代码重复捕获，聚合命中率可在 ~1.5-10.6 个百分点间漂移（无甲档两侧模型完全相同也如此），
  因此测试断言全部采用聚合统计阈值（阈值论证见测试文件内注释）。

---

## 6. 展示层引用排查（只查不改，作为后续任务）

全仓 `armorProtection` 引用为 0（已删净）。展示层有以下与护甲相关的**旧口径残留**：

1. **`src/engine/UI/DetailGenerator.ts:310-321`（generateItemDetail）**：物品详情面板的
   "实际护甲值"仍按旧乘法公式 `Math.round(item.armor * damageFraction(ne))` 计算展示。
   与新模型不符，应为 `armor + netEnchant`（显示值口径），建议后续任务改为"防御 X"。
2. **`src/engine/Core/Game.ts:1136-1146 与 1186-1197`**：调用 `generateMonsterDetail` 时把
   `player.equippedArmor?.armor ?? 0`（**原始显示值**，如皮甲 3）当作 `playerDefense` 参数传入，
   `DetailGenerator.ts:170` 用它算 `hitProbability(monAcc, playerDefense)` → 怪物详情里
   "该怪物有 X% 的概率命中你"长期按显示值算命中率（低估被命中概率）。属预先存在的接线错误，
   本次改动后与实战命中率偏差更大（实战已用 ×10+附魔标度）。函数签名里
   `_playerArmorBase/_playerArmorEnchant/_playerArmorStrReq` 三个下划线参数是未使用占位，可复用。
3. `src/components/InventoryOverlay.vue:102`：仅做已装备 id 高亮，无防御数学，无影响。

---

## 7. 与预设不符之处（只列不修）

1. **提示词引用的 CE 代码段省略了 `Items.c:8518` 的 `STATUS_DONNING` 扣减**
   （`enchant -= player.status[STATUS_DONNING] * FP_FACTOR`：护甲正在穿戴中时暂不计附魔）。
   引号内公式（8519 行）与源码逐字一致，仅未提 8518。web 引擎没有 donning 状态可对齐，未实现。
2. **CE 的 `player.info.defense` 是定点整数**：`(armor*FP + enchant*10)/FP` 整除截断（如 147.5→147）；
   web 按本文件既定 float 理想值口径保留小数（0.25 步进 → 内部值尾数 2.5）。差异 ≤0.05 显示点。
3. **CE `defenseFraction` 表以 0.25 显示点为步长截断索引**（`PowerTables.c:202` 整除），
   最大差 0.25 显示点（命中率差 ≤~0.6%）。此为 P0-1 既有口径（测试文件头已注明），非本次引入。
4. **"行为快照"测试的存在**提示词未提及（见 §4 边界说明）——它锁定的旧行为与本次决策冲突，
   必须一并处理，已按"落地为锁定新行为"处理并在此报备。
5. **旧公式在"力量恰好"时板甲+3 的减伤值是 13**（`round(11×1.065³)=13`）而非直觉的 14；
   对照表与测试注释均按实际计算值标注。
6. **`npm test` 计数**：基线 145 passed → 本次 150 passed = 145 − 1（删除旧乘法快照）+ 4（playerDefense
   新断言）+ 2（armor_model_effect）。`it.fails`（1 条 expected-fail）与 `it.todo`（7→6 条）各消化一条，
   均不再出现。

---

## 8. 验证输出

### npm test（完整输出尾部）

```
> brogue-web@0.0.0 test
> vitest run

 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  19 passed (19)
      Tests  150 passed | 6 todo (156)
   Start at  05:33:15
   Duration  12.05s (transform 1.45s, setup 0ms, import 2.42s, tests 22.65s, environment 4ms)
```

（基线 145 passed 不减反增：145 → 150，0 failed，0 expected-fail。）

### npm run build（输出尾部）

```
dist/assets/index-DZdWG5j0.css               16.93 kB │ gzip:   4.08 kB
dist/assets/Filter-0IueHGt4.js                0.90 kB │ gzip:   0.48 kB
dist/assets/BufferResource-DO8NPhjM.js       10.60 kB │ gzip:   2.79 kB
dist/assets/webworkerAll-RJgbUCjE.js         11.88 kB │ gzip:   3.94 kB
dist/assets/CanvasRenderer-CtIXNzIy.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-BWOAQdBD.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-D4JglD-z.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-DYOsmKVt.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-BQtq8dsg.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-aqBaN-aJ.js               877.03 kB │ gzip: 277.02 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.34s
```

（chunk 体积警告为项目原有，非本次引入；vue-tsc 类型检查通过——注意 vue-tsc 会连 src/test 一起检查。）

### git diff --stat

```
 brogue-web/src/engine/Combat/Combat.ts             | 23 +++----
 brogue-web/src/engine/Combat/CombatFormulas.test.ts | 80 ++++++++++++++++------
 brogue-web/src/engine/Combat/CombatFormulas.ts     | 25 +++++--
 3 files changed, 85 insertions(+), 43 deletions(-)
```

新增文件（未跟踪）：`src/test/armor_model_effect.test.ts`、`ai_docs/armor_model_report.md`。
未执行任何 git commit/add/push/reset/checkout；未触碰禁区文件（Game.ts、Monster.ts、Player.ts、
Item.ts、ItemLoader.ts、DetailGenerator.ts、Architect.ts、Gas.ts、Bolt.ts、src/data/*.json 均未改动）。
