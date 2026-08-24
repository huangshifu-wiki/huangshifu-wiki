import { describe, expect, it } from 'vitest'

import {
  validateEmail,
  validateMaxLength,
  validatePassword,
  validateRequiredText,
  validateTags,
  validateUrl,
} from '../../src/lib/clientValidation'

describe('clientValidation', () => {
  it('rejects blank required text and accepts trimmed text', () => {
    expect(validateRequiredText('  ', 'title', '标题')).toEqual({
      field: 'title',
      message: '标题不能为空',
    })
    expect(validateRequiredText(' 标题 ', 'title', '标题')).toBeNull()
  })

  it('checks maximum length at the boundary', () => {
    expect(validateMaxLength('123', 'title', '标题', 3)).toBeNull()
    expect(validateMaxLength('1234', 'title', '标题', 3)).toEqual({
      field: 'title',
      message: '标题不能超过3个字符',
    })
  })

  it('checks tag count and item length', () => {
    expect(validateTags(['a', 'b'], 'tags', '标签', 1, 3)).toEqual({
      field: 'tags',
      message: '标签最多1个',
    })
    expect(validateTags(['a', 'b'], 'tags', '标签', 2, 3)).toBeNull()
    expect(validateTags(['abcd'], 'tags', '标签', 2, 3)).toEqual({
      field: 'tags',
      message: '标签单项长度不能超过3个字符',
    })
  })

  it('validates email and password boundaries', () => {
    expect(validateEmail('user@example.com', 'email', '邮箱')).toBeNull()
    expect(validateEmail('invalid', 'email', '邮箱')).toEqual({
      field: 'email',
      message: '邮箱格式无效',
    })
    expect(validatePassword('1234567', 'password', '密码')).not.toBeNull()
    expect(validatePassword('12345678', 'password', '密码')).toBeNull()
  })

  it('allows optional empty URLs and rejects non-http protocols', () => {
    expect(validateUrl('', 'url', '链接')).toBeNull()
    expect(validateUrl('ftp://example.com', 'url', '链接')).toEqual({
      field: 'url',
      message: '链接必须是有效的 http/https URL',
    })
    expect(validateUrl('https://example.com', 'url', '链接')).toBeNull()
  })
})
