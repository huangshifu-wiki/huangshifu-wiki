const verboseUnitLogging = process.env.DEBUG_UNIT === '1'

if (!verboseUnitLogging) {
  const originalConsoleLog = console.log.bind(console)
  const originalConsoleWarn = console.warn.bind(console)
  const originalConsoleError = console.error.bind(console)
  const noisyPrefixes = [
    '[Integration Test]',
    '[Variant]',
    '[DiskMonitor]',
    '[CloudSync]',
    '[API]',
    '[API Error]',
    '[SensitiveWord]',
    '  - ',
  ]

  const shouldSuppress = (args: unknown[]) => {
    const [firstArg] = args
    return (
      typeof firstArg === 'string' && noisyPrefixes.some((prefix) => firstArg.startsWith(prefix))
    )
  }

  console.log = (...args: Parameters<typeof console.log>) => {
    if (shouldSuppress(args)) {
      return
    }
    originalConsoleLog(...args)
  }

  console.warn = (...args: Parameters<typeof console.warn>) => {
    if (shouldSuppress(args)) {
      return
    }
    originalConsoleWarn(...args)
  }

  console.error = (...args: Parameters<typeof console.error>) => {
    if (shouldSuppress(args)) {
      return
    }
    originalConsoleError(...args)
  }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
