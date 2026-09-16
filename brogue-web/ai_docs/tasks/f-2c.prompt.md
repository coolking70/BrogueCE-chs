# F-2c：爆炸 `GAS_EXPLOSION`（F/G 链收口轮）

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**（`status`/`diff`/`log` 只读允许）。

**授权反驳条款有效**：CE 源码优先。你在前几轮连续纠正并改进过验收方——
F-0 重排整条 F/G 链、F-1 拒照抄 `promoteChance=500`、F-2a 指出照字面改
`igniteForced` 会让禁改文件翻红、F-2b 查明 `StatusId` 撞点不存在、
G-1 指出 `DF_GAS_FIRE` 是 SURFACE 层并抓到 `updateVolumetricMedia` 的无条件掷骰、
G-2 揪出躺在死分支里三轮的 `ALL_DIRS8` 错抄。**请继续，包括反驳本任务书。**

**先读**：`ai_docs/g_2_gas_df_wiring_report.md` §九（给 F-2c 的登记）、
`ai_docs/g_3_gas_effects_report.md` 的登记清单、
`ai_docs/f_2b_creature_burning_report.md` §十.1-2（**p4_4 的等待翻转与两段伤害叠加口径**）。
凡本任务书与它们冲突，**以实测为准并在报告里指出**。

---

## 一、本轮定位：F/G 链的最后一块

火侧（F-1/F-2a/F-2b）与气体侧（G-1/G-2/G-3）都已就位。
爆炸横跨两侧——它是 GAS 层的气体被点燃后产生的 **SURFACE 层火地形**，
所以必须等气体侧做完才能做。**本轮之后 F/G 链收口。**

---

## 二、范围

### 1. `GAS_EXPLOSION` 地形

CE `Globals.c:496`：drawPriority 10、`promoteChance 10000`（**每回合必定晋升**，
即瞬时地形）、flags `T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE`、
mechFlags 含 `TM_VANISHES_UPON_PROMOTION`。**以上数值请自己复核，别信我的转述。**

`T_CAUSES_EXPLOSIVE_DAMAGE`（`Rogue.h:1944`）的注释写明语义：
**"deals higher of 15-20 or 50% damage instantly, but not again for five turns"**
——瞬时、取 15-20 与当前血量 50% 的较大者、**同格五回合内不再重复**。
结算点在 `Time.c:343-353` 附近，自己打开读。

### 2. 两个载体，都已备好

- **甲烷爆轰**：G-2 已接上 `METHANE_GAS`（`TM_EXPLOSIVE_PROMOTE`，
  `promoteType = DF_EXPLOSION_FIRE`，`Globals.c:507`），
  且 `DF_EXPLOSION_FIRE` 目录条目已备（start 60 / decr 17，**tile null**）。
  **迁移 `GAS_EXPLOSION` tile、填 tile、摘 `DF_MISSING_TILES` 后爆炸圈自动成形。**
  ——**这是 G-2 的预测，本轮第一件事就是验证它成立与否。**
- **explosive bloat**：`Globals.c:1084` 的怪物条目 `deathDF = DF_BLOAT_EXPLOSION`。
  web 现在是 `igniteForced ×5`（F-2b §十.2 登记）——改走 CE 的 DF 铺设。

### 3. ★ p4_4 的翻转（F-2b 早已预告，**这次任务书提前授权了**）

`p4_4_split_kamikaze.test.ts` 那条断言，F-2b 时由验收方翻成"环境段挂状态 +
状态段掉血"的两段式，并在注释里写明**"本断言不代表爆炸伤害已按 CE 实现，
那条归 F-2c"**。

本轮真爆炸落地后：爆炸伤害是**瞬时**的（不经燃烧状态），
所以那条断言要再翻一次。**F-2b §十.2 提醒了两段伤害的叠加口径**——
CE 里爆炸铺火、火再点燃生物，所以**瞬时爆炸伤害与后续燃烧伤害是两笔**，
不要合并成一笔。

### 4. 五回合免疫窗

`T_CAUSES_EXPLOSIVE_DAMAGE` 的"同格五回合内不再重复"需要按格记账。
CE 怎么记的，自己查（`Time.c:343-353` 一带）。

---

## 三、明确不做（写显式留痕测试）

- **不改火侧的蔓延/寿命/燃烧状态机**（F-2a/F-2b 的成果）——反向哨兵。
- **不改 G-1 的扩散/消散算法、G-2 的气源接线、G-3 的效果与比例伤害**
  ——同样是反向哨兵。
- 五种无载体气体（若 G-3 仍未接）保持原状。
- 不碰 `creeping_death`（已按 D2 退役）。

---

## 四、文件边界（硬约束）

**允许修改**：
- `src/engine/Map/TerrainCatalog.ts`、`DungeonFeatureCatalog.ts`、
  `DungeonFeature.ts`、`Grid.ts`、`Promotion.ts`
- `src/engine/Environment/Gas.ts`、`src/engine/Core/Game.ts`
- `src/locales/zh_CN.json`（仅增键；新文案必须走 i18n）
- **以下既有测试（本轮必然到期的断言），提前授权，不要为此停下**
  ——清单按交接文档「两段 grep」法生成：
  **① 结构性穷尽表**（凡新增地形/DF 必打红，与主题无关）：
  `c_4a_0_layer_model` / `c_4a_terrain_catalog` / `c_4b_dungeon_feature` /
  `c_4c_promotion` / `f_1_fire_as_terrain` / `f_2a_fire_mechanics` /
  `g_2_gas_df_wiring`
  **② 本轮主题**：`f_2b_creature_burning`（燃烧伤害与爆炸伤害的叠加口径）、
  `g_1_gas_volumetric`、`g_3_gas_effects`、`p1_24_death_sink`、
  **`p4_4_split_kamikaze`（F-2b 预告的翻转，见 §二.3）**
  **限定**：只改因本轮行为变化而到期的断言，**不许放宽守卫性质**
  （穷尽式 `toEqual` 仍要穷尽、阈值不许松、火侧与气体侧断言不许动）。逐条写进报告。
- 新增测试文件

**禁止修改**（违反即本轮作废）：
- `src/engine/Map/` 下其余既有文件、`src/engine/Generator/`、
  `src/entities/`、`src/components/`
- **`BrogueCE-master/` 下任何文件**
- 任何 `src/data/*.json`、`src/engine/Random.ts`、`vite.config.ts`
- **`src/test/fixtures/*`**、`src/test/harness.ts`
- 上面未列出的任何既有测试文件

---

## 五、★ 「照抄留形」的死分支必须逐字重核

`project_conventions.md` 的规矩：留形代码**写它的那轮无法测它**——
G-2 就揪出 F-2a 留形的 `ALL_DIRS8` 把 `[1,-1]` 抄两次、漏 `[1,1]`，躺过三轮。

**本轮要激活 `DF_EXPLOSION_FIRE`（G-2 留形、tile null）与爆轰分支
（G-2 已修方向表但爆炸圈本身未落地），逐字符重核 CE 并在报告里声明核过。**

---

## 六、门禁

1. **三组反向哨兵逐位不变**：火侧 `[FIRE-NAT]`（F-2a §一）、
   `[DMG-FIRE]`（F-2b §七）、气体曲线（G-1/G-2/G-3 的最新基线）。
2. **G-2 预测的验收**："填 tile 后爆炸圈自动成形"成立与否。
3. **爆炸的实测**：伤害值分布（15-20 vs 50% 血量哪个生效）、
   五回合免疫窗的实际行为、爆炸圈半径、
   **瞬时伤害与后续燃烧伤害两笔是否正确分离**。
4. 决定性复验；`generation_baseline` 应仍绿；坏层闸门仍为 0。
5. `npm run build` 绿；`npm test` 全绿。

**全量门禁用 `npx vitest run --fileParallelism=false`**（串行）。

---

## 七、测试要求

1. 每条断言必须能在某个具体的错误实现下失败。
2. **对抗性测试至少七条**，必须含：
   - 伤害取小者而非"15-20 与 50% 的较大者"
   - 五回合免疫窗漏掉（同格连续爆炸重复扣血）
   - 免疫窗按生物而非按格记账
   - `GAS_EXPLOSION` 的 `promoteChance 10000` 写错（爆炸地形不消失）
   - 瞬时伤害与燃烧伤害被合并成一笔
   - 火侧/气体侧被本轮意外改动（回归哨兵 ×2）
3. **反向验证（强制）**：至少四条真的改坏、贴真实失败输出、还原。

---

## 八、交付

报告写入 `ai_docs/f_2c_explosion_report.md`，必须含：
- `GAS_EXPLOSION` 与 `T_CAUSES_EXPLOSIVE_DAMAGE` 的 CE 行号与复核要点；
- **G-2 预测的验收结论**；
- **§六.3 的爆炸实测**（伤害分布、免疫窗、半径、两笔伤害的分离）；
- 留形分支逐字重核的声明（§五）；
- 三组哨兵的逐位比对输出；
- 改了哪些既有测试断言、逐条说明为什么到期、守卫性质未放宽的论证；
- 对抗性测试与反向验证的真实失败输出；
- **F/G 链收口总结**：还剩哪些登记项没做、各归哪一轮。

**已知陷阱**：深水枚举成员是 `WATER_DEEP` 不是 `DEEP_WATER`，写错**不报错**
（vitest 走 esbuild 只剥类型不检查）。**任何让人困惑的失败，先跑 `npm run build`。**

**留痕规矩**：遇到留痕与文件边界冲突，**停下来申报**，
**不要把代码扭曲成扫描正则看不见的形态**——那是自造假绿。
