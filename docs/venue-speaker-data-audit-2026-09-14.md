# 会议室候选音箱资料核对清单

核查日期：2026-09-14

本清单只核对当前会议室自动推荐中的 6 个既有型号，不修改产品参数、推荐范围或计算公式。代码中的旧值来自公司 PDF 导入记录；由于原始目录当前不可访问，本文不把这些内部 PDF 当作本轮重新打开并复核过的文件。

## 结论

- 6 个候选型号都只有整箱标称覆盖角：水平/垂直 `-6 dB` 角度；没有可供程序读取的频率分段水平/垂直极坐标数据。
- 本轮查到的官方型号页面或 PDF 只给出标称覆盖角、灵敏度、功率和最大 SPL 字段；没有型号绑定的极坐标曲线、EASE/GLL 文件、AES75 最大线性声级报告或连续功率最大声压测试条件。
- `rated/peak` 是厂家字段，不能直接改写成 `continuous`、`RMS` 或 AES75 `maximum linear level`。最大声压级的测试信号、频带、失真/压缩停止条件和测量距离仍未核验。
- 现有值可以支持产品资料展示、自由场距离衰减的粗略能力检查和标称覆盖角档位筛选；不能支持真实的频率相关声场预测、房间反射/混响、相位与干涉、STI、PAG/NAG 或现场验收。

## 本地登记与原始文件可访问性

推荐角色清单见 `data/speaker-recommendation-profiles.js`，主扩候选也列在 `docs/speaker-recommendation.md`，补声候选包括 `KS-08AT`、`KF-D10F`、`KF-D12F`。核心功率、阻抗、频率下限和灵敏度在 `data/equipment.js`；覆盖角和最大 SPL 在 `data/speaker-specifications.js`；灵敏度录入原则与来源文件名见 `docs/sensitivity-data-2026-07-10.md`。

产品资料说明登记的公司原始目录为：

```text
C:\Users\wxx\Desktop\E05-专业扩声音箱
```

本轮检查该目录不存在；6 个登记 PDF 的精确路径也均不可访问。项目目录内没有对应 PDF 副本。因此下表中的“原 PDF”是代码/文档登记的文件名与页码，不代表本轮重新读过该文件。

## 6 个候选型号

| 型号/角色 | 旧登记值 | 登记原 PDF | 当前官方 rated/peak 或等价字段 | 差异与待核验口径 |
| --- | --- | --- | --- | --- |
| `KF-D10F` 主扩、补声 | 350 W；8 Ω；55 Hz；101 dB @1W/1m；H/V 100°/90°；`maximumSplDb` 129 dB | `itc产品说明书 KF-D10F中文说明书-V0.2.pdf`，第 2 页 | 官方页面：350 W、峰值 1400 W、101 dB @1W/1m、最大 SPL rated/peak 126/132 dB、H/V 100°/90° | 旧值 129 dB 没有 rated/peak 标签，处于官方两值之间；需拿到对应版本 PDF 确认。官方页：[KF-D10F](https://www.itcprosound.com/product/6726.html) |
| `KF-D12F` 主扩、补声 | 450 W；8 Ω；50 Hz；102 dB @1W/1m；H/V 100°/90°；`maximumSplDb` 132 dB | `itc产品说明书 KF-D12F中文说明书-V0.2.pdf`，第 2 页 | 官方页面：450 W；峰值 1800 W；102 dB @1W/1m；最大 SPL rated/peak 128/134 dB；H/V 100°/90° | 旧值 132 dB 未标明 rated/peak；需确认内部 PDF 版本与官方当前页面是否同一修订。官方页：[KF-D12F](https://www.itcprosound.com/fr/product/10268.html) |
| `KF-D15F` 主扩 | 550 W；峰值 2200 W；8 Ω；45 Hz；103 dB @1W/1m；H/V 100°/90°；`maximumSplDb` 133 dB | `itc产品说明书 KF-D15F中文说明书-V0.6.pdf`，第 2 页 | 官方页面技术规格：550 W；峰值 2200 W；103 dB @1W/1m；最大 SPL rated/peak 130/136 dB；H/V 100°/90° | 旧值 133 dB 未标明口径；官方页面顶部摘要与技术规格的额定功率展示也存在页面字段差异，需以对应 PDF 版本确认。官方页：[KF-D15F](https://www.itcprosound.com/product/6738.html) |
| `KF-D12H` 主扩 | 500 W；8 Ω；55 Hz；105 dB @1W/1m；H/V 70°/60°；`maximumSplDb` 135 dB | `itc产品说明书 KF-D12H中文说明书-V0.2.pdf`，第 2 页 | 官方页面概览：最大 SPL rated/peak 132/138 dB；技术规格另列最大 SPL 135 dB；500 W、105 dB @1W/1m、H/V 70°/60° | 旧值 135 dB 与官方技术规格单值相同，但不能据此判断它是 rated、peak 或其他测试口径；需核对内部 PDF。官方页：[KF-D12H](https://www.itcprosound.com/product/6734.html) |
| `KF-D15H` 主扩 | 600 W；8 Ω；50 Hz；105 dB @1W/1m；H/V 70°/60°；`maximumSplDb` 136 dB | `itc产品说明书 KF-D15H中文说明书-V0.2.pdf`，第 2 页 | 官方 PDF：600 W；峰值 2400 W；105 dB @1W/1m；最大 SPL rated/peak 133/139 dB；H/V 70°/60° | 旧值 136 dB 未标明 rated/peak；需确认内部 PDF 是否为同一版本。官方 PDF：[KF-D15H](https://www.itcprosound.com/wp-content/uploads/2023/12/2023-12-0553.pdf) |
| `KS-08AT` 补声/延时 | 200 W；峰值 800 W；8 Ω；60 Hz；96 dB @1W/1m；H/V 80°/60°；rated/peak 119/125 dB | `itc产品说明书 KS-08AT中文说明书-V0.3@V20240726.pdf`，第 2 页 | 官方 PDF：200 W；峰值 800 W；8 Ω；60 Hz–20 kHz；灵敏度 96 dB；最大 SPL rated/peak 119/125 dB；H/V 80°/60° | 公开 PDF 与旧登记值一致；仍没有连续/最大线性声级测试方法、极坐标或 EASE/GLL 数据。官方 PDF：[KS-08AT](https://www.itctech.com.cn/Public/upload/2024-09-03/1725351947.6284_wm_8962.pdf) |

## 对当前计算的边界

可以使用的内容：

- 用 `sensitivityDb`、额定功率和距离做单只音箱的自由场理论声压级估算。
- 用 H/V 标称 `-6 dB` 角度做几何覆盖角档位筛选和候选布局比较。
- 用明确标注的 rated/peak 字段做资料展示或保守的能力字段比较，但必须保留字段名称和来源版本。

不能由现有资料支持的内容：

- 不能把一个整箱 H/V 角度当成全频段、所有安装姿态和所有听音面都成立的真实指向性。
- 不能推导低频、中频、高频分别的水平/垂直覆盖、偏轴频响或耳高平面有效覆盖。
- 不能把 `maximumSplDb` 或厂家 `peak` 值称为 continuous、RMS、AES75 maximum linear level，不能据此推导功率压缩或长期热稳定余量。
- 不能进行真实房间反射、混响、相位、阵列耦合、补声延时/电平交接、STI 或现场均匀度验收。

这与当前场地模块的既有边界一致：其结果是简化自由场和几何预估，不包含房间反射、真实指向性、相位、补声调试或现场多点测量。后续若要进入真实声场预测，应先为每个型号取得可追溯的频段极坐标数据、测量距离与 `-6 dB` 定义、最大线性声级测试口径以及可被目标预测软件读取的模型文件。
