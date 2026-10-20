/* Test-only DOM reconciler for the browser QA adapter. It intentionally knows
 * nothing about WXML events; browser.js refreshes its own binding metadata.
 * data-qa-template-key is a stable source-template identity supplied by the
 * adapter for conditional WXML nodes that have no wx:key loop identity. */
;(function installKeyedDomPatch(global) {
  if (!global || global.__qaPatchMarkup) return

  function keyOf(node) {
    if (!node || node.nodeType !== 1) return null
    const qaKey = node.getAttribute('data-qa-key')
    const templateKey = node.getAttribute('data-qa-template-key')
    if (qaKey !== null && qaKey !== '') {
      // A flattened wx:for can place children from multiple static WXML nodes
      // under the same parent. Their item keys may collide, so include source
      // template identity when the adapter provides both dimensions.
      return templateKey !== null && templateKey !== ''
        ? `template:${templateKey}|qa:${qaKey}`
        : `qa:${qaKey}`
    }
    if (templateKey !== null && templateKey !== '') return `template:${templateKey}`
    const id = node.getAttribute('id')
    if (id !== null && id !== '') return `id:${id}`
    return null
  }

  function compatible(current, next) {
    if (!current || !next || current.nodeType !== next.nodeType) return false
    if (current.nodeType !== 1) return true
    return current.namespaceURI === next.namespaceURI && current.localName === next.localName
  }

  function countSubtree(node) {
    let count = 1
    for (const child of node.childNodes || []) count += countSubtree(child)
    return count
  }

  function syncAttributes(current, next) {
    const previousValue = current.getAttribute('value')
    const nextValue = next.getAttribute('value')
    const valueChanged = previousValue !== nextValue
    const checkedChanged = current.getAttribute('checked') !== next.getAttribute('checked')
    const disabledChanged = current.getAttribute('disabled') !== next.getAttribute('disabled')
    const wanted = new Map([...next.attributes].map(attribute => [attribute.name, attribute.value]))

    for (const attribute of [...current.attributes]) {
      if (!wanted.has(attribute.name)) current.removeAttribute(attribute.name)
    }
    for (const [name, value] of wanted) {
      if (current.getAttribute(name) !== value) current.setAttribute(name, value)
    }

    // Form control properties can diverge from their attributes while a user
    // edits them. Only push the declarative value when that attribute changed;
    // this leaves an in-progress edit and its caret intact during unrelated
    // renders. Boolean properties follow actual WXML attribute changes too.
    if (current.localName === 'input') {
      if (valueChanged && current.value !== next.value) current.value = next.value
      if (checkedChanged && current.checked !== next.checked) current.checked = next.checked
      if (disabledChanged && current.disabled !== next.disabled) current.disabled = next.disabled
    }
  }

  function patchNode(current, next, stats) {
    stats.reused++
    if (current.nodeType === 3 || current.nodeType === 8) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue
      return
    }
    if (current.nodeType === 1) syncAttributes(current, next)
    patchChildren(current, next, stats)
  }

  function patchChildren(parent, nextParent, stats) {
    const previous = [...parent.childNodes]
    const wanted = [...nextParent.childNodes]
    const keyed = new Map()
    for (const node of previous) {
      const key = keyOf(node)
      if (key === null) continue
      if (!keyed.has(key)) keyed.set(key, [])
      keyed.get(key).push(node)
    }

    const used = new Set()
    const result = wanted.map((next, index) => {
      const key = keyOf(next)
      let current = null
      if (key !== null) {
        const candidates = keyed.get(key) || []
        current = candidates.find(candidate => !used.has(candidate) && compatible(candidate, next)) || null
      } else {
        const positional = previous[index]
        // Unkeyed children deliberately use only their old position. A keyed
        // row is never repurposed as a different unkeyed node during a reorder.
        if (positional && keyOf(positional) === null && !used.has(positional) && compatible(positional, next)) current = positional
      }

      if (current) {
        used.add(current)
        patchNode(current, next, stats)
        return current
      }

      const inserted = next.cloneNode(true)
      stats.inserted += countSubtree(inserted)
      return inserted
    })

    for (const node of previous) {
      if (used.has(node)) continue
      stats.removed += countSubtree(node)
      parent.removeChild(node)
    }

    for (let index = 0; index < result.length; index++) {
      const node = result[index]
      const atIndex = parent.childNodes[index] || null
      if (node === atIndex) continue
      if (node.parentNode === parent) stats.moved++
      parent.insertBefore(node, atIndex)
    }
  }

  function selectionOf(element) {
    if (!element) return null
    try {
      if (typeof element.selectionStart !== 'number') return null
      return { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection || 'none' }
    } catch (_) { return null }
  }

  function patchMarkup(root, html) {
    if (!root || !root.childNodes || !root.ownerDocument) throw new TypeError('A DOM element root is required')
    const document = root.ownerDocument
    const active = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null
    const selection = selectionOf(active)
    const scroll = [[root, root.scrollLeft, root.scrollTop], ...[...root.querySelectorAll('*')].map(node => [node, node.scrollLeft, node.scrollTop])]
    const template = document.createElement('template')
    template.innerHTML = String(html ?? '')
    const stats = { inserted: 0, removed: 0, reused: 0, moved: 0 }

    patchChildren(root, template.content, stats)

    if (active && root.contains(active)) {
      if (document.activeElement !== active) {
        try { active.focus({ preventScroll: true }) } catch (_) { try { active.focus() } catch (_) {} }
      }
      if (selection) {
        try { active.setSelectionRange(selection.start, selection.end, selection.direction) } catch (_) {}
      }
    }
    for (const [node, left, top] of scroll) {
      if (node !== root && !root.contains(node)) continue
      if (node.scrollLeft !== left) node.scrollLeft = left
      if (node.scrollTop !== top) node.scrollTop = top
    }

    global.__qaPatchStats = stats
    return stats
  }

  global.__qaPatchMarkup = patchMarkup
  global.__qaPatchStats = { inserted: 0, removed: 0, reused: 0, moved: 0 }
})(typeof window === 'undefined' ? null : window)
