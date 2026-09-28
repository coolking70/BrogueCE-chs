# X4a 执行报告

## 基线与范围

- 基线：`ae63cadd45877d551f93965da3c839ca6487bfa7`（任务书指定的 FE-1 A–D 头），起始工作区干净。
- 本地修改 `brogue-web/`；没有提交、推送；构建产物 `dist/` 不纳入交付。
- CE 源码使用同工作区 `BrogueCE-master/`。未修改 CE 字形数据、test:drift 配置、深层/生成基线或既有测试断言。U03 状态登记与 U19e 夹具选路前提按任务书做了反事实证明后最小修正，详见下节，提交验收方裁决。

## A. 每步重算探索、已知路径复核、共同移动入口

CE 依据：

- `Movement.c:2206–2256 getExploreMap`、`:2258–2370 explore`：每步重建探索图，经 `nextStep → playerMoves`；混乱/被困拒绝；相邻敌人先战斗；新发现扰动停止。
- `Movement.c:1050–1065 diagonalBlocked`：以 `getLocationFlags(..., limitToPlayerKnowledge)` 检查两个正交角。
- `Movement.c:1842–1885 travelRoute`、`:1887 travelMap`：前进之前复核后续路线，失效或移动失败即停止。
- `Movement.c:1440–1476 playerMoves`：移动和拾取属于同一个移动回合；`Items.c:838 pickUpItemAt` 拾取尝试会设置 disturbed。

改动：

- 增加明确的探索模式；每个 `auto_step` 重新运行仅使用可见/记忆地形的 BFS，重选最近未知格或已知物品，并从父链取下一步。到达旧目标后仍可继续探索；揭示墙壁只改变下一条路线。
- 采用任务书允许的 BFS/A* 方案，未移植 CE 的加权探索偏好（物品奖励、楼梯高代价、中央偏好）。点击寻路仍使用 A*，只为玩家加上已知对角阻挡检查，共用 A* 的其他调用者保持原接口行为。
- 点击寻路每步扫描整条剩余路径，包括末端与对角角落；已知墙壁/危险失效时静默停止。未知格不会被真实 `isPassable` 提前筛掉，实际是否移动由共同移动入口处理。
- 自动步进调用 `handlePlayerAction('move', ..., 'system')`，删除自动步进直接写坐标、手动加 tick、额外调用回合推进的旁路。移动成功后的拾取归入共同入口，不再另收一个自动拾取回合；拾取尝试后停止自动行进，避免背包满时循环追逐物品。
- 自动调用保留路径状态；普通手动移动/等待、自动步进触发的换层、坠落及相关路径失效清除探索状态。进行中的探索模式保存在 whole-run snapshot 中；未探索时不新增已结算快照字段。
- P2-2 输入锁与 P2-4 的 `inAutoTravelStep` try/finally 保留；混乱探索拒绝，混乱 travel 仍按 W-18 提交一次随机方向移动后丢弃旧路线。U27 仍录制 `auto_step`，嵌套系统移动不会多录一条 `move`。
- 删除无调用者的 `move.path_blocked`，保留 `ui.no_path` 与 `explore.nothing_more`。

守卫：`src/test/x4a_movement_rendering.test.ts` 覆盖揭示墙后改道/连续前沿、整条路径在第一步前复核、记忆与真实地形不同、未知下一格仍经过移动入口、已知对角角落、混乱/被困、新怪/物品扰动（含本步视野揭示后立即停止）、相邻敌人优先攻击、地形进入只结算一次、手动/自动拾取和计时一致、快照模式、无目标/无初始路径文案。

## B. 投掷取消

CE 依据：`Items.c:7135–7138 throwCommand` 在 `chooseTarget` 返回 false 时直接返回；记录投出命令、卸装备和复制投掷物均在其后。

- `escape` 在背包关闭且正在投掷时清除 `isThrowing` 和 `throwItemTarget`，请求重绘；背包打开时仍优先关闭背包。
- TargetBar 的取消继续通过 `dispatch('escape')`，删除旧的“暂不能撤销”状态、提示及 `mobile.target.throw_cancel_unsupported` 键。
- 新守卫验证物品、tick、turn、两路 RNG 均不变，录制序列为 `item:command → escape`，回放无 OOS；背包关闭优先级也有独立用例。

## C. 地图文本字形

CE 依据：`platform/platformdependent.c:124` 将 `G_FOLIAGE` 映射到 `U_ARIES`（U+2648）；CE 的字形数据无须修改。

- 新增渲染工具 `src/ui/mapGlyph.ts`：对 Unicode `Emoji=Yes` 字符追加 U+FE0E，替换已有 FE0E/FE0F，使规范化幂等。
- `GameCanvas.vue` 的地形、实体、bolt、浮字四个动态 Pixi Text 赋值边界统一规范化；颜色、光照与记忆外观仍来自原有 Appearance 逻辑。
- 守卫遍历 U+2600–U+27BF、U+2B00–U+2BFF 中全部 Emoji=Yes 字符，覆盖原串和已有 FE0F 输入；扫描所有地形目录、引擎/实体/数据中的短字形字面量，要求每个 emoji 能力码点之后紧邻 FE0E，且引擎中的原始 `♈` 不变。
- 浏览器证据脚本：`scripts/x4a-browser-evidence.mjs`。截图尚未执行：mimo 运行时返回 `agent is not defined`，浏览器库存为空，Computer Use 返回 `Computer Use was not approved to use Arc`。已通过异步问题请求允许使用项目现有 Playwright，等待答复；没有把脚本当作已执行证据。
- 权限说明：[mimo-browser-use SKILL.md](/Users/coolking70/.agents/skills/mimo-browser-use/mimo-browser-use/SKILL.md) 明确要求 “Do not silently replace it with desktop Computer Use, AppleScript, or standalone Playwright.”；Computer Use 运行时文档进一步规定 “Do not use other technologies besides cua_repl for computer interactions, unless specifically requested by the user”。因此替代 Playwright 需要明确授权，不能用其他后端绕过 Arc 的拒绝。

## 守卫失败归因与前提修正（交验收方裁决）

首轮完整全量结果保留为 `x4a-evidence/pre-fix-full-summary.json` / `pre-fix-full.json` / `pre-fix-full.txt`：221 文件，4073 项，4056 passed、4 failed、8 skipped、5 todo，2009.078s。失败处理如下；未放宽、删除或跳过任何断言。

1. **X3a：生产回归。** 探索/点击寻路初始化已见怪物集合时，直接复制了可能含已死对象的 visibleMonsters。改为 `iterateCreatures` 的存活口径；原 X3a 测试不改。
2. **U03：新字段登记前提。** 原守卫用 TypeScript AST 对照 Game 实例字段与生命周期账本。相同谓词、原账本下，基线 105 字段通过、当前多一个 `isAutoExploring` 失败：`u03-counterfactual.json`。只在 `scripts/u03-state-contract.json` 加入这一个 run 字段的初始/中断/保存/兼容读档说明；原 105 条完全不变（`u03-contract-delta.json`）。原测试断言不改。
3. **U19e CE1/CE26：选路前提依赖旧的“走过物品不拾取”。** 原夹具沿最短路穿过其他借阅物，CE 行走拾取会提前借出它们并关笼。只临时移除 Game 新增的共同行走拾取块，两个原用例即 2/2 通过；所有测试、夹具及其他生产改动保持不变，随后按 hash 精确还原（`u19e-failure.txt`、`u19e-counterfactual.json` / `.txt`）。依据 CE `Movement.c:1465`，保留正确生产行为，仅调整 `src/test/fixtures/u19e-machine-actions.ts` 的 CE1/2/26 路线，绕开非目的地的同机器地面借阅物。仍使用真实 move/drop/pickup 命令，未改种子、生成地图、物品身份、阶段记录或借出→关笼→原物归还→换借的全部结果断言；其他机器分支行为不变。

修复后六个文件（U03、X3a、U19e、B1a、P1-20、X4a）110/110 通过，无跳过：`fix-targeted-summary.json` / `.json` / `.txt`。包括所有 U19e 机器自然场景，以及两个消费该夹具的完整测试文件。

## 门禁与反查

- 首轮针对性：7 文件 / 104 测试通过（P1-30、P2-4、W-18、U27、UR2/UR3/UR4）。新增 X4a 最终 21 / 21 通过。
- 反查闭包：`x4a-evidence/rs-closure.json`；包含任务书指定的 p1_30、U24、U27、X2a、X3b、W-18、P2-2、P2-4、fe_1_touch、i_1_interaction，追加本次失败关联及夹具消费者，所有读源码守卫列为 S。R 56、S 72、并集 97 文件；最终 audit 核验完整门禁实际执行 222 文件（全量 221 + drift 1），闭包遗漏 0。重点用例逐文件结果另存 `mandatory-results.json`。
- 初轮全量使用 4 worker，运行期间生产代码作了最后的扰动/拾取修正；1330.210s 后主动终止（exit 143）。记录为 `interrupted-full-summary.json` / `interrupted-full.txt`，不算完整执行、不算门禁通过。之后的首轮完整全量使用 8 worker，结果及四项归因如上。
- 修复代码冻结后，`vue-tsc -b`（4.608s）、`npm run build`（6.518s）、`npm run test:drift`（25.725s，1/1）均 exit 0；完整 `npm test` 最终 exit 0：221 文件，4073 项中 4060 passed、0 failed、8 skipped、5 todo，1910.810s（31 分 50.810 秒）。原有 skipped/todo 数量不变。并发只通过命令行指定，不改 package.json、超时或基线。
- 受保护基线：`baseline-before.json` / `baseline-after.json` 中 18 项 hash，包括 UR2/UR3/UR4 黄金 trace、drift 配置与深层/生成基线。最终门禁 summary 同时记录生产文件、新增守卫、U03 登记及 U19e 夹具 hash，防止结果混用。
- 黄金 trace：首轮针对性、首轮完整全量及最终完整全量中 UR2/UR3/UR4 原夹具均通过，未重录任何 trace，无 trace 重录登记。

## 最终复跑声明

最终完整复跑于 2026-09-28 02:30:55–03:02:46（Asia/Shanghai）执行，使用冻结后的同一组生产文件、X4a 新守卫、U03 登记及 U19e 夹具；四项门禁 summary 的 hash 与当前文件完全一致。`final-audit.json` 为 `ok: true`，无旧测试断言改动、无受保护文件变化、无反查遗漏、无 CR 字节、无 dist 纳入改动，`git diff --check` 通过。HEAD 仍是指定基线，没有暂存、提交或推送。本任务启动的闲置 Vite 服务已关闭。

| 门禁 | 最终结果 | 耗时 |
| --- | --- | --- |
| `npx vue-tsc -b` | exit 0 | 4.608s |
| `npm run build` | exit 0 | 6.518s |
| 完整 `npm test -- --maxWorkers=8` | 221 文件；4060 passed / 0 failed / 8 skipped / 5 todo | 1910.810s |
| `npm run test:drift -- --maxWorkers=1` | 1/1，exit 0 | 25.725s |

**未完成项：桌面/手机 × 视野内/记忆的修复前后浏览器截图。** 浏览器工具和权限阻塞如 C 节；已提出本地 Playwright 替代请求但尚未得到明确答复，未生成 PNG，也未将准备好的脚本冒充执行证据。因此本报告交付代码与绿色门禁，**不声明 X4a 全项验收通过**。另请验收方裁决上文有反事实证明的两项前提修正（U03 字段登记、U19e 选路）。
