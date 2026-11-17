# ForgeTax 逆向设计文档

> 基于游戏发行包资源逆向分析产出。分析对象：`ForgeTax`（Steam 版，Unity IL2CPP 构建）。
> 方法：UnityPy 解析 data.unity3d 全量 46,150 个资源对象、2,407 个脚本类名、557 个 MonoBehaviour 序列化数据；global-metadata.dat 字符串/字段名扫描；场景分区标签与贴图/音频/动画命名交叉验证。
> 置信度标注：**(实证)** = 资源中直接提取；**(推断)** = 多项证据交叉推断；**(推测)** = 单一弱证据推断。

## 1 游戏概述

- **游戏名**：ForgeTax（可直译"锻造税"——锻造者向巨龙缴纳税贡）(实证)
- **类型**：第一人称锻造模拟 × 回合制经营 × 动作 Boss 战 × Roguelite 数值循环 (推断)
- **一句话概括**：你是被巨龙囚禁在巢穴锻炉里的铁匠，每天为它锻造并上贡武器，直到契约终点"5月8日"——或者，你锻造出足以屠龙的那把剑。(实证+推断)
- **平台**：Windows PC / Steam 单机（steam_api64.dll + Steamworks.NET，含成就与会话系统）(实证)
- **引擎**：Unity 6.x（IL2CPP，元数据版本 107；URP 渲染管线；Burst 编译；DirectStorage；D3D12）(实证)
- **代码保护**：Obfuz 混淆（混淆了类型名，但字段名/资源名/字符串大量保留，本报告得以还原）(实证)
- **语言**：韩文为源语言，同时内置英/德/葡/西/繁中（NotoCJK）等多语言，脚本含 "ForgeNineLanguageReview"，本地化规模为 **9 种语言** (实证)
- **开发形态**：单场景全量打包（一个场景容纳全部游戏内容，46K 对象），内部代号 **GPT6**（GPT6ForgeRoom / GPT6ItemSlot / GPT6ForgeInteractable 为核心房间管理组件）(实证)
- **存档版本**：`ForgeTax.ActiveSaveSlot.run_release24_v1` (实证)

### 1.1 美术与演出风格

- 场景侧：写实向低多边形锻造工坊 + 洞穴巢穴（材质命名：soot iron / worn steel / aged brass / oxblood leather / yellow parchment 等手工质感材质库）(实证)
- 龙侧：**蜡笔手绘风**（DragonCrayon 贴图族；龙的血条 HUD 也是蜡笔画风 "Dragon crayon / Dragon crest and health"）(实证)
- 强反差美术方向：压抑写实的囚禁锻炉 × 童画质感的巨龙 (推断)

## 2 世界观与叙事 (实证，对话文本自元数据直接提取)

**背景**：玩家是巨龙巢穴中的被囚铁匠，与龙订有"契约"。

场景告示文案（3D 场景内招牌）：

> THE DRAGON TAKES HIS DUE（龙收取它应得的）
> THE FORGE NEVER SLEEPS（锻炉永不停歇）
> NOTICE: THE FORGE TAKES ITS CUT. NO REFUNDS.
> THREE SWORDS. YOUR RESPONSIBILITY.（三把剑，责任自负——武器架提示）

**关键对话**（龙对铁匠，多语言本地化）：

- "Huh? / You... just... / You little runt. / One decent sword in your hands, and you think that changes anything?!"
- "Wait! / Hear me out. / Kill me, and you'll never get out of here. / Please."
- "W-well done. / F-for now... / Keep forging..."
- "I hear a merchant comes by every three days."（商人情报）
- "I'll give you three swords every day." / "I don't care how many swords you offer." / "I'm only saying this once." / "Don't make me find another one."（每日供货与威胁）
- 最后一天："Tomorrow, bring me every sword you have. / Every last one. / It's our last day. Let's keep things pleasant. / The last day already?"
- 结局揭幕："You've worked hard. / You'll finally see your family again. / You're keeping your promise? / Of course. / Your family. The city you called home. / **I wiped them all out.** / Don't worry. You'll be joining them soon. / But..."
- 契约期限告示：**"Honor your contract through May 8..."**（日历牌文案）

**叙事节奏控制**：对话系统含 Pause/BeforeInsult、Pause/BeforeQuestion、Pause/Break 等节奏标记，说明对话播放有逐句停顿演出 (实证)。

**结局分支证据**：EndingClockRewind（时钟倒转）、iron-bound coffer（铁箍箱结局）、Story / execution scream（处决演出）、DragonDeathSelected、DragonFinalLaugh、EndingCredits、"and you're free"（自由结局台词）→ 至少存在：处决龙 / 契约履行完获释 / 时间回环 三类结局走向 (推断)。

## 3 核心玩法循环

**一天 = 一回合**（日历 UI 有 31 个日期格，4月牌面，契约终点 5月8日）(实证)：

1. **开局/日常**：龙每天给 3 把待修剑（"I'll give you three swords every day"），玩家持有武器架上限 3 把 (实证)。
2. **锻造**：把剑放进炉（"든 검을 넣어 가열하기" / 加热）→ 到砧板（"모루 작업 · 검 놓고 망치 들기" / 放下剑拿起锤）→ 锻打 → 掷骰结算（成功/大成功/损伤/破坏/维持）。
3. **上贡**：从铁窗（BARRED SERVICE WINDOW）把成品递给龙（"든 검을 철창 밖으로 상납"），要求金额如 1,800 G；账簿（FORGE LEDGER）记录"上贡价值/要求额度"。
4. **商人**：每 3 天幽灵商人来访（MerchantArrival），可购物；每次来访可**免费刷新一次**货架（"Refresh the goods for free once per merchant visit"）。
5. **龙遭遇战**：按日历/事件触发 Boss 战（DragonEncounter→DragonBattle），有阶段二、倒地、处决演出。
6. **回合结算**：按铃结束回合（"벨 누르기 · 라운드 종료"），日历推进。
7. **终局**：最后一天收走所有武器 → 结局；或进入无尽门（ForgeEndlessDoor）继续循环。

**Roguelite 元数据证据**（ForgeTelemetry 字段名，即运行期状态模型）(实证)：

`gold、credits、tickets（奖券）、fever、destroyed、protectedBreaks、outcomes、heldStrikes（持剑锤击数）、heldSeconds、zeroChanceBreaks、protectedDestroyed、freeRerolls（免费重掷）、rerollGold、rolls、weaponHits、swordPeak、offeredPeak、highGradePeak、physicsPeak、finished、won、paid、endless、Health、Journey（单局记录）、attempt（局数）、inheritGrade（继承品级）、stock、stockValue、offeredValue、stockGrades、cadence（商人来访节奏）、decisions（Decision: strike/free/price）、SwordState、serial、place、banks`

## 4 系统详解

### 4.1 锻造强化系统 (实证)

- **流程**：炉中加热（Blade / before coals、Blade / inside firebox 场景对象）→ 砧板锤击（AnvilStump、锤击音效序列）→ 结算。
- **五种结果**（UI 贴图 ticketsuccess / ticketgreat / ticketdamage / tickethold + 韩文 성공/대성공/손상/파괴/유지）：成功、大成功、损伤、破坏、维持。
- **结算表现形式为"奖券"**（추첨표，票面共 30 张，"총 30장"）——强化结果像抽签一样开奖，配 BonusReceipt 音效 (实证)。
- **核心配置表**（ForgeEnhancementBalance "OpeningBalance"，7,280 字节序列化数据，含两张数值表）(实证)：
  - 表 A（强化概率/风险，按等级 1–8+）：等级 1 档位约 [3.0, 9.3, 23.1, 55.4, 9.2]，等级 2 档位 [12, 8.4, 20.9, 50.3, 8.4]，等级 3 [30, 6.7, 16.6, 40, 6.7]，等级 4 [65, 3.4, 8.3, 20, 3.3]……高等级档位一侧单调上升至 65→70.7→75.8→80.3→84.1，另一侧（风险列）单调下降。列语义推断为 [门槛/代价, 破坏%, 损伤%, ?, 维持%] 之类（列的确切对应关系为推断，五列对应五种结果+成本）。
  - 表 B（1–51 行的日历曲线）：某概率值从低值平滑爬升，第 29 行 99.9、第 30 行起恒为 100，伴随 0.1 步长修正——推断为**随天数递增的保底/兜底概率**（如龙满意度或破坏保险生效曲线）(推断)。
- **韩文 UI 直译**："강화 위험은 모루 확률에 반영"（强化风险会反映到砧板概率上）、"검 요구가치"（剑的要求价值）、"올려놓은 가치"（放上去的价值）→ 强化风险与武器价值联动 (实证)。
- **相关脚本**：ForgeAnvilDisplay、ForgeMetalFinish、ForgeBreakFragments、ForgeBreakTrace、ForgeScrapVisual（损伤/破坏有碎片与废料表现）、ForgeImpactFeedback、ForgeSwordCollision、ForgeSwordColliderLayout（78 个实例=武器碰撞体布局）、ForgeWeaponEffect（127 个实例=武器特效配置）。

### 4.2 武器进化系统 (实证)

**EvolutionCatalogue**（45 条目目录资产，含每条：ID、进化名、所属分支等字段）：

主链（按资产内顺序）：

| # | 韩文原名 | 中文直译 |
|---|---|---|
| 1 | 낡은 검 | 破旧的剑 |
| 2 | 두꺼운 철검 | 厚铁剑 |
| 3 | 휴대용 철문 | 便携式铁门 |
| 4 | 성질난 쇳조각 | 发脾气的铁块 |
| 5 | 물어뜯는 검 | 撕咬之剑 |
| 6 | 마력의 파편 | 魔力碎片 |
| 7 | 각성의 검 | 觉醒之剑 |
| 8 | 뭔가 이상한 철판 대검 | 有点不对劲的铁板大剑 |
| 9 | 통째로 뜯어낸 성문 | 整块撕下来的城门 |
| 10 | 손잡이 달린 요새 | 带握把的要塞 |
| 11 | 산맥을 짓누르는 성채 | 镇压山脉的堡垒 |
| 12 | 대륙을 가르는 철의 성채 | 割裂大陆的铁之堡垒 |
| 13 | 빛이 깃든 은빛 검 | 寄宿光的银剑 |
| 14 | 어둠을 가르는 서광의 검 | 破开黑暗的曙光之剑 |
| 15 | 왕의 자격을 묻는 성검 | 质问王者资格的圣剑 |
| 16 | 새벽을 여는 약속의 성검 | 开启黎明的誓约圣剑 |
| 17 | 엑스칼리버 | **Excalibur** |
| 18 | 이게 톱인지 검인지 | 这是锯还是剑 |
| 19 | 맞물려 도는 강철 톱검 | 咬合转动的钢锯剑 |
| 20 | 강철을 갈아먹는 분쇄검 | 磨钢吞铁的粉碎剑 |
| 21 | 산맥을 깎는 절단기 | 削平山脉的切割机 |
| 22 | 멈추지 않는 파멸의 톱니 | 不停转的毁灭锯齿 |
| 23 | 용왕의 송곳니 | 龙王的犬齿 |
| 24 | 어린 용의 아가리 | 幼龙之颚 |
| 25 | 비룡을 낚는 갈고리 | 猎飞龙的钩 |
| 26 | 용왕의 목을 거두는 단두대 | 收取龙首的断头台 |
| 27 | 용살검 그람 : 파프니르의 저주 | 龙杀剑 Gram：法夫纳的诅咒 |
| 28 | 주문 새긴 룬검 | 刻着咒文的符文剑 |
| 29 | 마력 과충전검 | 魔力过载剑 |
| 30 | 대마법사의 마력기관 | 大魔导师的魔力机关 |
| 31 | 현실에 금을 내는 검 | 给现实刻下裂痕的剑 |
| 32 | 아카샤 · 창세를 품은 검 | Akasha·孕育创世之剑 |
| 33 | 부러져도 붙어 있는 검 | 断了也粘着的剑 |
| 34 | 검을 거느리는 검 | 统御剑之剑 |
| 35 | 양심 없는 검 | 没有良心的剑 |
| 36 | 천검을 거느린 군주 | 统御千剑的君主 |
| 37 | 이기어검(以氣馭劍) | 以气驭剑 |
| 38 | 다듬은 검 | 修整过的剑 |
| 39 | 쓸 만한 철검 | 像样的铁剑 |
| 40 | 이중 철판 대검 | 双层铁板大剑 |
| 41 | 축복이 새겨진 검 | 刻着祝福的剑 |
| 42 | 철판도 씹는 톱검 | 连铁板都嚼碎的锯剑 |
| 43 | 어린 용의 턱 | 幼龙之颌 |
| 44 | 깨어나는 마력의 룬검 | 苏醒的魔力符文剑 |
| 45 | 혼자 있기 싫은 검 | 不想独处的剑 |

**五条进化线**（按目录分段）(推断)：

1. **堡垒线**（1→12）：剑一路膨胀成"便携铁门→带握把的要塞→割裂大陆的铁堡垒"——把"越锻越大"做到荒诞极致的喜剧线。
2. **圣剑线**（13→17 Excalibur）：光/誓约/黎明意象的正统传奇线。
3. **锯剑线**（18→22）：锯与剑的杂交，战斗音效独立成组（Saw combat / Bite、Grind、Motor——锯剑有"马达"音效）。
4. **龙骨线**（23→27 Gram/Fafnir）：以龙制龙，终点是屠龙魔剑。
5. **符文→Akasha 线**（28→32）：魔力机关到"孕育创世"。
6. **御剑线**（33→37 以气驭剑）：剑自己会飞、统御千剑——对应 SwordFlight/SwordWake 音效与"검을 거느리는 검"。
7. 38–45 为**另一组起点/改良链**（다듬은 검起头），推断为进阶周目或分支重组的词条池 (推测)。

**进化演出与实现**：ForgeSwordEvolution / ForgeSwordEvolutionSet / ForgeSwordMetamorphosis / ForgeSwordNames / ForgeSwordMaterialPool / ForgeSwordTransitionPool（材质与过渡对象池）、Awaken_2/4/6/9/16/20 觉醒动画 (实证)。每把进化武器在场景内有 EvolutionRig（48 实例）+ ForgeSwordColliderLayout + 各分支专属 Rig（RunebladeRig 符文剑能量、WorldTreeRig、FuneraryRig、SawSiegeMotion 锯的攻城动作）(实证)。

### 4.3 进贡与经济系统 (实证+推断)

- **货币**：金币 G（Wallet / coin counting 音效、ForgeWalletHUD、Cash drawer 场景物件、150 G / 1,800 G UI 文本）+ credits（信用，ForgeCreditShelf——"信用货架"遗物相关）。
- **上贡流程**（PHYSICAL TRIBUTE FLOW 分区）：成品剑从铁窗递出 → 龙清点（DragonSnatch 夺取音效）→ 记入账簿。UI 文案：상납 가치（上贡价值）/ 올려놓은 몫（放上来的份额）/ 요구액 1,800 G（要求额）。
- **账簿**（FORGE LEDGER 分区 + ledger / ghostledger / funeralledger 三种账本贴图）：run 进度总览；ForgeTributeGate / ForgeTributeMeter（进贡计量条）/ ForgeTributeWarningReview（告警）/ ForgeFinalTributeDialogue（最后一天收缴全部武器）。
- **奖券**（ForgeTicketPaper，5,904 字节配置）：每回合 30 张票，结果票面四种（成功/大成功/损伤/维持），"× 지움 + 추가"（消除/追加标记）→ 奖券构成了一种**可累积的保底/修正资源** (推断)。
- **武器架**：3 把上限，E 键存取（"E / STORE OR RETRIEVE YOUR SWORD"），Excalibur 级成品与素材剑分开管理 (实证)。

### 4.4 龙遭遇战（动作战斗） (实证)

- **龙的完整动画集**：Idle / Walk / Run / Fly / Glide / TakeOff / Land / Turn / ClawSwipe_L / ClawSwipe_R / OverheadSlash_L / OverheadSlash_R / TailSweep / PounceSlam（扑击砸地）/ Breath（Air/Ground 吐息）/ HitReact / Stagger / DownedIdle / Collapse / DefeatFall / **PhaseTwo**（变身处刑）/ Transformation charge。
- **阶段设计**：PhaseTwo 独立动画 + "Phase pressure wave / Phase roar / Phase two / chest reflected heat / rising scarlet embers" → 二阶段有形态变化与红色余烬演出 (实证)。
- **Boss 入场**：DragonBossEntrance（EntranceFallingRubble 落石 / EntranceIgnition 点火 / EntranceParry 格挡——玩家开场要挡一下）、DragonApproach、DragonIntroRoar (实证)。
- **战斗支持系统**：DragonPlayerHealthScreen（龙侧血条为**场景内 3D 血板** DragonHealthSlate）、DragonCameraImpulse（镜头震动）、DragonCombatBalance（独立平衡配置）、DragonExecutionAura + Story / execution scream（**处决演出**）、DragonDeathSelected（死亡结算）、DefeatGroan。
- **复战系统**：ForgeDragonRematchRules（Rematch arena / grip / weapon / return requires a committed result——复战必须已有提交结果才允许返回）、RematchFirePair、RematchReturn/RematchSaving (实证)。
- **利维坦**：LeviathanRig（Emerge / Swim / Collapse / Breath / Tide）+ DragonLeviathanRide（**骑乘利维坦**）+ Leviathan rider / combat target → 后期或无尽模式有水战坐骑内容 (实证)。
- **玩家侧**：DragonPlayerSword、PlayerSwing / PlayerSwordHit、Deflect（格挡）、PlayerHurt、DragonSawGrind（锯剑研磨攻击）、DragonSwordFlight（御剑飞行攻击）(实证)。

### 4.5 幽灵商人系统 (实证+推断)

- **节奏**：每 3 天来访一次（MerchantSchedule / MerchantPacingReview / cadence 遥测字段）。
- **形象**：幽灵商人（ForgeGhostMerchant + MerchantShadowSupport + MerchantTripo 贴图 + Ghostly Tone 音色 + 商人从"墙壁通道"进入 "An der markierten Wand entsteht ein Durchgang" 德语文案=墙上出现通道）。
- **货架**：MerchantStock + stockGrades / stockValue / offeredValue 遥测字段（**货品分品级**）；每次来访免费刷新一次；购买后格子留空（"구매한 칸은 비워둠"=买掉的格子保持空）(实证)。
- **交互决策**：遥测 Decision{strike, free, price} + ForgeMerchantItem / ForgeMerchantFoundation (实证)。
- **剧情**：MerchantStoryState / MerchantDialogue / MerchantLines / MerchantVoice / MerchantReaction——商人有独立剧情线（疑似解救玩家的暗线，推测）。
- **商品内容**：物品商店为"嵌入式玻璃柜"（RECESSED GLASS ITEM SHOP 分区）；商人商品含 SeafoodPresentation（11 件海鲜类展品——给龙的"贡品饲料"？，推测）。

### 4.6 遗物系统 (实证)

- **数量**：8 种（"유물 8종 / 중복 구매 = 레벨 상승" = 遗物 8 种，重复购买=升级）。
- **售卖方式**：遗物售货机（ForgeRelicVending）+ 蜡纸票券风 UI。
- **已知遗物线索**（Forge/Relics/ 资源地址）：creditshelf（信用货架）、rewind（倒带——对应 RewindUse 交互音效与"时光倒流"能力）、ward（守御/护壁，WardHit / WardArm 交互）、外加 dragonheart（龙心）、dragonpardon（龙之赦免）、dragonseal（龙之封印）贴图 (实证)。
- **表现**：ForgeStagedRelicView / ForgeReactiveRelicVisual / ForgeRelicPulseMotion / ForgeLiveRelicView（遗物有动态可视与脉冲演出）、RelicProcHUD（**遗物触发式被动**，配 Relic elemental burst / keyword ink / tally audio 音效组）(实证)。
- **规则层**：ForgeRelicRules / RelicRules / RelicModule / ForgeRelicFoundation / ForgeStarterRelic（**开局三选一起始遗物**：StarterRelics/Choose + StarterRelics/Chosen 地址）(实证)。

### 4.7 Fever 系统 (实证+推断)

Fever / orbit、overdrive audio、prismatic shrapnel、rainbow room flash、rising embers、sustain audio（ForgeFeverPresentation + FeverOverdrive 音效）→ 连续锤击/成功积累触发的**彩虹过载爆发状态**：房间闪光、棱镜弹片、持续音墙 (推断)。遥测 fever 字段确认其为数值系统的一部分 (实证)。

### 4.8 回合日历与终局 (实证)

- ForgeRoundCalendar：31 个日期卡对象（Date 1–31），4 月起始，契约终点 5 月 8 日（"Honor your contract through May 8"）；ForgeCalendarEndlessChecks（日历与无尽模式的衔接检查）。
- 结束回合：服务台按铃（TributeBellInteraction + 벨 누르기·라운드 종료）。
- 结局演出资源：EndingClockRewind（**时钟倒转**——时间回环结局）、iron-bound coffer（铁箍箱）、EndingCredits、ForgeEndingSequence、ForgeEndingPolishProbe、"........and you're free"。
- **无尽模式**：ForgeEndlessDoor / EndlessDoorUI / EndlessDoorText（无尽门）、Endless / dragon exit / rematch passage、ForgeEndlessRematch——通关后经无尽门进入无限复战循环，遥测 endless 字段 (实证)。

### 4.9 练习/挑战模式 (实证)

- ForgePracticeTarget + ScarecrowRig（**稻草人靶**，四档受击反应 HitWeak/HitNormal/HitStrong/HitMaximum）+ Practice dummy / Practice sword air / elastic impact voice。
- ForgePracticeCombat / ForgePracticeLeaderboard + ForgePracticeRankingClient（**联网排行榜客户端**，排名/榜位遥测字段）+ ForgePractice.CachedTop.v1 / ForgePractice.Pending（排行榜缓存与待提交状态）。
- 推断：独立于战役的"打木桩冲榜"分数玩法 (推断)。

### 4.10 存档系统 (实证)

- ForgeSaveData / ForgeSaveSlots（多存档位）/ ForgeSaveStore / ForgeSaveValidation（读写校验：reads / readFailures / recoveries / writes / writeFailures / protectedReads 遥测字段——**读档失败自动恢复**机制）。
- 存档键版本化：`ForgeTax.ActiveSaveSlot.run_release24_v1`；"recovered overlapping saved duplicates"（重叠存档去重恢复）。
- ForgeRewindHotfixReview / ForgeSpatialHotfixReview（空间状态热修复）→ 存档含房间/剑的空间布局，损坏后可空间级重建 (推断)。

### 4.11 Steam 集成 (实证)

- ForgeSteamSession / ForgeSteamAchievements（成就，achievementState / localEarned / pending / storeResult 遥测字段——**离线先记账、上线后补传**的成就同步）、ForgeSteamAccessReview、ForgeTax Steam callbacks/exception/startup 日志通道。

### 4.12 音频架构 (实证)

- **混音分组**（ForgeAudioMixProfile）：holy、worldtree、citadel、rune、funerary、flight、player、dragon、music——按**武器进化线**分混音组。
- 全 191 个音频资源覆盖：龙声（Approach/IntroRoar/FinalLaugh/Snatch/DefeatGroan）、锻造（Grind/Break×13/Impact/Spark 类）、经济（BonusReceipt/ContractStamp/CodexStamp/GateYield）、商人（MerchantArrival/IncenseFade）、结局（EndingClockRewind/EndingCredits）等。
- DragonAudioLimiter（龙吼限幅器防炸）、DragonSfxGain、ForgeSfxGain、ForgeAudioGain 分层增益。
- 第三方音频授权文件：DragonFinalLaugh.txt、DragonStoryAudio.txt（笑声/语音来自授权素材库）(实证)。

### 4.13 本地化系统 (实证)

- ForgeLocalization / ForgeLanguagePack / ForgeLanguageMenu / ForgeLanguageFonts / ForgeSceneLocalization。
- 文本组织：Forge/Localization/ForgeTax、Languages、MerchantDialogue、Notebook 四类词包；对话内嵌代码字符串（元数据中同段韩/英/德/葡/西文本并存）。
- 字体：NotoCJK（繁中/日文）——**游戏原名 ForgeTax，源语言韩文**。

## 5 关卡设计（巢穴分区导览） (实证，场景分区标签直接提取)

整个游戏发生在**一个连续的巨龙巢穴锻炉空间**，开发者用编号注释对象划分了 15+ 个功能分区：

| 分区 | 名称（原文） | 功能 |
|---|---|---|
| 01 | LOW MASONRY CELL | 玩家的石砌囚室（开局） |
| 02 | HERO — THE HUNGRY FURNACE / WEATHERED STONE & WATCHFIRES | 主炉"饥饿熔炉"+瞭望火 |
| 03 | FORGE PLAYER — lair mobility / HERO — FORGING STATION | 玩家活动区+锻造工位（核心交互） |
| 04 | DRAGON — encounter rehearsal / HERO — BARRED SERVICE WINDOW | 龙遭遇排练区+**铁窗服务口**（上贡） |
| 05 | FINISHED WEAPON RACK | 成品武器架（3 槽） |
| 06 | RUN PROGRESSION — FORGE LEDGER | 进度账簿台 |
| 07–08 | 深龛/sealing wax / WORKING TRACES | 作业痕迹陈设 |
| 09 | LIGHT & ATMOSPHERE / FURNACE 09 | 灯光氛围层 |
| 11 | WALKING ROOM REFIT | 步行房间改装 |
| 12 | RECESSED GLASS ITEM SHOP | 嵌入式玻璃物品商店（商人） |
| 13 | OWNED ITEMS & USE DESK | 自有物品与使用台 |
| 14 | FIRST PERSON WALKER | 第一人称行走系统 |
| 15 | PHYSICAL TRIBUTE FLOW | 实体上贡动线 |

场景美术件：砧座（AnvilStump）、灰烬抽屉、链灯×8、粉笔黑板（ChalkUse——**玩家可用粉笔做记录**，推测）、账台铃、棺椁组（Coffin_body/cap——Funerary 葬仪主题物）、世界树、黑色符文黑洞（RuneBlackHole）、祭坛（altar 交互名）、香炉（Incense）。

## 6 技术实现反推（代码结构）

### 6.1 工程组织

- **命名空间**：`ForgeTax.DragonBoss`（DragonBattle）、`ForgeTax.StagedRelics`（SwordState）、`ForgeTax.Standalone`（EvolutionRig、RunebladeRig）、`ForgeTax.Language`、`ForgeTax.Practice.*` (实证)。
- **内部代号 GPT6**：房间总管 GPT6ForgeRoom、物品槽 GPT6ItemSlot（11 实例）、可交互物 GPT6ForgeInteractable——GPT6 系为**场景交互管理核心**，Forge* 系为各玩法子系统 (实证)。
- **单场景架构**：全游戏一个场景（data.unity3d 一个 bundle），无场景切换；区域用 GameObject 分组关闭/开启 (推断)。
- **数据驱动**：全部数值配置为场景内 ScriptableObject 化的 MonoBehaviour 资产（EvolutionCatalogue / ForgeEnhancementBalance / ForgeRoundCalendar / ForgeCodexCatalogueAsset / 各 Profile），无外部配置文件（StreamingAssets 仅第三方声明）(实证)。
- **代码规模**：2,407 个脚本类中约 **286 个为游戏专属类**（Forge*/Dragon*/Evolution*/Citadel*/Rune*/World*/Saw*/Funerary* 前缀），其余为 Unity/URP/InputSystem/Burst/Steamworks/Newtonsoft 等库类 (实证)。

### 6.2 组件分层模式 (推断，自类名归纳)

`XxxRules`（纯规则/数值）→ `XxxProfile`（序列化调参资产）→ `XxxRig`（表现装配体，挂模型动画）→ `XxxPresentation`（演出编排）→ `XxxReview/PlayReview`（**自动化验收/自测组件**）。例：CitadelSlamProfile→CitadelPresentation→CitadelSlamReview。这是贯穿全工程的一致模式。

### 6.3 开发流程证据 (实证)

- 大量 `*Review / *PlayReview / *Probe / *Checks / *Telemetry` 类（ForgeOctoberCaptureBootstrap、ForgeNovemberRelicReview、ForgeBalance30PlayReview 等**按月份命名**的迭代验收组件）——项目以月为单位滚动迭代，验收场景直接打进发行包。
- ForgeBalanceTelemetry 完整遥测模型（见 §3 字段清单）+ ForgeTelemetryJourney——**遥测驱动的数值平衡**开发管线。
- ForgeDebugConsole、ForgeManualPlaytest（手动测试支撑）、ForgePerformanceProbe / ForgeFramePacing / ForgeEntrancePerformance（性能探针）。
- ForgeMarketingCaptureHost（**营销素材自动采集**宿主）。

### 6.4 输入与交互

- InputSystem（PlayerInput / ActionMaps / DefaultInputActions）；交互动作名（自元数据）：anvil.leave_empty / anvil.leave_held（砧板取放剑）、RewindUse、ShopReroll、StarCharge、SwordFeed / SwordLift / SwordSet / SwordDamage、TributeBell、WardArm、RelicAcquire / RelicDiscard、ElementSelect、PowderUse (实证)。
- ForgeInput + ForgeInteractionOutline（注视高亮）+ E 键语义（购买/上贡后开张/存取剑/结束回合）(实证)。

### 6.5 渲染与性能

- URP + RenderGraph、Bloom、色度分离、暗角、颗粒（后处理配置在场景内）、Decal 系统、GPU Resident Drawer、STP 超分、DirectStorage（dstorage.dll）(实证)。
- ForgeSwordMaterialPool / ForgeSwordTransitionPool / ForgeSwordShadowGroups / ForgeSwordPerformancePolicy（武器材质/阴影分组对象池）、TemperedMetalInstanced（GPU instancing 金属）、BLASPositionsPool（光线追相关）→ 高密度武器陈列的性能专项 (实证)。

### 6.6 安全

- Obfuz（类型名混淆 + 字符串加密选项）；ForgeSecurityBootstrap；EncryptFieldAttribute / EncryptorBase（**存档字段加密**）(实证)。
- 尽管混淆，资源名、字段名、UI 文本大量保留——本报告的证据基础即来源于此 (实证)。

## 7 UI/UX 设计

- **3D 世界内 UI**：UI 文本以 TextMesh 直接布置在场景 3D 表面（账簿、票券、招牌），配 Noto 字体；交互提示贴在物件旁（"E / STORE OR RETRIEVE YOUR SWORD"）(实证)。
- **龙的血条**：场景挂板式蜡笔画血条（DragonHealthSlate）(实证)。
- **账目式 UI 语言**：ledger/receipt/stamp/ticket 贴图族 + BonusReceipt/ContractStamp/CodexStamp 音效——整套 UI 伪装成**账房票据系统**，与"税贡"主题一致 (实证+推断)。
- ForgeReadableUI（可读性专项）、ForgeUnlockPresentation、ForgeRewardPresentation (实证)。

## 8 附录：证据清单

### A. 资源统计 (实证)

| 类型 | 数量 |
|---|---|
| 资源对象总数 | 46,150 |
| GameObject / Transform | 11,492 |
| 脚本类（MonoScript） | 2,418（含库类） |
| Mesh | 2,245 |
| Texture2D | 541 |
| AudioClip | 392 |
| MonoBehaviour 实例 | 557 |
| Shader / Material | 151 / 372 |
| ParticleSystem | 139 |
| AnimationClip | 65 |
| TextMesh（3D UI 文本） | 113 |

### B. 关键交互音效清单（节选，交互枚举自元数据）(实证)

TributeBell（进贡铃）、ShopReroll（商店刷新）、RewindUse（倒带）、RelicAcquire / RelicDiscard（遗物获取/丢弃）、SwordFeed / SwordLift / SwordSet / SwordDamage（剑的四态交互）、StarCharge、WardArm（护壁臂）、ElementSelect、ChalkUse（粉笔）、ContractStamp（契约盖章）、IncenseFade（香）、PowderUse（粉末）。

### C. 核心配置资产清单 (实证)

| 资产 | 字节数 | 内容 |
|---|---|---|
| ForgeEnhancementBalance "OpeningBalance" | 7,280 | 强化五结果概率×等级表+日历曲线 |
| EvolutionCatalogue | 2,476 | 45 条武器进化目录 |
| ForgeCodexCatalogueAsset "Catalogue" | 4,792 | 图鉴总目 |
| ForgeRoundCalendar | 1,588 | 31 日期卡引用表 |
| ForgeTicketPaper | 5,904 | 奖券规则 |
| ForgeAudioMixProfile | 5,276 | 9 混音组 |
| DragonEntranceArt / CitadelSlamProfile / FuneraryPortalProfile / RuneBlackHoleProfile | — | 演出调参 |

### D. 未能完全还原的部分（诚实声明）

1. IL2CPP 元数据版本 107 超出现有公开工具（Il2CppDumper 6.7.46 / Cpp2IL 2022）支持范围，**方法体逻辑无法反编译**——本报告的"实现方式"结论来自类名/字段名/序列化数据的结构级证据，非代码级证据。
2. ForgeEnhancementBalance 两张表的**列语义对应关系**为推断（数值本身为实证）。
3. 遗物效果细节（8 种的具体数值）、商人商品表数值、Fever 触发阈值：字段存在（stockGrades / fever / freeRerolls 等），数值在 IL2CPP 常量或未解析资产中，未还原。
4. 部分对话因字符串相邻拼接，边界存在切碎可能；引文以多语言互证校对过。
5. 场景材质编号（1–25 与 80–87 两组）对应的武器品级映射为推测。
