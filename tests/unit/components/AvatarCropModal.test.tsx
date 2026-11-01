import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import { AvatarCropModal } from '../../../src/components/AvatarCropModal'

const selectImage = async (width: number, height: number) => {
  const bytes = await sharp({
    create: { width, height, channels: 4, background: 'red' },
  })
    .png()
    .toBuffer()
  fireEvent.change(screen.getByLabelText('选择图片'), {
    target: {
      files: [new File([new Uint8Array(bytes)], 'avatar.png', { type: 'image/png' })],
    },
  })
  return screen.findByAltText<HTMLImageElement>('待裁剪')
}

const loadImage = (image: HTMLImageElement, width: number, height: number) => {
  const scale = Math.min(1, 256 / width, 256 / height)
  // jsdom 不解码图片或执行布局，尺寸由每个独立图片元素的夹具提供。
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
    width: { configurable: true, value: width * scale },
    height: { configurable: true, value: height * scale },
  })
  Object.defineProperty(image.parentElement!, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, width * scale, height * scale),
  })
  fireEvent.load(image)
}

const sourceSelection = (width: number, height: number) => {
  const selection = screen.getByRole('group')
  return {
    x: (Number.parseFloat(selection.style.left) / 100) * width,
    y: (Number.parseFloat(selection.style.top) / 100) * height,
    width: (Number.parseFloat(selection.style.width) / 100) * width,
    height: (Number.parseFloat(selection.style.height) / 100) * height,
  }
}

describe('头像裁剪', () => {
  it.each([
    { width: 1200, height: 600 },
    { width: 600, height: 1200 },
    { width: 800, height: 800 },
  ])('$width×$height 图片加载后默认选中居中的最大正方形', async ({ width, height }) => {
    render(<AvatarCropModal open onClose={() => {}} onSuccess={() => {}} />)
    const image = await selectImage(width, height)
    loadImage(image, width, height)

    const crop = sourceSelection(width, height)
    expect(crop.width).toBeCloseTo(crop.height)
    expect(crop.width).toBeCloseTo(Math.min(width, height))
    expect(crop.x).toBeCloseTo((width - crop.width) / 2)
    expect(crop.y).toBeCloseTo((height - crop.height) / 2)
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(width)
    expect(crop.y + crop.height).toBeLessThanOrEqual(height)
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
  })

  it('重新选择后等待新图片加载，并根据新图片比例初始化选区', async () => {
    render(<AvatarCropModal open onClose={() => {}} onSuccess={() => {}} />)
    loadImage(await selectImage(1200, 600), 1200, 600)
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '重新选择' }))
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    const nextImage = await selectImage(600, 1200)
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()

    loadImage(nextImage, 600, 1200)
    const crop = sourceSelection(600, 1200)
    expect(crop.width).toBeCloseTo(crop.height)
    expect(crop.width).toBeCloseTo(600)
    expect(crop.x).toBeCloseTo((600 - crop.width) / 2)
    expect(crop.y).toBeCloseTo((1200 - crop.height) / 2)
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
  })
})
