// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { isTrustedIframeDomain } from '../../src/lib/htmlSanitizer';
import MarkdownRenderer from '../../src/components/MarkdownRenderer';
import WikiMarkdown from '../../src/pages/wiki/WikiMarkdown';

describe('htmlSanitizer', () => {
  describe('isTrustedIframeDomain', () => {
    it('returns true for bilibili player', () => {
      expect(isTrustedIframeDomain('player.bilibili.com')).toBe(true);
    });

    it('returns true for music.163.com', () => {
      expect(isTrustedIframeDomain('music.163.com')).toBe(true);
    });

    it('returns true for qq music', () => {
      expect(isTrustedIframeDomain('y.qq.com')).toBe(true);
    });

    it('returns true for youtube', () => {
      expect(isTrustedIframeDomain('www.youtube.com')).toBe(true);
    });

    it('returns true for youtube without www', () => {
      expect(isTrustedIframeDomain('youtube.com')).toBe(true);
    });

    it('returns true for youku player', () => {
      expect(isTrustedIframeDomain('player.youku.com')).toBe(true);
    });

    it('returns true for iqiyi open platform', () => {
      expect(isTrustedIframeDomain('open.iqiyi.com')).toBe(true);
    });

    it('returns true for weibo', () => {
      expect(isTrustedIframeDomain('weibo.com')).toBe(true);
    });

    it('returns true for vimeo', () => {
      expect(isTrustedIframeDomain('vimeo.com')).toBe(true);
    });

    it('returns true for protocol-relative URLs', () => {
      expect(isTrustedIframeDomain('//player.bilibili.com')).toBe(true);
    });

    it('returns true for URLs with full protocol', () => {
      expect(isTrustedIframeDomain('https://player.bilibili.com')).toBe(true);
    });

    it('returns true for HTTP URLs', () => {
      expect(isTrustedIframeDomain('http://player.bilibili.com')).toBe(true);
    });

    it('returns false for untrusted domains', () => {
      expect(isTrustedIframeDomain('evil.com')).toBe(false);
    });

    it('returns false for random subdomains of untrusted domains', () => {
      expect(isTrustedIframeDomain('bilibili.evil.com')).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isTrustedIframeDomain(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isTrustedIframeDomain('')).toBe(false);
    });

    it('returns true for subdomains of trusted domains', () => {
      expect(isTrustedIframeDomain('player.music.163.com')).toBe(true);
    });

    it('returns false for invalid URLs', () => {
      expect(isTrustedIframeDomain('not-a-valid-url')).toBe(false);
    });
  });

  describe('WikiMarkdown', () => {
    const renderWikiMarkdown = (content: string) =>
      renderToStaticMarkup(createElement(WikiMarkdown, { content }));

    it('sanitizes dangerous raw html while keeping trusted embeds', () => {
      const output = renderWikiMarkdown(`
# Safe rendering

<script>alert(1)</script>
<img src="x" onerror="alert(1)">
<a href="javascript:alert(1)" target="_self" rel="opener">bad</a>
<iframe src="https://player.bilibili.com/video/BV1" width="640" height="360" style="border-radius: 12px;" allowfullscreen></iframe>
<iframe src="https://evil.com/embed"></iframe>
`);

      expect(output).not.toContain('<script');
      expect(output).not.toContain('onerror=');
      expect(output).not.toContain('javascript:');
      expect(output).toContain('https://player.bilibili.com/video/BV1');
      expect(output).toContain('border-radius');
      expect(output).not.toContain('https://evil.com/embed');
    });

    it('forces safe attributes on external links', () => {
      const output = renderWikiMarkdown(
        '<a href="https://example.com" target="_self" rel="opener">example</a>',
      );

      expect(output).toContain('href="https://example.com"');
      expect(output).toContain('target="_blank"');
      expect(output).toContain('rel="noopener noreferrer"');
      expect(output).not.toContain('target="_self"');
      expect(output).not.toContain('rel="opener"');
    });
  });

  describe('MarkdownRenderer', () => {
    const renderMarkdown = (content: string, enableWikiLinks = false) =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(MarkdownRenderer, { content, enableWikiLinks }),
        ),
      );

    it('renders GitHub alerts and safe heading anchors in the shared renderer', () => {
      const output = renderMarkdown(`
# location

> [!NOTE]
> 这是一条提示
`);

      expect(output).toContain('id="user-content-location"');
      expect(output).toContain('href="#user-content-location"');
      expect(output).not.toContain('id="location"');
      expect(output).toContain('markdown-heading-anchor');
      expect(output).toContain('markdown-alert markdown-alert-note');
      expect(output).toContain('markdown-alert-title');
      expect(output).toContain('<svg');
      expect(output).toContain('<path');
    });

    it('only converts wiki links when wiki mode is enabled', () => {
      expect(renderMarkdown('[[页面标题]]')).toContain('[[页面标题]]');
      expect(renderMarkdown('[[页面标题]]', true)).toContain(
        'href="/wiki/%E9%A1%B5%E9%9D%A2%E6%A0%87%E9%A2%98"',
      );
    });

    it('uses the shared iframe whitelist for all renderer consumers', () => {
      const output = renderMarkdown(`
<iframe src="https://player.bilibili.com/video/BV1"></iframe>
<iframe src="https://evil.com/embed"></iframe>
<svg onload="alert(1)"><path d="M0 0" onclick="alert(1)"></path></svg>
`);

      expect(output).toContain('https://player.bilibili.com/video/BV1');
      expect(output).not.toContain('https://evil.com/embed');
      expect(output).toContain('<svg');
      expect(output).toContain('<path d="M0 0"');
      expect(output).not.toContain('onload');
      expect(output).not.toContain('onclick');
    });

    it('keeps GFM footnote links connected after sanitizing ids', () => {
      const output = renderMarkdown(`
脚注引用[^1]

[^1]: 脚注内容
`);

      expect(output).toContain('id="user-content-user-content-fnref-1"');
      expect(output).toContain('href="#user-content-user-content-fn-1"');
      expect(output).toContain('id="user-content-user-content-fn-1"');
      expect(output).toContain('href="#user-content-user-content-fnref-1"');
    });

    it('renders common markdown structures with preserved GFM attributes', () => {
      const output = renderMarkdown(`
正文 **加粗** *斜体* ~~删除~~

- [x] 已完成
- [ ] 未完成

| 左 | 右 | 中 |
| :- | -: | :-: |
| a | b | c |
`);

      expect(output).toContain('<strong>加粗</strong>');
      expect(output).toContain('<em>斜体</em>');
      expect(output).toContain('<del>删除</del>');
      expect(output).toContain('class="contains-task-list"');
      expect(output).toContain('type="checkbox"');
      expect(output).toContain('checked=""');
      expect(output).toContain('style="text-align:left"');
      expect(output).toContain('style="text-align:right"');
      expect(output).toContain('style="text-align:center"');
    });

    it('renders code highlighting, line numbers and highlighted lines from code meta', () => {
      const output = renderMarkdown(`
\`\`\`js showLineNumbers {1}
const x = 1
const y = 2
\`\`\`
`);

      expect(output).toContain('class="language-js code-highlight"');
      expect(output).toContain('token keyword');
      expect(output).toContain('code-line line-number highlight-line');
      expect(output).toContain('line="1"');
      expect(output).not.toContain('metastring=');
    });
  });
});
