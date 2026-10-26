# 微信开发者工具 EMFILE 排查记录（2026-10-26）

状态：配置检查、完整自检及独立复审通过；用户复验确认 EMFILE 不再出现，本次问题验收通过。

## 现象与处理

真机调试报错：`EMFILE: too many open files, open assets/home/basis-tab-selected.png`。项目已有的 `packOptions.ignore` 只用于打包文件筛选；本次在 `project.config.json` 顶层新增 `watchOptions.ignore`，排除 `docs/**`、`tests/**`、`tmp/**`。页面、资源、工具代码和数据目录仍参与监听；未修改 `project.private.config.json`、UI、算法或产品数据。

在本机微信开发者工具 2.02.2607171 Win64 的 `resources/app.asar` 中，项目配置 schema 定义了 `watchOptions.ignore: string[]`；运行实现把数组字符串传给 fileutils。其递归 glob 使用 glob 7.1.2：`docs/**` 会生成根目录 `docs` 的目录匹配器，遍历时先调用 `childrenIgnored`，因此会剪枝整棵目录树。无需追加 `docs/**/*`。

## 验证结果

- 配置可解析为 JSON；忽略规则匹配项目文档、测试和临时文件，不匹配页面、资源及 `utils/`、`data/` 源码。
- `node tests/release-check.js` 退出码为 0；完整日志保存在 `tmp/devtools-emfile-2026-10-26/release-check.log`。其中项目删除弹窗回归通过。
- 配置原件与其他工作区文件的 SHA-256 基线保存在 `tmp/devtools-emfile-2026-10-26/`；保留了运行前已有的所有本地改动。
- watcher 配置需重新打开项目加载。自动验证未现场复现该 EMFILE；“监听大量 docs/tests/tmp 文件导致文件句柄耗尽”仍为高疑似根因，未直接证实。用户后续复验已确认报错不再出现。
## 后续反馈

2026-10-26，用户反馈“删除项目可以了”，确认后续真机删除操作可执行。随后在说明 EMFILE 复验步骤后，用户明确反馈“没有了”，确认该报错不再出现，本次验收通过。此反馈不代表长期稳定性已经验证，也不将高疑似根因记为已证实。
