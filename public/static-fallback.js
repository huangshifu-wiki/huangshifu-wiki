/**
 * 静态 fallback：仅在 React 加载超时（8秒）后显示
 * 避免阻塞首屏
 */
;(function () {
  var shown = false
  var staticFooter = document.getElementById('static-footer')
  var desktopMedia = window.matchMedia('(min-width: 768px)')

  function shouldShowFooter() {
    return desktopMedia.matches
  }

  var timer = setTimeout(function () {
    if (!window.__REACT_MOUNTED__ && staticFooter && !shown && shouldShowFooter()) {
      shown = true
      staticFooter.style.display = 'block'
    }
  }, 8000)

  window.hideStaticFallback = function () {
    clearTimeout(timer)
    window.__REACT_MOUNTED__ = true
    if (staticFooter) {
      staticFooter.style.display = 'none'
    }
  }
})()
