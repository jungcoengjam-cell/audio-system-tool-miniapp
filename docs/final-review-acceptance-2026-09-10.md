# 最终验收记录（2026-09-10）

## 范围

本记录汇总 [代码审查报告](code-review-2026-09-10.md) 及本系列修复、重构和回归测试的最终验收状态。生产改动覆盖偏好写入失败提示、最近产品记录非法条目净化、过期报告导出回调抑制、报告绘图基础 helper 去重、DMX 结果视图/位置图模型/renderer 职责拆分、DMX 组输入三函数原样抽取，以及产品详情畸形 URI 转为无产品状态。

算法、产品资料、输入含义、输出校验和本地记录存储语义保持原有基线；DMX 编址算法与灯具通道数据未因测试拆分而改变。

## 自动验证证据

以下数字和结论记录主代理提供的独立验证证据。

- 备份 ZIP 中 219 个文件与备份 manifest 逐项 SHA 一致。
- 输入三函数及 Page 定义原样对照通过。
- 121 款可编址灯具、共 18,626 个函数项的前后对照通过，无输入变异。
- WXML 21 项、WXSS 22 项原生 WCC/WCSC 编译通过；WCSC 使用 `-pc 22` 指定根样式文件数量为 22，产物 308,184 bytes，退出码 0；WCC 退出码 0。
- 产品详情入口 361 型号 × 3 合法 URL 共 1,083 项前后深比较通过，另 3 项畸形 URL 由旧抛错改为正常处理，共 1,086 项通过。
- `tests/dmx-core-regression.js` 已从最终审查基线原样抽取两个 DMX 核心函数，独立运行退出码 0。
- 源码包体测得 1511.8 / 1512 KiB；不得以放宽预算替代实测。
- 完整 `node tests/release-check.js` 在全部专项脚本到位后退出码为 0；最终日志见 [release-check-final.txt](recovery/pre-final-review-20260910-220355/release-check-final.txt)。
- 最终源码包体门禁：总计 1511.8 / 1512 KiB；主包 JavaScript 663.2 / 690 KiB；DMX JavaScript 236.1 KiB；WXSS 208 / 214 KiB；WXML 188.5 / 192 KiB。
- 独立 DMX 核心回归、DMX 组输入回归和产品详情入口回归均已纳入 `release-check` 并随全量检查通过。
- 严格异常注入和 runner 失败传播检查通过：DMX `strictEqual` 注入异常后子进程退出码为 1；`execFileSync` 异常传播不会进入完成路径，证据见 `failure-exit-result.json`。

处置记录：README 中摄像机双轴与水平预估说明已核对；相对初轮 baseline 的 31 个既有 data/算法/工具文件保持 SHA；末轮仅 6 个文件修改、5 个文件新增，无删除或越界，生产净增 406 bytes，本轮 `utils` 与 `data` 未变。低优先 API 契约项（非法 wiring、非正功率、缺失垂直角）保留为后续契约测试议题，未改变本轮生产语义；`touchcancel` 行为保留现状，不阻塞本轮完成；灯光清单由用户明确暂不开发，保持取消本轮开发。

本轮文件列表：

- 生产：[dmx-address.js](../pages/dmx-address/dmx-address.js)、[group-input.js](../pages/dmx-address/group-input.js)、[detail.js](../pages/products/detail.js)。
- 测试：[release-check.js](../tests/release-check.js)、[dmx-core-regression.js](../tests/dmx-core-regression.js)、[dmx-group-input-test.js](../tests/dmx-group-input-test.js)、[product-detail-route-test.js](../tests/product-detail-route-test.js)。
- 文档：[README.md](../README.md)、[TuneBuddy-交接说明.md](../TuneBuddy-交接说明.md)、[CHANGELOG.md](../CHANGELOG.md)、本记录。

此前专项文档：[review-fixes-2026-09-10.md](review-fixes-2026-09-10.md)、[dmx-model-refactor-2026-09-10.md](dmx-model-refactor-2026-09-10.md)、[dmx-renderer-refactor-2026-09-10.md](dmx-renderer-refactor-2026-09-10.md)、[report-dedup-2026-09-10.md](report-dedup-2026-09-10.md)、[dmx-result-view-refactor-2026-09-10.md](dmx-result-view-refactor-2026-09-10.md)。专项输出见 [release-check-final.txt](recovery/pre-final-review-20260910-220355/release-check-final.txt)。

## 人工验收清单

用户常规操作：

- [ ] 计算页从产品详情进入后参数正确带入，合法产品 URI 导航正常。
- [ ] 最近查看记录正常显示且排序保持。
- [ ] LED 与项目报告可生成预览，快速返回后再次生成仍可用。
- [ ] DMX 地址页：组输入、搜索选择、库内/自定义切换、跨域编址、通道指南、分页和进入位置图行为保持。
- [ ] DMX 位置图：自动排布、批量上杆、侧光、清空本杆、横屏返回、缩放平移和图片生成行为保持。
- [ ] 三类报告图片的文字、换行、颜色、圆角、坐标和导出结果保持。
- [ ] 在微信开发者工具完成相关页面布局、字体溢出、图片清晰度与交互检查；设备可用时补真机手势和性能检查（本轮未提供完整 IDE 或真机证据）。

开发验证已由自动回归覆盖，无需用户修改本地存储或注入异常：偏好写入失败、非法最近记录、迟到导出回调、畸形 URI、DMX 严格断言失败及 runner 非零退出传播均已有对应证据。源码预算是源码包门禁，不等同于微信实际上传包体；本轮未执行完整 IDE 或真机验证。

## 交接说明

本记录与 `TuneBuddy-交接说明.md` 配套使用。自动化发布门禁和静态编译证据已通过；人工清单仍需现场逐项确认后，才能作出完整产品验收结论。
