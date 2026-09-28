# X3-U8b：装备力量提示、回避旗标与装备细节

执行日期：2026-09-28–29（macOS）；基线 `0409de1d5486d7e675b496d8023f06ad9814ba89`。

任务书：[x3-u8b.prompt.md](../tasks/x3-u8b.prompt.md)。权威规格：[X-3 勘察](x-3-survey.report.md) 的 A08/A09/A10。

## 范围与实现

只改 `Game.ts` 的 `equipItem`、`unequipItem`、`dropItem`、`throwItemAt`、`pickUpItemAfterDisplacement`、`recomputeExplorePath`，新增就地 `markPackFull`；`performPlayerAction` 仅显式 pickup 的满包消息分支，`applyCommand` 仅 equip 参数接线。移动、麻痹、幻觉段、TimeCoordinator、Player 与地图目录未改。配套改动是背包装备交互、zh_CN 文案、Item.flags 注释、U03 合同、新守卫和执行脚本。

| 条目 | CE 依据 | 实现与边界 |
| --- | --- | --- |
| A08 | `Items.c:3925–3958 strengthCheck` | 装备成功后对武器/护甲提示；比较 `strengthRequired > effectiveStrength`，差值减去 `max(0, strength - weaknessAmount)`。使用不带附魔/符文细节的本地化名称，不改任何属性计算、数值或 RNG。 |
| A09 满包 | `Items.c:865–934` | 保留金币和可堆叠物例外；步行与显式拾取失败均输出 `Your pack is too full to pick up X.` 并置 ITEM_PLAYER_AVOIDS。再次探索不选该物品。 |
| A09 丢弃/投掷 | `Items.c:8386,6873,6857` | 丢弃的实际落地件置位，分堆不污染背包剩余件；投出件先置位，仅对怪物攻击未命中的武器清位。向空地/墙投武器仍保留回避。 |
| A09 消费 | `Movement.c:2175,2235`；手动移动拾取 `:1465–1467` | 可见及记忆物品目标均排除回避品；自动行进经过该格跳过拾取。手动走回或显式 pickup 仍可取回，遵循 CE 手动拾取入口。既有移动流程在物品格停步保留，本任务不改移动段，也不改路径数值。 |
| A10 戒指 | `Items.c:3983–4003` | 已戴戒指专用拒绝；双槽满时显示 CE 选择提示，背包高亮两枚已戴戒指；选左/右均可，内部卸装复用 U3 诅咒门，只耗一个回合。取消、非法目标、诅咒拒绝不改变装备、时钟或 RNG。 |
| A10 卸装/丢弃 | `Items.c:8319–8327,8352–8357,8393–8396` | 未装备输出 `your X was/were not equipped.`；T_OBSTRUCTS_ITEMS 在卸装、分堆前拒绝 `There is already something there.`；保留 CE 已装备诅咒优先拒绝顺序。 |

所有新增消息走 i18n（9 个 zh_CN 键，英文 defaultValue）。两戒指替换临时目标仅保存在 InventoryOverlay；关闭背包、切换背包操作、读档或新局清除，不添加 Game 世界字段。最终命令为 `equip|新戒指字母|被替换戒指字母`，沿用录像命令分派，step/seek 不依赖 UI。第一次选择提示仍是现有零耗时命令，不改录像 schema。

ITEM_PLAYER_AVOIDS 使用已有 `Item.flags`，经 U01 `ITEM_FIELDS` 与完整实体图进入当前层、缓存层、背包及其他物品引用；[U03 合同](../../scripts/u03-state-contract.json) 的 items 项已登记。不新增旧档迁移，不增加 RNG 调用，不改生成和规则数值。

## 新守卫与浏览器

新增 [x3_u8b_items.test.ts](../../src/test/x3_u8b_items.test.ts) 共 32 项：

- 武器、护甲各自文案；无虚弱/虚弱/有效力量为负的缺口；够力量与戒指无误报；消息阶段物品/双 RNG 不变、耗时一次。
- 满包步行、显式拾取拒绝及腾位后取回；金币/武器堆叠/宝石堆叠例外；连续两次探索不再调用 addItem。
- 同格回避品不遮蔽可拾取品；丢弃与投掷分堆的旗标隔离；可见/记忆目标不回捡；自动移动不捡、手动取回；未命中怪物武器清位并重新被探索拾取。
- 当前层和正常模式跨层缓存的 JSON 保存/读取/返回保留旗标；加载不消费 RNG。
- 用户重复装备武器/护甲命令拒绝且不刷新计时（2 项）；内部刷新由原 U14b 守卫覆盖。已戴戒指拒绝；左右槽替换；取消/非法/诅咒分支；未装备单复数；食物/武器/护甲在阻物品格拒绝；中文消息。
- 戒指提示、取消、再次选择、替换、丢弃、离开和探索，经公开录像 step/seek 复现且零 OOS。

本地 Playwright 9 场景通过：左右槽各一次、取消、待选切换丢弃操作、手机诅咒拒绝、两种力量消息、满包、丢弃后探索、阻物品格拒绝。页面/控制台错误 0；桌面 1440×900、手机 390×844 的整页图已目视核验，提示与目标高亮清晰，无遮挡。运行脚本：[x3-u8b-browser.mjs](../../scripts/x3-u8b-browser.mjs)，结果：[browser-results.json](x3-u8b-evidence/browser-results.json)。所有 PNG 在本地 ignored evidence，不提交。

技能客户端已实际运行，文本状态正常；canvas 导出仍为本仓库已知黑图，未据此宣称视觉通过，使用有头整页截图验收。首次沙箱内 Chromium 被 macOS 拒绝启动，随后本地浏览器命令经工具自动批准在沙箱外执行成功；没有用户权限阻塞。

## 门禁

完整 83 文件首轮已结束：**1839 passed / 1 failed / 4 既有 skipped / 4 既有 todo，exit 1**，耗时 3316.32 秒。类型、构建、drift 均 exit 0；UR2/UR3/UR4 原黄金通过。执行器 [x3-u8b-verify.mjs](../../scripts/x3-u8b-verify.mjs) 串行执行，全部 Vitest `--maxWorkers=1 --no-file-parallelism`；没有运行全量 npm test。

范围由 `rg -l -g '*.test.ts' 'equipItem|unequip|dropItem|pickup|ITEM_PLAYER_AVOIDS|isAutoExploring|strength' src` 的 73 文件，与任务书强制的 p1_30、u24、u_27_recording、x2a、x3_u1–u6、x4a、fe_1_touch、i_1_interaction、UR2/3/4、U03 共 19 文件取并集，总计 83 文件。完整选择来源与清单：[test-selection.json](x3-u8b-evidence/test-selection.json)。实际命令/退出码/耗时：[gate-results.json](x3-u8b-evidence/gate-results.json)；输入冻结：[gate-inputs.json](x3-u8b-evidence/gate-inputs.json)。

完整首轮失败仅有 U14b 的护甲直接刷新。CE `equip()` 在命令层拒绝重复装备（Items.c:4002–4006），内部 `equipItem()` 则允许重新设置武器/护甲并刷新 DONNING（:8529–8561）。最初把两者混成了统一拒绝，属于本轮代码问题，**原守卫不改**。

修正只在 equip 命令分派传 `fromCommand=true`，内部方法在命令或戒指时执行重复拒绝。生产源码反查 `Game.equipItem` 只有该命令分派调用点，所以用户命令行为保持不变；直接内部刷新恢复 CE 语义。精确收口补丁：[repair.patch](x3-u8b-evidence/repair.patch)。新增两项用户命令重复拒绝守卫；没有守卫前提修订或待裁决项。

修正后通过反查 `equipItem\(|executeItemCommand\(.equip` 选出 6 个直接调用测试文件，与任务书固定 19 文件取并集，共 **24 文件**，重新执行类型、构建、定向及 drift。执行器：[x3-u8b-recheck.mjs](../../scripts/x3-u8b-recheck.mjs)，范围：[recheck-selection.json](x3-u8b-evidence/recheck-selection.json)，结果：[recheck-results.json](x3-u8b-evidence/recheck-results.json)。**复验 24/24 文件通过，589 passed / 2 既有 skipped / 0 failed（297.39 秒），exit 0；新增守卫 32/32，类型/构建/drift 也均 exit 0。** 修正后没有再跑整组 83 文件，未将首次 83 文件的 exit 1 宣称为完整通过。

| 门禁 | 完整 83 文件首轮 | 修正后复验 |
| --- | --- | --- |
| `npx vue-tsc -b` | exit 0 | exit 0 |
| `npm run build` | exit 0 | exit 0 |
| `npx vitest run … --maxWorkers=1 --no-file-parallelism` | 82 文件通过 / 1 文件失败；1839 passed / 1 failed / 4 skipped / 4 todo，exit 1 | 24 文件通过；589 passed / 2 skipped，exit 0 |
| `npm run test:drift -- --maxWorkers=1 --no-file-parallelism` | 1/1，exit 0 | 1/1，exit 0 |

两轮合并去重覆盖 **83/83 文件，1842 passed / 0 未解决 failed / 4 既有 skipped / 4 既有 todo**。这只是按最新复验结果汇总的覆盖数，不是一次运行的通过数。逐文件实际执行与最后验证来源：[actual-tests.md](x3-u8b-evidence/actual-tests.md)；机器结果：[完整首轮](x3-u8b-evidence/targeted.json)、[修正复验](x3-u8b-evidence/recheck-targeted.json)。完整执行起于 09-29 00:01 CST，最终复验门禁在 01:07 CST 结束。

UR2/UR3/UR4 两轮均匹配原黄金，**没有重录**；浅层 drift 两次通过。所有既有测试保持原样，没有 guard 前提修订；不运行全量 npm test。

## 初轮修正与实际执行记录

1. 工作树未安装 node_modules，最初 npx 等待已终止，未执行测试；随后 `npm ci --offline --ignore-scripts` 安装 182 包，锁文件不变。
2. 新守卫首轮 27/28；新测试曾要求自动旅行经过物品格不停，改为既有移动段停步，仍断言不拾取。没有修改任何既有守卫。
3. 类型初查的两个错误均为新测试 spy 访问 private 方法，只修测试类型装配。
4. 新增跨层用例首次 28/29；test 模式没有正常层缓存，改为 normal 模式夹具，最终新增守卫 29/29。
5. 技能客户端与定向 Playwright，结果如上；浏览器与本任务 Vite 已关闭。
6. 首段门禁在代码复查后主动停止，类型/构建通过，已完成 3 个测试文件通过；保留于 `x3-u8b-evidence/partial-gate/`，不计为完整通过。补同格多物品与待选操作切换边界后，新增守卫 30/30、浏览器 9 场景通过。
7. 完整重新从类型 → 构建 → 83 文件定向 → drift 执行，结果如上；528 个输入在该轮始终零变化。
8. 只修代码中的命令/内部刷新区别，新增两项守卫；再次运行浏览器 9 场景和技能客户端并核验整页截图，0 页面/控制台错误。类型/构建与 24 文件+drift 复验结果如上。

## 最终审计

[final-audit.json](x3-u8b-evidence/final-audit.json) / [执行脚本](../../scripts/x3-u8b-audit.mjs) 已通过：

- Game 仅上述 9 个方法段变化；`performPlayerAction` 在 pickup 前的全部内容逐字不变，`applyCommand` 只有 equip 接线变化。移动、麻痹、幻觉、TimeCoordinator、Player、地图目录均未动。
- 74 个保护文件（地图、规则数据、测试夹具、UR2/3/4 黄金、锁文件等）SHA-256 与 HEAD 一致；既有测试修改 0。
- 完整门禁 528 输入零变化；修正仅涉及 Game 的命令/内部刷新区分与本单元新增测试（[repair-inputs.json](x3-u8b-evidence/repair-inputs.json)）；随后复验再冻结 528 输入，仍零变化（[recheck-integrity.json](x3-u8b-evidence/recheck-integrity.json)）。
- 引用反查 73/73、任务书固定组 19/19、完整执行 83/83、修正影响组 24/24 全部覆盖；没有未解决失败。
- `git diff --check` 通过，新增/改动文件 CRLF=0；8 张 PNG 全部在本地 ignored evidence；暂存区为空。

本任务浏览器与 Vite 已关闭。未暂存、未提交、未推送；实现、验证与报告无剩余 TODO。
