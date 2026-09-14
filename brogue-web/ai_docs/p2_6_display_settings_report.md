# P2-6 显示设置报告（地图缩放模式 + 侧栏宽度模式）

日期：2026-09-14
任务：新增"显示设置"，玩家可选**地图缩放模式**（等比 / 拉伸铺满）与**侧栏宽度模式**（固定 / 按比例）。

---

## 一、做了什么

| 文件 | 改动 |
|---|---|
| `src/engine/Settings.ts`（新增） | 响应式设置 store + localStorage 持久化 + `computeSidebarWidth` |
| `src/components/GameCanvas.vue` | `computeMapLayout` 增加可选 `mode` 参数（stretch 分支）；`applyLayout` 按设置取布局、`layer.scale.set(scaleX, scaleY)`；watch 设置变更触发重算 |
| `src/components/Sidebar.vue` | 宽度改由 `computeSidebarWidth(containerWidth, displaySettings.sidebarWidthMode)` 内联样式驱动（width/min/max 三值同步），CSS 里的固定 340px 移除 |
| `src/components/MainMenu.vue` | 新增"显示"分组：两个 select（地图缩放 / 侧栏宽度），经类型守卫直接写响应式 store |
| `src/test/p2_6_display_settings.test.ts`（新增） | 19 条对抗性测试（A 默认与等比、B 拉伸、C 指针映射、D 侧栏宽度、E 持久化、F 源码守卫） |

`App.vue` 在允许清单内但**实际无需改动**（设置走全局 store，不需要经过 App 中转）。localStorage 键名沿用版本化惯例：`brogue-web-display-v1`。

**玩法逻辑零改动**：Settings.ts 不被任何玩法模块引用；`Game.ts`、`entities/`、`Combat/`、`Generator/`、`Environment/`、`data/*.json`、三份 fixture 均未触碰。

---

## 二、两种缩放模式的实现与 CE `tiles.c:782-803` 对照

CE（`src/platform/tiles.c:782-803`，已核实）对整张 `COLS × ROWS` 网格逐格摆放：

```c
dest.x    = x * outputWidth / COLS;
tileWidth = ((x+1) * outputWidth / COLS) - (x * outputWidth / COLS);   // y 同理
```

要点：
1. **两方向独立拉伸**：x 用 `outputWidth/COLS`、y 用 `outputHeight/ROWS`，不保持宽高比，允许放大；
2. `(x+1)*W/C - x*W/C` 的整除写法把余数摊到各格，使相邻格边界严丝合缝、**整行恰好铺满 outputWidth**。

web 两种模式的对应实现（`computeMapLayout`）：

| | uniform（默认，= P2-5 现状） | stretch（CE 口径） |
|---|---|---|
| x 缩放 | `min(1, W/mapW, H/mapH)` | `W / mapW`（可 > 1） |
| y 缩放 | 同上（等比） | `H / mapH`（与 x 独立） |
| 偏移 | 居中，`max(0, …)` | `(0, 0)` |
| 黑边 | 有 | 无 |

CE 的"整除摊余数"与 web 的"连续缩放"是同一划分的离散/连续版本：web 格 i 的边界 `i·(mapW·scaleX) = i·W/79`，CE 的边界是该实数值的取整。测试 B4 把 CE 公式实现为参考实现，断言两边都恰好铺满（CE：各格整除宽度之和 = outputWidth；web：右/下缘 = 容器尺寸，误差 ≤ 1e-6，远小于 1px 容差）——即"铺满、无 1px 缝隙"这一 CE 性质在 web 得到复刻。

注意 web 的地图区是 DCOLS×DROWS（79×29，已扣除状态栏/消息行），CE 的公式作用在整张 COLS×ROWS 上——公式同构，作用域不同，这是两边UI架构差异的自然结果，不影响"拉伸铺满"的语义。

---

## 三、侧栏最小宽度取值与理由

`SIDEBAR_MIN_WIDTH = 272`（提示词建议区间 260-280 的中段）。

- CE 侧栏文字随字符网格一起缩放，比例再小也读得出；web 侧栏是 DOM 文本，字号不随宽度变，若按 20% 硬算，1024px 窗 → 205px，内容会挤成一团。
- 272px 扣除两侧 1.5rem 内边距后内容区仍有 224px（= 14rem）：HP 行的固定开销（标签 20px + 数值 45px + 间距）之外，血条与日志文本仍能正常排版；状态标签（status-tag，含圆角胶囊与 2px 8px 内边距）在 224px 内一行能放 2-3 个。
- 低于 ~260px 后日志正文（0.9rem ≈ 14.4px，每行约 14-15 个汉字）每行只剩 7-8 字，可读性断崖式下降。

按比例公式：`max(272, round(containerWidth × 0.2))`，0.2 = CE `STAT_BAR_WIDTH(20) / COLS(100)`。

---

## 四、设置变更如何触发布局重算（不刷新页面）

两条路径都汇入 `GameCanvas.applyLayout()` 这一条既有重算路径：

1. **侧栏宽度模式切换** → Sidebar 的 computed 样式立即生效 → 画布容器宽度变化 → 既有 `ResizeObserver` 触发 `applyLayout()`（这正是 P2-4/P2-5 建好的路径，无需新代码）。
2. **地图缩放模式切换** → 容器尺寸不变，ResizeObserver 不会触发 → `onMounted` 里显式 `watch(() => displaySettings.mapScaleMode, () => applyLayout())`（P2-6 新增，卸载时停止）。

持久化走 `Settings.ts` 的模块级 `watch(displaySettings, …, { flush: 'sync' })`：变更频率极低（用户点选），同步写让 localStorage 与 store 严格一致——变更后立刻关页也不丢。（首版用默认异步 flush，测试暴露了"变更后同步读 storage 尚未写入"，遂改 sync。）

---

## 五、指针映射在拉伸模式下的验证

**结论：`toLocal` 在 x/y 缩放不同时依然成立，无需修改。** 原因：`Container.toLocal` 走完整仿射变换的逆矩阵（逆矩阵天然支持 sx ≠ sy），不假设等比。

测试 C1/C2 用**真实 PIXI Container** 复刻 GameCanvas 的指针路径（`layer.position.set(ox,oy); layer.scale.set(sx,sy); toLocal(global)` → `Math.floor(local / TILE_SIZE)`）：

- stretch 布局（scaleX=1260/1264≈0.997，scaleY=900/464≈1.940，显著不等）：格子 (0,0)、(39,14)、(52,17)、(78,28) 的中心点全部映射回原格子；
- uniform 布局（含居中偏移 478/218）：同样全中——确认本轮改动没有破坏等比模式的映射。

---

## 六、验收条款逐条对照

| # | 条款 | 结果 | 证据 |
|---|---|---|---|
| 1 | 玩法零影响，三份 fixture 比对全过 | ✅ | 全量 30 文件全绿（含引用 fixtures 的 p2_1/p2_2/p2_3）；玩法代码零 diff |
| 2 | 等比默认：右/下缘绝不溢出、scale ≤ 1 | ✅ | A2/A3：8 档宽 × 4 档高，与测试内**独立复算**的 P2-5 公式逐字段相等（非函数自比）；溢出不变量逐档断言 |
| 3 | 拉伸：恰好铺满（≤1px）、x/y 比可不同 | ✅ | B1/B2/B3/B4；且 B2 断言允许放大（CE 无上限），B3 断言同一容器等比留黑边/拉伸铺满 |
| 4 | 侧栏按比例 = 容器宽×比例、不低于最小值、窄窗生效 | ✅ | D1（1920→384、1600→320、1360→272 边界重合）；D2（1300/1024/800 → 272）；D4 单调性与下限不变量扫描 |
| 5 | 持久化写入 localStorage、重读保持 | ✅ | E1：写 `brogue-web-display-v1`；`vi.resetModules()` 后重导入（模拟重开页面）保持；E2/E3 损坏/非法值逐字段回退 |
| 6 | 默认值渲染与 P2-5 完全一致 | ✅ | A1 默认 uniform/fixed；A4 默认模式驱动布局 ≡ 无 mode 参数（P2-5 语义）；A2/A3 与独立复算一致 |
| 7 | 拉伸下指针映射 | ✅ | 见第五节，`toLocal` 成立，无需修 |
| 8 | `npm test` 全绿、270 不减；build 全绿 | ✅ | 289 passed = 原有 270 + 新增 19；`vue-tsc -b && vite build` 通过（chunk >500kB 警告为既有现象，非错误） |

另：**p2_4 的 F1-F3/E1-E2 最终无需修改**——`computeMapLayout` 以"可选第三参（默认 `'uniform'`）+ 返回值新增 scaleX/scaleY、保留 scale 兼容字段"的方式扩展，原有断言（两参调用、destructure `scale/offsetX/offsetY`）语义原样成立。符合"若需要扩展才扩展"的最小改动要求。

---

## 七、反向验证（§5.2）

两处人为改坏，均被新测试当场抓住，随后还原（diff 已复核无残留）：

1. **移除侧栏最小宽度守卫**（`max(272, …)` → 直接 `round(w×0.2)`）：
   ```
    ❯ src/test/p2_6_display_settings.test.ts (19 tests | 2 failed) 208ms
        × D2 窄窗口：最小宽度生效（对抗"直接乘比例"的错误实现） 2ms
        × D4 不变量：proportional 永不低于最小宽度，且随容器宽单调不减 0ms
    Tests  2 failed | 17 passed (19)
   ```
2. **给拉伸模式错误地加 scale ≤ 1 上限**（模拟"顺手复用等比的 min(1,…)"）：
   ```
    ❯ src/test/p2_6_display_settings.test.ts (19 tests | 4 failed) 213ms
        × B1 中等容器：恰好铺满（右缘 = 容器宽、下缘 = 容器高，≤1px），x/y 缩放不同
        × B2 大窗允许放大（CE 无 scale 上限），铺满不缩水
        × B3 同一容器：等比留黑边（offset > 0），拉伸 offset = 0 铺满
        × B4 CE 整除公式参考实现对照：两者都恰好铺满、无 1px 缝隙
    Tests  4 failed | 15 passed (19)
   ```

---

## 八、测试与构建输出尾部

`npx vitest run --no-file-parallelism`（云同步目录负载抖动对策，见项目记忆）：

```
 Test Files  30 passed (30)
      Tests  289 passed | 4 skipped | 5 todo (298)
   Start at  16:54:45
   Duration  32.21s (transform 285ms, setup 0ms, import 959ms, tests 29.04s, environment 5ms)
```

`npm run build`（`vue-tsc -b && vite build`）：

```
dist/assets/CanvasRenderer-BnihtKbc.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-CAwRjciN.js       38.19 kB │ gzip:  10.83 kB
dist/assets/browserAll-BLhsijTn.js           41.30 kB │ gzip:  12.57 kB
dist/assets/RenderTargetSystem-Cov6Eoal.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-D72fr9ET.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-GbSEufUK.js               894.73 kB │ gzip: 283.48 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/...
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.38s
```

---

## 九、git diff --stat

```
 brogue-web/src/components/GameCanvas.vue | 64 +++++++++++++++++++++++++++-----
 brogue-web/src/components/MainMenu.vue   | 51 ++++++++++++++++++++++++-
 brogue-web/src/components/Sidebar.vue    | 25 ++++++++++---
 3 files changed, 124 insertions(+), 16 deletions(-)
```

新增（未跟踪）：`src/engine/Settings.ts`、`src/test/p2_6_display_settings.test.ts`、本报告。

---

## 十、与预设不符之处（只列不修）

1. **i18n 键未入 `src/locales/zh_CN.json`**：该文件既不在"允许修改"也不在"禁止触碰"清单；按 §5.1 对允许清单的严格执行，本轮未动它。新设置文案以 `t('menu.display.*', { defaultValue: 中文 })` 的 fallback 呈现（MainMenu 现有模式，真实 zh_CN 环境直接显示中文；harness 下英文是 §二 预期的 fallback，非缺翻译）。若维护者认可，补 6 个 `menu.display.*` 键是一行事，留待下轮授权。
2. **p2_4 的 F1-F3/E1-E2 无需扩展**：提示词预留了修改许可，但实现选择了向后兼容的函数签名扩展，原有断言原样通过。不是分歧，是"预留的口子没用上"的备案。
3. **提示词给出的事实全部核实无误**：`tiles.c:782-803` 的独立拉伸 + 整除摊余数写法、`STAT_BAR_WIDTH=20`/`COLS=100`、App.vue:15-16 的键名惯例、`applyLayout()` + ResizeObserver 的重算路径、侧栏原固定 340px（width/min/max 三值）——逐一到源码核对，未发现错误。本轮无"授权反驳"情形。
4. **一处实现层披露**：侧栏按比例模式的容器宽取 `window.innerWidth`（app-layout 为 100vw 的 flex 行，侧栏是其直接子元素，窗口宽即容器宽）。这与"地图必须用画布容器尺寸"的 P2-4 口径并不冲突——那条规则只约束地图居中/命中区，GameCanvas 的源码守卫（E4）也只针对 GameCanvas，Sidebar 用窗口宽是正确口径。
