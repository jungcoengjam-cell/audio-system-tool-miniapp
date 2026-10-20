'use strict'

const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const output = path.join(__dirname, 'evidence', 'compile')
const compilerRoot = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
const wxmlFiles = [
  'pages/tools/tools.wxml',
  'pages/projects/projects.wxml',
  'pages/records/project.wxml',
  'pages/records/report.wxml',
  'pages/project-wiring/index.wxml',
  'pages/project-wiring/workspace.wxml',
  'pages/project-wiring/workspace-header.wxml',
  'pages/cable/cable.wxml',
  'pages/cable/cable-overlays.wxml',
  'pages/camera/camera.wxml',
  'pages/camera/camera-overlays.wxml',
  'pages/audio-wiring/index.wxml',
  'pages/audio-wiring/report-bridge.wxml',
  'pages/audio-wiring/wiring-overlays.wxml',
  'pages/led-screen/led-screen.wxml',
  'pages/led-screen/led-overlays.wxml',
  'pages/spl/spl.wxml',
  'pages/project-wiring/report-bridge.wxml',
]
const wxssFiles = [
  'pages/tools/tools.wxss',
  'pages/projects/projects.wxss',
  'pages/records/project.wxss',
  'pages/records/report.wxss',
  'pages/project-wiring/index.wxss',
  'pages/project-wiring/workspace.wxss',
  'pages/cable/cable.wxss',
  'pages/camera/camera.wxss',
  'pages/audio-wiring/index.wxss',
  'pages/audio-wiring/report-bridge.wxss',
  'pages/led-screen/led-screen.wxss',
  'pages/spl/spl.wxss',
  'pages/project-wiring/report-bridge.wxss',
  'styles/homepage.wxss',
  'styles/theme-page-shared.wxss',
  'app.wxss',
]

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
}

function execute(name, executable, args, files) {
  const result = childProcess.spawnSync(path.join(compilerRoot, executable), args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  return {
    name,
    executable: path.join(compilerRoot, executable),
    args,
    files,
    exitCode: result.status,
    error: result.error ? result.error.message : null,
    stderr: result.stderr || '',
    stdoutBytes: Buffer.byteLength(result.stdout || ''),
  }
}

for (const file of [...wxmlFiles, ...wxssFiles]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing compile source: ${file}`)
}
fs.mkdirSync(output, { recursive: true })
const results = [
  execute('wcc', 'wcc.exe', ['-d', '-o', path.join(output, 'wxml.compiled.txt'), ...wxmlFiles], wxmlFiles),
  execute('wcsc', 'wcsc.exe', [
    '-js', '-pc', String(wxssFiles.length), ...wxssFiles,
    '-o', path.join(output, 'wxss.compiled.txt'),
  ], wxssFiles),
]
const report = {
  runAt: new Date().toISOString(),
  officialSourceCompilation: results.every(result => result.exitCode === 0 && !result.error && !result.stderr),
  nativeRuntime: 'NOT RUN',
  physicalDevice: 'NOT RUN',
  sources: Object.fromEntries([...wxmlFiles, ...wxssFiles].map(file => [file, hash(file)])),
  results,
}
fs.writeFileSync(path.join(output, 'compile.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.officialSourceCompilation) process.exitCode = 1
