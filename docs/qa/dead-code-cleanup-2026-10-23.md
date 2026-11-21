# 死代码清理记录（2026-10-23）

完成时间：2026-10-24（本轮工作始于 2026-10-23）。本次按当前注册页面、运行时入口和可达模块关系清理已退役实现；不据静态未匹配结果删除图片或设计原稿。

## 清理范围

删除 9 个生产文件：

- `pages/dmx-layout-landscape/` 下的 `dmx-layout-landscape.js`、`.json`、`.wxml`、`.wxss` 四件套。
- `pages/records/project-report.js`、`report-actions.js`、`report-navigation.js`。
- `utils/record-comparison.js`。
- `templates/dmx-batch-sheet.wxml`：当前注册套件和 WXML 动态 include 检查均无活动依赖；只见历史冻结快照/清单路径证据，快照已保存，不要求生产继续保留该模板。

另在 `pages/records/project.js` 移除旧长图、复制及相关缓存状态/方法。当前 PDF 导出、metadata 处理和读取失败保护仍保留。总源文件减少 98,395 字节（约 96.1 KiB）。

页面/模块检查覆盖 28 个注册页面、110 个可达 JS 模块；字面量 `require` 图未发现缺失目标、计算式 `require` 或孤立生产 JS。此结果是页面/模块可达性检查，不代表已证明全仓每个函数均无死代码。

## 保留与语义

8 个 `data` 文件、核心算法和记录存储相关文件的哈希未变。共享 `page-factory` 横屏分支、共享图片助手 `utils/report-image-actions.js`、诊断 API、主题 explore 图标、设计原稿及历史 `before`/baseline/manifest 均保留。LED、venue、DMX 35/70 和 70 条完整快照保留。README 与有效回归已迁移到当前 PDF 流程；metadata 在 `savedAt` 不变时修改备注仍会使当前 PDF/预览缓存失效。

原仅依赖退役横屏页的 `placement-sheet-test` 已删除；路由专属旋转检查迁入退役检查，共享模式检查改由工厂创建。历史冻结快照和原有审计证据未改写；新证据集中在 `tmp/dead-code-audit/`。

## 验证

- `node tests/release-check.js`：通过，exit 0；日志：`tmp/dead-code-audit/release-check-final.log`。
- 官方 `wcc`/`wcsc`：28 页、41 个 WXML、33 个 WXSS 全部通过；最终源哈希一致，记录：`tmp/dead-code-audit/compile/compile.json`。
- 相关定向回归及 round3 竖屏浏览器检查：2/2 通过。证据归档于 `tmp/dead-code-audit/browser-evidence/refinements-browser`、`refinements-rotation`、`round3-browser`；原 `round3/evidence/source/audit.json` 未改。
- 静态包体预算估算：主包源码 2329.3/2460 KiB、主包 JS 1473.8/1536 KiB、总计 4806.2/5120 KiB。这些是源码预算估算，不是微信编译包实测值。

## 未覆盖项与现存测试问题

两个非 release 注册的 refinements 竖屏浏览器案例已在本轮更新后通过，详见下方复验记录。

未进行真机检查或实际上传验证；当前无 Slack/Statsig 连接，未检查外部对应配置。

## 本轮复验（2026-10-24）

- 仅运行 `layout` phase 的两个竖屏配置：390×844 浅色与 320×568 深色；源映射生产页面 Chromium 测试 2/2 通过。结果及 16 张交互截图、2 张导出 PNG 位于 `tmp/dead-code-browser-refresh/evidence/`，结果文件为 `results-layout.json`。本轮不是微信真机验证。
- 两个案例都通过真实布灯面板输入覆盖 A001、无匹配和清空恢复，核对 27 台 fixture 的身份、地址与恢复数量；从已摆放灯具的预览列只读选中后，核对选择标记和页面反馈，并确认位置、写入计数及已保存状态不变。关闭面板后确认主画布重新挂载，再经可见分享按钮生成单页 PNG；核对标题、画面标签、完整 27 台地址附表（灯杆 1/2、面光杆 1 分别 9/8/10 台）、PNG 签名与实际尺寸，并确认导出前后灯位和已保存位置不变。
- 除原先固定 6 列与已退役定位面板入口两项过期断言外，继续执行时还发现旧导出断言假设图中不含地址附表，且读取了已替换的页数数据字段。测试现按附表标题后的绘制坐标逐一核验全部地址，并读取当前单页导出字段；没有修改生产页面、样式、算法、数据或存储。主代理记录的生产源复核与完整 release 检查均通过，分别见 `tmp/dead-code-browser-refresh/source-review.json` 和 `tmp/dead-code-browser-refresh/release-check.log`。
