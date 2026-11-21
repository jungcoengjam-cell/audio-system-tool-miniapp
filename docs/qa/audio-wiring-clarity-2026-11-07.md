# 接线助手清晰度改进 QA（2026-11-07）

## 改动

- Canvas 每端增加约64逻辑像素的完整接头外形，保留原焊接局部；图注分别说明外形识别、焊接面和端子丝印用途。已连接焊点标签增至9px，并加实色底。窄屏长标题会换行。3.5mm接头T标签移到焊点右侧，避免压住R焊点和选中光环。
- XLR 端口卡按线缆性别显示母头或公头；立体声线芯到 RCA/TS 自动双头的现有映射保持不变。Canvas 下方增加“输出端接点 → 输入端接点”两列清单，逐行使用现有 `fromLabel`、`toLabel`；行高至少44px，可与线芯高亮联动并重复点选取消。紧凑导出加入相同逐线文字。
- 路线候选先考虑减少交叉，再考虑长度；原焊接图片相对针脚锚点未变，画布整体布局位置有调整；间距/避碰约束、选中线加粗与缓存校验保留。模型连接、产品数据、校验、偏好及存储语义未改。

变更文件：

- `pages/audio-wiring/wiring-renderer.js`
- `pages/audio-wiring/wiring-photos.js`
- `pages/audio-wiring/index.js`
- `pages/audio-wiring/index.wxml`
- `pages/audio-wiring/index.wxss`
- `pages/audio-wiring/assets/overview/xlr-female-v1.png`
- `tests/audio-wiring-renderer-test.js`
- `tests/audio-wiring-page-test.js`
- `docs/audio-wiring-photo-assets.md`
- `docs/qa/audio-wiring-clarity-2026-11-07.md`

## 截图与交互

- 390浅色与深色的压缩后XLR截图：[浅色](../../tmp/wiring-diagram-clarity-2026-11-07/after-compressed/screenshots/390-light/xlr-to-xlr.png)、[深色](../../tmp/wiring-diagram-clarity-2026-11-07/after-compressed/screenshots/390-dark/xlr-to-xlr.png)。128px母头图在64px Canvas概览和端口卡中均清晰。
- 母头图压缩后的独立交互复核：[结果](../../tmp/wiring-diagram-clarity-2026-11-07/independent-xlr-final/result.json)、[浅色选中](../../tmp/wiring-diagram-clarity-2026-11-07/independent-xlr-final/xlr-light-selected.png)、[浅色导出](../../tmp/wiring-diagram-clarity-2026-11-07/independent-xlr-final/xlr-light-export.png)、[深色选中](../../tmp/wiring-diagram-clarity-2026-11-07/independent-xlr-final/xlr-dark-selected.png)、[深色导出](../../tmp/wiring-diagram-clarity-2026-11-07/independent-xlr-final/xlr-dark-export.png)。原7组 [`independent-ui`](../../tmp/wiring-diagram-clarity-2026-11-07/independent-ui/result.json) 证据保留。
- 其他典型图：[TRS平衡→TRS平衡（320深色）](../../tmp/wiring-diagram-clarity-2026-11-07/after-final/screenshots/320-dark/trs-balanced-to-trs-balanced.png)、[3.5mm立体声→双RCA（320深色）](../../tmp/wiring-diagram-clarity-2026-11-07/after-final/screenshots/320-dark/stereo35-to-dual-rca.png)、[TS→TS（320深色）](../../tmp/wiring-diagram-clarity-2026-11-07/after-final/screenshots/320-dark/ts-to-ts.png)、[RCA→RCA（320深色）](../../tmp/wiring-diagram-clarity-2026-11-07/after-final/screenshots/320-dark/rca-to-rca.png)。完整十图及布局指标见 [`after-final/report.json`](../../tmp/wiring-diagram-clarity-2026-11-07/after-final/report.json)；XLR压缩后数据见 [`after-compressed/report.json`](../../tmp/wiring-diagram-clarity-2026-11-07/after-compressed/report.json)。
- 独立浏览器复核7组：实际点选接口、点清单行、重复点取消、点Canvas线芯、核对5.8px/1.6px线宽、`aria-pressed`、双头和PNG导出；44px触区无横向溢出，320深色大字行高65.03px。结果见 [`independent-ui/result.json`](../../tmp/wiring-diagram-clarity-2026-11-07/independent-ui/result.json)。压缩后XLR浅深色也独立复核并分别导出。以上为浏览器与模拟微信API检查，本轮未微信真机复测，待用户验收。
- 初次截图曾写入基线截图目录，之后已隔离到 `after-final` 和 `after-compressed`；原目录不用于前后截图比较。基线源码快照仍保存在 [`baseline/original`](../../tmp/wiring-diagram-clarity-2026-11-07/baseline/original)，路由前后数值来自该源码重建。

## 路由与包体

- 独立复核覆盖49个可见组合×3种宽度，共147样本：交叉数201降到188，11个样本改善、0个变差。交叉仍存在；319px下3.5mm立体声→`rcaMono`为3→2，TRS平衡→TRS平衡保持1，立体声→`tsMono`保持4。完整结果见 [`independent-route-result.json`](../../tmp/wiring-diagram-clarity-2026-11-07/independent-route-result.json)。
- 最新Node几何计时：冷布局均值7.46→9.60ms，中位数5.43→6.93ms，P95 18.22→29.23ms，最大值46.52ms。它们不是微信设备性能数据。
- 新XLR母头图为128×128索引PNG，128色、`tRNS`透明通道，4,513字节；由内置ImageGen生成后等比面积重采样。用于识别外形，不作为精密机械或针脚依据。英文原始提示词和来源见[素材说明](../audio-wiring-photo-assets.md#xlr-female-cable-overview)。
- 压缩后全量发布包门禁为5113.7/5120.0KiB，余量约6.3KiB。模型/保护文件复核为38个保护文件无变化、63组模型与文字结果一致、无模型变异：[`independent-business-result.json`](../../tmp/wiring-diagram-clarity-2026-11-07/independent-business-result.json)。

## 验证

- 通过：`audio-wiring-renderer-test.js`、`audio-wiring-page-test.js`、`audio-wiring-model-test.js`、`audio-wiring-geometry-cache-regression.cjs`、`audio-wiring-result-image-theme-cache-regression.cjs`。最终 getter 回归覆盖未知、`constructor`、`toString`、`__proto__`及非字符串 ID；页面回归覆盖重置后保存空偏好再重开、仅选择输入端时输出卡保持空提示，并保留XLR母头卡素材断言。其他专项回归覆盖完整外形与局部图加载、报告图片路径、清单点击联动，以及 stereo35 T 标签不与R焊点/选中环相交。
- 微信开发者工具 `wcc.exe`、`wcsc.exe` 原生编译通过：40个WXML、35个WXSS；编译源哈希已复核。编译记录在 [`compile/compile.json`](../../tmp/wiring-diagram-clarity-2026-11-07/compile/compile.json)。
- 全量 `tests/release-check.js` 覆盖最终 getter 边界与空输出卡修复后由主代理复跑通过（退出码0），门禁包体5113.7/5120.0KiB；完整日志见 [`final-release-check.log`](../../tmp/wiring-diagram-clarity-2026-11-07/final-release-check.log)。本轮未微信真机复测，待用户验收。
