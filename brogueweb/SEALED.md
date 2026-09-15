# 本目录已封存（2026-09-16）

**状态：封存，只读存档。不再接受任何开发改动。**

## 这是什么

`brogueweb/` 是早期的 **C → WebAssembly 移植路线**：用 emscripten 把
`BrogueCE-master/` 的 C 源码编译成网页版，配合 `i18n/` 下的脚本做汉化合并
（`merge_translations.sh` / `check_translations.sh`），并有 Android/Capacitor
的打包配置。

## 为什么封存

该路线已被 **`brogue-web/`（TypeScript/Vue 重构版）** 取代。

重构版不是把 C 编译成 wasm，而是按 CE 源码逐条重新实现，因此：

- 可以逐模块验收、逐条对照 CE 行号；
- 汉化改用 i18next 的「键 + 插值」模型，**不再需要**本目录 `i18n/` 下那套
  "拿英文成句反查模板"的机制（那正是 C 版汉化一系列结构性 bug 的病根：
  `templateMatch` 的 `strstr` 越界、COLOR_ESCAPE 字节被误判成 `%`、
  多占位符模板全数失配等）。

## 封存后的约束

- **不要在本目录下做任何开发**。
- **不要**让 `brogue-web/` 引用本目录下的任何文件。项目负责人已明确：
  brogue-web 是独立项目，如有引用需要，**复制进该项目目录内再修改**。
- 本目录保留仅为查证历史实现与对照。

## 与 `BrogueCE-master/` 的区别

`BrogueCE-master/` **不在封存之列**。它是 Brogue CE 的 C 源码，是本项目
**唯一的事实来源**——`brogue-web/` 的每一轮开发任务书都引用其中的行号
（`Combat.c:1963`、`Architect.c:2638` 等）。它保持**只读参考**状态：
可以读，不可以改。

## 相关文档

- `brogue-web/ai_docs/i18n_risk_assessment.md` —— 两套汉化方案的结构性对比
- `brogue-web/ai_docs/parity_gap_analysis.md` —— 重构版的还原度差距分析
- `brogue-web/ai_docs/dev_roadmap_2026Q3.md` —— 重构版的开发路线与决策记录
