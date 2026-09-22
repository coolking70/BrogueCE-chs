# W-0 勘察：杖与魔杖子系统

> **本地执行（`codex exec --worktree`）。只读勘察 + 出方案，不改生产代码。**

## 0. 为什么先勘察：**验收方在这块连错三次**

今天验收方三次用粗 grep 估算这个子系统，**三次都错**：

| 说法 | 实测 | 错因 |
|---|---|---|
| "`BE_*` 射线效果 15/28，缺 13 种" | 错 | grep 的是**注释里引用 CE 的 `BE_*` 字符串**，而 web 用自己的 `BoltEffect` 枚举 |
| "`POISON`/`TELEPORT`/`CONJURATION`/`INVISIBILITY`/`EMPOWERMENT` 未实现" | **全部已实现** | 同上，`Game.ts:4297` 的 `applyBoltEffect` 里都有 case 分支 |
| "缺 13 种效果" | 实为 **6 种** | 修正后重数 |

⇒ **本轮的第一要务是拿到可信的对照表**，像 `bp-mapping` 轮对蓝图做的那样。
**不要相信本任务书里的任何数字，逐条自己核。**

## 1. 要产出的三张表

### 1.1 CE 杖/魔杖 ↔ web 物品对照

CE：`GlobalsBrogue.c` 的 `staffTable_Brogue` 与 `wandTable_Brogue`（自行定位）。
web：`src/data/arcana.json` 的 `staffs`（7）与 `wands`（7）。

⚠️ web 的 `wand_of_fire` / `wand_of_lightning` / `staff_of_light` 据
`invented_content_pool.test.ts` 头注是**自创**（CE 的火/闪电是 staff 不是 wand；
staffTable 无 light）。**核实该登记是否仍成立**，并注明它们当前是否已退池。

逐条给：CE 名 / CE 行号 / web id（或"缺"）/ frequency / 是否自创。

### 1.2 CE `BE_*` ↔ web `BoltEffect` 对照

CE：`Rogue.h` 的 `BE_*` 枚举（验收方数得 28，**请复核**）。
web：`src/engine/Combat/Bolt.ts:30` 的 `BoltEffect`（24 个成员含 NONE）。

⚠️ **两套枚举不是一一对应**：web 把 CE 的泛化 `BE_DAMAGE` 拆成了
`FIRE` / `LIGHTNING` / `SPARK` / `DRAGONFIRE` / `DISTANCE_ATTACK` / `POISON_DART`
等带类型的变体。**对照时要按语义而非名字**，并说明这种拆分是否造成行为偏差。

每条给：CE `BE_*` / web 枚举成员（或"无"）/ **`Game.ts` 里是否有 case 分支** /
消费它的 CE 物品或怪物。

**验收方初测的六个缺口（请复核）**：
- 枚举有、`Game.ts` 零引用：`DOMINATION`、`ENTRANCEMENT`、`BLINKING`、`OBSTRUCTION`
- 枚举都没有：`POLYMORPH`、`PLENTY`
- 另需判定：`SWAPPED`、`ENCHANTED`、`IDENTIFIED`、`DETECTED`、`BRIDGED`、`TRAP_FREE`
  这六个 CE `BE_*` 是不是杖/魔杖用的（可能属卷轴或其他路径），**别当成本链欠账**

### 1.3 机制前置盘点

`BoltConfig`（`Bolt.ts:59`）当前字段：
`id / name / effect / magnitude / char / color / maxRange / piercing / selfTargeting`

CE `bolt` 结构（`Rogue.h:1862`）：
`name / description / abilityDescription / theChar / foreColor / backColor /
boltEffect / magnitude / **pathDF** / **targetDF** / forbiddenMonsterFlags / flags`

**逐项判定 web 缺什么、缺的是否阻塞某个效果**。验收方已看出两处，请复核并补全：

1. **`pathDF` / `targetDF` 缺失** —— CE 靠它沿路径/在落点铺地形。
   `Bolt.ts:128` 有一条头注自陈"CE 里是 BE_NONE + 铺地形（spawnDungeonFeature），
   web 的 BoltEffect 无对应"。**这是否就是 `OBSTRUCTION` 的前置？**
2. **`selfTargeting`** 字段存在且注释写着 "(e.g. blinking)"，但 `BLINKING` 零实现。
   **移动施法者本身需要什么？路径提前中止？**
3. `forbiddenMonsterFlags`（CE 的 `MONST_IMMOBILE` / `MONST_INANIMATE` 等）web 有没有？
4. **`magnitude` 口径**：web 的值是自创常数（fire 5 / lightning 8 / staff lightning 10…），
   CE 的杖威力来自**附魔等级**。回 CE 查实际公式
   （`Items.c` 的 `staffDamage` / `staffTable[].power` 一类），判定这是留形还是缺陷。

## 2. 要产出的方案

按"机制前置 → 效果 → 物品"的依赖顺序，提出**分轮方案**，每轮给：

- 范围（哪些效果 / 哪些物品）
- 是否移动生成流（加物品种类会动抽签；纯效果实现不会）
- 前置依赖（例如 OBSTRUCTION 必须在 `targetDF` 之后）
- 预估撞红面（哪些既有测试会撞）

⚠️ **验收方今天的教训**：**爆炸半径大就拆**。9e 因为 21 条蓝图同时改选址而拆成
9e-1/9e-2；9b 没拆，走了三次派发。**你判断该拆几轮就拆几轮，不要迁就
验收方可能的预期。**

⚠️ 另一条：**授权清单要从改动的生产文件反查引用它的测试**，不要凭印象。
方案里请对每轮给出**反查方法**（例如改 `Bolt.ts` 就
`grep -l "BoltEffect\|getBoltConfigs" src/test/*.test.ts src/data/*.test.ts`）。

## 3. 本轮**不做**

- ❌ 不改任何生产代码、不改 `arcana.json`
- ❌ 不新建守卫（方案里建议即可）
- ✅ 允许写一次性探针脚本来取数，**但交付前删除**（临时文件一律 `zz_` 开头）

**自检**：交付后 `git status` 必须只有报告一个新文件。

## 4. 门禁

只需 `npm run build`（确认没碰坏任何东西）。不必跑测试。
⚠️ **不要跑不带参数的全量 `npx vitest run`**。

## 5. 报告

写到 `ai_docs/reports/w-0-survey.report.md`，含：

1. **§1.1 物品对照表**
2. **§1.2 效果对照表**（含"`Game.ts` 有无 case 分支"一列）
3. **§1.3 机制前置盘点**，特别是 `magnitude` 口径的 CE 依据
4. **§2 分轮方案**（本轮最重要的产物）
5. **验收方三处错误的纠正**：正确的数字是多少，以及我错在哪
6. §3 自检：`git status` 是否干净

## 6. 授权反驳

**本任务书里的每个数字都可能是错的**——验收方今天在这个子系统上连错三次。
CE 行号、枚举数目、"六个缺口"、"哪些是自创"，**全部以你实测为准并指出错处**。

你已连续七轮纠正验收方（9c 闪电触发源、9d 孤儿标记与 addLoops 负值 cost、
映射轮 `DEEPEST_LEVEL=40`、B1「建成 0 台≠无影响」、B2 四处驳回、
9e-1 五处 CE 细节、9e-1 补完轮两条成因、9e-2「桥是唯一通路」）——**继续**。
