# V-2a：把前厅与守卫机器接回来（**独占轮，移动 RNG 流**）

## 0. 角色与授权反驳条款

你是**开发方**。本任务书由**验收方**撰写，验收方**会写错事实**。
凡引用的 CE 行号/字段位/数值，都**必须打开
`BrogueCE-master/src/variants/GlobalsBrogue.c` 与 `src/brogue/Architect.c`
逐字核对**。冲突时**以 CE 源码为准**，并在 `## 对任务书的反驳` 一节写明。

⚠️ **验收方近期连续犯过两类错，请对任务书保持怀疑**：
① 把上一轮的 deferral 登记当成"尚未实现"照抄（I-1：燃烧发光其实 C-7 早做了）；
② 把测试的快照前提当成永恒事实（V-1c：b_4a 的"D1 不会生成计量物"）。
**凡本文说"web 目前没有 X"，请先自己 grep 验证。**

## 1. 为什么有这一轮

V-1c 还原了 CE 的机器结构（资格过滤 + 配额 + 递归 + 回滚），
机器数从 3.89/层降到 0.22/层，落回 CE 量级。但它留下一个**中间态**：

**vestibule / key_guard / thematic 三类机器暂时不再出现**（锁门 1022 → 35）。

原因：CE 里这些机器**不由顶层抽签产生**，而是由奖励房经
`MF_BUILD_VESTIBULE` / `MF_OUTSOURCE_ITEM_TO_MACHINE` **递归**建立。
V-1c 把递归机制建好了并用合成蓝图测试钉住，
但 **web 的蓝图数据还没带这些 feature**，所以递归路径在生产数据下从未被行使。

**本轮补上数据，让内容回归。** 这是纯数据轮（外加必要的字段支持）。

## 2. 要做的三件事

### 2.1 给 reward 蓝图接上前厅 feature

CE 的每个奖励房蓝图**末尾都有一条统一的前厅 feature**
（`GlobalsBrogue.c:186 / 194 / 204 / 213 / 220 / 226` 等，**逐字核对**）：

```c
{0, 0, 0, {1,1}, 1, 0, 0, 0, 2, 0, 0,
 (MF_BUILD_AT_ORIGIN | MF_PERMIT_BLOCKING | MF_BUILD_VESTIBULE)}
```

字段序请自己对 `Rogue.h` 的 `blueprint`/`machineFeature` 结构体核实
（验收方读作：DF=0、tile=0、layer=0、instanceCount={1,1}、
minimumInstanceCount=1、category=0、kind=0、monsterID=0、**personalSpace=2**、
hordeFlags=0、itemFlags=0、flags=上面三个）。**若字段序与验收方所读不符，以 CE 为准。**

web 的 5 个 reward 蓝图（`reward_library` / `reward_consumables` /
`reward_pedestals` / `reward_kennel` / `reward_commutation`）按此补上对应 feature。

### 2.2 给 vestibule 蓝图接上钥匙外包

CE 的前厅蓝图生成 `KEY` 并经 `MF_OUTSOURCE_ITEM_TO_MACHINE` 交给守卫机器领养
（CE 树共 **7 处**该旗标，验收方已数过；`GlobalsBrogue.c:300` 附近是
`KEY, KEY_DOOR` 那条）。web 的 4 个 `vestibule_*` 蓝图按 CE 对应物补上。

⚠️ **钥匙的 kind 维度（`KEY_DOOR` / `KEY_CAGE` / `KEY_PORTAL`）web 目前只有单一
`iron_key`** —— 这是 V-0 登记的缺口，**归钥匙轮，本轮不做**。
本轮只要让"锁门 → 钥匙 → 守卫机器"这条链跑通即可。

### 2.3 基座大奖的二选一

CE `GlobalsBrogue.c:218-219` 的两条 `MF_ALTERNATIVE` feature
（`SCROLL_ENCHANTING` / `POTION_LIFE` 放在 `PEDESTAL` 上，`ITEM_KIND_AUTO_ID`）。
**V-1b 已实现 `MF_ALTERNATIVE`**（构建循环前一次性选一），所以现在可以安全落地
—— 在此之前落地会**双份发放**（V-0 点名的陷阱）。

`reward_pedestals` 按 CE 补这两条。

## 3. 绝对禁止

- **不得修改 `BrogueCE-master/`**（只读参考，D6）。
- **不做全表扩充**：CE 有约 69 个蓝图、web 只有 20 个。补齐全表是 **V-2b**，
  本轮**只动现有 20 个蓝图的 feature**，不新增蓝图条目。
  看到缺的蓝图 → 登记，不要顺手加。
- **不实现 `MF_KEY_DISPOSABLE`、不扩 `keyLoc` 的 kind 维**（归钥匙轮）。
- **不接 `BP_TREAT_AS_BLOCKING` / `BP_REQUIRE_BLOCKING` 的连通性复核**
  —— V-1c 为它降过 scope（撞红清单外扫描器 `c_4b` F1），
  激活要先按该测试标题预告的流程扩白名单，**本轮不碰**。
- 不得为了让测试变绿而放宽断言。
- **不得把坏层塞进任何白名单**（C-8 的教训）。

## 4. RNG 与基线

本轮**必然移动生成期 RNG 流**（机器内容变多、递归开始真实行使）。
`generation_baseline` ✅ **授权重新捕获**（保留并追加 `note` / `capturedAt` / `d`）。

⚠️ **C-8 的连通性否决必须继续有效**：前厅会在门口造地形、守卫机器会改地图。
**必须复跑 C-8 的广度断言，确认坏层仍为 0**。出现坏层是**真回归，停下来申报**，
不要调整闸门。

## 5. 允许修改的文件

**先按四段 grep 自查**（`project_conventions.md`），
**外加 V-1c 报告 §9「给 V-2 的登记」八条**——那是上一轮明确预告的撞红与陷阱，
验收方已两次因为没读上一轮预告而漏收清单。

**生产/数据：**
- `src/data/blueprints.json`（本轮主场）
- `src/engine/Generator/BlueprintEngine.ts`（**仅当**新 feature 需要字段支持，
  例如 `minimumInstanceCount` 的显式化；**不得改 V-1c 的递归/配额/回滚逻辑**）
- `src/locales/**`

**测试：**
- `src/test/fixtures/generation_baseline.json` ✅ 授权重捕获
- `src/test/v_1c_machine_structure.test.ts`（其类别分布断言会因内容回归而变）
- `src/test/v_1b_alternative.test.ts`（**P1 前提会翻**——它自带注释预告了
  "V-2 会来反转"，按留痕反转惯例处理）
- `src/test/p1_33_machine_chokepoint.test.ts`、`src/test/p1_37_machine_flag_i18n.test.ts`
- `src/test/blueprint_center.test.ts`、`src/test/p1_31_35_placement_snapshot.test.ts`
- `src/test/c_5_fall_subsystem.test.ts`（维护式 pin，本轮会再顶一次）
- `src/test/b_4a_item_generation.test.ts`、`src/test/v_1a_blueprint_items.test.ts`
  （附魔卷轴/life 量带会随基座大奖回归而上移——**跟随实测平移，不是放宽**）
- 新建 `src/test/v_2a_vestibule_return.test.ts`

**清单外撞红：停下，不要改**，写进 `## 需要追加授权的测试`。

## 6. 测试要求

1. **内容回归的行为终点**：整局（D1-D26）实测 —— vestibule / key_guard
   机器**重新出现**，锁门数量回升；给出**改造前/后对比**（V-1c 后是
   锁门 35、机器 87/390 层）。
2. **递归路径真实行使**：断言 `MF_BUILD_VESTIBULE` /
   `MF_OUTSOURCE_ITEM_TO_MACHINE` 在**生产数据**下被走到
   （V-1c 只用合成蓝图验证过，本轮要证明真实数据能触发）。
3. **基座二选一**：`reward_pedestals` 上**恰有一件**（附魔卷轴 XOR 生命药水），
   **不是两件**——这条直接钉死 V-0 点名的双份发放陷阱。
4. **锁/钥一一对应**仍成立（V-1a 建立的不变量）。
5. **连通性不回归**：复跑 C-8 广度断言，坏层 = 0。
6. **对抗性测试 ≥ 3 条 + 强制反向验证**：真改坏 → 跑 → **贴真实失败输出**
   → 还原 → `grep -rn "REVERT-ME" src/` = 0。
   建议其一：把基座的两条 `MF_ALTERNATIVE` 旗标去掉 → 测试 3 必须红（双份发放）。

### 6.1 哨兵纪律

新哨兵只许三种形态：① `rng.randomNumbersGenerated` 增量；
② `createHeadlessGame(seed,'test')` 完全隔离合成层（清怪清物后 reseed）；
③ 性质断言。**不许锚定 RNG 流绝对位置。**

## 7. 门禁

`npx vitest run`（**不带文件参数**；⚠️ **不要加 `--fileParallelism=false`**
——实测并行 411s vs 串行 1432s、同样零红，强制串行正是跨文件泄漏的病因）
**外加 `npm run build`**（不要用 `tsc --noEmit`）。

## 8. 最终回复必须包含

1. `## 对任务书的反驳`
2. `## 三件逐条落地情况`
3. `## 纯测量数据`（内容回归的前后对比：机器数 / 锁门数 / 类别分布）
4. `## 改动清单`
5. `## 对抗性测试与反向验证`（含**真实失败输出**）
6. `## 哨兵处置`
7. `## 需要追加授权的测试`
8. `## 门禁结果`（含 C-8 广度断言坏层 = 0 的证据）
9. `## 遗留与登记`（给 V-2b 全表扩充 / 钥匙轮的交接）
