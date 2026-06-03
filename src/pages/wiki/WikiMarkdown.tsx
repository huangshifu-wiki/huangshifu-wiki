import MarkdownRenderer from '../../components/MarkdownRenderer';

const WikiMarkdown = ({ content }: { content: string }) => {
  if (typeof window !== 'undefined' && !content) {
    console.warn('[WikiMarkdown] content is empty:', { content, type: typeof content });
  }

  return <MarkdownRenderer content={content} enableWikiLinks />;
};

export default WikiMarkdown;
