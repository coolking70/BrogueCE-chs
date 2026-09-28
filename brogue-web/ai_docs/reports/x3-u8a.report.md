# X3-U8a：麻痹连续推进与幻觉移动修正

执行日期：2026-09-28–29（Asia/Shanghai）。基线：`d2fa9dc3cf52eaa873efedabd6720c98cd8c402e`。任务书：[x3-u8a.prompt.md](../tasks/x3-u8a.prompt.md)；权威规格：[x-3-survey.report.md](x-3-survey.report.md) 的 B06、D11。

## 1. CE 依据与实现

- **B06**：`BrogueCE-master/src/brogue/Time.c:2494-2872` 的 `do … while (player.status[STATUS_PARALYZED])`；`:2495-2503` 在游戏结束时退出，麻痹不递增玩家消息回合号；`:2604-2609` 每圈补行动 ticks；`:2642-2758` 照常调度怪物和客观环境；`:2866-2872` 坠落直接返回，否则继续麻痹循环。
- `TimeCoordinator.playerTurnEnded` 用迭代循环完成全部强制回合。每圈保留速度、气味、安全图、搜索、环境/怪物调度和回合收尾，刷新本圈中毒标记；死亡或换层停止。保留项目既有 `stats.turns`（主观调度次数）、`absoluteTurnNumber`（客观 100 ticks）和 `logger.turn` 的区分。
- 已处于麻痹的动作只触发强制等待，原动作不执行，不再记录逐键 “cannot act” 消息。正常动作中获得麻痹，无需额外输入即结算完。
- **动画**：保留 P2-4 的普通动作零暂停、慢动作最多一次 25ms 暂停、自动行进同步推进。强制麻痹回合直接同步消耗；动画中新增麻痹在 `Game.finishAdvancement` 的录制/回放检查点提交前完成，以 continuation 参数从循环内部续接，不重复入口清理或 DF 消息资格重置。原中止、异常、坠落的退出路径不被强制续跑。
- **D11**：`Movement.c:1097-1138` 仅混乱改方向，`:674-699` 从合法方向抽样；`:837-843` 幻觉只参与攻击确认豁免。删除 web 的 35% 幻觉踉跄分支及主 RNG 抽样，保留混乱分支不变。移除两个不再使用的中文消息键，无新增硬编码产品文案。

产品代码限于 `Game.ts` 的麻痹输入分支、幻觉移动分支、动画收尾，以及 `TimeCoordinator.ts` 的 `playerTurnEnded`；未改侧栏、`updateHover`、地图目录、生成器或其他 U8 事项。

## 2. 专项守卫

新增 `src/test/x3_u8a_forced_turns.test.ts`，15 项：

| 守卫 | 验证内容 |
|---|---|
| N=1/5/32，动画开/关 | 一次移动输入在原地耗尽麻痹，只录一条事件，下一次输入才移动；气味每圈 +3、消息回合号不增加、无 cannot-act 刷屏 |
| 怪物调度 | 相邻老鼠、豺狼在 5 个强制回合中各攻击 5 次，玩家实际掉血；两者攻击速度均 100 ticks，豺狼 50 ticks 是移动速度 |
| 加速/减速 | 5 客观回合麻痹：加速走 10 个主观圈/5 个客观块；减速走 3 圈/6 块；不建立逐圈动画 |
| 死亡出口 | 麻痹期间毒伤致死立即结束，不继续耗尽剩余状态；一条命令记录终局 |
| 动作中气体麻痹 | 正常/减速动作分别 1/2 次动画 step 完成；同步与动画完整世界快照、事件检查点一致 |
| 回放/seek | 真实命令边界、双 RNG 检查点、动画回放及 seek 均零 OOS；将该命令的最终客观回合号减 1 后必须报 OOS |
| 自动行进 | 踩气体的 auto_step 内耗尽麻痹，disturbed 后路线清空，无额外输入事件 |
| 同命令 DF 消息去重 | 同步/动画两种模式中，每个客观块都触发同一真实 DF，整个麻痹等待只产生一次描述 |
| 幻觉/混乱 | 40 步覆盖八方向，幻觉与清醒对照的方向、主 RNG 状态和计数一致；混乱仍随机，叠加幻觉结果一致；封闭七方向时只能走唯一合法出口 |

回放专项采用确定性测试房间，在 seeded 初始化后重装同一场景；未打桩调度、气体、状态效果、RNG 或录制/回放逻辑。快照比较仅归一化保存时间与回放不会重录的输入列表/索引；事件列表另行逐值比较。天然 CE67/68 机器路径另由既有 U19d 守卫覆盖。

本地 Playwright 浏览器另完成 **4/4 场景、0 页面/控制台错误**：真实 ArrowRight 在麻痹 5 回合中停在 (10,10)，老鼠正常攻击，HP 1000→986，仅一条事件；真实等待键触发气体后一次结算 20 回合，确认消息不增加命令；动画回放/seek 均 cursor=1、OOS=null；幻觉与清醒各 40 次真实方向键的位移和主 RNG 逐步相同。三张整页截图已打开检查，均含实际游戏画面，PNG 仅在 `/tmp/x3-u8a-evidence/`。

技能自带客户端的初次 canvas 导出为黑色，不能作为视觉通过证据；改用项目已有 Playwright 的整页截图后验证上述场景。临时浏览器夹具曾错误重置 seek 的动画开关，修正夹具后 4 项全部通过，无产品改动。

## 3. 旧守卫前提修正（交验收裁决）

首轮定向测试中，G-3 两项喝麻痹药水、U19d 天然 CE67/68 两项失败：旧断言在整条命令返回后要求气云仍在、玩家仍麻痹，并再输入一次移动验证不能移动。B06 完成后，返回点已是强制等待结束。

**先做单变量反事实**：在 `/tmp/x3-u8a-counterfactual` 的独立源码副本，仅恢复基线 `TimeCoordinator.ts`（旧的单圈调度），保留其余新代码和原守卫。原失败四项 **4/4 通过**，证明它们依赖旧调度观察时点；主工作区未回退。

随后只修测试观察前提：

- G-3：在真实第一客观块结束处读取气体层、正体积、气体镜像和 19/20 状态长度。原约束保留，外加整条命令返回后麻痹解除。观察包装始终调用原方法并在 `finally` 恢复。
- U19d：在真实客观块内部记录麻痹相位，命令返回后记录恢复相位。保留机器气口、麻痹实际生效、位置不变、脱离机器、无伤害约束，补充“同一条命令跨多个回合恢复”。删除要求玩家在中途再次输入的旧驱动前提。
- 涉及 `g_3_gas_effects.test.ts`、`u_19d_machine_families.test.ts` 和 `fixtures/u19d-machine-actions.ts` 的麻痹段。未放宽时长/断言门限，未跳过测试，未改生产行为来迎合旧守卫。

后续首个**完整全量**另发现 U1 一项冲突：`x3_u1_movement_safety.test.ts` 的麻痹气体确认案例要求接受移动后 `absoluteTurnNumber +1`，实际为 `+20`。在独立 `/tmp/x3-u8a-u1-counterfactual` 仅恢复基线 `TimeCoordinator.ts`，原案例 1/1 通过（另外 32 项为 `-t` 过滤）；输入差异清单确认仅此一个生产文件不同。再按 `Time.c:489-490,2872` 将该气体夹具的预期改为固定 20 回合，其余危险格仍固定 1 回合，并补充返回后无麻痹、拒绝与接受各一条事件。原拒绝零消耗、确认文案、最终一格位移和决定录制断言均保留。此项同样交验收裁决。

## 4. 门禁与证据

**最终四项门禁全部通过**，执行日期 2026-09-29（Asia/Shanghai）：

| 门禁 | 时间 | 进程耗时 | exit | 结果 |
|---|---|---:|---:|---|
| `npx vue-tsc -b` | 01:09:33–01:09:37 | 4.398s | 0 | 通过 |
| `npm run build` | 01:09:37–01:09:43 | 5.974s | 0 | 通过（大 chunk 提示见输出） |
| 完整 `npm test -- --maxWorkers=2` | 01:09:43–02:14:14 | 3870.801s | 0 | **231/231 文件通过；4377 passed / 8 skipped / 5 todo，0 failed** |
| `npm run test:drift -- --maxWorkers=1` | 02:14:14–02:14:44 | 29.880s | 0 | **1/1 通过**，4 seed × D1–D26 原基线无漂移 |

JSON 逐文件审计：全量预期 231 个、drift 预期 1 个，均无遗漏、额外或重复文件；无未处理错误。8 个 skip 与 5 个 todo 的完整名单与前轮相同。U-R2/U-R3/U-R4 原黄金 trace、U26a D27–40 原生成基线全部通过，未重录任何黄金文件。整个门禁期间 **424 个源码/配置文件 SHA-256 无变化**。

执行器 [run-final-gates.py](x3-u8a-evidence/run-final-gates.py) 串行执行四项门禁；全量最多两个 worker，drift 与定向测试单 worker，原超时门限不变，无超时复跑。完整命令（含 default/JSON reporter 参数）、开始/结束时间与退出码见 [final-gates.json](x3-u8a-evidence/final-gates.json)。

构建输出尾部（原样）：

```text
dist/assets/CanvasRenderer-DRXV5tqV.js         22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-ClzQao4F.js         38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-1YfGCJgt.js             41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-CjOhMYsM.js     45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-iCyNZ-yB.js          68.42 kB │ gzip:  18.71 kB
dist/assets/index-CgWmxM1b.js               1,448.89 kB │ gzip: 420.20 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.74s
```

最终全量输出尾部（原样）：

```text

 Test Files  231 passed (231)
      Tests  4377 passed | 8 skipped | 5 todo (4390)
   Start at  01:09:43
   Duration  3870.47s (transform 3.11s, setup 0ms, import 91.97s, tests 7623.65s, environment 50ms)

JSON report written to /tmp/x3-u8a-evidence/full-results.json
```

最终 drift 输出尾部（原样）：

```text

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  02:14:14
   Duration  29.50s (transform 500ms, setup 0ms, import 828ms, tests 28.58s, environment 0ms)

JSON report written to /tmp/x3-u8a-evidence/drift-results.json
```


首次全量以单 worker 启动，运行中复核动画续接，发现在同一命令中重复重置 DF 消息资格的边缘问题。独立副本的真实 DF 描述探针证明：同步消息 1 次，动画消息 2 次，守卫失败 `expected 2 to be 1`。因此显式中止该轮（exit 130，**不计作完整门禁**），修复 continuation 入口并增加两项守卫后，专项/P2-4/检查点回归 **32/32 通过**；重新启动最终完整全量。浏览器四场景也在修复后复跑通过。日志保留中止记录与负例，不将它们描述为成功。

上述专项的反向验证在 `/tmp/x3-u8a-counterfactual`，未覆盖主工作区：恢复旧麻痹调度，7 项对应新守卫全部失败；仅恢复旧幻觉踉跄，方向/RNG 对照守卫失败（请求 (9,11)，实际 (10,11)），两项混乱守卫仍通过；动画入口旧实现的 DF 重复消息守卫失败。最终代码保留全部修复。

第一个完整全量在 2026-09-28 23:45:11 至 09-29 01:07:28 跑完，231/231 文件无遗漏：230 文件通过、仅 U1 失败，4376 passed / 1 failed / 8 skipped / 5 todo；后续 drift 1/1 通过。冻结输入的 424 个源码/配置文件哈希全部一致。此轮完整记录保留，**不算绿色门禁**。只修上述 U1 测试前提后，U1 全文件 + 新增专项单 worker 复跑 **48/48 通过**，再执行最终四项门禁；生产代码自 continuation 修复后未再修改。8 个 skip 与 5 个 todo 均来自未改动的既有文件（名单见附件），本任务未新增跳过项。

U1 反事实初次进程在沙箱内尚未运行测试即以 `SecItemCopyMatching -50` 崩溃；放行本地单 worker 进程后原命令通过，启动错误单列保留，不计为测试结果。

初始工作树未安装依赖，使用 `npm ci --offline --no-audit --no-fund` 从本地缓存安装，锁文件无变化。最初 `npx` 的空等待已终止，未当作测试结果。专项初版还修正了测试对麻痹期间营养暂停、豺狼攻击速度以及回放不重录输入列表的错误假设；两处测试 TypeScript 空值标注已修复。

证据索引（文本/JSON；PNG 不在仓库）：

- **最终结果**：[全量输出](x3-u8a-evidence/full.txt)、[全量 JSON](x3-u8a-evidence/full-results.json)、[漂移输出](x3-u8a-evidence/drift.txt)、[完整性审计](x3-u8a-evidence/final-results-audit.json)、[输入哈希](x3-u8a-evidence/final-input-hashes.json)、[输入一致性检查](x3-u8a-evidence/final-input-check.json)。

- [首个完整全量输出](x3-u8a-evidence/full-before-u1-fix.txt)、[完整性与唯一失败审计](x3-u8a-evidence/audit-before-u1-fix.json)、[该轮漂移检查](x3-u8a-evidence/drift-before-u1-fix.txt)。
- [G3/U19d 原守卫反事实](x3-u8a-evidence/old-guards-counterfactual.txt)、[U1 原守卫反事实](x3-u8a-evidence/u1-old-guard-counterfactual.txt)、[U1 单变量输入差异](x3-u8a-evidence/u1-counterfactual-input.json)、[修正后 48 项专项](x3-u8a-evidence/u1-premise-final.txt)。
- [动画续接负例](x3-u8a-evidence/negative-animation-continuation.txt)、[旧麻痹调度负例](x3-u8a-evidence/negative-paralysis.txt)、[旧幻觉分支负例](x3-u8a-evidence/negative-hallucination.txt)、[最早中止轮记录](x3-u8a-evidence/full-interrupted.txt)。
- [浏览器四场景结果](x3-u8a-evidence/browser-results.json)、[本地浏览器脚本](x3-u8a-evidence/browser-check.mjs)、[方法范围审计](x3-u8a-evidence/method-scope.json)、[既有 skip/todo 名单](x3-u8a-evidence/pre-existing-pending-tests.json)。

## 5. 与预设不符之处及最终声明

五项旧守卫前提冲突及反事实证明见 §3，均只修观察时点/命令与回合的对应关系，供验收裁决。生成期与原黄金 trace 未出现漂移，无基线重录。

**最终复跑声明**：最后一轮类型检查、构建、完整全量测试与 drift 均在最终产品代码和最终测试文件上完成，全部 exit 0。最终全量无失败、无遗漏，正常录制/回放专项零 OOS，源码/配置哈希从启动到结束一致；之后仅整理报告与证据。前面的中止轮和含 U1 旧前提失败的完整轮均已单独留痕，未计作绿色门禁。

方法范围审计只包含 `Game.performPlayerAction`、`Game.finishAdvancement` 与 `TimeCoordinator.playerTurnEnded`；未改 U7 侧栏/悬停、地图目录或其他 U8 项。`git diff --check` 通过，改动文件无 CRLF、无 PNG，暂存区为空，HEAD 仍为报告开头基线。文件清单与审计见 [final-file-audit.json](x3-u8a-evidence/final-file-audit.json)。

已跟踪文件 diff stat：

```text
 brogue-web/src/engine/Core/Game.ts                 |  31 +--
 brogue-web/src/engine/Core/TimeCoordinator.ts      | 220 +++++++++++----------
 brogue-web/src/locales/zh_CN.json                  |   2 -
 .../src/test/fixtures/u19d-machine-actions.ts      |  17 +-
 brogue-web/src/test/g_3_gas_effects.test.ts        |  39 ++--
 brogue-web/src/test/u_19d_machine_families.test.ts |   4 +-
 brogue-web/src/test/x3_u1_movement_safety.test.ts  |   7 +-
 7 files changed, 173 insertions(+), 147 deletions(-)
```

另新增 `src/test/x3_u8a_forced_turns.test.ts`（189 行）、本报告及文本/JSON 证据目录；这些未跟踪文件不在上述 `git diff --stat` 内。

未执行 `git add`、提交或推送；三张已验看的最终截图仅存 `/tmp/x3-u8a-evidence/`，未纳入工作树改动。

