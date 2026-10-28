// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useFileDropZone } from '../../src/hooks/useFileDropZone'
import type { UseFileDropZoneOptions } from '../../src/hooks/useFileDropZone'

const Harness = ({ onFiles, enabled = true }: UseFileDropZoneOptions) => {
  const { isDraggingFiles, activeZone, rootHandlers } = useFileDropZone({ onFiles, enabled })

  return (
    <div {...rootHandlers} data-testid="root">
      <span data-testid="state">{`${isDraggingFiles}|${activeZone ?? ''}`}</span>
      <div data-file-drop-zone="cover">
        <span data-testid="cover-inner" />
      </div>
      <div data-testid="plain" />
    </div>
  )
}

const makeFile = (name: string) => new File(['x'], name, { type: 'image/png' })

const filesTransfer = (...names: string[]) => ({
  types: ['Files'],
  files: names.map(makeFile),
  dropEffect: '',
})

const textTransfer = { types: ['text/plain'] }

const readState = () => screen.getByTestId('state').textContent

describe('useFileDropZone', () => {
  it('忽略不带文件的拖拽，保住页面内部的排序拖拽', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} />)
    const plain = screen.getByTestId('plain')

    fireEvent.dragEnter(plain, { dataTransfer: textTransfer })
    expect(readState()).toBe('false|')
    expect(fireEvent.dragOver(plain, { dataTransfer: textTransfer })).toBe(true)
    fireEvent.drop(plain, { dataTransfer: textTransfer })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('命中投放区时上报 zone，松手后复位状态', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} />)
    const coverInner = screen.getByTestId('cover-inner')
    const dataTransfer = filesTransfer('a.png')

    fireEvent.dragEnter(coverInner, { dataTransfer })
    expect(readState()).toBe('true|cover')
    // 不 preventDefault 浏览器不会把区域当作可放置目标
    expect(fireEvent.dragOver(coverInner, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')

    fireEvent.drop(coverInner, { dataTransfer })
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][1]).toBe('cover')
    expect(onFiles.mock.calls[0][0].map((item) => item.name)).toEqual(['a.png'])
    expect(readState()).toBe('false|')
  })

  it('投放区之外的区域 zone 为 null', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} />)
    const plain = screen.getByTestId('plain')

    fireEvent.dragEnter(plain, { dataTransfer: filesTransfer('a.png') })
    expect(readState()).toBe('true|')
    fireEvent.drop(plain, { dataTransfer: filesTransfer('a.png') })
    expect(onFiles.mock.calls[0][1]).toBeNull()
  })

  it('用深度计数抵消子元素之间的 enter/leave', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} />)
    const root = screen.getByTestId('root')
    const coverInner = screen.getByTestId('cover-inner')
    const dataTransfer = filesTransfer('a.png')

    fireEvent.dragEnter(root, { dataTransfer })
    fireEvent.dragEnter(coverInner, { dataTransfer })
    fireEvent.dragLeave(root, { dataTransfer })
    expect(readState()).toBe('true|cover')

    fireEvent.dragLeave(coverInner, { dataTransfer })
    expect(readState()).toBe('false|')
  })

  it('松手时没有文件则不回调', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} />)
    const plain = screen.getByTestId('plain')
    const dataTransfer = { types: ['Files'], files: [] }

    fireEvent.dragEnter(plain, { dataTransfer })
    fireEvent.drop(plain, { dataTransfer })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('enabled 为 false 时全程无反应', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} enabled={false} />)
    const coverInner = screen.getByTestId('cover-inner')
    const dataTransfer = filesTransfer('a.png')

    fireEvent.dragEnter(coverInner, { dataTransfer })
    expect(readState()).toBe('false|')
    expect(fireEvent.dragOver(coverInner, { dataTransfer })).toBe(true)
    fireEvent.drop(coverInner, { dataTransfer })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
