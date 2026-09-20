# TuneBuddy 新功能研究（2026-09-13）

> 2026-09-19 规划更新：用户反馈其现场使用的音频处理器已支持输入距离自动换算延时，独立扬声器延时工具不纳入后续开发计划。以下优先级和方案保留为 2026-09-13 的历史研究，不代表当前计划。

本文是候选研究，不代表已实现。优先顺序明确为：第一优先扬声器延时对齐；第二优先视频无画面排查；第三优先音频接线图解。排序只依据仓库复用程度、功能空缺和资料依赖，不代表用户频率或精确工时。

## 候选比较

| 候选 | 仓库证据、真实空缺 | 边界与范围 |
| --- | --- | --- |
| 第一优先：扬声器延时对齐 | `utils/venue.js:280-285` 有声程/声压差，但 `docs/venue-system-topology.md:5-9`、`docs/venue-estimation.md:62-72` 明确不算延时。 | 独立输入同一听音点到 A/B 的实际声程；不读取 venue 粗略交接坐标，不冒充实测相位对齐。小型。 |
| 第二优先：视频无画面排查 | 现有树只有音箱无声、灯具不受控（`README.md:81-85`、`pages/troubleshoot/index.js:13-24`）；视频工具是摄像机/LED（`pages/tools/tools.js:5-13`）。 | 源设备→线缆/矩阵/延长器→显示端；当前小程序未接入 HDMI/EDID 设备状态读取，首版依靠用户观察。中型。 |
| 第三优先：音频接线图解 | `utils/cable.js:39-145`、`pages/cable/cable.wxml:21-126` 只选功率线材；`data/knowledge.js:83-120` 只讲损耗。 | 少量已核实低电平接法；不能凭 TRS 外形推断平衡/立体声。中型。 |
| 啸叫/噪声引导 | 音频树只处理无声；Mix-Minus、AEC、反馈仍是现场调试边界（`docs/discussion-meeting-estimation.md:13-15,48-50`）。 | 啸叫与底噪分树；不建议抬音量制造啸叫。后续，中型。 |
| 投影安装快算 | 摄像机垂直平面反算是 FOV 语义（`docs/camera-fov-calculation.md:21-29,34-50`），不能直接当投影计算。 | 投射比＋画面宽度或投影距离反算；镜头/变焦按厂家有效投射比核实。后续，中型。 |
| LED 发送卡带载 | LED 只算拼装与估算分辨率（`utils/led-screen.js:212-327`）；文档排除控制系统（`docs/led-screen-calculation.md:3-5,60-63`）。 | 必须有实际像素矩阵、控制器、位深、扫描和端口限制；不能泛化单口数值。后续，大型。 |
| 信号链/Patch 图 | 围桌已有路由与覆盖图（`pages/venue/venue.wxml:292-350`、`pages/venue/plan-renderer.js:186-235`），没有任意设备/端口/线缆清单。 | 模板可做，任意拖拽编辑较大。后续，中到大型。 |
| 测试信号播放 | 知识页只是建议低电平测试信号（`data/knowledge.js:34-38`）；`pages/knowledge/detail.js:129-168` 的播放是动画，不是音频输出。 | 先验证微信音频 API、资产和设备路由；不能声称现场校准。后续，中型起步。 |

## 首选 MVP

### 1. 扬声器延时对齐

首版假设同一声源参考信号分别经两路音箱到同一参考听音点。输入声程 `rA/rB`（单位 m）；默认两路电子延时相同，也可填写两路已知电子/已设延时 `eA/eB`（单位 ms），未知值不能当作已测零值。总到达时间 `tA/tB`（单位 ms）为 `tA = rA / 343 × 1000 + eA`、`tB = rB / 343 × 1000 + eB`，其中 343 m/s 是本例的声速估算假设；给总到达较早的一路增加 `abs(tA-tB)` 的非负延时；两路已知延时不等时，不能简单按较近音箱判断。例：主扩 18 m、补声 6 m 且电子延时相同，补声增加约 35.0 ms，作为几何调试起点。Yamaha 指南说明补声需时间对齐：[官方指南](https://www.yamaha.com/US/houseofworship/downloadables/Audio-System-How-to-Guides/Roadmap-to-a-Consistent-Mix-Guide.pdf)；Yamaha 原始资料的 §5.5 给出声速 343 m/s 并区分电子链路和声学路径延时，§5.6 说明数字组件和插入处理会增加不同链路延时：[Audio Quality](https://usa.yamaha.com/products/contents/proaudio/docs/audio_quality/05_audio_quality.html)。公式是基于传播时间的几何演算，不是原型号预设。

结果可沿用收藏、项目和图文报告，基础在 `utils/preferences.js:11-36`、`utils/result-record-actions.js:10-77`。示意图应明确画出音箱 A/B、同一听音点、两条声学路径和先后到达；首版不做自动测量、低音分频相位对齐或全声场模拟。`utils/venue-plan.js:37-69` 的直达声级函数包含三维声程与指向性损失，仅用于声压预估，不能当作到达时间函数。验收：等距且电子延时相同为 0；交换 A/B 且电子延时相同时改变加延时对象但绝对值一致；另加一例已知电子延时抵消声程差；单位正确；无效输入不生成结果/记录；恢复和共享一致。需新建独立计算模块与基准测试，不能改 venue 旧算法。

### 2. 视频无画面排查

首版覆盖无画面、切换后黑屏，复用 `pages/troubleshoot/index.js` 的历史、回退、改答案、反馈和“不确定”分支；`pages/troubleshoot/index.wxml:24-46` 已有对应 UI。结果只给下一检查环节，不自动判定设备坏，也不把用户反馈等同自动诊断。Extron 资料可支持 EDID 不匹配导致无图/切换失图的分支：[EDID 说明](https://www.extron.com/article/uedid)。完成标准是各段正确分支、回退和修改答案后清除旧结果/旧反馈并重新分支，“不确定”可结束当前判断，并在当前页面显示用户选择的“已恢复/仍异常”反馈。实施时复用排查框架，新增视频流程与独立入口图示；本轮仅研究，不改首页。

### 3. 音频接线图解

首版让用户选择两端接口、信号类型、输入/输出角色，显示针脚、连线和正/背面观察方向，只收录逐条核准的常用低电平接法。Shure 资料强调不能只看接头外形，还要核对电平、阻抗和针脚功能：[麦克风接头排障](https://www.shure.com/en-US/insights/why-wont-my-mic-work)。设备未知时提示查说明书；验收逐条核对针脚、方向、信号类型和平衡关系，并区分设备专用接法与通用标准。可复用 `pages/knowledge/detail.js` 的静态图解框架，但需新增可靠端子图示。

## 后续边界

投影快算可参考 Epson 的[投影距离说明](https://files.support.epson.com/docid/cpd6/cpd64932/source/setup/reference/projection_distance_calculator_link.html)，首版输入投射比与画面宽度/投影距离二选一反算，画幅只用于宽高换算；镜头和变焦按厂家有效投射比范围核实，不从摄像机 FOV 偷换参数。LED 发送卡必须以实际像素矩阵和控制器限制建模；NovaStar MCTRL600 的 8 bit/12 bit 差异不能泛化：[官方规格](https://www.novastar.tech/tpl/MCTRL600.html)。啸叫资料可参考 [Shure 反馈排障](https://service.shure.com/articles/en_US/Knowledge/how-do-i-fix-my-feedback-problem)，故障树应分别检查话筒/音箱位置、开麦数量、增益、房间和接地等因素，不能建议抬音量制造啸叫。备份/恢复暂缓，灯光开场检查清单取消，均不作为推荐功能。正式实施前仍需复核资料、算法边界、回归基准和真机限制。
