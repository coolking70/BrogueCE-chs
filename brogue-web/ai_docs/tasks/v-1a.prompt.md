# V-1a：拆掉 `_random_good_` 直投（**独占轮，移动 RNG 流**）

## 0. 角色与授权反驳条款

你是**开发方**。本任务书由**验收方**撰写，验收方**会写错事实**。
凡本文引用的 CE 行号、结构、数值，都**必须打开 `BrogueCE-master/` 逐字核对**。
冲突时**以 CE 源码为准**，并在最终回复开 `## 对任务书的反驳` 一节写明。

**前一轮（V-0 勘察）推翻了验收方的整个分轮方案**，本轮的范围正是按 V-0 的结论重划的。
若你发现 V-0 的结论也有问题，**照样反驳**。

## 1. 背景与本轮定位

用户裁决：**还原 CE 的逻辑结构**，不接受"保留自创入口只改抽取方式"的做法
（原话：「我还是希望优先还原 CE 的逻辑结构，避免原创差异引起后续连锁反应」）。

V-0 勘察结论（详见 `ai_docs/v_0_survey.md`，**请先读它**）：
CE 是**三角色机器 + 递归接线**（奖励房 → `MF_BUILD_VESTIBULE` 递归生门厅 →
`MF_OUTSOURCE_ITEM_TO_MACHINE` 递归交守卫机器领养，子机器失败则父机器整体回滚），
web 是**单层平面结构**。完整对齐需三轮：

| 轮次 | 内容 |
|---|---|
| **V-1a（本轮）** | 拆直投：删 `_random_good_` 与 11 处引用；受影响蓝图删室内奖励 feature；`area_shrine` 改类别掩码 |
| V-1b | 引擎补机制：`MF_ALTERNATIVE`、抽签资格过滤、顶层配额 |
| V-2 | `blueprints.json` 按 CE 全表重写 |

**本轮只做 V-1a。** 看到 V-1b/V-2 该做的事 → **登记，不要顺手做**。

## 2. 要做的三件事

### 2.1 删除 `_random_good_`

`Game.ts` 的 `spawnBlueprintItem`（函数起于 :844）里有一个
`case '_random_good_'`（V-0 实测在 **:911-932**，自己核对）：
`rng.randRange(0, 5)` 六选一，其中 **roll 4 直投附魔卷轴、roll 5 直投生命药水**。

CE 全源码**没有这个概念**。删除该 case，并删除 `src/data/blueprints.json` 里
**11 处**引用（V-0 已列出：4 个 `vestibule_*`、6 个 `key_*`、1 个 `area_shrine`）。

⚠️ **删除公开名 = 漏授权的第三种形态。** 删之前先
`grep -rn "_random_good_" src/` 把**所有**引用点找出来（含测试、含注释里被当作
"载体"引用的地方），全部进授权清单或登记。

### 2.2 受影响蓝图：删掉室内奖励 feature，**不要替换**

V-0 的关键结论：**CE 的这些机器本来就不放自产奖励。**

- `vestibule_*`：CE 的门厅只发**外包钥匙**，零奖励物；
- `key_*`：CE 是**领养机器**（`BP_ADOPT_ITEM`），**零自产物品** ——
  奖励由别处外包进来；
- 唯一例外是 `area_shrine`，见 §2.3。

所以本轮对前 10 个蓝图的处置是**删掉那条奖励 feature**，
**不要**用别的物品替换、**不要**改成 CE 的解题工具
（那些解题工具依赖 V-1b 的 `MF_ALTERNATIVE` 与固定 kind 机制，本轮做不了）。

**这会让这些房间暂时"空一点"。这是预期的中间态**，V-2 才会按 CE 补回解题工具。
在报告里说明这一点。

### 2.3 `area_shrine` 改类别掩码

V-0 查到 CE 对应是 *"Shrine -- safe haven…"*（`GlobalsBrogue.c:561` 附近，自己核对），
掩码为 **`(POTION|SCROLL|WEAPON|ARMOR|RING)`**，走基表加权。

T-1 已经把 `spawnBlueprintItem` 的类别分支改成了 `chooseKind` 基表加权，
**所以这一条应该零代码即可达成** —— 把 JSON 里的 `_random_good_` 换成
对应的类别声明即可。若发现 web 的蓝图数据结构表达不了"多类别掩码"，
**说明现状并给出最小改动方案**，不要自创一套新语法。

⚠️ T-1 已确立的 CE 语义：**蓝图路径用基表频率、不带计量覆盖**
（计量只在 `populateItems` 内部写回并有 memcpy 备份/还原，蓝图机器在
`digDungeon` 期先于它运行）。所以 enchanting / life / strength 基频为 0，
**从这条路径永不出现** —— 这正是本轮要达成的效果。

## 3. 本轮**不做**的事（V-0 已登记，看到也不要动）

- **不实现 `MF_ALTERNATIVE`**（归 V-1b）。⚠️ 因此**不得引入任何依赖它的 CE 掩码数据**
  （例如基座的"附魔卷轴/生命药水二选一"）——没有它，两者会**同时**生成，
  变成双份发放。这是 V-0 点名的陷阱。
- **不改机器密度**（web 每层 `min(2+⌊depth/3⌋,6)` vs CE 约每 4 层 1 间奖励房）。
  这是与 `_random_good_` **相互独立**的第二个放大器，归 V-1b。
- 不动 `BlueprintEngine` 的抽签资格过滤、递归、领养、回滚。
- 不动钥匙的 kind 维度（web 单一 `iron_key`）。
- **不得修改 `BrogueCE-master/`**（只读参考，D6）。

## 4. 允许修改的文件

**先按四段 grep 自查**（`project_conventions.md` 有完整说明）：
① 主题；② 结构性穷举表；③ 跨轮公共目录标识符；④ 扫描器钉的代码形态。
**外加删除类改动必做的**：`grep -rn "_random_good_" src/`。

**生产代码：**
- `src/engine/Core/Game.ts`
- `src/data/blueprints.json`
- `src/locales/**`（若有相关文案）

**测试（授权修改）：**
- `src/test/fixtures/generation_baseline.json` ✅ **授权重捕获**
  （保留并追加 `note` / `capturedAt` / `d`）
- `src/test/b_4a_item_generation.test.ts`（附魔卷轴与 **life 药水**两条带都会下移，
  **跟随实测平移，不是放宽**）
- `src/test/b_4b_item_placement.test.ts`
- `src/test/blueprint_center.test.ts`
- `src/test/p1_31_35_placement_snapshot.test.ts`
- `src/test/p1_37_machine_flag_i18n.test.ts`
- `src/test/invented_content_pool.test.ts`（`_random_good_` 属自创内容，退池语义可能相关）
- `src/test/c_5_fall_subsystem.test.ts`（维护式 pin，可能再顶一次）
- 新建 `src/test/v_1a_blueprint_items.test.ts`

**清单外撞红：停下，不要改**，写进 `## 需要追加授权的测试`。

## 5. 测试要求

1. **行为终点**：`_random_good_` 删除后，跑满整局统计 ——
   附魔卷轴与 life 药水**双双下移**，给出**改造前/后对比**（多 seed）。
   目标参考：CE 的附魔卷轴约 12-15/局。**若仍高于该量级，说明剩余来源**
   （V-0 已预告机器密度是独立放大器，本轮不修但要量化）。
2. **负向断言**：蓝图路径**再也不产出** enchanting / life / strength
   （基频 0 + 加权抽取的必然结果）。
3. `area_shrine` 的五类掩码**确实按基表频率加权**，不是等概率。
4. **对抗性测试 ≥ 3 条 + 强制反向验证**：真改坏 → 跑 → **贴真实失败输出**
   → 还原 → `grep -rn "REVERT-ME" src/` = 0。

### 5.1 哨兵纪律

本轮移动生成流。新哨兵只许三种形态：① `rng.randomNumbersGenerated` 增量；
② `createHeadlessGame(seed,'test')` 完全隔离合成层（清怪清物后 reseed）；
③ 性质断言。**不许锚定 RNG 流绝对位置。**
撞见既有哨兵因位移而断，优先**改形态**而非硬填数值。

## 6. 门禁

`npx vitest run --fileParallelism=false`（**不带文件参数**）
**外加 `npm run build`**（不要用 `tsc --noEmit`）。

## 7. 最终回复必须包含

1. `## 对任务书的反驳`
2. `## 纯测量数据`（附魔卷轴 / life 药水 改造前后对比；若仍高于 CE 量级，
   量化剩余来源的贡献）
3. `## 改动清单`
4. `## 对抗性测试与反向验证`（含**真实失败输出**）
5. `## 哨兵处置`
6. `## 需要追加授权的测试`
7. `## 门禁结果`
8. `## 遗留与登记`（交给 V-1b / V-2 的清单；受影响房间"变空"的实际观感）
