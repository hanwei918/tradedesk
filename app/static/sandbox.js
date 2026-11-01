"use strict";
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const state = { view: "business", scene: "listing", tasks: new Set(), market: "US", product: null, factory: null, metaLoaded: false, scanned: false, audit: false, response: false, sent: false, sequence: 0, timer: null };
  const fallback = { factory: { name_zh: "甬江小家电（示例工厂）", city: "Ningbo", standard_lead_time_days: 35 }, product: { id: "AF-45D", name_zh: "4.5L 数显空气炸锅", name_en: "4.5L Digital Air Fryer", moq_units: 1000, certifications_held: ["CB report (IEC 60335-2-9)", "CE (LVD/EMC)"], certifications_not_held: ["UL", "ETL", "FCC SDoC test report", "NOM"], specs: { voltage_us: "120V 60Hz", power_w_us: 1400 }, selling_points_zh: ["8 个预设菜单", "触摸数显", "篮子可进洗碗机", "少油烹饪"] } };
  const viewCopy = {
    business: { title: "本轮结果", body: () => state.tasks.has("risk") ? `已提示 ${state.conflictCount || 3} 项资料不符或待确认点；本 Sandbox 未估算罚金、转化率或投资回报。` : "完成演练后，这里汇总本次识别的资料冲突；不虚构罚金或 ROI。" },
    industry: { title: "业务员关注点", body: () => `先守住资料卡底线：MOQ ${fmt(state.product?.moq_units)} 件、标准交期 ${fmt(state.factory?.standard_lead_time_days)} 天；认证按卡片已登记项表达。` },
    technical: { title: "实现边界", body: () => "当前页读取本地 /api/meta，并运行固定演示脚本；不调用 LLM、RAG、向量检索或邮件服务。工作台里的同类检查由代码规则 + 模型审核完成：把同一段文字贴进「文案体检」可看真实结果。" }
  };

  function fmt(value) { return Number(value || 0).toLocaleString("zh-CN"); }
  function setText(selector, value) { const node = $(selector); if (node) node.textContent = value; }
  function getProduct(meta) { return (meta.products || []).find((item) => item.id === "AF-45D") || (meta.products || [])[0] || fallback.product; }
  function setProduct(meta) { state.product = getProduct(meta); state.factory = meta.factory || fallback.factory; }

  function renderFacts() {
    const product = state.product || fallback.product;
    const factory = state.factory || fallback.factory;
    setText("#sb-factory-name", factory.name_zh || "示例工厂");
    setText("#sb-factory-location", `${factory.city || ""} · 本地工作台资料卡`);
    setText("#sb-product-name", product.name_zh || product.name_en || "演示产品");
    setText("#sb-product-id", product.id || "");
    setText("#sb-moq", `${fmt(product.moq_units)} 件`);
    setText("#sb-lead", `${fmt(factory.standard_lead_time_days)} 天`);
    const renderTags = (items) => (items || []).length ? items.map((item) => `<span>${esc(item)}</span>`).join("") : "<span>资料未记录</span>";
    $("#sb-held").innerHTML = renderTags(product.certifications_held);
    $("#sb-not-held").innerHTML = renderTags(product.certifications_not_held);
    setText("#sb-data-status", state.metaLoaded ? "已读取本地工作台资料" : "使用内置示例资料（本地接口未连接）");
    renderInsight();
    renderMarket();
  }

  function renderInsight() {
    const copy = viewCopy[state.view];
    $("#sb-view-insight").innerHTML = `<b>${esc(copy.title)}</b>${esc(copy.body())}`;
    $("#sb-terminal-wrap").hidden = !state.audit || state.view !== "technical";
    if (state.audit && state.view === "technical") renderTrace();
  }

  function markTask(key) {
    state.tasks.add(key);
    $(`[data-task="${key}"]`)?.classList.add("done");
    $("#sb-progress-fill").style.width = `${state.tasks.size * 25}%`;
    setText("#sb-progress-label", `${state.tasks.size} / 4 已完成`);
    renderInsight();
  }

  function renderMarket() {
    const detail = {
      US: `按工厂卡核对认证与数量。${state.product?.certifications_not_held?.includes("UL") ? "当前资料卡未登记 UL。" : "认证字段以当前产品卡为准。"}`,
      MX: "资料卡未提供该产品的墨西哥电压版本信息；本演示只核对已登记的产品事实，市场适配需人工确认。",
      EU: "当前示例资料未为该产品登记欧盟版本规格；不把未核实的法规或文化判断当成结论。",
      JP: "市场资料注明：该产品当前为 120V 美规版本，未登记 PSE；日本版本适配需先由工厂确认。"
    }[state.market];
    const label = { US: "美国", MX: "墨西哥", EU: "欧盟（德国）", JP: "日本" }[state.market];
    setText("#sb-market-scope", `资料核对范围：${label} · 产品字段及已配置市场资料`);
    $("#sb-market-detail").textContent = detail;
    if (state.audit) renderFindings();
  }

  function renderFindings() {
    const p = state.product || fallback.product;
    const f = state.factory || fallback.factory;
    const facts = [
      { title: "认证承诺与资料卡不符", claim: "UL Listed", evidence: `产品卡已登记：${(p.certifications_held || []).join("、") || "无"}；未登记：${(p.certifications_not_held || []).join("、") || "无"}。`, quote: "资料来源：当前产品资料卡 certifications_held / certifications_not_held。" },
      { title: "数量低于最低起订量", claim: "50 units", evidence: `询盘提及 50 件；产品卡 MOQ 为 ${fmt(p.moq_units)} 件。`, quote: "资料来源：当前产品资料卡 moq_units。" },
      { title: "交期短于标准交期", claim: "next week", evidence: `稿件承诺下周交付；工厂资料卡标准交期为 ${fmt(f.standard_lead_time_days)} 天。`, quote: "标准交期不等于针对具体订单的确认日期，需业务员复核排产。" }
    ];
    if (state.market === "JP") facts.push({ title: "目标市场资料需补齐", claim: "日本", evidence: "市场资料记录为 120V 美规版本，未登记 PSE；不能据此承诺日本市场适配。", quote: "资料来源：app/data/markets.json 中 AF-45D 的市场备注。" });
    if (state.market === "MX" || state.market === "EU") facts.push({ title: "市场规格尚待人工确认", claim: state.market === "MX" ? "墨西哥" : "欧盟（德国）", evidence: "当前示例未提供该产品对应市场版本的完整规格资料。", quote: "本页仅展示资料缺口，不推断具体法规结论。" });
    state.conflictCount = facts.length;
    $("#sb-findings").innerHTML = facts.map((item) => `<article class="sb-finding"><span class="sb-finding-icon">!</span><div><b>${esc(item.title)} · ${esc(item.claim)}</b><p>${esc(item.evidence)}</p><small>${esc(item.quote)}</small></div></article>`).join("");
  }

  function renderTrace() {
    const p = state.product || fallback.product;
    const f = state.factory || fallback.factory;
    const lines = [
      "[LOCAL DEMO] GET /api/meta -> 本地产品资料已读取",
      `[FACT CHECK] claim=UL Listed -> held=${(p.certifications_held || []).join(", ")} -> not_held=${(p.certifications_not_held || []).join(", ")}`,
      `[FACT CHECK] requested_qty=50 -> MOQ=${p.moq_units} -> mismatch=${50 < p.moq_units}`,
      `[FACT CHECK] claimed_delivery=next week -> standard_lead=${f.standard_lead_time_days} days -> manual_review=true`,
      `[MARKET SCOPE] market=${state.market} -> ${state.market === "US" ? "product facts only" : "configured product-market notes shown; unsupported claims excluded"}`,
      "[BOUNDARY] external LLM calls=0 | email sends=0 | vector search=0"
    ];
    $("#sb-terminal-log").textContent = lines.join("\n");
  }

  function safeListingCards() {
    const p = state.product || fallback.product;
    const held = (p.certifications_held || []).join(" and ");
    const en = `${p.name_en || p.name_zh}. Features listed on the product card include eight presets, a digital touch panel, a 60-minute timer and a dishwasher-safe basket. Factory MOQ: ${fmt(p.moq_units)} units. Standard lead time: ${fmt(state.factory?.standard_lead_time_days)} days; confirm the order schedule with the factory. Certification records: ${held}.`;
    const es = `${p.name_es || "Freidora de aire digital de 4,5 L"}. Disfruta de sus funciones registradas: 8 programas, panel táctil y cesta apta para lavavajillas. Pedido mínimo: ${fmt(p.moq_units)} unidades. Plazo estándar de producción: ${fmt(state.factory?.standard_lead_time_days)} días, sujeto a confirmación del pedido. Certificaciones registradas: ${(p.certifications_held || []).join(" y ")}.`;
    $("#sb-safe-listings").innerHTML = `<article class="sb-safe-card"><h4>Amazon US · EN · 本地固定模板</h4><p>${esc(en)}</p></article><article class="sb-safe-card"><h4>TikTok Shop MX · ES · 本地固定模板</h4><p>${esc(es)}</p></article>`;
  }

  function runListing() {
    if (state.scanned) return;
    const btn = $("#sb-listing-run");
    btn.disabled = true;
    btn.textContent = "正在读取资料字段…";
    $$(".sb-channel").forEach((node) => node.classList.add("scanned"));
    state.timer = setTimeout(() => {
      state.timer = null;
      state.scanned = true;
      markTask("listing");
      $$(".sb-listing-result").forEach((node) => {
        node.hidden = false;
        const findings = ["UL 未在认证资料中登记", "100 件低于 MOQ", "15 天短于标准交期"];
        node.innerHTML = `<div class="sb-risk-list">${findings.map((line) => `<div class="sb-risk-line"><b>需修正</b><span>${esc(line)}</span></div>`).join("")}</div><div class="sb-safe-listing"><span class="sb-copy-label">资料卡约束后的固定预览</span><p>真实规格、功能与已登记认证；MOQ 和标准交期按工厂资料填写，具体订单时间待确认。</p></div>`;
      });
      $("#sb-listing-disclaimer").hidden = false;
      $("#sb-listing-chat").hidden = false;
      setText("#sb-listing-state", "已完成资料对照");
      btn.textContent = "资料对照已完成";
      safeListingCards();
    }, 550);
  }

  function safeReply() {
    const p = state.product || fallback.product;
    const f = state.factory || fallback.factory;
    if (state.market === "JP") return `Dear John, thank you for your inquiry. Our current product information lists a 120V version and does not list PSE certification. We cannot confirm Japanese-market suitability until the factory verifies the required version and documentation. The standard MOQ is ${fmt(p.moq_units)} units and the standard lead time is ${fmt(f.standard_lead_time_days)} days; both are subject to order confirmation.`;
    return `Dear John, thank you for your inquiry. Our standard MOQ for this model is ${fmt(p.moq_units)} units, so we cannot confirm an order for 50 units. Our product records list ${((p.certifications_held || []).slice(0, 2)).join(" and ")}; UL is not listed in the factory records. The standard lead time is ${fmt(f.standard_lead_time_days)} days, with the schedule to be confirmed against the order. We would be glad to discuss a quantity that meets the MOQ. Best regards.`;
  }

  async function typeText(node, text) {
    const token = ++state.sequence;
    node.textContent = "";
    node.classList.add("sb-typing");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { node.textContent = text; node.classList.remove("sb-typing"); return; }
    for (let i = 0; i < text.length; i++) {
      if (token !== state.sequence) return;
      node.textContent += text[i];
      if (i % 3 === 2) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    node.classList.remove("sb-typing");
  }

  async function sendInstruction(instruction) {
    const text = instruction.trim();
    if (!text) return;
    const history = $("#sb-chat-history");
    const user = document.createElement("div");
    user.className = "sb-message user";
    user.innerHTML = `<span class="sb-message-label">演示指令</span>${esc(text)}`;
    history.appendChild(user);
    const assistant = document.createElement("div");
    assistant.className = "sb-message assistant";
    assistant.innerHTML = '<span class="sb-message-label">固定本地模板预览</span><span></span>';
    history.appendChild(assistant);
    $("#sb-inquiry-input").value = "";
    await typeText($("span:last-child", assistant), safeReply());
    if (!history.contains(assistant)) return;
    state.response = true;
    markTask("rewrite");
    $("#sb-simulate-send").disabled = false;
    setText("#sb-inquiry-state", "安全回复已预览");
    history.scrollTop = history.scrollHeight;
  }

  function runAudit() {
    if (state.audit) return;
    state.audit = true;
    markTask("risk");
    renderFindings();
    $("#sb-findings").hidden = false;
    $("#sb-terminal-wrap").hidden = state.view !== "technical";
    $("#sb-copilot").hidden = false;
    setText("#sb-inquiry-state", "发现资料冲突");
    $("#sb-audit-run").textContent = "核对完成";
    $("#sb-audit-run").disabled = true;
    renderInsight();
    if (state.view === "technical") renderTrace();
  }

  function setView(view) {
    state.view = view;
    $$("[data-view]").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("on", active);
      button.setAttribute("aria-selected", String(active));
    });
    renderInsight();
  }

  function setScene(scene) {
    state.scene = scene;
    $$("[data-scene]").forEach((button) => {
      const active = button.dataset.scene === scene;
      button.classList.toggle("on", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$(".sb-scene").forEach((panel) => {
      const active = panel.id === `sb-scene-${scene}`;
      panel.classList.toggle("on", active);
      panel.hidden = !active;
    });
    renderInsight();
  }

  function showFinale() {
    if (!state.sent) return;
    const content = {
      business: `<div class="sb-finale-metrics"><div><b>${state.conflictCount || 3}</b><span>资料冲突已提示</span></div><div><b>0</b><span>真实模型调用</span></div><div><b>0</b><span>外发邮件</span></div></div>本轮不包含罚金、订单收入或 ROI 估算。`,
      industry: `<div class="sb-finale-metrics"><div><b>MOQ</b><span>${fmt(state.product?.moq_units)} 件</span></div><div><b>交期</b><span>${fmt(state.factory?.standard_lead_time_days)} 天</span></div><div><b>认证</b><span>仅按资料卡表达</span></div></div>市场资料缺口和订单排期仍需业务员确认。`,
      technical: `<div class="sb-finale-metrics"><div><b>FACT</b><span>产品字段比对</span></div><div><b>LOCAL</b><span>固定脚本演示</span></div><div><b>SAFE</b><span>无外发副作用</span></div></div>本原型未展示 RAG、向量检索或模型审核能力。`
    }[state.view];
    $("#sb-finale-view").innerHTML = content;
    $("#sb-finale").showModal();
  }

  function reset() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.tasks.clear();
    state.view = "business"; state.scene = "listing"; state.market = "US"; state.scanned = false; state.audit = false; state.response = false; state.sent = false; state.sequence++;
    $$("#sb-task-list li").forEach((item) => item.classList.remove("done"));
    $("#sb-progress-fill").style.width = "0%";
    setText("#sb-progress-label", "0 / 4 已完成");
    $$(".sb-channel").forEach((node) => node.classList.remove("scanned"));
    $$(".sb-listing-result").forEach((node) => { node.hidden = true; node.innerHTML = ""; });
    $("#sb-listing-disclaimer").hidden = true;
    $("#sb-listing-chat").hidden = true;
    $("#sb-listing-run").disabled = false; $("#sb-listing-run").textContent = "启动资料对照";
    setText("#sb-listing-state", "等待启动");
    $("#sb-market").value = "US";
    $("#sb-findings").hidden = true; $("#sb-findings").innerHTML = "";
    $("#sb-terminal-wrap").hidden = true; $("#sb-terminal-wrap").open = false;
    $("#sb-copilot").hidden = true; $("#sb-chat-history").innerHTML = "";
    $("#sb-inquiry-input").value = ""; $("#sb-simulate-send").disabled = true; $("#sb-simulate-send").textContent = "模拟发送并完成演练";
    $("#sb-audit-run").disabled = false; $("#sb-audit-run").textContent = "启动资料核对";
    setText("#sb-inquiry-state", "等待检查");
    setView("business"); setScene("listing"); renderMarket();
    if ($("#sb-finale").open) $("#sb-finale").close();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#sb-listing-run").addEventListener("click", runListing);
  $("#sb-audit-run").addEventListener("click", runAudit);
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("[data-scene]").forEach((button) => button.addEventListener("click", () => setScene(button.dataset.scene)));
  $("#sb-market").addEventListener("change", (event) => {
    state.market = event.target.value;
    if (state.market !== "US") markTask("market");
    renderMarket(); renderInsight();
  });
  $$("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
    $("#sb-listing-input").value = button.dataset.prompt;
    $("#sb-listing-form").requestSubmit();
  }));
  $("#sb-listing-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = $("#sb-listing-input").value.trim();
    if (!prompt) return;
    $("#sb-listing-input").value = "";
    const note = document.createElement("div");
    note.className = "sb-helper";
    note.textContent = `修改指令已记录为本地演示输入：“${prompt}”。预览仍使用资料卡约束的固定模板，不触发模型。`;
    $("#sb-safe-listings").appendChild(note);
  });
  $$("[data-inquiry-prompt]").forEach((button) => button.addEventListener("click", () => sendInstruction(button.dataset.inquiryPrompt)));
  $("#sb-inquiry-form").addEventListener("submit", (event) => { event.preventDefault(); sendInstruction($("#sb-inquiry-input").value); });
  $("#sb-simulate-send").addEventListener("click", () => {
    if (!state.response || state.sent) return;
    state.sent = true;
    const customer = document.createElement("div");
    customer.className = "sb-message assistant";
    customer.innerHTML = `<span class="sb-message-label">虚构的演示客户回复 · 不代表真实成交</span>${esc(`Thanks for clarifying the MOQ and product records. We can review a ${fmt(state.product?.moq_units)}-unit trial order, subject to final quotation and schedule confirmation.`)}`;
    $("#sb-chat-history").appendChild(customer);
    $("#sb-simulate-send").disabled = true;
    $("#sb-simulate-send").textContent = "模拟流程已完成";
    showFinale();
  });
  $("#sb-reset").addEventListener("click", reset);
  $("#sb-finale-reset").addEventListener("click", reset);
  $("#sb-finale-close").addEventListener("click", () => $("#sb-finale").close());
  $("#sb-finale-back").addEventListener("click", () => $("#sb-finale").close());
  $("#sb-task-toggle").addEventListener("click", (event) => {
    const list = $("#sb-task-list");
    const collapsed = !list.hidden;
    list.hidden = collapsed;
    event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    event.currentTarget.textContent = collapsed ? "展开" : "收起";
  });

  async function boot() {
    setProduct(fallback);
    renderFacts();
    try {
      const response = await fetch("/api/meta", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const meta = await response.json();
      setProduct(meta);
      state.metaLoaded = true;
    } catch (error) {
      state.metaLoaded = false;
      console.warn("Sandbox is using its local fallback facts:", error);
    }
    renderFacts();
  }

  boot();
})();
