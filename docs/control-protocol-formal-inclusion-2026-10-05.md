# 控制协议人工参考收录记录（2026-10-05）

## 状态与范围

用户报告源码版本 5.1.0 已上传；审核状态、线上发布状态，以及上传包是否含本次修改均未知。本记录只说明当前工作区源码的补齐结果，不声称已重新上传或发布，版本号继续为 5.1.0。

正式目录增加 SmartPLC-F300 与麒麟 Kylin K100R 两条可搜索、可看图、可手动选定的协议参考。它们只对应用户确认的现场样本，不参与自动识别或自动匹配，也不推定其他同型号控制卡或机柜适用。点击使用独立稳定 `referenceId`，不调用 `appearanceGroupId` 或严格自动 resolver。六个自动准入数组继续为空；严格 resolver 和 `protocol` 数据通道保持原样。

F300 样本柜为用户确认的 itC KZX，柜内卡片标签为 SmartPLC-F300；用户确认这台柜内样本使用的协议已验证且准确。F300 品牌、控制卡硬件/固件版本和协议版本未知，说明书版本 `202511 V1.0` 只代表文档版本。K100R 照片可读出控制卡标识 `麒麟 Kylin K100R`，安装设备/机柜型号、控制卡硬件/固件版本和协议版本未知；文档版本 `V1.1（2025-04-03）` 不代表设备版本。两条参考均不填写具名复核人或自动准入所需的 verified/review 状态。

## 来源和照片

两张正式照片逐字节复制自原样本，不裁剪、不生成、不重新编码。照片使用依据记录为 `user-request-2026-10-05`。主代理实际检查原图：型号文字可读；未见客户姓名、地址、联系人、二维码、MAC、账号或序列号等信息；APP1 为 0，未发现 EXIF/XMP。此项记录仅说明这次视觉检查，不等于具名复核或严格来源/脱敏审核标志。

| 参考 | 正式照片 | 图片 SHA-256 | 来源手册 SHA-256 |
| --- | --- | --- | --- |
| SmartPLC-F300 | `pages/control-protocol/assets/smartplc-f300-reference.jpg`（145,839 bytes） | `2F4EEDFE79FDF8D7334970D7A4A5827D05A33C475FA1B48E5B7F5186D6AD9960` | `3DEF2C2A5844F3D2D1424DE76B2BD77A6FFD13E6FD5322E9DF7F8F859CD0F6E4` |
| Kylin K100R | `pages/control-protocol/assets/kylin-k100r-reference.jpg`（175,314 bytes） | `B32D37BDE592DB722F9F20E5BD68C0AF562F6ADA06A840FC23C3D3CD0E4695CF` | `FB90C408CD18559C8534EF3721A1F13B4B563DB0A94F2EA43E0B01EE362D1FBA` |

柜体正面含二维码的原图不进入应用包，继续留在来源档案。测试 fixture 和 `source-copy/` 中的原始文件未改；正式手册是独立文件，不从 `tests/fixtures` 运行时加载。

## 命令与页面限制

| 参考 | 手册数据 | 数量 |
| --- | --- | ---: |
| SmartPLC-F300 | TCP 84 条写入请求；RTU 84 条写入请求 | 168 |
| Kylin K100R | RS485 18 条写入请求；UDP 18 条写入请求 | 36 |
| 合计 | 仅包含可控写入请求，不增加读取或查询协议 | 204 |

正式手册与对应 fixture 的 `transport/id/frame/sourceParagraph/sourceLabel/copyable` 逐条一致。两条图库卡片向页面只下发 `referenceId/title/photo.path`，列表 JSON 为 316 UTF-8 bytes；详情仍从目录按 ID 读取完整手册，204 条命令保持不变。复制按钮只写入剪贴板，不发送设备命令、不联网，也不把用户输入存入本地。F300 页面保留手册参数和 Unit ID `0x32` 等条件。K100R 页面提示操作前使用自动模式，并按文档建议多个继电器操作间隔至少 3 秒。

K100R 文档帧中的示例 MAC `66 88 31 F3 7F 1C` 只为追溯来源帧保留在命令数据中；未输入有效地址时页面不显示该实值，UDP 命令不可复制。页面只接受恰好 12 位连续十六进制字符；清空或格式无效时保持禁用，有效时只替换 MAC 六字节，再提供剪贴板复制。输入的 MAC 不会联网发送或持久化。

## 包体测量与内部预算

测量对象是 `project.config.json` 忽略规则过滤后的有效源码文件总和，不是微信 IDE 编译产物、实际上传包或微信官方包体限制。

| 项目 | 收录前基线 | 当前源码 | 差异 |
| --- | ---: | ---: | ---: |
| 有效源码文件数 | 198 | 202 | +4 |
| 总字节 | 2,324,120 B（2269.65 KiB） | 2,707,627 B（2644.17 KiB） | +383,507 B |
| 图片/音频 | 356,344 B（348.0 KiB） | 677,497 B（661.62 KiB） | +321,153 B |
| WXML | — | 288,975 B（282.20 KiB） | +2,166 B |
| WXSS | — | 298,765 B（291.76 KiB） | +39 B |

增加的四个文件是两张原始 JPG（共 321,153 B）和两份正式手册 JavaScript（共 53,304 B）；已有协议目录源代码变化合计再增加 9,050 B。发布预警预算据实固定为总包 2650 KiB、WXML 284 KiB、媒体 668 KiB。按当前测值，三项分别留 5.83 KiB、1.80 KiB、6.38 KiB。原 main JS 874 KiB、subpackage JS 794 KiB、WXSS 292 KiB 和 single JS 100 KiB 预算保持不变；不根据测试失败动态上调。预算仅作仓库源码预警，不能代替微信 IDE 包体详情或官方限制核验。

## 验证记录

- `node tests/control-protocol-test.js`：通过。覆盖正式两条参考、严格自动准入负例、无效/重复 ID、公开依据失败关闭、命令逐条一致、照片哈希、显式路由/复制和 K100R MAC 限制。
- `node tests/control-protocol-development-preview-test.cjs`：单项隔离自检通过，207 个镜像文件逐字节还原；develop 仍只选择 fixture，trial/release/unknown 选择两条正式人工参考，没有重建 `docs/preview/` 下的真实项目。[原有开发预览 206 文件快照](verification/control-protocol-formal-2026-10-05/active-preview-before.json)保持不变。
- 最终 deterministic 整合在对全部现存 JavaScript 使用原样 `vm.Script(source, { filename })` 的语法门禁后通过：外层和 child 退出码均为 0，`tests/release-check.js` 退出码 0，86/86 通过、总失败数 0、stderr 0 bytes。详情见[最终执行记录](verification/control-protocol-formal-2026-10-05/final-check-execution.json)和[确定性测试报告](verification/control-protocol-formal-2026-10-05/deterministic-release.json)。
- 当前独立有效包审计记录：202 个生产文件、2,707,627 bytes、2 条人工参考、204 条命令、166 个静态 import 无悬空引用；包内无 draft 资源，自动准入目录为空，正式照片原始字节保留。审计见[最终生产包记录](verification/control-protocol-formal-2026-10-05/release-package-audit.json)及[门禁、resolver 和预览隔离核对](verification/control-protocol-formal-2026-10-05/isolation-and-resolver.json)。六份浏览器 REPL 留档已在本任务外改名为原文件名追加 `.tabbit.txt`；新路径文件内容的字节与 SHA-256 核对记录见[重命名核对记录](verification/control-protocol-formal-2026-10-05/browser-repl-external-rename.json)，旧 `.js` 路径现不存在。发布语法检查仍扫描全部现存 JavaScript，并对每个文件原样使用 `vm.Script(source, { filename })` 编译，不执行脚本。
- 最新浏览器验证的 30 个场景通过；Native WCC 28 个模板、WCSC 26 个样式通过，均包含轻量图库列表改动。记录见[浏览器页面验证](verification/control-protocol-formal-2026-10-05/browser-ui.json)和[原生编译](verification/control-protocol-formal-2026-10-05/native-compile.json)。
- 微信 IDE 整包和真机结果仍未核实；用户报告 5.1.0 已上传，但审核/线上发布状态以及上传包是否含本次修改均未知。

核心算法、产品参数、计算基准、记录与存储语义未作修改。`VERSION`、`data/app-meta.js` 保持 5.1.0 原值；生产改动限定在控制协议页面与对应发布测试/文档。
