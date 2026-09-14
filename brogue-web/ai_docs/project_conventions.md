# 项目常识（每轮开发任务前置注入）

> **用途**：ZCode/GLM 每次调用都是全新会话，不继承上一轮的认知。
> 本文件收录**跨轮次稳定**的项目语义与约定，在每份任务提示词开头原样附上。
> 2026-09-14 建立，起因是 P1-1 轮次因未定义 `damage` 记法语义而漏报 43 处不符。
>
> **维护规则**：只收录"会被反复用到、且一旦误解就出错"的知识。
> 单轮任务的背景不要写进来。发现新的此类知识点时追加。

---

## 一、最容易误解的项目语义

### 1.1 `damage` 字段是掷骰记法，不是 min-max

`weapons.json` / `monsters.json` 的 `damage` 是字符串，由
`CombatSystem.parseDamageString`（`src/engine/Combat/Combat.ts`）解析：

    "XdY"    →  { min: X,     max: X * Y,     clumping: X }
    "XdY+Z"  →  { min: X + Z, max: X * Y + Z, clumping: X }

**`"2d4"` 表示 2~8，不是 2~4。**

CE 侧的 `damage` 是 `randomRange {min, max, clumpFactor}`，`{2,4,1}` 就是字面的 2~4。
把 CE 的 `{min,max}` 写成 `"MINdMAX"` 是**历史上真实发生过的错误**，
曾导致 43/67 只怪物伤害被放大平均 4.4 倍、最高 17 倍（dragon 25-1250 应为 25-50）。

**表达 CE 的 `{min, max}` 且 clumping=1 时，用 `"1dN+M"`**：
`N = max − min + 1`，`M = min − 1`。例：CE `{9,13}` → `"1d5+8"`。

> 比对 web 与 CE 的伤害时，**必须先用 `parseDamageString` 解析**，
> 不要对字符串做正则取数，也不要按字面把 `XdY` 读成 X~Y。

### 1.2 护甲值有两套标度

- CE 的 `armor` 字段是 **×10 定点**（leather = 30），显示值 = `armor/10 + enchant1`（`Items.c:1544`）
- web 的 `armors.json` 存的是**显示值**（leather = 3）
- CE 内部防御值 = `(显示值 + netEnchant) × 10`，`defenseFraction` 吃的就是这个标度

### 1.3 CE 的护甲不减伤

CE 全源码没有"护甲从伤害里扣点数"的实现。护甲只通过
`playerDefense()` → `hitProbability()` 降低被命中概率。

### 1.4 附魔一律走 `netEnchant`

武器/护甲的附魔效果、符文强度，都要用
`CombatFormulas.netEnchant(enchantment, strength, requiredStrength)`（含力量修正），
**不要直接用 `item.enchantment` 原始值**。

### 1.5 无甲不是"护甲值为 0 的护甲"

机械调用 `playerDefense(0, 0, 力量, 0)` 会因力量盈余产生**幻影防御**
（力量 12 → 防御 30）。实战对无甲**完全跳过**该公式。
任何复算防御值的地方都要复刻这个守卫。

---

## 二、i18n

- `src/locales/zh_CN.json` 用**扁平的带前缀键**：`"name.Golden Potion": "金色药水"`，
  不是嵌套结构。查找时用完整键名。
- `src/test/harness.ts` 的 headless 环境**故意用空 i18n 资源**，
  所有文案回退到 `defaultValue`。
  **在 harness 下看到英文是预期的 fallback，不是缺翻译的证据。**
  要验证实际显示，必须用真实 zh_CN 资源初始化 i18next。

---

## 三、CE 源码位置速查（这些曾被反复找错）

| 内容 | 位置 |
|---|---|
| `monsterCatalog` | `src/brogue/Globals.c:1025`（**不在** variants/GlobalsBrogue.c） |
| `weaponTable` | `src/brogue/Globals.c:1582` |
| `armorTable` | `src/brogue/Globals.c:1606` |
| `foodTable` | `src/brogue/Globals.c:1577` |
| `hordeCatalog_Brogue` | `src/variants/GlobalsBrogue.c:744`（**这个才在 variants**） |
| `creatureType` 结构体 | `src/brogue/Rogue.h:2172` |
| `hordeType` 结构体 | `src/brogue/Rogue.h:2235` |
| `itemTable` 结构体 | `src/brogue/Rogue.h:1424` |

常用常量：`FP_FACTOR = 65536`（`Rogue.h:99-101`）、`AMULET_LEVEL = 26`、
`DEEPEST_LEVEL = 40`（均在 `GlobalsBrogue.c:43-44`）、`TURNS_FOR_FULL_REGEN = 300`、
`STOMACH_SIZE = 2150`（`Rogue.h:1123-1127`）。

**CE 的 C 结构体初始化是位置参数，尾部字段可省略，省略即默认值 0。**
不要因为某条没写 flags 就跳过它，也不要把省略的字段序列化成 null。

---

## 四、确定性与 RNG

- **`Monster.ts`（约 291/293/482/484 行）与 `Creature.ts:24` 使用未播种的 `Math.random()`**。
  后果：同 seed 只保证**地图确定**，**玩法不确定**。
  统计类测试不能用严格相等断言受随机性影响的计数，要用比率区间。
- 任何改变随机数消耗顺序/次数的改动（新增抽取、改变池大小、调整发放顺序）
  都会**移动 RNG 流**，使同 seed 的地图与掉落改变。
  既有的地形指纹测试只比对"同一次运行内两次生成是否一致"，不受影响，
  但此前记录的基线表会失效——**改动若移动 RNG 流，必须在报告中说明**。

---

## 五、每轮任务的固定约定

### 5.1 边界

- 提示词会给出**允许修改**与**禁止触碰**的文件清单，一律严格遵守。
- 发现"该修但在边界外"的问题时：**只列入报告，不要动手**。
- **禁止执行** `git commit` / `add` / `push` / `reset` / `checkout`，改动一律留在工作区。
- 不要在仓库里创建临时文件；调试埋点用完必须移除并复核 diff。

### 5.2 测试要求

- 新增测试必须是**对抗性**的，不是确认性的：
  它要能在一个**具体的、合理的错误实现**下失败。
- 每轮至少做一次**反向验证**：人为把被测逻辑改坏，贴出测试失败的输出，然后还原。
  （历史教训：`dirs8` 方向数组漏了 `[1,1]` 却通过了"discord 生效"的测试。）
- 已有测试一律不得修改，除非提示词明确许可。

### 5.3 报告

每轮写一份 `ai_docs/<任务名>_report.md`，必须包含：

- `npm test` 与 `npm run build` 的**完整输出尾部**（不接受"已验证"的口头结论）
- `git diff --stat`
- 本轮验收条款的逐条对照
- **与预设不符之处（只列不修）** ——
  包括**提示词本身的任何错误**。这一节是刚需，不是客套。

### 5.4 授权反驳

提示词里给出的事实、行号、数字、校验和锚点，**都可能是错的**。

- 发现不符时**不要强行凑数**，如实报告你得到的结果并说明分歧出在哪里。
- 提示词的指令与 CE 源码冲突时，**以 CE 为准**，并在报告中说明。
- 提示词要求实现 CE 中不存在的机制时，**拒绝实现**并给出源码证据。

> 历史记录：这条口子被用过十余次，包括两次成功拒绝错误指令
> （CE 并无饥饿力量惩罚、Faint 不会失去回合）。若当时照做，
> 项目会一边宣称"对齐 CE"、一边凭空加进两个 CE 不存在的机制。

---

## 六、项目级决策（见 dev_roadmap_2026Q3.md 顶部）

- **D1**：平衡取舍一律按 CE，复刻期间不因手感调参，问题记录留二次开发。
- **D2**：web 自创内容保留代码，但不得出现在实际游戏中（从生成池移除，非删除）。
- **D3**：P2（tick 制时间系统）需方案评审后再动。
