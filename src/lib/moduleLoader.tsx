import { createElement, lazy, useState, type ComponentType } from 'react'

// 导航和推测加载共享任务；每次挂载固定组件类型，保留输入与焦点。
export function moduleLoader<P extends object>(
  importModule: () => Promise<{ default: ComponentType<P> }>
) {
  let task: Promise<{ default: ComponentType<P> }> | undefined
  let loadedModule: { default: ComponentType<P> } | undefined
  const load = () => {
    task ??= importModule().then(
      (module) => (loadedModule = module),
      (error) => {
        task = undefined
        throw error
      }
    )
    return task
  }
  const LazyComponent = lazy(load)
  function PreloadedComponent(props: P) {
    const [Component] = useState(() => loadedModule?.default ?? LazyComponent)
    return createElement(Component, props)
  }
  return Object.assign(load, {
    Component: PreloadedComponent,
    isStarted: () => task !== undefined,
    getLoaded: () => loadedModule,
  })
}
