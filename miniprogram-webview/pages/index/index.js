const { webAppUrl } = require('../../config')

Page({
  data: {
    loading: true,
    error: '',
  },

  onLoad() {
    this.bootstrap()
  },

  bootstrap() {
    wx.login({
      success: (result) => {
        const code = result && result.code ? String(result.code).trim() : ''
        if (!code) {
          this.setData({ loading: false, error: '微信登录失败：未获取到 code' })
          return
        }

        const target = this.buildWebViewUrl(code)
        wx.redirectTo({
          url: `/pages/webview/webview?target=${encodeURIComponent(target)}`,
          fail: (err) => {
            console.error('redirectTo webview failed', err)
            this.setData({ loading: false, error: '打开页面失败，请稍后重试' })
          },
        })
      },
      fail: (err) => {
        console.error('wx.login failed', err)
        this.setData({ loading: false, error: '微信登录失败，请检查网络后重试' })
      },
    })
  },

  buildWebViewUrl(code) {
    const separator = webAppUrl.indexOf('?') >= 0 ? '&' : '?'
    return `${webAppUrl}${separator}wx_code=${encodeURIComponent(code)}`
  },

  retry() {
    this.setData({ loading: true, error: '' })
    this.bootstrap()
  },
})
