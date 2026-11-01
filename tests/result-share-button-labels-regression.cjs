'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const CASES = [
  {
    file: 'templates/result-report-preview.wxml',
    footerClass: ['result-report-preview-actions', 'result-footer'],
    handlers: ['shareResultReportImage', 'saveResultReportImage'],
  },
  {
    file: 'pages/gain-structure/gain-overlays.wxml',
    footerClass: ['share-actions', 'result-footer'],
    handlers: ['shareResultReportImage', 'saveResultReportImage'],
  },
  {
    file: 'pages/limiter/limiter-overlays.wxml',
    footerClass: ['share-actions', 'result-footer'],
    handlers: ['shareResultReportImage', 'saveResultReportImage'],
  },
  {
    file: 'pages/spl/spl.wxml',
    footerClass: ['share-actions', 'result-footer'],
    footerId: 'splShareActions',
    handlers: ['shareResultReportImage', 'saveResultReportImage'],
  },
  {
    file: 'pages/led-screen/led-overlays.wxml',
    footerClass: ['led-report-actions', 'result-footer'],
    handlers: ['shareReportImage', 'saveReportImage'],
  },
  {
    file: 'pages/dmx-address/dmx-address.wxml',
    footerClass: ['result-report-preview-actions', 'result-footer'],
    handlers: ['shareResultReportImage', 'saveResultReportImage'],
  },
  {
    file: 'pages/dmx-layout/dmx-layout.wxml',
    footerClass: ['export-actions', 'result-footer'],
    handlers: ['shareImage', 'saveImage'],
  },
  {
    file: 'pages/project-wiring/index.wxml',
    footerClass: ['wiring-sheet-actions', 'wiring-report-actions', 'result-footer'],
    handlers: ['shareReportImage', 'saveReportImage'],
  },
]
const EXPECTED_LABELS = ['分享图片', '保存到相册']

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function findElement(source, tag, predicate) {
  const startTag = new RegExp(`<${tag}\\b[^>]*>`, 'g')
  let match
  while ((match = startTag.exec(source))) {
    if (!predicate(match[0])) continue
    const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'g')
    token.lastIndex = match.index
    let depth = 0
    let current
    while ((current = token.exec(source))) {
      if (current[0].startsWith('</')) depth -= 1
      else if (!current[0].endsWith('/>')) depth += 1
      if (depth === 0) {
        return source.slice(match.index, token.lastIndex)
      }
    }
    throw new Error(`Unclosed <${tag}> element`)
  }
  throw new Error(`Missing expected <${tag}>`)
}

function findResultImageFooter(source, item) {
  return findElement(source, 'view', openingTag => {
    const classes = openingTag.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || []
    if (!item.footerClass.every(name => classes.includes(name))) return false
    if (item.footerId && !new RegExp(`\\bid="${item.footerId}"`).test(openingTag)) return false
    return true
  })
}

function buttonsIn(source) {
  return [...source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({
    attributes: match[1],
    label: match[2].trim(),
    handler: match[1].match(/\bbindtap="([^"]+)"/)?.[1] || '',
  }))
}

function checkCase(item) {
  const footer = findResultImageFooter(read(item.file), item)
  const buttons = buttonsIn(footer)
  if (buttons.length !== 2) throw new Error(`${item.file}: expected exactly two result-image footer buttons, found ${buttons.length}`)
  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index]
    if (button.handler !== item.handlers[index]) {
      throw new Error(`${item.file}: button ${index + 1} expected bindtap="${item.handlers[index]}", found "${button.handler || '(missing)'}"`)
    }
    if (button.label !== EXPECTED_LABELS[index]) {
      throw new Error(`${item.file}: button ${index + 1} expected “${EXPECTED_LABELS[index]}”, found “${button.label}”`)
    }
  }
}

function checkPdfControl() {
  const pdfButtons = buttonsIn(read('pages/records/report.wxml'))
    .filter(button => button.handler === 'shareReportPdf')
  if (pdfButtons.length !== 1 || pdfButtons[0].label !== '分享 PDF') {
    throw new Error('PDF share action must remain “分享 PDF” → shareReportPdf')
  }
}

function main() {
  const failures = []
  for (const item of CASES) {
    try {
      checkCase(item)
      console.log(`PASS ${item.file}`)
    } catch (error) {
      failures.push({ file: item.file, error: error.message })
      console.error(`FAIL ${item.file}: ${error.message}`)
    }
  }
  try {
    checkPdfControl()
    console.log('PASS pages/records/report.wxml: PDF share remains separate')
  } catch (error) {
    failures.push({ file: 'pages/records/report.wxml', error: error.message })
    console.error(`FAIL pages/records/report.wxml: ${error.message}`)
  }

  if (failures.length) {
    console.error(`FAIL result share labels: ${CASES.length - failures.length}/${CASES.length} image windows pass; ${failures.length} failure(s)`)
    console.error(JSON.stringify(failures, null, 2))
    process.exitCode = 1
    return
  }
  console.log(`PASS result share labels: ${CASES.length} image windows; PDF action remains separate`)
}

main()
