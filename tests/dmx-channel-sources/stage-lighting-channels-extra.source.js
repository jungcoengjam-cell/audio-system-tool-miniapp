// 第十一、十二批灯具通道资料。每个型号均按对应说明书通道表逐项核对。
const range = (value, description) => ({ range: value, description })
const all = [['0–255', '']]
const blank = (name) => [name, name, all]
const linear = (name, summary, description = summary) => [name, summary, [['0–255', description]]]
const channels = (definitions) => definitions.map((item, index) => {
  const [name, summary = name, ranges = all] = item
  return {
    channel: index + 1,
    name,
    summary,
    ranges: ranges.map(([valueText, description]) => range(valueText, description)),
  }
})
const mode = (channelCount, definitions) => ({ channelCount, channels: channels(definitions) })
const profile = (model, source, sourcePages, sourcePageText, modes) => ({
  model, source, sourcePages, sourcePageText, verification: 'checked', verificationStatus: '已核对', modes,
})
const numberedWheel = (ends, jitters, tail, start = 11) => {
  const result = [['0–10', '白光']]
  let begin = start
  ends.forEach((end, index) => {
    result.push([`${begin}–${end}`, `图案${index + 1}`])
    begin = end + 1
  })
  jitters.forEach(([from, to, index]) => result.push([`${from}–${to}`, `图案${index}抖动`]))
  return result.concat(tail)
}
const jitterRanges = (start, ends, firstIndex, step = -1) => ends.map((end, index) => [
  index ? ends[index - 1] + 1 : start, end, firstIndex + index * step,
])
const colorWheel = (ends, tail, finalLabel, initialRange = '0–10', start = 11) => {
  const result = [[initialRange, '白光']]
  let begin = start
  ends.forEach((end, index) => {
    const color = index % 2 === 0 ? (index === 0 ? 1 : index / 2) : (index + 1) / 2
    const description = finalLabel && index === ends.length - 1 ? finalLabel : index % 2 === 0
      ? (index === 0 ? '白光+颜色1' : `颜色${color}+颜色${color + 1}`)
      : `颜色${color}`
    result.push([`${begin}–${end}`, description])
    begin = end + 1
  })
  return result.concat(tail)
}
const newLinearNames = new Set('X轴 X轴微调 Y轴 Y轴微调 XY速度 总调光 总调光微调 调光 调焦 调焦微调 变焦 变焦微调 放大 放大微调 光圈 青色 品红色 黄色 色温 R调光 G调光 B调光 W调光 切割1 切割2 切割3 切割4 切割5 切割6 切割7 切割8'.split(' '))
const newDefinitions = (names, special) => names.map((name) => special[name] || (newLinearNames.has(name) ? linear(name, '0–255') : blank(name)))
const names = (text) => text.split('|')
const d = (name, ranges, summary = name) => [name, summary, ranges]

const strobe = [
  ['0–10', '关'], ['11–21', '开'], ['22–62', '频闪，由慢到快'], ['63–73', '开'],
  ['74–114', '快开慢关，由慢到快'], ['115–125', '开'], ['126–166', '快关慢开，由慢到快'],
  ['167–177', '开'], ['178–218', '随机频闪'], ['219–255', '开'],
]
const prism = [['0–10', '棱镜关'], ['11–255', '棱镜切入']]
const prism1 = [['0–10', '棱镜关'], ['11–255', '棱镜1开（排镜）']]
const prismRotate = [
  ['0–127', '滑步0°-360°'], ['128–189', '顺时针旋转，由快到慢'], ['190–193', '停止'],
  ['194–255', '逆时针旋转，由慢到快'],
]
const fog = [['0–10', '关'], ['11–255', '雾化切入']]
const fog105 = [['0–10', '关'], ['11–255', '开']]
const rotatingGobo = numberedWheel(
  [23, 36, 49, 62, 75, 88, 101],
  jitterRanges(102, [111, 121, 131, 141, 151, 161, 171], 7),
  [['172–205', '顺时针旋转，由快到慢'], ['206–207', '停止'], ['208–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
)
const macroEnds = [10, 21, 27, 33, 42, 48, 54, 60, 66, 72, 78, 84, 105, 111, 117, 123, 129, 135, 145, 151, 157, 163, 184, 190, 199, 210, 255]
const macroLabels = ['无功能', '无功能', '无功能', '无功能', '无功能', '平方曲线', '反平方曲线', '线性曲线', 'S曲线', '常规模式', '低速模式', '静音模式', '无功能', '调光速度快速', '调光速度慢速', '全部复位', '灯头电机复位', 'XY轴电机复位', '无功能', '无功能', '无功能', '无功能', '无功能', '无功能', '无功能', '无功能', '无功能']
const makeMacro = (overrides = {}) => macroEnds.map((end, index) => {
  const start = index ? macroEnds[index - 1] + 1 : 0
  const rangeText = `${start}–${end}`
  return [rangeText, overrides[rangeText] || macroLabels[index]]
})
const macroLampOff = makeMacro()
const macroLamp = makeMacro({ '11–21': '灯泡开', '200–210': '灯泡关' })
const macro105 = macroLamp.map(([valueText, description]) => {
  if (valueText === '49–54') return [valueText, '反曲线']
  if (['67–72', '73–78', '79–84', '106–111', '112–117'].includes(valueText)) return [valueText, '无功能']
  return [valueText, description]
})

const sl105Color = colorWheel(
  [15, 20, 25, 30, 36, 41, 46, 51, 56, 62, 67, 72, 77, 82, 88, 93, 98, 103, 108, 114, 119, 124, 129, 134, 140, 145, 150, 155, 161],
  [['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
  '颜色14+白光',
)
const sl105Fixed = numberedWheel(
  [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 101],
  jitterRanges(102, [104, 108, 112, 116, 120, 124, 128, 132, 136, 139, 143, 147, 151, 155, 159, 163, 167, 171], 18),
  [['172–205', '顺时针旋转'], ['206–207', '停止'], ['208–244', '逆时针旋转'], ['245–255', '白光']],
)
const sl105Names13 = names('X轴|Y轴|调光|频闪|色盘|固定盘|棱镜1|棱镜1旋转|棱镜2/3|棱镜2/3旋转|雾化|调焦|宏功能')
const sl105Names16 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|调光|频闪|色盘|固定盘|棱镜1|棱镜1旋转|棱镜2/3|棱镜2/3旋转|雾化|调焦|宏功能')
const sl105Definitions = (names) => names.map((name, index) => ({
  '调光': linear('调光', '暗到亮'),
  '频闪': d('频闪', strobe), '色盘': d('色盘', sl105Color), '固定盘': d('固定盘', sl105Fixed),
  '棱镜1': d('棱镜1', prism1), '棱镜1旋转': d('棱镜1旋转', prismRotate),
  '棱镜2/3': d('棱镜2/3', [['0–10', '棱镜关'], ['11–127', '棱镜2开（蜂窝棱镜）'], ['128–255', '棱镜3开（八棱镜）']]),
  '棱镜2/3旋转': d('棱镜2/3旋转', prismRotate), '雾化': d('雾化', fog105), '宏功能': d('宏功能', macro105),
}[name] || blank(name)))

const sl182Color = colorWheel(
  [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 161],
  [['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
  '颜色7+白光',
)
const sl182Fixed = numberedWheel(
  [21, 32, 44, 55, 66, 78, 90, 101],
  jitterRanges(102, [109, 118, 127, 136, 144, 153, 162, 171], 8),
  [['172–205', '顺时针旋转，由快到慢'], ['206–207', '停止'], ['208–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
)
const sl182Names15 = names('X轴|Y轴|XY轴速度|调光|频闪|色盘|固定盘|旋转图案|旋转图案自转|棱镜|棱镜旋转|雾化|调焦|变焦|宏功能')
const sl182Names17 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|调光|频闪|色盘|固定盘|旋转图案|旋转图案自转|棱镜|棱镜旋转|雾化|调焦|变焦|宏功能')
const sl182Definitions = (names, macro) => names.map((name) => ({
  '调光': linear('调光', '暗到亮'),
  '频闪': d('频闪', strobe), '色盘': d('色盘', sl182Color), '固定盘': d('固定盘', sl182Fixed),
  '旋转图案': d('旋转图案', rotatingGobo), '旋转图案自转': d('旋转图案自转', prismRotate), '棱镜': d('棱镜', prism),
  '棱镜旋转': d('棱镜旋转', prismRotate), '雾化': d('雾化', fog), '宏功能': d('宏功能', macro),
}[name] || blank(name)))

const sl185Color = colorWheel(
  [17, 23, 30, 36, 43, 49, 56, 63, 69, 76, 82, 89, 95, 102, 108, 115, 122, 128, 135, 141, 148, 154, 161],
  [['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
  '颜色11+白光',
)
const sl185Fixed = numberedWheel(
  [18, 26, 34, 42, 50, 58, 66, 74, 82, 90, 101],
  jitterRanges(102, [107, 113, 119, 125, 131, 137, 143, 150, 156, 162, 171], 11),
  [['172–205', '顺时针旋转，由快到慢'], ['206–207', '停止'], ['208–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
)
const effectInsert = [['0–10', '效果盘切出'], ['11–255', '效果盘切入']]
const sl185Names21 = names('X轴|Y轴|XY轴速度|调光|频闪|色盘|色温|青色|品红|黄色|固定盘|旋转图案|旋转图案自转|效果盘|效果盘旋转|棱镜|棱镜旋转|雾化|调焦|变焦|宏功能')
const sl185Names25 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|调光|频闪|色盘|色温|青色|品红|黄色|固定盘|旋转图案|旋转图案自转|效果盘|效果盘旋转|棱镜|棱镜旋转|雾化|调焦|调焦微调|变焦|变焦微调|宏功能')
const sl185Definitions = (names) => names.map((name) => ({
  '调光': linear('调光', '暗到亮'), '频闪': d('频闪', strobe), '色盘': d('色盘', sl185Color),
  '色温': linear('色温', '由浅到深'), '青色': linear('青色', '由浅到深'), '品红': linear('品红', '由浅到深'), '黄色': linear('黄色', '由浅到深'),
  '固定盘': d('固定盘', sl185Fixed), '旋转图案': d('旋转图案', rotatingGobo), '旋转图案自转': d('旋转图案自转', prismRotate),
  '效果盘': d('效果盘', effectInsert), '效果盘旋转': d('效果盘旋转', prismRotate), '棱镜': d('棱镜', prism),
  '棱镜旋转': d('棱镜旋转', prismRotate), '雾化': d('雾化', fog), '宏功能': d('宏功能', macroLampOff),
}[name] || blank(name)))

const sl186Color = colorWheel(
  [22, 33, 45, 56, 68, 80, 91, 103, 114, 126, 138, 149, 161],
  [['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
  '颜色6+白光',
)
const sl186Cmy = [
  ['0–10', '无功能'], ['11–24', '颜色1'], ['25–38', '颜色2'], ['39–52', '颜色3'], ['53–66', '颜色4'], ['67–80', '颜色5'],
  ['81–94', '颜色6'], ['95–108', '颜色7'], ['109–122', '颜色8'], ['123–136', '颜色9'], ['137–150', '颜色10'], ['151–164', '颜色11'],
  ['165–178', '颜色12'], ['179–192', '颜色13'], ['193–206', '颜色14'], ['207–220', '颜色15'], ['221–255', '循环，由慢到快'],
]
const sl186Fixed = numberedWheel(
  [20, 30, 40, 50, 60, 70, 80, 90, 101],
  jitterRanges(102, [110, 118, 125, 133, 141, 149, 156, 164, 171], 9),
  [['172–205', '顺时针旋转，由快到慢'], ['206–207', '停止'], ['208–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
)
const effectWheel = [['0–10', '无效'], ['11–85', '抖动，由慢到快'], ['86–95', '白光'], ['96–170', '顺时针旋转，由快到慢'], ['171–180', '停止'], ['181–255', '逆时针旋转，由慢到快']]
const sl186Names21 = names('X轴|Y轴|XY轴速度|调光|频闪|色盘|色温|青色|品红|黄色|CMY宏|固定盘|旋转图案|旋转图案自转|效果盘|棱镜|棱镜旋转|雾化|调焦|变焦|宏功能')
const sl186Names25 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|调光|频闪|色盘|色温|青色|品红|黄色|CMY宏|固定盘|旋转图案|旋转图案自转|效果盘|棱镜|棱镜旋转|雾化|调焦|调焦微调|变焦|变焦微调|宏功能')
const sl186Definitions = (names) => names.map((name) => ({
  '调光': linear('调光', '暗到亮'), '频闪': d('频闪', strobe), '色盘': d('色盘', sl186Color),
  '色温': linear('色温', '由浅到深'), '青色': linear('青色', '由浅到深'), '品红': linear('品红', '由浅到深'), '黄色': linear('黄色', '由浅到深'),
  'CMY宏': d('CMY宏', sl186Cmy), '固定盘': d('固定盘', sl186Fixed), '旋转图案': d('旋转图案', rotatingGobo),
  '旋转图案自转': d('旋转图案自转', prismRotate), '效果盘': d('效果盘', effectWheel), '棱镜': d('棱镜', prism),
  '棱镜旋转': d('棱镜旋转', prismRotate), '雾化': d('雾化', fog), '宏功能': d('宏功能', macroLampOff),
}[name] || blank(name)))

const sl155Strobe = [['0–3', '无功能'], ['4–95', '同步频闪速度由慢到快（1HZ~25HZ）'], ['96–176', '随机频闪'], ['177–255', '雷电频闪']]
const sl155Effect = [
  ['0–24', '内置效果1'], ['25–49', '内置效果2'], ['50–74', '内置效果3'], ['75–99', '内置效果4'], ['100–124', '内置效果5'],
  ['125–149', '内置效果6'], ['150–174', '内置效果7'], ['175–199', '内置效果8'], ['200–224', '内置效果9'], ['225–255', '内置效果10'],
]
const sl155Macro = [['0–49', '无功能'], ['50–99', '灯光效果展示（内置效果）'], ['100–149', '自走1'], ['150–199', '自走2'], ['200–255', '灯体声控']]
const sl155Reset = [['0–250', '无功能'], ['251–255', '灯体复位,3s有效。']]
const sl155Names16 = names('X轴|X轴微调|Y轴|Y轴微调|XY速度|总调光|频闪|R调光|G调光|B调光|W调光|调焦|灯光效果展示|灯光效果速度|宏功能|复位')
const sl155Names24 = names('X轴|X轴微调|Y轴|Y轴微调|XY速度|调焦|总调光|频闪|R1调光|G1调光|B1调光|W1调光|R2调光|G2调光|B2调光|W2调光|R3调光|G3调光|B3调光|W3调光|灯光效果展示|灯光效果速度|宏功能|复位')
const sl155Definitions = (names) => names.map((name) => ({
  '频闪': d('频闪', sl155Strobe), '灯光效果展示': d('灯光效果展示', sl155Effect),
  '宏功能': d('宏功能', sl155Macro), '复位': d('复位', sl155Reset),
}[name] || (name === '总调光' ? linear(name, '从暗到亮进行线性调光') : blank(name))))

const sw03Strobe = [['0–255', '常规频闪由慢到快']]
const sw03Cct = [['0–5', '无效'], ['6–255', '色温由低到高']]
const sw03Macro = [
  ['0–5', '无效'], ...['R', 'G', 'B', 'W', 'RG', 'RB', 'RW', 'GB', 'GW', 'BW', 'RGB', 'RGW', 'RBW', 'GBW', 'RGBW']
    .map((colors, index) => [`${6 + index * 14}–${19 + index * 14}`, `颜色${index + 1} ${colors}`]),
  ['216–225', '自走跳变效果'], ['226–235', '自走脉变效果'], ['236–255', '自走渐变效果'],
]
const sw03Config = [
  ['0–42', '无效'], ['43–48', '平方曲线'], ['49–54', '反曲线'], ['55–60', '线型曲线'], ['61–66', 'S型曲线'],
  ['67–72', '风扇常规模式'], ['73–78', '风扇低速模式'], ['79–84', '风扇静音模式'], ['85–135', '无效'],
  ['136–145', '颜色修正开启'], ['146–151', '颜色修正关闭'], ['152–255', '无效'],
]
const sw03AuraProgram = [['0–15', '无效'], ['16–29', '自走效果1'], ['30–44', '自走效果2'], ...Array.from({ length: 14 }, (_, index) => {
  const start = 45 + index * 15
  return [`${start}–${index === 13 ? 255 : start + 14}`, `自走效果${index + 3}`]
})]
const sw03Linear = (name, description) => linear(name, description, description)
const sw03Names17 = names('总调|总调微调|频闪|辅光总调|红色|绿色|蓝色|白色|色温控制|颜色宏和自走模式|自走速度|辅光红色|辅光绿色|辅光蓝色|辅光自走效果|辅光自走速度|参数设置')
const sw03Names12 = names('总调|频闪|红色|绿色|蓝色|白色|色温控制|辅光红色|辅光绿色|辅光蓝色|辅光自走效果|辅光自走速度')
const sw03Names10 = names('红色|绿色|蓝色|白色|色温控制|辅光红色|辅光绿色|辅光蓝色|辅光自走效果|辅光自走速度')
const sw03Names6 = names('红色|绿色|蓝色|白色|辅光自走效果|辅光自走速度')
const sw03Definitions = (names) => names.map((name) => ({
  '总调': sw03Linear('总调', '由暗到亮'), '总调微调': sw03Linear('总调微调', '调光亮度线性微调'), '频闪': ['频闪', '频闪', sw03Strobe],
  '辅光总调': sw03Linear('辅光总调', '辅光圈由暗到亮'), '红色': sw03Linear('红色', '主光红色由暗到亮'), '绿色': sw03Linear('绿色', '主光绿色由暗到亮'),
  '蓝色': sw03Linear('蓝色', '主光蓝色由暗到亮'), '白色': sw03Linear('白色', '主光白色由暗到亮'), '色温控制': ['色温控制', '色温控制', sw03Cct],
  '颜色宏和自走模式': ['颜色宏和自走模式', '颜色宏和自走模式', sw03Macro], '自走速度': sw03Linear('自走速度', '自走效果速度由慢到快'),
  '辅光红色': sw03Linear('辅光红色', '辅光圈红色由暗到亮'), '辅光绿色': sw03Linear('辅光绿色', '辅光圈绿色由暗到亮'), '辅光蓝色': sw03Linear('辅光蓝色', '辅光圈蓝色由暗到亮'),
  '辅光自走效果': ['辅光自走效果', '辅光自走效果', sw03AuraProgram], '辅光自走速度': sw03Linear('辅光自走速度', '辅光自走速度由快变慢'),
  '参数设置': ['参数设置', '参数设置', sw03Config],
}[name] || blank(name)))

const sm3801Strobe = [['0–10', '闭光'], ['11–21', '开光'], ['22–62', '频闪，由慢到快'], ['63–73', '开光'], ['74–114', '快开慢关，由慢到快'], ['115–125', '开光'], ['126–166', '快关慢开，由慢到快'], ['167–177', '开光'], ['178–218', '随机频闪'], ['219–255', '开光']]
const sm3801Color = [['0–10', '白光'], ...Array.from({ length: 24 }, (_, index) => {
  const start = 11 + index * 6
  const end = index === 23 ? 154 : start + 5
  return [`${start}–${end}`, `颜色${index + 1}`]
}), ['155–161', '颜色25'], ['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '停止/白光']]
const sm3801Fixed = numberedWheel(
  [13, 16, 20, 23, 26, 29, 33, 36, 39, 42, 46, 49, 52, 55, 59, 62, 65, 68, 72, 75, 78, 81, 85, 88, 91, 94, 97, 101],
  jitterRanges(102, [104, 106, 109, 111, 114, 116, 119, 121, 124, 126, 129, 131, 134, 136, 139, 141, 144, 146, 149, 151, 154, 156, 159, 161, 164, 167, 169, 171], 28),
  [['172–205', '顺时针旋转，由快到慢'], ['206–207', '停止'], ['208–244', '逆时针旋转，由慢到快'], ['245–255', '停止/白光']],
)
const sm3801Prism = [['0–10', '棱镜关'], ['11–127', '棱镜1开'], ['128–191', '棱镜2开'], ['192–255', '棱镜1/2开']]
const sm3801Macro = macroLampOff.map(([valueText, description]) => {
  if (valueText === '67–72') return [valueText, '风机常规模式']
  if (valueText === '73–78') return [valueText, '风机低速模式']
  if (valueText === '79–84') return [valueText, '无功能']
  return [valueText, description]
})
const sm3801Names13 = names('X轴|Y轴|XY轴速度|调光|频闪|色盘|固定盘|棱镜1/2|棱镜1旋转|棱镜2旋转|雾化|调焦|宏功能')
const sm3801Names15 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|调光|频闪|色盘|固定盘|棱镜1/2|棱镜1旋转|棱镜2旋转|雾化|调焦|宏功能')
const sm3801Definitions = (names) => names.map((name) => ({
  '调光': linear('调光', '暗到亮'), '频闪': d('频闪', sm3801Strobe), '色盘': d('色盘', sm3801Color), '固定盘': d('固定盘', sm3801Fixed),
  '棱镜1/2': d('棱镜1/2', sm3801Prism), '棱镜1旋转': d('棱镜1旋转', prismRotate), '棱镜2旋转': d('棱镜2旋转', prismRotate),
  '雾化': d('雾化', fog), '宏功能': d('宏功能', sm3801Macro),
}[name] || blank(name)))

const sm3402YellowCct = [
  ['0–10', '白光'], ['11–30', '黄色,由浅到深'], ['31–40', '白光'], ['41–161', '色温,由浅到深'], ['162–163', '停止'],
  ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光'],
]
const sm3402MagentaColor = [
  ['0–10', '白光'], ['11–30', '品红,由浅到深'], ['31–40', '白光'],
  ...colorWheel([50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 161], [], '颜色6', '0–10', 41).slice(1),
  ['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光'],
]
const sm3402CyanRotating = [
  ['0–10', '白光'], ['11–30', '青色,由浅到深'], ['31–40', '白光'],
  ...numberedWheel([52, 64, 76, 88, 101], [[102, 115, 5], [116, 129, 4], [130, 144, 3], [145, 158, 2], [159, 171, 1]], [
    ['172–205', '顺时针旋转，由快到慢'], ['206–207', '停止'], ['208–244', '逆时针旋转，由慢到快'], ['245–255', '白光'],
  ], 41).slice(1),
]
const sm3402CutMacro = [
  ['0–10', '无功能'], ...Array.from({ length: 36 }, (_, index) => {
    const start = index === 0 ? 11 : 16 + (index - 1) * 6
    const end = index === 0 ? 15 : start + 5
    return [`${start}–${end}`, `图形${index + 1}`]
  }), ['226–255', '图形自走,由慢到快'],
]
const sm3402Macro = macroLampOff
const sm3402Names13 = names('X轴|Y轴|XY轴速度|调光|频闪|黄色&色温|品红&色盘|青色&旋转图案|旋转图案自转|调焦|变焦|切割宏|宏功能')
const sm3402Names25 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|调光|频闪|黄色&色温|品红&色盘|青色&旋转图案|旋转图案自转|调焦|调焦微调|变焦|变焦微调|切割1|切割2|切割3|切割4|切割5|切割6|切割7|切割8|切割宏|宏功能')
const sm3402Definitions = (names) => names.map((name) => ({
  '调光': linear('调光', '暗到亮'), '频闪': d('频闪', strobe), '黄色&色温': d('黄色&色温', sm3402YellowCct),
  '品红&色盘': d('品红&色盘', sm3402MagentaColor), '青色&旋转图案': d('青色&旋转图案', sm3402CyanRotating),
  '旋转图案自转': d('旋转图案自转', prismRotate), '切割宏': d('切割宏', sm3402CutMacro), '宏功能': d('宏功能', sm3402Macro),
}[name] || blank(name)))

const sm6602Color = colorWheel(
  [15, 21, 26, 32, 37, 43, 48, 54, 59, 65, 70, 76, 81, 87, 92, 98, 103, 109, 114, 120, 125, 131, 136, 142, 147, 153, 161],
  [['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
  '颜色13+白光',
)
const sm6602Fixed = numberedWheel(
  [17, 24, 31, 38, 45, 52, 58, 65, 72, 79, 86, 93, 101],
  jitterRanges(102, [106, 112, 117, 122, 128, 133, 138, 143, 149, 154, 159, 165, 171], 13),
  [['172–205', '顺时针旋转，由快到慢'], ['206–207', '停止'], ['208–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
)
const sm6602Rotating = numberedWheel(
  [20, 30, 40, 50, 60, 70, 80, 90, 101],
  jitterRanges(102, [109, 117, 125, 133, 141, 149, 157, 165, 171], 9),
  [['172–205', '顺时针旋转，由快到慢'], ['206–207', '停止'], ['208–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
)
const sm6602Prism = [['0–10', '棱镜关'], ['11–127', '棱镜1开'], ['128–255', '棱镜2开']]
const sm6602Macro = makeMacro({
  '11–21': '灯泡开', '67–72': '无功能', '73–78': '无功能', '79–84': '无功能',
  '106–111': '无功能', '112–117': '无功能', '200–210': '灯泡关',
})
const sm6602Names16 = names('X轴|Y轴|XY轴速度|调光|频闪|色盘|固定盘|旋转盘|旋转盘旋转|棱镜1/2|棱镜1旋转|棱镜2旋转|雾化|调焦|变焦|宏功能')
const sm6602Names20 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|调光|频闪|色盘|固定盘|旋转盘|旋转盘旋转|棱镜1/2|棱镜1旋转|棱镜2旋转|雾化|调焦|调焦微调|变焦|变焦微调|宏功能')
const sm6602Definitions = (names) => names.map((name) => ({
  '调光': linear('调光', '暗到亮'), '频闪': d('频闪', strobe), '色盘': d('色盘', sm6602Color), '固定盘': d('固定盘', sm6602Fixed),
  '旋转盘': d('旋转盘', sm6602Rotating), '旋转盘旋转': d('旋转盘旋转', prismRotate), '棱镜1/2': d('棱镜1/2', sm6602Prism),
  '棱镜1旋转': d('棱镜1旋转', prismRotate), '棱镜2旋转': d('棱镜2旋转', prismRotate), '雾化': d('雾化', fog), '宏功能': d('宏功能', sm6602Macro),
}[name] || blank(name)))

const sm3502Strobe = [
  ['0–3', '关'], ['4–103', '由慢到快脉冲频闪'], ['104–107', '开'], ['108–207', '由慢到快渐变频闪'],
  ['208–212', '开'], ['213–251', '由慢到快随机频闪'], ['252–255', '开'],
]
const sm3502Fog = [['0–127', '无'], ['128–191', '七彩'], ['192–255', '雾化']]
const sm3502Color = colorWheel(
  [8, 12, 17, 21, 25, 29, 34, 38, 42, 48, 51, 55, 59, 63, 68, 72, 76, 81, 85, 89, 93, 98, 102, 106, 110, 115, 119, 123, 127],
  [['128–192', '顺时针旋转，由快到慢'], ['193–255', '逆时针旋转，由慢到快']],
  '颜色14+颜色15',
  '0–4',
  5,
)
const sm3502Fixed = [
  ['0–3', '白光'], ...numberedWheel(
    [7, 11, 16, 21, 25, 29, 33, 37, 42, 46, 51, 55, 59, 71],
    [],
    [['72–113', '顺时针旋转，由快到慢'], ['114–117', '停止'], ['118–159', '逆时针旋转，由慢到快']],
    4,
  ).slice(1), ...jitterRanges(160, [166, 173, 181, 188, 195, 203, 210, 217, 224, 232, 239, 246, 255], 1, 1)
    .map(([start, end, index]) => [`${start}–${end}`, `图案${index}抖动`]),
]
const sm3502Macro = [
  ['0–99', '无功能'], ['100–105', '3秒后关灯泡'], ['106–199', '无功能'], ['200–205', '3秒后开灯泡'],
  ['206–209', '无功能'], ['210–215', '3秒后复位XY电机'], ['216–219', '无功能'], ['220–235', '3秒后复位效果电机'],
  ['236–239', '无功能'], ['240–255', '3秒后复位整灯'],
]
const sm3502Names16 = names('X轴|Y轴|X轴微调|Y轴微调|XY速度|雾化|频闪|调光|色盘|图盘|棱镜1|棱镜自转|棱镜2|棱镜2自转|调焦|复位/功能')
const sm3502Names18 = names('X轴|Y轴|XY速度|模式|空|雾化|频闪|调光|色盘|图盘|棱镜1|棱镜自转|棱镜2|棱镜2自转|调焦|复位/功能|X轴微调|Y轴微调')
const sm3502Definitions = (names) => newDefinitions(names, {
  '雾化': d('雾化', sm3502Fog), '频闪': d('频闪', sm3502Strobe), '调光': linear('调光', '0-100%调光'),
  '色盘': d('色盘', sm3502Color), '图盘': d('图盘', sm3502Fixed), '棱镜1': d('棱镜1', prism),
  '棱镜自转': d('棱镜自转', prismRotate), '棱镜2': d('棱镜2', prism), '棱镜2自转': d('棱镜2自转', prismRotate),
  '调焦': linear('调焦', '由近到远'), '复位/功能': d('复位/功能', sm3502Macro),
})

const sm9051Color = colorWheel(
  [21, 33, 44, 56, 68, 79, 91, 102, 114, 126, 137, 149, 161],
  [['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光']],
  '颜色6+白光',
)
const sm9051Cmy = [
  ['0–10', '无功能'], ...Array.from({ length: 15 }, (_, index) => [`${11 + index * 14}–${24 + index * 14}`, `颜色${index + 1}`]),
  ['221–255', 'CMY颜色循环，由慢到快'],
]
const sm9051Iris = [
  ['0–21', '开'], ['22–62', '缩小，由慢到快'], ['63–73', '开'], ['74–114', '缩放，快开慢关，由慢到快'],
  ['115–125', '开'], ['126–166', '缩放，快关慢开，由慢到快'], ['167–177', '开'], ['178–218', '缩放，随机效果'], ['219–255', '开'],
]
const prismDual = [['0–10', '棱镜关'], ['11–127', '棱镜1开'], ['128–255', '棱镜2开']]
const fogDual = [['0–10', '关'], ['11–127', '雾化1'], ['128–255', '雾化2']]
const sm9051CutRotate = prismRotate
const sm9051Macro = macroLampOff.map(([valueText, description]) => {
  if (valueText === '67–72') return [valueText, '散热模式：标准']
  if (valueText === '73–78') return [valueText, '散热模式：低速']
  if (valueText === '79–84') return [valueText, '散热模式：静音']
  if (['106–111', '112–117'].includes(valueText)) return [valueText, '无功能']
  return [valueText, description]
})
const sm9051Names27 = names('X轴|Y轴|总调光|频闪|色盘1|色盘2|青色|品红色|黄色|色温|CMY颜色宏|光圈|光圈宏功能|雾化1/雾化2|放大|调焦|切割1|切割2|切割3|切割4|切割5|切割6|切割7|切割8|切割宏|切割旋转|宏功能')
const sm9051Names33 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|总调光|总调光微调|频闪|色盘1|色盘2|青色|品红色|黄色|色温|CMY颜色宏|光圈|光圈宏功能|雾化1/雾化2|放大|放大微调|调焦|调焦微调|切割1|切割2|切割3|切割4|切割5|切割6|切割7|切割8|切割宏|切割旋转|宏功能')
const sm9051Definitions = (names) => newDefinitions(names, {
  '频闪': d('频闪', strobe), '色盘1': d('色盘1', sm9051Color), '色盘2': d('色盘2', sm9051Color),
  'CMY颜色宏': d('CMY颜色宏', sm9051Cmy), '光圈宏功能': d('光圈宏功能', sm9051Iris), '雾化1/雾化2': d('雾化1/雾化2', fogDual),
  '切割宏': d('切割宏', sm3402CutMacro), '切割旋转': d('切割旋转', sm9051CutRotate), '宏功能': d('宏功能', sm9051Macro),
})

const sm9210Color2 = [
  ...colorWheel([17, 24, 31, 38, 45, 53, 60], [], '颜色3+色温'),
  ...[[61, 67, '6500K'], [68, 74, '6200K'], [75, 81, '5600K'], [82, 89, '5500K'], [90, 96, '5000K'], [97, 103, '4600K'],
    [104, 110, '4500K'], [111, 117, '4200K'], [118, 125, '4000K'], [126, 132, '3700K'], [133, 139, '3400K'], [140, 146, '3200K'], [147, 153, '3100K'], [154, 161, '3000K']]
    .map(([start, end, description]) => [`${start}–${end}`, description]),
  ['162–163', '停止'], ['164–202', '顺时针旋转，由快到慢'], ['203–204', '停止'], ['205–244', '逆时针旋转，由慢到快'], ['245–255', '白光'],
]
const sm9210Rotating = [
  ['0–10', '白光'], ['11–25', '图案1'], ['26–40', '图案2'], ['41–55', '图案3'], ['56–70', '图案4'], ['71–85', '图案5'],
  ['86–101', '图案6'], ['102–112', '图案6抖动'], ['113–124', '图案5抖动'], ['125–136', '图案4抖动'], ['137–147', '图案3抖动'],
  ['148–159', '图案2抖动'], ['160–171', '图案1抖动'], ['172–205', '顺时针旋转'], ['206–207', '停止'], ['208–244', '逆时针旋转'], ['245–255', '停止/白光'],
]
const sm9210Effect = [['0–10', '无功能'], ['11–127', '顺时针旋转，由快到慢'], ['128–138', '停止'], ['139–255', '逆时针旋转，由慢到快']]
const sm9210Macro = macroLampOff.map(([valueText, description]) => {
  if (valueText === '67–72') return [valueText, '散热模式：常规']
  if (valueText === '73–78') return [valueText, '散热模式：低速']
  if (valueText === '79–84') return [valueText, '散热模式：静音']
  if (['106–111', '112–117'].includes(valueText)) return [valueText, '无功能']
  return [valueText, description]
})
const sm9210Names21 = names('X轴|Y轴|总调光|频闪|色盘1|色盘2|固定盘|旋转图案盘1|图案旋转1|旋转图案盘2|图案旋转2|效果盘|光圈|光圈宏功能|棱镜1/棱镜2|棱镜1旋转|棱镜2旋转|雾化1/雾化2|放大|调焦|宏功能')
const sm9210Names27 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|总调光|总调光微调|频闪|色盘1|色盘2|固定盘|旋转图案盘1|图案旋转1|旋转图案盘2|图案旋转2|效果盘|光圈|光圈宏功能|棱镜1/棱镜2|棱镜1旋转|棱镜2旋转|雾化1/雾化2|放大|放大微调|调焦|调焦微调|宏功能')
const sm9210Definitions = (names) => newDefinitions(names, {
  '频闪': d('频闪', strobe), '色盘1': d('色盘1', sm9051Color), '色盘2': d('色盘2', sm9210Color2), '固定盘': d('固定盘', sl182Fixed),
  '旋转图案盘1': d('旋转图案盘1', sm9210Rotating), '图案旋转1': d('图案旋转1', prismRotate),
  '旋转图案盘2': d('旋转图案盘2', sm9210Rotating), '图案旋转2': d('图案旋转2', prismRotate),
  '效果盘': d('效果盘', sm9210Effect), '光圈宏功能': d('光圈宏功能', sm9051Iris),
  '棱镜1/棱镜2': d('棱镜1/棱镜2', prismDual), '棱镜1旋转': d('棱镜1旋转', prismRotate),
  '棱镜2旋转': d('棱镜2旋转', prismRotate), '雾化1/雾化2': d('雾化1/雾化2', fogDual), '宏功能': d('宏功能', sm9210Macro),
})

const sm9402Fixed = numberedWheel(
  [23, 36, 49, 62, 75, 88, 101],
  jitterRanges(102, [111, 121, 131, 141, 151, 161, 171], 7),
  [['172–205', '顺时针旋转'], ['206–207', '停止/白光'], ['208–244', '逆时针旋转'], ['245–255', '停止/白光']],
)
const sm9402CutRotate = [['0–255', '滑步0°–90°']]
const sm9402Names32 = names('X轴|Y轴|总调光|频闪|色盘|青色|品红色|黄色|色温|CMY颜色宏|固定盘|旋转图案盘|图案旋转|效果盘|光圈|光圈宏功能|棱镜|棱镜1旋转|雾化1|放大|调焦|切割1|切割2|切割3|切割4|切割5|切割6|切割7|切割8|切割宏|切割旋转|宏功能')
const sm9402Names36 = names('X轴|X轴微调|Y轴|Y轴微调|XY轴速度|总调光|频闪|色盘|青色|品红色|黄色|色温|CMY颜色宏|固定盘|旋转图案盘|图案旋转|效果盘|光圈|光圈宏功能|棱镜|棱镜1旋转|雾化1|放大|调焦|调焦微调|切割1|切割2|切割3|切割4|切割5|切割6|切割7|切割8|切割宏|切割旋转|宏功能')
const sm9402Definitions = (names) => newDefinitions(names, {
  '频闪': d('频闪', strobe), '色盘': d('色盘', sm9051Color),
  'CMY颜色宏': d('CMY颜色宏', sm9051Cmy), '固定盘': d('固定盘', sm9402Fixed), '旋转图案盘': d('旋转图案盘', sm9210Rotating),
  '图案旋转': d('图案旋转', prismRotate), '效果盘': d('效果盘', sm9210Effect), '光圈宏功能': d('光圈宏功能', sm9051Iris),
  '棱镜': d('棱镜', prismDual), '棱镜1旋转': d('棱镜1旋转', prismRotate), '雾化1': d('雾化1', fog),
  '切割宏': d('切割宏', sm3402CutMacro), '切割旋转': d('切割旋转', sm9402CutRotate), '宏功能': d('宏功能', sm9210Macro),
})

// TL-SL3102/3103 的 16CH/36CH 通道表，两型号说明书内容相同。
const sl3102Names16 = names('开关灯|自走速度/声控灵敏度|图案组/动态效果组|图案/动态效果选择|颜色|颜色变化速度|图案线/点|图案大小|Z轴旋转|X轴旋转|Y轴旋转|水平移动|垂直移动|缩放|渐变|X/Y波浪')
const sl3102Names36 = names('开关灯|自走速度/声控灵敏度|图案组/动态效果组|图案/动态效果选择|图案大小|水平位置粗调|垂直位置粗调|颜色|颜色变化速度|图案线/点|频闪|Z轴旋转|X轴旋转|Y轴旋转|水平移动|垂直移动|缩放|渐变|X/Y波浪|图案库|图案|图案大小|水平位置粗调|垂直位置粗调|颜色|颜色变化速度|图案线/点|频闪|Z轴旋转|X轴旋转|Y轴旋转|水平移动|垂直移动|缩放|渐变|X/Y波浪')
const sl3102OnOff = [['0', '关灯'], ['1–255', '开灯1%-100%']]
const sl3102RunSpeed = [['0–26', '默认自走速度'], ['27–127', '自走效果整体速度由慢到快'], ['128–255', '声控灵敏度选择']]
const sl3102Group = [['0–127', '每16级选择一个图案组'], ['128–255', '每16级选择一个动态效果组']]
const sl3102Selection = [['0–1', '图案模式每5级选择图案；动态效果模式播放所选效果组全部节目'], ['2–255', '图案模式每5级选择图案；动态效果模式每2级选择一个效果节目']]
const sl3102Color = [['0–3', '本色'], ['4–31', '固定七色（每4级一色）'], ['32–35', '七彩色变化'], ['36–39', 'RGB变化'], ['40–43', '本色变化'], ['44–239', '颜色组合'], ['240–255', '渐变']]
const sl3102ColorSpeed = [['0–3', '关闭'], ['4–127', '正向由慢到快'], ['128–255', '反向由慢到快']]
const sl3102Line = [['0–63', '亮线扫描速度'], ['64–127', '线扫描'], ['128–255', '点扫描']]
const sl3102Z = [['1–127', '旋转Z角度选择'], ['128–255', '旋转Z速度选择']]
const sl3102X = [['1–127', '旋转X角度选择'], ['128–255', '旋转X速度选择']]
const sl3102Y = [['1–127', '旋转Y角度选择'], ['128–255', '旋转Y速度选择']]
const sl3102Horizontal = [['1–127', '水平位置选择'], ['128–255', '水平移动速度选择']]
const sl3102Vertical = [['1–127', '垂直位置选择'], ['128–255', '垂直移动速度选择']]
const sl3102Zoom = [['1–127', '缩放大小选择'], ['128–255', '缩放速度选择']]
const sl3102Gradient = [['1–255', '渐变变化']]
const sl3102Wave = [['1–127', 'X波浪速度'], ['128–255', 'Y波浪速度']]
const sl3102Library = [['0–255', '每16级一个图案库']]
const sl3102Pattern = [['0–255', '每5级一个图案']]
const sl3102Definitions16 = sl3102Names16.map((name) => ({
  '开关灯': d(name, sl3102OnOff), '自走速度/声控灵敏度': d(name, sl3102RunSpeed), '图案组/动态效果组': d(name, sl3102Group),
  '图案/动态效果选择': d(name, sl3102Selection), '颜色': d(name, sl3102Color), '颜色变化速度': d(name, sl3102ColorSpeed),
  '图案线/点': d(name, sl3102Line), '图案大小': linear(name, '图案由大到小选择'), 'Z轴旋转': d(name, sl3102Z), 'X轴旋转': d(name, sl3102X),
  'Y轴旋转': d(name, sl3102Y), '水平移动': d(name, sl3102Horizontal), '垂直移动': d(name, sl3102Vertical), '缩放': d(name, sl3102Zoom),
  '渐变': d(name, sl3102Gradient), 'X/Y波浪': d(name, sl3102Wave),
}[name] || blank(name)))
const sl3102Definitions36 = sl3102Names36.map((name, index) => {
  if (index === 0) return d(name, sl3102OnOff)
  if (index === 1) return d(name, sl3102RunSpeed)
  if (index === 2) return d(name, sl3102Group)
  if (index === 3) return d(name, sl3102Selection)
  if ([4, 21].includes(index)) return linear(name, '图案由大到小选择')
  if ([5, 22].includes(index)) return d(name, [['0–255', '水平位置粗调（128为中心，超出边界关闭）']])
  if ([6, 23].includes(index)) return d(name, [['0–255', '垂直位置粗调（128为中心，超出边界关闭）']])
  if ([7, 24].includes(index)) return d(name, sl3102Color)
  if ([8, 25].includes(index)) return d(name, sl3102ColorSpeed)
  if ([9, 26].includes(index)) return d(name, sl3102Line)
  if ([10, 27].includes(index)) return d(name, [['1–255', '频闪速度选择']])
  if (name === 'Z轴旋转') return d(name, sl3102Z)
  if (name === 'X轴旋转') return d(name, sl3102X)
  if (name === 'Y轴旋转') return d(name, sl3102Y)
  if (name === '水平移动') return d(name, sl3102Horizontal)
  if (name === '垂直移动') return d(name, sl3102Vertical)
  if (name === '缩放') return d(name, sl3102Zoom)
  if (['渐变'].includes(name)) return d(name, sl3102Gradient)
  if (name === 'X/Y波浪') return d(name, sl3102Wave)
  if (index === 19) return d(name, sl3102Library)
  if (index === 20) return d(name, sl3102Pattern)
  return blank(name)
})
const sl3102Modes = [mode(16, sl3102Definitions16), mode(36, sl3102Definitions36)]

const stageLightingChannelProfilesExtra = {
  'TL-SL105': profile('TL-SL105', 'itc产品说明书 TL-SL105-UM-CN@V20240928.pdf', [19, 20, 21, 22], 'PDF第19–22页', [
    mode(13, sl105Definitions(sl105Names13)), mode(16, sl105Definitions(sl105Names16)),
  ]),
  'TL-SL182': profile('TL-SL182', 'itc产品说明书 TL-SL182-UM-CN@V20241206.pdf', [19, 20, 21], 'PDF第19–21页', [
    mode(17, sl182Definitions(sl182Names17, macroLampOff)), mode(15, sl182Definitions(sl182Names15, macroLampOff)),
  ]),
  'TL-SL184': profile('TL-SL184', 'itc产品说明书 TL-SL184-UM-CN@V20240905.pdf', [19, 20, 21], 'PDF第19–21页', [
    mode(17, sl182Definitions(sl182Names17, macroLamp)), mode(15, sl182Definitions(sl182Names15, macroLamp)),
  ]),
  'TL-SL185': profile('TL-SL185', 'TL-SL185-UM-CN.pdf', [20, 21, 22, 23], 'PDF第20–23页', [
    mode(25, sl185Definitions(sl185Names25)), mode(21, sl185Definitions(sl185Names21)),
  ]),
  'TL-SL186': profile('TL-SL186', 'itc产品说明书 TL-SL186-UM-CN.pdf', [20, 21, 22, 23], 'PDF第20–23页', [
    mode(21, sl186Definitions(sl186Names21)), mode(25, sl186Definitions(sl186Names25)),
  ]),
  'TL-SL155': profile('TL-SL155', 'TL-SL155-UM-CN.pdf', [4, 5], 'PDF第4–5页', [
    mode(16, sl155Definitions(sl155Names16)), mode(24, sl155Definitions(sl155Names24)),
  ]),
  'TL-SW03': profile('TL-SW03', 'itc产品说明书 TL-SW03-UM-CN@V20240812.pdf', [3, 4], 'PDF第3–4页', [
    mode(17, sw03Definitions(sw03Names17)), mode(12, sw03Definitions(sw03Names12)), mode(10, sw03Definitions(sw03Names10)), mode(6, sw03Definitions(sw03Names6)),
  ]),
  'TL-SM3801': profile('TL-SM3801', 'itc产品说明书 TL-SM3801-UM-CN@V20250430.pdf', [18, 19, 20, 21], 'PDF第18–21页', [
    mode(13, sm3801Definitions(sm3801Names13)), mode(15, sm3801Definitions(sm3801Names15)),
  ]),
  'TL-SM3402': profile('TL-SM3402', 'itc产品说明书 TL-SM3402-UM-CN@V20260629.pdf', [15, 16, 17], 'PDF第15–17页', [
    mode(13, sm3402Definitions(sm3402Names13)), mode(25, sm3402Definitions(sm3402Names25)),
  ]),
  'TL-SM6602': profile('TL-SM6602', 'itc产品说明书 TL-SM6602-UM-CN@V20250331.pdf', [19, 20, 21, 22], 'PDF第19–22页', [
    mode(20, sm6602Definitions(sm6602Names20)), mode(16, sm6602Definitions(sm6602Names16)),
  ]),
  'TL-SM3502IP': profile('TL-SM3502IP', 'itc产品说明书TL-SM3502IP-UM-CN.pdf', [16, 17, 18, 19, 20, 21], 'PDF第16–21页', [
    mode(16, sm3502Definitions(sm3502Names16)), mode(18, sm3502Definitions(sm3502Names18)),
  ]),
  'TL-SM9051': profile('TL-SM9051', 'itc产品说明书 TL-SM9051-UM-CN.pdf', [17, 18, 19, 20, 21], 'PDF第17–21页', [
    mode(27, sm9051Definitions(sm9051Names27)), mode(33, sm9051Definitions(sm9051Names33)),
  ]),
  'TL-SM9210': profile('TL-SM9210', 'itc产品说明 TL-SM9210-UM-CN.pdf', [16, 17, 18, 19, 20], 'PDF第16–20页', [
    mode(21, sm9210Definitions(sm9210Names21)), mode(27, sm9210Definitions(sm9210Names27)),
  ]),
  'TL-SM9402IP': profile('TL-SM9402IP', 'itc产品说明 TL-SM9402IP-UM-CN.pdf', [16, 17, 18, 19, 20], 'PDF第16–20页', [
    mode(32, sm9402Definitions(sm9402Names32)), mode(36, sm9402Definitions(sm9402Names36)),
  ]),
  'TL-SL3102': profile('TL-SL3102', 'itc-产品说明书 TL-SL3102-UM-CN.pdf', [10, 11, 12], 'PDF第10–12页', sl3102Modes),
  'TL-SL3103': profile('TL-SL3103', 'itc产品说明书 TL-SL3103.pdf', [10, 11, 12], 'PDF第10–12页', sl3102Modes),
}

module.exports = { stageLightingChannelProfilesExtra }
