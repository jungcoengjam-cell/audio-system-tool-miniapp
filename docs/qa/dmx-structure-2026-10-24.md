# DMX 视口 helper 结构整理（2026-10-24）

本轮只把两页中的视口计算 helper 移入同目录模块。`readLayoutViewportMetrics` 位于 `pages/dmx-layout/layout-viewport.js`；编址页的视口、安全区、搜索滚动、浮卡和地址标签列数计算位于 `pages/dmx-address/viewport.js`。原页面只增加导入并移除已迁移定义，调用点保持原样；helper 声明及常量按本轮 before 快照原样搬移。

没有改动初始 data、页面方法名或其它页面源码。独立复审确认编址页 149 个方法、灯位图横竖屏各 97 个方法及 data 一致；灯位图 factory 对外导出一致。216 个受保护源码与配置文件中只有两个目标页面 JS 变化，另新增两个 helper 模块；计算、产品数据、存储、渲染、导出和 WXML/WXSS 均未改动。

## 验证

- Before 快照函数与新模块完成 33 组直接差分，覆盖横竖屏、320px 小屏、事件尺寸优先、API 缺失或抛错、异常胶囊/安全区、搜索底栏与大量选择、零个/大量地址标签、浮卡边界及标签列数阈值；返回值、异常和 API 调用顺序均一致。
- 新增 `tests/dmx-viewport-boundary-regression.cjs` 并登记到发布检查；直接边界断言通过。
- 11 项相关 DMX 回归在 before 和 after 均 exit 0：viewport bounds、地址页运行时鲁棒性、floating-card、core、search lifecycle、cold initialization、channel-guide lazy load、layout current flow、unified export、single-model add、layout theme/lifecycle。
- 完整 `node tests/release-check.js` exit 0；日志和退出码记录在 `tmp/dmx-structure-2026-10-24/release-check.log` 与 `release-check-result.json`。
- 官方微信 WXML/WXSS 编译 exit 0，覆盖 3 个 WXML 和 5 个 WXSS；独立复审确认 8 个编译输入哈希与最终源码相同。此检查不包含 JS 打包。
- 微信真机未测；本轮没有 UI 样式或交互改动，验证依据为 helper 差分、专项回归、发布检查和静态页面复审。

## 本轮文件

- 生产：`pages/dmx-layout/page-factory.js`、`pages/dmx-layout/layout-viewport.js`、`pages/dmx-address/dmx-address.js`、`pages/dmx-address/viewport.js`
- 回归：`tests/dmx-viewport-boundary-regression.cjs`、`tests/release-check.js`
- 记录：`docs/qa/dmx-structure-2026-10-24.md`

本轮快照与检查结果保存在 `tmp/dmx-structure-2026-10-24/`；before 文件以当时工作区为准，不以 HEAD 作为基线。
