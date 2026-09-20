# UI 精简与操作边界验收记录

日期：2026-09-12

## 变更范围

本轮复核 19 个注册页面，修改 32 个 UI 源文件：app.wxss 与 31 个页面 WXML/WXSS。修改文件清单见 [scope-results.json](recovery/pre-ui-simplification-20260911/scope-results.json)。探索页 index 与全部业务 JS 保持原样；文章正文、探索动画、排查技术内容、公式、错误提示、数据出处和存储语义均保留。

本轮删除的内容限于无新增信息的装饰英文、工具徽章、重复解释、项目副标题和侧光 DOM 重复句。renderer 中的侧光边界、0 dBFS = +18 dBu、错误状态、公式、数据出处和存储行为未删除或改写。

## 用户重点查看

- 工具结果按钮：操作按钮保留原有 handler、禁用状态和结果语义，浅色边界改为可见的 1px 主题边框，相关操作组使用 6–8px 间距。
- LED 图区：保留结果图、包边尺寸和下方必要信息；生成/复制按钮与下方墙面安装示意卡之间留出间距。
- 项目与资料库：保留空态指导、资料来源、比较和项目归档动作；清理重复页面说明，项目多动作组统一 8px 间距。
- DMX 弹窗：逐台地址浮层的清空/关闭按钮、批量上杆的清空/确认按钮保留间距与触控尺寸；横屏图片预览布局保持不变。

## 验证结果

独立复核了 272 个浏览器状态，覆盖 320/430 竖屏、844/932 横屏以及 light/dark 主题；missingBinding、overflow、groupIssues 均为 0。浏览器检查使用 WXML/WXSS 映射布局，Canvas 和报告图使用占位图，只验证布局；不能据此声称真机渲染或导出通过。21 个 WXML 与 22 个 WXSS 通过原生编译。本轮未进行完整开发者工具编译或真机调试。

算法、产品数据、全部业务 JS 和存储代码 hash 未变；WXML 事件 multiset 保持一致。包体为 1,558,405 bytes，净增 454 bytes；WXSS 为 222,169 bytes（约 217 KiB），total 预警保持 1522 KiB，WXSS 由 214 KiB 调整为 217 KiB，其余预算项不变。

详细状态见 [qa-summary.json](recovery/pre-ui-simplification-20260911/qa-summary.json)、[scope-check.txt](recovery/pre-ui-simplification-20260911/scope-check.txt) 和 [release-check-final.txt](recovery/pre-ui-simplification-20260911/release-check-final.txt)。node tests/release-check.js 完整通过（退出码 0）。

页面预览：[navigation-contact.png](recovery/pre-ui-simplification-20260911/navigation-contact.png)、[tool-contact.png](recovery/pre-ui-simplification-20260911/tool-contact.png)。
