# 项目布线单页面

主页面只保留线路列表；材料表仍可从顶部导出选择器生成。新增的“复制全部布线文字”调用现有全项目文本构建器，不受搜索结果影响。底栏固定为“批量添加”和“添加线路”。没有修改计算、数据或存储逻辑，也没有新增依赖或控制器功能。

相关文件：`pages/project-wiring/index.js`、`index.wxml`、`index.wxss`、`tests/project-wiring-page-test.js`。

验证通过：`node tests/project-wiring-page-test.js`（含 keyboard tests）、`node tests/project-wiring-report-test.js`、`node --check pages/project-wiring/index.js`、测试文件语法检查及限定 `git diff --check`。根代理对页面源码执行 WCC/WCSC 编译，均 exit 0；47 个受保护文件哈希未变，24 项 input/textarea 属性、4 项历史选择器属性未变，复制/导出控制器和报告预览 WXML 保持原样。

浏览器映射覆盖 36 个状态（320/375/430px、浅/深色及 6 种页面状态）：216 个按钮均至少 44×44 且无溢出或文字裁切，36 个整行复制入口、30 组双按钮底栏和 6 个报告预览操作均通过；横向溢出、旧 tabs 和材料卡片均为 0。映射测试使用报告图片占位图，不代表真实图片导出效果。截图：[375px 浅色材料选择](verification/project-wiring-single-page/materials-selected-375-light.jpg)、[375px 深色线路页](verification/project-wiring-single-page/lines-375-dark.jpg)。

以上浏览器结果是布局映射模拟，WCC/WCSC 结果是页面源码编译；未做整包编译或真机检查。全量 release 未重跑；既有共享主题导入基线为 `19 != 17`，与本次页面调整无关。
