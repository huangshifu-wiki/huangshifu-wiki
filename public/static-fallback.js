/**
 * 静态 fallback：仅在 React 加载超时（8秒）后显示
 * 避免阻塞首屏
 */
;(function () {
  var shown = false
  var staticFooter = document.getElementById('static-footer')
  var bootSplash = document.getElementById('boot-splash')
  var desktopMedia = window.matchMedia('(min-width: 768px)')

  function removeNode(node) {
    if (node && node.parentNode) {
      node.parentNode.removeChild(node)
    }
  }

  // React 挂载后由 hideStaticFallback 调用：淡出并移除 splash；
  // 超时兜底分支直接移除，避免 JS 彻底失败时加载动画永远转圈
  function hideBootSplash(withFade) {
    if (!bootSplash) return
    if (withFade) {
      bootSplash.classList.add('boot-splash--hide')
      setTimeout(function () {
        removeNode(bootSplash)
      }, 300)
    } else {
      removeNode(bootSplash)
    }
  }

  function shouldShowFooter() {
    return desktopMedia.matches
  }

  var timer = setTimeout(function () {
    if (!window.__REACT_MOUNTED__ && staticFooter && !shown && shouldShowFooter()) {
      shown = true
      staticFooter.style.display = 'block'
    }
    hideBootSplash(false)
  }, 8000)

  window.hideStaticFallback = function () {
    clearTimeout(timer)
    window.__REACT_MOUNTED__ = true
    if (staticFooter) {
      staticFooter.style.display = 'none'
    }
    hideBootSplash(true)
  }
})()
