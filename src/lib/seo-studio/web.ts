// @ts-nocheck
/**
 * Tải trang + đọc HTML — chuyển từ audit.py (fetch, decode, header, PageParser, schema_types).
 * PageParser bắt chước html.parser.HTMLParser của Python (convert_charrefs=True; script/style là
 * văn bản thô) để kết quả audit khớp bản gốc.
 */
import { gunzipSync } from "node:zlib";

export const UA = "Mozilla/5.0 (compatible; MrVuSEOStudio/1.0; +internal SEO tool)";
const EMPTY = new Uint8Array(0);

async function readCapped(r: Response, max: number): Promise<Uint8Array> {
  if (!r.body) return EMPTY;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    while (n < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }
  const out = new Uint8Array(Math.min(n, max));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - o);
    out.set(c.subarray(0, take), o);
    o += take;
    if (o >= out.length) break;
  }
  return out;
}

/** Trả về {url (cuối cùng), status, headers, body (bytes), elapsed (giây), redirects}. Không bao giờ ném lỗi. */
export async function fetchPage(url: string, timeout = 20, method = "GET", maxBytes = 6_000_000) {
  const chain: [number, string][] = [];
  const t0 = Date.now();
  const signal = AbortSignal.timeout(timeout * 1000);
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
  };
  let cur = url;
  let m = method;
  try {
    for (let hop = 0; hop <= 10; hop++) {
      const r = await fetch(cur, { method: m, headers, redirect: "manual", signal });
      const loc = r.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(r.status) && loc) {
        const next = new URL(loc, cur).toString();
        chain.push([r.status, next]);
        try {
          await r.body?.cancel();
        } catch {}
        cur = next;
        if (r.status === 303 && m !== "HEAD") m = "GET";
        continue;
      }
      const body = m === "GET" ? await readCapped(r, r.status < 400 ? maxBytes : 200_000) : EMPTY;
      return { url: cur, status: r.status, headers: Object.fromEntries(r.headers.entries()), body, elapsed: (Date.now() - t0) / 1000, redirects: chain };
    }
    return { url: cur, status: 0, headers: {}, body: EMPTY, elapsed: (Date.now() - t0) / 1000, redirects: chain, error: "chuyển hướng quá nhiều lần" };
  } catch (e: any) {
    const reason = e?.name === "TimeoutError" || e?.name === "AbortError" ? "hết thời gian chờ" : e?.cause?.code || e?.cause?.message || e?.message || "lỗi kết nối";
    return { url, status: 0, headers: {}, body: EMPTY, elapsed: (Date.now() - t0) / 1000, redirects: chain, error: String(reason) };
  }
}

export function header(res: any, name: string): string {
  for (const [k, v] of Object.entries(res.headers || {})) if (k.toLowerCase() === name.toLowerCase()) return String(v);
  return "";
}

export function decode(res: any): string {
  let body: Uint8Array = res.body || EMPTY;
  if (body[0] === 0x1f && body[1] === 0x8b) {
    try {
      body = gunzipSync(body);
    } catch {}
  }
  const ctype = header(res, "content-type");
  let enc = (ctype.match(/charset=([\w-]+)/i) || [])[1];
  if (!enc) {
    const head = Buffer.from(body.subarray(0, 3000)).toString("latin1");
    enc = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try {
    return new TextDecoder(enc || "utf-8", { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
  }
}

// ---------------------------------------------------------------- giải mã ký tự HTML (html.unescape)
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(" ");
const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ensp: " ", emsp: " ", thinsp: " ", zwnj: "‌", zwj: "‍",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", dagger: "†", Dagger: "‡",
  bull: "•", hellip: "…", permil: "‰", prime: "′", Prime: "″", lsaquo: "‹", rsaquo: "›", euro: "€", trade: "™",
  larr: "←", uarr: "↑", rarr: "→", darr: "↓", harr: "↔", Oelig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š", Yuml: "Ÿ", fnof: "ƒ", circ: "ˆ", tilde: "˜",
};
LATIN1.forEach((n, i) => (ENT[n] = String.fromCharCode(160 + i)));

export function unescapeHtml(s: string): string {
  if (!s || s.indexOf("&") < 0) return s;
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);?/g, (m, g) => {
    if (g[0] === "#") {
      const n = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "�";
      try {
        return String.fromCodePoint(n);
      } catch {
        return "�";
      }
    }
    return ENT[g] !== undefined ? ENT[g] : m;
  });
}

// ---------------------------------------------------------------- bộ tách thẻ (html.parser)
const RAW = new Set(["script", "style"]);
const ATTR = /([^\s=\/>"'][^\s=\/>]*)(?:\s*=\s*('[^']*'|"[^"]*"|[^\s>]*))?/g;

function parseAttrs(s: string): [string, string | null][] {
  const out: [string, string | null][] = [];
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(s))) {
    let v: string | null = m[2] === undefined ? null : m[2];
    if (v !== null && ((v[0] === "'" && v.endsWith("'")) || (v[0] === '"' && v.endsWith('"'))) && v.length >= 2) v = v.slice(1, -1);
    if (v !== null) v = unescapeHtml(v);
    out.push([m[1].toLowerCase(), v]);
  }
  return out;
}

/** Duyệt HTML và gọi lại cb.start(tag, attrs) / cb.end(tag) / cb.data(text) như HTMLParser. */
export function tokenize(html: string, cb: { start: Function; end: Function; data: Function }) {
  const n = html.length;
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      cb.data(unescapeHtml(buf));
      buf = "";
    }
  };
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      buf += html.slice(i);
      break;
    }
    buf += html.slice(i, lt);
    i = lt;
    if (html.startsWith("<!--", i)) {
      const e = html.indexOf("-->", i + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const e = html.indexOf(">", i + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (html[i + 1] === "/") {
      const m = /^<\/([a-zA-Z][^\s>\/]*)[^>]*>/.exec(html.slice(i, i + 300));
      if (m) {
        flush();
        cb.end(m[1].toLowerCase());
        i += m[0].length;
        continue;
      }
      buf += "<";
      i++;
      continue;
    }
    if (/[a-zA-Z]/.test(html[i + 1] || "")) {
      // tìm '>' kết thúc thẻ, bỏ qua '>' nằm trong dấu nháy
      let j = i + 1;
      let quote = "";
      while (j < n) {
        const c = html[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= n) {
        buf += html.slice(i);
        break;
      }
      const inner = html.slice(i + 1, j);
      const nm = /^([a-zA-Z][^\s\/>]*)/.exec(inner);
      const tag = nm[1].toLowerCase();
      const selfClose = inner.endsWith("/");
      const attrs = parseAttrs(inner.slice(nm[1].length).replace(/\/$/, ""));
      flush();
      cb.start(tag, attrs);
      i = j + 1;
      if (selfClose) {
        cb.end(tag);
        continue;
      }
      if (RAW.has(tag)) {
        const re = new RegExp("</" + tag + "\\s*>", "i");
        const rest = html.slice(i);
        const mm = re.exec(rest);
        const raw = mm ? rest.slice(0, mm.index) : rest;
        if (raw) cb.data(raw);
        cb.end(tag);
        i = mm ? i + mm.index + mm[0].length : n;
      }
      continue;
    }
    buf += "<";
    i++;
  }
  flush();
}

/** Bản chuyển của audit.PageParser. */
export class PageParser {
  title: string | null = null;
  meta: Record<string, string> = {};
  links_rel: Record<string, string>[] = [];
  lang: string | null = null;
  headings: [number, string][] = [];
  images: any[] = [];
  anchors: any[] = [];
  jsonld: string[] = [];
  text: string[] = [];
  scripts = 0;
  styles = 0;
  iframes = 0;
  private _skip = 0;
  private _cap: [string, string[]] | null = null;
  private _h: [number, string[]] | null = null;
  private _a: [Record<string, string>, string[]] | null = null;

  feed(html: string) {
    tokenize(html, {
      start: (t: string, at: any[]) => this.start(t, at),
      end: (t: string) => this.end(t),
      data: (d: string) => this.data(d),
    });
  }

  private start(tag: string, attrs: [string, string | null][]) {
    const a: Record<string, string> = {};
    const has: Record<string, boolean> = {};
    for (const [k, v] of attrs) {
      a[k] = v || "";
      has[k] = true;
    }
    if (tag === "html") this.lang = has.lang ? a.lang : null;
    else if (tag === "title" && this.title === null) this._cap = ["title", []];
    else if (tag === "meta") {
      const key = (a.name || a.property || a["http-equiv"] || "").toLowerCase();
      if (key && !(key in this.meta)) this.meta[key] = a.content || "";
      if (has.charset && !("charset" in this.meta)) this.meta.charset = a.charset;
    } else if (tag === "link") {
      this.links_rel.push(a);
      if ((a.rel || "").toLowerCase().includes("stylesheet")) this.styles++;
    } else if (tag === "script") {
      if ((a.type || "").toLowerCase().includes("ld+json")) this._cap = ["ld", []];
      else {
        if (a.src) this.scripts++;
        this._skip++;
      }
    } else if (["style", "noscript", "svg", "template"].includes(tag)) this._skip++;
    else if (/^h[1-6]$/.test(tag)) this._h = [Number(tag[1]), []];
    else if (tag === "img") {
      this.images.push({ src: a.src || a["data-src"] || "", alt: has.alt ? a.alt : null, width: has.width ? a.width : null, height: has.height ? a.height : null, loading: a.loading || "" });
      if (this._a && a.alt) this._a[1].push(a.alt);
    } else if (tag === "a") this._a = [a, []];
    else if (tag === "iframe") this.iframes++;
  }

  private end(tag: string) {
    if (tag === "title" && this._cap && this._cap[0] === "title") {
      this.title = this._cap[1].join("").split(/\s+/).filter(Boolean).join(" ");
      this._cap = null;
    } else if (tag === "script") {
      if (this._cap && this._cap[0] === "ld") {
        this.jsonld.push(this._cap[1].join(""));
        this._cap = null;
      } else if (this._skip) this._skip--;
    } else if (["style", "noscript", "svg", "template"].includes(tag) && this._skip) this._skip--;
    else if (/^h[1-6]$/.test(tag) && this._h) {
      this.headings.push([this._h[0], this._h[1].join("").split(/\s+/).filter(Boolean).join(" ")]);
      this._h = null;
    } else if (tag === "a" && this._a) {
      const [at, txt] = this._a;
      this.anchors.push({ href: at.href || "", rel: (at.rel || "").toLowerCase(), text: txt.join(" ").split(/\s+/).filter(Boolean).join(" "), title: at.title || "" });
      this._a = null;
    }
  }

  private data(d: string) {
    if (this._cap) {
      this._cap[1].push(d);
      return;
    }
    if (this._skip) return;
    if (this._h) this._h[1].push(d);
    if (this._a) this._a[1].push(d);
    this.text.push(d);
  }
}

/** Đọc các khối JSON-LD, trả về [tập @type, số khối lỗi cú pháp]. */
export function schemaTypes(blocks: string[]): [Set<string>, number] {
  const types = new Set<string>();
  let errors = 0;
  for (const raw of blocks) {
    let data: any;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      errors++;
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const d = stack.pop();
      if (Array.isArray(d)) stack.push(...d);
      else if (d && typeof d === "object") {
        const t = d["@type"];
        for (const x of Array.isArray(t) ? t : [t]) if (typeof x === "string") types.add(x);
        for (const v of Object.values(d)) if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return [types, errors];
}

// ---------------------------------------------------------------- tiện ích URL
export function bareHost(h: string): string {
  h = String(h || "").toLowerCase().split(":")[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}
// Tách URL như urllib.parse.urlparse (giữ nguyên ký tự gốc, không mã hóa lại như new URL()).
const URL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^\/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/;
export function urlParts(u: string) {
  const m = URL_RE.exec(String(u || "").trim());
  if (!m) return { scheme: "", netloc: "", path: String(u || ""), query: "" };
  return { scheme: m[1].toLowerCase(), netloc: m[2], path: m[3] || "", query: m[4] || "" };
}
export function netloc(u: string): string {
  return urlParts(u).netloc;
}
export function sameSite(url: string, host: string): boolean {
  return bareHost(netloc(url)) === bareHost(host);
}
/** urldefrag(u.strip())[0] */
export function cleanUrl(u: string): string {
  u = String(u || "").trim();
  const i = u.indexOf("#");
  return i >= 0 ? u.slice(0, i) : u;
}
/** urljoin của Python (đủ dùng cho liên kết trong trang). */
export function urljoin(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
