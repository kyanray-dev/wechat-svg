#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const UPLOAD_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";
const DRAFT_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";
const DRAFT_UPDATE_URL = "https://api.weixin.qq.com/cgi-bin/draft/update";

const DEFAULT_THEME = "lapis";
const DEFAULT_HIGHLIGHT = "solarized-light";

function usage() {
  console.log(`Usage:
  publish-svg-draft.mjs --file <article.svg|article.html|article.md> --title <title> --cover <cover.jpg>

Options:
  --file <path>                 Input file. Positional file path is also accepted.
  --title <text>                Draft title. Overrides Markdown frontmatter.
  --cover <path-or-url>         Cover image. Required unless body image upload provides a cover.
  --author <text>               Article author.
  --digest <text>               Article summary.
  --source-url <url>            Original article URL.
  --need-open-comment           Enable comments.
  --only-fans-can-comment       Only fans can comment.
  --app-id <id>                 WeChat AppID.
  --app-secret <secret>         WeChat AppSecret.
  --access-token <token>        Use an existing access token.
  --env-file <path>             Load KEY=VALUE entries before resolving credentials.
  --tools-md <path>             Read export WECHAT_APP_ID/SECRET lines.
  --theme <id>                  Built-in Markdown theme. Default: ${DEFAULT_THEME}
  --highlight <id>              Built-in code block style. Default: ${DEFAULT_HIGHLIGHT}
  --svg-wrap / --no-svg-wrap    Wrap Markdown-rendered HTML in an SVG foreignObject. Default for .md: enabled.
  --width <px>                  SVG wrapper width. Default: 677.
  --height <px>                 SVG wrapper height. Auto-estimated when omitted.
  --out <path>                  Write generated draft content HTML.
  --update-media-id <media_id>  Update an existing draft instead of creating a new one.
  --index <number>              Article index when updating a multi-article draft. Default: 0.
  --dry-run                     Build content and metadata without calling WeChat APIs.
  --verbose                     Print extra diagnostics.
  --help                        Show this help.

Examples:
  publish-svg-draft.mjs --file article.svg --title "SVG 排版文章" --cover cover.jpg
  publish-svg-draft.mjs --file article.md --title "文章标题" --cover cover.jpg --theme lapis
`);
}

function parseArgs(argv) {
  const opts = {
    file: "",
    title: "",
    cover: "",
    author: "",
    digest: "",
    sourceUrl: "",
    appId: "",
    appSecret: "",
    accessToken: "",
    envFile: "",
    toolsMd: "",
    theme: DEFAULT_THEME,
    highlight: DEFAULT_HIGHLIGHT,
    svgWrap: undefined,
    width: 677,
    height: 0,
    out: "",
    updateMediaId: "",
    index: 0,
    dryRun: false,
    verbose: false,
    needOpenComment: false,
    onlyFansCanComment: false
  };
  const positional = [];
  const keyMap = {
    "source-url": "sourceUrl",
    "app-id": "appId",
    "app-secret": "appSecret",
    "access-token": "accessToken",
    "env-file": "envFile",
    "tools-md": "toolsMd",
    "update-media-id": "updateMediaId"
  };
  const bools = new Set([
    "dry-run",
    "verbose",
    "help",
    "svg-wrap",
    "no-svg-wrap",
    "need-open-comment",
    "only-fans-can-comment"
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const eq = raw.indexOf("=");
    const key = eq >= 0 ? raw.slice(0, eq) : raw;
    const inlineValue = eq >= 0 ? raw.slice(eq + 1) : undefined;

    if (bools.has(key)) {
      if (key === "help") opts.help = true;
      else if (key === "svg-wrap") opts.svgWrap = true;
      else if (key === "no-svg-wrap") opts.svgWrap = false;
      else if (key === "dry-run") opts.dryRun = true;
      else if (key === "need-open-comment") opts.needOpenComment = true;
      else if (key === "only-fans-can-comment") opts.onlyFansCanComment = true;
      else opts[key.replaceAll("-", "")] = true;
      continue;
    }

    const value = inlineValue !== undefined ? inlineValue : argv[++i];
    if (value === undefined) {
      throw new Error(`Missing value for --${key}`);
    }
    const prop = keyMap[key] || key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(prop in opts)) {
      throw new Error(`Unknown option: --${key}`);
    }
    opts[prop] = prop === "width" || prop === "height" || prop === "index" ? Number(value) : value;
  }

  if (!opts.file && positional.length > 0) {
    opts.file = positional[0];
  }
  return opts;
}

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "wechat-svg-publisher");
  if (process.env.APPDATA) return path.join(process.env.APPDATA, "wechat-svg-publisher");
  return path.join(os.homedir(), ".config", "wechat-svg-publisher");
}

function getLegacyWenyanConfigDir() {
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "wenyan-md");
  if (process.env.APPDATA) return path.join(process.env.APPDATA, "wenyan-md");
  return path.join(os.homedir(), ".config", "wenyan-md");
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

async function loadEnvFile(file) {
  if (!file) return;
  const content = await fs.readFile(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

async function readToolsMd(file) {
  const result = {};
  if (!file) return result;
  try {
    const content = await fs.readFile(file, "utf8");
    for (const key of ["WECHAT_APP_ID", "WECHAT_APP_SECRET"]) {
      const match = content.match(new RegExp(`export\\s+${key}=([^\\s\\n]+)`));
      if (match) result[key] = match[1].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {}
  return result;
}

async function resolveCredentials(opts) {
  if (opts.accessToken) {
    return { appId: opts.appId || process.env.WECHAT_APP_ID || "", appSecret: "", accessToken: opts.accessToken };
  }

  const toolsPath = opts.toolsMd || path.join(os.homedir(), ".openclaw", "workspace", "TOOLS.md");
  const tools = await readToolsMd(toolsPath);
  const envAppId = process.env.WECHAT_APP_ID || tools.WECHAT_APP_ID || "";
  const envSecret = process.env.WECHAT_APP_SECRET || tools.WECHAT_APP_SECRET || "";

  if (opts.appId && opts.appSecret) {
    return { appId: opts.appId, appSecret: opts.appSecret };
  }
  if ((!opts.appId || opts.appId === envAppId) && envAppId && envSecret) {
    return { appId: envAppId, appSecret: envSecret };
  }

  const credentialPaths = [
    path.join(getConfigDir(), "credential.json"),
    path.join(getLegacyWenyanConfigDir(), "credential.json")
  ];
  let accounts = {};
  for (const credentialPath of credentialPaths) {
    const credential = await readJson(credentialPath, {});
    accounts = { ...accounts, ...(credential.wechat || {}) };
  }
  if (opts.appId && accounts[opts.appId]?.appSecret) {
    return { appId: opts.appId, appSecret: accounts[opts.appId].appSecret };
  }
  if (opts.appId) {
    const found = Object.entries(accounts).find(([, item]) => item.alias === opts.appId);
    if (found?.[1]?.appSecret) {
      return { appId: found[0], appSecret: found[1].appSecret };
    }
  }
  const entries = Object.entries(accounts);
  if (!opts.appId && entries.length === 1 && entries[0][1]?.appSecret) {
    return { appId: entries[0][0], appSecret: entries[0][1].appSecret };
  }

  throw new Error("Missing WeChat credentials. Set WECHAT_APP_ID/WECHAT_APP_SECRET, pass --app-id/--app-secret, or add credentials to ~/.config/wechat-svg-publisher/credential.json.");
}

async function wechatJson(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`WeChat API returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok || (Object.prototype.hasOwnProperty.call(data, "errcode") && Number(data.errcode) !== 0)) {
    throw new Error(formatWechatError(data, res.status));
  }
  return data;
}

function formatWechatError(data, status) {
  const hints = {
    40001: "invalid credential; check AppID/AppSecret or token",
    40164: "IP not in whitelist; add the current public IP in the WeChat backend",
    45009: "API rate limit exceeded",
    47001: "invalid JSON payload",
    48001: "API unauthorized for this official account",
    45166: "content too long; simplify the SVG/HTML body"
  };
  const code = data?.errcode;
  const msg = data?.errmsg || `HTTP ${status}`;
  return code ? `${code}: ${hints[code] || msg} (${msg})` : msg;
}

async function getAccessToken(opts, appId, appSecret) {
  if (opts.accessToken) return opts.accessToken;

  const tokenPath = path.join(getConfigDir(), "token.json");
  const tokenCache = await readJson(tokenPath, {});
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.appid === appId && tokenCache.accessToken && (tokenCache.expireAt < 0 || tokenCache.expireAt > now + 600)) {
    return tokenCache.accessToken;
  }

  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const data = await wechatJson(await fetch(url));
  await writeJson(tokenPath, {
    appid: appId,
    accessToken: data.access_token,
    expireAt: now + Number(data.expires_in || 7200)
  });
  return data.access_token;
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---")) return { attributes: {}, body: markdown };
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { attributes: {}, body: markdown };
  const attributes = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    let value = item[2].trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (value === "true") attributes[item[1]] = true;
    else if (value === "false") attributes[item[1]] = false;
    else attributes[item[1]] = value;
  }
  return { attributes, body: markdown.slice(match[0].length) };
}

function stripUnsafeSvg(content) {
  return content
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(["']).*?\1/gi, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function styleObjectToString(style) {
  return Object.entries(style)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

function markdownThemeStyles(theme = DEFAULT_THEME, highlight = DEFAULT_HIGHLIGHT) {
  const base = {
    article: {
      "box-sizing": "border-box",
      width: "100%",
      margin: "0",
      padding: "34px 30px 42px",
      background: "#fff",
      color: "#1f2933",
      "font-family": "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif",
      "font-size": "17px",
      "line-height": "1.82",
      "letter-spacing": "0"
    },
    h1: {
      margin: "0 0 26px",
      color: "#111827",
      "font-size": "28px",
      "line-height": "1.35",
      "font-weight": "700"
    },
    h2: {
      margin: "34px 0 14px",
      padding: "0 0 0 12px",
      color: "#111827",
      "font-size": "23px",
      "line-height": "1.45",
      "font-weight": "700",
      "border-left": "4px solid #2f6feb"
    },
    h3: {
      margin: "28px 0 12px",
      color: "#111827",
      "font-size": "20px",
      "line-height": "1.5",
      "font-weight": "700"
    },
    p: {
      margin: "0 0 18px"
    },
    blockquote: {
      margin: "22px 0",
      padding: "12px 16px",
      color: "#4b5563",
      background: "#f7f9fc",
      "border-left": "4px solid #9aa8ba"
    },
    ul: {
      margin: "0 0 18px 0",
      padding: "0 0 0 24px"
    },
    ol: {
      margin: "0 0 18px 0",
      padding: "0 0 0 24px"
    },
    li: {
      margin: "6px 0"
    },
    pre: {
      margin: "22px 0",
      padding: "14px 16px",
      background: highlight === "dark" ? "#111827" : "#f6f8fa",
      color: highlight === "dark" ? "#e5e7eb" : "#24292f",
      "border-radius": "6px",
      overflow: "auto",
      "font-size": "14px",
      "line-height": "1.65"
    },
    code: {
      "font-family": "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace",
      "font-size": "0.92em"
    },
    inlineCode: {
      padding: "2px 5px",
      background: "#f1f5f9",
      color: "#be123c",
      "border-radius": "4px"
    },
    hr: {
      margin: "30px 0",
      border: "0",
      "border-top": "1px solid #d8dee9"
    },
    img: {
      display: "block",
      width: "100%",
      height: "auto",
      margin: "22px auto",
      "border-radius": "6px"
    },
    table: {
      width: "100%",
      margin: "22px 0",
      "border-collapse": "collapse",
      "font-size": "15px"
    },
    th: {
      padding: "8px 10px",
      background: "#f6f8fa",
      border: "1px solid #d8dee9",
      "font-weight": "700",
      "text-align": "left"
    },
    td: {
      padding: "8px 10px",
      border: "1px solid #d8dee9",
      "text-align": "left"
    },
    a: {
      color: "#2563eb",
      "text-decoration": "none"
    }
  };

  if (theme === "ink") {
    base.article.background = "#fbfaf7";
    base.article.color = "#171717";
    base.h2["border-left"] = "4px solid #171717";
    base.blockquote.background = "#f1eee8";
  } else if (theme === "rose") {
    base.article.background = "#fff7f9";
    base.h2["border-left"] = "4px solid #e85d86";
    base.blockquote.background = "#fff0f4";
    base.a.color = "#d6336c";
  }
  return base;
}

function inlineMarkdown(text, styles) {
  const placeholders = [];
  function hold(html) {
    const key = `\u0000${placeholders.length}\u0000`;
    placeholders.push(html);
    return key;
  }

  let output = escapeHtml(text);
  output = output.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt, src, title) => {
    const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : "";
    return hold(`<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}"${titleAttr} style="${styleObjectToString(styles.img)}"/>`);
  });
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, label, href, title) => {
    const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : "";
    return hold(`<a href="${escapeHtmlAttr(href)}"${titleAttr} style="${styleObjectToString(styles.a)}">${label}</a>`);
  });
  output = output.replace(/`([^`]+)`/g, (_m, code) => {
    return hold(`<code style="${styleObjectToString({ ...styles.code, ...styles.inlineCode })}">${escapeHtml(code)}</code>`);
  });
  output = output
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return output.replace(/\u0000(\d+)\u0000/g, (_m, index) => placeholders[Number(index)] || "");
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownTable(lines, styles) {
  const headers = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  return `<table style="${styleObjectToString(styles.table)}"><thead><tr>${headers.map((cell) => `<th style="${styleObjectToString(styles.th)}">${inlineMarkdown(cell, styles)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td style="${styleObjectToString(styles.td)}">${inlineMarkdown(cell, styles)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderMarkdown(markdown, opts) {
  const styles = markdownThemeStyles(opts.theme, opts.highlight);
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let blockquote = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    if (text) blocks.push(`<p style="${styleObjectToString(styles.p)}">${inlineMarkdown(text, styles)}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    const tag = list.type;
    blocks.push(`<${tag} style="${styleObjectToString(styles[tag])}">${list.items.map((item) => `<li style="${styleObjectToString(styles.li)}">${inlineMarkdown(item, styles)}</li>`).join("")}</${tag}>`);
    list = null;
  }

  function flushBlockquote() {
    if (!blockquote.length) return;
    const text = blockquote.join(" ").trim();
    if (text) blocks.push(`<blockquote style="${styleObjectToString(styles.blockquote)}">${inlineMarkdown(text, styles)}</blockquote>`);
    blockquote = [];
  }

  function flushAll() {
    flushParagraph();
    flushList();
    flushBlockquote();
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushAll();
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      flushAll();
      const lang = fence[1] || "";
      const code = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index++;
      }
      const langAttr = lang ? ` data-language="${escapeHtmlAttr(lang)}"` : "";
      blocks.push(`<pre style="${styleObjectToString(styles.pre)}"${langAttr}><code style="${styleObjectToString(styles.code)}">${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^---+$|^\*\*\*+$|^___+$/u.test(trimmed)) {
      flushAll();
      blocks.push(`<hr style="${styleObjectToString(styles.hr)}"/>`);
      continue;
    }

    if (index + 1 < lines.length && trimmed.includes("|") && isTableSeparator(lines[index + 1])) {
      flushAll();
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim().includes("|")) {
        tableLines.push(lines[index]);
        index++;
      }
      index--;
      blocks.push(renderMarkdownTable(tableLines, styles));
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = Math.min(3, heading[1].length);
      const tag = `h${level}`;
      const content = inlineMarkdown(heading[2].replace(/\s+#+$/, ""), styles);
      const id = slugify(heading[2]);
      const idAttr = id ? ` id="${escapeHtmlAttr(id)}"` : "";
      blocks.push(`<${tag}${idAttr} style="${styleObjectToString(styles[tag])}">${content}</${tag}>`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blockquote.push(quote[1]);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushBlockquote();
      const type = unordered ? "ul" : "ol";
      if (!list || list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((unordered || ordered)[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(trimmed);
  }

  flushAll();
  return `<article style="${styleObjectToString(styles.article)}">${blocks.join("\n")}</article>`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseStyleDeclarations(css) {
  const declarations = {};
  for (const part of css.split(";")) {
    const index = part.indexOf(":");
    if (index < 0) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (key && value) declarations[key] = value;
  }
  return declarations;
}

function expandFontShorthand(declarations) {
  const font = declarations.font;
  if (!font) return declarations;
  const tokens = font.match(/"[^"]+"|'[^']+'|[^\s]+/g) || [];
  const sizeIndex = tokens.findIndex((token) => /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)(?:\/.+)?$/i.test(token));
  if (sizeIndex >= 0) {
    const beforeSize = tokens.slice(0, sizeIndex);
    const rawSize = tokens[sizeIndex].split("/")[0];
    const family = tokens.slice(sizeIndex + 1).join(" ").replace(/^['"]|['"]$/g, "");
    const weight = beforeSize.find((token) => /^(normal|bold|bolder|lighter|[1-9]00)$/i.test(token));
    const style = beforeSize.find((token) => /^(italic|oblique)$/i.test(token));
    if (weight && !declarations["font-weight"]) declarations["font-weight"] = weight;
    if (style && !declarations["font-style"]) declarations["font-style"] = style;
    if (rawSize && !declarations["font-size"]) declarations["font-size"] = rawSize;
    if (family && !declarations["font-family"]) declarations["font-family"] = family;
  }
  delete declarations.font;
  return declarations;
}

function declarationsToAttrs(declarations) {
  const supported = new Set([
    "fill",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "text-anchor",
    "dominant-baseline"
  ]);
  const attrs = {};
  const style = [];
  for (const [key, value] of Object.entries(expandFontShorthand({ ...declarations }))) {
    if (supported.has(key)) attrs[key] = value;
    else style.push(`${key}:${value}`);
  }
  return { attrs, style };
}

function parseSvgClassStyles(svg) {
  const classRules = {};
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(svg)) !== null) {
    const css = match[1].replace(/\/\*[\s\S]*?\*\//g, "");
    const ruleRegex = /\.([A-Za-z_][A-Za-z0-9_-]*)\s*\{([^}]*)\}/g;
    let rule;
    while ((rule = ruleRegex.exec(css)) !== null) {
      classRules[rule[1]] = {
        ...(classRules[rule[1]] || {}),
        ...parseStyleDeclarations(rule[2])
      };
    }
  }
  return classRules;
}

function inlineSvgClassStyles(svg) {
  const classRules = parseSvgClassStyles(svg);
  const classNames = Object.keys(classRules);
  if (!classNames.length) return svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  const withoutStyle = svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  return withoutStyle.replace(/<([A-Za-z][A-Za-z0-9:_-]*)(\s[^<>]*?\bclass\s*=\s*(["'])([^"']+)\3[^<>]*?)>/g, (full, tag, attrs, _quote, classValue) => {
    const selfClosing = /\/\s*$/.test(attrs);
    const declarations = {};
    for (const className of classValue.split(/\s+/).filter(Boolean)) {
      Object.assign(declarations, classRules[className] || {});
    }
    const expanded = declarationsToAttrs(declarations);
    let nextAttrs = selfClosing ? attrs.replace(/\/\s*$/, "") : attrs;
    for (const [name, value] of Object.entries(expanded.attrs)) {
      const attrRegex = new RegExp(`\\s${name}\\s*=\\s*(['"])[\\s\\S]*?\\1`, "i");
      if (!attrRegex.test(nextAttrs)) nextAttrs += ` ${name}="${escapeAttr(value)}"`;
    }
    if (expanded.style.length) {
      const styleValue = expanded.style.join(";");
      if (/\sstyle\s*=\s*(['"])([\s\S]*?)\1/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(/\sstyle\s*=\s*(['"])([\s\S]*?)\1/i, (_m, q, existing) => ` style=${q}${existing};${escapeAttr(styleValue)}${q}`);
      } else {
        nextAttrs += ` style="${escapeAttr(styleValue)}"`;
      }
    }
    return `<${tag}${nextAttrs}${selfClosing ? " /" : ""}>`;
  });
}

function normalizeSvg(svg) {
  let clean = inlineSvgClassStyles(stripUnsafeSvg(svg).trim());
  if (!/<svg\b/i.test(clean)) return clean;
  clean = clean.replace(/<svg\b([^>]*)>/i, (match, attrs) => {
    let next = attrs;
    if (!/\sxmlns\s*=/.test(next)) next += ' xmlns="http://www.w3.org/2000/svg"';
    if (!/\sstyle\s*=/.test(next)) next += ' style="display:block;width:100%;height:auto;"';
    return `<svg${next}>`;
  });
  return `<section style="line-height:0;margin:0;padding:0;">${clean}</section>`;
}

function estimateHeight(html, width) {
  const text = html
    .replace(/<pre[\s\S]*?<\/pre>/gi, (block) => " ".repeat(Math.max(160, block.length / 2)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const charsPerLine = Math.max(18, Math.floor(width / 18));
  const textLines = Math.ceil(text.length / charsPerLine);
  const blockCount = (html.match(/<(p|li|h1|h2|h3|blockquote|pre|table)\b/gi) || []).length;
  const imageCount = (html.match(/<(img|svg|image)\b/gi) || []).length;
  return Math.max(640, Math.ceil(textLines * 28 + blockCount * 18 + imageCount * 360 + 160));
}

function wrapHtmlAsSvg(html, opts) {
  const width = Number(opts.width || 677);
  const height = Number(opts.height || estimateHeight(html, width));
  return `<section style="line-height:0;margin:0;padding:0;">
<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" style="display:block;width:100%;height:auto;">
  <foreignObject x="0" y="0" width="${width}" height="${height}">
    <section xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${width}px;min-height:${height}px;background:#ffffff;margin:0;padding:0;">
${stripUnsafeSvg(html)}
    </section>
  </foreignObject>
</svg>
</section>`;
}

function normalizeCliAssetReference(ref) {
  if (!ref || /^(https?:\/\/|data:)/i.test(ref) || path.isAbsolute(ref)) return ref;
  return path.resolve(ref);
}

async function buildContent(opts) {
  if (!opts.file) throw new Error("Missing --file.");
  const inputPath = path.resolve(opts.file);
  const ext = path.extname(inputPath).toLowerCase();
  const raw = await fs.readFile(inputPath, "utf8");
  const baseDir = path.dirname(inputPath);
  const parsedMarkdown = ext === ".md" || ext === ".markdown" ? parseFrontmatter(raw) : { attributes: {}, body: raw };
  const frontmatter = parsedMarkdown.attributes;

  const metadata = {
    title: opts.title || frontmatter.title || "",
    cover: opts.cover ? normalizeCliAssetReference(opts.cover) : frontmatter.cover || "",
    author: opts.author || frontmatter.author || "",
    digest: opts.digest || frontmatter.digest || frontmatter.description || "",
    sourceUrl: opts.sourceUrl || frontmatter.source_url || "",
    needOpenComment: opts.needOpenComment || frontmatter.need_open_comment === true,
    onlyFansCanComment: opts.onlyFansCanComment || frontmatter.only_fans_can_comment === true
  };

  let content;
  if (ext === ".md" || ext === ".markdown") {
    const rendered = renderMarkdown(parsedMarkdown.body, opts);
    const shouldWrap = opts.svgWrap !== false;
    content = shouldWrap ? wrapHtmlAsSvg(rendered, opts) : stripUnsafeSvg(rendered);
  } else if (ext === ".svg") {
    content = normalizeSvg(raw);
  } else {
    content = stripUnsafeSvg(raw);
  }

  if (!metadata.title) {
    throw new Error("Missing title. Pass --title or add `title:` to Markdown frontmatter.");
  }
  return { inputPath, baseDir, content, metadata };
}

function isUploadableReference(url) {
  return url &&
    !/^https:\/\/mmbiz\.qpic\.cn\//i.test(url) &&
    !/^#/.test(url) &&
    !/^asset:\/\//i.test(url);
}

function mimeFromName(name, fallback = "application/octet-stream") {
  const ext = path.extname(name.split("?")[0]).toLowerCase();
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
  }[ext] || fallback;
}

async function imageBytesFromReference(ref, baseDir) {
  const decoded = decodeURIComponent(ref);
  if (/^data:/i.test(decoded)) {
    const match = decoded.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
    if (!match) throw new Error("Invalid data URL image.");
    const mime = match[1] || "application/octet-stream";
    const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    return { bytes, mime, filename: `inline-image.${ext}` };
  }
  if (/^https?:\/\//i.test(decoded)) {
    const res = await fetch(decoded);
    if (!res.ok) throw new Error(`Failed to download image ${decoded}: ${res.status} ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const filename = path.basename(new URL(decoded).pathname) || "remote-image.jpg";
    return {
      bytes: Buffer.from(arrayBuffer),
      mime: res.headers.get("content-type") || mimeFromName(filename, "image/jpeg"),
      filename
    };
  }
  const localPath = path.isAbsolute(decoded) ? decoded : path.resolve(baseDir, decoded);
  const bytes = await fs.readFile(localPath);
  return { bytes, mime: mimeFromName(localPath), filename: path.basename(localPath) };
}

function md5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

async function uploadImageMaterial(ref, baseDir, accessToken, appId, cache, verbose) {
  const { bytes, mime, filename } = await imageBytesFromReference(ref, baseDir);
  if (!bytes.length) throw new Error(`Image is empty: ${ref}`);
  const key = `${md5(bytes)}:${appId}`;
  if (cache[key]?.media_id && cache[key]?.url) {
    if (verbose) console.error(`[cache] ${filename} -> ${cache[key].url}`);
    return cache[key];
  }
  const form = new FormData();
  form.append("media", new Blob([bytes], { type: mime }), filename);
  const url = `${UPLOAD_URL}?access_token=${encodeURIComponent(accessToken)}&type=image`;
  const data = await wechatJson(await fetch(url, { method: "POST", body: form }));
  if (data.url?.startsWith("http://")) data.url = data.url.replace(/^http:\/\//i, "https://");
  cache[key] = { media_id: data.media_id, url: data.url, updated_at: Date.now() };
  if (verbose) console.error(`[upload] ${filename} -> ${data.url}`);
  return cache[key];
}

async function replaceAsync(input, regex, replacer) {
  const matches = [...input.matchAll(regex)];
  if (!matches.length) return input;
  const replacements = await Promise.all(matches.map((match) => replacer(match)));
  let output = "";
  let last = 0;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    output += input.slice(last, match.index) + replacements[i];
    last = match.index + match[0].length;
  }
  return output + input.slice(last);
}

async function uploadBodyImages(content, context) {
  const { baseDir, accessToken, appId, cache, verbose } = context;
  const uploaded = [];
  async function replaceAttr(match) {
    const [, prefix, ref, suffix] = match;
    if (!isUploadableReference(ref)) return match[0];
    const data = await uploadImageMaterial(ref, baseDir, accessToken, appId, cache, verbose);
    uploaded.push(data);
    return `${prefix}${data.url}${suffix}`;
  }
  let next = await replaceAsync(content, /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, replaceAttr);
  next = await replaceAsync(next, /(<image\b[^>]*?\b(?:href|xlink:href)\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, replaceAttr);
  return { content: next, uploaded };
}

function pruneUndefined(object) {
  for (const key of Object.keys(object)) {
    if (object[key] === "" || object[key] === undefined || object[key] === null) {
      delete object[key];
    }
  }
  return object;
}

async function publishDraft(accessToken, article) {
  const data = await wechatJson(await fetch(`${DRAFT_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articles: [article] })
  }));
  if (!data.media_id) {
    throw new Error(`Draft creation did not return media_id: ${JSON.stringify(data)}`);
  }
  return data;
}

async function updateDraft(accessToken, mediaId, index, article) {
  const data = await wechatJson(await fetch(`${DRAFT_UPDATE_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_id: mediaId,
      index,
      articles: article
    })
  }));
  return data;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  await loadEnvFile(opts.envFile);
  const built = await buildContent(opts);

  if (opts.out) {
    await fs.mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
    await fs.writeFile(opts.out, built.content, "utf8");
  }

  if (opts.dryRun) {
    const hasBodyImage = /<(img|image)\b/i.test(built.content);
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      file: built.inputPath,
      title: built.metadata.title,
      cover: built.metadata.cover || null,
      bodyHasImageReference: hasBodyImage,
      coverRequiredForRealPublish: !built.metadata.cover && !hasBodyImage,
      contentLength: built.content.length,
      output: opts.out ? path.resolve(opts.out) : null,
      updateMediaId: opts.updateMediaId || null,
      index: opts.index
    }, null, 2));
    return;
  }

  const credentials = await resolveCredentials(opts);
  const accessToken = await getAccessToken(opts, credentials.appId, credentials.appSecret);
  const cachePath = path.join(getConfigDir(), "upload-cache.json");
  const cache = await readJson(cachePath, {});

  const uploadedBody = await uploadBodyImages(built.content, {
    baseDir: built.baseDir,
    accessToken,
    appId: credentials.appId,
    cache,
    verbose: opts.verbose
  });

  let thumbMediaId = "";
  if (built.metadata.cover) {
    const cover = await uploadImageMaterial(built.metadata.cover, built.baseDir, accessToken, credentials.appId, cache, opts.verbose);
    thumbMediaId = cover.media_id;
  } else if (uploadedBody.uploaded[0]?.media_id) {
    thumbMediaId = uploadedBody.uploaded[0].media_id;
  }
  await writeJson(cachePath, cache);

  if (!thumbMediaId) {
    throw new Error("A cover image is required for SVG-only content. Pass --cover with a WeChat-compatible image.");
  }

  const article = pruneUndefined({
    title: built.metadata.title,
    thumb_media_id: thumbMediaId,
    author: built.metadata.author,
    digest: built.metadata.digest,
    content: uploadedBody.content,
    content_source_url: built.metadata.sourceUrl,
    need_open_comment: built.metadata.needOpenComment ? 1 : 0,
    only_fans_can_comment: built.metadata.onlyFansCanComment ? 1 : 0
  });

  const data = opts.updateMediaId
    ? await updateDraft(accessToken, opts.updateMediaId, opts.index, article)
    : await publishDraft(accessToken, article);
  console.log(JSON.stringify({
    ok: true,
    media_id: opts.updateMediaId || data.media_id,
    updated: Boolean(opts.updateMediaId),
    title: built.metadata.title,
    contentLength: uploadedBody.content.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
