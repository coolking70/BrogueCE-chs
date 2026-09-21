# fix-randomstage 执行报告

## 0. 环境能力必答

1. **开始时 `node_modules` 已存在。** 用 `test -d brogue-web/node_modules`
   检查的退出码为 0，因此 setup script 已生效。
2. **`npx vitest run src/test/<单个文件>` 能正常跑起来。** 三个
   目标文件均运行成功，没有 registry 403。npm 只输出了不影响运行的
   `Unknown env config "http-proxy"` 弃用预警。
3. **首次完整单文件运行耗时：**
   - `p1_31_35_placement_snapshot.test.ts`：Vitest 21.93 s（shell 墙钟
     24.259 s），10/10 通过。
   - `p2_1_tick_architecture.test.ts`：Vitest 6.39 s（shell 墙钟 8.953 s），
     6 通过、4 跳过。
   - `b_4b_item_placement.test.ts`：Vitest 225.38 s（shell 墙钟
     227.794 s），15/15 通过。
4. **本次可用时长至少约 10 分钟，没有被窗口截断的迹象。**
   完成了首轮三文件、5 次有效故障注入、若干次校正注入，以及还原后
   三文件复跑；最慢的单文件两次均完整返回。平台未显示硬性总时长，
   所以无法比“至少”更精确地声称上限。

## 1. 五条随机舞台去耦

### 1. T7 loopMap 读档重算

- **原舞台：** seed 42 的存档读入 seed 777 的实例，并先要求两张
  随机地图的 loopMap 必须不同。
- **新舞台：** 依目标网格的 `analyzeLoopMap` 值，把读档对象
  `[0][0]` 人工改成反值，确定制造一个 stale cell。
- **被测性质不变：** 仍断言读档后 loopMap 与当前网格重算结果
  **逐格相等**；只把“陈值从哪里来”由随机巧合改为确定污染。

### 2. T9 waypoint 读档重建

- **原舞台：** 把 seed 777 随机地图的 waypoint 当陈坐标，假定它必与
  seed 42 的重建坐标不同。
- **新舞台：** 显式写入地图重建不可能产生的越界 sentinel
  `[{x:-1,y:-1}]`，并把 count 设为 1。
- **被测性质不变：** 仍要求读档后 waypoint 非空、不是陈值，且
  再次显式重建不会改变它；即仍在测“已按读入网格重建”。

### 3. B2a 慢怪剩余 tick

- **原舞台：** 从生成怪中取第一只存活且未关笼的怪。
- **新舞台：** 清空生成怪，由测试直接构造一只已知 rat，显式设定
  `movementSpeed=100` 并加入 `game.monsters`。
- **被测性质不变：** 仍对该怪注入 150 tick，断言玩家 100 tick
  动作中它不行动且余 50，两个原断言均保留。

### 4. B2b 快怪多轮调度

- **原舞台：** 从生成怪中搜一只活着、未关笼且速度 100 的怪；
  其它随机生成怪负责触发第二轮迭代。
- **新舞台：** 清空怪池，显式构造两只 `movementSpeed=100` 的 rat：
  fast 从 50 tick 开始，follower 从 100 tick 开始并确定驱动第二轮。
- **被测性质不变：** fast 仍必须恰行动一次，并在两轮推进后留下
  50 tick；玩家 tick 仍必须归零。

### 5. T10 金币拾取入账

- **原舞台：** 随机生成 D2--D5，取第一个 `quantity>1` 的金币堆，
  再搜第一个可站的相邻格。
- **新舞台：** 用 `ItemLoader.spawnGold` 在玩家格显式放置 quantity=137
  的金币，场上只保留该物品，直接执行 pickup。
- **被测性质不变：** 仍断言金币已入包，且账面值恰好增加
  `gold.quantity`，能继续捕获硬编码 `+10`；删掉的只是非本用例目标的
  随机金币生成和邻格移动前提。

## 2. 反向验证

以下都是临时改坏 `Game.ts` 的被测机制，定向运行对应 `-t`
用例，随后立即恢复文件；临时生产代码改动没有进入最终 diff。

| 条目 | 故障注入 | 翻红断言 / 错误消息首行 | 还原 |
|---|---|---|---|
| T7 | 跳过 `loadSnapshot` 末尾的 loopMap 重算 | `T7 跨局读档`；`AssertionError: expected [ '0,0', '7,8', '7,9', '7,10', …(258) ] to deeply equal []` | 恢复后整文件 10/10 绿 |
| T9 | 跳过 `loadSnapshot` 末尾的 waypoint 重建 | `T9 跨局读档`；`AssertionError: expected '[{"x":66,"y":21},{"x":42,"y":24},{"x"…' to be '[{"x":-1,"y":-1}]' // Object.is equality` | 恢复后整文件 10/10 绿 |
| B2a | 不再按 `soonestTurn` 递减怪物 tick | `B2a 剩余 tick`；`AssertionError: expected 150 to be 50 // Object.is equality` | 恢复后整文件 6 通过 / 4 跳过 |
| B2b | 每次怪物行动后错误多加 1 tick | `B2b 剩余 tick`；`AssertionError: expected 51 to be 50 // Object.is equality` | 恢复后整文件 6 通过 / 4 跳过 |
| T10 | 把金币入账恢复为错误的硬编码 `+10` | `T10 拾取入账`；`AssertionError: 拾取后账面应恰增加 quantity: expected 10 to be 137 // Object.is equality` | 恢复后整文件 15/15 绿 |

最后执行 `rg -n 'FAULT INJECTION' src/engine src/test`，无命中；故障注入无残留。

## 3. 最终定向运行结果

故障注入全部还原后的复跑：

- `npx vitest run src/test/p1_31_35_placement_snapshot.test.ts`：10/10 通过，
  Vitest 20.70 s（tests 16.18 s）。
- `npx vitest run src/test/p2_1_tick_architecture.test.ts`：6 通过、4 跳过，
  Vitest 6.55 s（tests 2.58 s）。
- `npx vitest run src/test/b_4b_item_placement.test.ts`：15/15 通过，
  Vitest 224.76 s（tests 219.38 s）。

遵守任务约束，没有运行无文件参数的全量 Vitest。

## 4. 改动文件

- `src/test/p1_31_35_placement_snapshot.test.ts`
- `src/test/p2_1_tick_architecture.test.ts`
- `src/test/b_4b_item_placement.test.ts`
- `ai_docs/reports/fix-randomstage.report.md`

生产代码最终改动为零；`src/test/fixtures/generation_baseline.json` 未触碰；
`BrogueCE-master/` 未触碰。

## 5. 对验收判断的复核

总体判断正确。唯一值得精确化的是第 4 条：修改前代码并非无条件取
“首只速度为 100 的生成怪”，而是取首只同时满足“存活、未关笼、速度
100”的生成怪。这不影响病灶结论：候选是否存在仍受怪池决定，而且第二轮
原本仍依赖其他生成怪。本次已把两个依赖都改为显式构造。
