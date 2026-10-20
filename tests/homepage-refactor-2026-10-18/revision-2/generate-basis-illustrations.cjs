'use strict'

const fs = require('node:fs')
const path = require('node:path')

const outputDir = path.join(__dirname, 'illustration-sources')
const C = {
  ink: '#1f2937',
  muted: '#64748b',
  line: '#cbd5e1',
  blue: '#2563eb',
  blueLight: '#eaf1ff',
  cyan: '#0f91aa',
  cyanLight: '#e5f7fa',
  orange: '#d97706',
  orangeLight: '#fff3df',
  green: '#14805e',
  greenLight: '#e8f6ef',
  white: '#ffffff',
  paper: '#f7f9fc',
  dark: '#27364a',
}

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function text(x, y, value, size = 28, fill = C.ink, weight = 500, anchor = 'start') {
  const displaySize = size < 32 ? size + 8 : size + 5
  return '<text x="' + x + '" y="' + y + '" text-anchor="' + anchor + '" font-size="' + displaySize + '" font-weight="' + weight + '" fill="' + fill + '">' + esc(value) + '</text>'
}

function rect(x, y, width, height, fill, stroke = 'none', radius = 16, strokeWidth = 2) {
  return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"/>'
}

function line(x1, y1, x2, y2, stroke = C.line, width = 3, dash = '') {
  return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + width + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>'
}

function circle(cx, cy, radius, fill, stroke = 'none', width = 2) {
  return '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + width + '"/>'
}

function pill(x, y, width, label, color = C.blue, background = C.blueLight, fontSize = 20) {
  return rect(x, y, width, 38, background, 'none', 19) + text(x + width / 2, y + 27, label, fontSize, color, 650, 'middle')
}

function base(id, title, description, body) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="560" viewBox="0 0 750 560" role="img" aria-labelledby="' + id + '-title ' + id + '-desc">' +
    '<title id="' + id + '-title">' + esc(title) + '</title><desc id="' + id + '-desc">' + esc(description) + '</desc>' +
    '<defs>' +
    '<marker id="arrow-blue" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L10 6 L0 12 Z" fill="' + C.blue + '"/></marker>' +
    '<marker id="arrow-orange" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L10 6 L0 12 Z" fill="' + C.orange + '"/></marker>' +
    '<style>text{font-family:Arial,"Microsoft YaHei","PingFang SC",sans-serif}</style>' +
    '</defs>' +
    rect(4, 4, 742, 552, C.paper, '#e2e8f0', 24, 2) +
    text(32, 52, title, 36, C.ink, 700) +
    body +
    '</svg>'
}

function save(id, title, description, body) {
  fs.writeFileSync(path.join(outputDir, id + '.svg'), base(id, title, description, body), 'utf8')
}

function makeCable() {
  let b = ''
  b += text(34, 102, '沿单程路径量距离，按单芯截面选择规格', 27, C.muted, 500)
  b += rect(42, 124, 166, 82, C.white, C.line, 14)
  b += rect(54, 143, 142, 42, C.dark, 'none', 8)
  b += text(125, 171, '功放', 28, C.white, 650, 'middle')
  b += rect(542, 124, 166, 82, C.white, C.line, 14)
  b += '<path d="M568 177 L598 141 L628 177 Z" fill="' + C.blueLight + '" stroke="' + C.blue + '" stroke-width="3"/>' +
    '<path d="M583 177 L598 158 L613 177" fill="none" stroke="' + C.blue + '" stroke-width="3"/>' +
    '<path d="M642 146 Q665 159 642 173" fill="none" stroke="' + C.blue + '" stroke-width="3"/>' +
    '<path d="M651 140 Q682 159 651 179" fill="none" stroke="' + C.blue + '" stroke-width="3"/>'
  b += text(670, 194, '音箱', 25, C.ink, 600, 'end')
  b += line(123, 242, 625, 242, C.orange, 8)
  b += line(123, 225, 123, 274, C.orange, 3)
  b += line(625, 225, 625, 274, C.orange, 3)
  b += '<line x1="145" y1="276" x2="603" y2="276" stroke="' + C.blue + '" stroke-width="3" marker-start="url(#arrow-blue)" marker-end="url(#arrow-blue)"/>'
  b += rect(240, 253, 270, 42, C.white, 'none', 18)
  b += text(375, 282, '输入单程距离（m）', 21, C.blue, 700, 'middle')
  b += line(374, 300, 374, 317, C.muted, 2, '4 5')
  b += circle(374, 350, 31, C.white, C.orange, 4)
  b += circle(374, 350, 16, C.orangeLight, C.orange, 4)
  b += circle(374, 350, 5, C.orange, 'none', 0)
  b += text(418, 350, '单芯截面积 S', 22, C.ink, 600)
  b += rect(28, 392, 205, 148, C.white, C.line, 14)
  b += text(48, 428, '设计带载功率', 20, C.muted, 600)
  b += text(48, 469, 'P表=总功率×1.5', 14, C.blue, 700)
  b += text(48, 510, '查表功率单位：W', 15, C.green, 600)
  b += rect(246, 392, 228, 148, C.white, C.line, 14)
  b += text(360, 428, '公司对照表', 20, C.muted, 600, 'middle')
  b += text(360, 470, '距离输入（m）', 16, C.blue, 650, 'middle')
  b += text(360, 509, '设计功率 P表（W）', 14, C.green, 600, 'middle')
  b += rect(487, 392, 235, 148, C.blueLight, '#c9d8ff', 14)
  b += text(604, 428, '公式单位换算', 18, C.muted, 600, 'middle')
  b += text(604, 467, 'P[kW] = P表[W] ÷ 1000', 14, C.ink, 600, 'middle')
  b += text(604, 495, 'L[km] = 输入m ÷ 1000', 14, C.ink, 600, 'middle')
  b += text(604, 526, 'S ≥ P × L × 5', 20, C.blue, 700, 'middle')
  save('cable', '线材选型｜距离与线芯截面', '功放到音箱的最远单程距离 L、单芯截面积 S、公司距离功率表与公式下限复核。', b)
}

function makeGain() {
  let b = ''
  b += text(34, 102, 'DSP 标定电平与功放输入级对照，求系统总衰减', 20, C.muted, 500)
  b += rect(32, 121, 218, 235, C.white, C.line, 16)
  b += text(54, 157, 'DSP 输出', 28, C.ink, 650)
  b += text(54, 193, '数字峰值刻度', 22, C.muted, 500)
  b += line(70, 217, 70, 320, C.line, 3)
  b += line(70, 224, 91, 224, C.blue, 4)
  b += line(70, 262, 91, 262, C.blue, 4)
  b += line(70, 301, 91, 301, C.blue, 4)
  b += text(103, 232, 'dBFS', 16, C.blue, 650)
  b += text(103, 270, '目标峰值', 15, C.muted, 500)
  b += text(103, 309, '动态余量', 15, C.muted, 500)
  b += rect(262, 112, 222, 160, C.orangeLight, '#f4d29b', 16)
  b += text(373, 146, '本设备实测', 22, C.orange, 650, 'middle')
  b += text(373, 183, '0 dBFS', 27, C.ink, 700, 'middle')
  b += '<path d="M373 190 L373 218 M367 211 L373 218 L379 211" fill="none" stroke="' + C.orange + '" stroke-width="3"/>'
  b += text(373, 266, '+18.4 dBu', 27, C.ink, 700, 'middle')
  b += '<line x1="252" y1="276" x2="520" y2="276" stroke="' + C.blue + '" stroke-width="4" marker-end="url(#arrow-blue)"/>'
  b += rect(494, 121, 225, 235, C.white, C.line, 16)
  b += text(518, 157, '功放输入级', 27, C.ink, 650)
  b += text(518, 193, '满功率输入', 16, C.muted, 500)
  b += line(534, 225, 534, 323, C.line, 3)
  b += line(534, 246, 674, 246, C.orange, 4)
  b += line(534, 288, 648, 288, C.blue, 4)
  b += text(681, 254, '满功率', 20, C.orange, 600, 'end')
  b += text(681, 296, '目标', 20, C.blue, 600, 'end')
  b += '<path d="M707 247 L707 289 M698 247 L707 247 M698 289 L707 289" fill="none" stroke="' + C.green + '" stroke-width="3"/>'
  b += text(694, 327, '总衰减', 20, C.green, 650, 'end')
  b += rect(32, 377, 687, 148, C.blueLight, '#c9d8ff', 16)
  b += text(56, 414, '系统对齐差值', 25, C.muted, 600)
  b += text(375, 461, 'DSP 目标 dBu  −  功放满功率输入 dBu', 29, C.blue, 700, 'middle')
  b += text(375, 501, '= 可核对的总衰减位置', 24, C.ink, 600, 'middle')
  save('gainStructure', '增益结构｜DSP 与功放输入级对齐', 'DSP dBFS 按设备实测标定换成 dBu，与功放说明书满功率输入级比较并得到对齐差值。', b)
}

function makeLimiter() {
  let b = ''
  b += text(34, 102, '音箱与功放取较低保护电压，再回推 DSP 阈值', 20, C.muted, 500)
  b += rect(31, 122, 280, 160, C.white, C.line, 16)
  b += text(54, 160, '音箱保护上限', 25, C.ink, 650)
  b += text(54, 198, 'V_speaker', 27, C.blue, 700)
  b += rect(178, 211, 130, 20, '#e9eef5', 'none', 10)
  b += rect(178, 211, 106, 20, C.blue, 'none', 10)
  b += text(54, 259, '按额定功率和总阻抗', 14, C.muted, 500)
  b += rect(439, 122, 280, 160, C.white, C.line, 16)
  b += text(462, 160, '功放可提供上限', 25, C.ink, 650)
  b += text(462, 198, 'V_amp', 27, C.orange, 700)
  b += rect(582, 211, 130, 20, '#e9eef5', 'none', 10)
  b += rect(582, 211, 77, 20, C.orange, 'none', 10)
  b += text(462, 259, '按说明书额定功率点', 14, C.muted, 500)
  b += '<path d="M169 299 C225 325 275 325 320 325 M581 299 C525 325 475 325 430 325" fill="none" stroke="' + C.line + '" stroke-width="3"/>'
  b += rect(183, 286, 384, 126, C.greenLight, '#b5e1cb', 16)
  b += text(375, 320, '保护目标电压', 20, C.muted, 600, 'middle')
  b += text(375, 364, 'V_target = min(', 20, C.green, 700, 'middle')
  b += text(375, 399, 'V_speaker, V_amp)', 20, C.green, 700, 'middle')
  b += text(34, 441, '按输入灵敏度逐级换算为限幅阈值', 20, C.muted, 550)
  b += rect(31, 453, 195, 79, C.white, C.line, 14)
  b += text(128, 484, '输入灵敏度', 20, C.blue, 700, 'middle')
  b += text(128, 520, '限幅电压', 20, C.ink, 600, 'middle')
  b += '<line x1="232" y1="491" x2="267" y2="491" stroke="' + C.blue + '" stroke-width="3" marker-end="url(#arrow-blue)"/>'
  b += rect(276, 453, 170, 79, C.blueLight, '#c9d8ff', 14)
  b += text(361, 485, '电压 → dBu', 20, C.blue, 700, 'middle')
  b += text(361, 521, '以 0.775 V 为基准', 17, C.muted, 500, 'middle')
  b += '<line x1="451" y1="491" x2="486" y2="491" stroke="' + C.blue + '" stroke-width="3" marker-end="url(#arrow-blue)"/>'
  b += rect(495, 453, 224, 79, C.orangeLight, '#f4d29b', 14)
  b += text(607, 485, 'dBu → dBFS', 21, C.orange, 700, 'middle')
  b += text(607, 521, '设备标定换算', 18, C.muted, 500, 'middle')
  save('limiter', '限幅器｜保护电压回推阈值', '音箱电压上限与功放能力取较小值，再按输入灵敏度换算为 dBu 和 DSP dBFS 阈值。', b)
}

function makeSpl() {
  let b = ''
  b += text(34, 102, '从 1 m 灵敏度参考点按距离估算衰减', 22, C.muted, 500)
  b += rect(32, 122, 426, 260, C.white, C.line, 16)
  b += '<path d="M80 197 L147 168 L147 315 L80 286 Z" fill="' + C.blueLight + '" stroke="' + C.blue + '" stroke-width="4"/>' +
    '<path d="M65 202 L65 281" stroke="' + C.blue + '" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M80 217 L133 194 M80 267 L133 290" stroke="' + C.blue + '" stroke-width="3"/>'
  b += text(103, 346, '音箱', 23, C.ink, 650, 'middle')
  b += '<defs><clipPath id="spl-scene-clip"><rect x="32" y="122" width="426" height="260" rx="16"/></clipPath></defs>' +
    '<g clip-path="url(#spl-scene-clip)">' +
    '<circle cx="150" cy="241" r="62" fill="none" stroke="' + C.cyan + '" stroke-width="2" stroke-dasharray="7 8"/>' +
    '<circle cx="150" cy="241" r="114" fill="none" stroke="' + C.cyan + '" stroke-width="2" stroke-dasharray="7 8"/>' +
    '<circle cx="150" cy="241" r="169" fill="none" stroke="' + C.cyan + '" stroke-width="2" stroke-dasharray="7 8"/>' +
    '</g>'
  b += line(152, 241, 429, 241, C.line, 3, '7 7')
  b += circle(264, 241, 10, C.green)
  b += circle(421, 241, 10, C.orange)
  b += pill(214, 133, 104, '1 m 参考', C.green, C.greenLight)
  b += pill(322, 326, 120, '目标距离 d', C.orange, C.orangeLight)
  b += rect(481, 122, 238, 260, C.blueLight, '#c9d8ff', 16)
  b += text(600, 164, '1 m 参考', 22, C.muted, 600, 'middle')
  b += text(600, 211, '额定灵敏度', 21, C.blue, 700, 'middle')
  b += text(600, 249, '+ 额定功率', 21, C.blue, 700, 'middle')
  b += text(600, 287, '+ 数量叠加', 21, C.blue, 700, 'middle')
  b += line(515, 301, 685, 301, '#bfd0f3', 2)
  b += text(600, 341, '距离衰减', 20, C.orange, 700, 'middle')
  b += text(600, 375, '−20 log₁₀(d)', 20, C.ink, 600, 'middle')
  b += rect(32, 405, 687, 121, C.white, C.line, 16)
  b += text(376, 461, '1 m 基准 = 灵敏度 + 10 log₁₀(P额定) + 叠加增益', 20, C.blue, 700, 'middle')
  b += text(376, 505, '非相干：10 log₁₀(N)　｜　相干：20 log₁₀(N)', 20, C.ink, 600, 'middle')
  save('spl', '声压级｜灵敏度、功率与距离', '从产品资料灵敏度的 1 m 参考点，按额定功率、多只音箱叠加模式和目标距离估算声压。', b)
}

function makeCamera() {
  let b = ''
  b += text(34, 102, '非比例示意：角点投影扩张，分别校核两轴', 20, C.muted, 500)
  b += rect(28, 118, 430, 336, C.white, C.line, 16)
  b += pill(44, 137, 172, '地面区域 8 角点', C.green, C.greenLight, 12)
  b += pill(225, 137, 215, '垂直目标面 4 角点', C.orange, C.orangeLight, 12)
  b += line(50, 392, 437, 392, '#9aa8ba', 3)
  b += '<path d="M277 229 L361 229 L411 199 L327 199 Z" fill="' + C.greenLight + '" stroke="' + C.green + '" stroke-width="3"/>' +
    '<path d="M277 229 L361 229 L361 331 L277 331 Z" fill="' + C.blueLight + '" stroke="' + C.blue + '" stroke-width="3"/>' +
    '<path d="M361 229 L411 199 L411 301 L361 331 Z" fill="#f6f8fb" stroke="' + C.blue + '" stroke-width="3"/>' +
    '<path d="M361 229 L411 199 L411 301 L361 331 Z" fill="none" stroke="' + C.orange + '" stroke-width="3" stroke-dasharray="8 6"/>'
  const points = [[277,229],[361,229],[277,331],[361,331],[327,199],[411,199],[327,301],[411,301]]
  points.forEach(([x,y], index) => { b += circle(x, y, 7, index < 4 ? C.green : C.blue, C.white, 2) })
  b += '<path d="M78 319 L85 296 L101 292 L110 314 L107 330 L81 330 Z" fill="' + C.dark + '"/>' +
    '<circle cx="105" cy="309" r="8" fill="' + C.orange + '"/>'
  b += '<line x1="114" y1="307" x2="277" y2="248" stroke="' + C.orange + '" stroke-width="3" stroke-dasharray="8 7" marker-end="url(#arrow-orange)"/>'
  b += '<line x1="114" y1="307" x2="411" y2="209" stroke="' + C.blue + '" stroke-width="2" stroke-dasharray="6 7"/>' +
    '<line x1="114" y1="307" x2="277" y2="320" stroke="' + C.blue + '" stroke-width="2" stroke-dasharray="6 7"/>' +
    '<line x1="114" y1="307" x2="411" y2="291" stroke="' + C.blue + '" stroke-width="2" stroke-dasharray="6 7"/>'
  b += text(67, 278, '相机 C', 18, C.ink, 650)
  b += '<line x1="78" y1="340" x2="78" y2="389" stroke="' + C.muted + '" stroke-width="3" marker-start="url(#arrow-blue)" marker-end="url(#arrow-blue)"/>'
  b += text(66, 374, 'H', 20, C.muted, 700, 'end')
  b += '<line x1="117" y1="361" x2="276" y2="361" stroke="' + C.orange + '" stroke-width="3" marker-start="url(#arrow-orange)" marker-end="url(#arrow-orange)"/>'
  b += text(197, 386, '退距 D', 20, C.orange, 700, 'middle')
  b += '<path d="M133 306 Q149 290 164 288" fill="none" stroke="' + C.orange + '" stroke-width="3"/>' +
    text(157, 316, '俯仰 θ', 19, C.orange, 650)
  b += rect(477, 118, 245, 336, C.blueLight, '#c9d8ff', 16)
  b += text(600, 156, '投影后的目标包络', 21, C.muted, 600, 'middle')
  b += rect(514, 181, 170, 145, C.white, '#93afea', 8, 2)
  b += line(599, 181, 599, 326, '#d5def0', 2)
  b += line(514, 253, 684, 253, '#d5def0', 2)
  b += '<rect x="531" y="198" width="136" height="111" fill="none" stroke="' + C.orange + '" stroke-width="3" stroke-dasharray="8 7"/>' +
    '<rect x="550" y="216" width="98" height="75" fill="' + C.greenLight + '" stroke="' + C.green + '" stroke-width="3"/>'
  b += text(599, 354, '扩张总宽、高余量', 17, C.ink, 600, 'middle')
  b += line(501, 373, 698, 373, C.line, 2)
  b += text(599, 403, '水平边界', 19, C.blue, 700, 'middle')
  b += text(599, 439, '垂直边界', 19, C.orange, 700, 'middle')
  b += rect(28, 470, 694, 55, C.orangeLight, '#f4d29b', 13)
  b += text(375, 505, '逐个退距重算投影，分别校核水平与垂直视场', 18, C.ink, 600, 'middle')
  save('camera', '摄像机视场示意', '非比例示意：目标按地面区域 8 个角点或垂直目标面 4 个角点投影，扩张包络后分别校核水平和垂直视场。', b)
}

function makeLed() {
  let b = ''
  b += text(34, 102, '先扣除预留与包边，再用整数行列拼出净屏', 26, C.muted, 500)
  b += rect(31, 120, 420, 340, C.white, C.line, 16)
  b += text(55, 157, '墙面可用净空间（m）', 23, C.muted, 600)
  b += rect(78, 183, 326, 226, '#f6f8fb', '#9aa8ba', 3, 8)
  b += text(241, 205, '上方预留', 17, C.muted, 550, 'middle')
  b += text(241, 394, '下方预留', 17, C.muted, 550, 'middle')
  b += line(99, 235, 383, 235, C.line, 2, '6 6')
  b += line(99, 358, 383, 358, C.line, 2, '6 6')
  b += rect(145, 266, 194, 80, '#27364a', C.orange, 4, 8)
  for (let x = 145; x <= 339; x += 38.8) b += line(x, 266, x, 346, '#8ea2bb', 1.5)
  for (let y = 266; y <= 346; y += 26.7) b += line(145, y, 339, y, '#8ea2bb', 1.5)
  b += rect(176, 284, 132, 43, C.dark, 'none', 6)
  b += text(242, 314, '净屏', 23, C.white, 700, 'middle')
  b += '<line x1="145" y1="259" x2="339" y2="259" stroke="' + C.blue + '" stroke-width="2" marker-start="url(#arrow-blue)" marker-end="url(#arrow-blue)"/>'
  b += text(241, 252, 'W（m）', 18, C.blue, 650, 'middle')
  b += '<line x1="352" y1="266" x2="352" y2="346" stroke="' + C.blue + '" stroke-width="2" marker-start="url(#arrow-blue)" marker-end="url(#arrow-blue)"/>'
  b += text(377, 306, 'H', 18, C.blue, 700)
  b += text(55, 438, '包边：cm / 边　·　屏体尺寸：m', 17, C.orange, 650)
  b += rect(474, 120, 245, 340, C.blueLight, '#c9d8ff', 16)
  b += text(596, 157, '整数行 × 列拼装', 23, C.muted, 600, 'middle')
  b += rect(494, 181, 205, 78, C.white, 'none', 12)
  b += text(596, 213, '列数 × 单元宽', 20, C.blue, 700, 'middle')
  b += text(596, 247, '= 净屏宽', 19, C.ink, 600, 'middle')
  b += rect(494, 269, 205, 78, C.white, 'none', 12)
  b += text(596, 301, '行数 × 单元高', 20, C.blue, 700, 'middle')
  b += text(596, 335, '= 净屏高', 19, C.ink, 600, 'middle')
  b += rect(494, 357, 205, 91, C.orangeLight, 'none', 12)
  b += text(596, 391, '安装外尺寸', 20, C.orange, 700, 'middle')
  b += text(596, 432, '= 净屏 + 包边', 18, C.ink, 600, 'middle')
  b += rect(31, 478, 688, 48, C.white, C.line, 13)
  b += text(375, 510, '比例误差筛选；像素按净尺寸 ÷ 标称点间距 P 估算', 18, C.ink, 600, 'middle')
  save('ledScreen', 'LED 大屏｜墙面预留与模组网格', '墙面净空间先扣上下预留与包边，再按单元宽高枚举整数行列；净尺寸和像素均为预估。', b)
}

fs.mkdirSync(outputDir, { recursive: true })
makeCable()
makeGain()
makeLimiter()
makeSpl()
makeCamera()
makeLed()
const summary = fs.readdirSync(outputDir).filter((name) => name.endsWith('.svg')).sort().map((name) => ({
  name,
  bytes: fs.statSync(path.join(outputDir, name)).size,
}))
console.log(JSON.stringify({ outputDir, assets: summary, totalBytes: summary.reduce((sum, item) => sum + item.bytes, 0) }, null, 2))
