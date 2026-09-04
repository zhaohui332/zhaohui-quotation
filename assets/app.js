(function () {
  "use strict";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const ASSET_GROUPS = [
    { key: "companyGate", label: "厂门 / 厂区", hint: "用于报价封面的大幅厂区照片" },
    { key: "products", label: "产品实拍", hint: "储罐、塔器、反应釜等产品照片" },
    { key: "workshop", label: "车间与设备", hint: "制造车间、检测设备与吊装现场" },
    { key: "certs", label: "资质证书", hint: "证书扫描件、检测报告与资质证明" },
    { key: "logo", label: "公司 Logo", hint: "显示在报价单左上角" },
  ];

  const THEMES = {
    blue: { label: "工业蓝", accent: "#0b5e8c", dark: "#073e5c" },
    teal: { label: "防腐青", accent: "#0e7468", dark: "#084f47" },
    graphite: { label: "石墨灰", accent: "#3f5a70", dark: "#263b4c" },
  };

  const state = {
    company: {},
    quote: null,
    assets: [],
    quotes: [],
    dirty: false,
    saving: false,
    zoom: 100,
    changeGen: 0,
    view: "editor",
    autoSaveTimer: null,
    previewTimer: null,
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function attr(value) {
    return esc(value);
  }

  function encodeAsset(value) {
    return value ? encodeURI(value) : "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    return (prefix || "id") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function localDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function todayString() {
    return localDateString(new Date());
  }

  function dateFromOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return localDateString(d);
  }

  function compactDate(value) {
    return String(value || "").replace(/-/g, "");
  }

  function toNumber(value) {
    const n = Number(String(value == null ? "" : value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function money(value, decimals) {
    const n = toNumber(value);
    const digits = decimals == null ? 2 : decimals;
    return n.toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function amountOf(item) {
    if (item.amount !== "" && item.amount != null && item.amount !== undefined) {
      return toNumber(item.amount);
    }
    return toNumber(item.qty) * toNumber(item.price);
  }

  function totalOf(quote) {
    return (quote && Array.isArray(quote.items) ? quote.items : []).reduce((sum, item) => {
      const value = amountOf(item);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }

  function upperMoney(value) {
    const n = Math.round(toNumber(value) * 100) / 100;
    if (!n || !Number.isFinite(n)) return "";
    const intPart = Math.floor(Math.abs(n));
    const cents = Math.round((Math.abs(n) - intPart) * 100);
    const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    const smallUnits = ["", "拾", "佰", "仟"];
    const bigUnits = ["", "万", "亿", "兆"];

    function four(n4) {
      let out = "";
      let needZero = false;
      for (let i = 3; i >= 0; i -= 1) {
        const unit = Math.pow(10, i);
        const digit = Math.floor(n4 / unit) % 10;
        if (digit === 0) {
          if (out) needZero = true;
        } else {
          if (needZero) out += "零";
          out += digits[digit] + smallUnits[i];
          needZero = false;
        }
      }
      return out;
    }

    let groups = [];
    let temp = intPart;
    while (temp > 0) {
      groups.push(temp % 10000);
      temp = Math.floor(temp / 10000);
    }
    if (!groups.length) groups = [0];
    let result = "";
    let zeroGap = false;
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const group = groups[i];
      if (group > 0) {
        if (zeroGap && result) result += "零";
        result += four(group) + (bigUnits[i] || "");
        zeroGap = false;
      } else if (result) {
        zeroGap = true;
      }
    }
    result += "元";
    if (cents === 0) result += "整";
    else {
      if (cents >= 10) result += digits[Math.floor(cents / 10)] + "角";
      if (cents % 10 !== 0) {
        if (cents >= 10) result += digits[cents % 10] + "分";
        else result += "零" + digits[cents % 10] + "分";
      }
    }
    return result;
  }

  function defaultProfile() {
    return {
      coverEnabled: false,
      coverAssetId: "",
      coverTagline: "钢衬四氟 / PE / PO 防腐设备专业制造商",
      overviewEnabled: true,
      overview: "",
      basicEnabled: true,
      basic: {
        established: "",
        registeredCapital: "",
        legal: "",
        employees: "",
        plantArea: "",
        businessScope: "",
      },
      equipmentEnabled: true,
      equipment: [],
      certEnabled: true,
      certAssetIds: [],
      projectsEnabled: true,
      projects: [],
    };
  }

  function normalizeProfile(raw) {
    const base = defaultProfile();
    const src = raw && typeof raw === "object" ? raw : {};
    const basic = Object.assign({}, base.basic, src.basic || {});
    return {
      coverEnabled: src.coverEnabled !== false,
      coverAssetId: src.coverAssetId || "",
      coverTagline: src.coverTagline || "",
      overviewEnabled: src.overviewEnabled !== false,
      overview: src.overview || "",
      basicEnabled: src.basicEnabled !== false,
      basic,
      equipmentEnabled: src.equipmentEnabled !== false,
      equipment: Array.isArray(src.equipment) ? src.equipment : [],
      certEnabled: src.certEnabled !== false,
      certAssetIds: Array.isArray(src.certAssetIds) ? src.certAssetIds : [],
      projectsEnabled: src.projectsEnabled !== false,
      projects: Array.isArray(src.projects) ? src.projects : [],
    };
  }

  function defaultCompany() {
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
      profile: defaultProfile(),
    };
  }

  function makeBlankQuote() {
    const prefix = (state.company.quoteNoPrefix || "ZXBJ").trim();
    const datePart = compactDate(todayString());
    const same = (state.quotes || []).filter((item) => {
      const no = (item.quoteNo || "").toUpperCase();
      return no.startsWith(prefix.toUpperCase() + "-" + datePart);
    }).length;
    const seq = String(same + 1).padStart(3, "0");
    return {
      id: uid("q"),
      title: "产品报价单",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      quoteNo: prefix + "-" + datePart + "-" + seq,
      date: todayString(),
      validUntil: dateFromOffset(30),
      projectName: "",
      recipientUnit: "",
      recipientContact: "",
      recipientPhone: "",
      recipientEmail: "",
      recipientAddress: "",
      subject: "",
      paymentTerms: "",
      deliveryDays: "",
      qualityPeriod: "",
      footer: "",
      notes: [],
      items: [
        {
          id: uid("i"),
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
      ],
      certs: [],
      theme: "blue",
      showCerts: true,
      showPhotos: true,
      selectedAssetIds: [],
    };
  }

  function normalizeQuote(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const fallback = makeBlankQuote();
    const q = Object.assign(fallback, clone(src));
    if (!q.quoteNo) q.quoteNo = fallback.quoteNo;
    q.items = Array.isArray(src.items) && src.items.length ? src.items : q.items;
    q.certs = Array.isArray(src.certs) ? src.certs : [];
    q.notes = Array.isArray(src.notes) ? src.notes.filter((line) => String(line).trim()) : [];
    q.selectedAssetIds = Array.isArray(src.selectedAssetIds) ? src.selectedAssetIds : [];
    q.showCerts = src.showCerts !== false;
    q.showPhotos = src.showPhotos !== false;
    return q;
  }

  async function api(path, body) {
    const options = {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const res = await fetch(path, options);
    let payload = null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      payload = await res.json();
    }
    if (!res.ok) {
      throw new Error(payload && payload.error ? payload.error : "请求失败");
    }
    return payload;
  }

  function setSaveState() {
    const el = $("#save-state");
    const text = $(".save-state span", el);
    el.classList.toggle("is-dirty", state.dirty);
    if (state.dirty) {
      text.textContent = "正在保存";
    } else {
      text.textContent = "已同步";
    }
  }

  function toast(message, type) {
    const root = $("#toast-root");
    const node = document.createElement("div");
    node.className = "toast" + (type === "error" ? " is-error" : type === "success" ? " is-success" : "");
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => {
      node.style.opacity = "0";
      node.style.transition = "opacity .25s ease";
      setTimeout(() => node.remove(), 260);
    }, 2600);
  }

  function refreshIcons(root) {
    if (window.lucide) {
      window.lucide.createIcons({ attrs: { "stroke-width": 1.8 }, nameAttr: "data-lucide" }, root);
    }
  }

  function markChanged() {
    state.dirty = true;
    state.changeGen += 1;
    setSaveState();
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(() => {
      state.previewTimer = null;
      renderPreview();
    }, 180);
    if (state.autoSaveTimer) clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => {
      state.autoSaveTimer = null;
      persistCurrent();
    }, 1400);
  }

  async function persistCurrent() {
    if (state.saving) return;
    const gen = state.changeGen;
    state.saving = true;
    try {
      readQuoteFromForm();
      const data = clone(state.quote);
      data.updatedAt = new Date().toISOString();
      await api("/api/save-current", { data });
      if (gen === state.changeGen) {
        state.dirty = false;
        setSaveState();
      }
    } catch (err) {
      if (gen === state.changeGen) {
        const el = $("#save-state");
        el.classList.add("is-error");
        $(".save-state span", el).textContent = "保存失败";
      }
    } finally {
      state.saving = false;
    }
  }

  function readQuoteFromForm() {
    const q = state.quote;
    if (!q) return;
    q.title = ($("#f-title").value || "产品报价单").trim();
    q.quoteNo = $("#f-quote-no").value.trim();
    q.date = $("#f-date").value;
    q.validUntil = $("#f-valid-until").value;
    q.recipientUnit = $("#f-recipient-unit").value.trim();
    q.recipientContact = $("#f-recipient-contact").value.trim();
    q.recipientPhone = $("#f-recipient-phone").value.trim();
    q.recipientEmail = $("#f-recipient-email").value.trim();
    q.recipientAddress = $("#f-recipient-address").value.trim();
    q.projectName = $("#f-project-name").value.trim();
    q.subject = $("#f-subject").value.trim();
    q.paymentTerms = $("#f-payment").value.trim();
    q.deliveryDays = $("#f-delivery").value.trim();
    q.qualityPeriod = $("#f-quality").value.trim();
    q.footer = $("#f-footer").value.trim();
    q.notes = $("#f-notes").value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    q.showCerts = $("#f-show-certs").checked;
    q.showPhotos = $("#f-show-photos").checked;
    q.items = $$("#item-rows tr[data-item-id]").map((row) => {
      const get = (field) => {
        const input = $('input[data-field="' + field + '"]', row);
        return input ? input.value : "";
      };
      const item = {
        id: row.dataset.itemId,
        no: get("no"),
        name: get("name"),
        material: get("material"),
        spec: get("spec"),
        qty: get("qty"),
        unit: get("unit"),
        price: get("price"),
        amount: get("amount"),
        note: get("note"),
      };
      return item;
    });
    q.certs = $$("#cert-list .cert-row").map((row) => ({
      id: row.dataset.certId,
      category: $(".cert-category", row).value.trim(),
      name: $(".cert-name", row).value.trim(),
      no: $(".cert-no", row).value.trim(),
      validity: $(".cert-validity", row).value.trim(),
    }));
  }

  function writeQuoteToForm(q) {
    $("#f-title").value = q.title || "产品报价单";
    $("#f-quote-no").value = q.quoteNo || "";
    $("#f-date").value = q.date || todayString();
    $("#f-valid-until").value = q.validUntil || dateFromOffset(30);
    $("#f-recipient-unit").value = q.recipientUnit || "";
    $("#f-recipient-contact").value = q.recipientContact || "";
    $("#f-recipient-phone").value = q.recipientPhone || "";
    $("#f-recipient-email").value = q.recipientEmail || "";
    $("#f-recipient-address").value = q.recipientAddress || "";
    $("#f-project-name").value = q.projectName || "";
    $("#f-subject").value = q.subject || "";
    $("#f-payment").value = q.paymentTerms || "";
    $("#f-delivery").value = q.deliveryDays || "";
    $("#f-quality").value = q.qualityPeriod || "";
    $("#f-footer").value = q.footer || "";
    $("#f-notes").value = (q.notes || []).join("\n");
    $("#f-show-certs").checked = q.showCerts !== false;
    $("#f-show-photos").checked = q.showPhotos !== false;
    $$("#theme-row .theme-option").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.theme === (q.theme || "blue"));
    });
    renderItemRows();
    renderCertRows();
  }

  function renderItemRows() {
    const tbody = $("#item-rows");
    const items = state.quote && state.quote.items && state.quote.items.length ? state.quote.items : [{}];
    tbody.innerHTML = items.map((item, index) => {
      const row = Object.assign(
        { id: uid("i"), no: "", name: "", material: "", spec: "", qty: "", unit: "台", price: "", amount: "", note: "" },
        item || {}
      );
      const value = (field) => esc(row[field] == null ? "" : row[field]);
      return (
        '<tr data-item-id="' + attr(row.id) + '">' +
        '<td class="col-no"><input data-field="no" value="' + value("no") + '" placeholder="' + (index + 1) + '"></td>' +
        '<td class="col-name"><input data-field="name" value="' + value("name") + '" placeholder="设备名称"></td>' +
        '<td class="col-material"><input data-field="material" value="' + value("material") + '" placeholder="材质"></td>' +
        '<td class="col-spec"><input data-field="spec" value="' + value("spec") + '" placeholder="规格"></td>' +
        '<td class="col-qty"><input data-field="qty" inputmode="decimal" value="' + value("qty") + '" placeholder="0"></td>' +
        '<td class="col-unit"><input data-field="unit" value="' + value("unit") + '" placeholder="台"></td>' +
        '<td class="col-price"><input data-field="price" inputmode="decimal" value="' + value("price") + '" placeholder="0.00"></td>' +
        '<td class="col-amount"><input data-field="amount" inputmode="decimal" value="' + value("amount") + '" placeholder="0.00"></td>' +
        '<td class="col-note"><input data-field="note" value="' + value("note") + '" placeholder="备注"></td>' +
        '<td class="col-tools"><div class="row-tools">' +
        '<button class="row-btn" data-row-action="duplicate" type="button" title="复制本行"><i data-lucide="copy"></i></button>' +
        '<button class="row-btn is-danger" data-row-action="delete" type="button" title="删除本行"><i data-lucide="trash-2"></i></button>' +
        "</div></td></tr>"
      );
    }).join("");
    refreshIcons(tbody);
  }

  function renderCertRows() {
    const wrap = $("#cert-list");
    const certs = state.quote && state.quote.certs && state.quote.certs.length ? state.quote.certs : [{}];
    wrap.innerHTML = certs.map((cert) => {
      const row = Object.assign({ id: uid("c"), category: "", name: "", no: "", validity: "" }, cert || {});
      return (
        '<div class="cert-row" data-cert-id="' + attr(row.id) + '">' +
        '<input class="cert-category" value="' + esc(row.category) + '" placeholder="类别">' +
        '<input class="cert-name" value="' + esc(row.name) + '" placeholder="证书 / 认证名称">' +
        '<input class="cert-no" value="' + esc(row.no) + '" placeholder="证书编号 / 报告编号">' +
        '<input class="cert-validity" value="' + esc(row.validity) + '" placeholder="有效期 / 说明">' +
        '<button class="row-btn is-danger" data-cert-action="delete" type="button" title="删除"><i data-lucide="x"></i></button>' +
        "</div>"
      );
    }).join("");
    refreshIcons(wrap);
  }

  function renderHistory() {
    const grid = $("#history-grid");
    const quotes = state.quotes || [];
    if (!quotes.length) {
      grid.innerHTML =
        '<div class="empty-state"><div><i data-lucide="file-question"></i><p>保存后的报价会显示在这里</p></div></div>';
      refreshIcons(grid);
      return;
    }
    grid.innerHTML = quotes
      .map((record) => {
        const data = record.data || record;
        const total = totalOf(data);
        return (
          '<article class="history-card">' +
          '<div class="history-card-top">' +
          "<div><h3 title=\"" + attr(data.title || "产品报价单") + '">' + esc(data.title || "产品报价单") + "</h3>" +
          "<small>" + esc(data.quoteNo || "未编号") + (data.recipientUnit ? " · " + esc(data.recipientUnit) : "") + "</small></div>" +
          '<div class="history-amount">' + (total ? "¥ " + money(total, 0) : "") + "</div>" +
          "</div>" +
          "<p>" + esc(data.projectName || "防腐设备报价") + "</p>" +
          '<div class="history-actions">' +
          '<button class="btn btn-primary" data-history-action="open" data-history-id="' + attr(record.id) + '" type="button">打开</button>' +
          '<button class="btn btn-soft" data-history-action="duplicate" data-history-id="' + attr(record.id) + '" type="button">复制</button>' +
          '<button class="btn btn-quiet" data-history-action="delete" data-history-id="' + attr(record.id) + '" type="button">删除</button>' +
          "</div></article>"
        );
      })
      .join("");
    refreshIcons(grid);
  }

  function renderLibrary() {
    const wrap = $("#library-groups");
    wrap.innerHTML = ASSET_GROUPS.map((group) => {
      const files = state.assets.filter((asset) => asset.group === group.key);
      const selectedCount = files.filter((asset) => (state.quote.selectedAssetIds || []).includes(asset.id)).length;
      return (
        '<section class="library-group" data-group="' + group.key + '">' +
        '<div class="library-group-head">' +
        "<div><h3>" + esc(group.label) + "</h3><small>" + esc(group.hint) + "</small></div>" +
        '<div style="display:flex;align-items:center;gap:10px">' +
        "<span class=\"asset-tag\" style=\"position:static;background:#e7eef5;color:#52647a\">" + files.length + " 张</span>" +
        '<button class="btn btn-soft btn-small" data-upload-group="' + group.key + '" type="button">上传图片</button>' +
        '<input type="file" data-file-group="' + group.key + '" accept="image/*" multiple hidden>' +
        "</div></div>" +
        '<div class="asset-grid">' +
        (files.length
          ? files
              .map((asset) => {
                const selected = (state.quote.selectedAssetIds || []).includes(asset.id);
                return (
                  '<div class="asset-card">' +
                  '<div class="asset-thumb"><img src="' + encodeAsset(asset.url) + '" alt="' + esc(asset.caption || asset.name) + '">' +
                  '<span class="asset-tag">' + esc(asset.ext.toUpperCase()) + "</span>" +
                  '<div class="asset-actions">' +
                  '<button class="asset-action' + (selected ? " is-selected" : "") + '" data-asset-toggle="' + attr(asset.id) + '" type="button" title="' + (selected ? "已选用" : "选用到报价单") + '">' +
                  '<i data-lucide="' + (selected ? "circle-check" : "circle") + '"></i></button>' +
                  '<button class="asset-action is-danger" data-asset-delete="' + attr(asset.id) + '" type="button" title="删除文件">' +
                  '<i data-lucide="trash-2"></i></button>' +
                  "</div></div>" +
                  '<div class="asset-info"><input data-asset-caption="' + attr(asset.id) + '" value="' + esc(asset.caption) + '" placeholder="填写图片说明"></div>' +
                  "</div>"
                );
              })
              .join("")
          : '<div class="empty-state" style="grid-column:1/-1;min-height:130px"><div><i data-lucide="image"></i><p>暂无图片</p></div></div>') +
        "</div></section>"
      );
    }).join("");
    refreshIcons(wrap);
  }

  function renderSettings() {
    const c = Object.assign(defaultCompany(), state.company || {});
    c.profile = normalizeProfile(c.profile);
    $("#s-company-name").value = c.name || "";
    $("#s-short-name").value = c.shortName || "";
    $("#s-slogan").value = c.slogan || "";
    $("#s-address").value = c.address || "";
    $("#s-phone").value = c.phone || "";
    $("#s-email").value = c.email || "";
    $("#s-website").value = c.website || "";
    $("#s-unified-code").value = c.unifiedCode || "";
    $("#s-bank").value = c.bank || "";
    $("#s-account-no").value = c.accountNo || "";
    $("#s-sales-name").value = c.salesName || "";
    $("#s-sales-phone").value = c.salesPhone || "";
    $("#s-quote-prefix").value = c.quoteNoPrefix || "";

    const p = c.profile;
    $("#p-cover-enabled").checked = p.coverEnabled;
    $("#p-overview-enabled").checked = p.overviewEnabled;
    $("#p-basic-enabled").checked = p.basicEnabled;
    $("#p-equipment-enabled").checked = p.equipmentEnabled;
    $("#p-cert-enabled").checked = p.certEnabled;
    $("#p-projects-enabled").checked = p.projectsEnabled;
    $("#s-cover-tagline").value = p.coverTagline || "";
    $("#s-overview").value = p.overview || "";
    $("#s-basic-established").value = p.basic.established || "";
    $("#s-basic-capital").value = p.basic.registeredCapital || "";
    $("#s-basic-legal").value = p.basic.legal || "";
    $("#s-basic-employees").value = p.basic.employees || "";
    $("#s-basic-plant-area").value = p.basic.plantArea || "";
    $("#s-basic-scope").value = p.basic.businessScope || "";

    const coverOptions = state.assets
      .filter((asset) => asset.group === "companyGate")
      .map((asset) => '<option value="' + attr(asset.id) + '">' + esc(asset.caption || asset.name) + "</option>")
      .join("");
    $("#s-cover-asset").innerHTML =
      '<option value="">未选择，请先上传厂门照片</option>' + coverOptions;
    $("#s-cover-asset").value = p.coverAssetId || "";

    renderProfileEquipmentRows(p.equipment);
    renderProfileProjectRows(p.projects);
    renderProfileCertPicker(p.certAssetIds);
  }

  function renderProfileEquipmentRows(equipment) {
    const wrap = $("#profile-equipment-rows");
    const rows = equipment && equipment.length ? equipment : [{}];
    wrap.innerHTML = rows
      .map((row) => {
        const item = Object.assign({ name: "", spec: "", qty: "", purpose: "" }, row || {});
        return (
          '<div class="profile-edit-row equipment-row">' +
          '<input class="pe-name" value="' + esc(item.name) + '" placeholder="设备名称">' +
          '<input class="pe-spec" value="' + esc(item.spec) + '" placeholder="型号 / 规格">' +
          '<input class="pe-qty" value="' + esc(item.qty) + '" placeholder="数量">' +
          '<input class="pe-purpose" value="' + esc(item.purpose) + '" placeholder="用途 / 能力">' +
          '<button class="row-btn is-danger" data-profile-row="equipment" data-profile-action="delete" type="button" title="删除设备">' +
          '<i data-lucide="trash-2"></i></button></div>'
        );
      })
      .join("");
    refreshIcons(wrap);
  }

  function renderProfileProjectRows(projects) {
    const wrap = $("#profile-project-rows");
    const rows = projects && projects.length ? projects : [{}];
    wrap.innerHTML = rows
      .map((row) => {
        const item = Object.assign({ year: "", client: "", project: "", products: "", note: "" }, row || {});
        return (
          '<div class="profile-edit-row project-row">' +
          '<input class="pp-year" value="' + esc(item.year) + '" placeholder="年份">' +
          '<input class="pp-client" value="' + esc(item.client) + '" placeholder="客户单位">' +
          '<input class="pp-project" value="' + esc(item.project) + '" placeholder="项目名称">' +
          '<input class="pp-products" value="' + esc(item.products) + '" placeholder="供货产品">' +
          '<input class="pp-note" value="' + esc(item.note) + '" placeholder="备注">' +
          '<button class="row-btn is-danger" data-profile-row="project" data-profile-action="delete" type="button" title="删除业绩">' +
          '<i data-lucide="trash-2"></i></button></div>'
        );
      })
      .join("");
    refreshIcons(wrap);
  }

  function renderProfileCertPicker(certAssetIds) {
    const wrap = $("#profile-cert-assets");
    const certs = state.assets.filter((asset) => asset.group === "certs");
    if (!certs.length) {
      wrap.innerHTML = '<div class="cert-picker-empty">暂无资质照片，请先在素材库上传证书扫描件</div>';
      return;
    }
    const selected = certAssetIds || [];
    wrap.innerHTML = certs
      .map((asset) =>
        '<label class="profile-cert-option">' +
        '<img src="' + encodeAsset(asset.url) + '" alt="' + esc(asset.caption || asset.name) + '">' +
        '<input type="checkbox" data-profile-cert="' + attr(asset.id) + '"' +
        (selected.includes(asset.id) ? " checked" : "") + ">" +
        '<span>' + esc(asset.caption || asset.name) + "</span></label>"
      )
      .join("");
  }

  function readProfileFromForm() {
    const p = normalizeProfile(state.company.profile);
    const value = (id) => $(id).value.trim();
    p.coverEnabled = $("#p-cover-enabled").checked;
    p.coverAssetId = $("#s-cover-asset").value;
    p.coverTagline = value("#s-cover-tagline");
    p.overviewEnabled = $("#p-overview-enabled").checked;
    p.overview = value("#s-overview");
    p.basicEnabled = $("#p-basic-enabled").checked;
    p.basic.established = value("#s-basic-established");
    p.basic.registeredCapital = value("#s-basic-capital");
    p.basic.legal = value("#s-basic-legal");
    p.basic.employees = value("#s-basic-employees");
    p.basic.plantArea = value("#s-basic-plant-area");
    p.basic.businessScope = value("#s-basic-scope");
    p.equipmentEnabled = $("#p-equipment-enabled").checked;
    p.equipment = $$("#profile-equipment-rows .equipment-row").map((row) => ({
      name: $(".pe-name", row).value.trim(),
      spec: $(".pe-spec", row).value.trim(),
      qty: $(".pe-qty", row).value.trim(),
      purpose: $(".pe-purpose", row).value.trim(),
    })).filter((row) => Object.values(row).some(Boolean));
    p.certEnabled = $("#p-cert-enabled").checked;
    p.certAssetIds = $$("#profile-cert-assets input[data-profile-cert]:checked").map((input) => input.dataset.profileCert);
    p.projectsEnabled = $("#p-projects-enabled").checked;
    p.projects = $$("#profile-project-rows .project-row").map((row) => ({
      year: $(".pp-year", row).value.trim(),
      client: $(".pp-client", row).value.trim(),
      project: $(".pp-project", row).value.trim(),
      products: $(".pp-products", row).value.trim(),
      note: $(".pp-note", row).value.trim(),
    })).filter((row) => Object.values(row).some(Boolean));
    state.company.profile = p;
    return p;
  }

  function readCompanyForm() {
    const value = (id) => $(id).value.trim();
    const company = {
      name: value("#s-company-name"),
      shortName: value("#s-short-name"),
      slogan: value("#s-slogan"),
      address: value("#s-address"),
      phone: value("#s-phone"),
      email: value("#s-email"),
      website: value("#s-website"),
      unifiedCode: value("#s-unified-code"),
      bank: value("#s-bank"),
      accountNo: value("#s-account-no"),
      salesName: value("#s-sales-name"),
      salesPhone: value("#s-sales-phone"),
      quoteNoPrefix: value("#s-quote-prefix"),
    };
    company.profile = readProfileFromForm();
    return company;
  }

  function selectedPhotoCount() {
    return (state.quote.selectedAssetIds || []).filter((id) =>
      state.assets.some((asset) => asset.id === id)
    ).length;
  }

  function companyMark(company) {
    const value = String((company && (company.shortName || company.name)) || "兆辉防腐")
      .replace(/^(江苏|江苏省)/, "")
      .trim();
    return value.slice(0, 1) || "兆";
  }

  function partyLine(label, value) {
    if (!value) return "";
    return '<div class="party-row"><dt>' + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>";
  }

  function termsGrid(q) {
    const rows = [
      ["付款方式", q.paymentTerms],
      ["交货周期", q.deliveryDays],
      ["质保期限", q.qualityPeriod],
      ["报价有效期", q.validUntil ? "至 " + esc(q.validUntil) : ""],
    ].filter((row) => row[1]);
    if (!rows.length) return "";
    return (
      '<div class="section-title">商务条款</div>' +
      '<div class="terms-grid">' +
      rows.map((row) => '<div class="term-item"><b>' + esc(row[0]) + "：</b><span>" + esc(row[1]) + "</span></div>").join("") +
      "</div>"
    );
  }

  function notesHtml(q) {
    if (!(q.notes || []).length) return "";
    return (
      '<div class="section-title">报价说明与备注</div>' +
      '<ul class="notes-list">' +
      (q.notes || []).map((line) => "<li>" + esc(line) + "</li>").join("") +
      "</ul>"
    );
  }

  function certsHtml(q) {
    const certs = (q.certs || []).filter((cert) =>
      [cert.category, cert.name, cert.no, cert.validity].some((v) => String(v || "").trim())
    );
    if (!q.showCerts || !certs.length) return "";
    return (
      '<div class="section-title">资质与认证</div>' +
      '<table class="cert-table"><colgroup>' +
      '<col style="width:20%"><col style="width:30%"><col style="width:30%"><col style="width:20%">' +
      "</colgroup><thead><tr><th>类别</th><th>证书 / 认证名称</th><th>证书编号 / 报告编号</th><th>有效期 / 说明</th></tr></thead><tbody>" +
      certs
        .map(
          (cert) =>
            "<tr><td>" + esc(cert.category) + "</td><td>" + esc(cert.name) + "</td><td>" + esc(cert.no) + "</td><td>" + esc(cert.validity) + "</td></tr>"
        )
        .join("") +
      "</tbody></table>"
    );
  }

  function buildHeaderHtml(q, company, logoAsset) {
    const contact = [
      [company.phone && "电话：" + company.phone, company.email && "邮箱：" + company.email],
      [company.address && "地址：" + company.address, company.website && "网址：" + company.website],
    ]
      .flat()
      .filter(Boolean)
      .join("<br>");
    const mark = companyMark(company);
    return (
      '<div class="doc-header">' +
      '<div class="doc-brand">' +
      (logoAsset
        ? '<div class="doc-logo"><img src="' + encodeAsset(logoAsset.url) + '" alt=""></div>'
        : '<div class="doc-logo"><div class="doc-logo-mark">' + esc(mark) + "</div></div>") +
      '<div><div class="doc-brand-name">' + esc(company.name || "江苏兆辉防腐科技有限公司") + "</div>" +
      '<div class="doc-brand-slogan">' + esc(company.slogan || "") + "</div></div></div>" +
      (contact ? '<div class="doc-contact">' + contact + "</div>" : "") +
      "</div>"
    );
  }

  function buildMainPageHtml(q, company, selectedAssets) {
    const items = (q.items || []).filter(Boolean);
    const total = totalOf(q);
    const recipientInfo =
      [q.recipientUnit, q.recipientContact, q.recipientPhone, q.recipientEmail, q.recipientAddress, q.projectName].filter(Boolean).length > 0;
    const logoAsset = selectedAssets.find((asset) => asset.group === "logo");
    const contactPerson = company.salesName || company.salesPhone
      ? [company.salesName && "销售：" + company.salesName, company.salesPhone && company.salesPhone].filter(Boolean).join("  ")
      : "";
    const meta = [
      ["报价单号", q.quoteNo],
      ["报价日期", q.date],
      ["有效期至", q.validUntil],
    ]
      .filter((item) => item[1])
      .map((item) => "<span><strong>" + esc(item[0]) + "：</strong>" + esc(item[1]) + "</span>")
      .join("");

    return (
      '<div class="doc-page quote-doc" data-theme="' + esc(q.theme || "blue") + '">' +
      buildHeaderHtml(q, company, logoAsset) +
      '<div class="doc-title-area"><div class="doc-kicker">PRODUCT QUOTATION</div><h1 class="doc-title">' + esc(q.title || "产品报价单") + "</h1>" +
      (q.subject ? '<div class="doc-subject">' + esc(q.subject) + "</div>" : "") +
      (meta ? '<div class="doc-meta">' + meta + "</div>" : "") +
      "</div>" +
      (recipientInfo
        ? '<div class="party-panel"><div class="party-side">' +
          partyLine("收件单位", q.recipientUnit) +
          partyLine("联系人", q.recipientContact) +
          partyLine("联系电话", q.recipientPhone) +
          "</div><div class=\"party-side\">" +
          partyLine("项目名称", q.projectName) +
          partyLine("电子邮箱", q.recipientEmail) +
          partyLine("单位地址", q.recipientAddress) +
          "</div></div>"
        : "") +
      '<div class="section-title">产品报价明细</div>' +
      '<table class="quote-table"><colgroup>' +
      '<col style="width:5%"><col style="width:20%"><col style="width:9%"><col style="width:17%">' +
      '<col style="width:7%"><col style="width:6%"><col style="width:12%"><col style="width:13%"><col style="width:11%">' +
      "</colgroup><thead><tr>" +
      "<th>序号</th><th>名称 / 型号</th><th>材质</th><th>规格 / 尺寸</th><th>数量</th><th>单位</th><th>单价</th><th>总价</th><th>备注</th>" +
      "</tr></thead><tbody>" +
      items
        .map((item, index) => {
          const qty = toNumber(item.qty);
          const price = toNumber(item.price);
          const amount = amountOf(item);
          return (
            "<tr>" +
            '<td class="center">' + esc(item.no || index + 1) + "</td>" +
            '<td class="center">' + esc(item.name) + "</td>" +
            '<td class="center">' + esc(item.material) + "</td>" +
            "<td>" + esc(item.spec) + "</td>" +
            '<td class="center">' + (qty ? String(qty) : "") + "</td>" +
            '<td class="center">' + esc(item.unit) + "</td>" +
            '<td class="num">' + (price ? money(price) : "") + "</td>" +
            '<td class="num">' + (amount ? money(amount) : "") + "</td>" +
            "<td>" + esc(item.note) + "</td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>" +
      (total
        ? '<div class="total-strip"><div class="total-cn">人民币大写：' + esc(upperMoney(total)) + '</div><div class="total-box">报价合计<span>¥ ' +
          money(total) + "</span></div></div>"
        : "") +
      notesHtml(q) +
      termsGrid(q) +
      certsHtml(q) +
      '<div class="sign-area">' +
      '<div class="sign-block"><div class="sign-line"></div>报价单位（盖章）</div>' +
      '<div class="sign-block"><div class="sign-line"></div>客户确认（盖章）</div>' +
      "</div>" +
      '<div class="doc-footer"><div>' + esc(q.footer || "感谢您选择兆辉防腐设备") + (contactPerson ? "<br><b>" + esc(contactPerson) + "</b>" : "") + "</div><div><b>" + esc(company.name || "") + "</b><br>" + (company.phone ? esc(company.phone) : "") + "</div></div>" +
      "</div>"
    );
  }

  function buildPhotoPagesHtml(q, company, selectedAssets) {
    if (!q.showPhotos) return "";
    const pages = ASSET_GROUPS.filter((group) => group.key !== "logo" && group.key !== "companyGate")
      .flatMap((group) =>
        selectedAssets
          .filter((asset) => asset.group === group.key)
          .map((asset) => ({ asset, group }))
      );
    if (!pages.length) return "";
    const logoAsset = selectedAssets.find((asset) => asset.group === "logo" && (q.selectedAssetIds || []).includes(asset.id));
    return pages
      .map((page, index) => {
        const asset = page.asset;
        const group = page.group;
        const pageNo = String(index + 1).padStart(2, "0");
        return (
          '<div class="doc-page photo-page quote-doc" data-theme="' + esc(q.theme || "blue") + '">' +
          '<div class="photo-mini-head">' +
          '<div class="doc-brand">' +
          (logoAsset
            ? '<div class="doc-logo"><img src="' + encodeAsset(logoAsset.url) + '" alt=""></div>'
            : '<div class="doc-logo"><div class="doc-logo-mark">' + esc(companyMark(company)) + "</div></div>") +
          '<div><div class="doc-brand-name" style="font-size:16px">' +
          esc(company.name || "江苏兆辉防腐科技有限公司") +
          "</div><div class=\"doc-brand-slogan\">" +
          esc(q.quoteNo ? "报价单号：" + q.quoteNo : "") +
          "</div></div></div>" +
          '<div class="photo-page-index">' + pageNo + "</div>" +
          "</div>" +
          '<div class="photo-full-head"><div><div class="doc-kicker">' +
          esc(group.label) +
          "</div><h2>" +
          esc(q.photoHeading || "产品实拍与制造能力") +
          "</h2></div><p>" +
          esc(asset.caption || asset.name) +
          "</p></div>" +
          '<figure class="photo-full">' +
          '<img src="' + encodeAsset(asset.url) + '" alt="' + esc(asset.caption || asset.name) + '">' +
          "</figure>" +
          "</div>"
        );
      })
      .join("");
  }

  function profilePageShell(title, subtitle, index, q, company, assets) {
    const logoAsset = assets.find((asset) => asset.group === "logo" && (q.selectedAssetIds || []).includes(asset.id));
    const pageNo = String(index || 0).padStart(2, "0");
    return (
      '<div class="doc-page profile-page quote-doc" data-theme="' + esc(q.theme || "blue") + '">' +
      '<div class="photo-mini-head">' +
      '<div class="doc-brand">' +
      (logoAsset
        ? '<div class="doc-logo"><img src="' + encodeAsset(logoAsset.url) + '" alt=""></div>'
        : '<div class="doc-logo"><div class="doc-logo-mark">' + esc(companyMark(company)) + "</div></div>") +
      '<div><div class="doc-brand-name" style="font-size:16px">' +
      esc(company.name || "江苏兆辉防腐科技有限公司") +
      "</div><div class=\"doc-brand-slogan\">" +
      esc(q.quoteNo ? "报价单号：" + q.quoteNo : "") +
      "</div></div></div>" +
      '<div class="photo-page-index">' + pageNo + "</div>" +
      "</div>" +
      '<div class="photo-full-head"><div><div class="doc-kicker">江苏兆辉防腐科技有限公司</div><h2>' +
      esc(title) +
      "</h2></div><p>" +
      esc(subtitle || "") +
      "</p></div>"
    );
  }

  function buildCoverPageHtml(q, company, assets, profile) {
    if (!profile.coverEnabled) return "";
    const coverAsset = assets.find((asset) => asset.id === profile.coverAssetId);
    if (!coverAsset) return "";
    const titleText = (q.recipientUnit || "贵公司") + "报价及技术说明";
    return (
      '<div class="doc-page cover-page quote-doc" data-theme="' + esc(q.theme || "blue") + '">' +
      '<img class="cover-photo" src="' + encodeAsset(coverAsset.url) + '" alt="">' +
      '<div class="cover-shade"></div>' +
      '<div class="cover-content">' +
      '<div class="cover-eyebrow">江苏兆辉防腐科技有限公司</div>' +
      '<h1>' + esc(titleText) + "</h1>" +
      '<p>' + esc(profile.coverTagline || company.slogan || "") + "</p>" +
      '<div class="cover-company">' + esc(company.name || "江苏兆辉防腐科技有限公司") + "</div>" +
      '<div class="cover-date">报价日期：' + esc(q.date || "") + "</div>" +
      "</div></div>"
    );
  }

  function buildProfilePagesHtml(q, company, assets, profile) {
    const pages = [];
    let index = 1;
    if (profile.overviewEnabled && String(profile.overview || "").trim()) {
      const lines = String(profile.overview).split("\n").map((line) => esc(line.trim())).filter(Boolean);
      pages.push(
        profilePageShell("企业概况", "公司简介与核心业务", index++, q, company, assets) +
        '<div class="profile-copy">' + lines.map((line) => "<p>" + line + "</p>").join("") + "</div></div>"
      );
    }
    const basic = [
      ["公司名称", company.name],
      ["统一社会信用代码", company.unifiedCode],
      ["成立时间", profile.basic.established],
      ["注册资本", profile.basic.registeredCapital],
      ["法定代表人", profile.basic.legal],
      ["员工人数", profile.basic.employees],
      ["厂房面积", profile.basic.plantArea],
      ["公司地址", company.address],
      ["联系电话", company.phone],
      ["经营范围 / 主营业务", profile.basic.businessScope],
    ].filter((row) => String(row[1] || "").trim());
    if (profile.basicEnabled && basic.length) {
      pages.push(
        profilePageShell("公司基本情况表", "工商登记与生产经营概况", index++, q, company, assets) +
        '<table class="profile-table basic-table"><tbody>' +
        basic.map((row) => "<tr><th>" + esc(row[0]) + "</th><td>" + esc(row[1]) + "</td></tr>").join("") +
        "</tbody></table></div>"
      );
    }
    if (profile.equipmentEnabled && profile.equipment.length) {
      pages.push(
        profilePageShell("公司主要设备情况表", "生产制造与检测能力", index++, q, company, assets) +
        '<table class="profile-table"><thead><tr><th>序号</th><th>设备名称</th><th>型号 / 规格</th><th>数量</th><th>主要用途 / 能力</th></tr></thead><tbody>' +
        profile.equipment.map((row, rowIndex) =>
          "<tr><td class=\"center\">" + (rowIndex + 1) + "</td><td>" + esc(row.name) + "</td><td>" +
          esc(row.spec) + "</td><td class=\"center\">" + esc(row.qty) + "</td><td>" + esc(row.purpose) + "</td></tr>"
        ).join("") +
        "</tbody></table></div>"
      );
    }
    if (profile.certEnabled && profile.certAssetIds.length) {
      const certAssets = assets.filter((asset) => asset.group === "certs" && profile.certAssetIds.includes(asset.id));
      if (certAssets.length) {
        pages.push(
          profilePageShell("公司资质与证书", "资质证书与检测认证资料", index++, q, company, assets) +
          '<div class="profile-cert-grid">' +
          certAssets.map((asset) =>
            '<figure class="profile-cert-card"><img src="' + encodeAsset(asset.url) + '" alt="' +
            esc(asset.caption || asset.name) + '"><figcaption>' + esc(asset.caption || asset.name) + "</figcaption></figure>"
          ).join("") +
          "</div></div>"
        );
      }
    }
    if (profile.projectsEnabled && profile.projects.length) {
      pages.push(
        profilePageShell("工程业绩展示", "近年防腐设备供货与工程业绩", index++, q, company, assets) +
        '<table class="profile-table"><thead><tr><th>年份</th><th>客户单位</th><th>项目名称</th><th>供货产品</th><th>备注</th></tr></thead><tbody>' +
        profile.projects.map((row, rowIndex) =>
          "<tr><td class=\"center\">" + esc(row.year || rowIndex + 1) + "</td><td>" + esc(row.client) +
          "</td><td>" + esc(row.project) + "</td><td>" + esc(row.products) + "</td><td>" + esc(row.note) + "</td></tr>"
        ).join("") +
        "</tbody></table></div>"
      );
    }
    return pages.join("");
  }

  function buildPreviewHtml() {
    const q = state.quote;
    const company = state.company;
    const profile = normalizeProfile(company.profile);
    const selected = state.assets.filter((asset) => (q.selectedAssetIds || []).includes(asset.id));
    return (
      buildCoverPageHtml(q, company, state.assets, profile) +
      buildMainPageHtml(q, company, selected) +
      buildPhotoPagesHtml(q, company, selected) +
      buildProfilePagesHtml(q, company, state.assets, profile)
    );
  }

  function renderPreview() {
    if (!state.quote) return;
    readQuoteFromForm();
    const stage = $("#sheet-stage");
    const html = buildPreviewHtml();
    stage.innerHTML = '<div class="sheet-wrap" id="sheet-wrap">' + html + "</div>";
    applyZoom();
    $("#selected-photo-count").textContent = selectedPhotoCount() + " 张照片已选用";
  }

  function applyZoom() {
    const wrap = $("#sheet-wrap");
    if (!wrap) return;
    wrap.style.transform = "scale(" + state.zoom / 100 + ")";
  }

  function setView(view) {
    state.view = view;
    $$(".rail-btn").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.view === view));
    $$(".view").forEach((section) => section.classList.toggle("is-active", section.id === "view-" + view));
    if (view === "history") renderHistory();
    if (view === "library") {
      renderLibrary();
      $("#selected-photo-count").textContent = selectedPhotoCount() + " 张照片已选用";
    }
    if (view === "settings") renderSettings();
  }

  async function saveHistory(showToastMessage) {
    readQuoteFromForm();
    const data = clone(state.quote);
    data.updatedAt = new Date().toISOString();
    const result = await api("/api/save-quote", { data });
    state.quotes = result.quotes || [];
    state.dirty = false;
    setSaveState();
    renderHistory();
    if (showToastMessage !== false) toast("报价单已保存", "success");
    return data;
  }

  async function newQuote() {
    try {
      await persistCurrent();
    } catch (err) {
      // 继续新建
    }
    state.quote = makeBlankQuote();
    writeQuoteToForm(state.quote);
    state.dirty = false;
    setSaveState();
    renderPreview();
    renderHistory();
    renderLibrary();
    setView("editor");
    toast("已创建新报价单", "success");
  }

  function historyRecord(id) {
    return (state.quotes || []).find((record) => record.id === id) || null;
  }

  async function openHistory(id) {
    const record = historyRecord(id);
    if (!record) return;
    const data = record.data || record;
    state.quote = normalizeQuote(data);
    writeQuoteToForm(state.quote);
    state.dirty = false;
    setSaveState();
    renderPreview();
    setView("editor");
    toast("已打开：" + (state.quote.recipientUnit || state.quote.quoteNo || "报价单"), "success");
  }

  async function duplicateHistory(id) {
    const record = historyRecord(id);
    if (!record) return;
    const data = normalizeQuote(record.data || record);
    data.id = uid("q");
    data.quoteNo = (data.quoteNo || "报价单") + "-副本";
    data.updatedAt = new Date().toISOString();
    data.createdAt = new Date().toISOString();
    state.quote = data;
    writeQuoteToForm(data);
    await saveHistory();
    renderPreview();
    setView("editor");
    toast("已复制为新报价单", "success");
  }

  async function deleteHistory(id) {
    const record = historyRecord(id);
    if (!record) return;
    if (!window.confirm("确定删除「" + (record.title || "该报价单") + "」记录吗？素材文件不会被删除。")) return;
    await api("/api/delete-quote", { id });
    state.quotes = (state.quotes || []).filter((item) => item.id !== id);
    renderHistory();
    toast("报价记录已删除", "success");
  }

  async function uploadFiles(groupKey, files) {
    const group = ASSET_GROUPS.find((g) => g.key === groupKey) || ASSET_GROUPS[0];
    const list = Array.from(files);
    if (!list.length) return;
    toast("正在上传 " + list.length + " 张图片，请稍候", "success");
    let uploaded = 0;
    for (const file of list) {
      try {
        if (!String(file.type || "").toLowerCase().startsWith("image/")) {
          toast("「" + file.name + "」不是图片文件，请选择 JPG / PNG 图片", "error");
          continue;
        }
        const dataUrl = await prepareImageData(file);
        const asset = await api("/api/upload", {
          group: groupKey,
          name: file.name,
          caption: group.label,
          dataUrl,
        });
        if (asset && asset.url) {
          state.assets = [asset].concat(state.assets || []);
          state.quote.selectedAssetIds = state.quote.selectedAssetIds || [];
          if (!state.quote.selectedAssetIds.includes(asset.id)) {
            state.quote.selectedAssetIds.push(asset.id);
          }
          uploaded += 1;
        }
      } catch (err) {
        toast("「" + file.name + "」上传失败：" + (err.message || ""), "error");
      }
    }
    renderLibrary();
    renderPreview();
    $("#selected-photo-count").textContent = selectedPhotoCount() + " 张照片已选用";
    if (uploaded) toast("已上传 " + uploaded + " 张图片，可直接勾选使用", "success");
  }

  async function prepareImageData(file) {
    const raw = await readFileAsDataUrl(file);
    const img = await loadImage(raw);
    const maxSide = 2400;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1 && file.type === "image/png") return raw;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片无法读取"));
      img.src = src;
    });
  }

  async function toggleAsset(id) {
    const q = state.quote;
    const selected = q.selectedAssetIds || [];
    const index = selected.indexOf(id);
    if (index >= 0) selected.splice(index, 1);
    else selected.push(id);
    q.selectedAssetIds = selected;
    renderLibrary();
    renderPreview();
    $("#selected-photo-count").textContent = selectedPhotoCount() + " 张照片已选用";
    markChanged();
  }

  async function deleteAsset(id) {
    const asset = (state.assets || []).find((a) => a.id === id);
    if (!asset) return;
    if (!window.confirm("确定从素材库删除「" + (asset.caption || asset.name) + "」吗？")) return;
    await api("/api/delete-asset", { url: asset.url });
    state.assets = (state.assets || []).filter((a) => a.id !== id);
    if (state.quote.selectedAssetIds) {
      state.quote.selectedAssetIds = state.quote.selectedAssetIds.filter((selectedId) => selectedId !== id);
    }
    renderLibrary();
    renderPreview();
    $("#selected-photo-count").textContent = selectedPhotoCount() + " 张照片已选用";
    toast("图片已删除", "success");
  }

  async function rescanAssets() {
    const data = await api("/api/bootstrap");
    state.assets = data.assets || [];
    renderLibrary();
    renderPreview();
    $("#selected-photo-count").textContent = selectedPhotoCount() + " 张照片已选用";
    toast("素材已刷新", "success");
  }

  async function saveAssetCaption(id) {
    const asset = (state.assets || []).find((a) => a.id === id);
    const input = document.querySelector('[data-asset-caption="' + CSS.escape(id) + '"]');
    if (!asset || !input) return;
    const caption = input.value.trim();
    if (asset.caption === caption) return;
    asset.caption = caption;
    renderPreview();
    try {
      await api("/api/asset-caption", { url: asset.url, caption });
    } catch (err) {
      toast("图片说明保存失败", "error");
    }
  }

  async function exportDocument(kind) {
    const button = kind === "pdf" ? $("#btn-export-pdf") : $("#btn-export-word");
    if (!state.quote) return;
    readQuoteFromForm();
    const assets = state.assets.filter((asset) => (state.quote.selectedAssetIds || []).includes(asset.id));
    const payload = Object.assign({}, clone(state.quote), {
      companyName: state.company.name || "",
      companySlogan: state.company.slogan || "",
      companyPhone: state.company.phone || "",
      companyEmail: state.company.email || "",
      companyAddress: state.company.address || "",
      companyWebsite: state.company.website || "",
      companyBank: state.company.bank || "",
      companyAccountNo: state.company.accountNo || "",
      companyUnifiedCode: state.company.unifiedCode || "",
      companyLegal: state.company.legal || "",
      salesName: state.company.salesName || "",
      salesPhone: state.company.salesPhone || "",
      profile: clone(normalizeProfile(state.company.profile)),
    });
    button.disabled = true;
    button.style.opacity = ".6";
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, data: payload, assets: state.assets || [] }),
      });
      if (!res.ok) {
        let errorMessage = "导出失败";
        try {
          const err = await res.json();
          if (err && err.error) errorMessage = err.error;
        } catch (err) {
          // ignore
        }
        throw new Error(errorMessage);
      }
      const blob = await res.blob();
      const fallback =
        (payload.quoteNo || "报价单").replace(/[\\/:*?"<>|]/g, "_") +
        (payload.recipientUnit ? "-" + payload.recipientUnit.slice(0, 20) : "") +
        (kind === "pdf" ? ".pdf" : ".docx");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(kind === "pdf" ? "PDF 已导出" : "Word 文档已导出", "success");
      try {
        await persistCurrent();
      } catch (err) {
        // ignore
      }
    } catch (err) {
      toast(err.message || "导出失败", "error");
    } finally {
      button.disabled = false;
      button.style.opacity = "";
    }
  }

  function enableDragScroll(wrap) {
    if (!wrap || wrap.dataset.dragEnabled) return;
    wrap.dataset.dragEnabled = "1";
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    wrap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("input, button, textarea, select")) return;
      dragging = true;
      startX = event.clientX;
      startScroll = wrap.scrollLeft;
      wrap.classList.add("is-dragging");
      wrap.setPointerCapture(event.pointerId);
    });
    wrap.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      event.preventDefault();
      wrap.scrollLeft = startScroll - (event.clientX - startX);
    });
    const stopDrag = () => {
      dragging = false;
      wrap.classList.remove("is-dragging");
    };
    wrap.addEventListener("pointerup", stopDrag);
    wrap.addEventListener("pointercancel", stopDrag);
  }

  function bindEvents() {
    enableDragScroll($(".item-editor-wrap"));
    document.addEventListener("click", (event) => {
      const nav = event.target.closest(".rail-btn");
      if (nav) {
        setView(nav.dataset.view);
        return;
      }
      if (event.target.closest("#btn-save")) {
        saveHistory(true).catch((err) => toast(err.message || "保存失败", "error"));
        return;
      }
      if (event.target.closest("#btn-export-word")) {
        exportDocument("word");
        return;
      }
      if (event.target.closest("#btn-export-pdf")) {
        exportDocument("pdf");
        return;
      }
      if (event.target.closest("#btn-new-quote")) {
        newQuote();
        return;
      }
      if (event.target.closest("#btn-open-library")) {
        setView("library");
        return;
      }
      if (event.target.closest("#btn-add-equipment")) {
        let company = readCompanyForm();
        state.company = company;
        state.company.profile.equipment.push({ name: "", spec: "", qty: "", purpose: "" });
        renderSettings();
        return;
      }
      if (event.target.closest("#btn-add-project")) {
        let company = readCompanyForm();
        state.company = company;
        state.company.profile.projects.push({ year: "", client: "", project: "", products: "", note: "" });
        renderSettings();
        return;
      }
      const profileDelete = event.target.closest("[data-profile-action='delete']");
      if (profileDelete) {
        const row = profileDelete.closest(".profile-edit-row");
        if (row) row.remove();
        let company = readCompanyForm();
        state.company = company;
        renderSettings();
        return;
      }
      if (event.target.closest("#btn-rescan-assets")) {
        rescanAssets().catch((err) => toast(err.message || "刷新失败", "error"));
        return;
      }
      if (event.target.closest("#btn-save-company")) {
        saveCompany();
        return;
      }

      const rowAction = event.target.closest("[data-row-action]");
      if (rowAction) {
        const row = rowAction.closest("tr[data-item-id]");
        if (!row) return;
        handleItemAction(row.dataset.itemId, rowAction.dataset.rowAction);
        return;
      }
      if (event.target.closest("#btn-add-item")) {
        readQuoteFromForm();
        state.quote.items.push({
          id: uid("i"),
          no: "",
          name: "",
          material: "",
          spec: "",
          qty: "",
          unit: "台",
          price: "",
          amount: "",
          note: "",
        });
        renderItemRows();
        refreshIcons();
        markChanged();
        return;
      }
      if (event.target.closest("#btn-reorder-items")) {
        readQuoteFromForm();
        const items = state.quote.items
          .map((item, index) => ({
            item,
            no: toNumber(item.no) || index + 1,
            index,
          }))
          .sort((a, b) => a.no - b.no || a.index - b.index)
          .map((entry) => entry.item);
        state.quote.items = items;
        renderItemRows();
        refreshIcons();
        markChanged();
        return;
      }

      const certAction = event.target.closest("[data-cert-action]");
      if (certAction) {
        handleCertAction(certAction.closest(".cert-row").dataset.certId, certAction.dataset.certAction);
        return;
      }
      if (event.target.closest("#btn-add-cert")) {
        readQuoteFromForm();
        state.quote.certs.push({ id: uid("c"), category: "", name: "", no: "", validity: "" });
        renderCertRows();
        refreshIcons();
        markChanged();
        return;
      }

      const themeButton = event.target.closest("#theme-row .theme-option");
      if (themeButton) {
        state.quote.theme = themeButton.dataset.theme;
        $$("#theme-row .theme-option").forEach((button) => button.classList.toggle("is-active", button === themeButton));
        renderPreview();
        markChanged();
        return;
      }

      const historyAction = event.target.closest("[data-history-action]");
      if (historyAction) {
        const id = historyAction.dataset.historyId;
        const action = historyAction.dataset.historyAction;
        if (action === "open") openHistory(id).catch((err) => toast(err.message, "error"));
        if (action === "duplicate") duplicateHistory(id).catch((err) => toast(err.message, "error"));
        if (action === "delete") deleteHistory(id).catch((err) => toast(err.message, "error"));
        return;
      }

      const uploadButton = event.target.closest("[data-upload-group]");
      if (uploadButton) {
        const input = document.querySelector('[data-file-group="' + uploadButton.dataset.uploadGroup + '"]');
        if (input) input.click();
        return;
      }
      const toggleButton = event.target.closest("[data-asset-toggle]");
      if (toggleButton) {
        toggleAsset(toggleButton.dataset.assetToggle).catch((err) => toast(err.message, "error"));
        return;
      }
      const deleteButton = event.target.closest("[data-asset-delete]");
      if (deleteButton) {
        deleteAsset(deleteButton.dataset.assetDelete).catch((err) => toast(err.message, "error"));
      }
    });

    document.addEventListener("change", (event) => {
      const fileInput = event.target.closest("input[data-file-group]");
      if (fileInput && fileInput.files && fileInput.files.length) {
        const fileGroup = fileInput.dataset.fileGroup;
        const fileList = Array.from(fileInput.files);
        fileInput.value = "";
        uploadFiles(fileGroup, fileList).catch((err) =>
          toast(err.message || "图片上传失败", "error")
        );
        return;
      }
      const captionInput = event.target.closest("[data-asset-caption]");
      if (captionInput) {
        saveAssetCaption(captionInput.dataset.assetCaption).catch(() => {});
        return;
      }
      if (event.target.matches("#f-show-certs, #f-show-photos")) {
        markChanged();
        return;
      }
      if (event.target.closest("#view-editor")) {
        markChanged();
      }
    });

    document.addEventListener("input", (event) => {
      if (event.target.closest("#view-settings")) return;
      const target = event.target;
      if (target.matches("input[data-field='qty'], input[data-field='price']")) {
        const row = target.closest("tr[data-item-id]");
        if (row) {
          const qtyInput = $("input[data-field='qty']", row);
          const priceInput = $("input[data-field='price']", row);
          const amountInput = $("input[data-field='amount']", row);
          if (amountInput && qtyInput && priceInput) {
            const qty = toNumber(qtyInput.value);
            const price = toNumber(priceInput.value);
            amountInput.value = qty && price ? String(Math.round(qty * price * 100) / 100) : "";
          }
        }
      }
      if (event.target.closest("#view-editor")) markChanged();
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        saveHistory(true).catch((err) => toast(err.message, "error"));
      }
    });

    $$(".zoom-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const dir = button.dataset.zoom === "in" ? 1 : -1;
        state.zoom = Math.max(60, Math.min(140, state.zoom + dir * 10));
        $("#zoom-label").textContent = state.zoom + "%";
        applyZoom();
      });
    });
  }

  function handleItemAction(id, action) {
    readQuoteFromForm();
    const index = state.quote.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    if (action === "duplicate") {
      const copy = clone(state.quote.items[index]);
      copy.id = uid("i");
      state.quote.items.splice(index + 1, 0, copy);
    } else if (action === "delete") {
      if (state.quote.items.length === 1) {
        state.quote.items = [
          { id: uid("i"), no: "", name: "", material: "", spec: "", qty: "", unit: "台", price: "", amount: "", note: "" },
        ];
      } else {
        state.quote.items.splice(index, 1);
      }
    }
    renderItemRows();
    refreshIcons();
    markChanged();
  }

  function handleCertAction(id, action) {
    readQuoteFromForm();
    const index = state.quote.certs.findIndex((cert) => cert.id === id);
    if (action === "delete" && index >= 0) {
      state.quote.certs.splice(index, 1);
    }
    renderCertRows();
    refreshIcons();
    markChanged();
  }

  async function saveCompany() {
    const company = readCompanyForm();
    const result = await api("/api/company", { company });
    state.company = result.company;
    state.company.profile = normalizeProfile(state.company.profile);
    renderSettings();
    renderPreview();
    toast("公司资料已保存", "success");
  }

  async function init() {
    bindEvents();
    state.company = defaultCompany();
    state.quote = makeBlankQuote();
    writeQuoteToForm(state.quote);
    renderHistory();
    renderLibrary();
    renderSettings();
    try {
      const data = await api("/api/bootstrap");
      state.company = Object.assign(defaultCompany(), data.company || {});
      state.company.profile = normalizeProfile(state.company.profile);
      state.assets = data.assets || [];
      state.quotes = data.quotes || [];
      if (data.current && typeof data.current === "object") {
        state.quote = normalizeQuote(data.current);
      }
      writeQuoteToForm(state.quote);
      renderHistory();
      renderLibrary();
      renderSettings();
      renderPreview();
      setSaveState();
      refreshIcons();
    } catch (err) {
      writeQuoteToForm(state.quote);
      renderPreview();
      toast("无法连接本地服务，请通过「启动报价单」命令打开", "error");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
