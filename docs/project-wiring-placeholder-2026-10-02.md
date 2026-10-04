# 项目布线输入提示与历史选择

四个设备/端口历史选择器移到各自标签行右侧；标签行保持 44px 高，选择触区为 44×44px，输入框恢复整列宽度，设备/端口列比例仍为 1.25:1。原 placeholder、输入属性和历史选择器的条件、数据、事件及无障碍标签均保留；未新增动画、控制器逻辑或依赖。改动涉及 `pages/project-wiring/index.wxml`、`pages/project-wiring/index.wxss` 和 `tests/project-wiring-page-test.js`。

页面与键盘专项测试通过，WCC/WCSC 页面源码编译均 exit 0。浏览器映射覆盖 320/375/430px、浅/深色及 12 种表单/历史状态，共 72 个场景：576 项提示宽度检查无截断，168 个选择器均为 44×44px 且无重叠，108 组设备/端口输入顶边对齐，页面横向溢出为 0。48 个受保护文件未变；24 个 input/textarea 属性和 4 个历史选择器属性保持不变。

验证包含真实 WXML/WXSS 源码编译及浏览器样式映射模拟，不包含整包编译或真机检查。本轮未重跑全量 release；历史共享主题导入门禁 `19 != 17` 与本次局部 UI 无关。浅色与深色 375px 截图：[浅色](verification/project-wiring-placeholder-2026-10-02/after-editor-375-light.jpg)、[深色](verification/project-wiring-placeholder-2026-10-02/after-editor-375-dark.jpg)；完整证据位于 `docs/verification/project-wiring-placeholder-2026-10-02/`。
