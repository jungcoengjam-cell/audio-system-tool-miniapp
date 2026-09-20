# 生成与复制按钮尺寸统一验收

用户反馈各功能的生成结果、复制文字按钮尺寸不一致。本次只处理这组输出操作及其所在区域，不调整计算、产品数据或存储行为。

## 修正内容

- 八个工具和项目报告页复用 `app.wxss` 中的输出按钮样式，移除页面各自的几何覆盖。
- 每行两颗按钮等宽，间距 8px；高度 88rpx、最小 44px；字号 27rpx，圆角 22rpx，水平内距 14rpx。
- 相同视口下，操作行左右均留 32rpx。DMX 和项目报告操作移出原卡片的内边距，消除额外收窄；项目页取消 1.55:1 的宽度比例和较小的复制字号。
- 保留蓝色主操作、柔和填充次操作、按压过渡及生成中禁用状态。收藏和加入项目仍保持 10px 间距。

不同屏宽仍按 rpx 响应式缩放，比较标准是同一屏宽下各页面一致。浏览器映射的参考尺寸如下，实际渲染允许亚像素舍入：

| 视口宽度 | 每颗按钮宽度 | 每颗按钮高度 |
| --- | --- | --- |
| 320px | 约 142.35px | 44px |
| 375px | 167.5px | 44px |
| 430px | 约 192.65px | 约 50.45px |

## 修改文件

- 公共样式：`app.wxss`。
- 移除旧尺寸覆盖：limiter、spl、cable、gain-structure、venue 的页面 WXSS；camera 直接继承共享修正，未修改其源码。
- 接入共享样式及操作区对齐：led-screen、dmx-address、records/project 的 WXML、WXSS。
- 规范与记录：`DESIGN.md`、`CHANGELOG.md`。
- 未改业务 JS、算法、产品数据、校验、存储、测试或包体限额。

## 独立验证

- 浏览器映射检查覆盖 9 页、320/375/430px 三种屏宽、浅深两种主题及相关模式，共 198 个状态。
- 150 组输出按钮的宽高、字号、圆角、间距、对齐和文字容纳检查通过，包含 54 组生成中状态。
- 与本次修改前的快照比较，结果有效/无效时的按钮显示、按钮文案、事件绑定和禁用状态保持一致。
- 人工查看两种主题的跨页对比图，并复核 DMX、项目页移动操作区后的完整上下文布局。
- 原生 WCC 编译 21 个 WXML、WCSC 编译 22 个 WXSS 通过。
- `node tests/release-check.js` 完整通过，退出码 0。
- SHA-256 对照确认业务 JS、算法、数据和存储文件未修改；全部 WXML 事件绑定集合不变。
- 有效源码包由 1,556,292 bytes 减至 1,555,370 bytes，净减少 922 bytes；包体限额保持原样。

本次未执行微信开发者工具整包运行或真机视觉验证。浏览器映射与原生编译结果不代表真机验收通过。

## 证据

- [浅色跨页对比](recovery/pre-output-actions-20260912/comparison-light.png)
- [深色跨页对比](recovery/pre-output-actions-20260912/comparison-dark.png)
- [尺寸检查摘要](recovery/pre-output-actions-20260912/qa-summary.json)
- [源码差异](recovery/pre-output-actions-20260912/source.diff)
- [原生编译结果](recovery/pre-output-actions-20260912/native-compile.json)
- [完整回归输出](recovery/pre-output-actions-20260912/release-check.txt)
