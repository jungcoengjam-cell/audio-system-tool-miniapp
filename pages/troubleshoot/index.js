const result={
  help:{action:'先确认现场信息',checks:['记录设备型号、异常范围和面板状态。','按设备说明确认后返回继续，不要猜测观察结果。']},
  sourceResult:{action:'声源与输入',checks:['确认声源正在播放且未静音。','核对对应输入接口和连接；别直接拉满增益。'],feedback:true},
  routeResult:{action:'总线与输出',checks:['核对静音、通道发送与总线分配。','核对物理输出映射，按既有方案逐项核对而非复位。'],feedback:true},
  linkResult:{action:'供电与外部连接',checks:['核对该路供电、输入选择和静音。','按底部安全提示检查功放到音箱的外部连接。','仍无声联系维护人员。'],feedback:true},
  protectResult:{action:'设备保护状态',checks:['保持静音，停止加大音量。','勿绕过保护，按设备说明联系维护人员。']},
  lineResult:{action:'控台输出与DMX线路',checks:['核对控台输出、分配器供电/输入与实际DMX连线。','不能仅凭指示灯断言灯具损坏；安全断电后检查外部连接。'],feedback:true},
  addressResult:{action:'型号、地址与通道模式',checks:['确认控台所选灯具型号与实际灯具一致。','核对起始地址及通道模式。'],tool:'dmx-address',feedback:true},
  universeResult:{action:'实际输出域与线路映射',checks:['核对A/B域标记和真实输出口/分配器线路映射。','起始地址相同不代表来自同一域。'],tool:'dmx-address',feedback:true},
  controlResult:{action:'控台控制状态',checks:['核对Blackout/总控、调光、快门等控制状态。','按该型号通道表逐项确认；仍异常联系维护人员。','不建议直接推满所有通道。'],feedback:true},
}
const trees={
  audio:{title:'音箱没声音',cat:'音频',scope:'as',nodes:{
    as:['是全部没声音，还是只有部分？','', [['全部','ai'],['部分','ao'],['不确定','help']]],
    ai:['播放时，对应输入电平表有信号吗？','确认所看的是输入表，不是输出或监听表。',[['有','ao'],['无','sourceResult'],['不确定','help']]],
    ao:['对应输出电平表有信号吗？','核对目标总线/物理输出，PFL监听有声不等于主输出有声。',[['有','ap'],['无','routeResult'],['不确定','help']]],
    ap:['功放或有源音箱有保护/故障提示吗？','同时确认设备已正常供电；指示灯含义以本机说明书为准。',[['有','protectResult'],['无','linkResult'],['没开机/无法判断','help']]],
  }},
  lighting:{title:'灯具不受控',cat:'灯光',scope:'ls',nodes:{
    ls:['一台不响应，还是一组/全部？','',[['一台','la'],['一组或全部','li'],['不确定','help']]],
    li:['灯具是否显示收到DMX信号？','先确认供电和DMX控制模式，状态含义以本机说明书为准。',[['是','la'],['否','lineResult'],['不确定','help']]],
    la:['灯具起始地址和通道模式与控台一致吗？','同时核对灯具型号；同地址但通道模式不同也不能直接匹配。',[['一致','lu'],['不一致','addressResult'],['不确定','help']]],
    lu:['实际信号线路输出的域，与控台配置一致吗？','沿控台输出→分配器→灯具核对；灯具通常只显示起始地址。',[['一致','controlResult'],['不一致','universeResult'],['不确定','help']]],
  }},
}
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const isState = (value) => value === 'restored' || value === 'ongoing'
const { vibrate } = require('../../utils/haptics')

Page({
  data: {
    invalid: false, title: '', category: '', node: '', step: 0, question: '', hint: '',
    options: [], selectedIndex: null, history: [], result: null, pathExpanded: false,
    feedback: null, scrollTop: 0,
  },
  onLoad(query) {
    this.type = query && query.type
    const tree = own(trees, this.type) ? trees[this.type] : null
    if (!tree) return this.setData({ invalid: true })
    this.tree = tree
    this.setData({ title: tree.title, category: tree.cat, node: tree.scope })
    this.render(tree.scope, [], null)
  },
  render(id, history, selectedIndex) {
    if (!this.tree || !own(this.tree.nodes, id)) return
    const node = this.tree.nodes[id]
    const validSelection = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < node[2].length
    this.setData({
      node: id, step: history.length + 1, question: node[0], hint: node[1],
      options: node[2].map((item, index) => ({ label: item[0], index, selected: validSelection && index === selectedIndex })),
      selectedIndex: validSelection ? selectedIndex : null, history, result: null,
      feedback: null, pathExpanded: false, scrollTop: this.data.scrollTop ? 0 : 1,
    })
  },
  showResult(id, history) {
    if (!own(result, id)) return
    const item=result[id]
    this.setData({
      result: { action: item.action, checks: item.checks, feedbackEnabled: !!item.feedback, tool: item.tool },
      node: id, history, pathExpanded: false,
      scrollTop: this.data.scrollTop ? 0 : 1,
    })
  },
  answer(event) {
    if (!this.tree || !event || !event.currentTarget) return
    const dataset = event.currentTarget.dataset || {}
    if (dataset.node !== this.data.node || this.data.result) return
    if (!((typeof dataset.index === 'number') || (typeof dataset.index === 'string' && dataset.index.trim() !== ''))) return
    const index = Number(dataset.index)
    const node = this.tree.nodes[this.data.node]
    if (!node || !Number.isInteger(index) || index < 0 || index >= node[2].length) return
    const option = node[2][index]
    const history = this.data.history.concat({
      id: this.data.node, question: node[0],
      label: option[0], index, from: this.data.node, to: option[1],
    })
    if (own(result, option[1])) {
      this.showResult(option[1], history)
      vibrate('light')
    } else if (own(this.tree.nodes, option[1])) {
      this.render(option[1], history, null)
      vibrate('light')
    }
  },
  back() {
    const history = this.data.history.slice()
    if (!history.length) return
    const last = history.pop()
    this.render(last.from, history, last.index)
    vibrate('light')
  },
  restart() {
    if (!this.tree) return
    const changed = this.data.node !== this.tree.scope || this.data.history.length > 0
      || Boolean(this.data.result || this.data.pathExpanded || this.data.feedback || this.data.selectedIndex !== null)
    this.render(this.tree.scope, [], null)
    if (changed) vibrate('light')
  },
  togglePath(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset
    if (!this.data.result || !dataset || dataset.node !== this.data.node) return
    this.setData({ pathExpanded: !this.data.pathExpanded })
    vibrate('light')
  },
  editStep(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset
    if (!dataset || !((typeof dataset.step === 'number') || (typeof dataset.step === 'string' && dataset.step.trim() !== ''))) return
    const index = Number(dataset.step)
    if (!this.data.result || !this.data.pathExpanded || dataset.node !== this.data.node
      || !Number.isInteger(index) || index < 0 || index >= this.data.history.length) return
    const item = this.data.history[index]
    this.render(item.id, this.data.history.slice(0, index), item.index)
    vibrate('light')
  },
  feedback(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset
    if (!this.data.result || !this.data.result.feedbackEnabled || !dataset
      || dataset.node !== this.data.node || !isState(dataset.state)) return
    if (this.data.feedback === dataset.state) return
    this.setData({ feedback: dataset.state })
    vibrate('light')
  },
  openTool() {
    if (this.data.result && this.data.result.tool === 'dmx-address') {
      wx.navigateTo({ url: '/pages/dmx-address/dmx-address' })
    }
  },
})
