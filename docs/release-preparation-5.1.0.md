# TuneBuddy 5.1.0 发布准备清单

## 当前状态

**用户报告 5.1.0 已上传；审核状态与线上发布状态未知。** 上传后发现配电箱协议缺失，本次工作补入两条人工协议参考；这项源码修改尚未确认包含在已上传包中，也不表示已经重新上传或通过审核。

下方列出的源码复审和包体数字属于协议参考补齐前的历史基线，不能作为当前源码的验证结果。当前正式参考的收录边界、最新包体测量和本轮检查见[正式参考收录记录](control-protocol-formal-inclusion-2026-10-05.md)，不再沿用下方“正式目录为空”的旧结论。

源码工作区：`C:\Users\wxx\Documents\Codex\audio-system-tool-miniapp`。微信上传版本号填写 `5.1.0`。可直接使用的简洁更新说明见 [`release-notes-5.1.0.md`](release-notes-5.1.0.md)：

> 新增接线助手和项目通道与线缆管理，优化灯具导入、项目保存保护及多项工具的首次使用和输入体验。

## 本轮复审修复

- 探索卡片恢复无字动画、定格倒影和毛玻璃文案层，保留 600rpx 卡片、390rpx 视觉区、210rpx 文案区及卡片外滑动提示。修改文件为 `pages/index/index.wxml` 和 `pages/index/index.wxss`。
- 开发预览自检改在新建的系统临时目录运行，删除前校验目录身份和边界；用合成私有配置验证字节保护。修改文件为 `tests/build-control-protocol-development-preview.cjs` 和 `tests/control-protocol-development-preview-test.cjs`。活动预览的 206 个文件前后路径、大小和 SHA-256 均相同，未被重建或恢复。
- 核心算法、产品参数、计算基准及项目存储语义没有变化。本轮未调整源码预算，也未上传、提交审核或发布。

## 协议参考补齐前的源码检查（历史基线）

- 默认确定性整合包含 `tests/release-check.js` 完整检查，退出码 0；检查未使用任何样本绕过变量。日志见[本轮发布检查](verification/release-5.1.0-fix-2026-10-05/deterministic-release.stdout.txt)。
- 离线确定性套件为 86/86 通过、总失败数 0；执行结果见[测试报告](verification/release-5.1.0-fix-2026-10-05/deterministic-release.json)，命令与退出码见[本轮验证记录](verification/release-5.1.0-fix-2026-10-05/release-verification.json)。Root 和 GPT-6 Sol 独立核对实际源码与结果。
- 原生 WCC 编译 28 个模板、WCSC 编译 26 个样式，均退出码 0、stderr 为空；记录见[编译结果](verification/release-5.1.0-fix-2026-10-05/native-compile.json)。
- 独立有效源码审计统计 198 个文件、2,324,120 bytes；164 个静态 require 无悬空引用。正式控制协议目录为空，生产包中无控制协议开发样本或照片。审计清单见[有效源码审计](verification/release-5.1.0-fix-2026-10-05/release-package-audit.json)。
- 隔离开发预览自检通过：原有配置兼容、安全拒绝、照片哈希和私有配置保护检查均保留；本次临时目录已清理，活动预览未变化。记录见[预览自检](verification/release-5.1.0-fix-2026-10-05/preview-selftest.json)。
- 浏览器预览覆盖 320/375/430 宽度亮暗模式及 320×480、375×568 紧凑视口，共 10 个场景；八张卡片的标题与按钮适配，无页面横向溢出或图片加载失败。报告见[常规视口](qa/explore-experience-2026-10-05/fix-510/report.json)、[320×480](qa/explore-experience-2026-10-05/fix-510-small-320x480/report.json)和[375×568](qa/explore-experience-2026-10-05/fix-510-small-375x568/report.json)。独立[运行时样式记录](verification/release-5.1.0-fix-2026-10-05/glass-runtime-facts.json)确认倒影不播放动画、毛玻璃生效且减少动态效果设置有效。以上是浏览器验证，不是微信模拟器或真机验证。
- 当时两张预览照片只在 `tests/fixtures/control-protocol/`，原始字节及 SHA-256 保留：F300 为 `2F4EEDFE79FDF8D7334970D7A4A5827D05A33C475FA1B48E5B7F5186D6AD9960`，K100R 为 `B32D37BDE592DB722F9F20E5BD68C0AF562F6ADA06A840FC23C3D3CD0E4695CF`。2026-10-05 起，当前源码另有本次请求的公开使用依据和人工参考入口；这不伪造具名复核或来源/脱敏核验标志。详情见本次正式参考收录记录。
- `PRODUCT_DATA_DATE` 和产品数量保持原值。固定源码预警预算见[5.1.0 源码预算说明](release-source-budget-5.1.0.md)；本轮修复后总源码比复审基线减少 319 bytes，固定门限不变。其数值只用于内部源码预警，不代表微信编译包大小或上传限制。

## 仍需人工核验

正式项目的微信 IDE 整包编译、代码包详情大小及真机操作尚未核验。本轮没有执行 IDE 整包、模拟器或真机操作。初次发布准备时的授权超时记录保留在[历史 IDE 状态](verification/release-5.1.0-2026-10-05/wechatide-status.json)，不作为当前连接状态判断；独立开发预览已有[CLI 预览成功记录](qa/control-protocol-restoration-2026-10-05/preview-qr-evidence.json)，也不替代正式项目验收。已上传包是否包含本次源码补齐未知；若发布该源码，需要在微信开发者工具检查重新构建的正式项目和代码包详情。

真机重点复核项目：

- 检查探索卡片的倒影、毛玻璃、左右滑动和动画流畅度，以及减少动态效果设置。
- 在“通道与线缆”编辑线路长度和备注时，检查软键盘弹出、页面滚动、焦点切换和保存结果。
- 切换线路、材料与两端线号视图，检查分页导出内容和图片清晰度。
- 在接线助手切换接头视角和连接条件，检查显示方案与复制/图片内容一致。
- 在不同项目之间切换后保存，确认线路不会写入错误项目且原项目数据得到保留。

微信 IDE 编译、代码包详情核验和上述真机操作仍未完成；用户报告的上传事实不等于审核通过或线上发布，也不能证明已上传包含本次协议参考修改。
