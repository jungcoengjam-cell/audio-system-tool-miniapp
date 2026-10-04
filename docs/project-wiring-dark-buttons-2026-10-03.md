# 布线页深色按钮

深色模式下，导出与“复制全部布线文字”使用主题深蓝底和浅蓝文字，避免按钮显示白底。禁用的弹窗操作和报告翻页按钮使用深灰底、主题弱化文字；选择器比微信原生 disabled button 默认规则更具体，不依赖 `!important`。报告翻页原有透明度保留。

本轮只改 `pages/project-wiring/index.wxss` 的最后一个深色主题块；没有改共享样式、模板、控制器或尺寸布局。与 before 快照逐行对照，仅有两组指定颜色规则差异；限定 `git diff --check -- pages/project-wiring/index.wxss` 通过。主代理以绝对路径运行 WCSC，exit 0；51 个受保护文件哈希未变。

浏览器 WXML/WXSS 映射完成 38 组前后对照（18 浅色、20 深色），覆盖 185 个按钮和 38 个选择器。6 个导出/复制样本、24 个禁用按钮样本（含 5 个 `type=default` 分支）修复；155 个其它按钮颜色、全部浅色颜色及几何、透明度和绑定保持一致。44px 触控尺寸、文字裁切、横向溢出检查通过；导出文字最低对比度为 6.42。测试将已安装 WAWebview 的原生 disabled 规则映射到浏览器控件，仅验证对应的两种特异性分支。

证据：[验收摘要](verification/project-wiring-dark-buttons-2026-10-03/browser-summary.json)、[WCSC 编译摘要](verification/project-wiring-dark-buttons-2026-10-03/source-compile-summary.json)、[主页面修复前](verification/project-wiring-dark-buttons-2026-10-03/before-main-375-dark.jpg)、[主页面修复后](verification/project-wiring-dark-buttons-2026-10-03/after-main-375-dark.jpg)、[报告保存页修复后](verification/project-wiring-dark-buttons-2026-10-03/after-report-saving-375-dark.jpg)。

这是浏览器 WXML/WXSS 映射和页面样式编译，不是真机或整包验证；报告图是布局占位图。不同设备、微信版本及其原生主题表现未逐一验证。
