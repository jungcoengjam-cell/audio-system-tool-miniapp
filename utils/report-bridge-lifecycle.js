function createReportBridgeLifecycle({ bridge, cancelMessage }) {
  return {
    onLoad(options = {}) {
      this._terminal = false
      this._unloaded = false
      this._bridgeIdentity = {
        bridge,
        ticket: typeof options.ticket === 'string' ? options.ticket : '',
        revision: Number.isInteger(Number(options.revision)) ? Number(options.revision) : null,
      }
      this._eventChannel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null
      this._onGenerate = (payload) => this.begin(payload)
      this._onCancel = (payload) => {
        if (!payload || !this._payload || payload.ticket === this._payload.ticket) this.cancel(payload)
      }
      this._eventChannel?.on('generate-report', this._onGenerate)
      this._eventChannel?.on('cancel-report', this._onCancel)
      this._eventChannel?.emit('report-bridge-ready', { bridge })
    },

    onUnload() {
      this._unloaded = true
      if (!this._terminal) this.finish({ ok: false, cancelled: true, message: cancelMessage })
      this._eventChannel?.off?.('generate-report', this._onGenerate)
      this._eventChannel?.off?.('cancel-report', this._onCancel)
    },

    finish(result) {
      if (this._terminal) return
      this._terminal = true
      const identity = this._payload || this._bridgeIdentity || {}
      const eventChannel = this._eventChannel
      const eventIdentity = {
        bridge, ticket: identity.ticket || '',
        ...(identity.fingerprint ? { fingerprint: identity.fingerprint } : {}),
        ...(Number.isInteger(identity.revision) ? { revision: identity.revision } : {}),
      }
      eventChannel?.emit('report-bridge-result', { ...eventIdentity, ...result })
      if (!this._unloaded && typeof wx.navigateBack === 'function') {
        wx.navigateBack({
          delta: 1,
          complete: () => eventChannel?.emit('report-bridge-back-complete', eventIdentity),
        })
      }
    },

    cancel(cancelPayload = null) {
      if (this._terminal) return
      if (cancelPayload?.ticket && this._bridgeIdentity?.ticket
        && cancelPayload.ticket !== this._bridgeIdentity.ticket) return
      this.finish({ ok: false, cancelled: true, message: cancelMessage })
    },
  }
}

module.exports = { createReportBridgeLifecycle }
