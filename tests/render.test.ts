import { describe, expect, test } from "bun:test";
import { render } from "../src/render.ts";

/** Every data-source-line value in document order. */
function stamps(html: string): string[] {
  return [...html.matchAll(/data-source-line="([^"]+)"/g)].map((m) => m[1]!);
}

/** The stamp on the innermost (shortest) `tag` element containing `needle`. */
function stampOf(html: string, tag: string, needle: string): string | null {
  const open = new RegExp(`<${tag}([^>]*)>`, "g");
  const boundary = new RegExp(`<${tag}[^>]*>|</${tag}>`, "g");
  let best: { attrs: string; body: string } | null = null;
  for (const m of html.matchAll(open)) {
    const from = m.index + m[0].length;
    boundary.lastIndex = from;
    let depth = 1;
    let end = html.length;
    for (let b = boundary.exec(html); b; b = boundary.exec(html)) {
      depth += b[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = b.index;
        break;
      }
    }
    const body = html.slice(from, end);
    if (!body.includes(needle)) continue;
    if (!best || body.length < best.body.length) best = { attrs: m[1]!, body };
  }
  if (!best) return null;
  const attr = /data-source-line="([^"]+)"/.exec(best.attrs);
  return attr ? attr[1]! : null;
}

describe("render", () => {
  test("headings are stamped with their own 1-based line", () => {
    const html = render("# One\n\nbody\n\n## Two\n");
    expect(stampOf(html, "h1", "One")).toBe("1-1");
    expect(stampOf(html, "h2", "Two")).toBe("5-5");
  });

  test("a soft-wrapped paragraph spans its full inclusive line range", () => {
    const html = render("intro\n\nfirst line\nsecond line\nthird line\n\nafter\n");
    expect(stampOf(html, "p", "first line")).toBe("3-5");
    expect(stampOf(html, "p", "after")).toBe("7-7");
  });

  test("list and list items are each stamped", () => {
    const html = render("- one\n- two\n- three\n");
    expect(stampOf(html, "ul", "one")).toBe("1-3");
    expect(stampOf(html, "li", "one")).toBe("1-1");
    expect(stampOf(html, "li", "three")).toBe("3-3");
  });

  test("nested lists stamp the inner list and its items", () => {
    const html = render("- outer\n  - inner a\n  - inner b\n");
    expect(stampOf(html, "li", "inner a")).toBe("2-2");
    expect(stampOf(html, "li", "inner b")).toBe("3-3");
    // The inner <ul> is the innermost list containing "inner a".
    expect(stamps(html)).toContain("2-3");
  });

  test("ordered lists keep 1-based lines", () => {
    const html = render("text\n\n1. a\n2. b\n");
    expect(stampOf(html, "ol", "a")).toBe("3-4");
    expect(stampOf(html, "li", "b")).toBe("4-4");
  });

  test("fenced code stamps <pre> including the fence delimiters", () => {
    const html = render("para\n\n```js\nconst x = 1;\n```\n");
    expect(html).toContain('<pre data-source-line="3-5" data-line-start="3">');
    expect(html).toContain('<code class="language-js">');
  });

  test("known fence languages get hljs spans, unknown stay plain-escaped", () => {
    const ts = render('```ts\nconst x: string = "hi";\n```\n');
    expect(ts).toContain('<span class="hljs-keyword">const</span>');
    expect(ts).toContain('<pre data-source-line="1-3" data-line-start="1">');
    const unknown = render("```nosuchlang\n<b>raw</b>\n```\n");
    expect(unknown).not.toContain("hljs-");
    expect(unknown).toContain("&lt;b&gt;raw&lt;/b&gt;");
  });

  test("indented code stamps <pre> once", () => {
    const html = render("para\n\n    indented\n");
    expect(html).toContain('<pre data-source-line="3-3" data-line-start="3">');
    expect(stamps(html).filter((s) => s === "3-3")).toHaveLength(1);
  });

  test("blockquotes stamp the quote and the paragraph inside it", () => {
    const html = render("a\n\n> quoted\n> lines\n");
    expect(stampOf(html, "blockquote", "quoted")).toBe("3-4");
    expect(stampOf(html, "p", "quoted")).toBe("3-4");
  });

  test("tables stamp the table and its rows", () => {
    const html = render("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n");
    expect(stampOf(html, "table", "a")).toBe("1-4");
    expect(stampOf(html, "tr", "1")).toBe("3-3");
    expect(stampOf(html, "tr", "3")).toBe("4-4");
  });

  test("horizontal rules are stamped", () => {
    const html = render("a\n\n---\n\nb\n");
    expect(html).toContain('<hr data-source-line="3-3" data-line-start="3">');
  });

  test("stamp end is inclusive, never the exclusive markdown-it end", () => {
    const html = render("only line\n");
    expect(stampOf(html, "p", "only line")).toBe("1-1");
  });

  test("every stamped block also carries data-line-start matching its range start", () => {
    const html = render("# One\n\nbody\nwrapped\n\n> quote\n");
    for (const m of html.matchAll(/data-source-line="(\d+)-\d+" data-line-start="(\d+)"/g)) {
      expect(m[2]).toBe(m[1]!);
    }
    expect(html).toContain('data-source-line="3-4" data-line-start="3"');
  });

  test("fence content lines are wrapped with absolute source line numbers", () => {
    const html = render("para\n\n```js\nconst x = 1;\nconst y = 2;\n```\n");
    expect(html).toContain('<span class="code-line" data-line="4">');
    expect(html).toContain('<span class="code-line" data-line="5">');
    expect(html).not.toContain('data-line="3"');
    expect(html).not.toContain('data-line="6"');
  });

  test("indented code lines are numbered from their first mapped line", () => {
    const html = render("para\n\n    one\n    two\n");
    expect(html).toContain('<span class="code-line" data-line="3">one</span>');
    expect(html).toContain('<span class="code-line" data-line="4">two</span>');
  });

  test("hljs spans crossing newlines stay balanced per code line", () => {
    const html = render("```js\nconst s = `first\nsecond`;\n```\n");
    const body = /<code[^>]*>([\s\S]*)<\/code>/.exec(html)![1]!;
    for (const line of body.split("\n")) {
      const opens = [...line.matchAll(/<span\b/g)].length;
      const closes = [...line.matchAll(/<\/span>/g)].length;
      expect(opens).toBe(closes);
    }
    // textContent is unchanged by the wrapping.
    expect(body.replace(/<[^>]+>/g, "")).toBe("const s = `first\nsecond`;\n");
  });

  test("an empty fence gains no code lines and no stray newline", () => {
    const html = render("```\n```\n");
    expect(html).not.toContain("code-line");
    expect(html).toContain("<code></code>");
  });

  test("GFM basics render: tables, strikethrough, task lists", () => {
    const html = render("~~gone~~\n\n- [ ] todo\n- [x] done\n");
    expect(html).toContain("<s>gone</s>");
    expect(html).toContain('type="checkbox" disabled>');
    expect(html).toContain('type="checkbox" disabled checked>');
    expect(html).toContain('class="task-list-item"');
    expect(html).toContain("todo");
  });

  test("raw HTML is escaped, not passed through", () => {
    const html = render("<script>alert(1)</script>\n");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("inline elements carry no stamp of their own", () => {
    const html = render("a **bold** word\n");
    expect(html).toContain("<strong>bold</strong>");
    expect(stamps(html)).toEqual(["1-1"]);
  });
});
