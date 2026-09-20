# 2026-09-10 审查修复记录

本轮完成三项审查修复与报告基础绘图去重：产品资料带入计算现在能区分偏好未变化和写入失败，写入失败会提示并停留在当前页；最近查看记录逐项过滤非法类型、空型号和非对象；LED 与项目报告的导出失败回调在页面卸载或新请求后会被 revision 守卫抑制。

`utils/report-drawing.js` 提供三份报告共用的 `roundedRect`、`setText`、`drawText`，以及结果报告和项目报告共用的 `splitText`。默认字体、颜色、坐标、换行参数和调用顺序保持原实现。

本轮文件：生产代码为 `utils/preferences.js`、`utils/products.js`、`pages/products/detail.js`、`pages/led-screen/led-screen.js`、`pages/records/project.js`、`utils/result-report.js`、`pages/records/project-report.js`、`pages/led-screen/report.js`、`utils/report-drawing.js`；测试为 `tests/review-fixes-regression.js` 和 `tests/release-check.js`；记录为 `CHANGELOG.md` 与本文件。

验证：`node tests/review-fixes-regression.js` 与 `node tests/release-check.js` 均已通过；专项测试使用真实 DMX 灯具 `TL-SE3401`，通道模式为 4、16、88、168。测试同时覆盖报告旧回调的 `setData` 与 `hideLoading` 计数守卫。最终发布包门禁为 1510.0 KiB / 1512.0 KiB，该数值是源码门禁结果，不代表微信实际上传包体。主代理已用 `docs/recovery/pre-review-fixes-20260910-011015/manifest.json` 完成备份 205 项 hash 核对；19 组报告绘图指令对照共 24483 条指令完全一致；WCC 21 个 WXML 与 WCSC 22 个 WXSS 独立原生编译均退出 0。上述编译不是完整 IDE 编译，也未进行浏览器渲染或真机性能检查。绘图和模板证据基于本轮未再修改报告/helper/模板这一前提。

本轮未修改算法、产品数据、DMX 逻辑或模板样式。
