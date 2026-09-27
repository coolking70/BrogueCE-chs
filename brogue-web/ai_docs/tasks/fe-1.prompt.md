# FE-1：前端设计与移动端适配（云端执行，分支 `frontend-mobile`）

> 仓库 `https://github.com/coolking70/BrogueCE-chs`，项目目录 `brogue-web/`（TypeScript + Vue 3 + Vite）。起点为标签 `v0.1.0`。
> **只在分支 `frontend-mobile` 上工作并推送该分支；不要推送或改写 `main`、不要打标签。** 合并回 main 由本地验收方负责。

## 0. 背景

这是 Brogue CE（roguelike）的中文网页版。游戏规则层已与 CE 对齐并由约 4000 项测试守护（`src/engine/`、`src/entities/`、`src/data/`）。
本任务**只做前端表现与交互**：视觉设计、响应式布局、移动端（触屏）可玩性。

现有前端（`src/components/`、`src/App.vue`）：
- `GameCanvas.vue`（750 行）：地图 canvas 渲染（79×29 格）、帧 ticker（回放、flare 动画、自动寻路）、鼠标点击移动/目标选择
- `Sidebar.vue`（398）：玩家/怪物状态侧栏
- `InventoryOverlay.vue`（672）：背包与物品操作（喝/读/装/卸/丢/投/吃/用、鉴定与附魔选物、确认/取消）
- `DetailPanel.vue`（235）、`ReferenceOverlay.vue`（发现屏/帮助）、`GameEndOverlay.vue`（结局/高分）、`MainMenu.vue`、`ReplayControls.vue`、`AgentControls.vue`（辅助可访问性 DOM）
- 键盘输入 `src/engine/Input.ts`；界面文本走 i18next（`src/locales/zh_CN.json`）

## 1. 硬性约束（违反即不可合并）

1. **所有会改变游戏状态的输入（含触屏点击、长按、滑动、虚拟按键、手势）必须经 `game.executeCommand(...)` / `game.handlePlayerAction(...)` / 背包里现有的 `executeItemCommand(...)` 进入**——这是录像（U27 命令日志）与回放确定性的唯一边界。不得在组件里直接调用引擎内部方法改状态。
2. **不修改 `src/engine/`、`src/entities/`、`src/data/` 的规则逻辑**。若确需引擎提供新的只读查询（例如"某格可否点击移动"），单独列在报告"引擎接口需求"中，写成最小只读方法并说明理由，交验收方审查。
3. 纯显示用的随机/动画不得调用主随机流（引擎已有 COSMETIC 流；UI 自身动画用 `Math.random` 或 CSS 即可，但绝不能碰 `rng`）。
4. 所有玩家可见文本走 i18n（`zh_CN.json`），不新增硬编码中文/英文字符串到组件模板或 logger（守卫：`p1_30_i18n_gate`、`u24_hardcoded_text`）。
5. 不删除、不跳过、不放宽现有测试；读组件源码的守卫若因重构而指向旧位置，迁移前提到新实现，并在报告中逐条说明。
6. 不产生 CRLF；不提交构建产物（`dist/`）。

## 2. 分阶段目标（每阶段单独提交，提交信息说明阶段）

**阶段 A：现状审查（先做，产出文档，不改代码）**
- 在桌面 1440×900、平板 768×1024、手机竖屏 390×844、手机横屏 844×390 下用浏览器截图，列出问题：地图缩放与可读性、侧栏/背包/详情遮挡、按钮尺寸、中文字形、滚动与溢出
- 产出 `ai_docs/reports/fe-1-audit.md`：问题清单 + 设计方案（布局、配色/字体方向、交互方案）

**阶段 B：响应式布局**
- 地图 canvas 按视口自适应（保持格子比例与字形清晰；小屏可缩放/平移或视口跟随玩家）
- 侧栏、背包、详情、发现屏、结局在小屏改为抽屉/底部弹层/全屏面板；竖屏与横屏各有合理布局
- 桌面体验不退化

**阶段 C：触屏操作**
- 点击地图：移动/自动寻路（复用现有鼠标旅行命令）；长按：查看格子/怪物详情
- 常用命令栏（大尺寸触控按钮）：搜索、休息、背包、投掷、拾取、上下楼、发现屏、帮助；八方向移动可用虚拟方向键或滑动
- 目标选择（投掷/法杖/魔杖）：点选目标 + 明确的确认/取消按钮
- 背包操作在触屏上可完成全部现有功能（含确认/取消、鉴定/附魔选物）

**阶段 D：视觉打磨（按剩余额度决定深度）**
- 统一配色、字体、图标、面板样式；保留 roguelike 字符地图风格
- 必须同时考虑暗色环境下的可读性

## 3. 验证（云端只跑与前端相关的测试，全量交回本地）

在 `brogue-web/` 下执行（**不要**跑完整 `npm test`，约 30 分钟、成本高）：

```bash
npm ci
npx vue-tsc -b
npx vitest run src/test/ui_1_rendering.test.ts src/test/ui_2_protection.test.ts src/test/i_1_interaction.test.ts src/test/p1_30_i18n_gate.test.ts src/test/u24_hardcoded_text.test.ts src/test/p2_4_animation_cadence.test.ts src/test/p2_6_display_settings.test.ts src/test/u_27_recording.test.ts src/test/x2a_recording_checkpoint.test.ts src/test/x3b_display_recording.test.ts src/test/w_7_arcana_enchantment.test.ts src/test/b_1a_identification.test.ts src/test/r_1_appearance.test.ts
npm run build
```

- 每阶段在上述四种视口下用浏览器实际操作并截图（放 `ai_docs/reports/fe-1-evidence/`），至少覆盖：开新局、移动、打开背包喝药、投掷选目标、上下楼、存读档、录像导出→重载→回放零 OOS
- 触屏操作录制的录像必须能在桌面端回放一致（验证第 1 条约束）

## 4. 交付

- 分支 `frontend-mobile`（按阶段提交并推送）
- 报告 `ai_docs/reports/fe-1.report.md`：各阶段改动、截图索引、引擎接口需求（如有）、已知问题、未完成项
- 完成后在报告末尾写明"可交本地验收"，本地验收方会跑全量门禁后合并
