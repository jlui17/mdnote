import MarkdownIt, { type StateCore } from "markdown-it";

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
  }
  return true;
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.core.ruler.push("task_lists", taskLists);
md.core.ruler.push("source_lines", sourceLines);

// Default renderers put a code block's attrs on <code> (fence) or <pre>
// (indented); move the stamp to <pre> in both cases so the innermost stamped
// ancestor of a selection is the block element.
for (const rule of ["fence", "code_block"] as const) {
  const base = md.renderer.rules[rule]!;
  md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const i = token.attrIndex("data-source-line");
    if (i < 0) return base(tokens, idx, options, env, self);
    const line = token.attrs![i]![1];
    token.attrs!.splice(i, 1);
    return base(tokens, idx, options, env, self).replace(
      "<pre",
      `<pre data-source-line="${line}"`,
    );
  };
}

export function render(source: string): string {
  return md.render(source);
}
