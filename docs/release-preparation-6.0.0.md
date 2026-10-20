# TuneBuddy 6.0.0 发布准备记录

## 当前状态

6.0.0 为发布候选版本；上一正式版本为 5.1.0。用户确认本次更新已全部通过真机验证。完整发布回归通过 63/63 项，release SHA-256：`7242e48886bdc1c64449c7a61f37151b45ad1c3c3f238207efde3bf88dde5c5f`。

微信小程序测试预览已成功。测试预览主包为 **2,071,081 B（2,022.54 KiB）**，低于 2 MiB（2,097,152 B）上限 **26,071 B（25.46 KiB）**。包体分布如下：

| 包 | 大小 |
| --- | ---: |
| 主包 | 2,071,081 B |
| 接线助手分包 | 993,578 B |
| 控制协议分包 | 419,901 B |
| DMX 编址分包 | 371,749 B |
| 项目布线分包 | 302,338 B |
| 合计 | 4,158,647 B |

此前测试预览基线为 2,063 KB，超过 2,048 KB 限制约 15 KB。为满足包体上限，`project.config.json` 只新增了两条 `packOptions.ignore`，排除源码扫描确认未被运行时引用的静态图片：

- `assets/home/issue-audio-silent.png`（20,719 B）
- `assets/home/issue-lighting-control.png`（21,019 B）

两图起初仅排除打包；用户查看原图后明确确认已无用途，随后已按授权删除这两个原文件。它们在通过测试预览的包中已被排除，删除不改变该候选包内容，也不改变功能、算法、产品数据或存储语义。

后续发现疑似无用图片或代码，先向用户说明文件、用途、大小和删除影响，取得确认后再删除。

## 上传状态与说明

2026-10-21 02:02 用户尝试上传开发版，服务端以主包 2,098 KB 超过 2,048 KB 拒绝，尚未成功上传开发版、提审或正式发布。测试预览成功不代表开发版上传校验已通过；正式上传仍须以微信服务端的最终校验结果为准。

### 上传过滤配置修正（2026-10-21）

核对此前候选清单后，功能源码未发生变化。开发工具分别读取 `ignoreDevUnusedFiles` 和 `ignoreUploadUnusedFiles`；本地开发过滤已开启，但上传过滤未明确开启（默认关闭）。在同一源码上临时关闭开发过滤进行测试预览，精确复现主包 **2,098 KB > 2,048 KB** 的错误，确认两种构建的过滤设置不一致。

修正仅在 `project.config.json.setting` 新增 `ignoreUploadUnusedFiles: true`；诊断用的 `project.private.config.json` 已从备份逐字节恢复，开发过滤保持开启，`bigPackageSizeSupport: false` 保持不变。没有新增删除资源，也未改动功能源码、计算算法、产品数据或存储语义。

修正后的测试预览成功，主包仍为 **2,071,081 B（2,022.54 KiB）**，分包与上表一致，总包 **4,158,647 B**。完整 `node tests/release-check.js` 通过（含 63 项注册回归，退出码 0，40.723 秒）。此次未再次执行正式开发版上传；仍须由用户重试上传 6.0.0 并确认服务端成功，才能标记正式上传验证完成。

用户随后确认 **6.0.0 上传成功**，正式开发版上传阻塞已解除。本次定稿已完成真机验收、完整回归及开发版上传；后续提审和发布由用户自行操作，当前不标记为已提审或已发布。主包余量仅 25.46 KiB，后续如增加源码或资源，应重新检查包体。

上传说明：`全面升级工具、项目与依据体验，完善接线与通道线缆管理、灯具编址及灯位图，优化摄像机安装计算、控制协议资料、收藏与报告。`

## 验证证据

以下为 2026-10-21 的本地验证记录：

- 预览包大小：`C:\Users\wxx\Documents\Codex\2026-07-08\wo\tunebuddy-release600-2026-10-21\candidate-preview-info.json`
- 预览命令结果：`C:\Users\wxx\Documents\Codex\2026-07-08\wo\tunebuddy-release600-2026-10-21\candidate-preview.log`
- 63 项完整回归：`C:\Users\wxx\Documents\Codex\2026-07-08\wo\tunebuddy-release600-2026-10-21\logs\candidate-full\summary.json`
- 两张图片的引用扫描及配置差异：`C:\Users\wxx\Documents\Codex\2026-07-08\wo\tunebuddy-release600-2026-10-21\two-issue-image-reference-evidence.json`
- 本次上传过滤诊断、修正后预览、完整回归与配置一致性：`C:\Users\wxx\Documents\Codex\2026-07-08\wo\tunebuddy-upload-filter20-2026-10-21`（`unfiltered-preview.log`、`offline-filter-findings.json`、`filtered-preview.log`、`filtered-info.json`、`logs/final-full/summary.json`、`config-integrity.json`）。
