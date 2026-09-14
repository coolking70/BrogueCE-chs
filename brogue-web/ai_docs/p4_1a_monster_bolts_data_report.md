# P4-1a：怪物远程法术（bolts）数据接入 monsters.json

## 任务边界回顾

本轮只做数据合并：把 CE `monsterCatalog` 的 `bolts[20]` 字段值搬进
`src/data/monsters.json` 的新字段 `bolts`。不改任何行为、不新增
`BoltEffect` 枚举项、不实现施法逻辑（留给 P4-1b）。

- 修改：`src/data/monsters.json`（仅新增 `bolts` 字段）
- 新增：`scripts/extract_monster_bolts.cjs`、`src/data/monsterBolts.test.ts`、本报告
- 未触碰：`Bolt.ts` / `Monster.ts` / `Game.ts` / `src/test/fixtures/*.json` / 任何已有 `.test.ts`
- 未执行任何 `git commit/add/push/reset/checkout`

---

## 一、独立提取结果 vs 提示词清单：逐条对照

提取方法：写 `scripts/extract_monster_bolts.cjs`，用花括号深度计数直接解析
`BrogueCE-master/src/brogue/Globals.c` 里 `creatureType monsterCatalog[]`
数组字面量（不是手抄，是程序化解析），跑 `--check` 模式核对。

**数量结论：25 只怪物、15 种 bolt —— 与提示词给出的数字一致。**

逐怪物比对（CE 源码原始顺序）：

| 怪物 | 提示词给出的 bolts | 我提取的 bolts（源码原始顺序） | 是否一致 |
|---|---|---|---|
| goblin mystic | SHIELDING | SHIELDING | 一致 |
| goblin totem | HASTE, SPARK | HASTE, SPARK | 一致 |
| arrow turret | DISTANCE_ATTACK | DISTANCE_ATTACK | 一致 |
| ogre totem | HEALING, SLOW_2 | HEALING, SLOW_2 | 一致 |
| spider | SPIDERWEB | SPIDERWEB | 一致 |
| spark turret | SPARK | SPARK | 一致 |
| ogre shaman | HASTE, SPARK | HASTE, SPARK | 一致 |
| dar blademaster | BLINKING | BLINKING | 一致 |
| **dar priestess** | HASTE, HEALING, NEGATION, SPARK | **NEGATION, HEALING, HASTE, SPARK** | **顺序不一致**（Globals.c:1088：`{BOLT_NEGATION, BOLT_HEALING, BOLT_HASTE, BOLT_SPARK}`）|
| **dar battlemage** | DISCORD, FIRE, SLOW_2 | **FIRE, SLOW_2, DISCORD** | **顺序不一致**（Globals.c:1090：`{BOLT_FIRE, BOLT_SLOW_2, BOLT_DISCORD}`）|
| centaur | DISTANCE_ATTACK | DISTANCE_ATTACK | 一致 |
| sentinel | HEALING, SPARK | HEALING, SPARK | 一致 |
| dart turret | POISON_DART | POISON_DART | 一致 |
| lich | FIRE | FIRE | 一致 |
| **pixie** | DISCORD, NEGATION, SLOW_2, SPARK | **NEGATION, SLOW_2, DISCORD, SPARK** | **顺序不一致**（Globals.c:1108：`{BOLT_NEGATION, BOLT_SLOW_2, BOLT_DISCORD, BOLT_SPARK}`）|
| flame turret | FIRE | FIRE | 一致 |
| imp | BLINKING | BLINKING | 一致 |
| dragon | DRAGONFIRE | DRAGONFIRE | 一致 |
| vampire | BLINKING, DISCORD | BLINKING, DISCORD | 一致 |
| flamedancer | FIRE | FIRE | 一致 |
| winged guardian | BLINKING | BLINKING | 一致 |
| mirrored totem | BECKONING | BECKONING | 一致 |
| unicorn | HEALING, SHIELDING | HEALING, SHIELDING | 一致 |
| ifrit | DISCORD | DISCORD | 一致 |
| mangrove dryad | ANCIENT_SPIRIT_VINES | ANCIENT_SPIRIT_VINES | 一致 |

**分歧只出在 3 只怪物的数组内部顺序**（dar priestess、dar battlemage、pixie），
内容（bolt 集合）完全一致，怪物清单和总数也完全一致。提示词特别强调过
"保留原始顺序"，所以这个分歧很重要——**已按我独立解析 CE 源码得到的顺序为准写入
monsters.json**，不是提示词给出的顺序。已用 `monsterBolts.test.ts` 对这三只怪物
做了顺序硬断言（含反向验证：断言顺序 `≠` 排序后的数组）。

---

## 二、CE bolt 名 → web BoltEffect 映射表

`BoltEffect` 枚举定义于 `src/engine/Combat/Bolt.ts:14-38`。

| CE boltType（去 `BOLT_` 前缀） | web BoltEffect | 说明 |
|---|---|---|
| SHIELDING | `SHIELDING` | 直接同名 |
| HASTE | `HASTE` | 直接同名 |
| SPARK | `SPARK` | 直接同名（"weaker fire used by some monsters"，Bolt.ts 注释已写明） |
| DISTANCE_ATTACK | `DISTANCE_ATTACK` | 直接同名 |
| HEALING | `HEALING` | 直接同名 |
| BLINKING | `BLINKING` | 直接同名 |
| NEGATION | `NEGATION` | 直接同名 |
| DISCORD | `DISCORD` | 直接同名 |
| POISON_DART | `POISON_DART` | 直接同名 |
| FIRE | `FIRE` | 直接同名 |
| DRAGONFIRE | `DRAGONFIRE` | 直接同名 |
| BECKONING | `BECKONING` | 直接同名 |
| **SLOW_2** | `SLOW`（别名，非直接同名） | 见下方核实结论 |
| **SPIDERWEB** | **无对应枚举项——缺口** | 见下方处理建议 |
| **ANCIENT_SPIRIT_VINES** | **无对应枚举项——缺口** | 见下方处理建议 |

### SLOW_2 → SLOW 的核实（提示词的判断得到 CE 源码印证）

`Rogue.h` 的 `enum boltType` 里 `BOLT_SLOW` 和 `BOLT_SLOW_2` 是两个独立的
enum 值，但两者在 boltCatalog（`src/variants/GlobalsBrogue.c`）里都填的是
**同一个 `boltEffect` 字段值 `BE_SLOW`**，只是强度（`power` 那一列）不同：

```
GlobalsBrogue.c:62: {"slowing spell", ..., BE_SLOW, 10, 0, 0, MONST_INANIMATE, (BF_TARGET_ENEMIES)},   // 强度 10
GlobalsBrogue.c:81: {"slowing spell", ..., BE_SLOW,  2, 0, 0, MONST_INANIMATE, (BF_TARGET_ENEMIES)},   // 强度 2
```

即 CE 里 `BOLT_SLOW` 与 `BOLT_SLOW_2` 是**同一种效果的两个强度变体**（分别是
`ogre_totem`/`dar_battlemage`/`pixie` 用弱化版 `BOLT_SLOW_2`，玩家的减速卷轴/法杖
用 `BOLT_SLOW`）。提示词"我判断应映射到 SLOW"的结论**得到源码印证，予以确认**。

### 两个缺口的处理建议（留给 P4-1b 决定，本轮不实现）

- **`SPIDERWEB`**（spider 专用）：CE 里 `boltEffect` 是 `BE_SPIDERWEB`，效果是在
  目标周围地面铺设蛛网地形（`spawnDungeonFeature`，非直接伤害/状态）。这与
  `Bolt.ts` 现有的"命中生物产生状态效果"模型不同，更接近"沿途/落点铺地形"，
  建议 P4-1b 新增 `BoltEffect.SPIDERWEB` 并复用/参照 web 已有的蛛网地形铺设逻辑
  （如果已有的话）来实现，而不是简单套用现有伤害或减益模板。
- **`ANCIENT_SPIRIT_VINES`**（mangrove dryad 专用）：CE 里 `boltEffect` 是
  `BE_ANCIENT_SPIRIT_VINES`，效果同样是铺设藤蔓地形并对目标造成缠绕。
  同样建议单独实现，而不是从现有枚举里"就近凑一个"（例如误用 `SPIDERWEB`
  代替）——两者地形/动画/状态效果在 CE 里是分开定义的。

**本轮不新增这两个枚举项，`monsterBolts.test.ts` 用 `KNOWN_GAP_BOLT_NAMES` 显式
把这两个名字登记为"已知缺口"并断言不允许出现第三类未知名字**，防止将来悄悄
引入一个既不在 BoltEffect 里、也没登记的新名字而不被发现。

---

## 三、字段形式与"无 bolts 怪物"的处理方式及理由

### 字段值形式：CE boltType 名去掉 `BOLT_` 前缀的字符串数组，保持源码原始顺序

例：`"bolts": ["NEGATION", "HEALING", "HASTE", "SPARK"]`（dar_priestess）。

理由：
1. **不做"是否映射到现有 BoltEffect"的预判断**。如果直接存映射后的 web
   `BoltEffect` 名字（如把 `SLOW_2` 存成 `"SLOW"`），就相当于在数据层
   替 P4-1b 做了"SLOW_2 归并到 SLOW"这个决定——这属于行为/平衡决策
   （两者强度不同），按边界要求本轮不该做。存 CE 原名保留了全部信息，
   P4-1b 再决定要不要归并、要不要按强度区分。
2. 去掉 `BOLT_` 前缀是纯字符串体操，不丢信息，且让 13/15 个值可以直接
   `BoltEffect[name]` 查到（只有 `SLOW_2`/`SPIDERWEB`/`ANCIENT_SPIRIT_VINES`
   三个需要显式处理），减少 P4-1b 的样板代码。
3. 不用整型/枚举下标，避免把两边枚举顺序绑死——`Bolt.ts` 的 `BoltEffect`
   数值以后可能变化，字符串对拼写、不对数值顺序敏感，更稳。

### 无 bolts 的怪物：写 `"bolts": []`，不省略字段

理由：
1. **与文件里已有约定一致**。`monsters.json` 的 `behaviorFlags` /
   `abilityFlags` 对没有该类标记的怪物也是写 `[]` 而不是省略字段
   （见 `rat`/`kobold` 等条目）。保持字段形状统一，不给这一个字段搞特例。
2. **减少 P4-1b 读取时的分支**。`Monster.ts` 以后大概率会写
   `for (const bolt of monster.bolts) {...}` 这类循环；数组恒定存在，
   不需要每次都写 `monster.bolts ?? []` 或 `if (monster.bolts)` 判空。
3. JSON 序列化后 `[]` 只占 2 字节，对 67 条数据的体积影响可忽略，
   换来的可预测性更值。

---

## 四、RNG 流验证结果

**本轮改动只是往 67 个 JSON 对象里各加一个字段，不改任何 TS 读取/生成逻辑**，
理论上不该移动 RNG 流。实测：

```
$ npx vitest run src/test/generation_baseline.test.ts
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

`generation_baseline.test.ts` 完整通过，**RNG 流未受影响**，与预期一致。

---

## 五、验收逐条对照

1. **`monsterBolts.test.ts`**：
   - 带 bolts 怪物数量（25）与源码提取一致 —— 通过。
   - 逐条硬断言 ≥ 8 只，含单/多 bolt、炮塔/施法者，注明 Globals.c 行号 ——
     实际写了 12 条硬断言（goblin_mystic / goblin_totem / arrow_turret /
     spider / spark_turret / dart_turret / dar_priestess / dar_battlemage /
     pixie / dragon / vampire / mangrove_dryad）—— 通过。
   - 顺序与 CE 一致（非排序后）—— 对 dar_priestess 与 pixie 做了
     "顺序等于源码顺序 且 不等于排序后数组" 的双重断言 —— 通过。
   - 所有 bolt 名要么映射到 BoltEffect，要么在已知缺口清单内，不出现
     第三类未知名字 —— 通过（含 SLOW_2→SLOW 别名的显式核实）。
2. **`generation_baseline.test.ts` 继续通过** —— 通过，见上一节。
3. **`npm test` 全绿，原有 288 passed 不减少** —— 实测 **306 passed**
   （288 + 本轮新增 18 条），无失败、无回归。完整输出尾部：

   ```
    Test Files  33 passed (33)
         Tests  306 passed | 7 skipped | 5 todo (318)
      Duration  13.86s
   ```

4. **`npm run build` 全绿** —— 实测：

   ```
   ✓ 785 modules transformed.
   ✓ built in 1.44s
   ```

   （有一条关于 chunk 体积 > 500kB 的既有构建警告，与本轮改动无关，
   本轮之前该警告已存在，纯 JSON 数据改动不会新增/改变 bundle 分块。）

### `git diff --stat`

```
 src/data/monsters.json | 265 ++++++++++++++++++++++++++++----------
 1 file changed, 198 insertions(+), 67 deletions(-)
```

（`scripts/extract_monster_bolts.cjs`、`src/data/monsterBolts.test.ts`、
本报告为新增未跟踪文件，未执行任何 git 操作。）

### 反向验证（§5.2 要求）

把 `dar_priestess` 的 `bolts` 人为排序成字母序
（`["HASTE","HEALING","NEGATION","SPARK"]`）后重跑
`monsterBolts.test.ts`，顺序断言按预期失败：

```
AssertionError: expected [ Array(4) ] to deeply equal [ Array(4) ]
- Expected
+ Received
  [
-   "NEGATION",
-   "HEALING",
    "HASTE",
+   "HEALING",
+   "NEGATION",
    "SPARK",
  ]
 ❯ src/data/monsterBolts.test.ts:85:23
```

随后重跑 `node scripts/extract_monster_bolts.cjs` 还原，测试恢复 18/18 通过，
`git diff --stat` 与还原前完全一致（198 insertions / 67 deletions）。

---

## 六、与预设不符之处（只列不修）

- **提示词给出的 3 只怪物（dar priestess / dar battlemage / pixie）的
  bolts 数组内部顺序与 CE 源码实际顺序不一致**（详见第一节表格）。
  已以 CE 源码为准写入数据并在测试里硬断言正确顺序，未按提示词给出的顺序写入。
  这三处分歧不影响"25 只怪物 / 15 种 bolt"的总量结论。
- 其余提示词内容（结构体字段位置、20 元素数组、15 种 bolt、缺 2 种
  BoltEffect、SLOW_2→SLOW 判断）经核实均与 CE 源码一致，无需反驳。

---

## 总结

独立从 CE 源码提取到 **25 只怪物、15 种 bolt**，与提示词给出的数量一致；
内容集合完全一致，但 **dar priestess / dar battlemage / pixie 三只怪物的
数组内部顺序与提示词不同**，已按 CE 源码实际顺序（程序化解析得出）写入
`monsters.json` 并在测试里硬断言。映射缺口确认为 2 个：`SPIDERWEB`
（spider）与 `ANCIENT_SPIRIT_VINES`（mangrove dryad），两者在 CE 里都是
"铺设地形+缠绕/结网"类效果，建议 P4-1b 单独实现而非复用现有枚举硬凑。
`SLOW_2`→`SLOW` 的映射判断经源码核实成立（两者共用 `BE_SLOW`，仅强度不同）。
测试从 288 增至 306（新增 18 条，含 1 条数量断言、12 条硬断言、3 条顺序/映射
断言、1 条空数组抽样断言、1 条汇总断言），`npm test` 与 `npm run build`
均全绿，`generation_baseline.test.ts` 确认 RNG 流未受影响。
