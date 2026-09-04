/* 江苏兆辉防腐科技 · 报价单工作台本地服务 */
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const url = require("url");
const { execFileSync } = require("child_process");

const {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require("docx");
const sizeOf = require("image-size");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const ASSET_DIR = path.join(ROOT, "素材");
const OUT_DIR = path.join(ROOT, "out");
const PORT = Number(process.env.PORT || 4731);

const ASSET_GROUPS = [
  { key: "companyGate", dir: "厂门厂区", label: "厂门 / 厂区", fallbackDir: "厂门厂区" },
  { key: "products", dir: "产品照片", label: "产品实拍", fallbackDir: "产品照片" },
  { key: "workshop", dir: "车间设备", label: "车间与制造能力", fallbackDir: "车间设备" },
  { key: "certs", dir: "资质证书", label: "资质证书", fallbackDir: "资质证书" },
  { key: "logo", dir: "公司Logo", label: "公司 Logo", fallbackDir: "公司Logo" },
];

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

for (const dir of [DATA_DIR, OUT_DIR, ASSET_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
for (const group of ASSET_GROUPS) {
  fs.mkdirSync(path.join(ASSET_DIR, group.dir), { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function safeName(name) {
  const base = String(name || "photo.jpg").replace(/[\\/:*?"<>|]/g, "_").trim();
  return base || "photo.jpg";
}

function relativeUrl(filePath) {
  return "/" + path.relative(ROOT, filePath).split(path.sep).join("/");
}

function assetCacheFile() {
  return path.join(DATA_DIR, "assets.json");
}

function readAssetCache() {
  const value = readJson(assetCacheFile(), {});
  return { files: value.files || {}, version: value.version || 1 };
}

function writeAssetCache(cache) {
  writeJson(assetCacheFile(), { version: 1, files: cache.files || {} });
}

function scanAssets() {
  const cache = readAssetCache();
  const files = [];
  for (const group of ASSET_GROUPS) {
    const dir = path.join(ASSET_DIR, group.dir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const ext = path.extname(name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      const filePath = path.join(dir, name);
      if (!fs.statSync(filePath).isFile()) continue;
      const relUrl = relativeUrl(filePath);
      const meta = cache.files[relUrl] || {};
      const stat = fs.statSync(filePath);
      files.push({
        id: relUrl,
        url: relUrl,
        group: group.key,
        groupLabel: group.label,
        name,
        ext: ext.replace(".", ""),
        caption: meta.caption || "",
        size: stat.size,
        addedAt: meta.addedAt || stat.birthtime.toISOString(),
      });
    }
  }
  files.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  return files;
}

function loadCompany() {
  const value = readJson(path.join(DATA_DIR, "company.json"), null);
  if (value && typeof value === "object") return value;
  return {
    name: "江苏兆辉防腐科技有限公司",
    shortName: "江苏兆辉",
    slogan: "钢衬四氟 / PE / PO 防腐设备专业制造商",
    address: "",
    phone: "",
    email: "",
    website: "",
    unifiedCode: "",
    bank: "",
    accountNo: "",
    salesName: "",
    salesPhone: "",
    quoteNoPrefix: "ZXBJ",
  };
}

function loadCurrent() {
  const value = readJson(path.join(DATA_DIR, "current.json"), null);
  if (value && typeof value === "object") return value;
  return null;
}

function loadQuotes() {
  const value = readJson(path.join(DATA_DIR, "quotes.json"), { quotes: [] });
  return Array.isArray(value.quotes) ? value.quotes : [];
}

function storeQuotes(quotes) {
  writeJson(path.join(DATA_DIR, "quotes.json"), { quotes });
}

function parseBody(req, limitBytes) {
  const max = limitBytes || 120 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error("上传内容过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(new Error("JSON 解析失败"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: String(message || "请求失败") });
}

function sendFile(res, filePath, fallback) {
  const safeRoot = path.resolve(fallback || ROOT);
  const full = path.resolve(filePath);
  if (!full.startsWith(safeRoot + path.sep) && full !== safeRoot) {
    sendError(res, 403, "禁止访问");
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      sendError(res, 404, "文件不存在");
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": [".html", ".js", ".css"].includes(ext) ? "no-cache" : "max-age=3600",
      "Content-Length": data.length,
    });
    res.end(data);
  });
}

function htmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function totalOf(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  return items.reduce((sum, item) => {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || 0);
    const amount = Number(item.amount != null && item.amount !== "" ? item.amount : qty * price);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

function localDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function newId(prefix) {
  return (prefix || "q") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 30));
  return localDateString(d);
}

function normalizeQuoteData(data) {
  const now = localDateString(new Date());
  const src = data && typeof data === "object" ? data : {};
  const companyPrefix = String((loadCompany().quoteNoPrefix || "ZXBJ")).trim();
  const autoQuoteNo = src.quoteNo
    ? src.quoteNo
    : companyPrefix + "-" + now.replace(/-/g, "") + "-001";
  const quote = {
    id: src.id || newId("q"),
    title: src.title || "产品报价单",
    updatedAt: new Date().toISOString(),
    createdAt: src.createdAt || new Date().toISOString(),
    quoteNo: autoQuoteNo,
    date: src.date || now,
    validUntil: src.validUntil || addDays(30),
    projectName: src.projectName || "",
    recipientUnit: src.recipientUnit || "",
    recipientContact: src.recipientContact || "",
    recipientPhone: src.recipientPhone || "",
    recipientEmail: src.recipientEmail || "",
    recipientAddress: src.recipientAddress || "",
    subject: src.subject || "",
    paymentTerms: src.paymentTerms || "",
    deliveryDays: src.deliveryDays || "",
    qualityPeriod: src.qualityPeriod || "",
    footer: src.footer || "",
    notes: Array.isArray(src.notes) ? src.notes.filter(Boolean) : [],
    theme: src.theme || "blue",
    showCerts: src.showCerts !== false,
    showPhotos: src.showPhotos !== false,
    selectedAssetIds: Array.isArray(src.selectedAssetIds) ? src.selectedAssetIds : [],
  };
  quote.items = Array.isArray(src.items) && src.items.length ? src.items : [
    {
      id: newId("i"),
      no: "",
      name: "",
      material: "",
      spec: "",
      qty: "",
      unit: "台",
      price: "",
      amount: "",
      note: "",
    },
  ];
  quote.certs = Array.isArray(src.certs) ? src.certs : [];
  quote.companyName = src.companyName || "";
  quote.companySlogan = src.companySlogan || "";
  quote.companyPhone = src.companyPhone || "";
  quote.companyEmail = src.companyEmail || "";
  quote.companyAddress = src.companyAddress || "";
  quote.companyWebsite = src.companyWebsite || "";
  quote.companyUnifiedCode = src.companyUnifiedCode || "";
  quote.companyLegal = src.companyLegal || "";
  quote.profile = src.profile || {};
  return quote;
}

function bootstrapPayload() {
  const company = loadCompany();
  const current = normalizeQuoteData(loadCurrent());
  const quotes = loadQuotes().map((item) => ({
    id: item.id,
    title: item.title || "产品报价单",
    quoteNo: item.quoteNo || "",
    recipientUnit: item.recipientUnit || "",
    projectName: item.projectName || "",
    total: totalOf(item),
    updatedAt: item.updatedAt || item.createdAt || "",
    data: item,
  }));
  return {
    company,
    current,
    quotes,
    assets: scanAssets(),
  };
}

/* ---------------- docx helpers ---------------- */

const FONT = "微软雅黑";
const CONTENT_WIDTH = 9906; // A4 宽 11906 - 左右边距 1000*2
const PAGE_MARGIN = 1000;

function run(text, options) {
  const opts = options || {};
  return new TextRun({
    text: String(text == null ? "" : text),
    font: opts.font || FONT,
    size: opts.size || 21,
    bold: Boolean(opts.bold),
    italics: Boolean(opts.italics),
    color: opts.color || "1F2937",
  });
}

function para(text, options) {
  const opts = options || {};
  const children = Array.isArray(text)
    ? text
    : text && typeof text.prepForXml === "function"
      ? [text]
      : [run(text, opts)];
  return new Paragraph({
    children,
    alignment: opts.align || AlignmentType.LEFT,
    spacing: {
      before: opts.before == null ? 0 : opts.before,
      after: opts.after == null ? 60 : opts.after,
      line: opts.line || 300,
      lineRule: opts.lineRule || "auto",
    },
    indent: opts.indent,
    pageBreakBefore: Boolean(opts.pageBreakBefore),
    border: opts.border,
    shading: opts.shading || opts.paragraphShading,
  });
}

function cell(children, options) {
  const opts = options || {};
  const items = Array.isArray(children) ? children : [children];
  const content = items.map((child) => {
    if (child instanceof Paragraph) return child;
    if (child && typeof child.prepForXml === "function") {
      return para([child], {
        align: opts.align,
        line: 280,
        after: 0,
      });
    }
    return para(child, {
      align: opts.align,
      line: 280,
      after: 0,
    });
  });
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
    verticalAlign: opts.vertical || VerticalAlign.CENTER,
    margins: {
      top: opts.padTop == null ? 90 : opts.padTop,
      bottom: opts.padBottom == null ? 90 : opts.padBottom,
      left: opts.padLeft == null ? 120 : opts.padLeft,
      right: opts.padRight == null ? 120 : opts.padRight,
    },
    borders: opts.borders,
    columnSpan: opts.span,
    children: content.length ? content : [para("", { after: 0 })],
  });
}

const NO_BORDERS = {
  top: { style: BorderStyle.NIL },
  bottom: { style: BorderStyle.NIL },
  left: { style: BorderStyle.NIL },
  right: { style: BorderStyle.NIL },
};

const THIN_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "D6E2EB" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "D6E2EB" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "D6E2EB" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "D6E2EB" },
};

function themeColors(theme) {
  const themes = {
    blue: {
      accent: "0B5E8C",
      accentDark: "073E5C",
      soft: "E5F1F7",
      pale: "F4F9FC",
      gold: "A9762B",
    },
    teal: {
      accent: "0E7468",
      accentDark: "084F47",
      soft: "E3F3F0",
      pale: "F2FAF8",
      gold: "A58A28",
    },
    graphite: {
      accent: "3F5A70",
      accentDark: "263B4C",
      soft: "E8EEF2",
      pale: "F4F7F9",
      gold: "8A6B3B",
    },
  };
  return themes[theme] || themes.blue;
}

function imageInfo(buffer, targetWidth, targetHeight) {
  try {
    const dims = sizeOf(buffer);
    const maxHeight = targetHeight || Math.round(targetWidth * 0.75);
    const scale = Math.min(
      targetWidth / Math.max(dims.width, 1),
      maxHeight / Math.max(dims.height, 1),
      1
    );
    return {
      width: Math.max(1, Math.round(dims.width * scale)),
      height: Math.max(1, Math.round(dims.height * scale)),
    };
  } catch (err) {
    return { width: targetWidth, height: targetHeight || Math.round(targetWidth * 0.75) };
  }
}

function assetToLocalPath(assetUrl) {
  if (!assetUrl || typeof assetUrl !== "string") return "";
  const clean = decodeURIComponent(assetUrl.split("?")[0]);
  const filePath = path.join(ROOT, clean.replace(/^\/+/, ""));
  return filePath.startsWith(ROOT + path.sep) ? filePath : "";
}

function imageRunFor(assetUrl, targetWidth, targetHeight) {
  const filePath = assetToLocalPath(assetUrl);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const type = ext === "png" ? "png" : ext === "gif" ? "gif" : ext === "bmp" ? "bmp" : "jpg";
  const size = imageInfo(buffer, targetWidth, targetHeight);
  return new ImageRun({
    type,
    data: buffer,
    transformation: { width: size.width, height: size.height },
  });
}

function headingBlock(text, colors, opts) {
  const options = opts || {};
  return para([
    run(text, {
      bold: true,
      size: options.size || 27,
      color: options.color || colors.accentDark,
    }),
  ], {
    spacing: { before: options.before == null ? 240 : options.before, after: 110, line: 300 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 8, color: colors.accent, space: 2 },
    },
    ...options.extra,
  });
}

function itemTableRows(data, colors, widths) {
  const heads = ["序号", "名称 / 型号", "材质", "规格 / 尺寸", "数量", "单位", "单价（元）", "总价（元）", "备注"];
  const headCells = heads.map((text, index) =>
    cell(run(text, { bold: true, size: 19, color: "FFFFFF" }), {
      width: widths[index],
      fill: colors.accent,
      align: index === 0 ? AlignmentType.CENTER : index < 5 ? AlignmentType.CENTER : AlignmentType.RIGHT,
    })
  );
  const rows = [new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headCells,
  })];
  const items = data.items || [];
  items.forEach((item, index) => {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || 0);
    let amount = Number(item.amount !== "" && item.amount != null ? item.amount : qty * price);
    if (!Number.isFinite(amount)) amount = 0;
    const values = [
      item.no || String(index + 1),
      item.name,
      item.material,
      item.spec,
      qty ? String(qty) : "",
      item.unit,
      price ? money(price) : "",
      amount ? money(amount) : "",
      item.note,
    ];
    const isOdd = index % 2 === 1;
    rows.push(new TableRow({
      cantSplit: false,
      children: values.map((text, cellIndex) =>
        cell(run(text, {
          size: 19,
          color: "374151",
          bold: cellIndex === 7,
        }), {
          width: widths[cellIndex],
          fill: isOdd ? colors.pale : "FFFFFF",
          align: cellIndex === 0 ? AlignmentType.CENTER : cellIndex < 5 ? AlignmentType.CENTER : AlignmentType.RIGHT,
          borders: THIN_BORDERS,
        })
      ),
    }));
  });
  return rows;
}

function certTableRows(data, colors) {
  const widthBase = 2200;
  const widths = [widthBase * 0.9, widthBase * 1.35, widthBase * 1.35, widthBase * 0.9];
  const rows = [new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: ["类别", "证书 / 认证名称", "证书编号 / 报告编号", "有效期 / 说明"].map((text, index) =>
      cell(run(text, { bold: true, size: 19, color: "FFFFFF" }), {
        width: widths[index],
        fill: colors.gold,
        align: AlignmentType.CENTER,
      })
    ),
  })];
  (data.certs || []).forEach((cert, index) => {
    const isOdd = index % 2 === 1;
    rows.push(new TableRow({
      cantSplit: true,
      children: [cert.category, cert.name, cert.no, cert.validity].map((text, cellIndex) =>
        cell(run(text || "", { size: 19, color: "374151" }), {
          width: widths[cellIndex],
          fill: isOdd ? "#FDF6E9" : "FFFFFF",
          align: cellIndex === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
          borders: THIN_BORDERS,
        })
      ),
    }));
  });
  return rows;
}

function fieldLabel(value, label) {
  if (!value) return "";
  return para([
    run(label, { bold: true, size: 20, color: "6B7280" }),
    run("：" + String(value), { size: 21, color: "111827" }),
  ], { spacing: { after: 80, line: 300 }, border: NO_BORDERS });
}

function infoTable(data, colors, assets) {
  const colA = 1700;
  const colB = CONTENT_WIDTH - colA;
  const logoAsset = assets.find((a) => a.group === "logo" && (data.selectedAssetIds || []).includes(a.id));
  const logoRun = logoAsset ? imageRunFor(logoAsset.url, 150) : null;

  const companyCell = [
    para([
      run(data.companyName || "", {
        bold: true,
        size: 42,
        color: colors.accentDark,
      }),
    ], { spacing: { after: 20, line: 340 } }),
    para(run(data.companySlogan || "", { size: 19, color: colors.accent }), {
      spacing: { after: 100, line: 280 },
    }),
  ];
  if (logoRun) {
    companyCell.unshift(para([logoRun], { spacing: { after: 60, line: 300 } }));
  }

  const contactLines = [
    [data.companyPhone && "电 话：" + data.companyPhone, data.companyEmail && "邮 箱：" + data.companyEmail],
    [data.companyAddress && "地 址：" + data.companyAddress, data.companyWebsite && "网 址：" + data.companyWebsite],
  ].filter((row) => row.length);
  const contactParagraphs = contactLines.flatMap((line) => {
    const pairs = line.filter(Boolean);
    return pairs.map((text, index) =>
      para(run(text, { size: 18, color: "4B5563" }), {
        align: AlignmentType.RIGHT,
        spacing: { before: index === 0 ? 0 : 10, after: 10, line: 280 },
      })
    );
  });

  const lineA = data.recipientUnit ? "收件单位：" + data.recipientUnit : "";
  const lineB = [
    data.recipientContact && "联系人：" + data.recipientContact,
    data.recipientPhone && "电话 / 微信：" + data.recipientPhone,
    data.recipientEmail && "邮箱：" + data.recipientEmail,
  ].filter(Boolean).join("    ");
  const lineC = data.recipientAddress ? "单位地址：" + data.recipientAddress : "";
  const lineD = data.projectName ? "项目名称：" + data.projectName : "";

  const infoRows = [
    [lineA, lineD],
    [lineB, ""],
    [lineC, ""],
  ].map((pair) => {
    const left = pair[0] || "";
    const right = pair[1] || "";
    if (!left && !right) return null;
    const widthPair = [CONTENT_WIDTH * 0.56, CONTENT_WIDTH * 0.44];
    return new TableRow({
      cantSplit: true,
      children: [
        cell(left ? para(run(left, { size: 20, color: "1F2937" }), { spacing: { after: 0, line: 290 } }) : para(""), {
          width: widthPair[0],
          borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D8DDE2" }, top: { style: BorderStyle.NIL }, left: { style: BorderStyle.NIL }, right: { style: BorderStyle.NIL } },
          padTop: 70,
          padBottom: 70,
        }),
        cell(right ? para(run(right, { size: 20, color: "1F2937" }), { spacing: { after: 0, line: 290 } }) : para(""), {
          width: widthPair[1],
          borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D8DDE2" }, top: { style: BorderStyle.NIL }, left: { style: BorderStyle.NIL }, right: { style: BorderStyle.NIL } },
          padTop: 70,
          padBottom: 70,
        }),
      ],
    });
  }).filter(Boolean);

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [colA, colB],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          cell(companyCell, { width: colA, vertical: VerticalAlign.BOTTOM, borders: NO_BORDERS }),
          cell(contactParagraphs.length ? contactParagraphs : para(""), {
            width: colB,
            vertical: VerticalAlign.BOTTOM,
            borders: NO_BORDERS,
            align: AlignmentType.RIGHT,
          }),
        ],
      }),
    ].concat(infoRows || []),
  });
}

function notesBlock(data, colors) {
  const children = [];
  const notes = Array.isArray(data.notes) ? data.notes.filter(Boolean) : [];
  const termRows = [
    [data.paymentTerms && "付款方式", data.paymentTerms],
    [data.deliveryDays && "交货周期", data.deliveryDays],
    [data.qualityPeriod && "质保期限", data.qualityPeriod],
    [data.validUntil && "报价有效期", data.validUntil],
  ].filter((row) => row[1]);
  if (notes.length) {
    children.push(headingBlock("报价说明与备注", colors, { size: 25 }));
    notes.forEach((line) => {
      children.push(para([
        run("◆ ", { size: 19, color: colors.accent }),
        run(String(line), { size: 20, color: "374151" }),
      ], { spacing: { after: 50, line: 300 } }));
    });
  }
  if (termRows.length) {
    children.push(headingBlock("商务条款", colors, { size: 25 }));
    const half = CONTENT_WIDTH / 2;
    const termCell = (pair, width) =>
      cell(
        para([
          run(String(pair[0]) + "：", {
            bold: true,
            size: 19,
            color: colors.accentDark,
          }),
          run(String(pair[1]), { size: 19, color: "374151" }),
        ], { spacing: { after: 0, line: 290 } }),
        {
          width,
          fill: colors.pale,
          borders: THIN_BORDERS,
          padTop: 90,
          padBottom: 90,
        }
      );
    const rows = [];
    for (let i = 0; i < termRows.length; i += 2) {
      rows.push(new TableRow({
        cantSplit: true,
        children: [
          termCell(termRows[i], half),
          termRows[i + 1]
            ? termCell(termRows[i + 1], half)
            : cell(para("", { spacing: { after: 0 } }), {
                width: half,
                borders: THIN_BORDERS,
              }),
        ],
      }));
    }
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: [half, half],
      rows,
    });
    children.push(table);
  }
  return children;
}

function certBlock(data, colors) {
  const certs = (data.certs || []).filter((cert) => cert && (cert.name || cert.no));
  if (!data.showCerts || !certs.length) return [];
  return [
    headingBlock("资质与认证", colors, { size: 25, before: 260 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: [1981, 2972, 2972, 1981],
      rows: certTableRows(data, colors),
    }),
  ];
}

function photoBlocks(data, assets, colors) {
  if (!data.showPhotos) return [];
  const selected = (data.selectedAssetIds || [])
    .map((id) => assets.find((a) => a.id === id))
    .filter(Boolean);
  if (!selected.length) return [];
  const photos = ASSET_GROUPS.filter((group) => group.key !== "logo" && group.key !== "companyGate")
    .flatMap((group) =>
      selected
        .filter((asset) => asset.group === group.key)
        .map((asset) => ({ group, asset }))
    );
  if (!photos.length) return [];
  const blocks = [];
  blocks.push(new Paragraph({ children: [new PageBreak()] }));
  photos.forEach(({ group, asset }, index) => {
    if (index > 0) blocks.push(new Paragraph({ children: [new PageBreak()] }));
    blocks.push(para([
      run(data.photoHeading || "产品实拍与制造能力", {
        bold: true,
        size: 30,
        color: colors.accentDark,
      }),
    ], {
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 40, line: 320 },
    }));
    blocks.push(para(run(group.label, { size: 18, color: colors.accent }), {
      alignment: AlignmentType.CENTER,
      spacing: { after: 120, line: 300 },
    }));
    const imageRun = imageRunFor(asset.url, 620, 820);
    if (imageRun) {
      blocks.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        columnWidths: [CONTENT_WIDTH],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              cell([para([imageRun], {
                alignment: AlignmentType.CENTER,
                spacing: { after: 0, line: 280 },
              })], {
                width: CONTENT_WIDTH,
                borders: THIN_BORDERS,
                padTop: 40,
                padBottom: 40,
              }),
            ],
          }),
        ],
      }));
      blocks.push(para([
        run(asset.caption || asset.name, { size: 18, color: "6B7280" }),
      ], {
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 40, line: 300 },
      }));
    }
  });
  return blocks;
}

function profileBasics(data) {
  const profile = data.profile || {};
  const basic = profile.basic || {};
  return [
    ["公司名称", data.companyName],
    ["统一社会信用代码", data.companyUnifiedCode || ""],
    ["成立时间", basic.established],
    ["注册资本", basic.registeredCapital],
    ["法定代表人", basic.legal],
    ["员工人数", basic.employees],
    ["厂房面积", basic.plantArea],
    ["公司地址", data.companyAddress],
    ["联系电话", data.companyPhone],
    ["经营范围 / 主营业务", basic.businessScope],
  ].filter((row) => String(row[1] || "").trim());
}

function docxProfileHeading(title, subtitle, colors) {
  return [
    para([
      run("江苏兆辉防腐科技有限公司", { size: 18, color: colors.gold }),
    ], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 20, line: 300 },
    }),
    headingBlock(title, colors, { size: 30, before: 20 }),
    para(run(subtitle || "", { size: 18, color: "6B7280" }), {
      alignment: AlignmentType.CENTER,
      spacing: { after: 100, line: 300 },
    }),
  ];
}

function docxProfileBlocks(data, colors, assets) {
  const blocks = [];
  const profile = data.profile || {};
  const basic = profile.basic || {};
  const addPage = (title, subtitle) => {
    blocks.push(new Paragraph({ children: [new PageBreak()] }));
    blocks.push(...docxProfileHeading(title, subtitle, colors));
  };

  if (profile.overviewEnabled && String(profile.overview || "").trim()) {
    addPage("企业概况", "公司简介与核心业务");
    String(profile.overview)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        blocks.push(para([
          run(String(line), { size: 21, color: "3D4D63" }),
        ], {
          spacing: { after: 80, line: 380 },
          indent: { firstLine: 480 },
        }));
      });
  }

  const basics = profileBasics(data);
  if (profile.basicEnabled && basics.length) {
    addPage("公司基本情况表", "工商登记与生产经营概况");
    const half = CONTENT_WIDTH / 2;
    const rows = [];
    for (let i = 0; i < basics.length; i += 2) {
      const row = [
        basics[i],
        basics[i + 1] || ["", ""],
      ].map((pair) =>
        cell([
          para([
            run(String(pair[0]) + "：", { bold: true, size: 19, color: colors.accentDark }),
            run(String(pair[1]), { size: 19, color: "374151" }),
          ], { spacing: { after: 0, line: 290 } }),
        ], {
          width: half,
          fill: colors.pale,
          borders: THIN_BORDERS,
          padTop: 80,
          padBottom: 80,
        })
      );
      rows.push(new TableRow({ cantSplit: true, children: row }));
    }
    blocks.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: [half, half],
      rows,
    }));
  }

  const equipment = Array.isArray(profile.equipment) ? profile.equipment.filter((row) => row && (row.name || row.spec || row.purpose)) : [];
  if (profile.equipmentEnabled && equipment.length) {
    addPage("公司主要设备情况表", "生产制造与检测能力");
    const widths = [780, 2742, 1850, 900, 3634].map((w) => Math.round((w / 9906) * CONTENT_WIDTH));
    const head = ["序号", "设备名称", "型号 / 规格", "数量", "主要用途 / 能力"];
    const rows = [
      new TableRow({
        tableHeader: true,
        children: head.map((text, i) =>
          cell(run(text, { bold: true, size: 18, color: "FFFFFF" }), {
            width: widths[i], fill: colors.accent, align: AlignmentType.CENTER,
          })
        ),
      }),
    ];
    equipment.forEach((item, index) => {
      rows.push(new TableRow({
        children: [index + 1, item.name, item.spec, item.qty, item.purpose].map((value, i) =>
          cell(run(String(value || ""), { size: 18 }), {
            width: widths[i],
            align: i === 0 || i === 3 ? AlignmentType.CENTER : AlignmentType.LEFT,
            borders: THIN_BORDERS,
          })
        ),
      }));
    });
    blocks.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: widths,
      rows,
    }));
  }

  const certAssets = assets.filter((asset) =>
    asset.group === "certs" && (profile.certAssetIds || []).includes(asset.id)
  );
  if (profile.certEnabled && certAssets.length) {
    addPage("公司资质与证书", "资质证书与检测认证资料");
    const half = Math.round((CONTENT_WIDTH - 500) / 2);
    for (let i = 0; i < certAssets.length; i += 2) {
      const pair = [certAssets[i], certAssets[i + 1] || null];
      const rowCells = pair.map((asset) => {
        if (!asset) {
          return cell(para("", { spacing: { after: 0 } }), {
            width: half, borders: THIN_BORDERS,
          });
        }
        const img = imageRunFor(asset.url, 300, 620);
        return cell(img ? [para([img], { alignment: AlignmentType.CENTER, spacing: { after: 0, line: 280 } })] : [para("")], {
          width: half,
          borders: THIN_BORDERS,
          padTop: 80,
          padBottom: 80,
        });
      });
      blocks.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        columnWidths: [half, half],
        rows: [new TableRow({ cantSplit: true, children: rowCells })],
      }));
    }
  }

  const projects = Array.isArray(profile.projects) ? profile.projects.filter((row) => row && (row.client || row.project || row.products)) : [];
  if (profile.projectsEnabled && projects.length) {
    addPage("工程业绩展示", "近年防腐设备供货与工程业绩");
    const head = ["年份", "客户单位", "项目名称", "供货产品", "备注"];
    const widths = [1100, 2700, 2500, 2106, 1500].map((w) => Math.round((w / 9906) * CONTENT_WIDTH));
    const rows = [
      new TableRow({
        tableHeader: true,
        children: head.map((text, i) =>
          cell(run(text, { bold: true, size: 18, color: "FFFFFF" }), {
            width: widths[i], fill: colors.accent, align: AlignmentType.CENTER,
          })
        ),
      }),
    ];
    projects.forEach((item, index) => {
      const values = [item.year || index + 1, item.client, item.project, item.products, item.note];
      rows.push(new TableRow({
        children: values.map((value, i) =>
          cell(run(String(value || ""), { size: 18 }), {
            width: widths[i],
            align: i === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
            borders: THIN_BORDERS,
          })
        ),
      }));
    });
    blocks.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: widths,
      rows,
    }));
  }
  return blocks;
}

function docxCoverBlocks(data, colors, assets) {
  const profile = data.profile || {};
  if (!profile.coverEnabled) return [];
  const coverAsset = assets.find((asset) => asset.id === profile.coverAssetId);
  if (!coverAsset) return [];
  const image = imageRunFor(coverAsset.url, 620, 760);
  const blocks = [];
  blocks.push(para([
    run("江苏兆辉防腐科技有限公司", { size: 20, color: colors.gold }),
  ], {
    alignment: AlignmentType.CENTER,
    spacing: { before: 220, after: 40, line: 320 },
  }));
  blocks.push(para([
    run((data.recipientUnit || "贵公司") + "报价及技术说明", {
      bold: true,
      size: 46,
      color: colors.accentDark,
    }),
  ], {
    alignment: AlignmentType.CENTER,
    spacing: { after: 60, line: 380 },
  }));
  if (image) {
    blocks.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: [CONTENT_WIDTH],
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            cell([para([image], {
              alignment: AlignmentType.CENTER,
              spacing: { after: 0, line: 280 },
            })], {
              width: CONTENT_WIDTH,
              borders: THIN_BORDERS,
              padTop: 120,
              padBottom: 120,
            }),
          ],
        }),
      ],
    }));
  }
  blocks.push(para([
    run(data.companyName || "江苏兆辉防腐科技有限公司", { bold: true, size: 26, color: colors.accentDark }),
  ], {
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 30, line: 340 },
  }));
  blocks.push(para([
    run("报价日期：" + (data.date || ""), { size: 20, color: "6B7280" }),
  ], {
    alignment: AlignmentType.CENTER,
    spacing: { after: 60, line: 320 },
  }));
  return blocks;
}

async function buildDocxBuffer(data, assets) {
  const colors = themeColors(data.theme);
  const items = Array.isArray(data.items) ? data.items : [];
  const itemWidths = [610, 2380, 850, 1680, 650, 520, 1050, 1250, 916];
  const sumWidth = itemWidths.reduce((a, b) => a + b, 0);
  const scale = CONTENT_WIDTH / sumWidth;
  const widths = itemWidths.map((w) => Math.round(w * scale));
  const total = totalOf(data);

  const titleChildren = [
    para([
      run("PRODUCT QUOTATION", {
        size: 18,
        color: colors.gold,
      }),
    ], {
      alignment: AlignmentType.CENTER,
      spacing: { before: 180, after: 20, line: 300 },
    }),
    para([
      run(data.title || "产品报价单", {
        bold: true,
        size: 52,
        color: colors.accentDark,
      }),
    ], {
      alignment: AlignmentType.CENTER,
      spacing: { before: 20, after: 60, line: 400 },
      shading: { type: ShadingType.CLEAR, fill: colors.soft },
    }),
    para(run(data.subject || "", { size: 22, color: colors.accent }), {
      alignment: AlignmentType.CENTER,
      spacing: { after: 130, line: 320 },
    }),
    para([
      run("报价单号：" + (data.quoteNo || "—"), { size: 19, color: "6B7280" }),
      run("     报价日期：" + (data.date || ""), { size: 19, color: "6B7280" }),
      run("     有效期至：" + (data.validUntil || ""), { size: 19, color: "6B7280" }),
    ], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 140, line: 320 },
    }),
  ];

  const itemHeading = headingBlock("产品报价明细", colors, { size: 26, before: 120 });
  const itemTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    rows: itemTableRows(data, colors, widths),
  });

  const totalLine = para([
    run("报价合计（人民币）：", { bold: true, size: 22, color: colors.accentDark }),
    run("¥ " + money(total), { bold: true, size: 30, color: colors.accentDark }),
  ], {
    alignment: AlignmentType.RIGHT,
    spacing: { before: 220, after: 100, line: 360 },
  });

  const children = [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: [CONTENT_WIDTH],
      rows: [
        new TableRow({
          children: [
            cell([], {
              width: CONTENT_WIDTH,
              fill: colors.accent,
              padTop: 90,
              padBottom: 90,
              span: 1,
            }),
          ],
        }),
      ],
    }),
    infoTable(data, colors, assets),
    ...titleChildren,
    itemHeading,
    itemTable,
    totalLine,
    ...notesBlock(data, colors),
    ...certBlock(data, colors),
    para([
      run(data.footer || "", { size: 19, color: "6B7280" }),
    ], {
      alignment: AlignmentType.CENTER,
      spacing: { before: 260, after: 60, line: 320 },
    }),
    para([
      run("江苏兆辉防腐科技有限公司", { bold: true, size: 19, color: colors.accentDark }),
    ], {
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 20, line: 300 },
    }),
  ];

  const photos = photoBlocks(data, assets, colors);
  const coverBlocks = docxCoverBlocks(data, colors, assets);
  const profileBlocks = docxProfileBlocks(data, colors, assets);
  const finalChildren = coverBlocks.length
    ? [...coverBlocks, new Paragraph({ children: [new PageBreak()] }), ...children]
    : [...children];
  if (photos.length) finalChildren.push(...photos);
  if (profileBlocks.length) finalChildren.push(...profileBlocks);

  const doc = new Document({
    creator: "江苏兆辉防腐科技",
    title: data.title || "产品报价单",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: PAGE_MARGIN,
              right: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN,
            },
          },
        },
        children: finalChildren,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

function convertToPdf(data, assets) {
  const bundledPython = "/Users/lijunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
  const python = process.env.ZHAOHUI_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : "python3");
  const script = path.join(ROOT, "pdf_export.py");
  try {
    return execFileSync(python, [script], {
      input: JSON.stringify({ data, assets }),
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      env: Object.assign({}, process.env, { ZHAOHUI_ROOT: ROOT }),
    });
  } catch (err) {
    const detail = String(err.stderr || err.message || "").slice(0, 500);
    throw new Error("PDF 生成失败：" + (detail || "未知错误"));
  }
}

function exportFileName(data, kind) {
  const q = data && data.quoteNo ? String(data.quoteNo).replace(/[\\/:*?"<>|]/g, "_") : "报价单";
  const client = data && data.recipientUnit ? String(data.recipientUnit).replace(/[\\/:*?"<>|]/g, "_").slice(0, 20) : "";
  const base = (q + (client ? "-" + client : "")).replace(/[\s]+/g, "-");
  return base + (kind === "pdf" ? ".pdf" : ".docx");
}

async function handleExport(req, res) {
  const body = await parseBody(req);
  const kind = body.kind === "pdf" ? "pdf" : "word";
  const data = normalizeQuoteData(body.data);
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const docxBuffer = await buildDocxBuffer(data, assets);
  const outBuffer = kind === "pdf" ? convertToPdf(data, assets) : docxBuffer;
  const name = exportFileName(data, kind);
  const encoded = encodeURIComponent(name);
  res.writeHead(200, {
    "Content-Type": kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": "attachment; filename*=UTF-8''" + encoded,
    "Cache-Control": "no-store",
    "Content-Length": outBuffer.length,
  });
  res.end(outBuffer);
}

function uploadAsset(groupKey, body) {
  const group = ASSET_GROUPS.find((g) => g.key === groupKey) || ASSET_GROUPS[0];
  const match = /^data:([^;]+);base64,(.*)$/s.exec(String(body.dataUrl || ""));
  if (!match) throw new Error("图片数据格式不正确");
  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  let ext = "";
  if (/png/i.test(mime)) ext = ".png";
  else if (/gif/i.test(mime)) ext = ".gif";
  else if (/webp/i.test(mime)) ext = ".webp";
  else if (/bmp/i.test(mime)) ext = ".bmp";
  else ext = ".jpg";
  const raw = safeName(body.name || "photo");
  const base = path.basename(raw, path.extname(raw)).slice(0, 80) || "photo";
  let fileName = base + ext;
  let counter = 1;
  let dest = path.join(ASSET_DIR, group.dir, fileName);
  while (fs.existsSync(dest)) {
    fileName = base + "-" + counter + ext;
    dest = path.join(ASSET_DIR, group.dir, fileName);
    counter += 1;
  }
  fs.writeFileSync(dest, buffer);
  const cache = readAssetCache();
  const relUrl = relativeUrl(dest);
  cache.files[relUrl] = {
    caption: String(body.caption || ""),
    addedAt: new Date().toISOString(),
  };
  writeAssetCache(cache);
  return scanAssets().find((a) => a.url === relUrl);
}

function deleteAsset(assetUrl) {
  const filePath = assetToLocalPath(assetUrl);
  if (!filePath || !filePath.startsWith(path.join(ASSET_DIR))) return false;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const cache = readAssetCache();
  delete cache.files[assetUrl];
  writeAssetCache(cache);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, "http://localhost:" + PORT);
    const pathname = decodeURIComponent(parsed.pathname);

    if (req.method === "GET" && pathname === "/api/bootstrap") {
      sendJson(res, 200, bootstrapPayload());
      return;
    }
    if (req.method === "POST" && pathname === "/api/save-current") {
      const body = await parseBody(req);
      const quote = normalizeQuoteData(body.data || {});
      writeJson(path.join(DATA_DIR, "current.json"), quote);
      sendJson(res, 200, { ok: true, id: quote.id, updatedAt: quote.updatedAt });
      return;
    }
    if (req.method === "POST" && pathname === "/api/save-quote") {
      const body = await parseBody(req);
      const quote = normalizeQuoteData(body.data || {});
      writeJson(path.join(DATA_DIR, "current.json"), quote);
      let quotes = loadQuotes();
      const existing = quotes.find((q) => q.id === quote.id);
      if (existing) {
        quotes = quotes.map((q) => (q.id === quote.id ? quote : q));
      } else {
        quotes.unshift(quote);
      }
      storeQuotes(quotes);
      sendJson(res, 200, {
        ok: true,
        quotes: quotes.map((q) => ({
          id: q.id,
          title: q.title,
          quoteNo: q.quoteNo,
          recipientUnit: q.recipientUnit,
          projectName: q.projectName,
          total: totalOf(q),
          updatedAt: q.updatedAt,
          data: q,
        })),
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/delete-quote") {
      const body = await parseBody(req);
      const quotes = loadQuotes().filter((q) => q.id !== body.id);
      storeQuotes(quotes);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && pathname === "/api/company") {
      const body = await parseBody(req);
      const company = Object.assign(loadCompany(), body.company || {});
      writeJson(path.join(DATA_DIR, "company.json"), company);
      sendJson(res, 200, { ok: true, company });
      return;
    }
    if (req.method === "POST" && pathname === "/api/asset-caption") {
      const body = await parseBody(req);
      const cache = readAssetCache();
      cache.files[body.url] = Object.assign(cache.files[body.url] || {}, {
        caption: String(body.caption || ""),
      });
      writeAssetCache(cache);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && pathname === "/api/upload") {
      const body = await parseBody(req, 160 * 1024 * 1024);
      const asset = uploadAsset(body.group || "products", body);
      sendJson(res, 200, { ok: true, asset });
      return;
    }
    if (req.method === "POST" && pathname === "/api/delete-asset") {
      const body = await parseBody(req);
      deleteAsset(body.url || "");
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && pathname === "/api/export") {
      await handleExport(req, res);
      return;
    }

    if (req.method === "GET") {
      if (pathname === "/" || pathname === "/index.html") {
        sendFile(res, path.join(ROOT, "index.html"));
        return;
      }
      const localPath = path.join(ROOT, decodeURIComponent(parsed.pathname).replace(/^\/+/, ""));
      if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        sendFile(res, localPath, ROOT);
        return;
      }
      sendError(res, 404, "页面不存在");
      return;
    }

    sendError(res, 405, "不支持的请求");
  } catch (err) {
    sendError(res, 500, err.message || "服务器错误");
  }
});

server.listen(PORT, () => {
  console.log("报价单工作台已启动：http://0.0.0.0:" + PORT);
});
