# 两排结果按钮统一验收

生成、复制、收藏、加入当前项目四颗按钮共用一套几何和文字样式。七个包含四颗按钮的工具页均已统一；LED 和项目报告页的输出按钮同步继承公共规则。

- 四颗按钮等宽等高：88rpx，最小 44px。
- 文字统一为 27rpx、600 字重；圆角 22rpx，水平内距 14rpx。
- 两列上下对齐，横向、纵向间距均为 10px，操作区距视口两侧 32rpx。
- 生成保持蓝色填充，复制、收藏、加入项目共用柔和填充和文字色；收藏激活状态保留。
- 使用显式相邻外边距，保持不依赖 flex gap 的间距兼容方式。

## 修改文件

共享样式：`app.wxss`。

清理页面覆盖：limiter、spl、cable、gain-structure、venue、dmx-address、led-screen、records/project 的 WXSS。camera 继承共享修改，未单独改文件。

规范与记录：`DESIGN.md`、`CHANGELOG.md`。未修改 WXML、业务 JS、产品数据、算法、存储、测试或包体限额。

## 验证

- 浏览器映射覆盖 9 页、320/375/430px、浅深两种主题及收藏切换、生成中、会议模式等状态，共 162 个状态。
- 132 组四按钮和 156 组输出按钮实测通过，未发现尺寸、字号、字重、列对齐、间距或文字溢出问题。
- 对照快照确认按钮文案、绑定、显示和禁用状态未变；业务 JS、WXML、数据与测试文件哈希未变。
- 已人工检查两种主题的七个工具操作区对比图。
- 原生 WCC 编译 21 个 WXML、WCSC 编译 22 个 WXSS 通过；完整 `node tests/release-check.js` 通过。
- 有效源码包减少 652 bytes，现为 1,550,403 bytes。

本次未执行微信开发者工具整包运行或真机视觉验证。浏览器映射及编译不代表真机验收通过。

[浅色对比](recovery/pre-result-action-grid-20260912/comparison-light.png) · [深色对比](recovery/pre-result-action-grid-20260912/comparison-dark.png) · [检查摘要](recovery/pre-result-action-grid-20260912/qa-summary.json) · [源码差异](recovery/pre-result-action-grid-20260912/source.diff)
