# V-2b-9b 收尾轮（第二次补完）

> **在分支 `round/v-2b-9b` 上执行**。产物完好，只剩 12 条。

## 0. 先读两件事

### 0.1 云端环境是好的——上两轮的「30 秒被终止」判断错了

你连续两轮申报「平台约 30 秒窗口，被环境终止」。**验收方派了探针实测**
（`ai_docs/reports/cloud-env-probe.md`，已在本分支）：

```
node v20.20.2 · npm 11.4.2 · nproc 3 · 18 GB RAM · 磁盘 30G 可用
node_modules 完整（133 项）
npx vitest run src/test/smoke.test.ts  → 34.7s，退出码 0
npm run build                          → 31.7s，退出码 0
```

探针自己的结论：**「所有命令均正常退出，没有超时或被环境终止。」**

所以不是额度、不是 setup script、不是代理。**最可能是你自己 agent 层的单命令
超时被误读成环境终止。** 本轮请：给长命令留足预算、一次只跑一两个文件、
**命令返回后先确认有没有 Vitest 汇总行再判断成败**——没有汇总不等于被环境杀，
也可能是你提前放弃了。

⚠️ **但有个真数字要记住：云端只有 3 核。** 全量门禁 135 分钟 CPU ≈ **45 分钟**
墙钟（本地 10 核是 13 分钟）。**所以仍然绝对不要跑不带参数的 `npx vitest run`。**
分批是对的，理由从「会被杀」改成「核少所以慢」。

### 0.2 验收方撤掉了你上一轮的区域机器接线，并承认那是验收方出的错

上一轮任务书 §4 让你「把复核接到 CE `:1196-1201` 的区域机器路径」。
**那个处置本身是错的，你照做没有错。**

真相：CE 有两条 interior 来源——`BP_ROOM` 走 `findSuitableRoom`，区域机器走
`:1140-1195` 的「从 origin 起 Dijkstra 逐壳生长」，`:1196` 的复核属于**后者**。
而 web **只有前者**（`buildAMachine` 的 `else` 分支注释自陈"web 全部非前厅蓝图
的形态"），**区域机器 interior 生长这个机制根本不存在**。

嫁接到 BP_ROOM 路径的实测后果：65/66 的 `REQUIRE_BLOCKING` 拿到的是
`findGateRoom` 的门房 cells，几乎必然失败 ⇒ 每次 `continue` 重摇蓝图，
空转吃掉机器预算，**把 Kennel 饿死**（`v_2b_6_keys` E1/F2：8 seed × D1-26 建成 0 台）。

验收方已在 `492baa4` 撤回该钩子、退为登记占位，并把前厅头注改成事实。
**本轮不要把它加回来。** 区域机器 interior 生长登记为独立机制轮（9e）。

## 1. 十二条（验收方本地全量门禁实测，`492baa4` 之后）

### A 类：穷举表顺延（5 条）——机械

```
c_4a_terrain_catalog   expected 126 to be 124
r_1_appearance         expected 126 to be 124
c_7_lighting           expected [Array(27)] to deeply equal [Array(26)]
c_4b                   seed=777 D9 (64,21) 两层组合 0:2 1:103 不属于任何已知合法形态
c_4b/其一              CE 目录上沿实测值（GlobalsBrogue.c:365 的 55 号 Worm tunnels）: expected 180 to be 175
```

前三条是 `MACHINE_CHASM_EDGE` + `PUDDLE` 两个新成员（124 → 126）。

第四条是**新地形叠层组合**：`0:2 1:103` 指 DUNGEON 层 2、LIQUID 层 103。
查清 103 是哪个新成员、这个叠法合不合法，**合法就把它加进"已知合法形态"表并
说明为什么**，不合法就是落位缺陷。

第五条：`roomSize[1]` 上沿从 175 变 180，因为 **31 号 `{80,180}` 顶掉了旧上沿
55 号 Worm tunnels**。验收方已核对 CE `GlobalsBrogue.c:378`，**180 是真值**。
按留痕反转改写：新上沿是 31 号的 180，并说明它取代了谁。

### B 类：生成流顺延（3 条）

```
p1_33   A−B（网格派生 − ∪mr.cells）变动（选中层 D2）
v_1b    替代集合载体集变动：核对 CE GlobalsBrogue.c 原表，并重捕获 generation_baseline
p1_37   PERMIT_BLOCKING 载体数（V-2b-4 基线 26；V-2b-5 +1；V-2b-6 +3；V-2b-7 +9…）
```

九条蓝图入池必然动这些。**逐条核对 CE 原表后顺延到实测值，沿用各自注释里的
沿革格式**（它们都记着历轮的增减来源，照格式补 V-2b-9b 一行，写明哪几条蓝图
贡献了增量）。**不许放宽为下限或 contains。**

### C 类：要诊断的（3 条）

#### C1 `c_6_autogenerators` AD-8

```
AD-8 接线：generateTerrain 跑非机器趟且真的长草/树；generateLevel 跑机器趟
AssertionError: expected 0 to be greater than 0
```

某个计数归零了。**查清是"非机器趟不再长草/树"还是"机器趟没跑"。**
本轮新增地形/DF 有没有挤掉草木落位？这是覆盖门，**不要直接放宽**。

#### C2 `v_2b_9b_environment` 第二条——**这条是验收方撤钩子造成的，由你改**

```
区域机器路径按 CE :1196-1201 复核 TREAT，并以失败结果驱动换位重试
AssertionError: 切断区域返回 false，buildAMachine 据此 continue 换位: expected true to be false
```

区域路径已被撤回（§0.2），所以这条断言的前提没了。**按留痕反转改写**：
断言当前事实——判据存在且被前厅路径消费，但**区域路径未接线、零活载体**，
并在用例名里点明这是等 9e 激活的占位。

⚠️ **顺带修一个舞台缺陷**：这条用例建的是 `new Grid(15, 15)`，而
`interiorSatisfiesBlockingFlags` 里的 `blockingMap` 按 `y * DCOLS + x` 索引
（`DCOLS` 是真实地图宽度，不是 15）。**所以切断列根本没落在正确偏移上**，
"判据没检测到切断"很可能是舞台 bug 而不是判据 bug。
改用 `DCOLS × DROWS` 尺寸的舞台重验一次判据本身——**先确认判据到底对不对**，
再决定占位断言怎么写。

#### C3 `v_2b_6_keys` F1——**真死局，本轮最高优先级**

```
seed42 D15 锁 (64,24) 的钥匙 (68,3) 不可达: expected false to be true
```

**验收方已用反向实验确认它与 blocking 钩子无关**（停用钩子后仍红），
是九条新蓝图里某一条带来的。

查清是哪一条、为什么钥匙落到了不可达处。前三轮的同类死局都是
**领养链 + 落点被阻断**（`key_rat_trap` 缺 `MF_ADOPT_ITEM`、47 号
`SACRIFICE_CAGE_DORMANT` 带 `T_OBSTRUCTS_PASSABILITY`）。
本轮的嫌疑方向：涨水/塌方/岩浆这些**会改写地形的机器**，钥匙落点在效果触发后
变得不可达；或 `BP_PURGE_LIQUIDS` / `BP_PURGE_PATHING_BLOCKERS` 的实现差异。

**结论若是死局，按同类数据不变量退池留形并登记，不要改断言、不要换 seed。**

### D 类：基线（1 条）

```
generation_baseline  生成结果偏离基线 152 处
```

**最后一步重捕获。** 在 A/B/C 全部处置完之后。

## 2. 门禁跑法（按 §0.1 的实测能力重排）

云端 3 核、单文件约 30-60s、build 约 32s。按批跑，**每批之间不要猜，看汇总行**：

1. **A 批**：`c_4a_terrain_catalog`、`r_1_appearance`、`c_7_lighting`、`c_4b_dungeon_feature`
2. **C 批**：`c_6_autogenerators`、`v_2b_9b_environment`、`v_2b_6_keys`（最慢，单独跑）
3. **B 批**：`p1_33_machine_chokepoint`、`v_1b_alternative`、`p1_37_machine_flag_i18n`
4. `npm run build`
5. 重捕获基线后 `npm run test:drift`

**若某条命令没有 Vitest 汇总行，先重试一次**再断定失败——§0.1 说了，环境是好的。
仍然不要跑不带参数的全量。

## 3. 授权改动清单

沿用 `v-2b-9b-finish.prompt.md` §9，**再加** §1 里实际撞红的测试文件。

**不许**把区域机器 blocking 钩子加回来（§0.2）。
`src/test/fixtures/generation_baseline.json` 仅最后一步重捕获。
清单外改动必须申报。`BrogueCE-master/` 只读。**守卫顺延不放宽**。

## 4. 报告

写到 `ai_docs/reports/v-2b-9b-finish2.report.md`，含：

1. A 类五条的处置（特别是叠层 `0:2 1:103` 的合法性判断、上沿 175→180 的留痕反转）
2. B 类三条逐条的 CE 核对与沿革行
3. **C1 归零成因**
4. **C2：判据在 DCOLS 尺寸舞台上到底对不对**，以及占位断言最终怎么写
5. **C3 F1 的死局归因与处置**（本轮最重要的一节）
6. D 类基线重捕获
7. §2 逐批结果（**看汇总行判断，别猜**）
8. 授权反驳
