# 会议室扩声布局参考与当前算法映射

核查日期：2026-09-14。本文只整理本轮实际查到的书目、官方页面、官方摘要或可读预览，并把它们与当前小程序的几何模型分开。没有把任何一条广播监听建议、厂商示例或工程启发式写成会议室扩声通用规范。

## 先看结论与边界

- 会议室布局首先需要真实扬声器的频段指向性、安装高度、听音区几何和实测声压/响应；AES56支持把极坐标数据用于系统预测，MAPP 3D也把观众区覆盖与多位置响应作为两类互补检查。
- EBU Tech 3276及其Supplement 1是广播监听条件文件：它们可帮助说明直达声、早期反射、混响、声道匹配和监听布置的测量对象，但不等于会议扩声摆位规范。Tech 3276官网还提醒，响度归一化后的测量说明应结合[EBU Tech 3343第8.2段](https://tech.ebu.ch/publications/tech3343)核对；本轮未通读Tech 3343。
- AES75测量最大线性声级，不能代替覆盖、清晰度、反馈稳定度或日常讲话电平评估。当前代码中的95/98 dB会议等级没有因本轮海外资料获得证明；国标原表和测量口径仍需另行核对。
- 本轮所读资料没有给出“前置25%/75%”“6/12 dB补声交接”或“圆桌固定4/6/8分区”作为所有会议室通用规则的依据。它们在代码中应继续标为当前模型的规则或启发式，不能写成标准结论。

## 12组参考资料

### 1. Bob McCarthy：系统设计与校准

来源：[Routledge书目页](https://www.routledge.com/Sound-Systems-Design-and-Optimization-Modern-Techniques-and-Tools-for/McCarthy/p/book/9780415731010)；[作者第三版说明](https://bobmccarthy.com/the-third-edition-of-sound-systems-design-and-optimization-is-here/)。

书目：Bob McCarthy，*Sound Systems: Design and Optimization: Modern Techniques and Tools for Sound System Design and Alignment*，第3版，Routledge，2016，ISBN 9780415731010。

阅读范围：出版社页和作者页均为官方页面的检索索引书目信息；可读到简介、目录或第三版说明，但直接抓取受限。目录定位为第4章叠加、第7章预测、第8章变化、第9章组合、第14章校准、第15章应用；未通读正文，不引用具体公式或页码。

对小程序的意义：可作为“预测—组合—校准—现场验证”的工程流程背景。不能直接证明当前固定比例、交接电平或分区数量。

### 2. Davis、Patronis、Brown：Sound System Engineering

来源：[Routledge书目页](https://www.routledge.com/Sound-System-Engineering/Davis-Patronis-Brown/p/book/9780240818467)。

书目：Don Davis、Eugene Patronis、Pat Brown，*Sound System Engineering*，第4版，Routledge，2013，ISBN 9780240818467。

阅读范围：出版社检索索引可核对书目和目录；定位包括第9章指向性/覆盖、第14章声学增益、第15章语音清晰度、第21章延时同步；出版社页面直接抓取受限，未读全文。

对小程序的意义：可用于后续把覆盖、声学增益、清晰度和同步分开建模。当前代码尚未计算PAG/NAG、STI或相位同步，不能借书目把这些指标宣称为已实现。

### 3. EBU Tech 3276及Supplement 1：广播监听条件

来源：[Tech 3276官方页](https://tech.ebu.ch/publications/tech3276)；[Tech 3276 PDF](https://tech.ebu.ch/files/live/sites/tech/files/shared/tech/tech3276.pdf)；[Supplement 1官方页](https://tech.ebu.ch/publications/tech3276s1)；[Supplement 1 PDF](https://tech.ebu.ch/files/live/sites/tech/files/shared/tech/tech3276s1.pdf)。

版本：Tech 3276第2版，1998-05-28；标题为单声道与双声道立体声节目评估监听条件。Supplement 1修订版，2004-05；标题为多声道节目评估监听条件。

原文定位与范围：以下页码统一按文档印刷页码。Tech 3276的Introduction在p.3，明确对象是广播参考监听室和高质量声音控制室；§2.2早期反射在p.5；Appendix 1在pp.9–10讨论监听源与听音位置。Supplement 1的Scope在p.2，限于BS.775-1的5.0/5.1监听；Appendix 1在pp.5–6给出五声道监听安排。

实际可用内容：直达声、早期反射、混响场、操作响应曲线、声道匹配、监听区和时间补偿。对会议扩声只能作为测量对象和边界提醒，不能作为固定摆位、补声位置、分区数量或覆盖百分比依据。

### 4. AES56：扬声器极坐标辐射测量

来源：[AES标准记录](https://aes.org/publications/standards-store/?id=72)；[AES项目状态](https://aes.org/standards/standards-development/project-status/)。

版本：AES56-2008，AES当前项目状态标为r2024；本条以AES项目状态的r2024为当前状态依据。标准全文/预览在本轮未能稳定直接访问，未绕过访问限制。

阅读范围：只核对AES商店摘要和项目状态页的标准范围；未把无法稳定复核的预览摘录当作已读正文，因此不追加章节页码。AES官方摘要说明极坐标数据可用于房间声学、电声和扩声系统预测。

对小程序的意义：支持“先取得真实指向性，再做覆盖预测”的方向；不支持把标称角度直接乘固定系数，也不规定音箱数量、间距、分区或补声交接电平。

### 5. AES75：最大线性声级测量

来源：[AES75官方页](https://aes.org/standards/AES75/)；[官方预览PDF](https://www.aes.org/tmpFiles/aessc/20250520/aes75-2023-i.pdf)。

版本：AES75-2023，2023-04-16打印；标准名称为使用噪声测量扬声器最大线性声级。

阅读范围：摘要位于PDF第3页，目录位于PDF第4页，§0.1 General为印刷p.4（PDF第6页）；目录还列出§4 Setup、§5 Procedure、§6 Reporting及测量技术附录。摘要和§0.1说明使用Music-Noise逐步提高播放电平，直到传递函数幅度或相干性触发停止条件。

对小程序的意义：可用于设备能力和余量核查；不能替代覆盖均匀度、房间反射、语音清晰度、反馈稳定度，也不能把最大能力当作日常讲话电平。

### 6. Boner：反馈前系统增益

来源：[AES官方期刊条目](https://secure.aes.org/forum/pubs/journal/?elib=1600)。

书目：C. Paul Boner、Richard E. Boner，*The Gain of a Sound System*，JAES 17(2)，pp.147–150，1969-04-01。

阅读范围：仅读AES官方摘要和书目信息，全文需购买或会员访问。摘要涉及房间内反馈前系统增益方程、均衡作用和完工系统实验复核。

对小程序的意义：可作为反馈前增益和现场复核的历史依据；不能引用未读正文中的具体公式、图表或阈值，也不支持固定音箱摆位和覆盖比例。

### 7. Meyer Sound MAPP 3D：覆盖与多位置评估

来源：[MAPP 3D用户指南](https://docs.meyersound.com/products/en/user-guide---mapp-3d.html)。

版本/范围：在线用户指南；本轮已读Design reference、Evaluation、Pressure plots、Measurement view、Microphone placement。

阅读要点：设计应看实际观众区，结合频段声压分布与多位置宽带响应/最大输出；两类分析缺一只能算部分分析。平面模型除Ground Plane外几何为声学透明，不能当作完整房间反射仿真。

对小程序的意义：支持把“覆盖图”和“多位置响应/能力”作为两条独立验证线；不移用具体产品阈值，不把其结果直接替代现场测量。

### 8. Meyer Sound Galileo GALAXY：厂商相位/延时示例

来源：[Galileo GALAXY用户指南](https://docs.meyersound.com/products/en/user-guide---galileo-galaxy.html)。

版本/范围：在线用户指南；本轮已读Product integration example相关段落。

阅读要点：示例先匹配产品相位曲线，再在两源等电平交接位置用delay对齐；这是厂商系统集成示例。

对小程序的意义：说明交接验证不能只看距离或声压，还要看时延、相位和交接位置；不能推成任意系统单一测点全场最优规则。

### 9. Yamaha CISSCA：指向性角与安装倾角

来源：[Yamaha Speaker System Design Points](https://usa.yamaha.com/products/proaudio/software/commercial_installation_solutions_speaker_calculator/index.html)。

版本/范围：Yamaha商业安装扬声器计算器的设计要点；本轮已读标称角、耳高平面有效角和壁挂倾角相关说明。

阅读要点：等距测量的标称-6 dB角与耳高平面有效-6 dB角可能不同，后者常较小；轴向远排和近排偏轴衰减会影响壁挂倾角。

对小程序的意义：应结合真实指向性曲线和耳高平面检查；不能把70–80%当所有型号通用系数，也不能直接推固定圈数。

### 10. Shure PAG/NAG与天花阵列话筒分区

来源：[PAG/NAG计算器](https://www.shure.com/en-US/support/tools/pag-nag-calculator)；[天花阵列话筒性能说明](https://www.shure.com/en-ASIA/insights/how-to-get-the-best-performance-from-ceiling-array-microphones)。

版本/范围：在线公式说明与2017-12-12产品技术文章；本轮已读距离、NOM定义和Voice Lift Variations段。

阅读要点：PAG/NAG依赖话筒、扬声器、说话人、座席相对位置和开放话筒数，基础模型假设全向；Voice Lift示例建议把某侧话筒送向较远/对侧扬声器以降低邻近反馈风险。

对小程序的意义：后续围桌语音提升可接入话筒位置、开放话筒数和Mix-Minus路由；产品示例不能证明固定4/6/8分区，也不能宣称实际必不啸叫。

### 11. IEC 60268-16：STI测量/预测方法

来源：[IEC Webstore官方页](https://webstore.iec.ch/en/publication/26771)。

版本：IEC 60268-16:2020，第5版；页面说明已并入2025-07勘误。全文为付费标准，本轮只读官方范围和版本信息，未读正文。

对小程序的意义：STI应作为测量/预测方法单独接入，不能把标准本身改写成“所有会议必须达到某个统一数值”；当前代码未计算STI。

### 12. JBL Professional：自由场逆平方定律

来源：[JBL Professional System Design Tools](https://jblpro.com/fr/tools/calculators)。

版本/范围：在线计算器中的Inverse Square Law段；本轮已读其自由场点声源距离关系说明。

对小程序的意义：支持自由场近似下的点声源距离损失，即距离加倍约下降6 dB；不能代替房间反射、指向性、阵列耦合或现场声学测量。

## 当前算法对照

在基础几何中，向下声源与平行耳高平面条件下，`R = h × tan(θ / 2)` 是圆锥几何半径；`h` 为音箱声学中心与听音耳高之间的高度差，`θ` 为采用的几何覆盖角。它只给出几何参考半径，不保证声学上的 -6 dB 有效覆盖。

### 当前实现与本轮复核

| 当前方法 | 文献能支持到哪里 | 验证边界 |
| --- | --- | --- |
| `utils/venue-plan.js`按声程、参考声级和等向距离衰减估算各源声级，再做能量叠加。 | JBL支持自由场点声源距离衰减；AES56提供极坐标测量方法/范围。 | 真实指向性、频率响应、房间反射、相位和阵列耦合。 |
| `utils/venue.js`在 6 组有限对称前置候选中选择位置与姿态；`utils/venue-plan.js`使用选择后的源位置，按 raw H/V 几何需求和真实 3D 声程完成计划与报告投影。 | MAPP 3D支持按观众区和多位置响应评估；Yamaha说明标称角与耳高平面有效角可能不同。 | 用真实三维指向性、频段响应和多位置声压/响应比较候选布局。 |
| `utils/venue-plan.js`当前仍使用 `REFERENCE_WIDTH_RATIOS=[0.25,0.5,0.75]`、`MAIN_TARGET_OFFSET_DB=3`、`FILL_TARGET_OFFSET_DB=-1` 做等向距离参考归一化。它们是当前声级示意的启发式，不是主扩坐标固定比例，也不是实际 DSP 电平。 | MAPP 3D支持按观众区和多位置响应评估；本轮资料没有证明这些归一化偏移为通用工程规则。 | 用真实电平、指向性和现场多位置响应复核；本轮未修改这些启发式。 |
| `utils/venue.js`按主扩直达声相对首排衰减 6/12 dB 的声程，反推补声安装位置；数值指主扩距离衰减。 | Galileo 示例支持在等电平交接位置校准延时/相位；本轮资料没有规定这些固定安装位置。 | 现场电平、时延、相位、交接位置和全场均匀度。 |
| 本轮补声传播复核复用既有 plan 的补声位置、源姿态和 `aimDepth` 参考排，在横向 `1/4`、`1/2`、`3/4` 三点内，从共同标称 H/V 包络分别选前级（主扩+更靠前补声）和当前补声的最近参考源，并记录源标签。 | Galileo 示例支持在等电平交接位置校准延时/相位；Yamaha table 502 将声传播与 A/D、网络、DSP、D/A 时延分开列出。 | 实际 DSP 延时、电平、相位、电子处理延时和现场多点测量；无共同几何范围不输出 `deltaMs`。 |
| `utils/venue-discussion.js`圆桌按直径采用4/6/8个分区候选。 | Shure PAG/NAG支持结合话筒、扬声器、座席和开放话筒数分析，并给出Mix-Minus示例。 | 接入话筒位置、开放话筒数、PAG/NAG、Mix-Minus和实测清晰度。 |
| 当前结果未建模频率、相位、反射、混响、传声增益或STI。 | MAPP的多位置响应、IEC 60268-16的STI方法说明了后续验证方向。 | 可信预测用于设计复核；工程验收须按适用标准现场测量。 |

补声传播复核的固定换算为：

```text
deltaMs = (d_front - d_fill) / 343 × 1000
```

正值表示补声先到，负值表示补声后到。343 m/s 是没有温度输入的固定参考假设，只表示声程差，不表示实际主导声源、等电平位置、总到达时间或 `coverageEndDepth` 声传播截止。方法、样例和验证栏见 [`venue-handoff-review-2026-09-14.md`](venue-handoff-review-2026-09-14.md)。

### 先前审查历史（非当前实现）

下表保留早期审查时的文字和文献证据范围，便于追溯；其中规则已经删除或不再作为当前算法依据，不能据此解释当前结果。当前布局定义和验收边界以 [`venue-layout-validation-2026-09-14.md`](venue-layout-validation-2026-09-14.md) 及本轮 [`venue-handoff-review-2026-09-14.md`](venue-handoff-review-2026-09-14.md) 为准。

| 先前审查历史 | 当时资料能支持到哪里 | 当前处理 |
| --- | --- | --- |
| 旧方向衰减模型：超出水平/垂直半角后按每度 `0.5 dB` 计算，水平项和垂直项各自封顶 `18 dB`。 | Yamaha说明标称角与耳高平面有效角可能不同；AES56提供极坐标测量方法/范围，但不规定该固定斜率或封顶。 | 已删除；不把 `0.5 dB/degree` 当作当前方向性结论。 |
| 旧报告曾把主扩坐标固定在前置 `25%/75%` 位置。 | 本轮资料没有把这两个坐标比例规定为会议室通用摆位标准。 | 该坐标规则已由 6 组有限对称候选替代；当前等向参考归一化仍保留 `0.25/0.5/0.75` 宽度参考线及 `+3/-1 dB` 启发式，见上方当前实现。 |
| 旧围桌数量估算使用 `max(1.75R, 1 m)` 作为参考间距。 | Shure PAG/NAG可支持按话筒、扬声器、座席与开放话筒数分析；不支持该固定 `1.75R` 规则。 | 已删除；不把 `1.75R` 当当前物理最低间距或覆盖结论。 |

### 本次理想模型推导

依据第9条 Yamaha 对覆盖角的定义和第12条 JBL 对自由场距离衰减的说明，设耳高差 `h = 1.8 m`，某频段单源标称覆盖90°，等距离下边界±45°为 -6 dB：

1. 几何半径：`R = h × tan(45°) = 1.8 m`。
2. 边界声程：`sqrt(1.8² + 1.8²) ≈ 2.546 m`。
3. 相对正下方1.8 m的额外距离损失：`20 × log10(2.546 / 1.8) ≈ 3.01 dB`。
4. 理想点声源模型的耳高平面边界相对正下方：`-6 - 3.01 = -9.01 dB`。

该例只说明几何与点声源模型的关系，不是某个型号的实测，不是建议简单把标称角度乘固定系数，也没有包含房间反射、频率变化、相位或阵列耦合。

## 后续研究优先级

1. 先收集真实扬声器的频段指向性、测量距离、-6 dB口径、最大线性声级和安装姿态。
2. 将真实指向性与三维声程共同用于听音平面有效覆盖检查，再比较候选布局。
3. 对补声交接补做时延、电平、相位和交接位置验证。
4. 围桌语音提升补入PAG/NAG输入、Mix-Minus路由与现场清晰度测量；再评估是否接入STI。

本研究文档保留上述书目与证据范围；本轮补声传播复核已在源码实现并完成发布回归，产品数据、版本 `5.0.0` 和存储语义未改。回归证据不等同于微信真机、厂家预测软件、真实极坐标模型或现场声学验证；实际 DSP 延时、电平、相位、电子处理延时和原始音箱资料口径仍需现场或资料复核。
