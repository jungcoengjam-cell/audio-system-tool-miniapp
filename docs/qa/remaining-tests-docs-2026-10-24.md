# 测试入口与文档同步（2026-10-24）

本轮更新现行测试/工具入口和项目说明，没有修改计算、数据、UI 或存储实现。DMX页面生产代码仅在 `pages/dmx-layout/page-factory.js` 整理了职责模块之间由提取产生的空行；方法/data等价复核见下文。

## 放置页当前测试入口

- 现行 canonical 入口：`tests/dmx-placement-panel-2026-10-18/placement-panel-regression.cjs`。保留原脚本的四个可达行为场景：预览滚动/选择只读、清空、页面隐藏后的迟到确认、布局指纹过期后的 CAS 拒绝；增加当前注册路由的 batch UI/方法缺席断言，并运行当前单型号放置/CAS流程与设置保留、显式排列、撤销用例。
- 使用 `tmp/remaining-tests-docs-2026-10-24/placement-panel-current/results.json` 及其 before/after stdout/stderr 日志；运行原始 `tmp/remaining-work-2026-10-24/dmx/before/pages/dmx-layout/page-factory.js` 与最终入口时分别 exit 0。before/after 两次都包含：四个场景、batch缺席检查、当前布局流程 12/12、first-use流程 7/7。
- 旧完整套件以源归档保留在 `tests/dmx-placement-panel-2026-10-18/placement-panel-batch-history.cjs`。它逐字对应原入口，SHA-256 为 `1b6504c38c89e7cd92889407a2c417bbfdef89443524b64584573d2b2cf80510`；来源、字节数和历史性质记录在同目录 `placement-panel-batch-history.meta.json`。原批量专属用例没有删除，也没有把它们计作当前通过；这些断言描述已退役的批量UI，不是当前产品行为。该归档只是源码历史，不声称能在当前页面上直接执行。
- `tests/release-check.js` 已登记当前placement canonical入口、DMX realm回归、改过的native-source/canvas检查、布线编辑边界回归及六页保存流程回归 `tests/project-save-controllers-2026-10-24.cjs`；没有登记旧batch归档。

## 已登记页面编译/回归工具

- 四份 `compile.cjs`（refactor、refinements、native-fixes、round3）现在从 `app.json` 的 pages/subPackages 收集所有已注册的 `pages/dmx-*` 路由，目前为编址页、通道指南页、灯位图页三页；`DMX_COMPILE_OUTPUT_DIR` 可分别指定输出位置，默认历史输出仍保留。每份摘要写入当前路由列表与 `app.json` 哈希。
- refactor/native-fixes 的 `run-regressions.cjs` 仅枚举仍存在的 `pages/dmx-address`、`pages/dmx-layout` 源目录，同时断言已退役横屏route未注册且源目录缺席。
- `native-source-contracts-test.cjs` 与 `layout-canvas-2d-regression-test.cjs` 的模板/样式检查改为当前注册页；它们也保留退役route缺席检查。前者直接测试竖屏和横屏运行模式所用的同一份注册页面。
- 中间阶段记录：当时以上脚本 `node --check` 均 exit 0，`native-source-contracts-test.cjs` exit 0，完整 release/官方编译尚未执行。该阶段状态已由下方最终记录更新；官方编译输入哈希由主代理复核，本子任务未重跑编译。
- `layout-canvas-2d-regression-test.cjs` 初次 before 在原第387行因宽泛拒绝“地址清单”而失败；实际 renderer 与 unified-export 契约明确输出 `完整地址清单（3 台）`。在主代理确认后，只把该旧期望改为要求当前精确标题并禁止旧的“灯具地址清单/灯具编址与灯位图”标题；并在关闭预览后等待已有的 220 ms 关闭动画，再核对刚重挂的 canvas。没有删除或减弱后续 native canvas、地址及分页断言。保存的 `tmp/remaining-tests-docs-2026-10-24/canvas-label-before/` 是旧断言的 before 失败；适配后的原页面快照/当前页面矩阵 `canvas-label-matrix/results.json` 均 exit 0。
- 本轮收尾修正了职责迁移后过期的源码位置断言。`ui-resources.cjs` 现在将 Cable/Gain 页面源码与各自项目控制器组合读取，并要求页面真实 `require`/展开对应工厂；DMX 导出断言要求 `page-factory.js` 创建并展开 `layout-export-controller`，同时保留 2D canvas、独立 backing dimensions 和导出 API 检查。任务开始快照分支均 exit 0；证据在 `tmp/remaining-work-2026-10-24/release-iterations/package-reclaim-source-location/`。
- `tests/release-check.js` 的 DMX 导出、单杆/整图清空、逐杆验证检查现分别核对 `layout-export-controller.js`、`layout-interactions.js`、`layout-settings.js`，并断言页面工厂实际接线；原四个导出动作、清空边界、验证错误字段、首错定位、WXML 和明暗 CSS 条件均保留。before 源码快照对应检查 exit 0，见同目录 `dmx-layout-connectivity-before.*` 与 `dmx-clear-settings-before.*`。`closeout8-contract-regression.cjs` 也改为在已接入的交互控制器检查直接拖拽提示，保留 renderer 侧灯高度说明和六态 canvas 遮挡断言；before probe exit 0，当前套件 14/14 exit 0。
- 最终完整 `node tests/release-check.js` exit 0；独立 stdout/stderr 与文件 SHA-256 摘要在 `tmp/remaining-work-2026-10-24/release-iterations/final-closeout8-source-path-adapt/summary.json`。前两次完整运行停在上述旧源码位置，日志分别保存在 `final-source-path-adapt/` 和 `final-dmx-controller-paths-adapt/`，均保留供审查；未覆盖失败证据。收尾修改文件的 `git diff --check` exit 0；主代理此前全仓 `git diff --check` exit 0。
- `node tmp/remaining-work-2026-10-24/dmx/capture-after-page-snapshot.cjs` 与 `compare-page-snapshots.cjs` 在空段整理后 exit 0：编址 149 方法/86 data、布局横竖 97 方法/75 data、方法体和 factory exports 均与迁移前一致。对应结果仍在 `tmp/remaining-work-2026-10-24/dmx/structural-smoke-review.json`。
- 结构整理阶段的中间全仓 `git diff --check` 曾 exit 2，报告 `pages/cable/cable.js`、`pages/spl/spl.js` 尾随空白；这些空白后来已分别修复。最终全仓 `git diff --check` exit 0，主代理已复核；本 QA 的收尾测试文件检查也 exit 0。

## 布线页面说明

- README当前布线入口改为“恢复上次查看项目/页签、显式路由优先、无有效记录时选择/新建、切换/新建不设置全局当前项目”。依据为项目布线生命周期测试及 `tests/project-wiring-page-test.js` 显式路由/项目归属断言。
- `docs/wiring-entry-update-2026-09-20.md` 保留当时事实，只增加现行生命周期说明链接。其旧行为与真机/编译/包体数字仍代表2026-09-20记录，不作为本轮验证。
- README首段原 `6.0.0` 发布候选记录保留，并已标注该真机验证属于当时快照；本轮未做微信真机测试。

## 范围与风险

本轮没有重新运行微信开发者工具官方编译器，也没有连接 iPhone 真机。主代理已独立核对 74 项官方 WXML/WXSS 编译输入哈希仍与通过记录一致；这不代表本轮 JS 包构建或真机验证。完整 Node release 已 exit 0，如上方日志所示。历史 batch 脚本归档不应被误读为当前批量功能。
