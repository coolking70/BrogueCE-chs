# W-26 编辑前范围冻结
生产：arcana.json、Bolt.ts、ItemLoader.ts、zh_CN.json；ArcanaRecharge.ts 仅更新 obstruction 已入池注释。无效果、生成器、Game/UI 行为修改计划。
预计改义：BoltCatalog 配置21→24及三项缺席；W5目录9/85/10→12/110/13、自然落地全21种仅允许增seed；W6 obstruction构造null→非null；W14仅物品/配置缺席→存在；W24/W25阶段目录数/票数/分布分母/外观数及缺席→最终目录。依据CE Globals.c:1648/1649/1653与W-0 §2.5。
只回归：全部效果公式/时间/随机边界、机器不配发、退池定义、B-1、i18n扫描、地形/DF/9c、p4_1b怪物blink/网/藤、生成基线观测字段。闭包不是断言改义授权。
先记录初始drift；改目录后记录drift；旧九行控制→仅新增三行反事实归因；独立12种/110票与E/RNG分布通过后才决定基线。

静态核读补充：W15一条合并protection/light退池断言须拆分，仅protection入池翻正，light与所有护盾效果断言不变。CE GC1653。

首次最终回归补充发现：W9末例仍断言spawnStaff(discord)=null；按CE GC1649/W26明确入池仅翻正此项，预览纯函数和所有76项效果测试保留。原完整失败结果归档prefinal-w9-catalog，随后重新完整冻结复跑。
