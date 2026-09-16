# F-2b：生物燃烧状态机 + 火免通道修复（F-0 §5.3 的第 4、5 条）

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**（`status`/`diff`/`log` 只读允许）。

**授权反驳条款有效**：CE 源码优先。你在前几轮连续纠正并改进过验收方——
F-0 重排整条 F/G 链的拆法、F-1 拒绝照抄 `promoteChance=500`、
**F-2a 指出"把 `igniteForced` 改成 `alwaysIgnite`"照字面执行会让禁改文件 `p4_4`
翻红且方向偏离 CE**，并揪出"新火格若不在晋升趟之前排干会当块即衰老"。
**请继续，包括反驳本任务书。**

**先读**：`ai_docs/f_0_fire_gas_survey.md` §5.3（尤其第 4、5 条）、
`ai_docs/f_2a_fire_mechanics_report.md`（尤其 §五行为变化登记与 §六 的细化）。
凡本任务书与它们冲突，**以实测为准并在报告里指出**。

---

## 一、本轮做什么

### 1. 生物燃烧：从"站在火格上扣血"改成 CE 的状态机（§5.3-4）

**web 现状**：`Game.ts:6245` —— 站在燃烧格上每回合固定扣 2，**没有"着火了"这个状态**。
离开火格伤害立刻停止。

**CE**：着火是**生物自身的状态**（`STATUS_BURNING`），核心在
`Time.c:28 exposeCreatureToFire`（**请自己打开读完，别信我的转述**）。
我只给线索，具体数值与分支自己抠：
- 免疫/豁免的几个前置条件（含潜水、悬浮与 `TM_EXTINGUISHES_FIRE` 的交互——
  **注意那个条件里有个 `!levitating` 的括号，很容易读错**）；
- 状态时长的设定方式（`max(..., 7)` 那一行的语义是"刷新而非叠加"，请确认）；
- 每回合的伤害、以及**着火的生物会点燃它所踩的地形**（这条在别处，自己找）；
- 灭火：`TM_EXTINGUISHES_FIRE`（web 的浅水/深水应当对应，自己核对目录）。

**★ 先做载体盘点**（`SESSION_HANDOFF.md`「这一轮做了会不会是空壳？」）：
web 今天有没有潜水（`MB_SUBMERGED` 等价物）、悬浮、`MONST_INVULNERABLE`？
**有的接上，没有的登记不实现**，别为此去改 `entities/`（禁改）。

### 2. 火免通道修复（§5.3-5，即路线图 P1-44）

**抗火药水什么也没做**，验收方已复核确认三重错位：
- `Game.ts:2876` 写 `grantTemporaryImmunity('burning' as any, 50)`
  ——`'burning'` 在 `StatusId` 联合类型里**根本不存在**（`Creature.ts:9`，实查 0 处；
  `as any` 是自认）；
- `temporaryImmunities` **全库唯一读者**是 `applyMonsterOnHitStatus`
  （`Game.ts:4199`，只拦怪物命中施加的状态）；
- 火焰伤害查的是 `hasStatus('immune_fire')`（`Game.ts:2749/6089/6245`）。

同样的毛病在 `Game.ts:4546` 重复了一次（4547 的 `'confused'` 倒是合法键）。

**要修到"喝了药水站进火里真的不掉血"**，并写测试钉死。
顺带核对 CE 的火免还包含什么（怪物旗标派生、潜水、灭火层），
web 有对应物的接上，没有的登记。

---

## 二、明确不做（写显式留痕测试）

- **不碰气体的任何东西**（§5.3 第 6/7/8/9/10/11 条）——归 G-1 / G-2。
  气体六条曲线是本轮的**反向哨兵**，必须逐位不变。
- **不做爆炸**（§5.3-12，`GAS_EXPLOSION`）——归 F-2c。
- **不改火焰蔓延与寿命参数**（F-2a 刚定的 4 邻 / `chanceToIgnite` / `promoteChance` 500 /
  EMBERS→ASH）——本轮只动"生物侧"。
- 不碰 `creeping_death` 幽灵气（P1-45，归 G-1）。

---

## 三、文件边界（硬约束）

**允许修改**：
- `src/engine/Core/Game.ts`
- `src/engine/Status/statusConfig.ts`（新增 `burning` 状态定义）
- `src/engine/Map/TerrainCatalog.ts`（**仅**在灭火需要补 `TM_EXTINGUISHES_FIRE` 时）
- `src/engine/Map/Promotion.ts` / `DungeonFeature.ts`（**仅**为"着火生物点燃所踩地形"接线）
- `src/engine/Environment/Gas.ts`（**仅**火侧入口，气体本体不许动）
- `src/locales/zh_CN.json`（仅增键；新文案必须走 i18n，不许硬编码英文）
- **以下既有测试，限于"本轮必然到期的断言"**（提前授权，不要为此停下）：
  - `src/test/f_1_fire_as_terrain.test.ts`、`src/test/f_2a_fire_mechanics.test.ts`
    （固定 2 伤害的红线本轮到期）
  - `src/test/p1_24_death_sink.test.ts`、`src/test/p1_28_flag_channel.test.ts`
  - `src/test/c_4a_terrain_catalog.test.ts`（若补了 `TM_EXTINGUISHES_FIRE`）
  - `src/test/c_4a_0_layer_model.test.ts`（**若新增任何地形**——两张 `toEqual`
    是穷尽式全量表，加地形必打红）
  - `src/test/c_4b_dungeon_feature.test.ts`（若新增 DF 或新增符号引用）
  **限定**：只改因本轮行为变化而到期的断言，**不许放宽守卫性质**
  （穷尽式 `toEqual` 仍要穷尽、阈值不许松）。逐条写进报告。
- 新增测试文件

**禁止修改**（违反即本轮作废）：
- **`src/entities/`**（`Creature.ts` / `Player.ts` / `Monster.ts`）——
  若你判断"必须改 `StatusId` 联合类型才能修 P1-44"，**停下来在报告里论证**
  并给出替代方案；不要擅自动
- `src/engine/Map/` 下其余既有文件、`src/engine/Generator/`、`src/components/`
- **`BrogueCE-master/` 下任何文件**
- 任何 `src/data/*.json`、`src/engine/Random.ts`、`vite.config.ts`
- **`src/test/fixtures/*`**、`src/test/harness.ts`
- 上面未列出的任何既有测试文件

> ⚠️ `StatusId` 在 `src/entities/Creature.ts:9`，而它在禁改清单里。
> 这是本轮**预期会撞上的一处**——任务书故意没有预先放行，
> 因为改公共类型联合的影响面需要你先论证。**按规矩停下来申报。**

---

## 四、门禁

1. **反向哨兵——气体六条曲线逐位不变**（含 POISON ≡ CONFUSION 恒等式）。
   从 F-0 附录 A 恢复探针复跑；变了就是漏改，**停下来报告**。
2. **火的蔓延/寿命曲线应与 F-2a 报告 §一的新曲线一致**
   （本轮不动那些参数）。有偏差要解释。
3. **新行为的实测**：着火持续回合数分布、离开火格后是否仍在烧、
   进水是否灭火、喝抗火药水后站火里的掉血量（应为 0）。
4. `generation_baseline` 应仍绿；坏层闸门 `p1_26`/`p1_29`/`p1_33` 仍为 0。
5. `npm run build` 绿；`npm test` 全绿。

**全量门禁用 `npx vitest run --fileParallelism=false`**（串行）。
并行时重型测试会集体假红（全是 `Test timed out`、零断言失败）。

---

## 五、测试要求

1. 每条断言必须能在某个具体的错误实现下失败。
2. **对抗性测试至少七条**，必须含：
   - 离开火格后燃烧立刻停止（状态没真正挂上）
   - 状态时长写成叠加而非刷新
   - `TM_EXTINGUISHES_FIRE` 灭火失效（站水里还在烧）
   - 悬浮/潜水的豁免条件写反（那个 `!levitating` 括号）
   - **抗火药水仍然无效**（P1-44 回归哨兵）
   - 着火生物不点燃所踩地形（若本轮实现了该条）
   - 气体行为被本轮意外改动（回归哨兵）
3. **反向验证（强制）**：至少四条真的改坏、贴真实失败输出、还原。

---

## 六、交付

报告写入 `ai_docs/f_2b_creature_burning_report.md`，必须含：
- `exposeCreatureToFire` 与相关函数的 CE 行号与你复核出的实现要点
  （特别是那个 `!levitating` 括号的正确读法）；
- **载体盘点表**：潜水/悬浮/无敌/灭火层在 web 有没有对应物，接了没接、为什么；
- P1-44 的修复方式；若需要动 `StatusId` 则是**论证 + 申报**而不是擅自动手；
- §四门禁 1-5 的逐条实测输出（气体哨兵要贴出曲线对比）；
- 改了哪些既有测试断言、逐条说明为什么到期、守卫性质未放宽的论证；
- 对抗性测试与反向验证的真实失败输出；
- 给 F-2c / G-1 的登记清单。

**已知陷阱**：深水枚举成员是 `WATER_DEEP` 不是 `DEEP_WATER`，写错**不报错**
（vitest 走 esbuild 只剥类型不检查）。**任何让人困惑的失败，先跑 `npm run build`。**

**留痕规矩**：遇到留痕与文件边界冲突，**停下来申报**，
**不要把代码扭曲成扫描正则看不见的形态**——那是自造假绿。
