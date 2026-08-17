import MarkdownIt, { type StateCore } from "markdown-it";
import hljs from "highlight.js/lib/common";

const TASK_MARKER = /^\[([ xX])\]\s+/;

function taskLists(state: StateCore): boolean {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const item = tokens[i]!;
    if (item.type !== "list_item_open") continue;
    const inline = tokens[i + 2];
    if (tokens[i + 1]?.type !== "paragraph_open" || inline?.type !== "inline") continue;
    const first = inline.children?.[0];
    if (first?.type !== "text") continue;
    const m = TASK_MARKER.exec(first.content);
    if (!m) continue;

    first.content = first.content.slice(m[0].length);
    inline.content = inline.content.slice(m[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input class="task-list-item-checkbox" type="checkbox" disabled${
      m[1] === " " ? "" : " checked"
    }> `;
    inline.children!.unshift(box);
    item.attrJoin("class", "task-list-item");
  }
  return true;
}

function sourceLines(state: StateCore): boolean {
  for (const t of state.tokens) {
    if (!t.block || t.nesting === -1 || !t.map) continue;
    t.attrSet("data-source-line", `${t.map[0] + 1}-${t.map[1]}`);
    // CSS attr() can't split the range, so the gutter reads its own attribute.
    t.attrSet("data-line-start", `${t.map[0] + 1}`);
  }
  return true;
}

// hljs spans can cross newlines (template literals, block comments); close the
// open stack at each line boundary and reopen it on the next line so every
// code-line span is balanced. Newlines stay as text between spans, keeping
// textContent identical to the unwrapped output.
export function wrapCodeLines(html: string, firstLine: number): string {
  if (html === "") return "";
  const lines = html.split("\n");
  const trailing = lines.length > 1 && lines[lines.length - 1] === "" ? (lines.pop(), "\n") : "";
  const open: string[] = [];
  const wrapped = lines.map((line, i) => {
    const reopen = open.join("");
    for (const m of line.matchAll(/<span\b[^>]*>|<\/span>/g)) {
      if (m[0][1] === "/") open.pop();
      else open.push(m[0]);
    }
    const close = "</span>".repeat(open.length);
    return `<span class="code-line" data-line="${firstLine + i}">${reopen}${line}${close}</span>`;
  });
  return wrapped.join("\n") + trailing;
}

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  highlight: (code, lang) =>
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : "",
});
md.core.ruler.push("task_lists", taskLists);
md.core.ruler.push("source_lines", sourceLines);

// Default renderers put a code block's attrs on <code> (fence) or <pre>
// (indented); move the stamps to <pre> in both cases so the innermost stamped
// ancestor of a selection is the block element. Code content is wrapped into
// per-line spans carrying absolute source line numbers: a fence's content
// starts one line below the opening delimiter, an indented block's on its
// first mapped line.
for (const rule of ["fence", "code_block"] as const) {
  const base = md.renderer.rules[rule]!;
  md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const stamps: string[] = [];
    for (const name of ["data-source-line", "data-line-start"] as const) {
      const i = token.attrIndex(name);
      if (i < 0) continue;
      stamps.push(` ${name}="${token.attrs![i]![1]}"`);
      token.attrs!.splice(i, 1);
    }
    let out = base(tokens, idx, options, env, self);
    if (token.map) {
      const firstLine = token.map[0] + (rule === "fence" ? 2 : 1);
      out = out.replace(
        /(<code[^>]*>)([\s\S]*)(<\/code>)/,
        (_, openTag, body, closeTag) => openTag + wrapCodeLines(body, firstLine) + closeTag,
      );
    }
    return stamps.length === 0 ? out : out.replace("<pre", `<pre${stamps.join("")}`);
  };
}

export function render(source: string): string {
  return md.render(source);
}
