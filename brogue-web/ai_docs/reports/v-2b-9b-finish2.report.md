# V-2b-9b 第二次补完报告

## 1. A 类五条

- `TerrainType` 的穷举数由 124 顺延为 126：补完成员是 `MACHINE_CHASM_EDGE` 与 `PUDDLE`；`c_4a`、`r_1` 均继续用精确全等计数。
- 非零 `glowLight` 集合由 26 顺延为 27。复核实际新增发光成员是环境链活动态 `LAVA_RETRACTING`（保留 `LAVA_LIGHT`），不是仅带 fireType 的 `MACHINE_CHASM_EDGE`；集合仍为逐成员全等。
- `seed777/D9` 的 `0:2 1:103` 是 `DUNGEON=FLOOR` + `LIQUID=FLOOR_FLOODABLE`。31 号 Flood room 的 EVERYWHERE feature 按 CE 原表刻意把 floodable 载体写在 LIQUID 层，取钥匙后涨水链改写该层，故该叠层合法。其上再长 `GRASS/FOLIAGE` 时，唯一合法三层形态也作精确字段断言，没有把上限守卫泛化。
- `roomSize[1]` 真上沿由 55 号 Worm tunnels 的 175 改为 31 号 Flood room `{80,180}` 的 180（GlobalsBrogue.c:378），断言与沿革均反转；`CE_CHOKE_COUNT_CAP=181` 保持公式 `max+1`。

## 2. B 类三条

- `p1_37_machine_flag_i18n`：九条入池后重捕获选中层 D2，`A−B` 从 V-2b-8 的 `['5,14']` 变为精确空集；仍用 `toEqual([])`，未改为下限/contains。
- `v_1b_alternative`：核对 CE 原表后，36 号新增“拉杆/悬浮药”二选一两条，38/39 各新增“悬浮/火免”二选一两条，共 `31→38`（+7）；`MF_ALTERNATIVE_2` 仍零载体，完整对象数组保持全等。
- `MF_PERMIT_BLOCKING`：V-2b-7 后 39；本轮 36/37 隐桥、38/39 岩浆回缩、65/66 触发地板各一条，`+6 → 45`。这是逐条核对 feature flags 后的精确计数。

## 3. C1：AD-8 归零成因

非机器趟没有归零：D5 的草仍实际生成 6 格，统计存在且 `buildAreaMachines=false`。归零的是机器趟 `entries/totalBuilt`；机器趟本身确实运行（统计非 null 且 `buildAreaMachines=true`），但真实 autoGenerator 目录的 MT 条目仍全部登记为 `no-machine`，九条普通 Blueprint 并不是 MT autoGenerator 接线。旧断言错误地把“机器趟运行”与“存在 wired MT 载体”混为一谈；现改为钉死当前精确事实 `entries=[]`、`totalBuilt=0`，没有放宽覆盖门。

## 4. C2：blocking 判据与 9e 占位

原 15×15 舞台确有索引缺陷：生产 `blockingMap` 使用 `y*DCOLS+x`。改为 `DCOLS×DROWS` 后，以全花岗岩中的一格宽水平走廊验证：单格阻断返回 false，开阔区单格返回 true，判据本身正确。

占位断言同时钉死：

1. `fillVestibuleInterior` 是当前唯一消费 `interiorSatisfiesBlockingFlags(bp,cells)` 的调用点；
2. 前厅路径虽已消费判据，但生产目录中带 TREAT/REQUIRE 的活前厅载体精确为 `[]`；
3. 区域 interior 生长机制及其 CE :1196-1201 调用仍未接线，等待 9e。

本轮没有把已撤回的区域机器钩子加回来。

## 5. C3：F1 死局归因与处置

### seed42/D15 的直接现场

锁 `(64,24)` 的铁钥匙在 `(68,3)`；钥匙所在 machine #5 是 `key_nested_library`，唯一出口 `(66,4)` 被其前厅 machine #6 的 `PORTCULLIS_CLOSED` 封住。该前厅来自 `vestibule_secret_lever`。web 尚不能执行 `WALL_LEVER_HIDDEN` 的 wired 晋升，所以钥匙永久不可达。31 号入池是把 RNG 流推到该既存缺口的触发因素，并非 31 号的涨水在生成期吞了钥匙。

按同类数据不变量，将 `vestibule_secret_lever.frequency` 退为 0，结构与字段全部留形，并新增双向守卫：频率必须为 0、三个关键 terrain 必须仍完整；wired lever 激活轮再翻转。

### 后写覆盖的第二个同族缺口

退池后 F1 继续揭出 seed42/D25 “锁存在、钥匙为零”：领养 feature 选点时可走，但同蓝图后续环境 feature 能把落点改写为 pathing blocker；Game 的 P1-43 消费闸随后静默丢物，而父机器已有 `generatedKey=true`，补偿钥匙也不会生成。

处置不是改 seed/断言：在蓝图所有 feature 完成后，对 `viaAdoption` 物品按最终网格复核。落点若已是 blocker，则整机返回失败，走既有备份回滚与重摇语义，绝不把锁与零钥匙提交。最终 F0/F1（6 seed×D1-26）均通过。

## 6. D 类基线

所有 A/B/C 处置完成后，按 `generation_baseline.test.ts` 的原字段口径重捕获 `generation_baseline.json`。漂移来源包括九条蓝图入池、穷举载体闭包，以及本轮新增的领养落点最终态否决/secret-lever 退池；重捕获后 `npm run test:drift` 通过。

## 7. 分批结果

- A 批最终态：首次复跑抓到新增合法三层形态与实际发光成员辨认错误，按 CE/目录字段修正后再跑。
- C 批：`c_6_autogenerators` 20 条通过；`v_2b_9b_environment` 4 条通过；`v_2b_6_keys` 最终完整文件 18/18 通过（含 F0/F1）。
- B 批首次汇总：`p1_33` 通过；精确撞红为 `A−B=[]`、alternative +7，另以旗标普查测得 PERMIT 45，均已按全等顺延。
- `npm run build`：通过（Vite 801 modules transformed）。
- `npm run test:drift`：1 文件/1 用例通过，含 Vitest 汇总行。

所有长命令均等待 Vitest `Test Files/Tests/Duration` 汇总后判断，没有把 agent 轮询等待误报成环境终止。

## 8. 授权反驳与清单

- 任务书说“九条新蓝图里某一条带来的”若理解为新蓝图自身地形直接封钥匙，并不符合现场：D15 的直接封口者是既存 `vestibule_secret_lever` 的未实现 wired portcullis；31 号只是生成流触发器。按授权反驳条款，以坐标、machineNumber 和地形现场为准退池真正不安全的蓝图。
- C1 的“机器趟没跑”也不成立：趟已跑但 MT 目录零 wired 载体。
- 清单外改动申报：为修复 F1 的真实生成不变量，改动了授权引擎文件 `BlueprintEngine.ts` 与撞红测试 `v_2b_6_keys.test.ts`；`blueprints.json`、基线 fixture、列出的 A/B/C 测试均在继承授权内。`BrogueCE-master/` 只读未改。
