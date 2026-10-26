# 退役代码清理复核（2026-10-26）

## 范围

本轮以 `HEAD f274561579bc4a75e8ebb37dd02f26dc1efb1dac` 建立隔离 candidate，仅验证以下五个生产文件的删除：

- `pages/records/project-report.js`
- `pages/records/report-actions.js`
- `pages/records/report-navigation.js`
- `utils/record-comparison.js`
- `templates/dmx-batch-sheet.wxml`

HEAD 中的 README 文件树另有一行列出 `utils/record-comparison.js`；candidate 仅删除这行索引。工作区 README 从基线到验证结束保持字节不变。candidate 未纳入工作区其他未提交改动。旧的 `docs/qa/dead-code-cleanup-2026-10-23.md` 是此前较广清理的工作区历史记录，当前未跟踪且不随本轮提交打包；克隆后不包含该文件。本轮范围不据此扩展到其他文件。

五份删除前源码从 HEAD 提取到 `tmp/retired-code-cleanup-2026-10-26/before/`，记录了 Git blob 与 SHA-256。工作区在本次任务开始前这五个路径已处于删除状态。candidate 初始导出后逐项校验：HEAD 共 1,698 个 tracked blob，HEAD 文件中仅有这五项删除及上述 README 单行修正；其余 1,693 个 HEAD 文件与候选逐字节一致。完成复核后，这份 QA 文档也被复制到 candidate 同路径；它不属于此前编译输入或已验证的 HEAD 文件集合。

## 依赖审计

使用 AST 静态遍历 `app.js` 与 `app.json` 的 28 个注册路由。注册页面闭包包含 134 个 JS 模块；加上 `app.js` 入口后，剩余 135 个生产 JS 模块全部可达，共 329 条静态 `require` 边。没有动态或外部 `require`、缺失目标或对本轮删除 JS 文件的生产引用。

28 个注册 WXML 页面展开为 40 个文件、22 条 `include`/`import` 边，没有动态路径或缺失文件。`templates/dmx-batch-sheet.wxml` 不在闭包内。28 个页面样式连同 `app.wxss` 与递归导入共 33 个 WXSS 文件、26 条导入边，没有缺失文件。

检索到 21 条旧名称文本命中：7 条位于历史实现/评审文档，14 条位于 `before`、`baseline`、旧验收报告或审计工具。它们记录了原有实现和历史快照，不构成当前生产 `require`、WXML `include`/`import` 依赖；这些历史资料均未改写。

独立 AST 复审记录在 `tmp/retired-code-cleanup-2026-10-26/root-reference-review.json`：HEAD 的 139 个 JS 文件中，四个已删除 JS 文件是仅有的不可达文件；清理后剩余 135 个 JS 文件全部可达。该复审还确认旧 batch 模板不在 40 个可达 WXML 文件的闭包内。五个删除文件的 HEAD 源码合计 24,745 字节；这是移除的源文件体积，不代表或推断运行速度提升。

## 验证

- 隔离 candidate 执行 `node tests/release-check.js`：exit 0，stdout 51,756 字节，stderr 0。完整输出保存在 `tmp/retired-code-cleanup-2026-10-26/release-check/`。
- 微信开发者工具官方 `wcc`/`wcsc` 编译：28 个注册页面、40 个可达 WXML、33 个可达 WXSS 均通过；两个工具 exit 0、stderr 为空。73 个输入源 SHA-256 记录在 `tmp/retired-code-cleanup-2026-10-26/official-compile/summary.json`。
- `final-integrity.json` 记录的 candidate/HEAD 文件对照通过：仅上述五项删除及 README 树状目录单行修正；工作区 README 未变。QA 修订后仅把文档复制到 candidate 同路径，未重跑检查。原始哈希、五份源码快照和依赖结果分别记录在 `tmp/retired-code-cleanup-2026-10-26/baseline.json`、`before/`、`dependency-audit.json` 与 `final-integrity.json`。

本轮未修改核心计算算法、产品数据、校验、记录/存储语义或当前活动 UI；未构建 JavaScript 小程序包，也未做微信真机检查。验证结论仅覆盖本记录列出的隔离候选与静态/发布检查。
