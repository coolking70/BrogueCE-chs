# W-24 冻结生产面与断言分类（编辑前）
生产面：arcana.json、ArcanaInstance.ts、ItemLoader.ts、Bolt.ts、Game.ts（只快照）、zh_CN.json。
R=117、S并集=120，详见 scope-before.json；无未解析相对边。
预计改义：BoltCatalog 的14配置/缺新wand/旧magnitude序列；W5的5魔杖/15频率/7定义、缺polymorph；W17缺domination目录和构造；W23缺negation构造。依据：CE GlobalsBrogue.c:702-710 和 W0 §2.5。
只回归不可放宽：staff目录/频率、退池项、既有效果与怪物缺口、B1鉴定/极性/绰号、B4生成统计、机器/钥匙/蓝图覆盖、i18n扫描器、随机调用、快照与输入；生成漂移先归因后重采。覆盖门若失去原seed样本，补新样本而不降覆盖阈值。
基线改前 SHA256：1549a4c5aae041ff5c4a7653ea22d07af88aecaf3740861b0cdb90a4656d5820
