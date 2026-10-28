/**
 * 第三方脚本加载管理器
 * 用于延迟加载非关键第三方脚本，避免阻塞首屏渲染
 */
;(function () {
  'use strict'

  var processedScripts = new Set()

  function runWhenIdle(callback, timeout) {
    timeout = timeout || 2000

    if (typeof window.requestIdleCallback === 'function') {
      var idleId = window.requestIdleCallback(callback, { timeout: timeout })
      setTimeout(function () {
        window.cancelIdleCallback && window.cancelIdleCallback(idleId)
        callback()
      }, timeout)
    } else {
      setTimeout(callback, timeout)
    }
  }

  function loadScriptDeferred(src, options) {
    options = options || {}

    if (processedScripts.has(src)) return
    processedScripts.add(src)

    runWhenIdle(function () {
      var script = document.createElement('script')
      script.src = src
      script.async = true
      script.defer = true

      if (options.id) script.id = options.id
      if (options.crossOrigin) script.crossOrigin = options.crossOrigin

      document.head.appendChild(script)
    }, options.delay || 3000)
  }

  function loadScriptOnInteraction(src, options) {
    options = options || {}

    if (processedScripts.has(src)) return

    var loaded = false
    var events = ['click', 'touchstart', 'keydown', 'scroll']

    function handler() {
      if (loaded) return
      loaded = true

      events.forEach(function (evt) {
        window.removeEventListener(evt, handler, true)
      })

      if (!processedScripts.has(src)) {
        processedScripts.add(src)
        var script = document.createElement('script')
        script.src = src
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
    }

    events.forEach(function (evt) {
      window.addEventListener(evt, handler, { capture: true, passive: true })
    })

    setTimeout(handler, 5000)
  }

  window.ThirdPartyLoader = {
    loadDeferred: loadScriptDeferred,
    loadOnInteraction: loadScriptOnInteraction,
    runWhenIdle: runWhenIdle,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {})
  }
})()
