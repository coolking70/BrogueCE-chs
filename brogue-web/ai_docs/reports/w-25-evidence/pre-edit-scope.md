# W-25 编辑前冻结
基准 f05fc4b。生产计划：arcana.json、Bolt.ts、ItemLoader.ts、ArcanaRecharge.ts、Game.ts（仅选择/快照入口）、GameCanvas.vue（瞄准提示）、BlinkTargeting.ts（只读预览/使用前熔岩确认）、zh_CN.json。效果分派、轨迹、Map/Generator/Random、魔杖数据不改。

预计改义：BoltCatalog.test配置18→21与新id/magnitude顺序（GC1642–1653）；W5旧staff目录/不可构造→9/85/10（同表）；W6 blink/obstruction未启用周期→CE10000/E（TC2028，IC338/4730），obstruction仍不可构造；W12/W13末尾目录缺项翻正（GC1645–1646），怪物BLINKING断言不动；W24中staff阶段数量7/58→10/85（W0§2.5）；归因、分布之后才决定基线。

只回归不可放宽：所有效果/P2/地形/目标UI/鉴定/极性/快照/机器/生成分布/i18n守卫，W26三种缺席，退池定义。W5自然覆盖若缺项仅补seed，完整期望不降。

R使用TS AST反向import闭包；S为G/Q/B/U/D + persistence/readers。编辑前135测试，R118，并集123；无未解析相对边。scope-before.json留存。新增文件后再次扫描。基线初跑通过，未重捕获。

入口核实后的必要扩面：DetailGenerator.ts 显示已知blink的半速回电，容量已知才显示当前/附魔后距离（IC3039/3109）。GameCanvas已有target_prompt在Vue文本节点中将充能斜线二次转义为&#x2F;，本轮目视发现并限定修正此提示插值。新增源文件/动态详情均计入最终R+S。无效果方法实现改动；zapBoltFromPlayer仅更新过期注释。

首次完整门禁R-1发现GameCanvas新增颜色字面量，按纯外观层架构扩面Appearance.ts；只迁入ARCANA_TRAJECTORY_FILL，无全局读取或游戏逻辑。R-1守卫/白名单原样，最终闭包重新扫描。
