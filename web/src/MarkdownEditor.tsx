import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';

const markdownExtensions = [markdown()];

export default function MarkdownEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (value: string) => void;
}) {
  return (
    <CodeMirror
      value={content}
      height="100%"
      extensions={markdownExtensions}
      basicSetup={{ lineNumbers: true, foldGutter: true }}
      onChange={onChange}
    />
  );
}
