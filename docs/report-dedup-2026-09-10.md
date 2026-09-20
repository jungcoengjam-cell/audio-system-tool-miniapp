# 报告绘图重复代码去重（2026-09-10）

本批针对三份报告绘图源码做小范围重复代码抽取，目标是保持绘制指令、输入输出和公开模块接口不变，同时减少发布包体。

## 修改范围

- `utils/report-drawing.js` 新增共享 `REPORT_COLORS`、`REPORT_WIDTH`、`getExportDimensions`、`drawWrappedText` 和 `drawPill`。
- `utils/result-report.js` 使用共享颜色、尺寸计算和换行 helper，保留结果报告默认字号 20。
- `pages/records/project-report.js` 使用共享颜色、尺寸计算和换行 helper，保留项目 pill 默认字号/内边距/高度 `17/26/33`。
- `pages/led-screen/report.js` 使用共享颜色和默认 pill helper；LED 自有换行实现保持原语义，包括 `String(text)`、无省略号和无返回值。
- `tests/report-drawing-regression.js` 覆盖颜色、默认字号、字体、换行截断、`measureText` 顺序、pill 几何、`||` fallback、null 异常、LED 换行和导出尺寸边界。
- `tests/release-check.js` 接入专项回归脚本。

灯光开场清单、算法、产品数据、输入含义、存储语义、页面控制器、WXML/WXSS、配置、版本和预算均未修改；本批没有模板或样式改动，也未宣称完成 IDE 或真机验证。

## 等价性与包体证据

父代理独立对照使用备份目录 `docs/recovery/pre-report-dedup-20260910-213933/` 的原始源码，对 672 组 helper/整报告场景（含 42 份完整报告）及 57,950 条 Canvas/font/measureText 指令逐项比较，结果完全一致；三报告公开 exports 和两个尺寸函数边界结果保持一致。

四个生产文件按批次 manifest 的源码字节比较如下：

| 文件 | 基线 | 当前 | 变化 |
| --- | ---: | ---: | ---: |
| `utils/report-drawing.js` | 1,843 | 3,404 | +1,561 |
| `utils/result-report.js` | 5,693 | 5,171 | -522 |
| `pages/records/project-report.js` | 8,732 | 7,709 | -1,023 |
| `pages/led-screen/report.js` | 9,341 | 8,742 | -599 |
| 合计 | 25,609 | 25,026 | **-583** |

发布包源码预算检查为 `1511.1 KiB / 1512.0 KiB`，低于预算。

## 验证

- `node tests/report-drawing-regression.js`：专项回归通过。
- `node tests/release-check.js`：完整 release-check 通过，包含专项回归。
