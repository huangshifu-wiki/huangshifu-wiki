import { describe, expect, it } from 'vitest'
import {
  extractMentionMatches,
  extractMentionNames,
  splitMentionText,
} from '../../src/lib/mentions'

describe('mentions', () => {
  it('extracts mention candidates without splitting internal dots', () => {
    expect(extractMentionNames('你好 @黄诗扶，也看看 @Alice! @alice.bob @黄诗扶')).toEqual([
      '黄诗扶，也看看',
      '黄诗扶',
      'Alice!',
      'Alice',
      'alice.bob',
    ])

    expect(extractMentionMatches('@alice.bob')[0].candidates).toEqual([
      { name: 'alice.bob', end: 10 },
    ])
  })

  it('does not treat email addresses or markdown code as mentions', () => {
    const content = [
      'mail test@example.com',
      '`@InlineCode`',
      '```ts',
      '@BlockCode',
      '```',
      '@ValidName',
    ].join('\n')

    expect(extractMentionNames(content)).toEqual(['ValidName'])
  })

  it('does not extract mentions from markdown links, images, autolinks, or urls', () => {
    const content = [
      '[see @LinkText](/users/@LinkPath)',
      '![alt @ImageAlt](/images/@ImagePath.png)',
      '[ref @Reference][alice-ref]',
      '[@Shortcut]',
      '[alice-ref]: https://example.com/@ReferenceTarget',
      '[@Shortcut]: https://example.com/@ShortcutTarget',
      'visit https://example.com/@UrlPath and www.example.com/@WwwPath',
      '<https://example.com/@AutoLink>',
      '<user@example.com>',
      '/@LocalPath',
      '@ValidName',
    ].join('\n')

    expect(extractMentionNames(content)).toEqual(['ValidName'])
  })

  it('links only uniquely resolved mention targets', () => {
    const segments = splitMentionText('hi @Alice and @Bob', [
      { uid: 'u1', publicId: '1', displayName: 'Alice' },
      { uid: 'u2', publicId: '2', displayName: 'Bob' },
      { uid: 'u3', publicId: '3', displayName: 'Bob' },
    ])

    expect(segments).toEqual([
      { type: 'text', text: 'hi ' },
      {
        type: 'mention',
        text: '@Alice',
        target: { uid: 'u1', publicId: '1', displayName: 'Alice' },
      },
      { type: 'text', text: ' and ' },
      { type: 'mention', text: '@Bob', target: null },
    ])
  })

  it('resolves internal punctuation and keeps unmatched trailing punctuation as text', () => {
    expect(
      splitMentionText('hi @alice.bob and @Alice!', [
        { uid: 'u1', publicId: '1', displayName: 'alice.bob' },
        { uid: 'u2', publicId: '2', displayName: 'Alice' },
      ])
    ).toEqual([
      { type: 'text', text: 'hi ' },
      {
        type: 'mention',
        text: '@alice.bob',
        target: { uid: 'u1', publicId: '1', displayName: 'alice.bob' },
      },
      { type: 'text', text: ' and ' },
      {
        type: 'mention',
        text: '@Alice',
        target: { uid: 'u2', publicId: '2', displayName: 'Alice' },
      },
      { type: 'text', text: '!' },
    ])
  })

  it('prefers exact punctuation display names over stripped candidates', () => {
    expect(
      splitMentionText('hi @Alice! ', [
        { uid: 'u1', publicId: '1', displayName: 'Alice' },
        { uid: 'u2', publicId: '2', displayName: 'Alice!' },
      ])
    ).toEqual([
      { type: 'text', text: 'hi ' },
      {
        type: 'mention',
        text: '@Alice!',
        target: { uid: 'u2', publicId: '2', displayName: 'Alice!' },
      },
      { type: 'text', text: ' ' },
    ])
  })

  it('can resolve a mention followed by Chinese punctuation without whitespace', () => {
    expect(
      splitMentionText(`@黄诗扶，${'也'.repeat(60)}`, [
        { uid: 'u1', publicId: '1', displayName: '黄诗扶' },
      ])
    ).toEqual([
      {
        type: 'mention',
        text: '@黄诗扶',
        target: { uid: 'u1', publicId: '1', displayName: '黄诗扶' },
      },
      { type: 'text', text: `，${'也'.repeat(60)}` },
    ])
  })

  it('continues parsing mentions separated by punctuation without whitespace', () => {
    const targets = [
      { uid: 'u1', publicId: '1', displayName: 'Alice' },
      { uid: 'u2', publicId: '2', displayName: 'Bob' },
    ]

    expect(extractMentionMatches('@Alice,@Bob')).toEqual([
      { start: 0, end: 6, name: 'Alice', candidates: [{ name: 'Alice', end: 6 }] },
      { start: 7, end: 11, name: 'Bob', candidates: [{ name: 'Bob', end: 11 }] },
    ])
    expect(splitMentionText('@Alice,@Bob', targets)).toEqual([
      { type: 'mention', text: '@Alice', target: targets[0] },
      { type: 'text', text: ',' },
      { type: 'mention', text: '@Bob', target: targets[1] },
    ])
    expect(splitMentionText('@Alice，@Bob', targets)).toEqual([
      { type: 'mention', text: '@Alice', target: targets[0] },
      { type: 'text', text: '，' },
      { type: 'mention', text: '@Bob', target: targets[1] },
    ])
  })
})
