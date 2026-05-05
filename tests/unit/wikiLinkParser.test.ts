import { describe, expect, it } from 'vitest';
import {
  buildWikiBacklinkSearchTerms,
  parseInternalLink,
  extractMetadataFromMarkdown,
  type WikiPageMetadata,
} from '../../src/lib/wikiLinkParser';

describe('wikiLinkParser', () => {
  describe('parseInternalLink', () => {
    it('parses simple internal link [[slug]]', () => {
      const result = parseInternalLink('[[test-page]]');
      expect(result).toEqual({
        slug: 'test-page',
        displayText: 'test-page',
      });
    });

    it('parses internal link with display text [[display|slug]]', () => {
      const result = parseInternalLink('[[显示文本|test-page]]');
      expect(result).toEqual({
        slug: 'test-page',
        displayText: '显示文本',
      });
    });

    it('trims whitespace from slug and display text', () => {
      const result = parseInternalLink('[[  显示文本  |  test-page  ]]');
      expect(result).toEqual({
        slug: 'test-page',
        displayText: '显示文本',
      });
    });

    it('returns null for invalid format', () => {
      expect(parseInternalLink('not a link')).toBeNull();
      expect(parseInternalLink('[single-bracket]')).toBeNull();
      expect(parseInternalLink('[[unclosed')).toBeNull();
      expect(parseInternalLink('unopened]]')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseInternalLink('')).toBeNull();
    });

    it('handles special characters in display text', () => {
      const result = parseInternalLink('[[测试 & 示例|test-page]]');
      expect(result).toEqual({
        slug: 'test-page',
        displayText: '测试 & 示例',
      });
    });
  });

  describe('buildWikiBacklinkSearchTerms', () => {
    it('builds search terms for simple and display-text internal links', () => {
      expect(buildWikiBacklinkSearchTerms('test-page')).toEqual([
        '[[test-page]]',
        '|test-page]]',
      ]);
    });
  });

  describe('extractMetadataFromMarkdown', () => {
    it('extracts title from markdown', () => {
      const content = '# 测试标题\n\n这是内容';
      const result = extractMetadataFromMarkdown(content, 'test-slug');
      expect(result.title).toBe('测试标题');
      expect(result.slug).toBe('test-slug');
    });

    it('uses slug as title when no heading found', () => {
      const content = '没有标题的内容';
      const result = extractMetadataFromMarkdown(content, 'test-slug');
      expect(result.title).toBe('test-slug');
    });

    it('extracts description from first paragraph after title', () => {
      const content = '# 标题\n\n这是描述文字\n\n更多内容';
      const result = extractMetadataFromMarkdown(content, 'slug');
      expect(result.description).toBe('这是描述文字');
    });

    it('limits description to 200 characters', () => {
      const longDesc = 'a'.repeat(300);
      const content = `# 标题\n\n${longDesc}`;
      const result = extractMetadataFromMarkdown(content, 'slug');
      expect(result.description?.length).toBe(200);
    });

    it('skips list items when looking for description', () => {
      const content = '# 标题\n\n- 列表项1\n- 列表项2\n\n这是描述';
      const result = extractMetadataFromMarkdown(content, 'slug');
      expect(result.description).toBe('这是描述');
    });

    it('extracts tags from content', () => {
      const content = '# 标题\n\n内容 #标签1 #标签2 #标签1';
      const result = extractMetadataFromMarkdown(content, 'slug');
      expect(result.tags).toEqual(['标签1', '标签2']);
    });

    it('extracts Chinese tags', () => {
      const content = '# 标题\n\n#中文标签 #EnglishTag #混合123';
      const result = extractMetadataFromMarkdown(content, 'slug');
      expect(result.tags).toEqual(['中文标签', 'EnglishTag', '混合123']);
    });

    it('returns empty metadata for empty content', () => {
      const result = extractMetadataFromMarkdown('', 'slug');
      expect(result).toEqual({
        title: 'slug',
        slug: 'slug',
      });
    });

    it('handles complex markdown content', () => {
      const content = `# 页面标题

这是页面的描述文字，介绍这个页面的内容。

## 章节

- 列表项1
- 列表项2

#标签1 #标签2

更多内容...`;
      const result = extractMetadataFromMarkdown(content, 'my-page');
      expect(result.title).toBe('页面标题');
      expect(result.slug).toBe('my-page');
      expect(result.description).toBe('这是页面的描述文字，介绍这个页面的内容。');
      expect(result.tags).toEqual(['标签1', '标签2']);
    });
  });
});
