"use strict";
/* Sandbox: a guided walk-through in a made-up scene (first version by a teammate).
   The drafts, the customer and the replies are fictional. Factory facts come from /api/meta, and findings
   marked "代码复核" come from the real rule engine (/api/check with rules_only: no model call, no quota).
   The other hints are examples written against real rules in kb/rules.json and real market notes in
   data/markets.json; app/tests keeps the ids, links and notes here in step with those files. */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (value) => Number(value || 0).toLocaleString("en-US");

  const fallback = { factory: { name_zh: "甬江小家电（示例工厂）", city: "Ningbo", standard_lead_time_days: 35 }, product: { id: "AF-45D", name_zh: "4.5L 数显空气炸锅", name_en: "4.5L Digital Air Fryer", moq_units: 1000, certifications_held: ["CB report (IEC 60335-2-9)", "CE (LVD/EMC)"], certifications_not_held: ["UL", "ETL", "FCC SDoC test report", "NOM"], material_tests: { PFOA: "供应商声明，无第三方报告" }, specs: { voltage_us: "120V 60Hz", power_w_us: 1400, features: ["8 presets", "digital touch panel", "60-min timer", "dishwasher-safe basket"] } } };

  // From kb/rules.json (title_zh, url and a line of the excerpt).
  const RULES = {
    "INC-01": { title: "FOB / FAS 只适用于海运和内河运输", quote: "Both apply only to sea or inland waterway transport", url: "https://academy.iccwbo.org/incoterms/article/incoterms-2020-fas-or-fob/" },
    "US-01": { title: "不得使用无限定的笼统环保宣称", quote: "marketers should not make unqualified general environmental benefit claims", url: "https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=260&section=260.4" },
    "MX-03": { title: "电器安全须符合 NOM-003-SCFI-2014", quote: "aplica a los productos eléctricos", url: "https://platiica.economia.gob.mx/wp-content/uploads/sites/2/PDF_Normas_Publicas/003scfi2015.pdf" },
    "CUL-03": { title: "称呼用 Señor/Señora 加姓", quote: "addressing them using appropriate titles like 'Señor' (Mr.) or 'Señora' (Mrs.)", url: "https://cibtvisas.com/blog/business-etiquette-mexico" },
    "EU-01": { title: "电器在欧盟上市须加贴 CE 标志（低电压指令）", quote: "The CE marking shall be affixed visibly, legibly and indelibly", url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32014L0035" },
    "EU-02": { title: "RoHS：电器不得含附件 II 所列限用物质", quote: "does not contain the substances listed in Annex II", url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011L0065" },
    "JP-01": { title: "日本：没有 PSE 标识不得销售电气用品", quote: "Without the PSE Labeling specified in the article 10 of the Act", url: "https://www.meti.go.jp/english/policy/economy/consumer/pse/" },
    "JP-02": { title: "日本：进口电器由进口商履行电气用品安全法义务", quote: "it is the importers who have the responsibility", url: "https://www.meti.go.jp/english/policy/economy/consumer/pse/" }
  };
  // EU / JP power and the JP note are from data/markets.json; the US and Mexico have no market profile there.
  const MARKETS = {
    US: { name: "美国", note: "美国：按产品卡核对" },
    MX: { name: "墨西哥", note: "墨西哥：按产品卡核对（没有 NOM）" },
    EU: { name: "欧盟（德国）", power: "230V 50Hz", note: "欧盟 230V 50Hz：这款没有登记欧盟版本" },
    JP: { name: "日本", power: "100V 50/60Hz", note: "目前只有 120V 美规版本，没有 100V 日本版本；没有 PSE 相关检测" }
  };

  // ---- scene 1: listing drafts (fictional "generic AI" output) and the hints the code rules do not cover
  const LISTING = {
    amazon_us: {
      draft: "UL Listed 4.5L smart air fryer. Eco-friendly design with a PFOA free basket. Order as few as 100 units and get guaranteed delivery in 15 days.",
      marks: ["UL Listed", "Eco-friendly", "PFOA free", "100 units", "15 days"],
      fields: (text) => ({ description: text }),
      extra: [{ sev: "red", title: "起订量写低了 · 100 units", body: (p) => `资料卡起订量 ${fmt(p.moq_units)} 件。`, facts: ["moq"] },
              { sev: "amber", title: "笼统环保宣称 · Eco-friendly", body: () => "美国 FTC 绿色指南：不能做没有限定的笼统环保宣称。", rule: "US-01" }]
    },
    tiktok_mx: {
      draft: "Freidora de aire con certificación UL. Canasta libre de PFOA. Pide desde 100 unidades y recíbela en 15 días.",
      marks: ["certificación UL", "libre de PFOA", "100 unidades", "15 días"],
      fields: (text) => ({ caption: text }),
      extra: [{ sev: "red", title: "起订量写低了 · 100 unidades", body: (p) => `资料卡起订量 ${fmt(p.moq_units)} 件。`, facts: ["moq"] },
              { sev: "amber", title: "墨西哥电器安全标准 · NOM", body: () => "资料卡没有 NOM；墨西哥电器须按 NOM-003-SCFI-2014 做合格评定。", rule: "MX-03", facts: ["notheld"] }]
    }
  };

  // ---- scene 2: one reply, four markets
  const REPLY = [["Dear John", "greet"], [", thanks for your inquiry. Yes, our air fryers are definitely "], ["UL Listed", "ul"], [" and "], ["fully certified for your market", "mkt"],
    [". We can support your request for "], ["50 units", "moq"], [", ship "], ["by air on FOB Ningbo terms", "fob"], [", and guarantee delivery by "], ["next week", "lead"], [". Best regards, Lily"]];
  const BASE = [
    { id: "ul", mark: "ul", sev: "red", title: "认证无中生有 · UL Listed", body: (p) => `资料卡没有 UL（没有的认证：${p.certifications_not_held.join("、")}）。`, facts: ["notheld"], code: "fact_cert", codeKey: "UL" },
    { id: "moq", mark: "moq", sev: "red", title: "低于起订量 · 50 units", body: (p) => `资料卡起订量 ${fmt(p.moq_units)} 件；答应 50 件，要么亏本，要么做不出来。`, facts: ["moq"] },
    { id: "fob", mark: "fob", sev: "amber", title: "贸易术语用错 · FOB 走空运", body: () => "FOB 只适用于海运和内河运输；空运要改报 FCA 等术语。", rule: "INC-01", code: "contract_incoterm", codeKey: "FOB" },
    { id: "lead", mark: "lead", sev: "amber", title: "交期说短了 · next week", body: (p, f) => `资料卡标准交期 ${fmt(f.standard_lead_time_days)} 天；具体排期要业务员按订单确认。`, facts: ["lead"] }
  ];
  const BY_MARKET = {
    US: [{ id: "us-cert", mark: "mkt", sev: "red", title: "“全认证”说过头 · 美国", body: () => "资料卡没有 UL、ETL，也没有 FCC SDoC 测试报告，不能写 fully certified。", facts: ["notheld"] }],
    MX: [{ id: "mx-nom", mark: "mkt", sev: "red", title: "墨西哥要 NOM · fully certified", body: () => "资料卡没有 NOM；墨西哥电器须按 NOM-003-SCFI-2014 做合格评定。", rule: "MX-03", facts: ["notheld"] },
         { id: "mx-greet", mark: "greet", sev: "amber", title: "称呼太随意 · Dear John", body: () => "墨西哥商务称呼用 Señor/Señora 加姓氏，除非对方表示可以直呼名字。", rule: "CUL-03" }],
    EU: [{ id: "eu-volt", mark: "mkt", sev: "red", title: "电压不对 · 欧盟 230V", body: () => "欧盟市电 230V 50Hz；资料卡只有 120V 60Hz 美规版本，没有欧盟版本。", facts: ["voltage", "market"] },
         { id: "eu-ce", mark: "mkt", sev: "amber", title: "CE 只代表所声明的指令", body: () => "资料卡的 CE 只写了 LVD/EMC，不能据此写 fully certified。", rule: "EU-01", facts: ["held"] },
         { id: "eu-rohs", mark: "mkt", sev: "amber", title: "RoHS 资料卡没登记", body: () => "欧盟电器不得含 RoHS 附件 II 限用物质；资料卡没有 RoHS 检测，回复前要确认。", rule: "EU-02" }],
    JP: [{ id: "jp-pse", mark: "mkt", sev: "red", title: "日本要 PSE · fully certified", body: () => "没有 PSE 标识的电器不得在日本销售；资料卡：没有 PSE 相关检测。", rule: "JP-01", facts: ["market", "notheld"] },
         { id: "jp-volt", mark: "mkt", sev: "red", title: "电压不对 · 日本 100V", body: () => "日本市电 100V；资料卡只有 120V 美规版本，没有 100V 日本版本。", facts: ["voltage", "market"] },
         { id: "jp-importer", mark: "mkt", sev: "amber", title: "别承诺“工厂办好 PSE”", body: () => "进口电器的 PSE 申报和标识义务由进口商承担；工厂可以配合检测、提供资料。", rule: "JP-02" }]
  };
  const CODE_LABEL = { fact_cert: "认证", fact_material: "材料宣称", fact_lead: "交期", fact_moq: "起订量", fact_price: "价格" };

  const state = { view: "business", scene: "listing", market: "US", tasks: new Set(), product: fallback.product, factory: fallback.factory, metaLoaded: false,
    listing: null, listingFixed: null, audit: false, code: null, shown: new Set(), seen: new Set(), blocked: [], rewritten: false, sent: false, run: 0, terminalTimer: null };

  // ---------------------------------------------------------------- helpers
  async function codeCheck(body) {
    try {
      const r = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: state.product.id, rules_only: true, ...body }) });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      return data;
    } catch (error) {
      console.warn("Sandbox code check unavailable:", error);
      return null;
    }
  }
  function flashFacts(keys) {
    (keys || []).forEach((key) => {
      const node = $(`[data-fact="${key}"]`);
      if (!node) return;
      node.classList.remove("sb-hit");
      void node.offsetWidth;
      node.classList.add("sb-hit");
    });
  }
  function markTask(key) {
    if (state.tasks.has(key)) return;
    state.tasks.add(key);
    $(`[data-task="${key}"]`)?.classList.add("done");
    $("#sb-progress-fill").style.width = `${state.tasks.size * 25}%`;
    $("#sb-progress-label").textContent = `${state.tasks.size} / 4 已完成`;
  }
  function highlight(text, marks) {
    let html = esc(text);
    marks.forEach((m) => { html = html.replace(esc(m), `<mark class="sb-wave">${esc(m)}</mark>`); });
    return html;
  }
  function sourceLine(item) {
    const r = item.src || (item.rule && { id: item.rule, ...RULES[item.rule] });
    if (r) {
      return `<small class="sb-src"><b>${esc(r.id)}</b> ${esc(r.title)}${r.quote ? ` · “${esc(r.quote)}”` : ""}${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">原文</a>` : ""}</small>`;
    }
    return `<small class="sb-src"><b>资料卡</b> ${esc(item.cardLabel || (item.facts || []).map((k) => FACT_NAME[k]).join("、"))}</small>`;
  }
  const FACT_NAME = { moq: "moq_units", lead: "standard_lead_time_days", held: "certifications_held", notheld: "certifications_not_held", voltage: "specs.voltage_us", market: "markets.json", material: "material_tests" };
  async function typeInto(node, text) {
    const run = state.run;
    node.textContent = "";
    if (calm()) { node.textContent = text; return; }
    node.classList.add("sb-typing");
    for (let i = 0; i < text.length; i += 3) {
      if (run !== state.run) return;
      node.textContent = text.slice(0, i + 3);
      await sleep(12);
    }
    node.classList.remove("sb-typing");
  }

  // ---------------------------------------------------------------- left rail
  function renderFacts() {
    const p = state.product, f = state.factory;
    $("#sb-factory-name").textContent = f.name_zh || "示例工厂";
    $("#sb-factory-location").textContent = `${f.city || "Ningbo"} · 本地工作台资料卡`;
    $("#sb-product-name").textContent = p.name_zh || p.name_en;
    $("#sb-product-id").textContent = p.id;
    $("#sb-moq").textContent = `${fmt(p.moq_units)} 件`;
    $("#sb-lead").textContent = `${fmt(f.standard_lead_time_days)} 天`;
    const tags = (items) => (items || []).map((x) => `<span>${esc(x)}</span>`).join("") || "<span>资料未记录</span>";
    $("#sb-held").innerHTML = tags(p.certifications_held);
    $("#sb-not-held").innerHTML = tags(p.certifications_not_held);
    $("#sb-material").textContent = Object.entries(p.material_tests || {}).map(([k, v]) => `${k}：${v}`).join("；") || "资料未记录";
    $("#sb-voltage").textContent = `${p.specs?.voltage_us || "未记录"}（美规）`;
    $("#sb-market-note").textContent = MARKETS[state.market].note;
    $("#sb-data-status").textContent = state.metaLoaded ? "已读取本地工作台资料卡" : "使用内置示例资料（本地接口未连接）";
  }

  // ---------------------------------------------------------------- views
  const MEASURED = `<ul class="sb-measured"><li><b>$0.24</b>每条询盘的模型费（回复 + 改一轮），不是节省金额</li><li><b>22.3 秒</b>一条询盘实时跑完，3 次调用</li><li><b>5 / 5</b>红队编造的提示全部被代码拦下</li><li><b>97.1%</b>第一份盲测集首次精确率（第二份 92.3%）</li></ul>`;
  function counts() {
    const items = state.blocked;
    return { red: items.filter((x) => x.sev === "red").length, amber: items.filter((x) => x.sev === "amber").length, code: items.filter((x) => x.verified).length, total: items.length };
  }
  function renderInsight() {
    const box = $("#sb-view-insight");
    const c = counts();
    if (state.view === "business") {
      box.innerHTML = `<b>算账</b>${c.total ? `本轮已拦下 <em>${c.total}</em> 条（红 ${c.red} · 黄 ${c.amber}），其中 ${c.code} 条由代码当场复核。` : "完成排雷后，这里汇总本轮拦下的问题。"}${MEASURED}<small>罚金、转化率、节省工时我们没测，不报；工作台“降本测算”可现场计时。</small>`;
    } else if (state.view === "industry") {
      const rules = [...new Set(state.blocked.filter((x) => x.rule).map((x) => x.rule))];
      box.innerHTML = `<b>外贸老法师批注</b>${rules.length ? rules.map((id) => `<p><em>${esc(id)}</em> ${esc(RULES[id].title)}</p>`).join("") : `<p>先守住资料卡底线：起订量 ${fmt(state.product.moq_units)} 件、标准交期 ${fmt(state.factory.standard_lead_time_days)} 天、认证只写卡上有的。</p>`}<small>每条批注都对应规则库里的一条规则，点卡片里的“原文”可看出处。</small>`;
    } else {
      box.innerHTML = `<b>两层校验</b><p>① 代码规则管硬事实（认证、材料、交期、平台规则），沙盒里当场真跑。</p><p>② 模型审核只拿相关规则、必须给规则编号和原文，出处对不上就丢弃；沙盒不跑这一层。</p><small>展开下方“底层校验链路”看这一轮的真实记录。</small>`;
    }
    const term = $("#sb-terminal-wrap");
    term.hidden = !state.audit;
    if (state.view === "technical" && state.audit) term.open = true;
  }

  // ---------------------------------------------------------------- scene 1
  function renderDrafts() {
    $$(".sb-channel").forEach((card) => {
      const d = LISTING[card.dataset.channel];
      $(".sb-draft", card).textContent = d.draft;
    });
  }
  function findingCard(item, extraClass = "") {
    const badge = item.verified ? '<span class="sb-tag-code">代码复核</span>' : '<span class="sb-tag-ex">规则示例</span>';
    return `<article class="sb-finding sb-${item.sev} ${extraClass}" data-facts="${esc((item.facts || []).join(" "))}"><span class="sb-finding-icon">!</span><div><b>${esc(item.title)} ${badge}</b><p>${esc(item.text)}</p>${sourceLine(item)}</div></article>`;
  }
  function fromCode(f) {
    const s = f.source || {};
    const label = CODE_LABEL[f.check] || s.title_zh || "规则";
    const facts = { fact_cert: ["notheld"], fact_material: ["material"], fact_lead: ["lead"], fact_moq: ["moq"], fact_price: ["moq"] }[f.check] || [];
    return { sev: f.severity === "red" ? "red" : "amber", title: `${label} · ${f.quote ? String(f.quote).slice(0, 40) : f.field || ""}`, text: [f.problem_zh, f.suggestion_zh].filter(Boolean).join("。"),
      facts, verified: true, check: f.check, rule: s.rule_id || null,
      src: s.rule_id ? { id: s.rule_id, title: s.title_zh || "", quote: String(s.excerpt || "").slice(0, 90), url: s.url } : null, cardLabel: s.label_zh };
  }
  async function runListing() {
    const btn = $("#sb-listing-run");
    if (state.listing) return;
    btn.disabled = true; btn.textContent = "正在排雷…";
    $$(".sb-channel").forEach((card) => card.classList.add("sb-scan"));
    const results = {};
    for (const [platform, d] of Object.entries(LISTING)) results[platform] = await codeCheck({ platform, fields: d.fields(d.draft) });
    await sleep(calm() ? 0 : 900);
    state.listing = results;
    $$(".sb-channel").forEach((card) => {
      const platform = card.dataset.channel, d = LISTING[platform], res = results[platform];
      card.classList.remove("sb-scan"); card.classList.add("scanned");
      $(".sb-draft", card).innerHTML = highlight(d.draft, d.marks);
      const code = (res?.findings || []).map(fromCode);
      const codeRules = new Set(code.map((x) => x.rule).filter(Boolean)), codeChecks = new Set(code.map((x) => x.check));
      const extra = d.extra.filter((x) => !(x.rule && codeRules.has(x.rule)) && !((x.facts || []).includes("moq") && codeChecks.has("fact_moq")))
        .map((x) => ({ ...x, text: x.body(state.product, state.factory), verified: false }));
      const items = [...code, ...extra];
      state.blocked.push(...items);
      const out = $(".sb-listing-result", card);
      out.hidden = false;
      out.innerHTML = `<div class="sb-findings">${items.map((x, i) => findingCard(x, "sb-in").replace("<article", `<article style="animation-delay:${i * 90}ms"`)).join("")}</div>${res ? "" : '<p class="sb-helper">代码复核没连上本地服务：只显示规则示例。</p>'}`;
      items.forEach((x) => flashFacts(x.facts));
    });
    $("#sb-listing-chat").hidden = false;
    $("#sb-listing-state").textContent = "已完成排雷";
    btn.textContent = "排雷完成";
    markTask("listing");
    renderInsight();
  }
  function safeListing(platform) {
    const p = state.product, f = state.factory, held = p.certifications_held || [];
    if (platform === "amazon_us") {
      return `${p.name_en}. Features on the product card: ${(p.specs?.features || []).join(", ")}. Certifications on file: ${held.join(" and ")}. MOQ ${fmt(p.moq_units)} units; standard lead time ${fmt(f.standard_lead_time_days)} days, confirmed per order.`;
    }
    return `Freidora de aire digital de 4,5 L: 8 programas, panel táctil, temporizador de 60 min y canasta apta para lavavajillas. Certificaciones registradas: ${held.join(" y ")}. Pedido mínimo: ${fmt(p.moq_units)} unidades; plazo estándar: ${fmt(f.standard_lead_time_days)} días, sujeto a confirmación.`;
  }
  async function fixListing() {
    const btn = $("#sb-listing-fix");
    btn.disabled = true; btn.textContent = "改写中…";
    const grid = $("#sb-safe-listings");
    grid.innerHTML = Object.keys(LISTING).map((platform) => `<article class="sb-safe-card"><h4>${platform === "amazon_us" ? "Amazon 美国站 · EN" : "TikTok Shop 墨西哥 · ES"} · 按资料卡改写</h4><p data-safe="${platform}"></p><small class="sb-recheck" data-recheck="${platform}">等待复查…</small></article>`).join("");
    for (const platform of Object.keys(LISTING)) await typeInto($(`[data-safe="${platform}"]`), safeListing(platform));
    let clean = 0;
    for (const [platform, d] of Object.entries(LISTING)) {
      const res = await codeCheck({ platform, fields: d.fields(safeListing(platform)) });
      const node = $(`[data-recheck="${platform}"]`);
      if (!res) { node.textContent = "代码复查没连上本地服务"; continue; }
      const n = res.findings.length;
      if (!n) clean++;
      node.innerHTML = n ? `代码规则复查：还有 ${n} 条 · ${esc(res.findings.map((x) => x.problem_zh).join("；"))}` : "✓ 代码规则复查：0 条问题（模型审核没跑，所以不显示绿色）";
      node.classList.toggle("ok", !n);
    }
    $("#sb-listing-recheck").textContent = `复查 ${clean} / 2 通过`;
    btn.textContent = "已改写并复查";
  }

  // ---------------------------------------------------------------- scene 2
  function marketItems() { return [...BASE, ...BY_MARKET[state.market]]; }
  function renderReply(activeMarks) {
    $("#sb-bad-reply").innerHTML = REPLY.map(([text, key]) => key && activeMarks.has(key) ? `<mark class="sb-wave" data-mark="${key}">${esc(text)}</mark>` : esc(text)).join("");
  }
  function verify(item) {
    const hits = state.code?.findings || [];
    return !!item.code && hits.some((h) => h.check === item.code && String(h.problem_zh || "").includes(item.codeKey || ""));
  }
  async function runAudit(fromMarketChange = false) {
    const btn = $("#sb-audit-run");
    if (!fromMarketChange) {
      if (state.audit) return;
      btn.disabled = true; btn.textContent = "正在排雷…";
      $("#sb-inquiry-card").classList.add("sb-scan");
    }
    const text = REPLY.map(([t]) => t).join("");
    state.code = await codeCheck({ platform: "alibaba_rfq", market: state.market, text });
    if (!fromMarketChange) await sleep(calm() ? 0 : 900);
    $("#sb-inquiry-card").classList.remove("sb-scan");
    const items = marketItems().map((x) => ({ ...x, text: x.body(state.product, state.factory), verified: verify(x) }));
    const known = new Set(items.filter((x) => x.verified).map((x) => x.code));
    const extraCode = (state.code?.findings || []).filter((h) => !known.has(h.check)).map(fromCode);
    const all = [...items, ...extraCode];
    const before = new Set(state.shown);
    const added = all.filter((x) => x.id && !before.has(x.id));
    state.shown = new Set(all.map((x) => x.id).filter(Boolean));
    state.seen.add(state.market);
    all.forEach((x) => { if (!state.blocked.some((b) => b.title === x.title)) state.blocked.push({ ...x, market: state.market }); });
    renderReply(new Set(all.map((x) => x.mark).filter(Boolean)));
    const box = $("#sb-findings");
    box.hidden = false;
    box.innerHTML = all.map((x, i) => findingCard(x, `sb-in ${fromMarketChange && added.includes(x) ? "sb-new" : ""}`).replace("<article", `<article style="animation-delay:${i * 80}ms"`)).join("")
      + (state.code ? "" : '<p class="sb-helper">代码复核没连上本地服务：只显示规则示例。</p>');
    all.forEach((x) => flashFacts(x.facts));
    if (fromMarketChange) {
      const bubble = $("#sb-market-bubble");
      bubble.hidden = false;
      bubble.innerHTML = `同一段英文，发往<b>${esc(MARKETS[state.market].name)}</b>：${added.length ? `新增 ${added.length} 条（${esc(added.map((x) => x.title.split(" · ")[0]).join("、"))}）` : "通用承诺的雷都还在"}。`;
      bubble.classList.remove("sb-pop"); void bubble.offsetWidth; bubble.classList.add("sb-pop");
    }
    state.audit = true;
    $("#sb-copilot").hidden = false;
    $("#sb-inquiry-state").textContent = `${MARKETS[state.market].name}：拦下 ${all.length} 条`;
    btn.textContent = "排雷完成"; btn.disabled = true;
    markTask("risk");
    renderPrompts();
    renderInsight();
    renderTerminal(text);
  }
  function renderMarket() {
    const m = MARKETS[state.market];
    $("#sb-market-scope").textContent = `当前审查规则：${m.name}`;
    $("#sb-market-detail").innerHTML = {
      US: "资料卡没有 UL、ETL、FCC SDoC 测试报告；美国站按产品卡核对认证、起订量和交期。",
      MX: "资料卡没有 NOM；墨西哥电器按 NOM-003-SCFI-2014 合格评定，包装和说明书要西班牙语；商务称呼用 Señor/Señora 加姓。",
      EU: `市电 ${m.power}；资料卡 CE 只写了 LVD/EMC，没有 RoHS 检测，没有欧盟版本。`,
      JP: `市电 ${m.power}；${m.note}。进口商负责 PSE 申报和标识。`
    }[state.market];
    $("#sb-market-note").textContent = m.note;
    flashFacts(["market"]);
  }
  function renderTerminal(text) {
    const p = state.product, c = state.code;
    const lines = [
      `> [资料卡] GET /api/meta → ${p.id}：MOQ ${p.moq_units} · 交期 ${state.factory.standard_lead_time_days} 天 · 没有的认证 ${p.certifications_not_held.join(", ")}`,
      `> [代码规则] POST /api/check rules_only=true market=${state.market} · ${text.length} 字符`,
      c ? `> [代码规则] 命中 ${c.findings.length} 条：${c.findings.map((f) => `${f.check}(${f.severity}) ${String(f.problem_zh || "").slice(0, 28)}`).join(" | ") || "无"}` : "> [代码规则] 本地服务没连上，未复核",
      c ? `> [规则库] 本市场相关规则 ${c.rules_checked.length} 条：${c.rules_checked.slice(0, 12).join(", ")}${c.rules_checked.length > 12 ? " …" : ""}` : "",
      c?.review_skipped ? `> [模型审核] 沙盒不运行；工作台里由模型按 ${c.review_skipped.rules.join(", ")} 审核` : "",
      "> [出处守卫] 模型提示必须带规则编号、原文对得上，否则丢弃",
      c ? `> [结果] 风险 = ${c.risk}（模型没跑，结果不会显示绿色）` : "",
      "> [边界] 模型调用 0 · 外发邮件 0"
    ].filter(Boolean);
    const pre = $("#sb-terminal-log");
    clearInterval(state.terminalTimer);
    pre.textContent = "";
    if (calm()) { pre.textContent = lines.join("\n"); return; }
    let i = 0;
    state.terminalTimer = setInterval(() => {
      pre.textContent += (i ? "\n" : "") + lines[i];
      if (++i >= lines.length) clearInterval(state.terminalTimer);
    }, 160);
  }
  const SAFE_REPLY = {
    US: (p, f) => `Dear John, thank you for your inquiry. Our standard MOQ for this air fryer is ${fmt(p.moq_units)} units, so we cannot confirm 50 units; a ${fmt(p.moq_units)}-unit trial order is the smallest run we can quote. Certifications on file: ${p.certifications_held.join(" and ")}. UL and ETL are not on file, so we cannot claim them. We quote FOB Ningbo for sea freight; for air freight we can quote FCA. Standard lead time is ${fmt(f.standard_lead_time_days)} days, confirmed against your order. Best regards, Lily`,
    MX: (p, f) => `Dear Mr. Miller, thank you for your inquiry. Our standard MOQ is ${fmt(p.moq_units)} units, so we cannot confirm 50 units. Certifications on file: ${p.certifications_held.join(" and ")}; NOM is not on file, so testing to NOM-003-SCFI-2014 would be needed before shipping to Mexico. We quote FOB Ningbo for sea freight, or FCA for air. Standard lead time is ${fmt(f.standard_lead_time_days)} days, confirmed against your order. Best regards, Lily`,
    EU: (p, f) => `Dear John, thank you for your inquiry. Our standard MOQ is ${fmt(p.moq_units)} units, so we cannot confirm 50 units. The current model is a 120V 60Hz US version; there is no 230V EU version on file yet. Our CE covers the declared LVD/EMC directives, and RoHS testing still needs to be confirmed. We quote FOB Ningbo for sea freight, or FCA for air. Standard lead time is ${fmt(f.standard_lead_time_days)} days once the EU version is confirmed. Best regards, Lily`,
    JP: (p, f) => `Dear John, thank you for your inquiry. Our standard MOQ is ${fmt(p.moq_units)} units, so we cannot confirm 50 units. The current model is a 120V US version without PSE testing, so it cannot be sold in Japan as is. A 100V version and PSE would be needed; the importer handles the PSE notification, and we can support testing and documents. We quote FOB Ningbo for sea freight, or FCA for air. Lead time will be confirmed after the Japanese version is defined. Best regards, Lily`
  };
  function renderPrompts() {
    const name = MARKETS[state.market].name;
    $("#sb-inquiry-prompts").innerHTML = [`【${name}】客户要 50 件：按资料卡拒绝，但给个台阶`, `【${name}】认证只写资料卡上有的，缺的写明待确认`]
      .map((t) => `<button type="button" class="sb-prompt" data-ask="${esc(t)}">👉 ${esc(t)}</button>`).join("");
    $$("#sb-inquiry-prompts [data-ask]").forEach((b) => b.addEventListener("click", () => rewrite(b.dataset.ask)));
  }
  async function rewrite(ask) {
    const history = $("#sb-chat-history");
    history.insertAdjacentHTML("beforeend", `<div class="sb-message user sb-in"><span class="sb-message-label">业务员</span>${esc(ask)}</div>`);
    const bot = document.createElement("div");
    bot.className = "sb-message assistant sb-in";
    bot.innerHTML = '<span class="sb-message-label">TradeDesk · 按资料卡改稿</span><span class="sb-dots"><i></i><i></i><i></i></span><span class="sb-out"></span><small class="sb-recheck">等待复查…</small>';
    history.appendChild(bot);
    history.scrollTop = history.scrollHeight;
    flashFacts(["moq", "held", "notheld", "lead"]);
    await sleep(calm() ? 0 : 700);
    $(".sb-dots", bot).remove();
    const text = SAFE_REPLY[state.market](state.product, state.factory);
    await typeInto($(".sb-out", bot), text);
    const res = await codeCheck({ platform: "alibaba_rfq", market: state.market, text });
    const note = $(".sb-recheck", bot);
    if (!res) note.textContent = "代码复查没连上本地服务";
    else if (!res.findings.length) { note.textContent = "✓ 代码规则复查：0 条问题（模型审核没跑，所以不显示绿色）"; note.classList.add("ok"); }
    else note.textContent = `代码规则复查：还有 ${res.findings.length} 条 · ${res.findings.map((x) => x.problem_zh).join("；")}`;
    $("#sb-reply-recheck").textContent = res && !res.findings.length ? "复查 0 条问题" : "已改稿";
    state.rewritten = true;
    $("#sb-simulate-send").disabled = state.sent;
    $("#sb-inquiry-state").textContent = "改稿已复查";
    history.scrollTop = history.scrollHeight;
  }
  async function simulateSend() {
    if (!state.rewritten || state.sent) return;
    state.sent = true;
    $("#sb-simulate-send").disabled = true;
    $("#sb-simulate-send").textContent = "已模拟发送";
    const plane = $("#sb-plane");
    plane.classList.remove("go"); void plane.offsetWidth; plane.classList.add("go");
    const history = $("#sb-chat-history");
    const reply = document.createElement("div");
    reply.className = "sb-message customer sb-in";
    reply.innerHTML = '<span class="sb-message-label">虚构的客户回复 · 不代表真实成交</span><span class="sb-dots"><i></i><i></i><i></i></span>';
    history.appendChild(reply);
    history.scrollTop = history.scrollHeight;
    await sleep(calm() ? 0 : 1600);
    reply.innerHTML = `<span class="sb-message-label">虚构的客户回复 · 不代表真实成交</span>Thanks for the clear answer on MOQ and certifications. We can review a ${fmt(state.product.moq_units)}-unit trial order on sea-freight terms. Please send the PI.`;
    markTask("rewrite");
    if (state.tasks.size < 4) {
      $("#sb-inquiry-state").textContent = `还差 ${4 - state.tasks.size} 个任务`;
      return;
    }
    await sleep(calm() ? 0 : 1200);
    showFinal();
  }

  // ---------------------------------------------------------------- finale
  function confetti() {
    if (calm()) return;
    const box = $("#sb-confetti");
    box.innerHTML = Array.from({ length: 36 }, (_, i) => `<i style="left:${(i * 2.8 + 2) % 100}%;animation-delay:${(i % 9) * 0.06}s;background:${["#48e2db", "#74a0ff", "#b795ff", "#fbbf24", "#4ade80"][i % 5]}"></i>`).join("");
    box.classList.remove("go"); void box.offsetWidth; box.classList.add("go");
  }
  function finalBody(view) {
    const c = counts();
    if (view === "business") {
      const bars = [["通用 AI 只看询盘", 32, "8 / 8 条带红，共 32 处红色问题", "r"], ["贴上工厂资料", 20, "0 红，仍有 20 处待确认", "a"], ["TradeDesk 改一轮", 8, "8 处待确认，3 / 8 条可直接发", "g"]];
      return `<div class="sb-final-grid"><div><h4>同样 8 条询盘，要人工处理的问题处数</h4>${bars.map(([k, v, d, cls]) => `<div class="sb-bar"><span>${k}</span><div><i class="${cls}" style="--w:${v / 32 * 100}%"></i></div><b>${v}</b><small>${d}</small></div>`).join("")}<small class="sb-cite">出处：app/eval/baseline_run.json</small></div>
        <div><h4>这一轮你拦下了</h4><div class="sb-big">${c.total}<small> 条 · 红 ${c.red} · 黄 ${c.amber} · 代码复核 ${c.code}</small></div>${MEASURED}<small class="sb-cite">罚金、转化率、节省工时没测，不报。</small></div></div>`;
    }
    if (view === "industry") {
      const phrases = ["UL Listed", "fully certified", "50 units", "FOB by air", "next week", "Eco-friendly", "PFOA free"];
      const visited = [...state.seen].map((m) => MARKETS[m].name).join("、") || "美国";
      return `<div class="sb-final-grid"><div><h4>这一轮避开的雷（${esc(visited)}）</h4><ul class="sb-final-list">${state.blocked.slice(0, 9).map((x) => `<li class="${x.sev}">${esc(x.title)}${x.rule ? ` <em>${esc(x.rule)}</em>` : ""}</li>`).join("")}</ul></div>
        <div><h4>发出前最贵的几个词</h4><div class="sb-xwords">${phrases.map((p) => `<span>${esc(p)}</span>`).join("")}</div><p>通用 AI 会写，但它不知道你没有 UL、起订量 ${fmt(state.product.moq_units)} 件、FOB 不能走空运。TradeDesk 把这些底线变成发出前的一道关。</p></div></div>`;
    }
    return `<div class="sb-final-grid"><div><h4>三层校验</h4><ol class="sb-layers"><li><b>代码规则</b>价格、起订量、交期、认证、付款、FOB、标题长度、禁用词：硬事实只认代码</li><li><b>模型审核</b>只拿相关规则，必须给规则编号和原文</li><li><b>出处守卫</b>编号不存在、原文对不上 → 丢弃；审核没跑，结果不显示绿色</li></ol></div>
      <div><h4>可以核对的数</h4><ul class="sb-measured"><li><b>61 条</b>带出处的规则，17 类，每条附原文和链接</li><li><b>6 个</b>智能体按工作流编排，配置可导出</li><li><b>5 / 5</b>红队编造的提示全部被代码拦下</li></ul><small class="sb-cite">沙盒里只跑了第一层；工作台三层都跑。</small></div></div>`;
  }
  function setFinalView(view) {
    $$("[data-final]").forEach((b) => b.classList.toggle("on", b.dataset.final === view));
    $("#sb-final-body").innerHTML = finalBody(view);
  }
  function showFinal() {
    confetti();
    setFinalView(state.view);
    $("#sb-final").hidden = false;
    requestAnimationFrame(() => $("#sb-final").classList.add("on"));
  }

  // ---------------------------------------------------------------- wiring
  function setView(view) {
    state.view = view;
    $$("[data-view]").forEach((b) => { const on = b.dataset.view === view; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    renderInsight();
  }
  function setScene(scene) {
    state.scene = scene;
    $$("[data-scene]").forEach((b) => { const on = b.dataset.scene === scene; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    $$(".sb-scene").forEach((panel) => { const on = panel.id === `sb-scene-${scene}`; panel.classList.toggle("on", on); panel.hidden = !on; });
  }
  function reset() {
    state.run++;
    clearInterval(state.terminalTimer);
    Object.assign(state, { market: "US", listing: null, audit: false, code: null, shown: new Set(), seen: new Set(), blocked: [], rewritten: false, sent: false });
    state.tasks.clear();
    $$("#sb-task-list li").forEach((li) => li.classList.remove("done"));
    $("#sb-progress-fill").style.width = "0%";
    $("#sb-progress-label").textContent = "0 / 4 已完成";
    $$(".sb-channel").forEach((card) => { card.classList.remove("scanned", "sb-scan"); const out = $(".sb-listing-result", card); out.hidden = true; out.innerHTML = ""; });
    renderDrafts();
    $("#sb-listing-run").disabled = false; $("#sb-listing-run").textContent = "🚀 启动 TradeDesk 排雷";
    $("#sb-listing-state").textContent = "等待启动";
    $("#sb-listing-chat").hidden = true; $("#sb-safe-listings").innerHTML = "";
    $("#sb-listing-fix").disabled = false; $("#sb-listing-fix").textContent = "✨ 按资料卡改写并复查";
    $("#sb-listing-recheck").textContent = "等待复查";
    $("#sb-market").value = "US";
    renderReply(new Set());
    $("#sb-findings").hidden = true; $("#sb-findings").innerHTML = "";
    $("#sb-market-bubble").hidden = true;
    $("#sb-terminal-wrap").hidden = true; $("#sb-terminal-wrap").open = false; $("#sb-terminal-log").textContent = "";
    $("#sb-copilot").hidden = true; $("#sb-chat-history").innerHTML = "";
    $("#sb-simulate-send").disabled = true; $("#sb-simulate-send").textContent = "📩 模拟发送给客户";
    $("#sb-reply-recheck").textContent = "资料卡约束";
    $("#sb-audit-run").disabled = false; $("#sb-audit-run").textContent = "🛡️ 启动 TradeDesk 排雷";
    $("#sb-inquiry-state").textContent = "等待检查";
    $("#sb-final").classList.remove("on"); $("#sb-final").hidden = true;
    if ($("#sb-team").open) $("#sb-team").close();
    setView("business"); setScene("listing"); renderMarket(); renderFacts();
    window.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
  }

  $("#sb-listing-run").addEventListener("click", runListing);
  $("#sb-listing-fix").addEventListener("click", fixListing);
  $("#sb-audit-run").addEventListener("click", () => runAudit(false));
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  $$("[data-scene]").forEach((b) => b.addEventListener("click", () => setScene(b.dataset.scene)));
  $("#sb-market").addEventListener("change", (event) => {
    state.market = event.target.value;
    renderMarket();
    if (state.market !== "US") markTask("market");
    if (state.audit) runAudit(true);
    if (state.audit) renderPrompts();
  });
  $("#sb-findings").addEventListener("mouseover", (event) => { const card = event.target.closest("[data-facts]"); if (card) flashFacts(card.dataset.facts.split(" ")); });
  $("#sb-simulate-send").addEventListener("click", simulateSend);
  $("#sb-reset").addEventListener("click", reset);
  $("#sb-final-reset").addEventListener("click", reset);
  $$("[data-final]").forEach((b) => b.addEventListener("click", () => setFinalView(b.dataset.final)));
  $("#sb-team-open").addEventListener("click", () => $("#sb-team").showModal());
  $("#sb-team-close").addEventListener("click", () => $("#sb-team").close());
  $("#sb-task-toggle").addEventListener("click", (event) => {
    const list = $("#sb-task-list"), collapsed = !list.hidden;
    list.hidden = collapsed;
    event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    event.currentTarget.textContent = collapsed ? "展开" : "收起";
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#sb-final").hidden) reset(); });

  async function boot() {
    renderDrafts(); renderReply(new Set()); renderMarket(); renderFacts(); renderInsight();
    try {
      const r = await fetch("/api/meta", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const meta = await r.json();
      state.product = (meta.products || []).find((p) => p.id === fallback.product.id) || fallback.product;
      state.factory = meta.factory || fallback.factory;
      state.metaLoaded = true;
    } catch (error) {
      console.warn("Sandbox is using its built-in facts:", error);
    }
    renderFacts(); renderInsight();
  }
  boot();
})();
