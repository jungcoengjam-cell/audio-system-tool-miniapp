// Source-unit check for the installed WeChat WAWebview event binder.
// This does not launch a page, emulate a native page, or inspect user records.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const repo = path.resolve(__dirname, '../..')
const evidenceDir = path.join(repo, 'tests/project-wiring-redesign-2026-10-16/evidence/native-acceptance-fix-2026-10-16/runtime-semantics')
const rootPreviewPath = path.join(repo, 'docs/verification/project-wiring-dark-buttons-2026-10-03/root-preview.cjs')
const rootPreview = fs.readFileSync(rootPreviewPath, 'utf8')
const nativePathMatch = rootPreview.match(/const nativeFile\s*=\s*['"]([^'"]+)['"]/)
assert(nativePathMatch, 'root-preview.cjs must identify the installed WAWebview source')
const nativePath = nativePathMatch[1]
const nativeSource = fs.readFileSync(nativePath, 'utf8')
const dispatcherStopSnippet = '!1===s&&(t.__originalEvent&&!t.__originalEvent.__stopPreventDefault&&t.__originalEvent.preventDefault(),t.__stopped=!0)'
const dispatcherStopOffset = nativeSource.indexOf(dispatcherStopSnippet)
assert.notEqual(dispatcherStopOffset, -1, 'official event dispatcher must stop propagation when a listener returns false')

const binderMarker = 'Ui=(e,t,i,n,r,a,o,l)=>{'
const binderStart = nativeSource.indexOf(binderMarker)
assert.notEqual(binderStart, -1, 'official Ui binder marker must exist')
const nextBinderMarker = ',ji=(e,t,i,n)=>'
const binderEnd = nativeSource.indexOf(nextBinderMarker, binderStart)
assert.notEqual(binderEnd, -1, 'following official ji binder marker must exist')
const binderSource = nativeSource.slice(binderStart, binderEnd)
assert(binderSource.endsWith('}'), 'extracted Ui source must end at its closing brace')
const binderExpression = binderSource.slice('Ui='.length)

// Evaluate the exact extracted function expression. The only injected free
// variable used on registration is renderer selector s(); callback execution
// uses ownerShadowRoot=null and therefore avoids the app-service host path.
const officialUi = new Function('s', `return (${binderExpression})`)(() => 'webview')

function invokeBindings(bindings) {
  const listeners = []
  const node = {
    ownerShadowRoot: null,
    addListener(type, callback, options) {
      listeners.push({ type, callback, options })
    },
  }
  const context = {}
  bindings.forEach(({ kind, handler }) => {
    const isCatch = kind === 'catch'
    // These are the exact normal non-WXS Ui arguments produced by WAWebview's
    // attribute parser: Ui(root, node, eventName, handler, isCatch, capture,
    // isWxs, isMutated).
    officialUi(context, node, 'tap', handler, isCatch, undefined, false, undefined)
  })
  assert.equal(listeners.length, 1, 'same-node tap bindings should share one official listener')
  const event = { mutatedMarked: () => false }
  const propagationReturn = listeners[0].callback.call(node, event)
  return {
    eventName: listeners[0].type,
    listenerCount: listeners.length,
    handlerSlot: node.__wxEventHandleName && node.__wxEventHandleName.tap,
    callbackReturn: propagationReturn === undefined ? 'undefined' : propagationReturn,
    returnsFalseToStopPropagation: propagationReturn === false,
    captureOption: listeners[0].options && listeners[0].options.capture,
  }
}

const bindThenCatch = invokeBindings([
  { kind: 'bind', handler: 'toggleGroup' },
  { kind: 'catch', handler: 'stopEvent' },
])
const catchThenBind = invokeBindings([
  { kind: 'catch', handler: 'stopEvent' },
  { kind: 'bind', handler: 'toggleGroup' },
])
const singleBindControl = invokeBindings([
  { kind: 'bind', handler: 'toggleGroup' },
])
const singleCatchControl = invokeBindings([
  { kind: 'catch', handler: 'toggleGroup' },
])

assert.deepEqual(bindThenCatch, {
  eventName: 'tap', listenerCount: 1, handlerSlot: 'stopEvent',
  callbackReturn: 'undefined', returnsFalseToStopPropagation: false,
  captureOption: undefined,
})
assert.deepEqual(catchThenBind, {
  eventName: 'tap', listenerCount: 1, handlerSlot: 'toggleGroup',
  callbackReturn: false, returnsFalseToStopPropagation: true,
  captureOption: undefined,
})
assert.deepEqual(singleBindControl, {
  eventName: 'tap', listenerCount: 1, handlerSlot: 'toggleGroup',
  callbackReturn: 'undefined', returnsFalseToStopPropagation: false,
  captureOption: undefined,
})
assert.deepEqual(singleCatchControl, {
  eventName: 'tap', listenerCount: 1, handlerSlot: 'toggleGroup',
  callbackReturn: false, returnsFalseToStopPropagation: true,
  captureOption: undefined,
})

const fixtureCompilePath = path.join(evidenceDir, 'compiled.txt')
const fixtureCompile = fs.readFileSync(fixtureCompilePath, 'utf8')
const canonicalAttributes = "_mz(z,'view',['bindtap',0,'catchtap',1],[],e,s,gg)"
function fixtureHasCanonicalOrder(fixtureName) {
  const marker = `${fixtureName}:view:1:1")`
  const start = fixtureCompile.indexOf(marker)
  if (start < 0) return false
  return fixtureCompile.slice(start, start + 260).includes(canonicalAttributes)
}
const compiledFixtureOrder = {
  bindThenCatch: fixtureHasCanonicalOrder('bind-then-catch.wxml'),
  catchThenBind: fixtureHasCanonicalOrder('catch-then-bind.wxml'),
}
assert.equal(compiledFixtureOrder.bindThenCatch, true, 'official WCC output should include the bind/catch fixture')
assert.equal(compiledFixtureOrder.catchThenBind, true, 'official WCC output should include the catch/bind fixture')

const activeWxmlPath = path.join(repo, 'pages/project-wiring/workspace.wxml')
const activeWxml = fs.readFileSync(activeWxmlPath, 'utf8')
const activeGroupHeader = activeWxml.split(/\r?\n/).find((line) => line.includes('class="workspace-group-header"'))
assert(activeGroupHeader, 'active WXML should include a group header')
const activeTapHandlers = [...activeGroupHeader.matchAll(/(?:bind|catch)tap="([^"]+)"/g)].map((match) => match[1])
assert.deepEqual(activeTapHandlers, ['toggleGroup'], 'active group header should use one tap binding')

const output = {
  evidenceType: 'SOURCE-UNIT; not a native page runtime or physical-device test',
  source: {
    nativeBundle: nativePath,
    nativeBundleSha256: crypto.createHash('sha256').update(nativeSource).digest('hex'),
    nativeBundleBytes: Buffer.byteLength(nativeSource),
    extractedSymbol: 'Ui',
    extractedStartOffsetUtf16: binderStart,
    extractedEndOffsetUtf16Exclusive: binderEnd,
    extractedFunctionSha256: crypto.createHash('sha256').update(binderSource).digest('hex'),
    extractedFunctionBytes: Buffer.byteLength(binderSource),
    invocation: 'Exact extracted WAWebview Ui function; non-WXS; ownerShadowRoot=null; renderer s() returns webview.',
  },
  dispatcher: {
    stopOnFalseOffsetUtf16: dispatcherStopOffset,
    stopOnFalseSource: dispatcherStopSnippet,
  },
  wccFixture: {
    compilerVersion: (fixtureCompile.match(/__wcc_version__='([^']+)'/) || [])[1] || null,
    stdoutPath: fixtureCompilePath,
    stdoutSha256: crypto.createHash('sha256').update(fixtureCompile).digest('hex'),
    canonicalAttributeCall: canonicalAttributes,
    bothSourceOrdersCompileToBindThenCatch: compiledFixtureOrder,
  },
  activeWxml: {
    path: activeWxmlPath,
    sha256: crypto.createHash('sha256').update(activeWxml).digest('hex'),
    groupHeaderLine: activeGroupHeader.trim(),
    tapHandlers: activeTapHandlers,
  },
  binderCases: {
    bindThenCatch,
    catchThenBind,
    correctedSingleBindControl: singleBindControl,
    correctedSingleCatchControl: singleCatchControl,
  },
  interpretation: {
    sourceUnitResult: 'One listener is installed for the tap key; later binding updates the event handler slot, while the callback retains the catch flag from the first binding.',
    compiledOrderImplication: 'For WCC canonical bindtap-then-catchtap order, the final handler slot is the catch handler, while callback return behavior follows the first bind registration.',
    dispatcherSourceCheck: 'The recorded official dispatcher source sets t.__stopped when the listener returns false; this checker records the official binder callback return and does not simulate a full page dispatch.',
  },
  limitations: [
    'Does not launch WeChat DevTools, WAWebview page runtime, or a physical device.',
    'Does not exercise page service callbacks, hit testing, touch delivery, confirmation UI, or storage.',
    'Uses only WCC output already generated by the independent QA worker.',
  ],
}

const outputPath = path.join(evidenceDir, 'official-binder-check.json')
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, evidenceType: output.evidenceType, binderCases: output.binderCases, compiledFixtureOrder, nativeBundleSha256: output.source.nativeBundleSha256, extractedFunctionSha256: output.source.extractedFunctionSha256 }, null, 2))
