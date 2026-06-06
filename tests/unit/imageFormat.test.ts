import { describe, expect, it } from 'vitest'

import { convertToFormat } from '../../src/utils/imageFormat'

describe('imageFormat', () => {
  describe('convertToFormat', () => {
    it('keeps local preview urls unchanged', () => {
      const blobUrl = 'blob:http://localhost:5173/6d9dbf8d-8e14-4a5b-8adb-637ac1ed7841'
      const dataUrl = 'data:image/png;base64,abc123'
      const fileUrl = 'file:///tmp/example.png'

      expect(convertToFormat(blobUrl, 'webp', 60)).toBe(blobUrl)
      expect(convertToFormat(dataUrl, 'webp', 60)).toBe(dataUrl)
      expect(convertToFormat(fileUrl, 'webp', 60)).toBe(fileUrl)
    })

    it('appends format params for normal image urls', () => {
      expect(convertToFormat('/uploads/galleries/test.jpg', 'webp', 60)).toBe(
        '/uploads/galleries/test.jpg?f=webp&q=60'
      )
      expect(convertToFormat('https://cdn.example.com/test.jpg?size=large', 'avif', 75)).toBe(
        'https://cdn.example.com/test.jpg?size=large&f=avif&q=75'
      )
    })

    it('keeps jpeg requests unchanged', () => {
      const url = '/uploads/galleries/test.jpg'

      expect(convertToFormat(url, 'jpeg', 80)).toBe(url)
    })
  })
})
