# TuneBuddy 会议室扩声布局准确性复核汇总

日期：2026-09-13。当前几何准确性不能判通过：报告/培训型和围桌型均有可复现的跨表示不一致。主审完整 `release-check` 已通过，见 [release-check.log](verification/venue-accuracy-2026-09-13/release-check.log)；发布回归不能覆盖本轮几何问题。生产文件只读，本轮仅新增审计材料。

报告型证据见 [JSON](verification/venue-accuracy-2026-09-13/report-audit.json)、[发现](verification/venue-accuracy-2026-09-13/report-findings.md)；[脚本](verification/venue-accuracy-2026-09-13/report-audit.cjs) 断言案例和关键关系，否则非零退出。页面默认显示下倾 15.1°，热力实际瞄准约 23.4287°；普通宽浅显示水平 60°，首排需求约 112.6199°、末排 36.8699°，KF-D10F 名义覆盖 100°。另有边界裁切漏画、补声重合、二维/三维声程不一致。负纵向距离只代表单声源声程错误，不是总声场或实测差值。

| 优先级 | 范围与输入 | 独立复核事实 | 定性 |
|---|---|---|---|
| 高 | 报告默认：12×8×4 m，short，首/末排 3/11 m、宽 7 m | 页面显示下倾 15.1°，热力实际瞄准约 23.4287° | 报告与热力模型不一致 |
| 高 | 普通宽浅：14×10×3.5 m，long，首/末排 2/9 m、宽 12 m | 显示水平 60°；首排需求 112.6199°、末排 36.8699°；KF-D10F 名义 100° | 覆盖角与首排布置不匹配 |
| 中 | 报告扇区：默认同一输入 | 生产路径为 (2.25,0)→(0,11)→(8,11)；点 (1,3) 在 60° 扇区内、绘制三角形外，见[对比图](verification/venue-accuracy-2026-09-13/report-geometry-comparison.png) | 渲染裁切缺陷 |
| 中 | 报告均匀度：8×6×4 m，首/末排 2/5 m、宽 4 m | 生产 8.1 dB/补声 2；独立三维 6.8721 dB/同阈值不补声 | 高度口径不一致 |
| 中 | 报告补声：18×10 m 边界，首/末排 1/2.4 m、宽 18 m | 两组均裁为 1.9 m，F1/F3、F2/F4 重合 | 位置唯一性缺陷 |
| 中 | 围桌矩形桌：10×8×4.5 m，桌 7×2.4 m、16 席 | 生产 14/16；全精度半径 1.8475208614 时同模型 16/16 | 舍入导致统计不一致 |
| 中 | 围桌壁挂侧视：8×6×3 m，圆桌 Ø3 m、12 席 | 主结果最远约 5.3 m；侧视不筛指向取 2.9 m、33.5°，独立可用近/远 1.8036/5.3137 m、均角对照 24.7657° | 侧视口径不一致，不是施工值 |
| 中 | 导出状态：17×17×2.6 m，矩形桌 14×4 m、32 席、Voice Lift 平顶 | 生产为 12 只 120°、30/32，warning 为“需 123.9° 超当前 120°”；`buildResultReportRecord` 的生成结果图片摘要遗漏 warning 和 30/32，复制文字与收藏/项目记录保留 | 输出摘要信息差异，不是存储丢失 |

围桌细节见 [discussion-findings.md](verification/venue-accuracy-2026-09-13/discussion-findings.md)。remote 分支的矩形残缺网格及圆桌范围案例暂不作当前入口问题；Voice Lift 的矩形 32 席范围案例当前可达，已列入导出状态问题。16/16、12/12 只是简化模型，不是实测声压或反馈证明。主审 [root-review.json](verification/venue-accuracy-2026-09-13/root-review.json) 记录：固定原工作电平时，负纵向距离单源差 8.0109100 dB、合成差 0.11265249 dB；162 个生产文件 SHA-256 一致。

科学边界：JBL 的 `20 log10(distance)` 是自由场计算；Yamaha 区分名义覆盖与听音面有效覆盖；Shure 的 Voice Lift 参考不是硬阈值，PAG/NAG 与防啸叫也不能由几何证明（[JBL](https://jblpro.com/fr/tools/calculators)、[Yamaha](https://usa.yamaha.com/products/proaudio/software/commercial_installation_solutions_speaker_calculator/index.html)、[Shure Voice Lift](https://www.shure.com/en-EU/applications/voice-lift-and-sound-reinforcement)、[Shure ceiling-array/PAG](https://www.shure.com/en-MEA/insights/how-to-get-the-best-performance-from-ceiling-array-microphones)）。本轮无现场实测/极坐标仿真；[GB/T 50371-2006（2024 年版）标准元数据](https://ebook.chinabuilding.com.cn/zbooklib/book/detail/show?SiteID=1&bookID=155782)可确认版本信息，但 4.2.3 原表未取得，95/98 dB 不能称为原文已复核。推荐库为 8 个角色、6 个型号，字段内部一致；厂家 PDF 未重取。

审计范围还检查了尺寸方向变换、面积/纵深/层高边界、首末排和有效听音宽度、主扩与补声数量、音箱坐标是否越出房间、覆盖角候选、距离四舍五入、热力图统计状态和页面扇区绘制。报告脚本的 8 个案例不是随机压力测试，而是产品默认、普通长窄、普通宽浅、极端宽浅、低首排、三维阈值、渲染裁切和补声裁切的有限确定性矩阵。通过项只说明这些输入下坐标在房间内、网格有有限值、方向变换与基础数量关系成立；不能把“需复核”之外的项目解释成工程验收通过。

围桌审计还核对了圆桌/矩形桌坐席环、吸顶/壁挂/吊装安装条件、定向扇区责任坐席和代表性间距。壁挂侧视图的近远距离若不按可用扇区筛选，会把不负责该坐席的音箱纳入角度计算；矩形桌半径先舍入再统计，会造成同一覆盖域的 14/16 与 16/16 差异。页面目前固定传入 Voice Lift，远端播放分支的潜在问题只作附注；页面展开方案仍有覆盖统计，但 WXML 不直接显示 `result.warnings`，生成结果图片摘要也缺少关键 warning/统计。所有这些判断仍须由统一源坐标、实际指向和现场测量确认。

本轮结论不是修复完成。后续验收至少应证明：同一输入的页面文字、热力图、侧视图和生成摘要一致；统计不使用显示舍入值；补声组坐标可区分，超出覆盖范围时明确进入复核状态而不伪装满足；warning 和关键统计在页面与导出摘要可追踪。复现命令：

```powershell
node docs/verification/venue-accuracy-2026-09-13/report-audit.cjs
node docs/verification/venue-accuracy-2026-09-13/discussion-audit.cjs
```

退出码 0 只表示审计成功复现并记录了问题，不表示功能几何准确性通过。修正后再由主审独立复核和执行发布检查。
