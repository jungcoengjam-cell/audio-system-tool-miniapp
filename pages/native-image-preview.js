'use strict'

function preview(page, current, onFailure, urls, api) {
  const client = api || (typeof wx === 'undefined' ? null : wx)
  if (!page || !current || !client || typeof client.previewImage !== 'function'
    || page._nativeImagePreview && page._nativeImagePreview.hidden) return false
  const state = { hidden: false, failed: false, expiresAt: Date.now() + 2000 }
  page._nativeImagePreview = state
  const fail = () => {
    if (page._nativeImagePreview !== state || state.failed) return
    state.failed = true
    if (state.hidden) {
      try { if (onFailure) onFailure() } catch (error) {}
    }
    else page._nativeImagePreview = null
  }
  try {
    client.previewImage({ current, urls: Array.isArray(urls) && urls.length ? urls : [current], fail })
  } catch (error) {
    fail()
    return false
  }
  setTimeout(() => {
    if (page._nativeImagePreview === state && !state.hidden) page._nativeImagePreview = null
  }, 2000)
  return true
}

function onHide(page) {
  const state = page && page._nativeImagePreview
  if (!state) return false
  if (!state.hidden && Date.now() > state.expiresAt) {
    page._nativeImagePreview = null
    return false
  }
  state.hidden = true
  return true
}

function onShow(page) {
  const state = page && page._nativeImagePreview
  if (!state) return false
  page._nativeImagePreview = null
  return state.hidden
}

function isPending(page) {
  const state = page && page._nativeImagePreview
  return Boolean(state && (state.hidden || Date.now() <= state.expiresAt))
}

function cancel(page) {
  if (!page || !page._nativeImagePreview) return false
  page._nativeImagePreview = null
  return true
}

function share(page, path, shareGeneratedImage, onFailure, urls, api) {
  const client = api || (typeof wx === 'undefined' ? null : wx)
  if (!path) return false
  if (client && typeof client.showShareImageMenu === 'function') return shareGeneratedImage(path)
  preview(page, path, onFailure, urls, client)
  if (client && typeof client.showToast === 'function') {
    client.showToast({ title: '请长按图片转发', icon: 'none' })
  }
  return true
}

module.exports = { cancel, isPending, onHide, onShow, preview, share }
