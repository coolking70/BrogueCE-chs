# FE-1 报告：前端设计与移动端适配

分支 `frontend-mobile`，起点 `v0.1.0`（`2e45435`）。任务书 `ai_docs/tasks/fe-1.prompt.md`。

| 阶段 | 提交 | 内容 |
|---|---|---|
| A | `a7e6130` | 四视口现状审查与设计方案（`fe-1-audit.md`，只读） |
| B | `2dca600` | 响应式布局：桌面/竖屏/横屏三模式、小屏跟随相机与缩放、抽屉侧栏、弹层适配 |
| C | `eaf9567` | 触屏操作：命令栏、虚拟方向键、单击/长按/拖动/捏合、目标选择确认条 |
| D | WIP `54e1402` 经 cherry-pick 沿用，加本阶段收尾提交 | 视觉打磨：统一面板/按钮 token、CJK 字体栈、暗色可读性、桌面遮挡修正 |

## 1. 硬性约束核对

1. **输入边界**：触屏的全部状态改变都走 `src/ui/commands.ts`，最终调用 `handlePlayerAction`、`executeCommand('mouse_travel')` 或背包里现有的 `executeItemCommand`。`fe_1_touch.test.ts` 有结构守卫：CommandBar/DPad 不得直接引用 `activeGame`，HUD 类组件不得调用 `activeGame.*()`。阶段 D 只改样式，不涉及这条。
2. **规则层未改**：`git diff 2e45435 HEAD -- src/engine src/entities src/data` 为空。
3. **随机流**：相机、手势、动画都是纯显示，不碰 `rng`。录像逐条比对完整 RNG 状态，结果零 OOS（见第 2 节）。
4. **i18n**：阶段 C 把 `ReferenceOverlay` 的硬编码中英文迁进了 `zh_CN.json`。阶段 D 没有新增模板文本。`index.html` 的 `<title>` 改成了中文标题，这个文件不在组件模板和 logger 的守卫范围内。
5. **测试**：没有删除、跳过或放宽任何测试。
6. 没有 CRLF，没有提交 `dist/`。

## 2. 复核：阶段 C 的触屏录像能否在桌面回放一致

复核脚本是新增的 `fe-1-evidence/replay-check.mjs`，与阶段 C 的采集脚本相互独立。做法：用桌面上下文（1440×900、`hasTouch=false`、DPR 1）打开主菜单，走"导入 JSON"重载已提交的 `C-*-recording.json`，再逐条 `force_replay_step` 回放到底。引擎每执行一条命令都会比对 tick、深度、坐标、回合、决策数和**完整 RNG 状态**，只要有一项不符就报 OOS。

结果（`C-replay-recheck-log.txt`）：

- 四份录像各 460 条，事件序列逐字节相同。平板和手机两份由真实触屏事件录制：`touchscreen.tap`、合成的 `pointerType=touch` 长按、命令栏/方向键点击、TargetBar 确认。
- 四份在桌面回放都走完 **460/460、零 OOS**，终点 (9,21) d1，与录像最后一条事件一致。
- **反例**：把手机录像第 200 条事件的记录坐标 x 加 1 后再回放，在第 200 条报"回放在第 200 条命令处不同步"。这说明检测本身有效，零 OOS 不是检测失效造成的假通过。
- 我额外核对了一个疑点。流程日志里"投掷后飞镖 `飞镖 -> 飞镖`"看上去像没掷出，因为物品名本身不带数量。查录像：`item:command throw|c|` 之后是 `escape`（关背包），然后是 `mouse_travel(72,12)`。此时玩家在 (74,12)，这条命令推进了一个回合而玩家没有移动，按 `handleMouseTravel` 的逻辑就是 `isThrowing` 时执行 `throwItemAt`。所以投掷确实发生了。

结论：**阶段 C 的触屏录像在桌面回放一致，第 1 条约束成立。**

## 3. 阶段 D 改动（视觉打磨）

**沿用 WIP（`54e1402`）**。逐项审查后确认只有 CSS 和 `<title>`、`lang` 改动，没有逻辑改动，全部保留：
- `main.css` 新增统一 token：`--panel-bg`、`--panel-bg-strong`、`--panel-border`、`--panel-radius`、`--btn-bg`、`--btn-bg-active`、`--btn-border`、`--color-danger`。
- 次要文字从 `#a1a1aa` 提到 `#b4b4bd`，在深色底上对比度约 9:1。
- 字体栈补 CJK 回退（苹方 / 冬青 / 思源 / 雅黑 / 文泉驿），等宽栈同样补上；表单控件继承字体；加 `focus-visible` 描边。
- MainMenu、DetailPanel、GameEndOverlay、ReferenceOverlay、菜单钮改用 token。
- 去掉对中文无效的 `uppercase` 和 `letter-spacing`（审查 P-20）。
- `index.html` 改为 `lang="zh-CN"`，标题改为中文。
- WIP 自带的 D 截图未经验证，已全部删除并重新生成。

**本次补做**：
- **AgentControls 桌面遮挡（审查 P-6 残留）**：B 阶段只在紧凑/触屏布局隐藏了它，桌面上它仍以 0.15 透明度盖在侧栏"行动日志"右下角（见 `A-desktop-1440x900-02-game.png`）。现在改放到地图区左下角，桌面等比模式下那里是留白。DOM、`aria` 和可点击性都不变，按钮也改用 token。
- ReplayControls、SideDrawer 关闭钮、MapZoomControls、MessageStrip 改用统一 token。
- MessageStrip 旧消息的透明度从 0.7 调到 0.85。原来像 `#8888aa` 这类日志色乘上 0.7 后对比度不足 4.5:1。
- 全局 `button:disabled`：透明度 0.45，加虚线描边和禁止光标，不再只靠变暗来区分（审查 3.4）。MainMenu 的局部规则也改成同一口径。
- 帮助页的按键列改为两列网格（`minmax(90px,38%) 1fr`）。原来首行的长按键串会把说明挤偏。
- 截图脚本 `audit-capture.mjs`、`flow-capture.mjs` 支持用 `PW_CHROMIUM` 指定浏览器路径。云端的 Playwright 1.58 默认 headless shell 与预装版本不匹配，需要这个开关。

目标选择条（TargetBar）保留琥珀色系，作为"待确认"的语义色，不并入中性面板色。

## 4. 验证（仅限任务书第 3 节范围）

- `npm ci`：通过
- `npx vue-tsc -b`：通过（无输出）
- 第 3 节列出的 13 个测试文件：**13 files / 222 tests 全部通过**
- `npm run build`：通过，只有既有的 chunk > 500 kB 提示
- 四视口实际操作（`D-flow-log.txt`）：开新局 → 方向键移动 → 长按查看 → 探索拾到药水 → 背包喝药（背包自动关闭）→ 投掷飞镖选目标并确认 → 下楼（d1→d2）→ 上楼（d2→d1）→ 保存回放、导出 JSON → 存档、刷新、继续游戏（坐标一致）。四个视口全部走通。
- D 阶段录像的桌面回放（`D-replay-recheck-log.txt`）：四份各 460/460 零 OOS，事件序列与桌面逐字节一致；篡改反例在第 200 条报 OOS。
- **未在云端运行**：`src/test/fe_1_touch.test.ts`（FE-1 自带测试，不在第 3 节列表内）和完整 `npm test`，交本地全量门禁。阶段 D 只改样式，经静态核对，不影响该文件的结构守卫（守卫检查的是 import 和 `activeGame` 调用）。

## 5. 截图索引（`ai_docs/reports/fe-1-evidence/`）

视口名：`desktop-1440x900`、`tablet-768x1024`、`phone-390x844`、`phone-land-844x390`。

| 前缀 | 标签 | 来源脚本 |
|---|---|---|
| `A-` | 01-menu … 07-ingame-menu（改动前现状） | `audit-capture.mjs A` |
| `B-` | 同上，阶段 B 后 | `audit-capture.mjs B` |
| `C-` / `D-` | 01-new-game、02-moved、03-long-press、04-inventory-potion、05-after-quaff、06-throw-aim、07-after-throw、08-descended、09-ascended、10-save-loaded；`*-recording.json`；`*-replay-*-on-desktop.png`；`*-flow-log.txt` | `flow-capture.mjs C|D` |
| `D-` | 01-menu、02-game、03-inventory、04-detail、05-discoveries、06-help、07-ingame-menu（阶段 D 终态） | `audit-capture.mjs D` |
| `C-replay-recheck-log.txt`、`D-replay-recheck-log.txt` | 桌面回放复核 + 篡改反例 | `replay-check.mjs C|D`（`FE1_TAMPER=1`） |

## 6. 引擎接口需求（交验收方审查，本分支未实现）

1. **取消投掷模式**（审查 P-19）：引擎里 `isThrowing` 只在投出后清零，`escape` 不会清除它，桌面按 Esc 同样无效。建议在 `handlePlayerAction('escape')` 分支里，当 `isThrowing` 为真且背包未打开时，清掉 `isThrowing` 和 `throwItemTarget`。这不消耗回合、不碰 rng，会作为一条 `escape` 命令被录制。现在 TargetBar 的"取消"在投掷时会如实提示"投掷一经选定暂不能撤销"（`mobile.target.throw_cancel_unsupported`），没有在 UI 层伪造取消。

## 7. 已知问题 / 未完成项

- AgentControls 在桌面"拉伸"地图模式下，或者地图恰好延伸到左下角时，仍可能以 0.15 透明度叠在地图上，但不再遮挡任何文字面板。它本就是给自动化代理用的控件，如果要彻底移除视觉存在，需要确认代理不依赖其坐标。
- 桌面"BROGUE JS"品牌标题保持原样（i18n 与品牌命名留给产品方决定）；侧栏的玻璃渐变风格也保留，以免桌面体验退化。
- Google Fonts（Inter / Fira Code）在离线环境下加载失败时，会回退到补全后的 CJK 栈。截图环境就是回退后的字体。
- 暗色可读性只按对比度估算调整了次要文字和日志透明度，没有做系统化的 WCAG 扫描。
- 阶段 D 的深度按剩余额度控制在"统一 token + 可读性 + 遮挡修正"。图标体系（现用 emoji 和字符）没有替换。

**可交本地验收。**
