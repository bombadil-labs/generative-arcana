/** Deck glyphs are untrusted data, including previously stored/shared deck revisions.
 * Keep this boundary at rendering: import-time validation cannot protect existing decks. */
import createDOMPurify, { type Config, type DOMPurify } from "dompurify";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_GLYPH_LENGTH = 100_000;
const MAX_GLYPH_ELEMENTS = 1_000;
const ID = "[a-zA-Z_][a-zA-Z0-9_.:-]*";
const LOCAL_HREF = new RegExp(`^#(${ID})$`);
const LOCAL_URL = new RegExp(`^url\\(\\s*(['\"]?)#(${ID})\\1\\s*\\)$`, "i");
const PAINT = /^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\))$/i;
const PAINT_ATTRS = new Set(["fill", "stroke", "color", "stop-color"]);
const REFERENCE_ATTRS = new Set(["clip-path", "mask"]);

// An intentionally small static SVG vocabulary. In particular: no scripts, event handlers,
// CSS/style, HTML/foreignObject, links, image/feImage, filters, or SMIL animation/set elements.
const CONFIG: Config = {
  ALLOWED_TAGS: [
    "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "title", "desc", "text", "tspan", "symbol", "use", "clippath", "mask",
    "lineargradient", "radialgradient", "stop",
  ],
  ALLOWED_ATTR: [
    "xmlns", "xmlns:xlink", "viewbox", "preserveaspectratio", "width", "height", "x", "y",
    "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
    "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
    "stroke-opacity", "opacity", "color", "vector-effect", "id", "href", "xlink:href",
    "clip-path", "clip-rule", "clippathunits", "mask", "maskunits", "maskcontentunits",
    "gradientunits", "gradienttransform", "spreadmethod", "offset", "stop-color", "stop-opacity",
    "fx", "fy", "fr", "text-anchor", "dominant-baseline", "font-size", "font-weight", "dx", "dy",
  ],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: false,
  RETURN_TRUSTED_TYPE: false,
};

let purifier: DOMPurify | undefined;
let purifierWindow: Window | undefined;
function browserPurifier(): DOMPurify | undefined {
  // DOMPurify is deliberately NOT backed by a server DOM in production. Never pass raw SVG
  // through when SSR, an unsupported browser, or a missing DOM makes sanitization unavailable.
  if (typeof window === "undefined" || !window.document) return undefined;
  if (!purifier || purifierWindow !== window) {
    purifier = createDOMPurify(window);
    purifierWindow = window;
    if (!purifier.isSupported) return undefined;
    purifier.addHook("uponSanitizeAttribute", (_node, data) => {
      const name = data.attrName.toLowerCase();
      const value = data.attrValue.trim();
      if (name === "xmlns") {
        data.keepAttr = value === SVG_NS;
      } else if (name === "xmlns:xlink") {
        data.keepAttr = value === "http://www.w3.org/1999/xlink";
      } else if (name === "href" || name === "xlink:href") {
        data.keepAttr = LOCAL_HREF.test(value);
      } else if (REFERENCE_ATTRS.has(name)) {
        data.keepAttr = value === "none" || LOCAL_URL.test(value);
      } else if (PAINT_ATTRS.has(name)) {
        // Do not accept CSS escapes, variables, arbitrary functions or URL fallbacks. DOMPurify
        // alone permits CSS paint values and external SVG references; glyphs do not need them.
        data.keepAttr = PAINT.test(value) || ((name === "fill" || name === "stroke") && LOCAL_URL.test(value));
      }
    });
  }
  return purifier.isSupported ? purifier : undefined;
}

export function glyphSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? Math.min(size, 512) : 16;
}

/** Return safe inline SVG, or null for a trusted generic glyph fallback.
 * All URL references must resolve inside this one glyph; generated IDs isolate copies.
 * Never modify the returned markup: sanitization is the last operation before the DOM sink. */
export function sanitizeGlyphSvg(raw: string, uid: string, size: number): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_GLYPH_LENGTH) return null;
  try {
    const clean = browserPurifier();
    if (!clean) return null;
    const fragment = clean.sanitize(raw, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
    const root = fragment.firstElementChild;
    if (!root || root.localName !== "svg" || root.namespaceURI !== SVG_NS || fragment.children.length !== 1) return null;
    if (Array.from(fragment.childNodes).some((node) => node !== root && node.textContent?.trim())) return null;
    const elements = [root, ...Array.from(root.querySelectorAll("*"))];
    if (elements.length > MAX_GLYPH_ELEMENTS || elements.some((node) => node.namespaceURI !== SVG_NS)) return null;
    if (!root.querySelector("path,rect,circle,ellipse,line,polyline,polygon,text,use")) return null;

    const prefix = `arcana-${uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "glyph"}-`;
    const ids = new Map<string, string>();
    for (const element of elements) {
      const id = element.getAttribute("id");
      if (id === null) continue;
      if (!LOCAL_HREF.test(`#${id}`) || ids.has(id)) {
        element.removeAttribute("id");
        continue;
      }
      const replacement = `${prefix}${ids.size}`;
      ids.set(id, replacement);
      element.setAttribute("id", replacement);
    }
    for (const element of elements) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        const href = name === "href" || name === "xlink:href";
        const target = href ? LOCAL_HREF.exec(value)?.[1] : LOCAL_URL.exec(value)?.[2];
        if (target) {
          const replacement = ids.get(target);
          if (replacement) attribute.value = href ? `#${replacement}` : `url(#${replacement})`;
          else element.removeAttributeNode(attribute);
        }
      }
    }
    root.setAttribute("width", String(glyphSize(size)));
    root.setAttribute("height", String(glyphSize(size)));
    // DOM operations above only reduce capabilities, but sanitize again after serialization to
    // cover mutation/parsing differences. No regex rewriting or other edits follow this step.
    return clean.sanitize(root.outerHTML, CONFIG);
  } catch {
    return null;
  }
}
