# X2d：附魔 / 解除诅咒卷轴 CE 对齐

基准 `6325f2a8ded2b4fd0d1429bbd497010efedaf308`，Windows 本地执行，2026-09-27（Asia/Shanghai）。任务书 §0 实际指向 [X-1 §4 N03/N04、§7.1](x-1-survey.report.md)；同时回读了 [X-0](x-0-survey.report.md) 的物品/卷轴域背景。以本树 `BrogueCE-master` 的实际代码为权威。

**生产修复及完整终验已完成。全量 3843 项通过、4 项失败；失败均为已用反事实证明的原守卫旧语义冲突，留待验收方裁决，不能宣称门禁全绿。没有修改既有测试断言，没有提交或暂存 git。**

## 1. 实现与 CE 依据

| 范围 | 本树 CE | 最终行为 |
|---|---|---|
| 目标 | `Items.c:7819–7839` | `canEnchantChosenItem` 接受包内武器、护甲、戒指及既有合格 STAFF/WAND/CHARM；未装备、已装备护甲与武器并存、投掷堆都可选。必须是当前背包中的原始对象；沿用 W-7 对畸形资源、无 CE 充能表的退池魔杖的拒绝。 |
| 通用次数 | `Items.c:7839`；`enchantMagnitude:1822`、`GlobalsBrogue.c:685` | 普通附魔卷轴 power=1，每次成功选物 `timesEnchanted++`，含杖、魔杖、护符。 |
| 武器、护甲 | `Items.c:7841–7851、7880–7882、8662–8665` | 选中的实例 E+1、力量需求 `max(0, old-1)`；不自动换装，不改变其他装备。装备消费者按当前实例计算；附魔当前护甲按 CE 强制重装备清除 DONNING，不重新等待、不清 maxStatus，附魔备用护甲不影响正在穿的那件。 |
| 弹药组 | `Items.c:7844–7846` | 数量保持；武器已有非零 `quiverNumber` 时仅调用一次 `randRange(1,60000)`。真实分出/拾回沿用新组号，与旧组不再合堆；CE 允许抽回同一个号码，未擅加排重重掷。 |
| 戒指与魔法资源 | `Items.c:7852–7871` | 戒指 E+1、未鉴定有效附魔随次数提高；已装备千里眼继续更新视野。STAFF 的 E/容量/剩余次数/500÷新E 倒计时、WAND 按出生下界补次数、CHARM E+1 并回充，复用 W-7/U15b/U15c。 |
| 解咒 | `uncurse:7740–7745`、附魔 `7892`、解咒卷轴 `7806–7814` | 附魔目标无条件清诅咒；E=-3→-2 仍解除。解咒卷轴遍历全包，只清 flag，所有负 E、力量、次数、符文保持；不影响地面物品。 |
| 消息与鉴定 | `Items.c:7817–7818、7883–7899、8019–8026` | 附魔卷轴先自亮、再强制选物，物品闪耀后如有诅咒发解咒消息。解咒卷轴按有/无效果各发一条整包净化消息，两种情况均消耗、结算一次回合并自动鉴定卷轴。 |
| 随机符文 | 附魔分支没有授符文分支 | 删除原 20% 随机授符文和额外骰子。保留出生符文生成，未修改 ItemLoader 或任何生成逻辑。 |

主要代码为 [ItemUseCoordinator.ts](../../src/engine/Items/ItemUseCoordinator.ts)、[Game.ts](../../src/engine/Core/Game.ts)、[WholeRunSnapshot.ts](../../src/engine/Core/WholeRunSnapshot.ts)。旧私有 `enchantEquippedItem` 名称保留供已有直接调用者使用；玩家选物始终显式传入选中实例，共享同一个实现，不保留旧随机路径。

### 本树 CE 的收尾别名行为：不能简单写成“附魔总会/总不会揭示符文”

`readScroll` 开头复制 `itemTable scrollKind`，附魔选物后却把 `theItem` 改成了目标。函数末尾 `8019–8026` 使用**原卷轴是否已知**，同时比较**目标种类编号**与 `SCROLL_ENCHANTING=0`、`SCROLL_IDENTIFY=1`，满足时调用 `autoIdentify(theItem)`。`autoIdentify:6751–6766` 会揭示已有的 `ITEM_RUNIC`，但不会制造符文、也不等于完整鉴定装备实例。

因此首次读取未知附魔卷轴时，dagger/sword、leather/scale 等编号 0/1 的目标不因收尾揭示；broadsword、chain mail 等编号 ≥2 的目标会揭示已有符文。原卷轴已知时不触发这段收尾。相同条件也可识别编号 ≥2 的原生杖/魔杖/戒指种类。护符表原本已知，无新增效果。这是**当前 CE 树的可观察行为**，本轮遵照任务“冲突以 CE 为准”，没有根据猜测修正其 C 代码。

[独立 C 提取脚本](../../scripts/x2d-ce-oracle.mjs)编译并执行原文附魔 case、收尾、identify/autoIdentify/uncurse，得到 [36 个 C 样本](x2d-evidence/ce-oracle.json)；[生成的 C](x2d-evidence/ce-oracle.c)保留完整提取段，UI/重装备更新端口为空实现，唯一弹药组随机端口计数并返回固定 8929。它验证控制流/旗标/资源，不宣称全 CE RNG 或 UI 等价。

为跨待选存档保留原卷轴知识，新增 `pendingEnchantmentScrollWasKnown`，仅待选时写入 `run.enchantmentScrollWasKnown`；待选档缺失或非布尔值被拒绝，完成/新局重置，普通快照省略。已在 [U03 生命周期合同](../../scripts/u03-state-contract.json)登记这一真实新增字段，未修改 U03 的字段等式或其他断言。专项测试覆盖已知/未知两种 pending JSON 往返与缺字段拒绝。

## 2. UI、回放及专项测试

[34 项专项测试](../../src/test/x2d_scroll_equipment.test.ts)全部通过：[结果](x2d-evidence/new-summary.json)。覆盖六类目标、原始对象资格、负 E、力量下限、次数、知识状态、弹药组精确骰子与拆分回堆、已穿/备用护甲的 DONNING 正反例、只变选中备用装备、全包/地面边界、消息/自亮、存档，以及同步/动画命令回放。

CE `Items.c:7824–7836` 是强制选择循环：**卷轴已读后不能取消整个附魔**。Escape、取消目标、物品 cancel、无效目标均不退卷轴、不推进回合、不耗 RNG；成功选物才完成一次回合。读卷轴前关闭背包则是免费取消。本轮保持这一区别，没有把任务书“取消附魔选择”解释成退款/撤销。

[浏览器脚本](../../scripts/x2d-browser.mjs)使用独立无头 Edge 和 Vite、真实 Vue 背包操作、固定 seed 27027。初始包为明确的合成夹具，回放新局初始化后按相同步骤重建；未替换任何游戏方法或 checkpoint，不宣称自然寻获这些物品的整局录像。实测 8 个合格目标高亮、六类中文提示、隐藏其他动作/禁用关闭、Escape/遮罩/无效选择不消耗、未装备长剑 -3→-2 且解咒、15 支飞镖整堆附魔、全包解咒与空效果消息；**16 条真实 UI 命令全部回放，双流/资源/回合一致、零 OOS、零 page/console error**。证据：[状态和命令](x2d-evidence/browser.json)、[选物截图](x2d-evidence/browser-selection.png)、[结果截图](x2d-evidence/browser-result.png)，截图均实际打开检查。普通解咒动画结束后若背包仍开，脚本通过真实关闭按钮关闭，再继续操作。

旧单物品解咒、随机符文觉醒和笼统装备强化文案的死键移入 `zh_CN.legacy.json`；主中文提示更新为完整目标类别。P1-30/U24 源码和键检查通过，未放宽扫描门。

## 3. 原守卫冲突与反事实证据

修改前原 W-7、invented_content_pool、P1-37 三文件 **46/46 通过**：[before](x2d-evidence/before-summary.json)。只在测试进程内注入单个旧行为的[反事实脚本](../../scripts/x2d-counterfactual.mjs)/[配置](../../scripts/x2d-counterfactual.config.ts)，保留原测试、断言和生产文件，结果见 [counterfactual-summary](x2d-evidence/counterfactual-summary.json)：

| 原守卫 | 恢复的单一旧行为 | 结果与裁决建议 |
|---|---|---|
| W-7 `arcana alternative...` 第255行 | 武器护甲仅允许优先已装备件 | 原用例通过，而新“全部合格包内物品”用例失败。旧否定对象本来是合法包内备用武器；可由验收方将拒绝对象前提改为地面/已移除实例，保留拒绝断言，同时保留本轮包内接收正例。 |
| invented_content_pool `8000 次附魔...` | 仅恢复 20% 授原生符文及其文案 | 原池用例和 P1-37 AD5c 通过；新零耗骰/弹药组精确耗骰测试失败。原反真空断言要求授符文 >1000 次，与 CE 没有该功能直接矛盾，无法靠保留期望的诚实前提修复；交验收方决定迁移出生池抽样或撤销到期的附魔授符文断言。 |
| P1-37 AD5c | 同上 | 强制 `randPercent=true` 期待“觉醒了”来自已删除功能；CE 条件式揭示既有符文没有授新符文。不能重造旧消息来迎合守卫。 |
| P1-37 AD5a 解咒文案 | 仅恢复旧单物品“不再受诅咒”消息 | 原用例通过，新 CE 整包净化消息用例失败；全包旗标处理保持不变，隔离出纯文案前提。原来要求的字串已到期，应由验收方对存活的整包消息续接中文渲染守卫。 |

六次正/反控制运行均符合预期。**本轮没有改写以上四条原断言，也没有用不同的测试入口绕过真实附魔行为。** 必要的新增状态合同登记与旧语义期望裁决分开处理。

## 4. 门禁、冻结与交付

反查使用 AST 相对 import 的逆依赖 R，加源码读取/物品生命周期/任务指定系列 S，见 [closure](x2d-evidence/closure.json)。最终并集 **198 文件**；含 P1-30、U24、U01/U03、U27、UR2、W-7、U15b/c/d、scroll_effects、b_1*、invented_content_pool、P1-37 和全部读源码守卫。完整 `npm test` 覆盖并集除 generation_baseline 外所有文件；该文件另由 `test:drift` 执行。

| 检查 | 最终结果 |
|---|---|
| 完整全量 `npm test -- --maxWorkers=6` | 完整结束，204 文件；3860 项中 3843 通过、4 失败、8 skipped、5 todo；退出 1，2239.129 秒。四项失败恰为 §3 所列，无其他失败。见[摘要](x2d-evidence/full-final2-summary.json)、[原始结果](x2d-evidence/full-final2.json)。 |
| 构建 `npm run build` | 退出 0，28.447 秒；[日志](x2d-evidence/build.txt)、[摘要](x2d-evidence/build-summary.json)。仅既有大 chunk 提示。 |
| 漂移 `npm run test:drift -- --maxWorkers=2` | 1/1 通过，退出 0，71.551 秒；[日志](x2d-evidence/drift.txt)、[摘要](x2d-evidence/drift-summary.json)。 |
| C 原文 oracle | 36 样本；符文条件偏差 0 |
| 专项 | 34/34；同步与动画回放通过 |
| 浏览器 | 16/16 命令，0 OOS，0 页面/控制台错误 |
| 基线、原守卫和 LF | 10 个受保护文件哈希不变；既有测试文件改动 0、CRLF 0、闭包漏测 0、暂存文件 0；`git diff --check` 通过。见[交付审计](x2d-evidence/delivery-check.json)。 |

最终全量于 2026-09-27 05:41:54—06:19:13（Asia/Shanghai）完整运行；363 个源码、资源、配置及 trace 输入的前后 SHA 全部一致。P1-30、U24、U01/U03、U27、UR2、U15b/c/d、scroll_effects、b_1* 与深层基线均通过；W-7 仅 §3 指定的旧目标范围断言失败。8 个 skipped 与 5 个 todo 均为仓库原有登记，逐项列在交付审计中，本轮未新增、未移除。深层基线原测试 1/1 通过，69.794 秒；漂移基线另以原 `test:drift` 命令通过。

前两次全量预检启动后分别补齐了 CE 收尾自动鉴定、强制重装备的 DONNING 清除，已不能作为终验。为减少重复运行占用，06:15 停止了这两轮预检，分别运行 4323.294 / 3086.476 秒，**没有完整结果，不计入门禁通过**；保留[第一次运行记录](x2d-evidence/full-summary.json)、[第二次运行记录](x2d-evidence/full-final-summary.json)。最终完整运行在所有生产/测试源码和 U03 合同冻结后启动，[终验摘要](x2d-evidence/full-final2-summary.json)逐项登记失败与运行前后 SHA；[终验原始 JSON](x2d-evidence/full-final2.json)保留完整结果。构建与 drift 也在最终冻结后复跑。

本轮未改生成代码、`test:drift` 配置、浅/深生成黄金值、UR2 trace 或原测试文件。UR2 原夹具实际覆盖 identify 卷轴而非 enchanting/remove curse，本轮未产生 trace 差异、无需重录；新增专项和 UI 录像补足这两个入口。[10 个受保护文件哈希](x2d-evidence/baseline-before.json)与[最终比较](x2d-evidence/baseline-after.json)、[交付检查](x2d-evidence/delivery-check.json)记录不变性。

复现命令在 `brogue-web` 下执行：`node scripts/x2d-ce-oracle.mjs`、`node scripts/x2d-validate.mjs new`、`node scripts/x2d-counterfactual.mjs`、`node scripts/x2d-browser.mjs`、`node scripts/x2d-audit.mjs`、`node scripts/x2d-validate.mjs full-final2`、`node scripts/x2d-validate.mjs build`、`node scripts/x2d-validate.mjs drift`、`node scripts/x2d-final-check.mjs`。C oracle 需要 clang；浏览器脚本使用本机 Edge。未提交 git。

## 验收方裁决（4 处旧守卫前提）

均依 CE Items.c:7740–7899，随被删 web 自创功能到期或因 CE 目标范围扩大而前提失效；守卫目的保留：
1. W-7 :255 拒绝对象由"卸下但仍在包内的匕首"（CE 下合法）改为"已离开背包的实例"，拒绝断言保留。
2. invented_content_pool 8000 次附魔：自创符文 0 次断言保留；旧"反真空 >1000 次授予"随授符文功能到期，改为授予**任何**符文均为 0（严格更强）；符文池完整性由同文件出生路径抽样负责。
3. P1-37 AD5c：改为反向守卫——强制掷骰命中下附魔不产生 runicType、无"觉醒"消息。
4. P1-37 AD5a：单物品"不再受诅咒"文案随旧行为到期，改守新整包净化消息的中文渲染，并加断言负附魔保留（CE uncurse 只清旗标）。
四文件 + X2d 专项 80/80 通过。
