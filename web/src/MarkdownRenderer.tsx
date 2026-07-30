import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import { previewMarkdownBody } from './lib/markdownPreview';

const allowedTags = [
  ...(defaultSchema.tagNames || []),
  'details',
  'summary',
  'figure',
  'figcaption',
  'sub',
  'sup',
  'kbd',
  'mark',
];

export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: Array.from(new Set(allowedTags)),
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a || []),
      'href',
      'title',
      'target',
      'rel',
    ],
    img: [
      ...(defaultSchema.attributes?.img || []),
      'src',
      'alt',
      'title',
      'width',
      'height',
      'loading',
    ],
    figure: ['className'],
    figcaption: ['className'],
    details: ['open'],
    summary: ['className'],
    code: [
      ...(defaultSchema.attributes?.code || []),
      'className',
    ],
    span: [
      ...(defaultSchema.attributes?.span || []),
      'className',
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
};

export const markdownRemarkPlugins: PluggableList = [remarkGfm, remarkMath];
export const markdownRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  rehypeKatex,
] as PluggableList;

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={markdownRehypePlugins}>
      {previewMarkdownBody(content)}
    </ReactMarkdown>
  );
}
