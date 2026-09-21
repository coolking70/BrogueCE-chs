# 审计欠账收尾报告

## 1. 两条测试修复

### 1.1 `armor_display_effect.test.ts`：检视舞台去随机地图化

- **原舞台**：`inspectAdjacentMonster` 按八方向寻找随机生成地图中第一个已经
  `isVisible` 的玩家邻格；若八格都不可见便抛错。怪物虽是人工创建，落点可用性仍由
  seed 对应地图决定。
- **新舞台**：先清掉生成怪物，随后把全部图内玩家邻格显式铺成 `FLOOR` 并设为可见，
  再按固定方向把人工 `accuracy=100` 怪物放到第一个图内邻格。地图只提供一个 `Grid`
  容器，不再决定测试是否有可用样本。
- **被测性质不变**：两个用例的断言文字和等式均未改；仍分别验证无甲时详情命中率
  等于 `hitProbability(100, 0)`，以及皮甲 +0 时详情命中率等于
  `hitProbability(100, playerDefense(3, 0, 10, 10))`。没有放宽命中率断言。

### 1.2 `b_4a_item_generation.test.ts`：life 首现诊断

- **原舞台**：逐 seed 生成 D1-D26，找到第一只 life potion 后立即对该 seed 做
  `[1,6]` 上下界断言；首个失败只显示一个 seed，无法同时看到其余样本。
- **新舞台**：生成与首现采样完全不变，但先收集全部 10 个
  `{ seed, depth }`；随后计算 `[1,6]` 命中数，并把「10 个 seed 各自首现深度、命中
  x/10、越界 y/10」作为每条上下界断言的诊断消息。
- **被测性质不变**：仍对每个 seed 分别执行 `>= 1` 和 `<= 6`，没有扩大区间、删除
  seed 或把逐 seed 合同降成总体合同。

## 2. 反向验证

### RV-1：详情命中率接线

1. 临时把生产文件 `DetailGenerator.ts` 的
   `hitProbability(monAcc, effectivePlayerDefense)` 改为
   `hitProbability(monAcc, 0)`，模拟详情层丢失玩家防御接线。
2. `npx vitest run src/test/armor_display_effect.test.ts` 以 exit 1 翻红；对应接线用例：
   `Game.handleInspectAt 接线：面板命中率与 playerDefense 同源 > 皮甲+0（力10）...`。
   错误首行为：
   `AssertionError: expected '该怪物有 100% 的概率命中你。' to be '该怪物有 68% 的概率命中你。' // Object.is equality`。
   同时纯详情公式组也按预期翻红。
3. 立即用注入前副本还原生产文件；临时生产改动**未进入最终 diff**。还原后同一完整
   文件为 `1 passed / 16 passed`。

### RV-2：life 保底的端到端观测

1. 只在测试副本中临时令 life 检测条件恒假，模拟生成链不再产出可观测 life；为缩短
   故障实验，仅将临时样本收缩为 seed 1（两处临时改动均随后整体还原）。
2. `npx vitest run src/test/b_4a_item_generation.test.ts -t '每个 seed 在 D6 前'`
   以 exit 1 翻红；断言名为
   `B-4a life 阈值强制生成 > 每个 seed 在 D6 前必出现第一只 life...`，错误首行为：
   `AssertionError: 逐 seed 首现深度: seed1=D-1；区间 [1,6] 命中 0/1，越界 1/1: expected -1 to be greater than or equal to 1`。
   这也直接验证新增诊断在红灯中可见。
3. 用注入前副本还原后，`rg` 搜索全部 `TEMP fault` / `TEMP suppress` /
   `TEMP minimize` 标记为零命中；同一目标用例恢复为 `1 passed | 23 skipped`。完整
   `b_4a_item_generation.test.ts` 另有 `1 passed / 24 passed` 的门禁记录。

## 3. `generation_baseline` 治理方案（只建议，本轮未改）

### 3.1 默认门禁中混放的具体问题与既有证据

这项测试同时承担两种相反的沟通含义：对于交互期改动，它是「不应移动生成流」的强
哨兵；对于合法生成改动，它又必然先红、待归因后重采。放在一个没有结果分类的默认
门禁中，CI 只能报告普通失败，无法表达「意外回归」「预期漂移但尚未审核」「已批准
重采」三种状态。结果是维护者需要从任务背景人工猜测红灯含义，也容易形成顺手刷新
fixture 的压力。

仓库已有具体证据：`v-2a-finish.prompt.md` §3 记载 `generation_baseline` 出现 **60 处
偏离**，后来确认 V-2a 本来就有意让前厅真正生成内容；更糟的是，上轮很可能曾在半成品
状态重捕获，导致后续合法完成实现又红。这不是机制回归，却制造了再次诊断、再次重采的
工作，并展示了「默认红灯 + 没有批准元数据」如何把合法漂移当普通回归处理、乃至把
缺陷态固化进基线的风险。`v-2b-1.report.md` §3 也记录了一次全量门禁只剩该基线红、经
受控实验确认 98/104 层为授权生成变化后才重采；说明该流程实际需要的不是普通 pass/fail，
而是单独的归因与批准阶段。

### 3.2 三种选择及代价

#### 方案 A：移出默认门禁，独立 script / CI job

- 增加例如 `test:generation-drift`，默认性质门禁不运行它；生成相关 PR 或定时任务单独跑，
  独立 job 明示 `expected-drift`，并要求附重采报告。
- **优点**：普通机制测试信号最干净；合法生成 PR 不会把整套门禁染红；权限和重采流程
  最容易单独控制。
- **代价**：若路径触发规则漏配，非生成 PR 可能完全绕过漂移哨兵；定时跑会把发现时间
  从提交时推迟到排程时。必须维护可靠的路径过滤，且仍应让生成目录改动强制运行该 job。

#### 方案 B：仍留默认门禁，但改名并增加显式重采说明检查

- 将测试/job 命名明确为「生成指纹漂移（合法生成变更预期会红）」；fixture 增加结构化
  元数据（如变更编号、原因、批准人/批准状态、捕获命令或源码 revision），另加静态检查：
  fixture 发生变化时 PR 必须同时更新非空重采说明，且 seeds/字段结构不可悄悄变化。
- **优点**：每次提交都保留最高覆盖率；对意外触及生成流仍是即时硬门禁；改造量较小。
- **代价**：合法生成变更在重采前仍显示普通红灯，CI 视觉噪音不消失；「有说明」只能证明
  写了文字，不能自动证明新基线正确，审阅者仍需核对归因顺序。元数据若与 fixture 同一
  提交自由修改，也可能沦为形式检查。

#### 方案 C：拆成「指纹漂移」与「机制正确性」两组

- 指纹组保留现有 4 seed × 26 层的 fp/n/species/items，采用方案 A 的独立 job 与受控重采；
  机制组把稳定合同（确定性、连通性、物种/物品合法性、数量或保底机制边界等）写成不依赖
  精确 RNG 派生值的性质测试并留在默认硬门禁。
- **优点**：把「实现是否正确」与「随机输出是否变化」在测试语义、CI 展示和所有权上真正
  分开；合法漂移只影响指纹 job，机制退化仍硬红，最不容易把快照当正确性证明。
- **代价**：初次盘点和迁移成本最高；机制组不可能复刻指纹对未知变化的全覆盖，仍须保留
  指纹组；若两组覆盖说明不清，可能重复跑昂贵的 104 层生成并增加 CI 时间。

### 3.3 推荐

推荐 **方案 C，并以方案 A 的独立 job 承载其中的指纹组**：

1. 默认门禁只给「机制正确性」硬红语义，红灯可直接行动；
2. `generation-drift` 仍对所有 PR 跑（而不是仅靠易漏配的路径过滤），但作为独立 required
   job；无漂移则绿，有漂移则要求维护者选择「回归，修代码」或「合法变化，审核归因后重采」；
3. 重采工具强制保留 seed/字段结构，并要求提交结构化 reason + 关联变更；fixture 更新只能在
   机制组全绿之后发生；
4. CI 展示两组结果，避免用重采后的总绿掩盖机制测试曾经失败。

它比单用 A 更不易漏测，比单用 B 更能消除语义噪音。代价是一次性的性质盘点，但仓库已有
大量连通性、物品保底等性质测试，可逐步归类，无需一次重写全部测试。

## 4. 并行安全边界与门禁

- `npx vitest run src/test/armor_display_effect.test.ts`：`1 passed / 16 passed`。
- `npx vitest run src/test/b_4a_item_generation.test.ts`：`1 passed / 24 passed`。
- `npx vitest run src/test/generation_baseline.test.ts`：`1 passed / 1 passed`，未重采 fixture。
- `npm run build`：exit 0；Vite 801 modules transformed，只有既有的大 chunk 提示。
- `git diff --check`：通过。
- 最终 diff 未触及 `TerrainType` 定义、`src/test/fixtures/generation_baseline.json`、
  `src/data/blueprints.json`、`src/engine/Generator/` 或 `src/engine/Map/` 下的生成/落位实现。

## 5. 最终改动文件

1. `src/test/armor_display_effect.test.ts`
2. `src/test/b_4a_item_generation.test.ts`
3. `ai_docs/reports/fix-audit-tail.report.md`

生产代码最终改动为零；RV-1 对 `DetailGenerator.ts` 的临时故障注入已还原且不在 diff。

## 6. 授权反驳

没有发现任务书病灶描述不准之处：armor 用例确实把人工怪物放置建立在随机地图的可见
邻格上；life 用例确实会在越界时红、并非哑败法，但原实现只能在首次失败处展示单 seed。
本轮分别只去掉舞台偶然性、增加失败可观测性，没有更改被测合同。
