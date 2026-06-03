import { defaultSchema, type Options as Schema } from 'rehype-sanitize';

type AttributeDefinition = NonNullable<Schema['attributes']>[string][number];

const IFRAME_WHITELIST = [
  'player.bilibili.com',
  'music.163.com',
  'y.qq.com',
  'youtube.com',
  'www.youtube.com',
  'player.youku.com',
  'open.iqiyi.com',
  'www.iqiyi.com',
  'weibo.com',
  'www.weibo.com',
  'vimeo.com',
  'player.vimeo.com',
];

const withoutAttribute = (attributes: AttributeDefinition[] | undefined, name: string) =>
  (attributes ?? []).filter((attribute) => (typeof attribute === 'string' ? attribute : attribute[0]) !== name);

export const customSchema: Schema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames, 'iframe', 'svg', 'path'],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    a: [
      ...withoutAttribute(defaultSchema.attributes?.a, 'className'),
      ['className', 'data-footnote-backref', 'markdown-heading-anchor'],
      'ariaHidden',
    ],
    code: [
      ...((defaultSchema.attributes?.code ?? []) as NonNullable<Schema['attributes']>[string]),
      'dataMeta',
      'metastring',
    ],
    div: ['className'],
    p: [
      ...((defaultSchema.attributes?.p ?? []) as NonNullable<Schema['attributes']>[string]),
      ['className', 'markdown-alert-title'],
    ],
    path: ['d'],
    span: ['className'],
    svg: ['ariaHidden', 'className', 'height', 'viewBox', 'width'],
    iframe: [
      'src',
      'allow',
      'allowFullScreen',
      'className',
      'frameBorder',
      'height',
      'loading',
      'referrerPolicy',
      'scrolling',
      'style',
      'title',
      'width',
    ],
  },
};

export function isTrustedIframeDomain(src: string | undefined): boolean {
  if (!src) return false;

  try {
    let url: URL;
    if (src.startsWith('//')) {
      url = new URL('https:' + src);
    } else if (!src.startsWith('http://') && !src.startsWith('https://')) {
      url = new URL('https://' + src);
    } else {
      url = new URL(src);
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    return IFRAME_WHITELIST.some((domain) => {
      const d = domain.toLowerCase().replace(/^www\./, '');
      return hostname === d || hostname.endsWith('.' + d);
    });
  } catch {
    return false;
  }
}
