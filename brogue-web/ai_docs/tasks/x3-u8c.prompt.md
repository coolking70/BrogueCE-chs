# X3-U8c：战斗文字按 CE（保留伤害数值显示开关）；符文武器/护甲首见提示；题字

> **本地执行（Mac 轨 xhigh）。门禁：全量**（C06 需补怪物类别名册）。基线：main（派发时最新，含 X3-U8a/U8b）。

## 0. 规格

**`ai_docs/reports/x-3-survey.report.md` 的 X3-C08、C06、D12（总表、§4、§5、§8 X3-U8 行）是权威规格**。
- **C08（用户裁决：默认按 CE）**：`C/Combat.c:1556-1615,1369-1397,1350-1363` 战斗文本缓冲、回合末 flush 并可用分号拼接；动词按伤害比例取（attackVerb），**默认不显示伤害数字与武器名**；看不见的战斗提示 "you hear combat in the distance"；startFighting 期间非致命命中不出文本（与 X3-U4 的 blockCombatText 衔接）。
  - **二次开发入口（用户要求保留）**：在现有显示设置（P2-6）中新增"显示伤害数值"开关，**默认关闭**；开启时在 CE 句式后附加伤害数值（纯显示，不改日志以外的任何状态，不入存档/录像语义）。实现上把"战斗句子构造"收敛到一个纯函数/模块，数值附加作为可选格式化参数，便于将来扩展。
- **C06**（`C/Time.c:2805-2825`）：首次直视到屠戮符文武器 / 免疫符文护甲对应类别怪物时提示 "the runes on your X gleam balefully / glow protectively." 并打 `ITEM_RUNIC_HINTED`；需按 CE `monsterClassCatalog`（`C/Globals*.c`）补怪物类别名册（web 缺，见 `G` 注释 I-1/UI-2）。
- **D12**（`C/Items.c:1390-1415`、`C/IO.c:2585-2587`）：题字（inscribe）与 `R` relabel；未鉴定时先确认 "Inscribe this particular item instead of all similar items?"。若与 X3-U5 已有的 `c`（命名）入口重叠，按 CE 区分"命名种类"与"题字单件"。

## 1. 约束

📌 CE 优先；撞守卫改代码不改守卫；守卫只在旧行为下才绿时先反事实证明、只修前提、交裁决。
不改伤害/命中数值；不新增主 RNG 调用（attackVerb 等若 CE 用随机，按 CE 所用随机流并说明）；录像回放零 OOS。文案走 i18n，中文动词表与 CE 分级一一对应。黄金 trace 因日志变化翻红：单变量归因后按原方法重录并登记。截图只放本地 evidence，不提交 PNG；不产生 CRLF。

## 2. 门禁（全量）

`npx vue-tsc -b`；`npm run build`；**全量 `npm test` 完整跑完**；`npm run test:drift`。长测试若因 CPU 争用超时，按原门限单独复跑并说明。

## 3. 报告

`ai_docs/reports/x3-u8c.report.md`：CE 依据、动词分级表与中文对照、数值开关说明（默认关、开启样例）、名册来源、题字流程、守卫与门禁结果。
