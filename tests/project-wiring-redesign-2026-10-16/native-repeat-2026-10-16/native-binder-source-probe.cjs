'use strict'

// Read-only source/runtime evidence for a repeated native Delete tap failure.
// This probe checks compiler output and installed runtime/router code only; it
// does not interact with a native device or modify production sources.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '../../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const beforeManifest = JSON.parse(read('tests/project-wiring-redesign-2026-10-16/native-repeat-2026-10-16/before/source-manifest.json'))
const currentCompile = JSON.parse(read('tests/project-wiring-redesign-2026-10-16/native-repeat-2026-10-16/current-compile/compile.json'))
const currentWcc = read('tests/project-wiring-redesign-2026-10-16/native-repeat-2026-10-16/current-compile/wxml.compiled.txt')
const priorWcc = read('tests/project-wiring-redesign-2026-10-16/evidence/native-acceptance-fix-2026-10-16/compile-final/wxml.compiled.txt')
const currentWxml = read('pages/project-wiring/workspace.wxml')
const browser = read('tests/project-wiring-redesign-2026-10-16/browser.js')

function findInstalledWebview() {
  const explicit = process.argv[2] || process.env.WIRING_QA_WA_WEBVIEW
  if (explicit && fs.existsSync(explicit)) return explicit
  const appData = process.env.LOCALAPPDATA || 'C:\\Users\\wxx\\AppData\\Local'
  for (const appName of fs.readdirSync(appData)) {
    const userData = path.join(appData, appName, 'User Data')
    if (!fs.existsSync(userData)) continue
    for (const profile of fs.readdirSync(userData)) {
      const plugins = path.join(userData, profile, 'WeappPlugin')
      if (!fs.existsSync(plugins)) continue
      for (const plugin of fs.readdirSync(plugins)) {
        const candidate = path.join(plugins, plugin, 'toolkit', 'browser', 'dist', 'WAWebview.js')
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }
  throw new Error('Could not locate installed WeChat DevTools WAWebview.js; pass its path as argv[2].')
}

const webviewPath = findInstalledWebview()
const webview = fs.readFileSync(webviewPath, 'utf8')
const beforeWxmlHash = beforeManifest['pages/project-wiring/workspace.wxml']
const currentWxmlHash = sha256(currentWxml)
const compiledCurrentHash = currentCompile.sources['pages/project-wiring/workspace.wxml']
const priorDeleteButton = priorWcc.split(/\r?\n/).find((line) => line.includes("var eRD=_mz(z,'button'") && line.includes("'data-delete-type'")) || ''
const currentDeleteButton = currentWcc.split(/\r?\n/).find((line) => line.includes("var eRD=_mz(z,'button'") && line.includes("'data-delete-type'")) || ''
const currentSwipeRow = currentWcc.split(/\r?\n/).find((line) => line.includes("var lOD=_mz(z,'view'") && line.includes("'data-swipe-id'")) || ''
const dispatchOffset = webview.indexOf('r.dispatchEvent=function(e,t)')
const dispatchCore = dispatchOffset < 0 ? '' : webview.slice(dispatchOffset, dispatchOffset + 1700)
const touchBridgeCancelable = webview.includes('i.on(e,t.emitCancelable.bind(t,e))')
const clickBranch = browser.match(/if \(domType === 'click'\) \{[\s\S]*?\n    \}/)?.[0] || ''
const enqueueSource = browser.match(/function enqueueEvent\([\s\S]*?\n\}/)?.[0] || ''

assert.equal(beforeWxmlHash, 'b248aa5c4028b94579ac0e8e7d82cac2a686738e9dcbdcbc711eb64b96a22e86')
assert.equal(currentWxmlHash, '39e7fe153a6e1d2392129e24a4502761cea3e296bc07e6af289384c93f1626be')
assert.equal(compiledCurrentHash, currentWxmlHash, 'fresh WCC compile must match current workspace.wxml bytes')
assert.ok(priorDeleteButton.includes("'catchtouchstart'") && priorDeleteButton.includes("'catchtouchend'") && priorDeleteButton.includes("'catchtouchmove'") && priorDeleteButton.includes("'catchtouchcancel'"), 'prior compiled Delete button should preserve its child catchtouch lifecycle')
assert.ok(currentDeleteButton.includes("'catchtap'") && !/catchtouch(?:start|move|end|cancel)/.test(currentDeleteButton), 'current compiled Delete button should bind catchtap only')
assert.ok(currentSwipeRow.includes("'bindtouchstart'") && currentSwipeRow.includes("'bindtouchmove'") && currentSwipeRow.includes("'bindtouchend'") && currentSwipeRow.includes("'bindtouchcancel'") && currentSwipeRow.includes("'catchtap'"), 'current compiled row should retain touch lifecycle plus stopEvent catchtap')
assert.ok(dispatchCore.includes('t.__originalEvent.preventDefault()') && dispatchCore.includes('t.__stopped=!0') && dispatchCore.includes('!p&&!t.__stopped'), 'installed event dispatcher should cancel original event and stop ancestor walk on a false listener result')
assert.ok(/onTouchStart.*onTouchMove.*onTouchEnd.*onTouchCancel/.test(webview) && touchBridgeCancelable, 'installed WebView bridge should route native touch events through emitCancelable')
assert.ok(clickBranch.includes("enqueueEvent(pathInfo, 'tap', event, detail)") && clickBranch.includes('activeTouch?.ended && !activeTouch.moved'), 'browser router should derive tap routing from click plus the prior qualifying touch')
assert.ok(!/defaultPrevented|preventDefault|stopPropagation/.test(clickBranch + enqueueSource), 'browser WXML event router should not model native touch cancellation at its click/tap bridge')

const result = {
  scope: 'Read-only source/runtime probe. It does not exercise a WeChat runtime, physical device, user data, or production mutations.',
  prior: {
    workspaceWxmlSha256: beforeWxmlHash,
    priorWccArtifact: 'tests/project-wiring-redesign-2026-10-16/evidence/native-acceptance-fix-2026-10-16/compile-final/wxml.compiled.txt',
    deleteButtonCompiledBindings: priorDeleteButton.match(/\[(.*)\],\[\]/)?.[1] || priorDeleteButton,
    childCatchTouchStartMoveEndCancel: true,
  },
  current: {
    workspaceWxmlSha256: currentWxmlHash,
    freshWccCompileAt: currentCompile.runAt,
    wccExitCodes: Object.fromEntries(currentCompile.executions.map((item) => [item.name, item.exitCode])),
    deleteButtonCompiledBindings: currentDeleteButton.match(/\[(.*)\],\[\]/)?.[1] || currentDeleteButton,
    rowCompiledBindings: currentSwipeRow.match(/\[(.*)\],\[\]/)?.[1] || currentSwipeRow,
    deleteButtonHasChildCatchTouch: false,
    rowOwnsTouchStartMoveEndCancel: true,
    deleteButtonCatchTapMethod: 'deleteWorkspaceRecord',
    ancestorCatchTapMethod: 'stopEvent',
  },
  installedWeChatDevToolsWebview: {
    path: webviewPath,
    sha256: sha256(webview),
    dispatcherOffsetBytes: dispatchOffset,
    touchBridgeEventsCancelCapable: true,
    touchBridgeUsesEmitCancelable: touchBridgeCancelable,
    falseListenerCallsOriginalPreventDefault: true,
    falseListenerStopsWeChatAncestorEventWalk: true,
    nativeTapSynthesisAfterPreventedTouchEndProvenByThisBundleSearch: false,
  },
  browserRouter: {
    source: 'tests/project-wiring-redesign-2026-10-16/browser.js',
    sha256: sha256(browser),
    tapRoute: 'A DOM click after touchend with no >8px move is labeled synthesized-touch-tap and enqueued as WXML tap; otherwise click is mapped as dom-click.',
    checksUnderlyingTouchDefaultPrevented: false,
    modelsWeChatBridgeCancelability: false,
    implication: 'If a browser click is delivered, the adapter can enqueue tap without consulting WeChat touch cancellation. If no click is delivered, this branch does not synthesize tap on touchend alone.',
  },
  assessment: [
    'The prior compiled button attached catchtouchstart/move/end/cancel and catchtap while its ancestor had row touch bindings and catchtap. That setup can stop the row touch path; the installed WebView dispatcher has a cancelable original-event path when a listener returns false.',
    'Current WXML and the fresh WCC output remove the button catchtouch handlers. The Delete button now has catchtap only; the ancestor row keeps bindtouchstart/move/end/cancel and catchtap=stopEvent. The fresh compile matches the current WXML SHA.',
    'The remaining button catchtap should route to deleteWorkspaceRecord on the button and stop ancestor tap dispatch. The inspected installed bundle does not establish whether native WeChat still synthesizes tap after a prevented touchend, so catchtouch suppression is a plausible prior failure mechanism, not a proven explanation of the current native failure.',
    'The browser adapter does not model that native boundary: it maps a DOM click to WXML tap and has no defaultPrevented check in its touch/click route. A browser pass therefore cannot settle whether WeChat delivered the native tap.',
  ],
}

const outputPath = path.join(__dirname, 'native-binder-source-probe.json')
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ outputPath, beforeSha256: beforeWxmlHash, currentSha256: currentWxmlHash, webviewSha256: result.installedWeChatDevToolsWebview.sha256, browserSha256: result.browserRouter.sha256, assertions: 'PASS; source evidence only, not native verification' }, null, 2))
