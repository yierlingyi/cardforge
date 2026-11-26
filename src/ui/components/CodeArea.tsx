import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

export type CodeLang = 'js' | 'json' | 'text';

export interface CodeAreaProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLang;
  readOnly?: boolean;
  placeholder?: string;
  wrap?: boolean;
  showLines?: boolean;
  fontSize?: number;
  minHeight?: number;
  className?: string;
}

function buildTheme(dark: boolean, fontSize: number) {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        color: dark ? '#d9e2f0' : '#1b2431',
        fontSize: `${fontSize}px`,
        height: '100%',
      },
      '.cm-content': {
        fontFamily: 'var(--font-mono)',
        caretColor: dark ? '#5b9dff' : '#2563eb',
        padding: '6px 0',
        lineHeight: '1.6',
      },
      '.cm-gutters': {
        backgroundColor: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.028)',
        color: dark ? '#4c5869' : '#98a3b4',
        border: 'none',
        paddingRight: '2px',
      },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: dark ? '#8c99ad' : '#5a6678' },
      '.cm-activeLine': { backgroundColor: dark ? 'rgba(91,157,255,0.06)' : 'rgba(37,99,235,0.05)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: dark ? 'rgba(91,157,255,0.24)' : 'rgba(37,99,235,0.18)',
      },
      '.cm-cursor': { borderLeftColor: dark ? '#5b9dff' : '#2563eb' },
      '.cm-foldPlaceholder': { backgroundColor: dark ? '#232c3b' : '#e9edf5', border: 'none', color: '#8c99ad' },
      '.cm-matchingBracket': { backgroundColor: dark ? 'rgba(142,123,255,0.25)' : 'rgba(124,77,255,0.16)', outline: 'none' },
      '.cm-searchMatch': { backgroundColor: dark ? 'rgba(226,168,63,0.3)' : 'rgba(226,168,63,0.35)' },
      '.cm-tooltip': { backgroundColor: dark ? '#161d28' : '#fff', border: `1px solid ${dark ? '#2e394b' : '#dde3ec'}`, borderRadius: '4px' },
      '.cm-scroller': { overflow: 'auto' },
    },
    { dark },
  );
}

export default function CodeArea(props: CodeAreaProps) {
  const { value, onChange, language = 'text', readOnly, placeholder, wrap, showLines, fontSize = 12, minHeight, className } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readonlyComp = useRef(new Compartment());
  const wrapComp = useRef(new Compartment());
  const gutterComp = useRef(new Compartment());
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const dark = (document.documentElement.dataset.theme || 'dark') !== 'light';

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        themeComp.current.of(buildTheme(dark, fontSize)),
        langComp.current.of(language === 'js' ? javascript() : language === 'json' ? json() : []),
        readonlyComp.current.of(EditorState.readOnly.of(!!readOnly)),
        gutterComp.current.of(showLines === false ? [] : [lineNumbers(), highlightActiveLineGutter(), foldGutter({ openText: '▾', closedText: '▸' })]),
        wrapComp.current.of(wrap === false ? [] : EditorView.lineWrapping),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        cmPlaceholder(placeholder || ''),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部值变化同步
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({
      effects: [
        readonlyComp.current.reconfigure(EditorState.readOnly.of(!!readOnly)),
        wrapComp.current.reconfigure(wrap === false ? [] : EditorView.lineWrapping),
        gutterComp.current.reconfigure(showLines === false ? [] : [lineNumbers(), highlightActiveLineGutter(), foldGutter({ openText: '▾', closedText: '▸' })]),
        langComp.current.reconfigure(language === 'js' ? javascript() : language === 'json' ? json() : []),
      ],
    });
  }, [readOnly, wrap, showLines, language]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: themeComp.current.reconfigure(buildTheme(dark, fontSize)) });
  }, [dark, fontSize]);

  return (
    <div className={`code-wrap ${className || ''}`} style={minHeight ? { minHeight } : undefined}>
      <div className="cm-host" ref={host} />
    </div>
  );
}
