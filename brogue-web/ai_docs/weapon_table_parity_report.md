# 武器/护甲表数值对齐 Brogue CE — 交付报告

日期：2026-09-14
范围：`src/data/weapons.json`、`src/data/armors.json` 数值对齐 + 新增 `src/data/weapons.test.ts`、`src/data/armors.test.ts`。
**未触碰**任何战斗逻辑文件（Combat.ts / CombatFormulas.ts / Game.ts / Item.ts / ItemLoader.ts / Monster.ts 等均未修改），未修改任何既有测试，未执行任何 git 写操作，改动全部留在工作区。

---

## 1. 验收输出

### npm test（尾部）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  6 passed (6)
      Tests  57 passed | 1 expected fail | 7 todo (65)
 Start at  01:07:12
 Duration  719ms (transform 407ms, setup 0ms, import 534ms, tests 544ms, environment 1ms)
```

- 基线为 `37 passed | 1 expected fail | 7 todo`（4 个测试文件）；现为 `57 passed`（6 个文件）。
- 新增 20 条 = weapons.test.ts 13 条（1 条结构 + 12 件武器）+ armors.test.ts 7 条（1 条结构 + 6 件护甲）。
- **原有 37 passed 全部保留**，`1 expected fail` 与 `7 todo` 与基线完全一致。

### npm run build（尾部）

```
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.44s
```

（vue-tsc 类型检查 + vite 构建通过；chunk 体积告警为改动前即存在的既有现象，与本次无关。）

---

## 2. git diff --stat

```
 brogue-web/ai_docs/dev_roadmap_2026Q3.md | 33 ++++++++++++++++++++
 brogue-web/src/data/armors.json          | 14 ++++-----
 brogue-web/src/data/weapons.json         | 53 +++++++++++++++++++-------------
 brogue-web/src/engine/Core/Game.ts       | 35 +++++++++++++++++++++
 brogue-web/src/engine/Items/Item.ts      |  3 ++
 5 files changed, 109 insertions(+), 29 deletions(-)
```

**归属说明（重要）**：工作区在本任务开始前就不是干净状态。以上 5 个文件中——

| 文件 | 归属 |
| --- | --- |
| `src/data/armors.json` | **本任务**（7 行改动 = 5 件护甲数值） |
| `src/data/weapons.json` | **本任务 + 先前会话**。dart 整条（含 `source` 注记）系先前会话加入、HEAD 中不存在；本任务在其上修改 12 件武器数值并更新 dart 注记 |
| `ai_docs/dev_roadmap_2026Q3.md`、`src/engine/Core/Game.ts`、`src/engine/Items/Item.ts` | 先前会话遗留，本任务未触碰 |

另新增（untracked）：`src/data/weapons.test.ts`、`src/data/armors.test.ts`、本报告。

---

## 3. 修改前后对照表

### 武器（str + damage 记法 + 解析值）

解析规则（`Combat.parseDamageString`）：`min = X+Z`，`max = X*Y+Z`，`clumping = X`。

| id | CE 行号 | str 前→后 | damage 前→后 | 解析 min/max 前 | 解析 min/max 后 | clumping 前→后 |
| --- | --- | --- | --- | --- | --- | --- |
| dagger | L1583 | 10→**12** | `1d4`→`1d2+2` | 1/4 | **3/4** | 1→1 |
| whip | L1587 | 10→**14** | `1d4`→`1d3+2` | 1/4 | **3/5** | 1→1 |
| spear | L1594 | 11→**13** | `2d3`→`1d2+3` | 2/6 | **4/5** | 2→**1** |
| rapier | L1588 | 11→**15** | `1d6`→`1d3+2` | 1/6 | **3/5** | 1→1 |
| sword | L1584 | 12→**14** | `2d4`→`1d3+6` | 2/8 | **7/9** | 2→**1** |
| mace | L1591 | 13→**16** | `2d5`→`1d5+15` | 2/10 | **16/20** | 2→**1** |
| axe | L1597 | 14→**15** | `2d5`→`1d3+6` | 2/10 | **7/9** | 2→**1** |
| flail | L1589 | 15→**17** | `3d4`→`1d7+8` | 3/12 | **9/15** | 3→**1** |
| halberd | —（CE 无此条） | 16（不动） | `3d4`（不动） | 3/12 | 3/12 | 3（不动） |
| broadsword | L1585 | 17→**19** | `3d5`→`1d9+13` | 3/15 | **14/22** | 3→**1** |
| war_pike | L1595 | 18→18（已对） | `3d5`→`1d5+10` | 3/15 | **11/15** | 3→**1** |
| war_hammer | L1592 | 19→**20** | `4d5`→`1d11+24` | 4/20 | **25/35** | 4→**1** |
| dart | L1600 | 10→10（已对） | `2d2`→`1d3+1` | 2/4 | 2/4（不变） | 2→**1** |

说明：min/max「前」值即旧记法的解析输出。旧记法普遍 min 偏低（如 mace 旧 `2d5` min=2 对 CE 16），且 X>1 使 clumping 偏离 CE 的 1；两者已一并修正。

### 护甲（str + armor；CE armorTable 为 ×10 定点，web 值 = CE 值 ÷ 10，见 Items.c:1544）

| id | CE 行号 | str 前→后 | armor 前→后（CE 定点值） |
| --- | --- | --- | --- |
| leather_armor | L1606 | 10→10（已对） | 3→3（已对，CE 30） |
| scale_mail | L1607 | 12→12（已对） | 5→**4**（CE 40） |
| chain_mail | L1608 | 13→13（已对） | 6→**5**（CE 50） |
| banded_mail | L1609 | 14→**15** | 7→7（已对，CE 70） |
| splint_mail | L1610 | 15→**17** | 8→**9**（CE 90） |
| plate_mail（= CE plate armor） | L1611 | 17→**19** | 10→**11**（CE 110） |

---

## 4. 每件武器 `1dN+M` 的推导验算

通式：CE `range={min,max,1}` → `N = max−min+1`，`M = min−1`，写 `"1dN+M"`；
验算恒等式：`min = 1+M`，`max = N+M`，`clumping = 1`。

| 武器 | CE range | N=max−min+1 | M=min−1 | 记法 | 验算 min=1+M | 验算 max=N+M | clumping |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dagger | {3,4,1} | 2 | 2 | `1d2+2` | 1+2=**3** ✓ | 2+2=**4** ✓ | 1 ✓ |
| sword | {7,9,1} | 3 | 6 | `1d3+6` | 1+6=**7** ✓ | 3+6=**9** ✓ | 1 ✓ |
| broadsword | {14,22,1} | 9 | 13 | `1d9+13` | 1+13=**14** ✓ | 9+13=**22** ✓ | 1 ✓ |
| whip | {3,5,1} | 3 | 2 | `1d3+2` | 1+2=**3** ✓ | 3+2=**5** ✓ | 1 ✓ |
| rapier | {3,5,1} | 3 | 2 | `1d3+2` | 1+2=**3** ✓ | 3+2=**5** ✓ | 1 ✓ |
| flail | {9,15,1} | 7 | 8 | `1d7+8` | 1+8=**9** ✓ | 7+8=**15** ✓ | 1 ✓ |
| mace | {16,20,1} | 5 | 15 | `1d5+15` | 1+15=**16** ✓ | 5+15=**20** ✓ | 1 ✓ |
| war hammer | {25,35,1} | 11 | 24 | `1d11+24` | 1+24=**25** ✓ | 11+24=**35** ✓ | 1 ✓ |
| spear | {4,5,1} | 2 | 3 | `1d2+3` | 1+3=**4** ✓ | 2+3=**5** ✓ | 1 ✓ |
| war pike | {11,15,1} | 5 | 10 | `1d5+10` | 1+10=**11** ✓ | 5+10=**15** ✓ | 1 ✓ |
| axe | {7,9,1} | 3 | 6 | `1d3+6` | 1+6=**7** ✓ | 3+6=**9** ✓ | 1 ✓ |
| dart | {2,4,1} | 3 | 1 | `1d3+1` | 1+1=**2** ✓ | 3+1=**4** ✓ | 1 ✓ |

clumping=1 时 CE 的伤害滚动为 [min,max] 均匀分布，`1dN+M` 在 `parseDamageString` 语义下（clumping 只取 X）与之严格等价。

---

## 5. 与预设不符之处（只列不修，由验收方判断）

1. **dart「已对，无需改」与「clumping 必须为 1」的验收标准冲突，已按验收标准修改。**
   提示词标注 dart `range={2,4,1} ← 已对，无需改`，但 web 旧值 `"2d2"` 经 `parseDamageString` 解析为 clumping=2，与 CE clumpFactor=1 不符，也不满足「对全部 12 件武器断言 clumping=1」的硬性验收条款。已改为 `1d3+1`（min/max 保持 2/4 不变，仅 clumping 2→1），并在 json 内 dart 的 `source` 注记中说明了理由。若验收方认定 dart 应维持 `2d2`，需同步放宽验收条款。

2. **「全部武器的 strengthRequired 偏低 1-4 点」不完全准确。**
   实测 war_pike（web 18 = CE 18）与 dart（web 10 = CE 10）偏差为 0，并非全部偏低；其余 10 件确实偏低 1–4 点。

3. **「伤害偏低 1.1~3.0 倍」基本吻合，但 dart 例外。**
   以旧/新均值比计：最低 spear ≈1.13、最高 mace = 3.0，与预设区间吻合；dart 新旧均值同为 3（比率 1.0，本次仅分布/clumping 归位）。

4. **web 表 13 条 ≠ 预设的「12 件」。**
   web 多一条 **halberd**（CE weaponTable 无对应条目，无权威值可断言，本任务未动其数值，测试中仅以结构条目说明）；同时 web **缺 CE L1598 的 war axe**（提示词给出了其权威值但未言明 web 缺失，本任务按「不新增」边界未处理）。CE L1601 incendiary dart、L1602 javelin 缺失与预设一致。

5. **符文触发率的传导前提在当前 web 代码中不成立（仅陈述，未改逻辑）。**
   提示词称「CE 的修正项是 `1 − min(0.99, 平均基础伤害/18)`，基础伤害错则公式必错」。实测 web 的 `runicWeaponChance`（CombatFormulas.ts）是近似式 `7 + enchant*4`（clamp [3,90]），**根本不消费基础伤害**；且 `Combat.attack` 中 `clumping` 硬编码为 1，`parseDamageString().clumping` 当前无调用方。即数据错误目前并不经由该公式显形；本次数据对齐仍是正确基线，供后续接入 CE 公式时直接受益。

6. **UI 展示侧有一处既有缺陷会被新记法放大（不在本任务边界，未修）。**
   `DetailGenerator.ts` 的本地 `parseDamage`（正则 `(\d+)d(\d+)`）不识别 `+Z` 后缀，物品详情面板的「基础伤害 lo~hi」对新记法会显示错（如 mace `1d5+15` 会显示 1~5，应为 16~20）。战斗滚动不受影响（走 `Combat.parseDamageString`，解析正确）。建议后续任务单独修复该展示函数。

---

## 6. 测试文件说明

- `src/data/weapons.test.ts`：12 件武器逐件断言 `strengthRequired`、`parseDamageString` 的 min/max/clumping（clumping 恒为 1），每条断言注释注明 Globals.c 行号；另有 1 条结构断言（12 个 CE id 齐全）。halberd、incendiary dart、javelin 的处理口径见文件头注释。
- `src/data/armors.test.ts`：6 件护甲逐件断言 `strengthRequired` 与 `armor`（含 CE 定点值 ÷10 的换算注释与 Globals.c 行号）；另有 1 条结构断言。
