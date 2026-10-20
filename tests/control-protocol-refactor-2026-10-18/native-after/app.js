const store = Object.create(null)
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
App({ onLaunch() {
  this.__protocolQaStore = store
  wx.getStorageSync = key => clone(store[key])
  wx.setStorageSync = (key, value) => { store[key] = clone(value) }
  wx.removeStorageSync = key => { delete store[key] }
  wx.getStorageInfoSync = () => ({ keys: Object.keys(store), currentSize: 0, limitSize: 10240 })
} })
