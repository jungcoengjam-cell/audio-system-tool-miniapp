# 会议室扩声布局准确性修正验收

本次覆盖报告 / 培训型与围桌讨论型会议室的计算、计划、覆盖绘图和结果摘要验证，并新增回归证据；生产数据、存储语义和版本 `5.0.0` 未改。本轮完整 `release-check` 已通过，但通过发布门禁不等于现场声学验收。

## 已修正的问题

1. 主扩水平覆盖以有效听音宽度的 25% / 75% 源位服务两侧半区，使用首排和末排中较大的未舍入边缘角选择 60°、90°、120°档位。默认页面输入 12×8×4 m、short、首排 3 m、末排 11 m、有效宽度 7 m 的结果显示下倾为 15.1°，热力图源使用同一未舍入方向 15.0843744533°；旧模型曾出现结果约 15.1°而热力瞄准约 23.4287°的不一致。
2. 普通宽浅输入 14×10×3.5 m、long、首排/末排 2/9 m、有效宽度 12 m 的首排需求为 112.6198649480°，自动档位为 120°；库内没有满足 120°H、垂直覆盖及声压能力的主扩时返回 `reviewWarnings`，不伪造具体型号。需求超过 120°时停止自动布置并返回调整提示。
3. 距离和热力图统一使用音箱中心到 1.2 m 听音耳高的真实欧氏三维声程，负向纵深不再置零。8×6×4 m、short、首排/末排 2/5 m、宽 4 m 的独立声程为 2.3853720884 m 和 5.2621288468 m，直达声差 6.8721068935 dB，补声预检查不再误触发两只补声。2.61 m 与 0.31 m 层高的真实 plan 网格点均以 raw 高度和 raw 声源电平独立复算通过。
4. 补声纵距用首排三维参考声程反推 6/12 dB 交接距离，并在计算阶段检查正值、显示值为正、严格递增和至少 0.1 m 组间间隔。2×2×1.5 m、首排 0.01 m、末排 0.6 m、宽 0.01 m 的微小几何现在明确返回补声几何错误，不再让计划阶段把两组夹到相同坐标；2×2×3 m 的相近距离输入仍按声差检查得到无需补声。
5. 报告与围桌定向覆盖使用未夹紧三角形对房间矩形做真实裁切，圆形区域在可用 Canvas API 上使用 `rect` / `clip`。默认 60°独立夹具中，源 `(2.25,0)` 到测试点 `(1,3)` 的点在真实扇区内，生产绘制命令实际记录了裁切多边形起点；没有把端点夹到房间边界后重画成另一扇区。

围桌结果同步纳入本次验收：10×8×4.5 m、7×2.4 m 矩形桌、16 人的平顶案例使用全精度半径 1.8475208614 m 后，覆盖统计由 14/16 修正为 16/16。8×6×3 m、Ø3 m 圆桌、12 人的壁挂案例，最不利方向合格水平距为 5.313673 m，侧视与平面采用同一责任坐席集合，各音箱按负责坐席分别调整，下倾参考范围约 13.7°～35.8°。17×17×2.6 m、14×4 m 矩形桌、32 人案例保留实际 30/32 与需求 123.9° 超过 120° 的状态；页面、复制文字、收藏/项目的结果文字和生成图片摘要均保留关键覆盖信息。远端播放矩形分支的 10 只音箱改为完整 2×5 网格，不新增页面入口。

## 验证结果

新增 `tests/venue-report-accuracy-regression.js` 覆盖默认角度、宽浅首排、超 120°、三维补声翻转、负向纵深、raw 高度网格、微小补声几何、报告/定向/圆形实际 Canvas 命令和四边裁切。集成回归命令及结果如下：

```powershell
node tests/venue-report-accuracy-regression.js
node tests/calculation-boundary-regression.js
node tests/calculator-renderer-regression.js
node tests/venue-discussion-accuracy-regression.js
node tests/release-check.js
```

上述命令均退出 0。渲染 fixture 只重录 6 个 venue 样例，camera 数组保持不变；有效正式包实测 1,622,888 bytes（1584.9 KiB），主包 JS 707,902 bytes（691.31 KiB），对应内部预算 1585 KiB / 692 KiB。版本、`data/`、记录与偏好存储文件未改。

主审独立证据优先见 [`final-evidence.json`](verification/venue-fix-2026-09-14/final-evidence.json) 与 [`release-check-root.log`](verification/venue-fix-2026-09-14/release-check-root.log)，并见 [`independent-check.json`](verification/venue-fix-2026-09-14/independent-check.json)、[`report-fix-audit.json`](verification/venue-fix-2026-09-14/report-fix-audit.json) 和 [`discussion-fix-validation.json`](verification/venue-fix-2026-09-14/discussion-fix-validation.json)：报告 227 项、围桌 54 项、负向距离 9 项、raw 高度网格 6 项、微小补声 8 项均通过；最终视觉脚本覆盖 44 种页面状态，原生编译检查覆盖 21 个 WXML 和 22 个 WXSS。完整发布检查同时保留原有模块和产品数据门禁。

## 工程边界

这些结果是确定性几何和简化自由场模型的准确性修正，不是总声场预测。模型仍未包含房间反射、真实极坐标、补声延时/相位、电平调试或现场多点声学测量；Node / 浏览器 Canvas 预览和导出图也不是微信真机验证。安装完成后仍需按实际坐标、高度、指向和系统调试结果复核覆盖、声压和啸叫裕量。

实际修改文件：[`utils/venue.js`](../utils/venue.js)、[`utils/venue-plan.js`](../utils/venue-plan.js)、[`utils/venue-discussion.js`](../utils/venue-discussion.js)、[`utils/venue-discussion-plan.js`](../utils/venue-discussion-plan.js)、[`pages/venue/plan-renderer.js`](../pages/venue/plan-renderer.js)、[`pages/venue/venue.js`](../pages/venue/venue.js)、[`pages/venue/venue.wxml`](../pages/venue/venue.wxml)、[`pages/venue/venue.wxss`](../pages/venue/venue.wxss)。
