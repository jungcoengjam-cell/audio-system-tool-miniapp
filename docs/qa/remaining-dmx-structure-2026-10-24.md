# DMX 报告、导出与交互结构整理（2026-10-24）

本轮把编址页报告衔接、灯位图导出、设置，以及放置/定位/手势方法提取到四个职责模块。编址报告继续调用既有 `utils/result-report-controller.js`；页面 data、方法名、导出名称、数据、算法、存储、渲染和 UI 均未重写。方法使用原页面 `this`；新布局工厂按调用时读取 wx、计时器和时钟，避免捕获测试 VM 的旧全局对象。

独立结构对照：编址页 149 个方法与 86 个 data 键、灯位图横竖模式各 97 个方法与 75 个 data 键均与 before 相同；三组方法源码逐项一致。`page-factory.js` 的四个导出名称和三个常量导出值不变。

## 验证

- 定向矩阵：保存的 before 与最终 after 各运行 25 项，均为 24 项 exit 0；唯一相同失败是 `tests/dmx-placement-panel-2026-10-18/placement-panel-regression.cjs` 的历史 `batchRodOptions`/`onBatchTargetRodChange` 批量安排断言。该控件已不属于当前布局页，本轮没有恢复旧 UI。该脚本在到达该旧断言前，preview、clear、保存失败重试和迟到确认场景均通过。
- 新增 `tests/dmx-remaining-structure-realm-regression.cjs` 使用真实 before 页面快照与最终页面各运行一次，均 exit 0。它检查页面创建后替换 wx、timer 和 clock，wx 方法接收者、hide 后清理计时器，以及迟到动画/相册回调不写入。
- 七个相关 JS 文件 `node --check` 均 exit 0；页面 data、方法源码和工厂导出结构对照通过；本轮 `git diff --check` 无空白错误。
- 为当前已注册的单一布局路由，六处历史横屏页面模板/样式读取改为检查当前注册页，保留其余几何、触点和事件断言。两项交互用例补上打开放置面板的必要前置；导出断言改为确认当前完整地址清单标题并拒绝旧组合标题。
- 未改 WXML/WXSS；主代理独立核对 74 项官方 WXML/WXSS 编译输入哈希与通过记录一致；本轮未在微信开发者工具重跑编译，也未做真机检查。最终完整 `node tests/release-check.js` exit 0，日志与 SHA-256 摘要见 `tmp/remaining-work-2026-10-24/release-iterations/final-closeout8-source-path-adapt/summary.json`。

## 本轮文件

- 生产修改：`pages/dmx-address/dmx-address.js`、`pages/dmx-layout/page-factory.js`
- 新模块：`pages/dmx-address/result-report-ui.js`、`pages/dmx-layout/layout-export-controller.js`、`pages/dmx-layout/layout-settings.js`、`pages/dmx-layout/layout-interactions.js`
- 回归：`tests/dmx-remaining-structure-realm-regression.cjs`；适配现页路径或来源位置的六个既有 DMX 回归文件
- before/after 快照、方法/data 对照、定向日志与退出码：`tmp/remaining-work-2026-10-24/dmx/`

设备兼容性未做真机验证。完整 release 结果由主代理统一补记。

## 后续测试入口状态（2026-10-24）

上方 `24/25` 是结构整理阶段的中间基线，保留当时完整旧套件的运行事实；失败项是已退役批量放置 UI 的历史合同，现已被当前 canonical suite 替换。原完整文件逐字存档为 `tests/dmx-placement-panel-2026-10-18/placement-panel-batch-history.cjs`，其 SHA-256 与来源见同目录元数据。当前可达的预览/清空/CAS/迟到确认、单型号放置和设置排列/撤销入口 before/after 均通过；最终脚本与验证证据见[测试入口与文档同步 QA](remaining-tests-docs-2026-10-24.md)。中间 `24/25` 不代表当前入口失败，也不代表当前 UI 支持批量放置。
