# 限幅器交互重构：实现与验收记录

> 本文记录 2026-10-06 的交互重构；后续视觉精修与其验证见[2026-10-07 视觉精修报告](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/docs/limiter-visual-refinement-2026-10-07.md)，本文后续布局证据仅代表旧批次。

2026-10-06。代码范围内的实现、专项测试及实际返工复核已完成，当前限幅器 JS 的 SHA-256 为 `0bf15a1c52cc5b892bb51370de6c11c0558e7ee7ab1f2f382045c33c69c7c82a`。**整体验收尚未完成**：原源码预算门禁失败，预算调整仍待批准；微信原生运行与 iOS/Android 真机项目未通过验证。未提交、推送、上传预览、发布或部署。

## 依据与工作区

- 按顺序读取交接包的 `CODEX_START_HERE.md`、`CODEX_IMPLEMENTATION.md`、`DECISIONS_zh.md`、`ACCEPTANCE_CHECKLIST.md`、`PREVIEW_INDEX.md`、`SOURCE_NOTES.md`，并检查适用的上级及项目 AGENTS、DESIGN、现有页面和共享样式。
- 实际工作目录：`C:\Users\wxx\Documents\Codex\audio-system-tool-miniapp`。开始及结束均为 `master`，HEAD 为 `de758b643ff1bd4beabd6f6dbb1ee88a4d026e0e`。没有重置到交接文档的远端参考。
- 起点有控制协议、首页、版本/文档、发布检查和报表 fixture 等既有未提交改动，以及大量既有未跟踪文件。它们不属于本次重构；发布检查中的原有改动也保留。任务前的工作区快照和相关文件原始字节已保存，不能用 `git reset` 回滚本次工作。
- 初始 175 个生产/检查文件的哈希复核：仅下表列出的 9 个授权文件改变，无删除、无额外改动；38 个受保护的算法/数据文件哈希保持不变。新增弹层 include 和测试另行列出。
- 限幅器局部采用四个纵向图标动作，作为旧共享结果大按钮规则的本页例外；其他工具继续使用原共享结果模板。共享服务的变更仅为用户明确批准的 D05 扩展及其项目消费者。
- 实际采用上级协作规则：GPT-6.1 Sol `max` 规划及独立复审，GPT-6 Luna `max` 执行、返工。当前子代理接口不能设置 `maxfast`/Fast；没有宣称启用了这些设置。最终用户验收仍待完成。

## 已确认的行为与待定项

用户已回复“全部按上述建议采用，并批准 D05 最小扩展”。原交接包中以下 PROPOSED/GATE 项因此转为 CONFIRMED：

| 决策 | 本次采用的规则 |
|---|---|
| D01 | 提醒 15 秒，不增加时长设置页；用户后续真机反馈已将原 30 秒决定覆盖为 15 秒。 |
| D02 | 首次有效阈值建立基线；首次补选此前为空的 HPF 不提醒，之后实际修改才提醒。 |
| D03 | 无历史输入为空；只恢复已保存且有效的字段；重置后重进为空，主动恢复收藏/项目仍可用。 |
| D04 | 仅页面可见且未被弹层/原生选择器遮挡时计时；后台、遮挡、退场动画暂停，返回继续余量。 |
| D05 | 项目名沿用 30 字；配置名必填、最多 60 字；备注可选、最多 200 字；按项目和记录保存，保留原身份、跨项目去重、收藏语义。相同参数在同项目复用记录，元数据变更需明确确认；同名不同参数不覆盖。 |
| D06 | 普通内容视口显示完整指标；短视口固定阈值和状态，次指标在结果区内滚动。提交实际实现的普通/短视口图供验收。 |
| D07 | 图片描述全部真实输入、单只连接、未选 HPF、标定和使用限制；提醒只说明沿用当前值，不声称核对通过。 |
| D08 | 自定义预览仅两个动作；原生菜单、接收端纯图片效果须真机验证。本次没有把未执行项算作通过。 |
| D09 | “继续添加配置”返回当前计算，保留项目和参数，不自动清空。 |

**当前仍有内部源码预算门禁待决。** 先前的总计 2710 / 主包 JS 924 / WXSS 302 / WXML 293 KiB 是较早修复前建议，已不足以覆盖后续改动；更小的主 JS 910、922 等建议也已撤回。本轮不提出新预算申请，原四个预算常量保留，用户未批准放宽。真机项目属于未执行验证，不存在替用户决定的平台规则。

## 修改文件及原因

| 文件 | 修改内容与目的 |
|---|---|
| [pages/limiter/limiter.js](../pages/limiter/limiter.js) | 空值草稿、按保存字段恢复、实际输入事件校验、分组保持值、15 秒可见时间提醒、真实重置；本页图片生成/缓存/旧回调防护；项目选择、名称备注、快照与目标复查；原生 page-container 生命周期。保留核心调用、规范记录载荷和字段顺序。 |
| [pages/limiter/limiter.wxml](../pages/limiter/limiter.wxml) | 上结果/下输入结构，设备/负载/设置 2/3/2 字段，四个图标动作；单个常驻原生弹层容器及不支持时的遮罩。 |
| [pages/limiter/limiter-overlays.wxml](../pages/limiter/limiter-overlays.wxml)（新增） | 选择器、说明、图片预览、项目各步骤的共用面板；用 include 保持页面数据作用域，避免模板数据为空。 |
| [pages/limiter/limiter.wxss](../pages/limiter/limiter.wxss) | 本页明暗主题、44px 触点、固定结果及内滚动、主字段/关键提示可读字号、长配置名换行。无共享主题改版。 |
| [utils/records.js](../utils/records.js) | D05：第三个可选 metadata 参数；`projectMetadata[projectId]={name,note,savedAt}`；有效元数据的纯项目视图；删除关联时清理对应元数据。没有新存储键、迁移或身份算法。两参数旧调用保留原行为。 |
| [pages/records/project.js](../pages/records/project.js) | 展示和文字报告使用本项目的名称/备注/时间；有效元数据才增加视图及缓存字段，普通记录保持旧字段形状与顺序。 |
| [pages/records/project.wxml](../pages/records/project.wxml)、[project.wxss](../pages/records/project.wxss) | 有效新配置名完整换行、备注保留换行；普通记录继续原展示。 |
| [pages/records/project-report.js](../pages/records/project-report.js) | 显示项目配置名/保存时间和备注摘录；长图限制源画布高度，明确计入省略记录数量；旧报表几何及绘图轨迹保持。 |
| [tests/limiter-refactor-2026-10-06/limiter-page-state-test.js](../tests/limiter-refactor-2026-10-06/limiter-page-state-test.js)（新增） | 真空值/字段事件、恢复/重置、假时钟、弹层生命周期、图片旧回调、项目快照与提醒图片载荷等回归。 |
| [tests/limiter-project-metadata-test.js](../tests/limiter-project-metadata-test.js)（新增） | 项目隔离、原身份/去重/收藏、旧调用兼容、非法长度/类型、读写失败、清理关联、缓存、长名字及极端长图资源上界。 |
| [tests/release-check.js](../tests/release-check.js) | 只同步限幅器确认过的 UI/空输入/图片入口断言并注册新增测试；其他工具断言、数学基准和预算常量不变。 |
| [tests/deterministic/page-consistency.suite.js](../tests/deterministic/page-consistency.suite.js) | 限幅器使用真实已保存输入，验证规范结果文字与记录一致；其他页面保留原复制后检查顺序。 |
| 本文（新增） | 记录决策、文件变化、实际证据、待验事项及局部回滚方法。 |

计算引擎 `utils/limiter.js`、设备库、输入级标定、产品数据、其他工具路由/页面、共享结果控制器均未修改。没有增加框架、运行时网络依赖或新图标资源。预览图只用于记录中允许的视觉参考；没有导入其中示例数值、星形收藏或自动确认文案。

## 实际测试结果

测试与图证据统一保存于 [本任务证据目录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba)。记录包含源文件 SHA-256、执行结果和原始输出。

| 执行内容 | 实际结果及边界 |
|---|---|
| 任务前 `node tests/release-check.js` | PASS，改动前退出 0。当前预算失败不是起点已有失败。 |
| `compare-limiter-baseline.cjs` | 历史基线 PASS（限幅器 JS SHA `050bcfe3…`、图标/原生按钮定向修复前）：任务前原始页面与当时页面对比 2400 组真实产品输入，1080 有效/1320 无效/800 无 HPF；结果数值、就绪/错误信息及有效配置规范记录完全一致，初始化写入 0。该证据不代表当前页面 JS/WXSS 的最新哈希。 |
| 10 个专项脚本 | 历史批次全部退出 0：limiter-page-state、limiter-project-metadata、result-project-target、page-lifecycle、report-lifecycle、report-drawing、report-canvas-equivalence、project-wiring-storage/page/report；不是本轮按钮修复后的全量重跑。 |
| 本轮 focused 状态测试 | PASS，退出 0：最新 f17 源 `tests/limiter-refactor-2026-10-06/limiter-page-state-test.js` 的 15 秒边界场景使用 `getResultText()` 和非空 `getRecordPayload()` 快照，分别核对 14999ms 与 15000ms。Sol 在 getter/payload 断言更新后独立重跑通过；Root 未因后续纯 WXSS 调整重复运行。旧 263a 弱快照版不作为最终验证。执行摘要见 [phase4 focused test 证据](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/phase4/limiter-page-state-test-execution.json)。 |
| 冻结 Canvas 等价测试 | PASS：36 场景，未修改原 fixture；普通项目记录的页面状态、缓存签名、绘图轨迹与原基准一致。 |
| 确定性检查 86 用例 | 历史批次 86/86 PASS；随后调用的 release-check 在旧源码体积的预算门禁处失败。该结果不是本轮按钮形状修复后的重跑。 |
| 完整 `node tests/release-check.js` | 历史执行在预算门禁处 FAIL（当时报告 2709.0 KiB 超过 2650 KiB），因此后续调度未完成；本轮未重跑完整发布检查。最新源文件测量仍高于原预算，见下表。 |
| `check-limiter-release-functions.cjs` | 较早独立诊断 12/12 PASS：执行发布检查中的选择器、预览、项目图、原数值基准、页面控制器、触感、图片权限动作及相关性能覆盖函数。不是本轮按钮修复后的重跑，也不等于完整发布检查通过。 |
| 微信本机 WCC/WCSC | WCC：29 个 WXML 退出 0，记录在 [phase2/final 编译记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/phase2/final/compile-execution.json)，当前 WXML SHA 与其编译清单一致；最终 WCSC：26 个 WXSS 退出 0，记录在 [phase4/final 编译记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/phase4/final/compile-execution.json)，含当前 WXSS SHA。两者是源码编译，不是完整微信工程运行/上传。 |
| 历史浏览器布局检查 | 232 场景的早期矩阵在原生按钮定向修复前，不能作为后续按钮/图标的验收结果；仍保留作历史记录。 |
| 本轮最终按钮布局矩阵 | Chromium 共 180 场景：4 个 before 场景用于重现问题，176 个 after 场景 0 失败；布局、颜色及图标检查使用 width 184 的推定替身样式，不是 iPhone/微信原生 UA。after 源哈希与本页及测试环境一致，详情见 [最终布局指标与哈希](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/button-layout-results.json)。 |
| 新项目元数据布局/报告 | 8 个明暗/宽度/长 ASCII/换行备注布局无裁剪；真实绘图源码在浏览器 Canvas 的 5 张图已检查。极端项目图源码级高度/几何检查通过；非真机性能证明。 |
| 独立复审 | 本轮按钮形状修复经 GPT-6.1 Sol 独立复审，`codeReviewStatus: PASS_SCOPE_ONLY`；仅限源码和近似图检查。`overallAcceptance: NOT_COMPLETE`，iPhone 修后仍 NOT RUN，原生截图未验证，预算仍超限且未获放宽；详见 [button-shape-sol-review.json](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/button-shape-sol-review.json)。 |

曾捕获的本次回归已修复：无元数据记录多出空字段造成报表状态 hash 变化；非限幅器一致性测试取值顺序改变；空 HPF 草稿错误启用重置；退场期间提前计时；窄触点和长配置成功名裁剪；排队跨入口使弹层重叠、关闭前穿透与卸载后动作；旧 epoch 和同 epoch 的已取消计时回调抢占当前计时器；隐藏页面迟到的分享图操作。原生/fallback 各 4×4 入口、延迟渲染释放、合法内部选择、旧 timer/draw/export 回调及 hide/show 恢复均有实际 mock 序列回归。旧版截图工具的作用域/图片缩放错误未作为产品通过证据。最终截图使用修正后的工具，实际验证提醒启动及 HPF 100 Hz 后才捕获 S07/S08。

预算按实际 `project.config.json` 的 pack ignore 规则统计 **203 个有效源码文件**，不是微信编译/上传包体。下表保留原预算常量、最终图标微调前的本轮前次候选实测和本轮最终源码测量。先前 2710 / 924 / 302 / 293 KiB 建议已过时且不足；本轮没有提出新预算申请，也没有修改预算常量。

| 范围 | 保留的原预算 KiB | 本轮前次候选实测（最终图标微调前）KiB | 本轮最终源码实测 KiB |
|---|---:|---:|---:|
| 总计 | 2650 | 2711.453 | 2711.556 |
| 主包 JavaScript | 874 | 922.694 | 922.694 |
| WXSS | 292 | 301.653 | 301.756 |
| WXML | 284 | 290.290 | 290.290 |

最新测量为 203 个有效源码文件；总量、主包 JavaScript、WXSS 和 WXML 均超过原预算。完整发布检查本轮未重跑。数据源：[source-size-after-buttons.json](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/source-size-after-buttons.json)。

实际证据：[测试日志与源哈希](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-final-test-evidence/execution.json)、[86 用例与完整门禁失败](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-final-test-evidence/deterministic-results.json)、[独立函数诊断](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-release-function-diagnostics.json)、[数值对比](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-numeric-identity-comparison.json)、[编译记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-compiler-qa/compile-execution.json)、[范围审计](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-scope-audit.json)。

## 实现截图 S01–S18

以下 PNG 来自**实际控制器、WXML/include 和 WXSS 的 Chromium 近似渲染**，不是概念图，也不是微信模拟器或真机截图。尺寸为内容视口；浏览器安全区为 0，未画手机边框/胶囊。弹层截图使用实际共用面板的 fallback 遮罩，不能证明原生 page-container 的包装布局或返回手势。分享预览使用当前真实绘图源码在浏览器 Canvas 生成的 PNG，原生导出物理文件仍未实测。

| ID | 截图/证据 | 尚未验证部分 |
|---|---|---|
| S01 | [普通屏·设备与四图标](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-valid-device.png) | 原生布局 |
| S02 | [短屏·负载](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-dark-valid-load.png) | 原生滚动/触感 |
| S03 | [暗色·设置](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-dark-valid-settings.png) | 原生选择器 |
| S04 | [功放选择](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-selector-amplifier.png)、[无匹配](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-light-selector-no-match.png) | 原生键盘/分类横滚 |
| S05 | [音箱选择](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-selector-speaker.png) | 原生选择/资料返回 |
| S06 | [首次空白](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-empty.png)、[部分输入](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-incomplete.png) | 真安装/真存储生命周期 |
| S07 | [后续编辑提醒](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-light-reminder-before.png) | 锁屏/后台真实时序 |
| S08 | [提醒结束](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-light-reminder-expired.png) | 原生时序 |
| S09 | NOT RUN：原生重置确认图未取得；确认/取消控制器测试通过 | 微信原生模态层 |
| S10 | [重置后空白与禁用动作](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-reset-empty.png) | 真存储删除失败/重入 |
| S11 | [图片预览·两个动作](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-dark-share-ready.png) | 原生生成文件与预览/发送/保存物理一致性 |
| S12 | NOT RUN：原生分享菜单、实际收图、相册保存反馈 | iOS/Android 收图、权限/取消/设置返回 |
| S13 | [未收藏](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-valid-device.png)、[已收藏](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-bookmark.png) | 真实用户存储 |
| S14 | [选项目](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-project-select.png)、[搜索](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-project-search.png)、[空列表](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-project-empty.png) | 原生操作 |
| S15 | [创建项目与空名错误](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-light-project-validation.png) | 原生键盘 |
| S16 | [配置名/备注/预览](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-project-details.png) | 元数据更新原生确认层 |
| S17 | [成功](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/390x844-light-project-success.png)、[短屏合法长名](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-light-project-success-long-name.png)；继续路径在状态测试实际执行 | 原生流程 |
| S18 | [无效负载](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-light-invalid.png)、[图片错误](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-light-share-error.png)、[保存错误](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/320x568-light-project-save-error.png) | 短屏原生键盘状态 NOT RUN |

[历史 232 场景指标（原生按钮定向修复前）](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-implementation-qa/browser-layout-metrics.json)。图片内容对照：[完整输入图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-report-drawing-qa/valid.png)、[未选 HPF 图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-report-drawing-qa/no-hpf.png)、[提醒图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-report-drawing-qa/advisory.png)。均为浏览器 Canvas 绘图证据。

## 原生/设备核验与其余限制

- 使用本机官方微信开发者工具技能/CLI；状态检查成功，工具版本关系 `equal`、登录未过期、不需 token。项目配置基础库为 `3.16.2`，没有伪称已取得实际运行基础库或真机系统信息。
- 最新工具记录显示 `simulator_open_page` 对限幅器页的编译/导航触发成功，源码变更后一次 `simulator_refresh` 也报告成功；之后等待 `.action-rail` 的页面截图超时，未得到修复后的限幅器原生截图。早先的空白欢迎页截图不计作页面验证；完整调用结果见 [native-checks.json](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/native-checks.json)。这些工具触发结果不表示编译包运行或设备渲染成功。
- iOS、Android 实际设备未连接。原生 Back/手势、胶囊/安全区、键盘抬升、大字号、锁屏/后台恢复、相册权限各状态、接收端纯图片及真实长图性能全部 NOT RUN。WCC/WCSC、假时钟和 Chromium 结果不能代替这些项目。
- `wx.canIUse('page-container')` 支持时使用原生返回生命周期。旧库 fallback 能关闭遮罩、保持草稿，但没有原生硬件返回拦截能力；不能把回调模拟测试推广为所有基础库通过。
- 项目长图的配置备注最多显示三行内容，超出标“备注摘录，全文见文字报告”；画布超过 4096px 时减少图片展示记录并增加省略数。存储、项目页及文字报告仍保留完整名称/备注/记录。源级几何/资源上界验证不是手机性能验证。
- 临时图片权限、缓存缺失和旧回调有源码/mock 覆盖；真正原生导出后文件一致性及平台 API 的表现仍待设备验证。
- 全部完整发布检查须在预算决策后以原入口重跑。已有独立诊断通过不替代它；未执行项不能作为发布或用户验收通过。

对应原清单：A01–A04 为源码/基线检查通过，A05 的原预算失败；B01–B06/B08 有近似图和源码证据，但原生部分未验，B07 原生 NOT RUN；C、D、E、G 为相应源码/mock 回归通过；F01–F04/F06/F08–F10 有源码/绘图/mock 证据，F05/F07 的真实平台验证 NOT RUN；H01 完整发布门禁 FAIL，H02 源码编译 PASS，H03 范围复审 PASS，H04 缺 S09/S12 原生图与 S18 键盘图，H05 已交付此记录，H06 未进行未授权发布动作。

最终独立结论及源哈希见 [Sol 范围复审记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/sol-final-review.json)；范围内代码通过不代表预算或真机验收通过。

## 用户 iPhone 截图后的定向修复

用户提供的三张真实 iPhone 截图作为本次问题基线：原生按钮呈椭圆，数量步进器挤出右侧，picker 右列没有约束。约 184×44 的逻辑尺寸是在假设 DPR 3 下推定，未取得设备系统信息；width 184 是 Root 复现模型的设置值，不是抓取到的官方/iPhone UA。原图、before 源文件和哈希记录由 Root 保存在 `C:\Users\wxx\.codex\visualizations\2026\10\06\01a11025-2118-7183-883a-0925c68a2bba\limiter-button-shape-qa\before\`。

本轮只在限幅器页提高原生按钮 class 选择器优先级并显式限定固定触点几何；数量步进器和两个 picker 使用有界右列布局；项目及分享动作保留按内容自适应的高度，只有分享/表单按钮行均分宽度；重置符号改为 CSS 圆弧箭头，书签底部缺口改为朝内的 V。保留原生 button、所有 aria、事件和 disabled 行为；picker 的 range、value 和事件不变。没有修改共享样式、其他页面、算法、数据或记录语义。提醒仍为 15 秒。

前一轮 WCC 编译 29 个 WXML 退出码 0，当前 WXML SHA 与 [phase2/final WCC 编译清单](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/phase2/final/compile-execution.json)一致；最终 WCSC 编译 26 个 WXSS 退出码 0，当前 WXSS SHA-256 为 `20454752cdd29939cc66c54c0dc025109acb337f83d8c84b7676b6174e1b827b`，见 [phase4/final WCSC 记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/phase4/final/compile-execution.json)。phase4 曾有一个 `bottom:10rpx` 的中间编译候选，随后根据放大图修正书签 V 伪元素为 `bottom:-9rpx`；中间哈希 `311801fc…` 只作为尝试记录保留。最后一轮图形/布局返工未继续修改 JS，当前 JS SHA-256 仍为 `0bf15a1c52cc5b892bb51370de6c11c0558e7ee7ab1f2f382045c33c69c7c82a`。本轮 focused 状态测试以实际 `getResultText()` 和非空 canonical `getRecordPayload()` 快照验证 15 秒边界，退出码 0；测试源为 `tests/limiter-refactor-2026-10-06/limiter-page-state-test.js`，运行摘要见 [focused test 执行记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/phase4/limiter-page-state-test-execution.json)。Root 未因后续纯 WXSS 图标微调重新运行；Sol 在最新 f17 getter 与非空 canonical payload 断言下独立重跑该 15 秒用例并退出 0。此前 263a 弱快照版不作为最终验证。Root 最终 Chromium 矩阵共 180 个场景：4 个 before 场景重现原问题，176 个 after 场景 0 失败；源哈希与最终页面一致。Root 已放大查看普通/已收藏书签和 reset 图标，书签 V 居中、reset 箭头与圆弧相接；按钮/步进器、下拉、蓝色状态和成功页 footer 的布局检查通过。此矩阵用 Chromium 和用户截图问题的 width 184 推定替身，不是抓取的 iPhone UA、系统样式或设备像素数据；184×44 是假设 DPR 3 下的推定逻辑尺寸，不是设备实测。最新 iOS/微信原生截图仍未取得。GPT-6.1 Sol 独立专项复审为 `PASS_SCOPE_ONLY`，范围限源码与近似图检查；整体 `NOT_COMPLETE`，iPhone 修后仍 NOT RUN，预算超限且未获放宽，未宣称真机验收通过。详见 [button-shape-sol-review.json](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/button-shape-sol-review.json)。

本轮问题基线和修复后代表图：用户提供的 [设备页原图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/before/device-iphone-before.jpg)、[负载页原图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/before/load-iphone-before.jpg)、[设置页原图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/before/settings-iphone-before.jpg)；after 代表图包括 [402×760 暗色设备页](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/layout/after-402x760-dark-valid-device-ordinary.png)、[负载页](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/layout/after-402x760-dark-valid-load-ordinary.png)、[设置页](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/layout/after-402x760-dark-valid-settings-ordinary.png)、[320×568 浅色负载页](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/layout/after-320x568-light-valid-load-width184.png)、[分享准备页](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/layout/after-320x568-light-share-ready-width184.png)、[项目保存成功页](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/layout/after-320x568-light-project-success-width184.png)、[普通四图标](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/layout/after-402x760-dark-valid-device-ordinary-icons.png)及[已收藏书签图标](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/layout/after-402x760-dark-bookmark-ordinary-icons.png)。180 场景比较与源哈希见[最终布局指标](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-button-shape-qa/button-layout-results.json)。

## 局部回滚

任务前相关文件原字节在证据目录 `baseline-source/`，并有 `production-baseline.json`、`baseline-source-backup.json` 和起点状态快照。若需要撤回，仅恢复本次文件的起点字节并移除本次新增 include/测试/本文；不要恢复整个 HEAD、删除既有未跟踪文件或覆盖原先的发布检查改动。缺单独备份的原干净文件可用本地 HEAD 取字节并对照起点哈希，确认后逐文件处理。

D05 为附加字段，无自动迁移；本次测试使用隔离 mock 存储，没有对真实小程序记录执行迁移或批量删除。若以后实际使用新版本再降级，应先备份用户本地记录，旧代码可忽略新增元数据；不能为回滚清空收藏/项目或修改记录身份。
