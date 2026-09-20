# 接线助手集成与验证记录

日期：2026-09-19。接线助手已集成到本地源码，但尚未发布；正式版本仍为 `5.0.1`。本次没有改变既有计算公式、产品数据或记录存储语义。

## 功能范围

接线助手在工具页作为第九个入口，位于“线材选型”之后。它提供 15 种常见模拟音频连接：

| 类别 | 支持的连接 |
| --- | --- |
| 平衡，9 种 | XLR→XLR/TRS/平衡端子；TRS→XLR/TRS/平衡端子；平衡端子→XLR/TRS/平衡端子 |
| 立体声分线，2 种 | 3.5 mm TRS 立体声→双 RCA；3.5 mm TRS 立体声→双 TS |
| 单声道非平衡，4 种 | RCA→RCA/TS；TS→RCA/TS |

六种输出和七种输入共 42 种组合，其余 27 种均明确显示为不支持，不生成连线或接线文本。未知或非字符串接口 ID 也会拒绝。接线图区可切换连线图与接头视角；XLR 接头视角可切换插接面、焊接面。功能还支持复制逐线接法、生成接线图并预览、转发或保存到相册。端口用途和端子功能须按设备说明书确认；外形相同不代表用途相同。逐线定义、针脚边界、资料来源和不支持组合见[接法范围与依据](audio-wiring-method.md)。

此助手没有加入计算器或项目记录归档范围。当前工具入口共九个，其中既有八个计算模块的收藏、项目与记录语义不变。

## 主要修改

- `app.json`：注册 `pages/audio-wiring/index` 分包路由。
- `pages/tools/tools.js`：在线材选型后增加“接线助手”入口。
- `pages/audio-wiring/`：新增页面、接口模型、连线/接头/报告绘制逻辑与页面样式。
- `pages/audio-wiring/assets/`：六张 256×256 透明接头 PNG；`assets/home/module-audio-wiring-catalog.png` 为 256×256 透明工具卡图。
- `docs/audio-wiring-method.md`：记录 15 种组合、逐线对应、针脚视角和资料依据。
- `tests/release-check.js`、`tests/audio-wiring-model-test.js`、`tests/audio-wiring-page-test.js`：路由、资产、模型、绘图、页面生命周期与导出行为回归。

发布包测量为 `1,893,687 bytes`（约 `1849.3 KiB`），主包 JS `781,620 bytes`，接线助手分包 `159,998 bytes`（其中 JS `65,177 bytes`），媒体总计 `346,034 bytes`。预算按测量值向上取整到总包/WXSS/WXML/媒体 `1850/232/209/338 KiB`；JS 分包和单 JS 守卫仍是 `764/100 KiB`。这些是项目内部预警值，不是平台上限。包体对比和 34 个旧 `utils/`、`data/` 文件哈希核对见[package-review.json](verification/audio-wiring-2026-09-19/package-review.json)：34 个受保护文件未变，版本文件与打包忽略配置也未变。

## 验证结果

- `node tests/release-check.js` 完整通过，日志见[release-check.log](verification/audio-wiring-2026-09-19/release-check.log)。其中两项接线专项测试均通过；17 个主包页面、3 个分包页面和 3 个 Tab 路由清单完整。
- 本地 `wcc` 编译 22 个 WXML、`wcsc` 编译 23 个 WXSS，均退出码 0，见[native-compile.json](verification/audio-wiring-2026-09-19/native-compile.json)。这些编译未在微信开发者工具中完整运行，也不等同于真机验收。
- 最终视觉 QA 覆盖 54 个页面状态：绑定错误、溢出、小控件和不等宽按钮均为 0；210 个 Canvas 样例没有画布溢出或文字重叠，映射标题与卡片底边的最小间距为 13 px。独立审查汇总见[independent-audit.json](verification/audio-wiring-2026-09-19/independent-audit.json)，详细计数见[summary.json](verification/audio-wiring-2026-09-19/final-review/summary.json)和[canvas-metrics.json](verification/audio-wiring-2026-09-19/final-review/canvas-metrics.json)。
- 资产检查确认 7 张 PNG 均为 256×256 且包含真实 alpha；六张接口图共 `78,256 bytes`，入口图 `13,162 bytes`，见[asset-review.json](verification/audio-wiring-2026-09-19/asset-review.json)。

典型截图：

- [默认接线界面（375 px，浅色）](verification/audio-wiring-2026-09-19/final-review/default-375-light.png)
- [XLR 插接面接头视角（375 px，浅色）](verification/audio-wiring-2026-09-19/final-review/xlr-front-375-light.png)
- [生成图预览弹层（375 px，浅色）](verification/audio-wiring-2026-09-19/final-review/preview-375-light.png)
- [3.5 mm TRS 到双 TS 分线（375 px，浅色）](verification/audio-wiring-2026-09-19/final-review/dual-ts-375-light.png)

视觉 QA 是本地浏览器模拟，不是微信真机验收。尚未验证真机系统相册授权/拒绝流程、实际焊接和万用表电测，也未发布到微信。独立验收结论和未验证项见[independent-audit.json](verification/audio-wiring-2026-09-19/independent-audit.json)。建议真机验收按以下四步完成：

1. 在微信开发者工具预览并安装体验版，确认工具入口位于“线材选型”之后；逐项抽验 15 种支持组合，并确认另外 27 种均拒绝。
2. 检查接线文字复制准确；生成图片后分别验证预览、转发和相册保存，并覆盖相册权限首次授权及拒绝后的提示与重试。
3. 对照设备和接头厂家资料检查 XLR 插接面/焊接面镜像、TRS/TS 的绝缘环与 T/R/S、立体声双路 L/R 分线和端子功能标记。
4. 在不同尺寸真机及浅/深色主题下检查选择器、滚动和报告布局；对未接设备的样线按厂家图逐线使用万用表检查导通与短路，确认后再开展接入设备的现场验收。
