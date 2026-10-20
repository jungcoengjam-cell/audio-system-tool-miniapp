const {
  buildMaterialSummary,
  buildScheduleText,
  normalizeSchedule,
  CABLE_OPTIONS,
  CONNECTOR_OPTIONS,
  STATUS_OPTIONS,
} = require('../../utils/project-wiring')
const { buildWorkspace } = require('./workspace-model')

const REPORT_WIDTH = 720
const MAX_PAGE_HEIGHT = 1750
const CONTENT_BOTTOM = 1640
const BODY_WIDTH = 608
const BODY_SIZE = 22
const BODY_LINE_HEIGHT = 32
const LINE_CARD_X = 40
const LINE_CARD_WIDTH = 640
const LINE_CONTENT_X = 56
const LINE_CONTENT_WIDTH = 608
const LINE_COLUMN_GAP = 24
const LINE_COLUMN_WIDTH = (LINE_CONTENT_WIDTH - LINE_COLUMN_GAP) / 2
const LINE_DESTINATION_X = LINE_CONTENT_X + LINE_COLUMN_WIDTH + LINE_COLUMN_GAP
const LINE_MAX_PAGE_HEIGHT = 1500
const LINE_CONTENT_BOTTOM = 1380
const LINE_FOOTER_RESERVE = 112
const LINE_VALUE_SIZE = 30
const LINE_IMPORTANT_SIZE = 28
const LINE_SMALL_SIZE = 18
const LINE_PROJECT_NAME_SIZE = 28
const LINE_SUMMARY_SIZE = 24
const LINE_VALUE_HEIGHT = 39
const LINE_BLOCK_GAP = 7

const LIGHT = Object.freeze({
  background: '#f5f5f7', card: '#ffffff', text: '#1d1d1f', secondary: '#5f5f64',
  tertiary: '#74747a', border: '#e1e1e6', accent: '#0066cc', accentSoft: '#eaf3ff',
  warning: '#8a5700', warningSoft: '#fff5df', source: '#2872c7', destination: '#7358c7',
})
const DARK = Object.freeze({
  background: '#000000', card: '#1c1c1e', text: '#f5f5f7', secondary: '#c5c5cb',
  tertiary: '#a0a0a7', border: '#38383a', accent: '#69aef7', accentSoft: '#172b43',
  warning: '#ffbf5c', warningSoft: '#3a2d17', source: '#76b8ff', destination: '#bea6ff',
})
function labelsById(options) {
  const labels = {}
  options.forEach((item) => { labels[item.id] = item.label })
  return Object.freeze(labels)
}

const CABLE_LABELS = labelsById(CABLE_OPTIONS)
const CONNECTOR_LABELS = labelsById(CONNECTOR_OPTIONS)
const STATUS_LABELS = labelsById(STATUS_OPTIONS)
const CLOSING_PUNCTUATION = new Set([...`，。；：、！？）》】〕〉”’」』…％,.;:!?)]}`])

function estimatedCharacterWidth(character, size) {
  if (/\s/.test(character)) return size * 0.34
  if (/^[\x00-\xff]$/.test(character)) return size
  return size
}

function wrapText(value, width = BODY_WIDTH, size = BODY_SIZE) {
  const result = []
  String(value || '').split(/\r?\n/).forEach((part) => {
    const words = [...part]
    let line = ''
    let lineWidth = 0
    words.forEach((character) => {
      const nextWidth = estimatedCharacterWidth(character, size)
      if (line && lineWidth + nextWidth > width) {
        if (CLOSING_PUNCTUATION.has(character) && [...line].length > 1) {
          const parts = [...line]
          const carried = parts.pop()
          result.push(parts.join(''))
          line = `${carried}${character}`
          lineWidth = [...line].reduce((sum, item) => sum + estimatedCharacterWidth(item, size), 0)
        } else {
          result.push(line)
          line = character
          lineWidth = nextWidth
        }
      } else {
        line += character
        lineWidth += nextWidth
      }
    })
    result.push(line)
  })
  return result.length ? result : ['']
}

function estimateLineWidth(value, size) {
  return [...String(value || '')].reduce((total, character) => {
    if (/\s/.test(character)) return total + (size * 0.34)
    if (/^[\x00-\xff]$/.test(character)) {
      const width = /[._-]/.test(character) ? 0.5
        : /[WM@#%]/.test(character) ? 1.15
          : /[mw]/.test(character) ? 1
            : character === 'I' ? 0.5
              : /[A-Z]/.test(character) ? 0.9 : 0.68
      return total + (size * width)
    }
    return total + size
  }, 0)
}

function wrapLineValue(value, width, size) {
  const result = []
  String(value === null || value === undefined ? '' : value).split(/\r?\n/).forEach((paragraph) => {
    let line = ''
    const writeToken = (token) => {
      if (line && estimateLineWidth(`${line}${token}`, size) <= width) {
        line += token
        return
      }
      if (line && CLOSING_PUNCTUATION.has(token) && [...line].length > 1) {
        const characters = [...line]
        const carried = characters.pop()
        result.push(characters.join(''))
        line = `${carried}${token}`
        return
      }
      if (line) {
        result.push(line)
        line = ''
      }
      if (estimateLineWidth(token, size) <= width) {
        line = token
        return
      }
      let part = ''
      ;[...token].forEach((character) => {
        if (part && estimateLineWidth(`${part}${character}`, size) > width) {
          if (CLOSING_PUNCTUATION.has(character) && [...part].length > 1) {
            const characters = [...part]
            const carried = characters.pop()
            result.push(characters.join(''))
            part = `${carried}${character}`
          } else {
            result.push(part)
            part = character
          }
        } else part += character
      })
      line = part
    }
    const tokens = paragraph.match(/\s+|[A-Za-z0-9]+(?:[-._×/+：:][A-Za-z0-9]+)*|./gu) || ['']
    tokens.forEach(writeToken)
    result.push(line)
  })
  return result.length ? result : ['']
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.keys(value).forEach((key) => freezeDeep(value[key]))
  return Object.freeze(value)
}

function materialItemText(item) {
  const title = item.title.replace(/规格待填写/g, '规格待确认')
  if (item.key.startsWith('bulk:')) {
    const length = item.unknownLengthCount
      ? `已知长度：${item.quantity} m · 待确认长度：${item.unknownLengthCount} 条`
      : `总长度：${item.totalLengthText}`
    return [title, length]
  }
  if (item.key.startsWith('connector:')) {
    return [title, item.quantity === null ? item.detail : `数量：${item.quantity} ${item.unit}`]
  }
  return [title, item.detail, `数量：${item.quantity} ${item.unit}`, `总长：${item.totalLengthText}`]
}

function buildRows(schedule, summary, type) {
  if (type === 'materials') {
    const rows = []
    const sections = [
      ['成品线（含两端接头）', summary.finished],
      ['散线', summary.bulk],
      ['散线接头（单独核对）', summary.connectors],
    ]
    sections.forEach(([title, items]) => {
      if (!items.length) return
      rows.push({ kind: 'section', title, textLines: [title] })
      items.forEach((item, index) => rows.push({
        kind: 'material',
        key: item.key,
        number: index + 1,
        title: item.title,
        detail: item.detail,
        quantity: item.quantity,
        unit: item.unit,
        lengthText: item.lengthText,
        totalLengthText: item.totalLengthText,
        unknownLengthCount: item.unknownLengthCount,
        textLines: materialItemText(item),
      }))
    })
    const incompleteLineCount = schedule.lines.filter((line) => !line.spec || !line.connectorA
      || !line.connectorB || !line.lengthText).length
    if (rows.length && incompleteLineCount) rows.unshift({
      kind: 'notice',
      textLines: [`有 ${incompleteLineCount} 条线路资料待补全；缺项不作为确定采购量。`],
    })
    return rows
  }

  if (type === 'labels') {
    const labels = summary.labels || []
    return labels.map((label, index) => ({
      kind: 'label',
      key: `${label.code}:${label.direction}:${index}`,
      code: label.code,
      local: label.local,
      remote: label.remote,
      direction: label.direction,
      side: label.direction === 'to' ? '源端标签' : '目的端标签',
      textLines: [
        `${label.code} · ${label.direction === 'to' ? '源端标签' : '目的端标签'}`,
        `本端：${label.local}`,
        `对端：${label.remote}`,
      ],
    }))
  }

  return schedule.lines.map((line, index) => {
    const from = [line.fromDevice, line.fromPort].filter(Boolean).join(' / ')
    const to = [line.toDevice, line.toPort].filter(Boolean).join(' / ')
    const spec = line.spec || '规格待确认'
    const connectorA = CONNECTOR_LABELS[line.connectorA] || (line.connectorA || '接头待确认')
    const connectorB = CONNECTOR_LABELS[line.connectorB] || (line.connectorB || '接头待确认')
    const cable = CABLE_LABELS[line.cableType] || '线材待确认'
    const length = line.lengthText ? `${line.lengthText} m` : '长度待确认'
    return {
      kind: 'line',
      key: line.id,
      number: index + 1,
      code: line.code,
      purpose: line.purpose || '用途待填写',
      status: STATUS_LABELS[line.status] || '状态待确认',
      from,
      to,
      cable,
      spec,
      connectorA,
      connectorB,
      length,
      notes: line.notes || '',
      fields: {
        code: String(line.code || ''),
        purpose: line.purpose || '用途待填写',
        status: STATUS_LABELS[line.status] || '状态待确认',
        from: {
          device: line.fromDevice || '待填写',
          port: line.fromPort || '待填写',
          connector: connectorA,
        },
        to: {
          device: line.toDevice || '待填写',
          port: line.toPort || '待填写',
          connector: connectorB,
        },
        cable,
        spec,
        length,
        notes: line.notes || '',
      },
      textLines: [
        `${index + 1}. ${line.code} · ${line.purpose || '用途待填写'} · ${STATUS_LABELS[line.status] || '状态待确认'}`,
        `起点：${from} → 终点：${to}`,
        `线材：${cable} · 规格：${spec}`,
        `两端接头：${connectorA} → ${connectorB} · 长度：${length}`,
        ...(line.notes ? [`备注：${line.notes}`] : []),
      ],
    }
  })
}

function makeLinePart(id, label, value, x, width, options = {}) {
  const fontSize = options.fontSize || LINE_VALUE_SIZE
  const labelSize = options.labelSize || LINE_SMALL_SIZE
  const lines = wrapLineValue(value, width, fontSize)
  const labelWidth = estimateLineWidth(label, labelSize)
  const inline = lines.length === 1 && estimateLineWidth(lines[0], fontSize) <= width - labelWidth - 8
  const lineHeight = fontSize >= LINE_IMPORTANT_SIZE ? LINE_VALUE_HEIGHT : fontSize + 8
  return {
    id,
    label,
    lines,
    x,
    width,
    fontSize,
    labelSize,
    role: options.role || 'text',
    column: options.column || 'full',
    inline,
    lineHeight,
    height: inline ? Math.max(fontSize, labelSize) + 12 : 52 + ((lines.length - 1) * lineHeight),
  }
}

function makePartItems(part, top = 0, labelOverride = part.label, lines = part.lines) {
  const label = labelOverride
  const labelWidth = estimateLineWidth(label, part.labelSize)
  const inline = part.inline && label === part.label && lines.length === 1
  const items = []
  if (inline) {
    items.push({
      text: label, x: part.x, y: top + 33, fontSize: part.labelSize,
      colorRole: 'secondary', weight: 500, align: 'left', fieldId: `${part.id}.label`,
      column: part.column, boundsX: part.x, boundsWidth: part.width,
    })
    items.push({
      text: lines[0], x: part.x + labelWidth + 8, y: top + 33, fontSize: part.fontSize,
      colorRole: part.role, weight: 600, align: 'left', fieldId: `${part.id}.value`,
      column: part.column, boundsX: part.x + labelWidth + 8,
      boundsWidth: Math.max(1, part.width - labelWidth - 8),
    })
    return items
  }
  items.push({
    text: label, x: part.x, y: top + 17, fontSize: part.labelSize,
    colorRole: 'secondary', weight: 500, align: 'left', fieldId: `${part.id}.label`,
    column: part.column, boundsX: part.x, boundsWidth: part.width,
  })
  lines.forEach((text, index) => items.push({
    text,
    x: part.x,
    y: top + 46 + (index * part.lineHeight),
    fontSize: part.fontSize,
    colorRole: part.role,
    weight: 600,
    align: 'left',
    fieldId: `${part.id}.value`,
    column: part.column,
    boundsX: part.x,
    boundsWidth: part.width,
  }))
  return items
}

function makeLineBlock(id, parts, height, options = {}) {
  const items = parts.flatMap((part) => makePartItems(part))
  return {
    id,
    parts,
    items,
    height: height || Math.max(...parts.map((part) => part.height), 0),
    gapAfter: options.gapAfter === undefined ? LINE_BLOCK_GAP : options.gapAfter,
    section: options.section || '',
    endpointHeading: Boolean(options.endpointHeading),
  }
}

function makeLineHeaderBlock(source, continuation = false) {
  const code = `${source.fields.code || '线号待确认'}${continuation ? '（续）' : ''}`
  const codeLines = wrapLineValue(code, LINE_CONTENT_WIDTH, 32)
  const items = [
    {
      text: `第 ${source.number} 条`, x: LINE_CONTENT_X, y: 28, fontSize: 16,
      colorRole: 'secondary', weight: 500, align: 'left', fieldId: 'sequence',
      column: 'full', boundsX: LINE_CONTENT_X, boundsWidth: LINE_CONTENT_WIDTH,
    },
    {
      text: source.fields.status, x: LINE_CONTENT_X + LINE_CONTENT_WIDTH, y: 30, fontSize: LINE_IMPORTANT_SIZE,
      colorRole: 'accent', weight: 600, align: 'right', fieldId: 'status',
      column: 'full', boundsX: LINE_CONTENT_X, boundsWidth: LINE_CONTENT_WIDTH,
    },
    ...codeLines.map((text, index) => ({
      text, x: LINE_CONTENT_X, y: 68 + (index * 42), fontSize: 32,
      colorRole: 'accent', weight: 700, align: 'left', fieldId: 'code',
      column: 'full', boundsX: LINE_CONTENT_X, boundsWidth: LINE_CONTENT_WIDTH,
    })),
  ]
  return {
    id: continuation ? 'line-header-continuation' : 'line-header',
    parts: [],
    items,
    height: 80 + ((codeLines.length - 1) * 42),
    gapAfter: LINE_BLOCK_GAP,
    section: '',
  }
}

function makeEndpointHeadingBlock() {
  return {
    id: 'endpoint-headings',
    parts: [],
    items: [
      {
        text: '起点', x: LINE_CONTENT_X, y: 32, fontSize: LINE_IMPORTANT_SIZE,
        colorRole: 'source', weight: 600, align: 'left', fieldId: 'from.heading',
        column: 'left', boundsX: LINE_CONTENT_X, boundsWidth: LINE_COLUMN_WIDTH,
      },
      {
        text: '终点', x: LINE_DESTINATION_X, y: 32, fontSize: LINE_IMPORTANT_SIZE,
        colorRole: 'destination', weight: 600, align: 'left', fieldId: 'to.heading',
        column: 'right', boundsX: LINE_DESTINATION_X, boundsWidth: LINE_COLUMN_WIDTH,
      },
    ],
    height: 40,
    gapAfter: 3,
    section: 'endpoints',
    endpointHeading: true,
  }
}

function makeLineContentBlocks(source, continuation = false) {
  const fields = source.fields
  const start = LINE_CONTENT_X
  const end = LINE_DESTINATION_X
  const columnOptions = (column, role) => ({ column, role })
  const blocks = [
    makeLineHeaderBlock(source, continuation),
    makeLineBlock('purpose', [makeLinePart('purpose', '用途', fields.purpose,
      LINE_CONTENT_X, LINE_CONTENT_WIDTH, { fontSize: LINE_IMPORTANT_SIZE })]),
    makeEndpointHeadingBlock(),
  ]
  const endpointFields = [
    ['device', '设备'],
    ['port', '端口'],
    ['connector', '线缆侧端头'],
  ]
  endpointFields.forEach(([field, label]) => {
    const leftPart = makeLinePart(`from.${field}`, label, fields.from[field], start,
      LINE_COLUMN_WIDTH, columnOptions('left', 'source'))
    const rightPart = makeLinePart(`to.${field}`, label, fields.to[field], end,
      LINE_COLUMN_WIDTH, columnOptions('right', 'destination'))
    blocks.push(makeLineBlock(`endpoint-${field}`, [leftPart, rightPart], 0, { section: 'endpoints' }))
  })
  blocks.push(makeLineBlock('cable-length', [
    makeLinePart('cable', '线材', fields.cable, start, LINE_COLUMN_WIDTH,
      { fontSize: LINE_IMPORTANT_SIZE, labelSize: 16, column: 'left' }),
    makeLinePart('length', '长度', fields.length, end, LINE_COLUMN_WIDTH,
      { fontSize: LINE_IMPORTANT_SIZE, labelSize: 16, column: 'right' }),
  ]))
  blocks.push(makeLineBlock('spec', [makeLinePart('spec', '规格', fields.spec,
    LINE_CONTENT_X, LINE_CONTENT_WIDTH, { fontSize: LINE_IMPORTANT_SIZE })]))
  if (fields.notes) {
    blocks.push(makeLineBlock('notes', [makeLinePart('notes', '备注', fields.notes,
      LINE_CONTENT_X, LINE_CONTENT_WIDTH, { fontSize: LINE_IMPORTANT_SIZE })]))
  }
  return blocks
}

function lineCardHeight(blocks) {
  if (!blocks.length) return 0
  return 24 + blocks.reduce((total, block, index) => total + block.height
    + (index < blocks.length - 1 ? block.gapAfter : 0), 0)
}

function splitLineBlock(block, maximumHeight) {
  const maximumLines = Math.max(1, Math.floor((maximumHeight - 53) / LINE_VALUE_HEIGHT) + 1)
  const longest = Math.max(...block.parts.map((part) => part.lines.length))
  if (longest <= maximumLines) return [block]
  const chunks = []
  for (let start = 0; start < longest; start += maximumLines) {
    const parts = block.parts.map((part) => ({
      ...part,
      label: start ? `${part.label}（续）` : part.label,
      lines: part.lines.slice(start, start + maximumLines),
      inline: false,
      height: 52 + (Math.min(part.lines.length - start, maximumLines) - 1) * part.lineHeight,
    }))
    chunks.push(makeLineBlock(block.id, parts, 0, { section: block.section }))
  }
  return chunks
}

function fragmentLineRow(source, maximumHeight) {
  const originalBlocks = makeLineContentBlocks(source)
  const header = originalBlocks[0]
  let current = [header]
  const fragments = []
  const startContinuation = (nextBlock) => {
    current = [makeLineHeaderBlock(source, true)]
    if (nextBlock.section === 'endpoints' && !nextBlock.endpointHeading) current.push(makeEndpointHeadingBlock())
  }
  const finish = () => {
    if (current.length) fragments.push(current)
  }
  originalBlocks.slice(1).forEach((block) => {
    if (lineCardHeight([...current, block]) <= maximumHeight) {
      current.push(block)
      return
    }
    if (current.length > 1) {
      finish()
      startContinuation(block)
    }
    const available = maximumHeight - lineCardHeight(current) - block.gapAfter
    if (block.height <= available) {
      current.push(block)
      return
    }
    const pieces = splitLineBlock(block, available)
    pieces.forEach((piece, index) => {
      if (lineCardHeight([...current, piece]) > maximumHeight) {
        finish()
        startContinuation(block)
      }
      current.push(piece)
      if (index < pieces.length - 1) {
        finish()
        startContinuation(block)
      }
    })
  })
  finish()
  return fragments.map((blocks, index) => ({ source, blocks, continuation: index > 0, partIndex: index }))
}

function layoutLineFragment(fragment, y) {
  const row = fragment.source
  let offset = 12
  const blocks = []
  fragment.blocks.forEach((block, index) => {
    const items = block.items.map((item) => ({
      ...item,
      y: y + offset + item.y,
      bounds: {
        x: item.boundsX,
        y: y + offset + item.y - item.fontSize,
        width: item.boundsWidth,
        height: item.fontSize + 4,
      },
    }))
    blocks.push({ id: block.id, section: block.section, y: y + offset, height: block.height, items })
    offset += block.height + (index < fragment.blocks.length - 1 ? block.gapAfter : 0)
  })
  const height = offset + 12
  const drawItems = blocks.flatMap((block) => block.items)
  return {
    ...row,
    kind: fragment.continuation ? 'continuation' : 'line',
    key: `${row.key}:part:${fragment.partIndex}`,
    lineId: row.key,
    continuation: fragment.continuation,
    partIndex: fragment.partIndex,
    blocks,
    drawItems,
    lines: drawItems.map((item) => item.text),
    x: LINE_CARD_X,
    width: LINE_CARD_WIDTH,
    y,
    height,
  }
}

function paginateLineRows(rows, projectName, title, summaryLine) {
  const nameLines = wrapLineValue(projectName, LINE_CONTENT_WIDTH, LINE_PROJECT_NAME_SIZE)
  const summaryLines = wrapLineValue(summaryLine, LINE_CONTENT_WIDTH, LINE_SUMMARY_SIZE)
  const titleY = 58
  const nameY = 86
  const nameLineHeight = 36
  const summaryY = nameY + (nameLines.length * nameLineHeight) + 5
  const summaryLineHeight = 30
  const startY = summaryY + (summaryLines.length * summaryLineHeight) + 15
  const availableHeight = LINE_CONTENT_BOTTOM - startY
  const fragmentRows = rows.flatMap((row) => fragmentLineRow(row, availableHeight))
  const groups = []
  let group = []
  let used = 0
  fragmentRows.forEach((fragment, index) => {
    const estimatedHeight = lineCardHeight(fragment.blocks)
    const forceBreak = fragment.continuation && index > 0
    if (group.length && (forceBreak || used + estimatedHeight + 10 > availableHeight)) {
      groups.push(group)
      group = []
      used = 0
    }
    const y = startY + used
    const row = layoutLineFragment(fragment, y)
    group.push(row)
    used += row.height + 10
  })
  if (group.length) groups.push(group)
  return groups.map((pageRows, index) => {
    const contentBottom = pageRows.reduce((bottom, row) => Math.max(bottom, row.y + row.height), startY)
    const height = Math.min(LINE_MAX_PAGE_HEIGHT, Math.max(420, contentBottom + LINE_FOOTER_RESERVE))
    return freezeDeep({
      type: 'lines',
      title,
      projectName,
      width: REPORT_WIDTH,
      height,
      pageNumber: index + 1,
      pageCount: groups.length,
      nameLines,
      subtitleLines: summaryLines,
      titleY,
      nameY,
      nameLineHeight,
      nameFontSize: LINE_PROJECT_NAME_SIZE,
      summaryY,
      summaryLineHeight,
      summaryFontSize: LINE_SUMMARY_SIZE,
      startY,
      contentBottom,
      footer: `第 ${index + 1} / ${groups.length} 页 · 以现场核对为准`,
      rows: pageRows,
    })
  })
}

function layoutRows(sourceRows, startY) {
  let y = startY
  return sourceRows.map((source) => {
    const fontSize = source.kind === 'section' ? 18 : BODY_SIZE
    const wrapped = source.textLines.flatMap((line) => wrapText(line, BODY_WIDTH, fontSize))
    const padding = source.kind === 'section' ? 14 : 22
    const lineHeight = source.kind === 'section' ? 30 : BODY_LINE_HEIGHT
    const height = Math.max(source.kind === 'section' ? 44 : 54, padding + (wrapped.length * lineHeight))
    const row = {
      ...source,
      lines: wrapped,
      y,
      height,
      fontSize,
      lineHeight,
    }
    y += height + (source.kind === 'section' ? 2 : 10)
    return row
  })
}

function splitOversizedRows(rows, availableHeight) {
  const maxLines = Math.max(1, Math.floor((availableHeight - 80) / BODY_LINE_HEIGHT))
  return rows.flatMap((row) => {
    const measured = layoutRows([row], 0)[0]
    if (measured.height <= availableHeight) return [row]
    const chunks = []
    for (let index = 0; index < measured.lines.length; index += maxLines) {
      const lines = measured.lines.slice(index, index + maxLines)
      chunks.push(index === 0 ? { ...row, textLines: lines }
        : {
          ...row,
          kind: 'continuation',
          key: `${row.key || row.kind}:continuation:${index}`,
          textLines: [`${row.code || '内容'}（续）`, ...lines],
        })
    }
    return chunks
  })
}

function paginateRows(rows, projectName, title, subtitleLines, type) {
  const nameLines = wrapText(projectName, BODY_WIDTH, 19)
  const subtitleY = 132 + (nameLines.length * 25) + 3
  const startY = subtitleY + (subtitleLines.length * 20) + 10
  const availableHeight = CONTENT_BOTTOM - startY
  const pageableRows = splitOversizedRows(rows, availableHeight)
  const groups = []
  let group = []
  let used = 0
  pageableRows.forEach((row, index) => {
    const measured = layoutRows([row], 0)[0]
    const rowHeight = measured.height + (row.kind === 'section' ? 2 : 10)
    const nextRow = pageableRows[index + 1]
    const nextMeasured = nextRow ? layoutRows([nextRow], 0)[0] : null
    const nextHeight = nextMeasured ? nextMeasured.height + 10 : 0
    if (row.kind === 'section' && group.length && used + rowHeight + nextHeight > availableHeight) {
      groups.push(group)
      group = []
      used = 0
    }
    if (group.length && used + rowHeight > availableHeight) {
      groups.push(group)
      group = []
      used = 0
    }
    group.push(row)
    used += rowHeight
  })
  if (group.length) groups.push(group)
  return groups.map((pageRows, index) => {
    const pageLayout = layoutRows(pageRows, startY)
    const contentEnd = pageLayout.reduce((bottom, row) => Math.max(bottom, row.y + row.height), startY)
    const height = Math.min(MAX_PAGE_HEIGHT, Math.max(520, contentEnd + 88))
    return freezeDeep({
      type,
      title,
      projectName,
      width: REPORT_WIDTH,
      height,
      pageNumber: index + 1,
      pageCount: groups.length,
      nameLines,
      subtitleLines,
      rows: pageLayout,
      footer: `项目布线资料 · 第 ${index + 1} / ${groups.length} 页 · 以现场核对为准`,
    })
  })
}

// The project report is a presentation of the same workspace used by both tabs.
// Keep the legacy report types below intact for existing saved/report consumers.
const PROJECT_REPORT = Object.freeze({
  width: 720, maxHeight: 1750, margin: 20, innerLeft: 20, innerRight: 700,
  bottom: 1640, groupGap: 12, nameSize: 30, nameLineHeight: 38,
  rowMinHeight: 54, rowLineHeight: 26,
  text: '#111111', secondary: '#3F454D', border: '#D7DCE2', accent: '#111111',
  background: '#ffffff', groupHeader: '#F1F3F5', columnHeader: '#F7F8FA',
  columns: [
    { id: 'displayNumber', fieldId: 'header.displayNumber', label: '\u7f16\u53f7', x: 20, width: 64 },
    { id: 'ports', fieldId: 'header.ports', label: '\u6765\u6e90 \u2192 \u76ee\u6807\u7aef\u53e3', x: 84, width: 162 },
    { id: 'spec', fieldId: 'header.spec', label: '\u89c4\u683c', x: 246, width: 196 },
    { id: 'length', fieldId: 'header.length', label: '\u957f\u5ea6', x: 442, width: 48 },
    { id: 'connectors', fieldId: 'header.connectors', label: 'A \u63a5\u5934 \u2192 B \u63a5\u5934', x: 490, width: 210 },
  ],
})

function estimateProjectPortLineWidth(value, size) {
  const characterWidth = [...String(value || '')].reduce((total, character) => {
    return total + Math.max(
      estimateProjectLineWidth(character, size),
      /[0-9]/.test(character) ? size * 0.64 : 0
    )
  }, 0)
  return characterWidth * 1.1
}

function wrapProjectPortText(value, width, size) {
  const text = String(value === null || value === undefined ? '' : value).replace(/\r\n?|\n/g, ' ')
  if (estimateProjectPortLineWidth(text, size) <= width) return [text]
  const lines = []
  let line = ''
  for (const character of [...text]) {
    const candidate = line + character
    if (line && estimateProjectPortLineWidth(candidate, size) > width) {
      lines.push(line)
      line = character
    } else {
      line = candidate
    }
  }
  if (line || !lines.length) lines.push(line)
  return lines
}

function wrapProjectText(value, width, size) {
  const text = String(value === null || value === undefined ? '' : value).replace(/\r\n?|\n/g, ' ')
  if (estimateProjectLineWidth(text, size) <= width) return [text]
  return wrapLineValue(text, width, size)
}

function estimateProjectLineWidth(value, size) {
  return [...String(value || '')].reduce((total, character) => {
    if (/\s/.test(character)) return total + size * 0.28
    if (character === '\u00b2') return total + size * 0.56
    if (character === '\u00d7' || character === '\u2192') return total + size * 0.9
    if (/^[\x00-\xff]$/.test(character)) {
      if (/[ilI1|.,:;!'`]/.test(character)) return total + size * 0.3
      if (/[MW@#%&]/.test(character)) return total + size * 0.85
      if (/[mw]/.test(character)) return total + size * 0.8
      if (/[A-Z]/.test(character)) return total + size * 0.62
      if (/[0-9]/.test(character)) return total + size * 0.56
      if (/[a-z]/.test(character)) return total + size * 0.5
      if (/[-_+()[\]\/]/.test(character)) return total + size * 0.38
      return total + size * 0.5
    }
    return total + size
  }, 0)
}

function projectTextItems(value, fieldId, x, top, width, size, lineHeight, options = {}) {
  const lines = wrapProjectText(value, Math.max(1, width - (options.inset || 0)), size)
  const align = options.align || 'left'
  const boundsX = x + (options.inset || 0) / 2
  const boundsWidth = width - (options.inset || 0)
  return {
    lines,
    height: lines.length * lineHeight,
    items: lines.map((text, index) => ({
      text, fieldId,
      x: align === 'right' ? boundsX + boundsWidth : align === 'center' ? boundsX + boundsWidth / 2 : boundsX,
      y: top + size + index * lineHeight,
      fontSize: size,
      colorRole: options.colorRole || 'text',
      weight: options.weight || 500,
      align,
      bounds: { x: boundsX, y: top + index * lineHeight, width: boundsWidth, height: lineHeight },
    })),
  }
}

function projectGroupRow(group) {
  const left = projectTextItems(group.fromDevice || '\u672a\u586b\u5199', 'from.device', 30, 7, 282, 18, 24,
    { weight: 600, inset: 4 })
  const arrow = projectTextItems('\u2192', 'group.direction', 318, 7, 72, 18, 24,
    { align: 'center', colorRole: 'secondary' })
  const right = projectTextItems(group.toDevice || '\u672a\u586b\u5199', 'to.device', 408, 7, 282, 18, 24,
    { weight: 600, inset: 4 })
  return {
    kind: 'project-group', key: group.key, groupKey: group.key,
    fromDevice: group.fromDevice || '\u672a\u586b\u5199', toDevice: group.toDevice || '\u672a\u586b\u5199',
    fromDeviceId: group.fromDeviceId, toDeviceId: group.toDeviceId,
    drawItems: [...left.items, ...arrow.items, ...right.items],
    height: Math.max(38, Math.max(left.height, right.height) + 14),
  }
}

function projectColumnsRow() {
  const height = 30
  const drawItems = PROJECT_REPORT.columns.map((column) => {
    const result = projectTextItems(column.label, column.fieldId, column.x + 4, (height - 18) / 2,
      column.width - 8, 14, 18, { align: 'center', colorRole: 'secondary', weight: 600 })
    return result.items[0]
  })
  return { kind: 'project-columns', height, drawItems }
}

function projectNumberLines(value) {
  const text = String(value === null || value === undefined || value === '' ? '\u2014' : value)
  return { text, lines: wrapProjectText(text, 50, 18), size: 18 }
}

function projectLineRow(line, groupKey) {
  const displayNumber = line.displayNumber
  if (!Number.isSafeInteger(displayNumber) || displayNumber < 1) {
    throw new TypeError('\u9879\u76ee\u7ebf\u8def\u7f3a\u5c11\u6709\u6548\u663e\u793a\u7f16\u53f7')
  }
  const number = projectNumberLines(displayNumber)
  const displayValue = (value) => String(value === null || value === undefined ? '' : value).replace(/\r\n?|\n/g, ' ')
  const fromPort = displayValue(line.fromPort || '\u672a\u586b\u5199')
  const toPort = displayValue(line.toPort || '\u672a\u586b\u5199')
  const connectorA = displayValue(line.connectorA ? line.connectorALabel : '\u5f85\u586b\u5199')
  const connectorB = displayValue(line.connectorB ? line.connectorBLabel : '\u5f85\u586b\u5199')
  const fields = {
    displayNumber: number.text,
    ports: fromPort + ' \u2192 ' + toPort,
    spec: displayValue(line.spec ? line.specLabel : '\u5f85\u586b\u5199'),
    length: displayValue(line.lengthText ? line.lengthLabel : '\u5f85\u786e\u8ba4'),
    connectors: connectorA + ' \u2192 ' + connectorB,
    fromPort,
    toPort,
    connectorA,
    connectorB,
    raw: {
      displayNumber: String(displayNumber === null || displayNumber === undefined ? '\u2014' : displayNumber),
      circleLabel: String(line.circleLabel || '\u2014'),
      fromPort: String(line.fromPort || ''),
      toPort: String(line.toPort || ''),
      spec: String(line.spec || ''),
      length: String(line.lengthText || ''),
      connectorA: String(line.connectorA || ''),
      connectorB: String(line.connectorB || ''),
    },
  }
  const fieldLayouts = PROJECT_REPORT.columns.map((column) => {
    if (column.id === 'displayNumber') return { column, lines: number.lines, size: number.size, lineHeight: 22 }
    const size = column.id === 'connectors' || column.id === 'length' ? 18 : 20
    const lineHeight = column.id === 'connectors' || column.id === 'length' ? 22 : 26
    const lines = column.id === 'ports' || (column.id === 'length' && line.lengthText)
      ? wrapProjectPortText(fields[column.id], column.width - 10, size)
      : wrapProjectText(fields[column.id], column.width - 10, size)
    return { column, lines, size, lineHeight }
  })
  const contentHeight = Math.max(...fieldLayouts.map((layout) => layout.lines.length * layout.lineHeight))
  const height = Math.max(PROJECT_REPORT.rowMinHeight, contentHeight + 8)
  const drawItems = []
  fieldLayouts.forEach(({ column, lines, size, lineHeight }) => {
    const fieldTop = (height - lines.length * lineHeight) / 2
    const align = column.id === 'displayNumber' ? 'center' : 'left'
    const inset = column.id === 'displayNumber' ? 7 : 5
    const width = column.width - inset * 2
    lines.forEach((text, index) => {
      const boundsY = fieldTop + index * lineHeight
      drawItems.push({
        text, fieldId: column.id,
        x: align === 'center' ? column.x + column.width / 2 : column.x + inset,
        y: boundsY + size,
        fontSize: size,
        colorRole: 'text',
        weight: column.id === 'ports' ? 600 : 500,
        align,
        bounds: { x: column.x + inset, y: boundsY, width, height: lineHeight },
      })
    })
  })
  return {
    kind: 'project-line', key: line.id, lineId: line.id, groupKey,
    displayNumber: number.text, fields, height, drawItems,
  }
}

function positionProjectRow(row, y) {
  return {
    ...row, x: PROJECT_REPORT.margin, width: PROJECT_REPORT.innerRight - PROJECT_REPORT.innerLeft, y,
    drawItems: row.drawItems.map((item) => ({
      ...item, y: y + item.y, bounds: { ...item.bounds, y: y + item.bounds.y },
    })),
    ...(Array.isArray(row.primitives) ? {
      primitives: row.primitives.map((item) => ({ ...item, y: y + item.y })),
    } : {}),
  }
}

function buildProjectWiringReportPages(projectName, scheduleValue) {
  const workspace = buildWorkspace(scheduleValue)
  const name = String(projectName || '').trim() || '\u672a\u547d\u540d\u9879\u76ee'
  const nameLines = wrapProjectText(name, PROJECT_REPORT.innerRight - PROJECT_REPORT.innerLeft, PROJECT_REPORT.nameSize)
  const nameY = 32
  const titleY = nameY + nameLines.length * PROJECT_REPORT.nameLineHeight + 14
  const startY = titleY + 42
  const pages = []
  let rows = []
  let y = startY
  const finishPage = () => {
    if (!rows.length) return
    pages.push({
      type: 'project', title: '\u9879\u76ee\u7ebf\u8def\u6e05\u5355', projectName: name, width: PROJECT_REPORT.width,
      height: Math.max(1, Math.min(PROJECT_REPORT.maxHeight, y + 32)), lineCount: workspace.lineCount,
      nameLines, nameY, nameFontSize: PROJECT_REPORT.nameSize,
      nameLineHeight: PROJECT_REPORT.nameLineHeight,
      titleY, startY, contentBottom: y,
      subtitleLines: ['\u5171 ' + workspace.lineCount + ' \u6761\u7ebf\u8def'], rows,
    })
    rows = []
    y = startY
  }
  workspace.groups.forEach((group) => {
    const heading = projectGroupRow(group)
    const columns = projectColumnsRow()
    const lineRows = group.lines.map((line) => projectLineRow(line, group.key))
    let needsHeading = true
    lineRows.forEach((lineRow) => {
      const prefixHeight = needsHeading ? heading.height + columns.height + (rows.length ? PROJECT_REPORT.groupGap : 0) : 0
      if (rows.length && y + prefixHeight + lineRow.height > PROJECT_REPORT.bottom) {
        finishPage()
        needsHeading = true
      }
      if (needsHeading) {
        if (rows.length) y += PROJECT_REPORT.groupGap
        rows.push(positionProjectRow(heading, y)); y += heading.height
        rows.push(positionProjectRow(columns, y)); y += columns.height
        needsHeading = false
      }
      if (y + lineRow.height > PROJECT_REPORT.bottom) {
        finishPage()
        rows.push(positionProjectRow(heading, y)); y += heading.height
        rows.push(positionProjectRow(columns, y)); y += columns.height
      }
      if (y + lineRow.height > PROJECT_REPORT.bottom) throw new RangeError('\u7ebf\u8def\u884c\u8d85\u51fa\u9875\u9762\u53ef\u7528\u533a\u57df')
      rows.push(positionProjectRow(lineRow, y)); y += lineRow.height
    })
  })
  finishPage()
  pages.forEach((page, index) => { page.pageNumber = index + 1; page.pageCount = pages.length })
  const text = [name, '\u9879\u76ee\u7ebf\u8def\u6e05\u5355', '\u5171 ' + workspace.lineCount + ' \u6761\u7ebf\u8def',
    ...workspace.groups.flatMap((group) => [
      group.fromDevice + ' \u2192 ' + group.toDevice,
      ...group.lines.map((line) => {
        const row = projectLineRow(line, group.key)
        return [row.fields.displayNumber, row.fields.ports, row.fields.spec, row.fields.length, row.fields.connectors].join(' | ')
      }),
    ])].join('\n')
  return freezeDeep({ pages, text, title: '\u9879\u76ee\u7ebf\u8def\u6e05\u5355', lineCount: workspace.lineCount, type: 'project' })
}

function strokeProjectLine(context, x1, y1, x2, y2, color, width) {
  context.setStrokeStyle(color)
  context.setLineWidth(width)
  context.beginPath()
  context.moveTo(x1, y1)
  context.lineTo(x2, y2)
  context.stroke()
}

function drawProjectWiringReport(context, page) {
  const colors = PROJECT_REPORT
  context.setFillStyle(colors.background)
  context.fillRect(0, 0, page.width, page.height)
  page.nameLines.forEach((line, index) => drawText(context, line, PROJECT_REPORT.innerLeft,
    page.nameY + page.nameFontSize + index * page.nameLineHeight,
    page.nameFontSize, colors.text, 700))
  drawText(context, page.title, PROJECT_REPORT.innerLeft, page.titleY + 22, 22, colors.secondary, 600)
  drawText(context, page.subtitleLines[0], PROJECT_REPORT.innerRight, page.titleY + 21, 14, colors.secondary, 500, 'right')
  page.rows.forEach((row) => {
    if (row.kind === 'project-group') {
      roundedRect(context, row.x, row.y, row.width, row.height, 10, colors.groupHeader)
    } else if (row.kind === 'project-columns') {
      context.setFillStyle(colors.columnHeader)
      context.fillRect(row.x, row.y, row.width, row.height)
      strokeProjectLine(context, row.x, row.y + row.height, row.x + row.width, row.y + row.height, colors.border, 1)
    } else if (row.kind === 'project-line') {
      context.setFillStyle(colors.background)
      context.fillRect(row.x, row.y, row.width, row.height)
      strokeProjectLine(context, row.x, row.y + row.height, row.x + row.width, row.y + row.height, colors.border, 1)
      PROJECT_REPORT.columns.slice(1).forEach((column) => {
        strokeProjectLine(context, column.x, row.y + 5, column.x, row.y + row.height - 5, colors.border, 1)
      })
    }
    row.drawItems.forEach((item) => drawText(context, item.text, item.x, item.y, item.fontSize,
      item.colorRole === 'secondary' ? colors.secondary : colors.text, item.weight, item.align))
  })
  return { height: page.height, contentHeight: page.height }
}
function buildScheduleReportPages(projectName, scheduleValue, type = 'lines') {
  if (type === 'project') return buildProjectWiringReportPages(projectName, scheduleValue)
  const normalizedType = ['lines', 'materials', 'labels'].includes(type) ? type : 'lines'
  const schedule = normalizeSchedule(scheduleValue)
  const summary = buildMaterialSummary(schedule)
  const name = String(projectName || '').trim() || '未命名项目'
  const titles = { lines: '线路明细', materials: '材料清单', labels: '双端线号标签' }
  const summaryLine = normalizedType === 'materials'
    ? `已知总长 ${summary.knownLengthText} · ${summary.unknownLengthCount} 条长度待确认`
    : normalizedType === 'labels'
      ? `共 ${summary.labels.length} 张标签 · 每条线路两端各一张`
      : `共 ${summary.lineCount} 条 · 已核对 ${summary.checkedCount} 条 · 待核对 ${summary.lineCount - summary.checkedCount} 条`
  const text = buildScheduleText(name, schedule).replace(/规格待填写/g, '规格待确认')
  const rows = buildRows(schedule, summary, normalizedType)
  const pages = rows.length
    ? (normalizedType === 'lines'
      ? paginateLineRows(rows, name, titles.lines, summaryLine)
      : paginateRows(rows, name, titles[normalizedType], [summaryLine], normalizedType))
    : []
  return freezeDeep({ pages, text, lineCount: summary.lineCount, type: normalizedType })
}

function palette(theme) {
  return theme === 'dark' ? DARK : LIGHT
}

function setText(context, size, color, weight = 400, align = 'left') {
  context.setFontSize(size)
  context.setFillStyle(color)
  context.setTextAlign(align)
  context.setTextBaseline('alphabetic')
  context.font = `${weight} ${size}px sans-serif`
}

function drawText(context, value, x, y, size, color, weight = 400, align = 'left') {
  setText(context, size, color, weight, align)
  context.fillText(String(value), x, y)
}

function roundedRect(context, x, y, width, height, radius, fill, stroke) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
  if (fill) {
    context.setFillStyle(fill)
    context.fill()
  }
  if (stroke) {
    context.setStrokeStyle(stroke)
    context.setLineWidth(1)
    context.stroke()
  }
}

function drawLineScheduleReport(context, page, colors) {
  context.setFillStyle(colors.background)
  context.fillRect(0, 0, page.width, page.height)
  drawText(context, page.title, 40, page.titleY, 28, colors.text, 700)
  page.nameLines.forEach((line, index) => drawText(context, line, LINE_CONTENT_X,
    page.nameY + 26 + (index * page.nameLineHeight), page.nameFontSize, colors.secondary, 500))
  page.subtitleLines.forEach((line, index) => drawText(context, line, LINE_CONTENT_X,
    page.summaryY + 22 + (index * page.summaryLineHeight), page.summaryFontSize, colors.tertiary, 500))
  const roleColors = {
    text: colors.text,
    secondary: colors.secondary,
    accent: colors.accent,
    source: colors.source,
    destination: colors.destination,
  }
  page.rows.forEach((row) => {
    roundedRect(context, row.x, row.y, row.width, row.height, 14, colors.card, colors.border)
    row.drawItems.forEach((item) => drawText(context, item.text, item.x, item.y, item.fontSize,
      roleColors[item.colorRole] || colors.text, item.weight, item.align))
  })
  context.setStrokeStyle(colors.border)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(40, page.height - 56)
  context.lineTo(680, page.height - 56)
  context.stroke()
  drawText(context, page.footer, 40, page.height - 30, 13, colors.tertiary, 400)
  return { height: page.height, contentHeight: page.height }
}

function drawScheduleReport(context, page, options = {}) {
  if (!context || !page || !Array.isArray(page.rows)) throw new TypeError('布线报告页面无效')
  if (page.type === 'project') return drawProjectWiringReport(context, page)
  const colors = palette(options.theme)
  if (page.type === 'lines') return drawLineScheduleReport(context, page, colors)
  context.setFillStyle(colors.background)
  context.fillRect(0, 0, page.width, page.height)
  roundedRect(context, 40, 30, 168, 34, 17, colors.accentSoft)
  drawText(context, '项目布线资料', 124, 53, 15, colors.accent, 600, 'center')
  drawText(context, page.title, 40, 98, 30, colors.text, 700)
  let nameY = 132
  page.nameLines.forEach((line, index) => {
    drawText(context, line, 40, nameY + (index * 25), 19, colors.secondary, 500)
  })
  const subtitleY = nameY + (page.nameLines.length * 25) + 3
  page.subtitleLines.forEach((line, index) => drawText(context, line, 40,
    subtitleY + (index * 20), 14, colors.tertiary, 500))
  page.rows.forEach((row) => {
    const cardColor = row.kind === 'notice' ? colors.warningSoft : colors.card
    roundedRect(context, 40, row.y, 640, row.height, row.kind === 'label' ? 18 : 14,
      cardColor, colors.border)
    if (row.kind === 'label') {
      const sideColor = row.direction === 'to' ? colors.source : colors.destination
      context.setFillStyle(sideColor)
      context.fillRect(40, row.y + 8, 5, row.height - 16)
    }
    row.lines.forEach((line, index) => {
      const isHeadline = index === 0 && ['line', 'material', 'label', 'section', 'continuation'].includes(row.kind)
      const color = row.kind === 'notice' ? colors.warning
        : row.kind === 'label' && index === 0 ? (row.direction === 'to' ? colors.source : colors.destination)
          : isHeadline ? colors.text : colors.secondary
      drawText(context, line, 56, row.y + 25 + (index * row.lineHeight), row.fontSize, color,
        isHeadline ? 600 : 400)
    })
  })
  context.setStrokeStyle(colors.border)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(40, page.height - 60)
  context.lineTo(680, page.height - 60)
  context.stroke()
  drawText(context, page.footer, 40, page.height - 30, 13, colors.tertiary, 400)
  return { height: page.height, contentHeight: page.height }
}

module.exports = {
  buildScheduleReportPages,
  drawScheduleReport,
}
