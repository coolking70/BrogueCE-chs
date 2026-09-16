# F-2a：放开 CE 的火焰蔓延与寿命模型（**真改玩法**）

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**（`status`/`diff`/`log` 只读允许）。

**授权反驳条款有效**：CE 源码优先。你在前几轮连续纠正并改进过验收方——
F-0 反驳并重排了整条 F/G 链的拆法（四条全采纳）、F-1 拒绝照抄 CE 的
`promoteChance=500` 并说明了理由（采纳）。**请继续，包括反驳本任务书的范围划分。**

**先读三份文档**，本任务书只定范围与门禁：
- `ai_docs/f_0_fire_gas_survey.md` —— 尤其 **§5.3 的 12 条"两边都有但规则不同"**；
- `ai_docs/f_1_fire_as_terrain_report.md` —— 尤其 **§七 的翻正清单**；
- `ai_docs/fire_gas_architecture_note.md` —— 路线与拆法。

凡本任务书与上面三份冲突，**以它们的实测为准并在报告里指出**。

---

## 一、本轮的定位：门禁换了

F-1 只改存储形态，所以能拿"行为逐位不变"当门禁。**F-2a 是要真改玩法的**——
火烧得更慢、蔓延得更慢、烧完变余烬而不是焦土。
**F-0 的那些基线曲线本轮必然全变，这是预期，不是回归。**

判据换成：**每一条变化都要有 CE 出处 + 变化前后的实测对比**。
不许出现"顺手改了但没量"的东西。

---

## 二、范围：F-0 §5.3 的第 1、2、3 条

### 1. 蔓延判定（§5.3-1）

| | CE | web 现状 |
|---|---|---|
| 邻居 | **4 邻** | 8 邻 |
| 概率 | 每个可燃地形自己的 `chanceToIgnite`（15–100） | 固定 40% |
| 封顶 | 每格每回合 12 次暴露封顶 | 无 |
| 直燃 | `alwaysIgnite` 旁路 | `igniteForced` 语义不同（F-1 §七.1 已登记） |

`TerrainCatalog` 里的 `chanceToIgnite` 是 C-4a 从 CE 抄来的，**数据已经在了**。

### 2. 火的寿命（§5.3-2）

CE 靠 `promoteChance` 概率衰老（PLAIN_FIRE 是 500 = 5%/回合，几何分布，
平均约 20 回合），web 是 `burnDuration` 4–7 的硬倒计时。

**F-1 的翻正位已经备好**：`TerrainCatalog` 的 `PLAIN_FIRE.promoteChance`
0 → 500，`c_4a` 钉死块里有对应断言。
接上后由 **C-4c 的每回合两趟驱动**自然驱动——那条链已经跑了两轮没有真正的消费者，
**本轮是它第一个火侧消费者**。

⚠️ **C-4b 查明的隐含约定**：`spawnMapDF` 不检查"已标记"，
`probDec = 0` 的非 GAS 输入会**无限震荡**。新增/合成任何 DF 条目务必守住
`probDec > 0` 并写断言钉死。

### 3. 烧完的产物（§5.3-3）

CE 烧完是 `EMBERS` / `OBSIDIAN` / 消失 / DF 链；web 一律 `CHARRED_FLOOR`。

**★ 先做载体盘点，再决定做哪几条** —— 这是本项目的硬规矩
（`SESSION_HANDOFF.md`「这一轮做了会不会是空壳？」）。
验收方粗看 web 现有地形的 `fireType` 落点是：`DF_PLAIN_FIRE`（多数）、
`DF_EMBERS`（DOOR）、`DF_STEAM_ACCUMULATION`（浅水/深水）、`DF_OBSIDIAN`（岩浆）、
`DF_TRAMPLED_FOLIAGE`（灌木）。**但这是我粗看的，请你自己盘点并给出表**，
然后**只做今天有载体的那几条**，其余登记。

- **桥塌**（`T_AUTO_DESCENT` 相关）依赖坠落子系统（C-5），**本轮不做**；
- **冰融**在 web 没有 ICE 地形，**本轮不做**；
- **蒸汽**是气体侧（§5.3-9），**本轮不做**，归 G 链。

### 4. F-1 交接的三条翻正（§七.7）

- `PLAIN_FIRE.promoteChance` 0 → 500；
- `DF_PLAIN_FIRE.tile` null → `PLAIN_FIRE`，并从 `DF_MISSING_TILES` 摘除；
- `igniteForced` 语义改为 CE 的 `alwaysIgnite`（沿弹道直燃），
  F-1 §七.1 说 overlay 约定会随之自然消解——**请验证这个预测**。

以及 F-1 登记的 **`T_OBSTRUCTS_SURFACE_EFFECTS` 守卫缺失**：
CE 的火 DF 落不进楼梯/祭坛。F-1 说"接 `fillSpawnMap` 路径时免费获得该守卫"
——**本轮正是接它的时候，请确认该预测成立并写测试**。

---

## 三、明确不做（写显式留痕测试）

- **生物燃烧状态机**（§5.3-4：CE 是 7 回合 1-3 伤、可被水扑灭、会点燃所踩地形）
  与**火免修复**（§5.3-5，即 P1-44 抗火药水断线）——归 **F-2b**。
  本轮 `Game.ts:6198` 的固定 2 伤害**保持不动**。
- **爆炸**（§5.3-12，`GAS_EXPLOSION`，P4-4 登记的缺口）——需要气体侧，归 F-2c 或 G 之后。
- **气体的一切**（§5.3 第 6/7/8/9/10/11 条）——归 G-1 / G-2。
- 不碰 `creeping_death` 幽灵气（P1-45，归 G-1）。

---

## 四、文件边界（硬约束）

**允许修改**：
- `src/engine/Map/Grid.ts`、`TerrainCatalog.ts`、`DungeonFeatureCatalog.ts`、
  `DungeonFeature.ts`、`Promotion.ts`
- `src/engine/Environment/Gas.ts`（燃烧状态机本体）
- `src/engine/Core/Game.ts`
- `src/locales/zh_CN.json`（仅增键；新文案必须走 i18n）
- **以下既有测试，均限于"本轮必然到期的留痕/断言"**——
  **这次提前授权，不要再为此停下来**（同类冲突已 8 起，其中 3 起是
  验收方写任务书时漏授权）：
  - `src/test/c_4b_dungeon_feature.test.ts`（`DF_PLAIN_FIRE` tile 翻正——
    F-1 §七.7 明确点名要在本轮授权）
  - `src/test/c_4a_terrain_catalog.test.ts`（`promoteChance` 钉死块）
  - `src/test/c_4a_0_layer_model.test.ts`（**新增地形必然打红那两张 `toEqual`
    全量表**——F-1 那轮就栽在这，两张表是穷尽式，加地形就要加行）
  - `src/test/f_1_fire_as_terrain.test.ts`（它的红线断言本轮到期，
    如 `EMBERS === undefined`、固定 2 伤害）
  - `src/test/c_4c_promotion.test.ts`（晋升驱动第一次有火侧消费者）
  - `src/test/p1_24_death_sink.test.ts`、`src/test/p1_28_flag_channel.test.ts`
  **限定**：只改因本轮行为变化而到期的断言，**不许放宽守卫性质**
  （穷尽式 `toEqual` 仍要穷尽、阈值不许松）。改了哪条、为什么，逐条写进报告。
- 新增测试文件

**禁止修改**（违反即本轮作废）：
- `src/engine/Map/` 下其余既有文件（LakeSystem / LoopMap / SafetyMap /
  WaypointMap / Scent / Connectivity / Pathfinding / Pathfind / Color）
- `src/engine/Generator/` 下任何文件、`src/entities/`、`src/components/`
- **`BrogueCE-master/` 下任何文件**
- 任何 `src/data/*.json`、`src/engine/Random.ts`、`vite.config.ts`
- **`src/test/fixtures/*`**、`src/test/harness.ts`
- 上面未列出的任何既有测试文件

---

## 五、★ 门禁：实测影响报告

**F-0 的基线曲线本轮必然全变。** 所以门禁不是"逐位不变"，而是：

1. **从 F-0 附录 A 原样恢复探针复跑**，给出**新曲线 vs F-0 旧曲线**的对照表，
   并逐条解释每个变化对应 CE 的哪条规则。特别地：
   - 燃烧曲线的峰值、半径、全熄回合（F-0 记的是三条曲线全熄回合都是 12）；
   - **CE 的 PLAIN_FIRE 平均烧约 20 回合（几何分布）**——实测均值应当明显长于 4-7，
     若不是，说明 promoteChance 没真正接上；
   - 伤害序列（本轮 §三 不改，应当仍是固定 2/回合）；
   - **气体六条曲线应当不变**（本轮不碰气体）——变了就是漏改。
2. **蔓延速率对比**：同一起点，改前 40%/8 邻 vs 改后 `chanceToIgnite`/4 邻，
   给出火势规模与扩散速度的实测差。
3. **载体盘点表**（§二.3）：哪几条 fireType 链今天有载体、各做了没有、为什么。
4. **决定性复验**：同种子同操作序列两遍全等。
5. `generation_baseline` 应当仍绿（火是回合期的事）；变红即**停下来报告**。
6. 坏层闸门 `p1_26` / `p1_29` / `p1_33` 仍为 0。
7. `npm run build` 绿；`npm test` 全绿。

**全量门禁请用 `npx vitest run --fileParallelism=false`**（串行）。
并行时重型测试会集体假红（全是 `Test timed out`、零断言失败）。

---

## 六、测试要求

1. 每条断言必须能在某个具体的错误实现下失败。
2. **对抗性测试至少八条**，必须含：
   - 蔓延仍用 8 邻 / 仍用固定 40%
   - 12 次暴露封顶漏掉
   - `promoteChance` 没接上（火仍按 burnDuration 硬倒计时）
   - 烧完产物写错（该变 EMBERS 的变了 CHARRED_FLOOR，或反之）
   - `T_OBSTRUCTS_SURFACE_EFFECTS` 守卫失效（火落进楼梯/祭坛）
   - 合成 DF 条目 `probDec = 0`（应被断言拦住而非死循环）
   - `alwaysIgnite` 旁路失效
   - 气体行为被本轮意外改动（回归哨兵）
3. **反向验证（强制）**：至少四条真的改坏、贴真实失败输出、还原。

---

## 七、交付

报告写入 `ai_docs/f_2a_fire_mechanics_report.md`，必须含：
- 每条行为变化的 **CE 出处行号 + 变化前后实测对比**；
- **§五.1 的新旧曲线对照表**（这是本轮的核心交付）；
- **§二.3 的载体盘点表**与"做了/没做/为什么"；
- F-1 两条预测的验证结果（`igniteForced` overlay 自然消解、
  `T_OBSTRUCTS_SURFACE_EFFECTS` 守卫免费获得）；
- 改了哪些既有测试断言、逐条说明为什么它到期、守卫性质未放宽的论证；
- 对抗性测试与反向验证的真实失败输出；
- 给 F-2b / F-2c / G-1 的登记清单。

**已知陷阱**：深水枚举成员是 `WATER_DEEP` 不是 `DEEP_WATER`，写错**不报错**
（vitest 走 esbuild 只剥类型不检查）。**任何让人困惑的失败，先跑 `npm run build`。**
