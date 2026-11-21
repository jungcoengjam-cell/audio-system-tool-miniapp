# 项目布线编辑模块整理 QA（2026-10-24）

## 变更范围

- 新增 `pages/project-wiring/device-editor.js`，集中设备新增表单、内联改名、改名期间的动作排队及保存回调。
- 新增 `pages/project-wiring/line-editor.js`，集中线路编辑核心与页面动作：草稿、历史值、端点与配对端口、连续填充、校验、保存、关闭和删除。
- `EXPORT_TYPES` 是报告选择元数据，留在 `index.js` 并供报告控制器使用；线路编辑模块不声明或导出它。
- `index.js` 显式组合 workspace、设备编辑、线路编辑、报告和生命周期模块；`workspace-ui.js` 保留项目导航、列表、手势及通用遮罩协调。
- `saveCommand` 是唯一 Page 动作，委托原保存实现 `saveScheduleCommand`。显式 core 调用与动态 `this.*` 分派保持原有关系。

## 行为与表面核对

- before/after 运行时 Page 都有 220 个方法、123 个 data 字段；方法名、data 名称和初值完全一致，`connectorOptions` 的覆盖顺序未变。
- `EXPORT_TYPES` 归位后重新捕获实际 Page 对象，220 个方法名、123 个 data 键及初值仍逐项一致。
- base/workspace 原有25个同名方法中，编辑范围内12个已由专属模块唯一提供，剩余13个非目标覆盖保留。
- 迁移的75个方法体逐段与 before 快照一致；仅将原显式 base 调用绑定到私有 core，并把 base 保存函数命名为 `saveScheduleCommand`。
- 计算、存储命令、ID/code、输入含义、默认值、校验规则及 WXML/WXSS 均未修改；受保护依赖和模板哈希保持一致。
- 当前布线页面没有用户可见 undo API/动作；本次没有增加或改写 undo 行为。

## 验证

- before/after 均通过：page、keyboard、deletion、devices、native-interactions、D1（91 assertions）、module-refinements（21/21）、swipe runtime、report-lifecycle（3 scenarios）。
- 新增跨模块回归在 before/after 均通过；修正后又复跑 after：设备改名期间排队 connect，确认后打开线路编辑，连续填充配对端口并保存两条线路。
- 四个生产 JS 模块及新回归脚本均通过 `node --check`。
- 全量 `tests/release-check.js` 留给主代理统一登记后运行；微信真机未执行，验证使用 Node 合成 wx/timer 环境。

基线源码、哈希、Page surface、base/overlay 调用边、75项方法体比对及 before/after 日志位于 `tmp/remaining-work-2026-10-24/wiring/`。新回归脚本尚未登记到 `tests/release-check.js`，需由主代理汇总登记。
