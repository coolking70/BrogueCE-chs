# Brogue CE 汉化与 UTF-8 最小改造计划

## 目标
- 先打通 Web 版中文可显示能力。
- 再做可维护的翻译流程（避免直接散改 3000+ 字符串）。

## 现状结论（代码约束）
- 文本布局大量依赖 `strLenWithoutEscapes()` 和固定列宽，当前按字节计数。
- SDL 输入路径目前只处理 `SDL_TEXTINPUT` 的首字节 ASCII。
- 渲染路径使用固定字形索引（tile/font atlas），不具备直接显示 CJK 字符的能力。

## Phase 1（必须先做）
1. 渲染层最小改造（Web/SDL）
- 为 UI 文本增加 UTF-8 渲染通道（推荐 `SDL_ttf`，仅用于文字层；地图 tile 保持原逻辑）。
- 保持地图字符与 UI 文本分离：地图继续走 `tiles/fontIndex`，消息/菜单/描述走 TTF。

2. 文本宽度与换行
- 新增 UTF-8 安全的文本宽度函数（按 codepoint + East Asian Width 规则）。
- 将 `strLenWithoutEscapes` / `wrapText` / 相关按钮对齐逻辑切换到“显示宽度”而非字节长度。

3. 兼容与开关
- 增加编译开关，例如 `BROGUE_UTF8_TEXT`。
- 默认不开启，确保现有构建不回归；Web 构建先启用。

## 首个可编译补丁范围（建议）
- `src/brogue/Combat.c`
  - 保留 `strLenWithoutEscapes` 名称，但内部改为调用新的 UTF-8 宽度实现（先兼容 color escape）。
- `src/brogue/IO.c`
  - `printString`、`wrapText`、`printStringWithWrapping` 改用“显示宽度 API”。
  - 先不改文案，仅保证已有英文行为不变。
- `src/platform/sdl2-platform.c`
  - 增加 UTF-8 文本渲染入口（仅在 `BROGUE_UTF8_TEXT` 下启用）。
  - 暂不触碰地图 tile 渲染。
- `brogueweb/build_web.sh`
  - 增加 UTF-8 文本构建开关（后续启用）。

## Phase 2（翻译工程化）
1. 抽取文案到资源
- 建立 `en_US` 与 `zh_CN` 资源（JSON/CSV/表驱动均可）。
- key 命名按模块，例如 `menu.new_game`、`msg.no_path`。

2. 保护动态模板
- `%d/%s`、`$HESHE/$HIMHER/$HISHER`、颜色 escape 必须完整保留。
- 增加校验脚本检查占位符一致性。

3. 先覆盖高频交互
- 菜单、帮助、消息、物品基础说明。
- 后续再覆盖怪物 lore 与长文本。

## 质量门槛
- 不崩溃、不卡死、消息栏/按钮不越界。
- Web + 桌面 SDL 都能通过基本启动与一局游玩 smoke test。
