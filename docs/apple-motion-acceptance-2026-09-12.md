# 苹果风按钮与无文字卡片动画验收

本次按用户要求恢复填充式按钮，并重做探索页八个图形动画。没有新增功能或调整文章正文。

## 完成内容

- 普通按钮移除明显描边。主操作保持蓝色，次操作采用柔和灰色或淡蓝填充；浅色控件填充调整为 `#e8e8ed`，与页面背景区分。
- 同排操作统一盒模型、居中和至少 44px 高度。收藏与加入项目保持 10px 显式间距；修正小屏下结果生成、DMX 生成及批量上杆按钮高度不足。
- 分类标签和动画内文字保持移除；卡片下方标题、阅读入口、静态倒影、毛玻璃及按压反馈保留。
- LED 展示含包边屏体从超出开口到完整装入；限幅展示同步上涨后输出封顶；距离展示传播变弱；线材展示完整连接路径和末端减弱；补声展示后排从灰暗到获得覆盖；增益展示旋钮调整后电平对齐；摄像机保持视场角、后移后容纳全部人物；DMX 展示占位重叠到连续排列。
- 在 `DESIGN.md` 中明确填充式按钮、同排同高和留白分隔规则。

## 修改文件

动画：`pages/index/index.wxml`、`pages/index/index.wxss`。

按钮：`app.wxss`、`styles/theme-page-shared.wxss`，以及 limiter、spl、cable、gain-structure、camera、venue、led-screen、dmx-address、channel-guide、dmx-layout、dmx-layout-landscape、products/library、products/detail、projects、records/project、tools、troubleshoot 的页面 WXSS。

规范与记录：`DESIGN.md`、`CHANGELOG.md`。`tests/release-check.js` 仅更新三处过时 UI 断言，包体限额及业务检查保持原样。

## 验证

- 浏览器映射检查覆盖 19 页、442 个屏宽/主题/状态组合，包含选择器、模式切换、错误状态、项目编辑、DMX 配置与报告预览。
- 1,100 组同排按钮对比未发现高度不一致；192 组收藏/项目按钮间距均为 10px。检查范围内无硬描边残留、关键布局溢出或间距不足。
- 八个场景在浅深主题下逐帧检查。场景无可见文字；倒影不播放；卡片不可见或系统要求减少动态效果时停止动画。
- 原生 WCC 编译 21 个 WXML、WCSC 编译 22 个 WXSS 通过。最后一次线材路径微调后，探索页 WXSS 再次编译通过。
- `node tests/release-check.js` 完整通过。最后一处改动仅移除线材图形的悬空线段，并复核该场景与编译。
- SHA-256 对照确认控制器、算法、产品数据、存储文件未改，WXML 事件绑定集合保持一致。
- 有效源码包 1,556,292 bytes，比本次开始增加 1,997 bytes；WXSS 221,563 bytes，原有限额保持不变。

本次没有执行微信开发者工具整包运行、真机视觉或性能验证。浏览器映射结果不代表真机通过。

## 预览与证据

- [浅色卡片预览](recovery/pre-apple-motion-20260912/cards-light.png)
- [深色卡片预览](recovery/pre-apple-motion-20260912/cards-dark.png)
- [分镜检查](recovery/pre-apple-motion-20260912/storyboard-light.png)
- [检查摘要](recovery/pre-apple-motion-20260912/qa-summary.json)
- [本次源码差异](recovery/pre-apple-motion-20260912/source.diff)

手机验收时可横向浏览八张探索卡片，并在浅深主题下查看工具页结果按钮和 DMX 弹窗的间距、高度及填充层级。
