# UR1 实体编解码与数据投影报告

## 范围与实现

- 依据 `ai_docs/reports/x-0-survey.report.md` 的 UR1 行执行。`WholeRunSnapshot.ts` 承接 `LevelSnapshot`、`GameSnapshot` DTO、层与整局投影、验证、世界实体和层解码、玩家投影与运行态 JSON 投影。`Game.ts` 保留 `toSnapshot`、`loadSnapshot`、`isSnapshot`、`snapshotLevel`、`serializeItem`、`deserializeItem`、`serializeMonster`、`deserializeMonster`、`restoreMonsterLeaders` 原入口与 `this` 语义；活跃局面的替换、回调绑定及视野重建仍由 Game 协调。
- `EntitySnapshot.ts` 增加实体构造与 ID 分配端口。Game 显式传入 Item/Monster 快照构造器和 ID 分配器；整局投影显式接收 RNG 状态、种类识别与口味数据、奖励房计数读取函数。Monster 行自带完整 `form`，解码无需种类表查询、无新增掷骰。
- 保留原有字段及枚举顺序、`undefined`/`null` 区别、默认值、错误文案、异常捕获边界。`savedAt` 是唯一逐次变化的整局字段。U01/U03 字段合同 JSON 和 `test:drift` 脚本未改。
- Game.ts 行数（原始字节按换行统计）：**11,475 → 11,310**，减少 165 行。

## 等价证据

- 新增 `src/test/u_r1_codec.test.ts`：Game 方法与独立 Item/Monster codec 逐字段比较；覆盖休眠怪、携物怪、关系指针循环、机器钥匙、坠落怪物/物品队列和录像字段。整局投影与 Game 包装在同一输入上去掉 `savedAt` 深比较；显式解码检验实体关系、玩家背包及休眠归属；投影和构造前后比较 `rng.getState()`，其中包含两流状态和各自计数。
- 既有 p1_30、U00/U01/U03/U03b、U24、U27、`snapshotQuantity`、`b_1b`、`p1_31_35`、W-16/17/18/19/20/21/23 与旧 fixture 均属于完整回归集；W-22 历史报告明确未交付生产代码或对应运行时测试。U03 还覆盖多层已访问、关系循环、掉落和 JSON 读档。反查了 `src/test` 与 `scripts` 的源码读取点；现行守卫依赖 Game 类字段或保留的方法入口，没有指向已搬走的方法体的现行断言，因此无需迁移或放宽守卫。
- `git diff --check` 通过；所有改动文件为 LF，无 CRLF。

## 最终门禁

- `npx vitest run` 指定风险闭包 18 文件：**470/470 通过**（最终代码，含新增 UR1 等价测试）。
- `npm run build`：通过（`vue-tsc -b` 与 Vite 产物）。
- `npm run test:drift`：**1/1 通过**，未修改基线或脚本。
- 完整 `npm test -- --maxWorkers=4`：**185/185 文件通过；3,596 通过，8 跳过，5 待办**（共 3,609）。这是最终代码状态下的复跑；仅在测试结束后补写报告，未再修改被测代码、测试、基线或门禁。

未提交 Git。
