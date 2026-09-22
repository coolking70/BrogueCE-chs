# 审计欠账轮交付报告

日期：2026-09-22。任务依据：`ai_docs/tasks/audit-debt.prompt.md`。

## 1. 范围与先读代码的结论

代码改动仅两个授权测试文件：

- `src/test/p1_37_machine_flag_i18n.test.ts`
- `src/test/p1_31_35_placement_snapshot.test.ts`

另按任务书 §5 新增本报告。生产代码、`TerrainType`、`blueprints.json`、
`generation_baseline.json`、Generator/Map 目录及 `BrogueCE-master/` 均未修改。
没有重捕获基线，没有运行不带文件参数的全量 vitest。

对审计描述的校正：

1. AD3 的单层选择和 `A−B=[]` pin 在当前代码中确实仍在。但不能把 V-2b-7
   的工作说成尚未完成：当前已有 `featureSpawns`，逐格白名单已包含全部 feature，
   且已有 feature 记录非空哨兵。V-2b-7 曾命中六格，后续 V-2b-9b 的顺延又把
   该单层 pin 变回空集。旧的“只有 item/monster 指令，缺全部 feature 载体”
   注释是历史记录，不能当作当前实现。本轮保留并扩展记录非空门，删除偶然快照。
2. T7 在本轮开始前已经改为反转 `loopMap[0][0]`；审计所述两局地图必须不同的
   前提已不在代码中。但还残留 `seed42` 必须生成环路的随机前提，本轮移除它，
   并确认人工污染格确实进入读档前的 stale 集合。
3. T9 在本轮开始前已经注入 `(-1,-1)` sentinel，不能把它记成本轮首次修复。
   本轮把 sentinel 覆盖断言前移至显式重建之前，并补上定向错误消息和反向验证。

## 2. 三条性质与新舞台

| 条目 | 原舞台 / 本轮入口状态 | 新舞台 | 被测性质是否一字未改 |
| --- | --- | --- | --- |
| AD3 | seed424242 首个有机器层，往返与 `A−B` 精确快照混在一条中 | AD3a 全扫 5 seed × 26 层；AD3b 人工房间和纯地形墙上 feature | 往返保留旗标、重建 machineCells、旧字段缺失归零以及外部机器格必须有本机布点来源的性质不变。断言实现重写并加强为精确编号/全图检查；删除的坐标快照不是普遍合同，不能称所有断言文本一字未改。 |
| T7 loopMap | 已有确定格污染，但还要求 seed42 的环路数非零 | 保留目标重算值取反的污染，加读档前 stale 集合含 `0,0` 的舞台确认 | 是。最终 `expect(staleLoopCells(b)).toEqual([])` 一字未改，仍要求读档后全图与目标网格重算逐格相等。 |
| T9 waypoint | 已有越界 sentinel，但 sentinel 检查排在显式重建一致性检查之后 | 保留 sentinel；读档后立即确认被覆盖，再验显式重建幂等 | 性质完全不变：读档成功、坐标非空、覆盖旧 sentinel、与显式重建一致。仅调整断言顺序和诊断消息。 |

### AD3a：完整往返合同

- 种子仍为 `[424242, 31337, 20260916, 42, 999]`，每个 D1–D26 均采样，
  无首台机器提前 `break`。覆盖总层数精确为 130，并逐台检查每份 `MachineResult`。
- 记录器保留 `buildMachines()` 结果数组引用，包含 Architect 随后追加的强制
  thematic 机器及其子机器；不是复制一个遗漏后续机器的早期数组。
- 每个 seed 先完成 26 层连续生成、保存网格编号及快照，恢复记录器后才创建读档
  实例并验证。避免 `loadSnapshot()` 重播种全局 RNG 干扰尚未生成的样本。
- 序列化逐格精确匹配原网格 `machineNumber`；每台机器分别检查 interior、
  feature 落点和实际网格归属格。反序列化检查精确编号，而非仅检查非零；另做
  全图检查，防止非机器格凭空出现编号。
- `machineCells` 与原网格非零编号集合全等，缺格和多格都失败。`mr.cells`
  不再冒充网格机器格集合。NO_INTERIOR_FLAG 已清零的格保持为 0，wired 格
  保持原编号，不再只对一个蓝图 id 特判。这是保存/恢复合同，不冒充独立的生成期
  NO_INTERIOR_FLAG 实现验证。
- 每层再在同一刚恢复真实旗标的实例上加载缺少该字段的旧存档，验证全图归零、
  `machineCells` 为空，防止旧状态残留。
- V-2b-7 的 feature 记录非空门扩至每个有机器层；另要求总机器数、非零旗标
  格数、interior 中零旗标格数均大于 0，防止相应往返分支没有样本。

### AD3b：interior 外 feature 的独立覆盖

测试内人工铺设 8 格房间，周围全为花岗岩；合成蓝图使用已有 `TORCH_WALL` 和
`MF_BUILD_IN_WALLS`，调用真实 `applyBlueprint()`。所有候选都在 interior 外，
seed 仅决定选中哪面墙，不决定有没有合格正样本。未改生产蓝图池。

本样本不产生 item/monster 指令，专门覆盖旧白名单无法表达的纯地形 feature。
两道独立门都必须通过：`featureSpawns.length > 0`、`outsideHits > 0`。
每个外部网格机器格须具有本机编号、出现在本机 feature 记录中，并为墙火把；
反方向也检查每条 feature 记录位于 interior 外且网格标记为本机。
不钉随机坐标，不保留自然层的 `A−B=[]` 快照。

## 3. 反向验证

均在测试侧临时拦截被测机制的入口/结果，执行真实保存/加载或蓝图方法；没有
修改生产源码。每项分别注入、定向运行至断言失败、恢复原测试、定向复跑变绿。
临时改动未进入最终 diff。三条必做项和一个新增覆盖门验证如下。

### 3.1 AD3：序列化漏写机器旗标

临时包装测试实例的 `toSnapshot()`，调用原方法后删除返回网格全部
`machineNumber` 字段，模拟序列化漏字段。原网格参照不变。

命令：`npx vitest run src/test/p1_37_machine_flag_i18n.test.ts -t AD3a`

翻红用例：`AD3a: 5 种子 × D1-D26 每台机器的旗标穿存档往返；旧存档（无字段）读入为无机器`。
错误首行：

```text
AssertionError: seed424242/D2: 序列化必须逐格保留原 machineNumber（含 0）: expected Map{ +0 => +0, 79 => +0, …(2289) } to deeply equal Map{ +0 => +0, 79 => +0, …(2289) }
```

注入时 1 failed / 8 skipped，退出码 1；还原后同命令 1 passed / 8 skipped，退出码 0。

### 3.2 T7：读档重算的 loopMap 未落账

污染舞台搭好后，临时给接收实例的 `loopMap` 安装保留旧值的 getter 和丢弃赋值
的 setter，使真实 `loadSnapshot()` 的重算结果不能替换旧图，等价模拟漏重建。

命令：`npx vitest run src/test/p1_31_35_placement_snapshot.test.ts -t T7`

翻红用例：`T7 跨局读档：loopMap 必须与读入网格的 analyzeLoopMap 逐格相等`。
翻红点为保持原文的读档后 `expect(staleLoopCells(b)).toEqual([])`，错误首行：

```text
AssertionError: expected [ '0,0', '7,8', '7,9', '7,10', …(258) ] to deeply equal []
```

注入时 1 failed / 9 skipped，退出码 1；还原后同命令 1 passed / 9 skipped，退出码 0。
诊断中的其余格随样本而变；必定保留的人工错误格 `0,0` 足以使该断言失败。

### 3.3 T9：跳过读档时的 waypoint 重建

将接收实例的 `rebuildWaypoints()` 临时替换为仅恢复原方法、当前调用不执行
重建的一次性函数，准确跳过 load 内那次调用，不影响后续显式重建入口。

命令：`npx vitest run src/test/p1_31_35_placement_snapshot.test.ts -t T9`

翻红用例：`T9 跨局读档：waypoint 必须已按读入网格重建（与显式重建一致且非空）`。
错误首行：

```text
AssertionError: 读档后仍保留越界 sentinel waypoint: expected '[{"x":-1,"y":-1}]' not to be '[{"x":-1,"y":-1}]' // Object.is equality
```

注入时 1 failed / 9 skipped，退出码 1；还原后同命令 1 passed / 9 skipped，退出码 0。

### 3.4 补充：AD3b 非空覆盖门

真实人工蓝图建成后，临时将 feature 落点的网格 `machineNumber` 清零，模拟
外部 feature 漏标记，保留 feature 记录。

命令：`npx vitest run src/test/p1_37_machine_flag_i18n.test.ts -t AD3b`

翻红用例：`AD3b: 人工墙上 feature 必在 interior 外；命中数 > 0 且逐格对应本机 feature 记录`。
错误首行：

```text
AssertionError: A−B 必须命中，逐格守卫不能空转: expected 0 to be greater than 0
```

注入时 1 failed / 8 skipped，退出码 1；还原后同命令 1 passed / 8 skipped，退出码 0。
这证明 A−B 消失会显式失败，不会再次把逐格循环执行零次当作成功。

## 4. 清理与并行安全自检

- 还原后 `git status --short` 仅列两个测试文件；交付时另列本报告。
- `git diff --exit-code -- brogue-web/src/engine brogue-web/src/data/blueprints.json brogue-web/src/test/fixtures/generation_baseline.json`
  退出码 0：生产文件及基线干净，生成流相关文件无改动。
- 对两个测试执行 `grep -nE 'zz_|ZZ_COVERAGE|SERIALIZATION_FAULT|LOOP_REBUILD_FAULT|WAYPOINT_REBUILD_FAULT|EXTERNAL_MARKING_FAULT'`，
  无命中。临时注入、诊断及其入口均已移除。
- 临时运行脚本及日志均放在 `/private/tmp/zz_audit_*`，已删除；工作区
  `find` 检查无 `zz_*` 临时文件，尤其没有 `zz_rebaseline.test.ts`。
- 本 worktree 初始没有依赖目录，复制了本机同项目已有的 `node_modules` 供运行，
  未改依赖清单或 lockfile；依赖和正常构建产物均为忽略项。
- `npm run test:drift` 绿色，未重采或改写 fixture。

## 5. 最终复跑

在全部测试代码编辑完成、所有故障注入还原、临时脚本和诊断删除之后，于
`brogue-web/` 依次执行以下四条。报告在命令完成后补记，未再修改测试代码。

| 命令 | 最终结果 |
| --- | --- |
| `npx vitest run src/test/p1_37_machine_flag_i18n.test.ts` | 9/9 passed，退出码 0，71.94s |
| `npx vitest run src/test/p1_31_35_placement_snapshot.test.ts` | 10/10 passed，退出码 0，7.65s |
| `npm run test:drift` | 1/1 passed；4 seed × 26 层的四类生成字段与基线一致，退出码 0，19.85s |
| `npm run build` | `vue-tsc -b` 与 Vite 构建通过，退出码 0；Vite 提示部分 chunk 超过 500 kB，没有构建错误 |

**这是最终状态下的运行结果，不是中途快照。**
