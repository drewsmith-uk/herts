import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageLinkContributions } from './plugins';

/** Shared safe message rendering, including results displayed outside a chat. */
export function MessageMarkdown({ text, conversationId }: { text: string; conversationId?: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => conversationId
      ? <MessageLinkContributions href={href} conversationId={conversationId}>{children}</MessageLinkContributions>
      : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span className="attachment-placeholder">[{alt || 'Image attachment'}]</span>,
  }}>{text}</ReactMarkdown></div>;
}
