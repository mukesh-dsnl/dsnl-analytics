/**
 * Makes a PNG image of a part of the page, exactly as it is drawn on screen,
 * and copies it to the clipboard.
 *
 * The technique: copy the element and everything in it, write each copy's
 * final (computed) styles onto it inline so it no longer needs the page's
 * stylesheet, put the copy inside an SVG <foreignObject>, draw that SVG onto a
 * canvas, and save the canvas. Charts are SVG already and come along as they
 * are. Nothing is sent anywhere and no library is needed.
 *
 * The fonts the page uses (the app's own and Inter) are embedded in the image
 * too: an image cannot fetch them itself, and without them text falls back to
 * a wider system font and wraps where it did not on screen.
 *
 * What a picture cannot keep: hover boxes, and anything still loading.
 */

/**
 * The browser's own default styles for each tag, measured in a blank frame
 * with none of the app's stylesheets. Only what differs from these is written
 * onto the copy — and they are what the copy falls back to inside the image,
 * where the app's style reset does not apply (a button's default border, for
 * instance, has to be written out as none).
 */
const defaults = new Map<string, Map<string, string>>();
let blank: HTMLIFrameElement | null = null;

function blankDocument(): Document {
  if (!blank) {
    blank = document.createElement('iframe');
    blank.setAttribute('aria-hidden', 'true');
    blank.style.cssText = 'position:absolute;left:-99999px;top:0;width:10px;height:10px;border:0;visibility:hidden;';
    document.body.appendChild(blank);
    blank.contentDocument!.open();
    blank.contentDocument!.write('<!doctype html><html><head></head><body></body></html>');
    blank.contentDocument!.close();
  }
  return blank.contentDocument!;
}

function defaultStyle(tag: string, svg: boolean): Map<string, string> {
  const key = (svg ? 'svg:' : '') + tag;
  const cached = defaults.get(key);
  if (cached) return cached;
  const doc = blankDocument();
  const probe = svg ? doc.createElementNS('http://www.w3.org/2000/svg', tag) : doc.createElement(tag);
  const host = svg ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg') : doc.body;
  if (svg) doc.body.appendChild(host);
  host.appendChild(probe);
  const cs = doc.defaultView!.getComputedStyle(probe);
  const values = new Map<string, string>();
  for (let i = 0; i < cs.length; i++) values.set(cs[i], cs.getPropertyValue(cs[i]));
  (svg ? host : probe).remove();
  defaults.set(key, values);
  return values;
}

// ── Fonts ─────────────────────────────────────────────────────────────────

let fontCss: Promise<string> | null = null;

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Every @font-face the page has, with its font files written in as data. */
async function collectFontCss(): Promise<string> {
  const rules: { css: string; base: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const base = sheet.href ?? location.href;
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSFontFaceRule) rules.push({ css: rule.cssText, base });
      }
    } catch {
      // A stylesheet from another site (Google Fonts) cannot be read in place;
      // its text can be fetched (the host allows it, and the browser has it cached).
      if (!sheet.href) continue;
      try {
        const text = await (await fetch(sheet.href)).text();
        for (const block of text.match(/@font-face\s*{[^}]*}/g) ?? []) {
          // Latin only: the other alphabets' files are never used here.
          const range = block.match(/unicode-range:\s*([^;]+)/)?.[1] ?? '';
          if (range && !/U\+0000-00FF/i.test(range)) continue;
          rules.push({ css: block, base: sheet.href });
        }
      } catch {
        // Offline or blocked: those fonts fall back to the system font.
      }
    }
  }
  const out: string[] = [];
  for (const { css, base } of rules) {
    let rule = css;
    for (const match of css.match(/url\((['"]?)([^'")]+)\1\)/g) ?? []) {
      const href = match.replace(/^url\((['"]?)/, '').replace(/['"]?\)$/, '');
      if (href.startsWith('data:')) continue;
      try {
        rule = rule.replace(match, `url("${await toDataUrl(new URL(href, base).href)}")`);
      } catch {
        // That file cannot be had; the rule keeps its link and simply won't load.
      }
    }
    out.push(rule);
  }
  return out.join('\n');
}

/** The page's fonts as embeddable CSS — collected once, then reused. */
function embeddedFonts(): Promise<string> {
  fontCss ??= collectFontCss();
  return fontCss;
}

/** The style declarations that differ from the tag's default. */
function styleText(source: Element, pseudo?: '::before' | '::after'): string {
  const cs = getComputedStyle(source, pseudo);
  const base = pseudo ? null : defaultStyle(source.localName, source instanceof SVGElement);
  const parts: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    const prop = cs[i];
    const value = cs.getPropertyValue(prop);
    // Border and outline widths are always written out: a hidden border reports
    // a width of 0 like the default does, but the app's reset makes every
    // border "solid", so a skipped width would come back as the default 3px.
    const always = prop.startsWith('border') || prop.startsWith('outline');
    if (base && !always && base.get(prop) === value) continue;
    // Transitions and animations would only replay; the picture is one moment.
    if (prop.startsWith('transition') || prop.startsWith('animation')) continue;
    parts.push(`${prop}:${value}`);
  }
  return parts.join(';');
}

let pseudoCount = 0;

/** A copy of `node` with every element's styles written inline. */
function cloneStyled(node: Node, pseudoRules: string[]): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
  if (!(node instanceof Element)) return null;
  // Nothing the eye sees: skip.
  if (node instanceof HTMLScriptElement || node instanceof HTMLStyleElement) return null;
  // Controls that belong on screen only (the copy button itself) are left out.
  if (node.hasAttribute('data-snapshot-skip')) return null;
  const cs = getComputedStyle(node);
  if (cs.display === 'none') return null;

  const copy = node.cloneNode(false) as Element;
  copy.setAttribute('style', styleText(node));
  copy.removeAttribute('class');
  copy.removeAttribute('id');

  // ::before / ::after decorations (gradient edges, markers) become rules on a marker attribute.
  for (const pseudo of ['::before', '::after'] as const) {
    const content = getComputedStyle(node, pseudo).content;
    if (content && content !== 'none' && content !== 'normal') {
      const mark = `p${++pseudoCount}`;
      copy.setAttribute('data-snap', mark);
      pseudoRules.push(`[data-snap="${mark}"]${pseudo}{${styleText(node, pseudo)}}`);
    }
  }

  for (const child of Array.from(node.childNodes)) {
    const c = cloneStyled(child, pseudoRules);
    if (c) copy.appendChild(c);
  }
  return copy;
}

/** Canvases cap out around 16k pixels on a side; scale down for very long pages. */
const MAX_SIDE = 16000;

/** A PNG of `element` as drawn, on `background`, with `pad` pixels of it around the edge. */
export async function renderElementPng(element: HTMLElement, options: { background?: string; pad?: number } = {}): Promise<Blob> {
  // Border included (offset*), and anything that overflows it (scroll*).
  const width = Math.ceil(Math.max(element.offsetWidth, element.scrollWidth));
  const height = Math.ceil(Math.max(element.offsetHeight, element.scrollHeight));
  const pseudoRules: string[] = [];
  const copy = cloneStyled(element, pseudoRules) as HTMLElement;
  copy.style.margin = '0';
  copy.style.width = `${width}px`;

  const wrap = document.createElement('div');
  wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrap.style.cssText = `width:${width}px;height:${height}px;`;
  const style = document.createElement('style');
  style.textContent = [await embeddedFonts(), ...pseudoRules].join('\n');
  wrap.appendChild(style);
  wrap.appendChild(copy);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${new XMLSerializer().serializeToString(wrap)}</foreignObject></svg>`;

  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const pad = options.pad ?? 16;
  const scale = Math.min(2, MAX_SIDE / (height + pad * 2), MAX_SIDE / (width + pad * 2));
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor((width + pad * 2) * scale);
  canvas.height = Math.floor((height + pad * 2) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the image.');
  ctx.scale(scale, scale);
  ctx.fillStyle = options.background ?? '#ffffff';
  ctx.fillRect(0, 0, width + pad * 2, height + pad * 2);
  ctx.drawImage(image, pad, pad, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The image could not be made.');
  return blob;
}

/**
 * Copies a picture of `element` to the clipboard, ready to paste into a chat,
 * a mail or a document. The clipboard write starts at once, inside the click,
 * with the picture handed over as it finishes — a browser only lets a page
 * write to the clipboard straight after the user acts.
 */
export async function copyElementImage(element: HTMLElement): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('This browser cannot copy images. Use Chrome or Edge on this site.');
  }
  const png = renderElementPng(element, { background: backgroundOf(element.parentElement ?? element) });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** The background the element sits on: its own, or the nearest ancestor's that is not transparent. */
export function backgroundOf(element: HTMLElement): string {
  for (let el: HTMLElement | null = element; el; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
  }
  return '#ffffff';
}
