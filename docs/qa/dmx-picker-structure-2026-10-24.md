# DMX 编址页灯具目录与选择器结构整理（2026-10-24）

本轮把目录计算和灯具搜索/选择器方法拆到同目录两个模块，保持当前单型号添加流程、页面 data 默认值、计算和存储语义不变。目录由纯 `createFixtureCatalog` 工厂在原页面模块求值位置创建，继续使用页面已有的灯具名称与图标函数；picker 工厂返回 12 个原页面方法，方法仍通过动态 `this` 访问页面状态及共享弹层关闭框架。VM 中的定时器由调用时代理提供，`openModelPicker` 的时钟读取也由页面传入。

`addGroup`、`reselectPendingFixture`、旧 batch 兼容方法、待确认预览与提交、计算、存储、页面生命周期和共享弹层框架仍留在页面。添加入口继续选择单一型号；没有新增多型号操作。未修改产品数据、数值基准、算法、存储语义、utils、WXML 或 WXSS。

## 验证

- 9 项既有相关回归在 before 全部 exit 0；after 的 9 项全部 exit 0。覆盖搜索生命周期、单型号添加、冷启动、主页面交互与运行时鲁棒性、浮卡、核心计算、统一导出和页面生命周期。
- 新增跨职责回归在保存的 before 页面快照和最终页面上均 exit 0。它检查搜索 debounce 与分类切换、选择对旧 timer 的取消、确认前不写入、重新打开后旧关闭回调失效。
- 最终 `node tests/release-check.js` exit 0，stderr 为空。最终日志与真实退出码保存在 `tmp/dmx-picker-structure-2026-10-24/release-check.log` 和 `release-check-result.json`。
- 四个相关 JS 文件语法检查均 exit 0。独立源码复审确认 149 个页面方法及 data 未变，目录 121 项、7 个分类和默认 36 条结果保持一致；1300 组目录查询与 before 结果相同。移出的函数体原样保留，唯一允许的调用调整是把 `openModelPicker` 的 `Date.now()` 通过注入的 `now()` 调用。
- 微信官方 WXML/WXSS 编译 exit 0，覆盖 3 个 WXML 和 5 个 WXSS；复审确认 8 个编译输入哈希与最终源码相同。该编译不包含 JS 打包。
- 微信真机未测；本轮没有视觉改动，也没有运行浏览器 UI 自动化。

## 本轮文件

- 生产：`pages/dmx-address/dmx-address.js`、`pages/dmx-address/fixture-catalog.js`、`pages/dmx-address/fixture-picker.js`
- 回归：`tests/dmx-picker-cross-boundary-regression.cjs`、`tests/release-check.js`
- 记录：`docs/qa/dmx-picker-structure-2026-10-24.md`

本轮 before 快照以当时工作区为准，不以 HEAD 回滚或覆盖之前的脏工作区；快照、定向日志、独立复审及变更清单保存在 `tmp/dmx-picker-structure-2026-10-24/`。
