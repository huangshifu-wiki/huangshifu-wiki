Page({
  data: {
    src: '',
  },

  onLoad(options) {
    const target = options && options.target ? decodeURIComponent(options.target) : ''
    if (!target) {
      wx.showToast({
        title: '目标地址缺失',
        icon: 'none',
      })
      return
    }

    this.setData({ src: target })
  },
})
