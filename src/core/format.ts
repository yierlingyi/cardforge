/** 基础 JS 缩进格式化（非完整 Prettier，仅处理括号/字符串/注释感知的换行缩进） */
export function formatJsBasic(code: string, indentSize = 2): string {
  const src = code.replace(/\r\n?/g, '\n');
  const out: string[] = [];
  let indent = 0;
  let i = 0;
  let line = '';
  const pad = () => ' '.repeat(Math.max(0, indent) * indentSize);

  const pushLine = (force = false) => {
    const t = line.trim();
    if (t || force) out.push(pad() + t);
    line = '';
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    // 字符串
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let str = c;
      i++;
      while (i < src.length) {
        const d = src[i];
        str += d;
        if (d === '\\') {
          str += src[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (d === quote) {
          i++;
          break;
        }
        i++;
      }
      line += str;
      continue;
    }

    // 注释
    if (c === '/' && next === '/') {
      let comment = '';
      while (i < src.length && src[i] !== '\n') comment += src[i++];
      line += comment;
      pushLine();
      continue;
    }
    if (c === '/' && next === '*') {
      let comment = '/*';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) comment += src[i++];
      comment += '*/';
      i += 2;
      line += comment;
      pushLine();
      continue;
    }

    if (c === '\n') {
      pushLine();
      i++;
      continue;
    }

    if (c === '{' || c === '[' || c === '(') {
      const tail = src.slice(i + 1, i + 3);
      line += c;
      if (c !== '(' && !/^\s*[)}\]]/.test(tail)) {
        pushLine();
        indent++;
      }
      i++;
      continue;
    }

    if (c === '}' || c === ']' || c === ')') {
      if (line.trim()) pushLine();
      indent = Math.max(0, indent - 1);
      line += c;
      i++;
      // 后面还有 else / catch / while → 不换行
      const rest = src.slice(i).match(/^\s*(else|catch|finally|while)\b/);
      if (rest) {
        line += ' ' + rest[1];
        i += src.slice(i).indexOf(rest[1]) + rest[1].length;
      } else if (src[i] === ';' || src[i] === ',') {
        line += src[i++];
        pushLine();
      } else {
        pushLine();
      }
      continue;
    }

    if (c === ';') {
      line += ';';
      pushLine();
      i++;
      continue;
    }

    if (c === ' ' || c === '\t') {
      if (line && !line.endsWith(' ')) line += ' ';
      i++;
      continue;
    }

    line += c;
    i++;
  }
  if (line.trim()) pushLine();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 简易 Markdown 渲染（仅支持预览所需的安全子集，不使用 innerHTML 注入不可信 HTML） */
export function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = esc(md || '');
  html = html.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^###\s?(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s?(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s?(.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/\n/g, '<br/>');
  return html;
}
