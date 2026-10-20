# TuneBuddy P2 Jev Protocol V2 — 设计稿

**状态：待人工评审。** 本文是协议设计稿，不是冻结的 Protocol V2，也不是 Run 2 授权。

## 范围与不可变边界

- 依据已冻结的 V2.1 ground truth、Protocol V1、Run 1 原始输出和 Run 1 人工裁定，提出如何修订下一版评测契约。
- 不改写 V1/V2/V2.1、Run 1 原始响应与指标、人工裁定、生产代码或 P2 安全基线。
- 不调用 Jev，不执行反事实推理，不启动 Run 2，不提交。
- 设计目标是让评测问题准确表达 TuneBuddy 的字段含义和当前操作要求；Jev 输出仍是待测判断，不是工程真值。
- 任何 ground truth 修订必须另行人工审查、冻结并给出新哈希；不得因某项 V2 设计意见自动覆盖 V2.1。

## 证据基线

| 项目 | 冻结值/位置 |
|---|---|
| Ground truth | commit `1e843d63f7d3c94770be690af58f616382ed7f53`；V2.1 SHA-256 `b4f7c2de6036c0dee0c1d00bdde5c7158baad18d5bebb9dd9e045c4e9a618c00` |
| Protocol V1 | commit `1cdd53d5fedeccd5052c91ef0342f85ad54de5f5`；SHA-256 `13378af75e069d6e6f74185bf1268bb5e9d96597138584a057c97d8454aade8b` |
| Run 1 | 原始记录：`tests/p2-jev/benchmark-v1/runs/run-1/`；分析与裁定：`tests/p2-jev/benchmark-v1/analysis/` |
| 高置信度人工裁定 | `tests/p2-jev/benchmark-v1/analysis/human-adjudication-run-1/high-confidence-adjudication-summary.md`，31 个判断项 |
| 澄清假阴性裁定 | `tests/p2-jev/benchmark-v1/analysis/human-adjudication-run-1/clarification-false-negative-adjudication-summary.md`，14 个判断项 |
| P2 安全边界证据 | `tests/p2-safety/acceptance/review-summary.md` |

## V1 的实际问题措辞

Run 1 的请求构造见 `tests/p2-jev/benchmark-v1/common.cjs`：

- routing/意图问题使用中性工具清单和原话；`intent_ambiguous` 的定义是“Does the utterance leave the requested intent materially ambiguous?”（约第 28 行）。
- `user_present` 问：“Is {parameter} explicitly provided by the user in the utterance? Invalid explicit candidates count as present; catalog values, defaults, and derived values do not.”（约第 59 行）。
- `validity` 问：“Is the currently available information for {parameter} valid under the generic domain and constraints in context? Consider explicit, catalog, documented-default, and derived information that is available. Choose unknown only when validity cannot be determined.”（约第 60 行）。
- `sufficient` 问：“Is the current information for {parameter} usable for this parameter in the requested operation? Judge this parameter alone; do not decide whether the whole request is ready.”（约第 61 行）。
- context 的参数定义大多只是字段名。例如 `gain_structure.input_stage_type` 是“输入级类型”（`tests/p2-jev/benchmark-v1/context.json:345`），`camera_fov.scene_type` 是“场景类型”（同文件第 429 行），`led_screen.assembly_unit` 是“拼装单元”（第 492 行），`project_wiring.build_type` 是“制作方式”（第 579 行）。这些没有给出分类边界或词语映射。
- V1 已有有用的一般规则，包括：明确无效候选仍算 present；catalog/default/derived 不算用户显式输入；validity 单独判断；sufficiency 参数局部；明确解决冲突后可继续；不可静默假定 LED 单元尺寸；相机 DFOV+宽高比可导出 HFOV。Protocol V2 应保留并归并这些规则，避免复制出互相冲突的版本。见同文件 `generic_rules` 与 `catalog_facts`。

V1 的主要缺口不是没有任何规则，而是一般措辞缺少 TuneBuddy 具体字段契约，且“参数能否用于当前操作”与“该参数是否适用于/决定当前目标操作”容易被读成一个判断。

## 1. Run 1 发现矩阵

以下每一行都是建议的协议/字段定义修订依据。Run 1 分数与 V2.1 标签保持原样；“建议语义”只用于下一版设计和后续人工冻结。

| 发现项 | Run 1 case / judgment | V1 定义或提问 | 观察与人工裁定 | 所属类别与责任 | V2 建议语义 |
|---|---|---|---|---|---|
| 增益结构输入级类型分类 | 15 项：GAIN-002–010；V2-AUD-002、V2-AUD-008、V2-AUD-011；presence/validity | 仅“输入级类型”；validity 要求按 context 中 generic domain 判断，见 `common.cjs` 第 60 行 | 明确出现“电压增益”“电压增益档”“电压增益模式”“Gain”“输入灵敏度”“Input Sensitivity”仍被高置信度判 unknown 或 presence=false。输入值的未知、范围、冲突污染了类型判断。15 项均裁为 CONTEXT INSUFFICIENT，LOW。成员详见高置信度总结的 GAIN 集群。 | CONTEXT；缺 TuneBuddy 字段契约上下文，不据此推断模型欠缺 AV 知识。 | 给出有限、清楚的 type 分类和中英词语映射；将 type 与 value 分开判。已明确类型不因 value 缺失/冲突而变成未提供或无效。 |
| 输入级类型与电平单位边界 | V2-AUD-001/002 配对；V2-AUD-003/004/008；GAIN-006 等 | V1 只有“输入级类型/数值”，通用单位语义不足以解决类型和值的耦合。 | 人审确认 -10 dBu≈0.245 Vrms、-10 dBV≈0.316 Vrms；dBu/dBV/dBFS 不可互换。dBFS 不是模拟灵敏度的电压参考；775 mV 的原用户表示需保留。 | PARAMETER DEFINITION / CONTEXT；值的参考域需成为字段契约。 | type 表达“电压增益”或“输入灵敏度”；value 保留原始数值和单位；V、mV、dBu、dBV 是不同值表示，dBFS 属数字满刻度域，不可因负号相似而混为模拟电压。数值换算属于确定性工程代码，不交给 Jev。 |
| LED 拼装类别与物理尺寸 | 5 项：LED-002 validity+sufficiency；LED-008 presence+validity+sufficiency | 仅“拼装单元”；宽高虽是另字段，但 context 未解释其边界。 | “常规箱体”/“箱体”是类别信息；单元宽高缺失是另一字段。比例冲突不应污染 assembly_unit 自身判断。无隐藏 cabinet 尺寸默认。5 项均 CONTEXT INSUFFICIENT、LOW。 | CONTEXT；类别/尺寸字段契约未说清。 | 将 assembly_unit 定义为类别；`assembly_unit_width_mm` 和 `assembly_unit_height_mm` 表示具体物理规格。类别值本身可有效且参数局部完整，但操作仍可能因尺寸字段缺失而阻塞。禁止从“常规箱体”推定 500×500 或任意默认尺寸。 |
| project_wiring 制作方式 taxonomy | 3 项：PW-004 validity；PW-010 presence+validity | 仅“制作方式”，未给有效分类和中英表达。 | “one finished speaker cable”与“3 条散线”明确表达制作方式；它们有效，即使 cable type/spec/每条长度另缺。3 项 CONTEXT INSUFFICIENT、LOW。 | CONTEXT；缺少接受值分类/词映射。 | build_type 单独表示成品线/预制线、散线等线路交付/制作形式；与 cable_type、cable_spec、connector、length、line_count 分离。其他字段缺失不得反向否定 build_type。 |
| Camera scene_type 场景解释 | 3 项：CAM-002、CAM-007、CAM-010；scene_type presence | 仅“场景类型”。 | “背景屏”“完整地面区域”“一面墙”按 TuneBuddy V1 ground truth 约定提供场景/覆盖目标类别，但 Jev 三次都判未提供。人审认定同一字段解释集群，非三个孤立错误；PARAMETER DEFINITION MISUNDERSTANDING、LOW。 | PARAMETER DEFINITION；字段对“覆盖目标类型”的约定需要显式说明。 | 给出 scene_type 是相机覆盖目标/场景类别的定义和核验过的典型表达；同时明确单有故事背景或无关对象不一定提供该字段，避免过度扩展为任何名词都算场景。 |
| 近邻字段不得互相代答：声道 | AW-002 destination_channel presence | 字段名仅“目标声道”；presence 问只检查原话是否明确提供该字段。 | “我只要左声道”描述源声道；单 RCA 输入没有明确命名目标声道。Jev 把 source 当 destination；人审判为 PARAMETER DEFINITION MISUNDERSTANDING、LOW。 | PARAMETER DEFINITION。 | source_channel 与 destination_channel 用方向性定义和成对反例；源端选项不得填入目标端字段，单个接头也不自动创建明确声道标签。 |
| 近邻字段不得互相代答：线材 | CROSS-006 project_wiring.cable_type validity | “线材类型”与“线材规格”虽分开字段，V1 没解释语义边界。 | “扬声器线”是有效 cable_type；缺少 cable_spec 不能使 cable_type unknown。人审判为 PARAMETER DEFINITION MISUNDERSTANDING、LOW。 | PARAMETER DEFINITION。 | 明示线材应用类型、导体规格/线径、接头类型、制作方式是不同维度；只对请求判断当前字段。 |
| Routing 中 unclear / prerequisite | CROSS-002 routing；CROSS-006 routing | V1 `unclear` 的中性定义原文是 “Available wording does not identify a reliable task.”；`multiple` 原文要求 “Two or more distinct, independently actionable supported operations…”，见 `context.json` routing_options。 | CROSS-002“给它配一台摄像机，帮我算下方案”能确定摄像机领域，却不能判定是选型还是 FOV 几何；Jev过早选 camera_fov。人审确认意图不明。CROSS-006明确先选线缆、后录项目，先决步骤应优先。一个 ROUTING POLICY MISUNDERSTANDING、MEDIUM。 | PROTOCOL / routing policy。 | 作为V2政策提案：domain classification不等于operation classification；若原话不能唯一选操作，保留 unclear；依赖任务选先决可执行操作，独立多任务才multiple。 |
| catalog-resolved validity | CAM-009 `camera_fov.focal_length_mm` validity | V1 validity明确允许考虑catalog信息。`context.json` 的 `catalog_facts` 是数组；TS-0663JS的 `record.views[0].focalWideMm` 为7.2（第3380–3391行）。 | 请求给出唯一型号；中性目录提供该主镜头焦距。V2.1标UNKNOWN，Jev选VALID。人审A/B均NO，判GROUND TRUTH ISSUE、MEDIUM；这是标签与获准来源规则不一致。 | GROUND TRUTH；未来需单独 adjudicate V2.1，不能用protocol修订悄悄重写真值。 | 对操作允许且型号/视角记录唯一、适用的catalog resolve，可判valid而user_present=false；多视角/焦距档、实际档位未知或用户冲突时不可解析。需先审批标签更正并审计其他catalog-resolved validity标签。 |
| 参数 sufficiency 与操作作用混淆 | LED-010 `brightness_nit` 与 `nearest_viewing_distance` | V1 提问为“当前信息对该参数在请求操作中是否可用；只判断参数本身，不判断整个请求是否准备好”。 | 2500 nit亮度自身完整有效且与屏体相关，但该pitch操作不消费亮度作决定值；最近观看距离才被该操作消费且缺失会阻塞。V2.1 `sufficient=false`不能表示这两种关系。A/B均NO，BENCHMARK / PROTOCOL ISSUE、MEDIUM。 | PROTOCOL；另需独立审计ground-truth字段语义，但本轮不改标签。 | 新增parameter completeness、operation applicability、operation consumed和operation blocking；LED-010两字段的六维状态见§2，不将相关性、实际消费、完整性或阻塞混成一个标签。 |

### 14 项澄清假阴性提供的合同证据

它们是独立于 31 项高置信度分歧的人工审查。14 项均判 V2.1 的 clarification ground truth 正确且 Jev 的“无需澄清”错误：8 MODEL SEMANTIC ERROR、5 CONTEXT INSUFFICIENT、1 PARAMETER DEFINITION MISUNDERSTANDING；均为 MEDIUM。此处用它们设计操作合同，不据此重算分数。

| case | 遗漏的操作合同 / 人审原因 | V2 应明确的规则 |
|---|---|---|
| AW-007 | 3.5 mm stereo source 未说明选择左/右/安全合并方式；模型语义错误。确定性保护为 PARTIAL。 | 需要明确的声道/合并操作选择；不可默认丢声道或直并 L/R。 |
| CAB-008 | 250–400 W 功率档范围跨潜在线缆选择边界；context 未包含生产的功率 bracket 规则。 | 将完整范围与单一值区分；只在合同允许端点/最坏情况评估且规则已公开时免追问，否则阻塞。不要让模型自行发明档位。 |
| CAM-007 | 完整地面区/自动高度要垂直几何；水平 HFOV 不能替代 VFOV；production coverage protection为 PARTIAL。 | 操作模式合同：horizontal-only 可以不要求 VFOV；full-ground-area 要 VFOV 或已支持的可信导出路径。 |
| DMX-004 | D001 地址语义不明；未经规则不能擅自解析 Universe D。确定性整数 1–512 检查确实阻塞原 token。 | 起始地址与 Universe 分开；未经批准的前缀语法不得猜测或纠正。 |
| DMX-006 | A01O 无效地址，Universe也缺失；production deterministic check阻塞。 | 保留原文，invalid address不推断 Universe A，不静默纠错。 |
| DMX-010 | TL-SL333 有 3CH/6CH 两个 mode，mode 缺失仍使用 profile.modes[0] 生成表。 | mode-specific guide 要当前明确 mode；仅产品目录知识查询应路由 `knowledge`（V2产品规则已确认）；不能将首个 catalog mode 当默认。 |
| LED-001/003/005/006 | category/physical unit missing；有效 page/current/default unitKey 可让 core接受。 | sizing/layout合同列出必要墙面与物理单元规格；UI合法默认不表示当前请求已确认。类别名不能满足宽高。 |
| PW-007 | 设备明确但端口缺失。已查 saveLine/validateLine 双重阻塞；无 port default。 | 新线记录需源/目标设备与各自端口；原始缺项阻塞。模型不得猜端口。 |
| V2-AUD-005/006/007 | last-row distance≠room length；listening width≠room width；planar dims≠room height。页面有效 fallback 12/8/4可被 core接受。 | venue report合同显式要求 room L/W/H；各种座位/听音数据不得替代房间几何；页面状态不是当前请求事实。 |

“IMPLICIT_DEFAULT_ESCAPE”端到端验证后来将 CAM-007、三个 Venue 案例、四个 LED 案例与 DMX-010列为9个已验证样例；三个 blocked controls 是 DMX-004、DMX-006、PW-007。AW-007/CAB-008仍 UNVERIFIED。详情与边界见 `tests/p2-safety/acceptance/review-summary.md`。这些生产结果不能进入 V1/Run1的提示或重算模型标签，只支持 V2设计中的操作合同来源。

## 2. V2 判定本体草案

每个相关参数应分开判断参数自己的状态与它对本次操作的作用。避免继续将 V1 的 `sufficient` 同时承担多个含义。

| 维度 | Jev 原子类型 | 建议判定问题 | 典型值/含义 |
|---|---|---|---|
| `presence` | Noul | 用户原话是否明确提及这个参数候选？ | true / false。用户明确给出的无效值仍present；catalog、default、derived不算用户提供。 |
| `validity` | Choice | 当前可用证据能否判定候选值符合TuneBuddy规则？ | valid / invalid / unknown。需指明适用来源；unknown仅在证据不足时用。 |
| `parameter_completeness` | Noul | 这个参数本身的信息形状、单位、语义角色及候选值是否完整？ | true / false。只评字段局部完整性，不由其他字段或整个操作是否可执行决定。 |
| `operation_applicability` | Noul | 该参数是否与当前operation相关，或可作为该operation的约束/信息？ | true / false。含义不是“该参数被计算/决策实际消费”，也不是“单独足以决定结果”。仅对已冻结合同评分。 |
| `operation_consumed` | Noul | 冻结合同定义的当前operation是否实际将该参数作为计算输入、决策依据或约束来消费？ | true / false。与applicability独立；若contract未冻结则unscored。 |
| `operation_blocking` | Noul | 在当前冻结operation contract下，这项未解决状态是否阻止所请求操作？ | true / false。仅当operation可识别且合同已冻结时评分；参数不完整本身不自动等于block。 |
| `contract_status` | 协议元数据（非Jev判断） | 当前operation的产品/工程合同是否已在人审后冻结？ | `frozen` / `unscored`。由协议维护者设置，不交给Jev推断。 |
| `intent_ambiguous` | Noul | 用户意图是否不能唯一选择操作/路由？ | 独立概率；参数缺失不等于意图模糊。 |
| `clarification_required` | Noul | 执行目标operation前是否必须向用户追问？ | 独立概率，由意图歧义或明确的operation blocker决定。 |

上述Noul/Choice类型是建议的新原子评分定义，尚需人工批准后才能进入冻结协议。参数形状采用紧凑合同：冻结参数合同中的`value_shape`声明字段允许/要求的形状，可取`scalar`、`range`、`enum`、`candidate_set`、`boolean`或`structured`；原话观测到的形状另记`observed_value_shape`。合同形状与话语候选形状不可混为一谈。`parameter_completeness`仅比较该参数自己的信息与已冻结字段形状/单位/角色要求：例如一个要求scalar的输入灵敏度只有1 V和2 V两个未决候选，观测形状是candidate_set、完整性false；NOM字段若允许range，明确NOM=1–3可完整性true；0 V是明确scalar故完整性true但validity=invalid。若字段合同`value_shape=scalar`，用户明确确认当前实际输入灵敏度为1 V时，在TuneBuddy正常规则判该值合法的前提下，可标`presence=true`、`validity=valid`、`parameter_completeness=true`。不要因0 V无效把完整性判缺失，也不要因两个各自有效的候选把一个单值字段判完整。

只有operation已识别且其合同已冻结时，才评分`operation_applicability`、`operation_consumed`、`operation_blocking`及合同依赖的澄清判断。状态为`unscored`时不发这些判断或不纳入评分，绝不能编码成false。若字段定义已冻结，presence、字段局部validity和parameter_completeness仍可评分。来源可作为validity上下文中的事实来源（user、catalog、documented_default、derived），但不得混成presence。V2不需要复杂provenance ontology；产品运行时状态安全不是Jev分类器的评分目标。

LED-010两参数的建议六维标签（顺序：presence、validity、parameter_completeness、operation_applicability、operation_consumed、operation_blocking）：`led_screen.brightness_nit` = `true / valid / true / true / false / false`；`led_screen.nearest_viewing_distance_m` = `false / unknown / false / true / true / true`。观看距离的`operation_consumed=true`表示冻结合同会在该操作中消费这个字段（若有值）；当前缺失不改变字段的消费角色。亮度确与请求相关，但pitch操作不消费它作决定值；缺少被消费的最近观看距离才阻塞。两个字段判断均不等同于整个operation的clarification结果。若对应operation合同未冻结，后三项合同依赖判断及合同依赖的clarification改为`unscored`，不得将其解释为false。

完整性与合法性也独立：0 V输入灵敏度是明确标量，故可`presence=true`、`parameter_completeness=true`，但`validity=invalid`；若冻结合同消费且要求此值，则operation blocking=true。对现场值未确定的1 V/2 V候选，每个候选值各自可能valid，但若字段合同要求唯一scalar，候选集合的`parameter_completeness=false`；其是否阻塞仍由冻结operation contract决定。明确NOM=1–3在字段合同允许range时可`parameter_completeness=true`。不得用validity替代完整性，或反过来。

推荐推理关系：

```text
原话 ──> 参数 presence + 候选值/语义角色
证据和已知规则 ──> validity + parameter_completeness
冻结且已识别的 operation contract + applicability/consumed + 未解决 blockers
             └──> clarification_required
用户动作/操作意图 ──> intent_ambiguous / route
```

二元指标应按各维度独立统计。不要把 parameter_completeness 的 false 自动计为 clarification_required=true；也不要把一个不适用字段当作全请求不完整。`operation_applicability=true`不蕴含`operation_consumed=true`，后者也不自动蕴含operation blocking。

## 3. 重点参数字段定义草案

### gain_structure

- `input_stage_type`: 电平处理路径类别，建议至少区分 `voltage_gain` 与 `input_sensitivity`。
- `voltage_gain` 可识别表达：电压增益、电压增益档、电压增益模式、Gain（仅当本句语境明确是该控制）。
- `input_sensitivity` 可识别表达：输入灵敏度、输入灵敏度档、Input Sensitivity。
- `input_stage_value` 单独保存候选数值/单位。明确提到“电压增益模式，但我忘了档位”时 type present/valid，value absent/incomplete。
- 数值单位必须保留 reference domain：V/mV、dBu、dBV、dBFS不能折叠成泛“dB”。数值之间确定性换算不属 Jev 评分。
- 目录候选有多个档位时不能推断现场实际档位；明确表达范围、未查清或冲突时只评 value，不反向否定 type。

### led_screen

- `assembly_unit`: 类别，例如“箱体”“模组拼”；类别不承载毫米规格。
- `assembly_unit_width_mm` 与 `assembly_unit_height_mm`: 当前选用的具体物理规格；明确型号/目录解析仅在适用、唯一且 operation允许时使用。
- 不存在“常规箱体”隐含 500×500，亦不存在“模组拼”隐含 320×160的产品规则。UI当前选择或历史偏好也不是本次用户确认。
- 比例冲突只对 aspect_ratio和相关 layout blocker 生效，不能污染 assembly_unit 的 presence/validity/completeness。

### project_wiring

- `build_type`: 成品/预制线路或现场散线等制作/交付形态；认可表达应由 TuneBuddy字段契约审批后列出。
- `cable_type`: 线材用途/类别，例如扬声器线。
- `cable_spec`: 线规/规格；不得因缺规格而判“扬声器线”无效。
- `length_m`: 单条线路长度；汇总材料用量不得被当作每条长度，也不得擅自除以 line_count。
- 端口字段按端点分别判断；设备名不能推定端口。

### camera_fov

- `scene_type`: 相机请求要覆盖/拍摄的对象或区域类别，例如背景屏、墙面目标、完整地面区域；是否明确提供由句中场景角色判断，不根据“有个名词”宽松填充。
- `hfov_deg`, `vfov_deg`, `dfov_deg` 不能混用。DFOV本身不能唯一给出HFOV；HFOV可以直接提供，或在DFOV加足够aspect ratio/equivalent geometry下导出。既有审查同意物理 sensor宽高+焦距可理论导出轴向视角，但不表示通过真实安装高度验证。
- horizontal-only coverage合同不要求VFOV；full-area/automatic-height合同需要垂直几何或当前工具明确支持的推导信息。不能从默认页面角度补充当用户事实。
- CAM-009 catalog焦距有效性作为独立真值审查项，不在此把固定镜头目录值推广到变焦/多档型号。

### 其他确定性字段契约

- audio_wiring: source_channel和destination_channel分别判断；用户要求cold-end-to-shield不代表设备许可已确认。
- cable / power: range-valued power只有在工具合同明确支持端点/保守计算时方可直接操作；否则需明确阻塞，而非猜一个标量。
- venue: report模式的房间长度、宽度、高度分别是房间几何，last-row distance或listening-area width不可代替。
- DMX: fixture mode与fixture model分开。多模式型号的 channel-guide请求要明确mode；fixture功能表/手册查询是knowledge，而地址分配才是dmx_address。

## 4. 操作级中性合同草案

下列合同是请求上下文设计建议，不是冻结的生产API或新算法。每个operation在协议中须显式有`contract_status=frozen|unscored`。本文表格目前均为草案；除文中点名的人审确认规则外，其余必需字段、默认、回退、value_shape、consumed字段及条件都待人工核定。`unscored`时不发送或评分operation_applicability、operation_consumed、operation_blocking及合同依赖的clarification；这些状态不是false。若参数字段自身定义已冻结，presence、字段局部validity和parameter_completeness仍可独立评分。V2冻结前须产品/工程逐条核验，不能把V2.1 case annotation自动当作生产operation contract，也不能补造默认。

| Tool / operation | 操作必需信息（条件适用时） | 非阻塞/可选信息 | 关键阻塞与禁止推断 |
|---|---|---|---|
| camera_fov / horizontal-only | 按正算/反算的具体合同待核定目标宽度/距离等；HFOV可直接给出，或DFOV加足够aspect ratio/equivalent geometry推导（人工审查已确认DFOV本身不足、aspect ratio可充分） | VFOV及垂直几何不属于水平单轴请求要求（V2.1已审案例） | DFOV alone不能确定HFOV；不要用页默认VFOV。其余字段条件冻结前按具体生产入口确认。 |
| camera_fov / full-area或automatic-height | 地面区域、HFOV/VFOV或获准轴向推导、高度/目标条件；准确required集合需按现有生产模式逐项人审核定 | 与本模式无关的安装字段不追问 | 人审已确认不得把full-area静默降为horizontal-only；不新增光学算法或默认。 |
| gain_structure / voltage gain | 输入类型、当前增益值、适用功放型号/模式/负载（按具体计算合同） | 已文档化的target peak操作默认-6 dBFS可按其合同使用并披露；它是TuneBuddy commissioning recommendation，不是通用行业标准 | 多个增益档、值不明或冲突不得选档；不能让值的不确定性使明确类型变unknown。 |
| gain_structure / input sensitivity | 输入类型和值；单位参考必须保留；目标peak可按已批准文档默认处理并披露 | 负载仅当具体路径需要 | dBu/dBV是不同模拟参考；dBFS不可替换为模拟V/dBu/dBV。 |
| venue / report | 当前生产core校验room L/W/H、first-listening distance、standard class与grade；将这些作为自然语言operation blockers及要求当前请求/确认来源，需按产品契约人审冻结 | `lastListeningDistance`省略时production core采用当前场地depth；`listeningWidth`省略时采用front width（`utils/venue.js` 约第 433–466 行）。是否允许这两条现有确定性回退满足benchmark operation contract须先人审。 | 目前没有已批准的`target_grade` documented default。V2.1 rubric把report末排列为required，但production core存在depth fallback；两处规则有张力，冻结前须确认，不能将last row概称为一概必需。页面12/8/4不是当前请求事实。 |
| venue / discussion | 需按V2.1及生产入口核验桌型/尺寸、人数、安装条件和room geometry；具体必需集合在V2冻结前人工确认 | 未核验的mode fixed/default规则暂不写成approved default | 当前只有经核验的合同项才能判block；不要从页面状态补值。 |
| venue / PAG-NAG | DS/D0/Dn/D1/D2、NOM、PAG/NAG mode的具体字段契约按V2.1与生产入口核验后再冻结 | 已审定NOM范围可按批准的端点规则评估；生产parser当前收scalar，不得声称接收range object | 其余未核验要求标为待产品/工程审定，不新增默认或必填规则。 |
| led_screen / sizing-layout | 墙面尺寸和具体操作需要的字段集合须按现有工具入口核定；人审已确认类别名不能替代具体单元尺寸 | 仅有正式文档、经人审确认适用于该operation的默认才可披露；本范围没有“常规箱体”隐藏尺寸默认 | 人审确认类别名不补宽高；不得用UI/persisted unit selection伪装确认。点间距自动推荐条件字段须按实际规则核定。 |
| led_screen / pitch recommendation | 最近观看距离是关键条件；若用户明确要求“按亮度选点间距”，亮度不能替代观看距离，也不能单独决定pitch | brightness可完整、有效且与请求相关，但不能单独决定pixel pitch | applicability与决定作用分开；缺viewing distance是operation blocker。 |
| dmx_address / address planning/allocation | 起始地址规划/分配所需的fixture、数量、allocation mode、地址与Universe等按现行合同判断 | 只在现行地址规划规则允许时使用目录信息 | `dmx_address`仅用于地址规划/分配；不承载通道功能表查询。D001/A01O不得猜测、纠正或推导Universe。 |
| knowledge / fixture function lookup | 明确的fixture功能表/手册知识查询；人审确认DMX-009与DMX-010的通道功能查询都路由`knowledge`。多模式fixture如TL-SL333仍需用户明确3CH/6CH，缺mode不能由catalog首项补齐。 | model/profile及明确mode可用于查表 | 路由`knowledge`与mode信息是否足够是两项判断；不能因knowledge查询就默认一个fixture mode。 |
| project_wiring / add-line | 当前用户语义中两端设备和端口须分别判断；是否要求用户明确 build_type/cable_type/status 尚待V2合同人审 | `utils/project-wiring.js:97–103` 的 `normalizeLine()` 会把缺失或非法枚举值规范化为 `finished`/`balanced`/`pending`；`validateLine()`（第144–149行）也检查合法枚举。此为core规范化默认，不等于用户显式提供。 | 端口缺失由页面与core硬阻塞；build_type/cable_type/status的core默认与验证不能被误写成用户显式语义必需，也不能隐藏。产品契约冻结前须明确这些字段何时允许默认。 |
| audio_wiring / routing | 接头、端口角色以及分支需要的声道/设备权限确认 | 与目标连接无关的字段不追问 | source channel≠destination channel；L/R直接并接权限不可臆造。 |
| cable / sizing | 回路类型、总额定功率、单程距离及环境条件的完整required set待按生产contract核定 | 支持range的方式须先由工具contract和功率档规则明示 | CAB-008的范围处理仍UNVERIFIED；不得静默拿range低端、均值或默认功率。 |
| spl / level estimate | 工具描述为按聆听距离估算SPL；确切必需与条件字段按当前计算入口和批准规则逐条核定 | 唯一产品目录值可否补充及哪些summation mode适用须见冻结context | 不从模型自行推导未记载规格、距离或叠加规则；具体边界待人工确认。 |
| limiter / limiter settings | 工具描述为计算功放限幅设置；speaker/amplifier、rated power、impedance和条件字段以现有core合同审定 | 目录补充范围与多档实际状态须分别确认 | 明确有效物理值不代表设备工作模式/实际档位已确认；具体字段政策待人审。 |
| product_catalog / browse-or-compare | 工具描述为浏览/查询/比较产品目录；类别/型号/比较对象的操作要求待按现有产品入口核定 | 目录信息是输出事实来源，不自动成为用户显式输入 | 不要求用户提供不必要型号，也不猜comparison target。 |
| project_records / inspect-or-manage | 工具描述为查看或管理已保存项目记录；项目/工具/操作字段范围需按当前入口核定 | 记录内容来自本地存储，非本次用户显式值 | 不编造缺失记录或项目；具体required set待人审。 |
| troubleshoot / diagnose | 工具描述为根据故障/异常行为排查；需核定什么程度的现象可启动首轮诊断 | 允许先给出的安全通用检查项须按产品规则确认 | 不把无故障的知识查询自动路由为troubleshoot；不推定具体根因。 |
| other / multiple / unclear | `other`用于支持清单外的明确任务；`multiple`用于相互独立的多个支持操作；`unclear`沿用“Available wording does not identify a reliable task.” | 依赖操作按首个可执行先决任务路由（context multiple定义已含此政策） | 仅在意图无法可靠判断时unclear；工具名被提及但所求操作明确时不自动unclear。若类别边界还需补充，冻结前由人审。 |

澄清合同应描述“当前目标操作的 blocker”，而不是某工具所有字段清单。场景、可选字段或不影响操作的拼写异常可以记录或提醒，但不能自动令 clarification=true。`clarification_required`建议语义为：意图无法可靠路由，或在已冻结operation contract允许的唯一catalog解析、明确文档默认、可信derived值均已应用后，仍有一个或多个未解决blocker。UI初值、persisted/page state、fallback及implicit first-option不能自动解除blocker。若`contract_status=unscored`，合同依赖的clarification也为unscored；不能以缺合同推断false或true。意图模糊本身若已足以确定需澄清，仍可按intent维度标注。

## 5. 默认值语义

Protocol V2 应在语境中把默认分为三类并给出是否可用于当前操作：

| 来源 | 示例 | presence | 可否解阻塞 |
|---|---|---|---|
| documented operation default | gain_structure target peak -6 dBFS；人审确认已文档化为 TuneBuddy 调试建议，见 `docs/gain-structure-calculation.md` 与 `utils/gain-structure.js` | user presence=false，source可标 documented_default | 仅当操作契约明确允许、值有效、且说明这是当前操作采用的默认。不能称为普遍行业默认。该默认不是一般UI初值。 |
| UI initial/default | Venue初始/回退 12/8/4；页面显示 LED unit；Camera可见 36°；DMX首个mode | 用户presence=false | 不可。显示、历史选择、初始选择不等于本次操作已提供/确认。 |
| persisted/current-state/fallback/implicit first option | 已保存LED单元、旧场地尺寸、`profile.modes[0]` | 用户presence=false | 不可静默解阻塞。若未来产品明确改成用户本次确认动作，须另定义其证据。 |

安全复核证明 Venue 真缺值会被core拒绝但页面有效值会过关；LED合法unitKey会通过校验；DMX-010 的guide builder会自动返回第一个mode。因此协议不能把数值合法性误当成本次请求已确认。Venue模式具体required/default合同仍需结合 `utils/venue.js` 与V2.1 schema差异做人审，不在本文添加未批准默认。证据见 `tests/p2-safety/acceptance/review-summary.md` 第27–37、72–80行。

## 6. Catalog 与派生值

- `presence` 永远回答用户是否说出这个参数。catalog/derived/default值不能变为 user-present。
- `validity` 可以考虑当前可用证据，包括唯一、适用且在 operation contract许可范围内的catalog条目。
- 当一个型号有一个明确适用的记录时，可记为 `source=catalog`, user_presence=false；不要虚构用户提供值。
- 若存在多个镜头、zoom、声道模式或操作档位，目录不能替用户选择；TS-0650JSM不同view/zoom和TL-SL333 3CH/6CH必须保留选择歧义。
- 明示物理开关实际状态、设备手册permission、现场当前选择不能由目录证明。
- `derived` 只在确定性规则与可信依赖明确时作为可用信息；benchmark不要求模型算推导值。CAM的DFOV+aspect ratio只是充分几何条件判断，数值推导仍由代码执行。
- catalog source facts应冻结快照/hash并注明适用版本，避免以后产品目录变化改变旧Run的含义。

## 7. 澄清与意图

- `intent_ambiguous`只判断操作意图能否确定；缺失必填值不自动让intent ambiguous。
- `clarification_required`判断当前操作是否有阻塞项：工具路由歧义、角色/值冲突未解决、必需字段缺失/无效/不完整、要求的设备permission未确认等。
- `parameter_completeness` false不自动等于 operation blocking；可选/不适用字段不阻塞。
- 明确冲突解决后保留 conflict metadata，但 blocker解除；参数异常或possible typo本身不阻塞，除非它影响当前运算。
- 一句话明确指定先决工作流，按该工作流执行；两个独立任务才multiple；若动作意图确实有多种解释才unclear。
- 澄清原因应按操作字段列出，不将 unrelated numbers、相似参数或其他字段的不确定性传播进当前判断。

## 8. Ground-truth 例外单独审批

### CAM-009

Run 1人审裁定 CAM-009 / `camera_fov.focal_length_mm` validity 为 GROUND TRUTH ISSUE、MEDIUM：请求指定 TS-0663JS；neutral catalog提供唯一 `focalWideMm=7.2`；V1 validity问题明确让模型考虑 catalog；因此 VALID有依据，冻结 V2.1 expected UNKNOWN可能与来源规则冲突。不能把“V2协议拟支持catalog validity”当作更改冻结真值的授权。后续须：

1. 重新核对批准目录字段及具体 operation适用性；
2. 由人工批准新的预期值和 rationale；
3. 新建不可变 GT版本及新哈希；
4. 保留 V2.1、Run1 raw和原指标。

同时系统审计所有 catalog-resolved validity labels，而不是只改CAM-009一项。

### LED-010

Run 1人审裁定 LED-010 / `brightness_nit` sufficiency 为 BENCHMARK / PROTOCOL ISSUE、MEDIUM：2500 nit presence=true且valid=true，是完整亮度值；它并不单独决定 pixel pitch。当前V2.1的 sufficient=false把“字段是否完整可用”和“亮度是否适用于/决定点间距推荐”折叠。后续如需改标签，必须逐项人工评审并另建GT版本；本设计建议新指标拆开，不直接把旧 sufficiency truth翻转或视为Jev犯错。

## 9. 与 Run1 可比较的度量

Run 2分别报告`metric_semantic_comparable`与`strict_task_comparable`。前者要求待比较的指标构念、字段/操作范围、标签语义、ground-truth含义、正负类与评分口径相同；若是Choice，候选集合及各选项含义必须相同；若是Noul，概率阈值及true/false解释必须相同。即使中性context或提示有变化，也只能作描述性指标比较并明确任务条件不同，不能据此声称协议导致模型能力变化。后者要求每个judgment的规范任务指纹完全相同。模型版本从任务指纹排除，但必须单独记录：不同模型可在同一任务上作描述性跨模型比较；研究模型变化时冻结任务，研究Protocol变化时尽可能固定model/version，且变化任务的accuracy不能直接称纵向提升。

每个judgment生成一个versioned canonical JSON和SHA-256 `task_fingerprint`。规范JSON须包含完整模型可见任务：该批次全部可见state/context/questions（包括同批次其他问题）、目标judgment ID、字段/operation定义、catalog snapshot/hash、类型与Choice options、criteria、contract status、threshold、normalization/scoring/evaluator版本，以及ground-truth**语义引用**（schema/定义版本及其hash，不含expected label值）。排除model/version、expected values、rationale、人审记录和所有secret。Canonicalization规则（UTF-8、对象键排序、数组顺序保留、无多余空白、数值与字符串不互转）和fingerprint版本必须冻结。

- 只有两次运行同一judgment的`task_fingerprint`一致才纳入strict_task_comparable配对；指纹不同即不得作严格逐项配对。报告共同judgment数、两边model/version及排除数。context/question/batch co-content改变可使严格可比项为零。
- `metric_semantic_comparable`可在指纹不同但上述指标语义与scope确实一致时作非配对、描述性比较；必须披露context/prompt/batch与模型差异，不能归因单一因素。
- 在分类和问题定义未变时，可比较routing exact-match/confusion、intent ambiguity、clarification、presence、validity choice；confidence仅在返回格式/语义一致时比较。
- 所有缺失/malformed/error仍独立列为coverage，不作为预测标签。
- 只有标签编码及指标语义未变的维度可对同一条V2.1 GT作比较；不要把新版定义反向套入旧Run分数。
- model/version改变本身不改变benchmark task identity；可以报告跨模型任务表现，但必须明确标注模型变化。Protocol效果分析需隔离任务定义变化，并优先固定模型版本。

## 10. 不可直接比较的指标

- sufficiency旧定义与新的 parameter_completeness / applicability / consumed / blocking 不是同一指标，不得把Run1 LED-010纳入新版指标后宣称趋势改善。
- 改变字段词义、operation合同、catalog上下文、tool description或提示问题，会改变任务；即使同一utterance也不自然等价。
- V2.1 ground truth修订后的case不能与冻结旧标签混合打分。可并列报告“旧冻结标签结果”与“新审定标签结果”，明确各自N与版本。
- 若routing Choice加入/删除/重新定义选项，新的 confusion matrix维度不同；只有重合选项的逐例对照可作为受限分析，不能冒称完整可比。
- 若参数范围新增/删减或语义重组，旧 scope覆盖数和新 judgment数不能只比准确率百分比。
- 置信度分箱、Noul threshold或缺失输出处理一旦变化，相关 confidence / binary metrics需分别列出，不能合并序列。

## 11. Run1 离线反事实协议影响分析

这是纯离线、按历史配置对照Protocol变化范围的**counterfactual protocol impact analysis**。它不重新向Jev提问、不产生新预测、不重算或发布调整后准确率，也不覆写Run1。该分析不预测模型在新Protocol下会不会继续出错。离线报告分别标注`metric_semantic_comparable`（指标定义同构但任务条件可能不同的描述性比较）与`strict_task_comparable`（指纹相同的逐judgment配对）；只可从Run1既有人审证据说明历史任务影响，不得伪造未来模型反事实答案。

建议将旧判断映射到下列影响类别，并逐项保留Run1 judgement记录引用：

| 类别 | 含义 | 处置 |
|---|---|---|
| A — 冻结Run1下经人工确认的JeV错误 | V1定义和上下文足够，且人工确认Run1回答在冻结规则下确实错，例如AW-002方向字段混淆、CROSS-002早选具体操作、scene_type窄解读。 | 只记录既有Run1人工裁定及其case/judgment引用；不声称V2下模型会重复该错误，不产生新预测。 |
| B — 因问题定义变化而不可评分 | 新旧维度不是同一对象，例如LED-010 sufficient拆分成完整性与operation applicability。 | `not_comparable_due_to_definition_change`，不纳入准确率分子/分母。 |
| C — V1 context不足 | GAIN taxonomy、LED assembly类别、build_type表达等。 | 标记V2预计补充的字段契约；旧错误仍按原裁定计入V1。 |
| D — GT需单独修订 | CAM-009 catalog validity等。 | 等待新版GT正式审批；不在V2协议文件内替换V2.1。 |
| E — 同一评测任务 | 仅当V2保留同一utterance、完整state/context/questions及同批其他问题、目标judgment ID、参数/operation定义、catalog快照、类型/options/criteria、GT语义引用、scope、阈值、normalization/scoring及evaluator处理，且versioned canonical JSON的`task_fingerprint`相同时才是严格同任务；model/version单独记录。 | 可进入第9节strict_task_comparable配对；不同模型可在同一指纹上描述性并列，但不能归因Protocol。指纹不同则不可严格配对。指纹不同但指标定义、scope、GT语义、正负类与评分口径一致时，只可作为第9节`metric_semantic_comparable`描述性指标比较。 |

反事实分析记录冻结配置的差异和受影响judgment IDs，不得按V2重建或改写历史回答、probability和raw body，更不得把旧输出重新标签成V2预测。候选E须按第9节生成版本化规范JSON与`task_fingerprint`；指纹相同才进入strict_task_comparable，model/version排除在指纹外并单独记录。若全局context变化，允许结论为零严格同任务项。离线回放只归档Run1既有、经人审裁定的错误，不推测或声称模型在未来Protocol下会重复这些错误。

## 12. Run2 冻结前准备要求

1. 先确认 Protocol V2定稿、ground truth版本与哈希、model/version、question bodies、context及候选集。
2. 以准确的请求构造结果做离线 dry run；验证 expected values、human rationale、review fields、case IDs、ground-truth JSON及标签映射不会进入 Jev body。
3. 明确模型可见的neutral资料、catalog snapshot和operation contracts；冻结其内容和hash。
4. 预先冻结阈值、confidence处理、请求批次、timeout、retry次数/条件、raw response schema和failure分类。
5. 固定唯一Run ID和独占创建路径。Raw records逐步写入、不可覆盖；API key只从环境读取且永不写入日志/响应文件。
6. API transport/malformed errors保持在coverage/error计数；不把它们变成标签。低置信度、分歧、分数不佳都不构成重试理由。
7. 离线 evaluator读取raw并另写分析；每项分歧完整进入人工复核队列。
8. Run2报告先做描述统计，不在看结果后追设pass threshold。
9. 新的人工判定进入单独文件/版本；Run2 raw、V1指标、V2.1与既有adjudication均不可修改。
10. 若问题/上下文/标签与Run1不严格一致，报告“benchmark task changed”，只对第9节定义的严格同构切片做比较。
11. 冻结前拒绝`contract_status=unscored`的operation-applicability/consumed/blocking及合同依赖clarification请求；不得将unscored编码成false。字段合同已冻结的presence、local validity、parameter_completeness可保留。
12. 用独立确定性测试验证versioned canonical JSON与`task_fingerprint`：同输入应字节级稳定；对象键重排不改变指纹；数组/同批问题顺序、state/context/questions/criteria/catalog/semantic-GT引用任一变化应改变指纹；model/version、expected/rationale/human-review或secret变化不得改变指纹，且secret不得进入规范JSON或请求。

## 13. Protocol V2冻结前建议增加的反例

这些是建议新增的人审样例类别，不是已冻结expected labels，也不是此次创建新数据集。

- **输入级 type/value 解耦**：明确“电压增益模式，实际值不清楚”；type present/valid而value missing或unknown。
- **单位参考域**：相同数值分别以 dBu、dBV、dBFS表达；问字段角色和validity，不能只靠负数作判断。
- **LED 类别/尺寸**：“常规箱体但尺寸没定”“模组拼，规格320×160”“箱体宽500高500”分别覆盖类别与物理参数。
- **制作方式/线材规格**：“成品音箱线但线径未知”“散线、每条2.5mm²”“扬声器线但规格未定”。
- **scene_type 正/负例**：背景屏/墙/地面覆盖区；另加纯背景叙述但并非相机target的负例，检验不过泛。
- **applicability**：提供完整brightness但目标是pixel pitch；同时单独提供nearest viewing distance的例子。参数自身状态与操作阻塞分别标注。
- **applicability与consumed**：brightness nit可与pitch请求相关（applicability=true）但不被pitch合同消费作决策（consumed=false）；nearest viewing distance缺失仍可有consumed=true，因为合同会消费其值，且在冻结合同下可blocking=true。operation合同unscored时不发这些标签。
- **catalog唯一/多义**：固定唯一规格可catalog-resolve；多view/zoom、2档实际现场选择、型号冲突和用户明确未知不能解析。
- **操作模式差异**：Camera horizontal-only vs full area；DMX fixture knowledge query vs allocation；Venue report vs PAG/NAG；LED sizing vs pitch recommendation。
- **range和冲突**：单值、有效range（包括NOM=1–3）、两候选冲突、用户明确选择解决冲突，分开覆盖 completeness/blocking。
- **defaults**：已批准documented default与页面初值/历史值/first-option成对；检查只有前者按合同和披露规则可用。
- **声道/端口角色**：source left vs destination left；明确RCA端口名字 vs 单个接口形状推断。
- **澄清的负例**：关键字段缺失但操作可继续；非适用字段缺失；possible typo不阻塞；充分信息下明确先决工作流。

样例需要跨工具、中文与混合术语进行分层抽样；不可为凑数量做同一数字的轻微改写。每条expected label应由工程/产品人员在模型调用前冻结。

## 14. 从 V1 迁移到 V2

- V1与Run1永不变更；Run2明确采用独立Protocol V2版本号、hash、问题ID、标签schema和context snapshot。
- 先定义V2本体，再审查case label迁移；不要机械映射旧 `sufficient` 到一个新维度。
- 可以沿用完全不变的用户话语和原case ID作为 lineage key，但新评测实体应带V2版本前缀/ID，并保存来源指针。任何更改过的expected field都需记录旧值、新值、证据、批准人和GT版本。
- CAM-009等GT问题列为待批准更正，而不是协议设计自动修正；LED-010旧 `sufficient=false`需要标记semantic reclassification，不算直接翻转为true。
- 新旧参数scope可能不一致：为新判项增加显式作用范围和 applicability；历史上未审参数不可伪称人工复核。
- 新旧指标报告分层：Run1原始指标保留；Run2使用V2标签报告；只有严格对齐字段做配对分析。
- freeze前用独立脚本校验V2大小、唯一ID、每case judgment清单、schema取值、标签完整性、无输出字段、hash确定性以及expected label不进入request body。

## 15. 防止过拟合 Run1

- 31项高置信度分歧与14项澄清FN是有偏样本：前者按高置信度筛选，后者按安全优先级选取。不能视作代表总体错误率的随机样本。
- 将人工裁定用于澄清字段契约和操作规则，不只为这31条utterance加特例。V2案例应覆盖规则正反例、不同工具、未见表达和自然口语。
- 预先冻结新测试集划分：用于协议开发的开发集、仅供最终观察的held-out set。held-out的case ID、数量和覆盖类别可供审计，但其utterance、expected labels及逐例人审材料不得用于prompt/context调优；一旦标签或逐例内容被用于调优，该集合不再称独立held-out，需另留新集合。锁定后不得因Run2错误改expected labels或挑选性重跑。
- 变更输入定义时同步加入近邻负例，避免把“任何提到墙都算scene_type”“任何speaker word都算build_type”等过宽策略烘焙进context。
- catalog事实按受控版本提供，不放gold rationale、expected labels或case family hints。只给当前operation需要的产品事实。
- 采用定性错误分析和覆盖率分布；样本不足的类别只报计数/案例，不做显著性、普适性或产品验收结论。
- 不因V2得到较高分就宣称行业可用；不在看Run2结果后新增通过线。

## 评审决策清单

请人审确认以下设计点后，才考虑形成最终 Protocol V2：

1. `parameter_completeness`、`operation_applicability`、`operation_consumed`与`operation_blocking`的词义、value_shape合同和unscored状态是否清楚。
2. 输入级 type、LED assembly、project wiring build type、camera scene_type 的分类和正反例是否符合TuneBuddy产品契约。
3. 各mode operation contract是否准确，尤其CAM horizontal/full-area、DMX knowledge/address、LED sizing/pitch和Venue三种模式。
4. 哪些catalog值能唯一解析以及每类不确定来源的阻塞规则。
5. documented default与UI/persisted/implicit state的边界和披露措辞。
6. CAM-009 ground truth更正与catalog validity系统审计另走GT审批；LED-010标签迁移另走GT审查。
7. 哪些case与Run1严格可比，哪些必须单列不比较。
8. 新增case范围、held-out划分和Run2冻结校验流程。

**当前停点：等待人审 Protocol V2 设计。** 本文不授予创建最终协议、修改标签、调用 Jev或运行 Run2的授权。
