# X2n：胜利高分描述按流明宝石 quantity 求和

## 0. 规格与结论

按 [任务书](../tasks/x2n.prompt.md) §0 实际指定的 [X-1b 勘察报告 §4 XB01](x-1b-survey.report.md) 执行。用户消息中的“X-0”以任务书明确引用的条目为准；本轮不扩大到 XB02、XB03，也不宣布整个 K37 已闭合。起点 HEAD：`78ca60b9072e28095dfde3a71870af212d3bb863`，入场工作树干净，Windows 本地执行。

已修复 XB01：普通胜利和超胜利的榜单描述累计 GEM 的 `quantity`。25 颗／14 来源层显示 25；单堆 3 颗使用复数 3。死亡继续按 14 个背包条目兑换 7000 金币；胜利宝石价值继续为 25×5000，零金币加护符的普通／超胜利分别为 160000／195000。没有改动生成、堆叠、RNG、翻译键或录像格式。

## 1. CE 依据与实现

以下行号均在本工作树 `../BrogueCE-master/src/brogue/` 实读核实。

| 合同 | CE 依据 | web 实现 |
|---|---|---|
| 死亡兑换按条目 | `RogueMain.c:1169–1175`，调用 `numberOfMatchingPackItems(GEM,0,0,false)` 后乘 500；`Items.c:3854` 起逐背包条目计数 | `Endgame.ts:30` 的 `deathLumenstoneEntryCount`，只供死亡分数使用；原计算结果不变。 |
| 胜利描述按颗数 | `RogueMain.c:1312–1313` 的 `gemCount += theItem->quantity`；`:1364–1370` 按 0／1／复数选择描述 | `Endgame.ts:35` 新增 `victoryLumenstoneQuantity`；`Game.ts:10592` 改为使用它，原翻译及存储链保持。 |
| 胜利物品价值 | `Items.c:8861–8867`：护符 35000，GEM 为 `5000 * quantity`；`RogueMain.c:1315–1320`：超胜利护符翻倍 | `itemValue` 和胜利分数分支完全未改；easy 除 10 的既有合同保持。 |

生产变更仅为 `src/engine/Core/Endgame.ts`、`src/engine/Core/Game.ts`。删除含混的共享 `lumenstoneCount` 名称，分成两个明确函数，不保留兼容别名。`HighScores.ts` 保存／读取正确的新结算描述；`GameEndOverlay.vue:30,81–84` 原样消费榜单数据，已通过真实浏览器验证。历史榜单只保存描述快照，本轮未迁移历史记录。CE 摘录见 [ce-evidence.json](x2n-evidence/ce-evidence.json)。

U27 的结局 checkpoint 只保存 `won/superVictory/score`，本来不存描述；本轮不扩展格式。新增测试实际执行普通出口／D40 portal 命令并录制、镜像夹具回放，检查两条 RNG、位置、深度、结局分数和 cursor，无 OOS，回放也不重复写榜单。

## 2. 旧前提修正与回归证据

任务书明确授权纠正的前提，按以上 CE 行号直接修正：

- `u_26a_deep_levels.test.ts` 原第 249 行的胜利描述从 14 改为 25，并就地注明 CE 行号。其余三处调用仅随函数重命名，原堆数 2／14 和死亡兑换断言全部保留；三 seed 自然生成与真实拾取、存读、楼梯／portal 流程未改。
- 当前 U26b 没有直接断言“胜利描述按条目数”的代码，但“胜利 itemValue 才乘 quantity”的注释容易延续该推广。已更正注释，在已有普通／超胜利 fixture 中新增一堆两颗必须显示 `2 lumenstones` 的榜单断言；死亡 1734／2234、胜利 46234／81234、easy 8123 的断言原样保留。

历史 [U26a 报告第 30 行](u-26a.report.md) 的“CE 高分描述与死亡兑换统计的是 GEM 背包条目数”结论错误，由本报告以上 CE 依据更正。历史报告本身保留，不能继续以其旧结论验收胜利描述；U26b 的死亡裁决仍正确。

新增 [x2n_lumenstone_description.test.ts](../../src/test/x2n_lumenstone_description.test.ts) 共 10 项：普通／超胜利各覆盖零颗、单颗、单堆三颗、25 颗／14 堆，以及各一个真实终结命令的录制／回放。混入护符，并核对死亡分数、胜利分数、持久化描述和结算不消费 RNG。

在旧生产代码上先运行新增专项，**4 passed、6 failed**；六项失败均为多颗宝石的高分描述，分数断言已通过，见 [before-fix.json](x2n-evidence/before-fix.json)。仅完成上述计数拆分后，包含 X2n、U26a/b、U27、p1_24、p1_30、U24 的定向批次 **7 文件／68 项全部通过**，见 [targeted.json](x2n-evidence/targeted.json)。无需修改其它守卫或重录黄金 trace。

## 3. 真实界面验证

使用 [scripts/x2n-browser.mjs](../../scripts/x2n-browser.mjs)、本地 Vite `127.0.0.1:5199`、Playwright＋本机 Edge，视口 1440×960。从真实菜单进入 seed 777，明确设置 25 颗／14 来源层背包、零金币及终点地形夹具，执行真实楼梯／portal 命令；结算、localStorage、录像 checkpoint 和 Vue 组件均为生产路径。

| 结局 | 分数 | 实际榜单描述 | 截图 |
|---|---:|---|---|
| 普通胜利 | 160000 | 逃出了末日地牢，携带25颗流明宝石！ | [escaped](x2n-evidence/browser-escaped.png) |
| 超胜利 | 195000 | 征服了末日地牢，携带25颗流明宝石！ | [mastered](x2n-evidence/browser-mastered.png) |

页面与 console 错误列表为空；截图已逐张查看，描述可读、没有裁切。结构化结果见 [browser.json](x2n-evidence/browser.json)。这些是终结事务的受控夹具，截图中最深层统计仍为起始值，不冒称自然全程通关；自然地图到 D40 的链由未改变流程的 U26a 三 seed 守卫验证。浏览器和临时 Vite 服务已关闭。

## 4. 门禁与反查闭包

冻结后由 [scripts/x2n-verify.mjs](../../scripts/x2n-verify.mjs) 顺序运行 build、test:drift、完整 npm test，不修改测试配置、超时、排除规则或基线。

| 门禁 | 最终结果 | 证据 |
|---|---|---|
| 完整 `npm test` | **214 文件，3959 passed，0 failed，8 pending，5 todo**，总计 3972 项；退出码 0。13 个未执行项与既有记录逐名称／状态一致，没有新增跳过。 | [full.json](x2n-evidence/full.json)、[命令及起止时间](x2n-evidence/full-run.json)、[文本日志](x2n-evidence/full.txt) |
| R∪S | **98 文件，2137 passed，0 failed**；原有 8 skipped／1 todo 保持。所有文件均从最终全量和独立 drift 的结果中逐项核对，没有漏跑文件。 | [rs-results.json](x2n-evidence/rs-results.json) |
| `npm run build` | Vue／TypeScript 检查和 Vite 生产构建通过，退出码 0。 | [build.txt](x2n-evidence/build.txt)、[命令记录](x2n-evidence/build-run.json) |
| `npm run test:drift -- --maxWorkers=1` | 原 4 seed × D1–26 基线 **1/1 通过**，退出码 0。 | [drift.json](x2n-evidence/drift.json)、[命令记录](x2n-evidence/drift-run.json) |
| 深层与终局 | U26a 深层基线 **1 项**、深层专项 **16 项**、U26b **5 项**、U27 **5 项**、X2n **10 项**在最终全量中全部通过。 | 同 full.json；前期定向 68 项亦全部通过。 |
| 浏览器 | 两种胜利的中文榜单、分数、持久化记录和结局 checkpoint 正确；页面／console 错误 0。 | [browser.json](x2n-evidence/browser.json) |

最终完整命令：`npm test -- --maxWorkers=2 --reporter=json --outputFile=ai_docs/reports/x2n-evidence/full.json`。仓库原脚本只排除 `generation_baseline.test.ts`，由独立 `test:drift` 补全。全量从 **2026-09-27 15:00:07.291 到 16:11:11.741（UTC+08:00）**，完整运行 **71 分 4.450 秒**，进程正常退出 0。没有以中途输出代替完成结果。

运行期间曾准备提高并发，但收取进程结果时发现原运行已在该计划之前正常结束，因此**实际没有中断或重启，也没有第二次全量运行**；见 [completion-timing.json](x2n-evidence/completion-timing.json)。

R 定义为任务指定的 p1_30、U24、U26a/b、U27、p1_24、浅／深层生成基线，加上实际引用 Endgame、HighScores、gameOver、triggerGameOver、录制／回放或 Inventory 的测试，以及 quantity 存读往返守卫；S 保守收集整个 `src/` 下直接或经本地导入闭包调用文件读取的测试，包含 `i18n_scan` 间接源码扫描和 `src/engine/Combat/BoltCatalog.test.ts` 的 CE 源码读取。R **35** 文件、S **75** 文件、并集 **98** 文件，清单见 [rs-closure.json](x2n-evidence/rs-closure.json)。全量加独立 drift 覆盖整个并集，包含 U-R2/R3/R4 黄金 trace 和全部读源码守卫，没有按绿灯筛选子集。

首次沙箱内测试因 esbuild 子进程 `spawn EPERM` 无法启动；在自动审核允许的本地扩展权限下重新执行。该启动错误发生在收集测试之前，不作为断言失败或跳过。构建只有既有体积提示，无类型或打包错误。

## 5. 最终复跑声明

生产、测试和构建输入于 **2026-09-27 14:58:58.052（UTC+08:00）** 冻结，随后在该版本上完成 build、独立 drift、浏览器和完整 npm test。初始 926 个源码／测试／public／脚本／配置输入的 SHA-256 见 [frozen-inputs.json](x2n-evidence/frozen-inputs.json)；最终 **925 个字节不变**，没有丢失文件。

唯一输入差异是本轮新建的 `scripts/x2n-verify.mjs`：把清单扫描从 `src/test/` 扩大到整个 `src/`，补入就地存放的 CE 源码守卫与 quantity 存读守卫，并在审计中单列该验证工具自身的变化。它没有改变 npm 的测试发现或执行范围；这些文件本来就在同一次完整全量中。初始记录未回填，旧／新脚本 SHA 都保存在 [verification-summary.json](x2n-evidence/verification-summary.json)。**生产、测试、public、构建配置及依赖输入零变化**，无需因纯清单修正重跑行为测试。

37 个受保护文件（全部既有 test fixtures、浅／深层基线测试、U-R2/R3/R4 黄金 trace、package.json、vite.config.ts）的 SHA-256 全部与 HEAD 一致，见 [baseline-integrity.json](x2n-evidence/baseline-integrity.json)。没有改动或重录任何生成基线／黄金 trace，没有改动 CE 源码。全量与独立 drift 的门禁、全部闭包文件状态、原有 skipped/todo 名称及状态、冻结输入和 LF 检查均通过，见 verification-summary.json。

最终 `git diff --check` 通过；新增／修改文本均为 UTF-8/LF，没有 CRLF。HEAD 保持 `78ca60b9072e28095dfde3a71870af212d3bb863`；暂存区为空。报告整理期间只补写报告及证据，没有再修改生产或测试代码。

本轮没有执行 `git add` 或 `git commit`。报告只关闭 X-1b 的 XB01；其它深层内容、完整自然 D1→D40 录像和浏览器深层存储容量等未在本轮扩大结案。
