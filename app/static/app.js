"use strict";
/* TradeDesk front end — vanilla JS, no build step. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (n, cls = "") => `<svg class="ic ${cls}"><use href="#i-${n}"/></svg>`;
const RISK = { red: "不能发", amber: "需人工确认", green: "可以发" };
const RISK_ICON = { red: "shield-alert", amber: "triangle-alert", green: "shield-check" };
const SEV = { red: "红", amber: "黄" };
const FLAG = { en: "🇺🇸", es: "🇲🇽", de: "🇩🇪", ja: "🇯🇵" };
// A Russian or English inquiry can come from several countries, so results show the market's flag.
const MARKET_FLAG = { US: "🇺🇸", MX: "🇲🇽", EU: "🇩🇪", JP: "🇯🇵", EAEU: "🇰🇿", NG: "🇳🇬" };
const flagOf = (q) => q.flag || MARKET_FLAG[q.market] || FLAG[q.language] || "🌐";
const PAGES = { overview: "概览", board: "商品看板", inbox: "询盘收件箱", inquiry: "询盘回复", listing: "多平台上架", check: "文案体检", eval: "评测与对照", kb: "规则知识库", logs: "调用日志", fair: "游园会找茬", agents: "智能体配置", selfcheck: "开摊自检" };
const PLAT = { amazon_us: { name: "Amazon 美国站", lang: "英语", cls: "amz", mark: "a" }, tiktok_mx: { name: "TikTok Shop 墨西哥", lang: "西班牙语", cls: "tt", mark: "♪" } };
let META = null, KB = null, page = "overview";
const state = { inq: { history: [], view: -1, busy: false }, lst: { history: [], view: -1, busy: false }, chkPlatform: "amazon_us", handoff: null, handoffHtml: "" };
// Products of the second demo factory carry factory_id; the label says which factory, so switching is visible.
const factoryOf = (p) => (META.other_factories || []).find((f) => f.id === p.factory_id);
const prodLabel = (p) => (factoryOf(p) ? `${p.name_zh} · ${factoryOf(p).name_zh.replace(/（示例工厂）$/, "")}` : p.name_zh);
const sampleFor = (pid) => (META.check_samples || {})[pid] || "";

// ------------------------------------------------------------------ utils
async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  let data;
  try { data = await res.json(); } catch (e) { throw new Error(`HTTP ${res.status} ${res.statusText}`); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function toast(msg, kind = "err") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${ic(kind === "err" ? "circle-x" : "circle-check-big")}<div>${esc(msg)}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
function busy(btn, on, label) {
  if (!btn) return;
  btn.disabled = on;
  if (on) { btn.dataset.html = btn.innerHTML; btn.innerHTML = `${ic("loader-circle", "spin")}${esc(label || "处理中…")}`; }
  else if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
}
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } };
const fmtS = (s) => (s == null ? "" : s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(1)}s`);
const worst = (risks) => (risks.includes("red") ? "red" : risks.includes("amber") ? "amber" : "green");
const catNames = () => ({ platform_amazon: "Amazon 平台", platform_amazon_image: "Amazon 主图", platform_alibaba: "阿里国际站", platform_tiktok: "TikTok Shop", platform_ebay: "eBay 平台", platform_shopify: "Shopify 平台", platform_etsy: "Etsy 平台", platform_walmart: "Walmart 平台", platform_mercadolibre: "Mercado Libre 平台", platform_aliexpress: "AliExpress 平台", compliance_us: "美国合规", compliance_mx: "墨西哥合规", compliance_eu: "欧盟合规", compliance_jp: "日本合规", compliance_eaeu: "欧亚经济联盟合规", compliance_ng: "尼日利亚合规", contract: "合同条款", culture: "商务礼仪" });

// ------------------------------------------------------------------ shared renderers
function highlight(text, findings, field) {
  const lower = (text || "").toLowerCase();
  const marks = [];
  findings.forEach((f, i) => {
    if (f.field !== field || !f.quote) return;
    const q = f.quote.toLowerCase();
    // Mark the occurrence inside the sentence the finding came from, not just the first one.
    const ctx = f.context ? lower.indexOf(f.context.toLowerCase()) : -1;
    const at = ctx >= 0 ? lower.indexOf(q, ctx) : lower.indexOf(q);
    if (at >= 0) marks.push({ s: at, e: at + q.length, i, sev: f.severity });
  });
  marks.sort((a, b) => a.s - b.s);
  let out = "", pos = 0;
  for (const m of marks) {
    if (m.s < pos) continue;
    out += esc(text.slice(pos, m.s)) + `<mark class="${m.sev}" data-f="${m.i}">${esc(text.slice(m.s, m.e))}</mark><sup class="fn">${m.i + 1}</sup>`;
    pos = m.e;
  }
  return out + esc((text || "").slice(pos));
}

function sourceHtml(s) {
  if (!s) return "";
  if (s.type === "kb") {
    return `<div class="who">${ic("book-open-check", "sm")}<span class="badge brand">${esc(s.rule_id)}</span><span>${esc(s.title_zh || "")}</span></div>
      <blockquote>“${esc(s.excerpt || "")}”</blockquote>
      <a href="${esc(s.url)}" target="_blank" rel="noopener">${ic("external-link", "sm")} ${esc(host(s.url))}</a>`;
  }
  const v = typeof s.value === "object" ? JSON.stringify(s.value) : s.value;
  return `<div class="who">${ic("package", "sm")}<span class="badge">资料卡</span><span>${esc(s.label_zh)}</span></div>
    <blockquote><code>${esc(s.path)}</code> = ${esc(v)}</blockquote>`;
}

function riskPanel(r) {
  const reds = r.findings.filter((f) => f.severity === "red").length;
  const ambers = r.findings.length - reds;
  const title = { red: "有明确违规，不能直接发", amber: "有风险点，需要人确认", green: "没有发现问题" }[r.risk];
  const list = r.findings.map((f, i) => `
    <div class="finding ${f.severity}" data-f="${i}">
      <div class="h"><span class="num">#${i + 1}</span><div style="flex:1"><b>${esc(f.problem_zh)}</b>
        <div class="row" style="margin-top:6px"><span class="badge ${f.severity}">${SEV[f.severity]}</span><span class="badge">${f.by === "model" ? `${ic("sparkles", "sm")}模型审核 · 出处已核对` : `${ic("cpu", "sm")}代码规则`}</span><span class="badge">${esc(f.field)}</span></div></div></div>
      ${f.evidence_zh ? `<div class="q">看到：${esc(f.evidence_zh)}</div>` : f.quote ? `<div class="q">${esc(f.quote)}</div>` : `<div class="q">${f.field === "image" ? "像素测量（代码）" : "（整个字段）"}</div>`}
      ${f.suggestion_zh ? `<div class="fix">${ic("wand-sparkles", "sm")}<span>${esc(f.suggestion_zh)}</span></div>` : ""}
      <div class="src">${sourceHtml(f.source)}${f.source_extra ? sourceHtml(f.source_extra) : ""}</div>
    </div>`).join("");
  const skipped = r.review_skipped ? `<div class="callout warn">${ic("triangle-alert")}<div><b>模型审核没有运行</b>：${esc(r.review_skipped.reason_zh)}。下面只是代码规则的结果，规则 ${esc(r.review_skipped.rules.join("、"))} 需要人工检查。</div></div>` : "";
  const dropped = r.dropped && r.dropped.length ? `<div class="callout">${ic("ban")}<div><details><summary><b>已丢弃 ${r.dropped.length} 条模型提示</b>：没有规则编号或原文对不上，不作为风险展示</summary><pre class="json" style="margin-top:8px">${esc(JSON.stringify(r.dropped, null, 1))}</pre></details></div></div>`
    : `<div class="callout">${ic("shield-check")}<div>出处守卫：模型的每条提示都核对了规则编号和原文，本轮没有需要丢弃的。</div></div>`;
  return `
    <div class="risk-hero"><div class="risk-ring ${r.risk}">${ic(RISK_ICON[r.risk])}</div>
      <div><b>${title}</b><span>${RISK[r.risk]} · 检查了 ${(r.rules_checked || []).length} 条知识库规则 + 资料卡</span></div>
      <div class="counts">${reds ? `<span class="badge red">红 ${reds}</span>` : ""}${ambers ? `<span class="badge amber">黄 ${ambers}</span>` : ""}${!r.findings.length ? `<span class="badge green">0</span>` : ""}</div></div>
    <div class="sep" style="margin:0 0 12px"></div>
    ${skipped}
    <div class="findings">${list || `<div class="empty">${ic("circle-check-big")}<div>没有发现问题</div></div>`}</div>
    ${dropped}`;
}

// The product card as the evidence the code checks read: fields a finding cites light up,
// and hovering a finding or a field highlights its partner, so "why is this wrong" is visible.
const factKey = (path) => ((path || "").match(/(?:products\[[^\]]+\]|factory)\.(\w+)/) || [])[1] || null;
function factsCard(pid, findings) {
  const p = META.products.find((x) => x.id === pid);
  if (!p) return "";
  const f = factoryOf(p) || META.factory;
  const list = (o, fmt) => Object.entries(o || {}).map(([k, v]) => fmt(k, v)).join(" · ");
  const rows = [
    ["certifications_held", "已有认证", (p.certifications_held || []).join("、") || "无"],
    ["certifications_not_held", "没有的认证", (p.certifications_not_held || []).join("、") || "无"],
    ["material_tests", "没检测、不能宣称", list(p.material_tests, (k, v) => `${k}：${v}`) || "无"],
    ["moq_units", "起订量 MOQ", `${p.moq_units}`],
    ["fob_ningbo_usd", "FOB 宁波阶梯价", list(p.fob_ningbo_usd, (k, v) => `${k}：$${v}`)],
    ["standard_lead_time_days", "标准交期", `${f.standard_lead_time_days} 天`],
    ["payment_terms_accepted", "接受的付款方式", (f.payment_terms_accepted || []).join(" / ")],
  ];
  const cites = {};
  findings.forEach((x, i) => { const k = x.source?.type === "product_card" ? factKey(x.source.path) : null; if (k) (cites[k] = cites[k] || []).push(i); });
  const sev = (k) => (cites[k].some((i) => findings[i].severity === "red") ? "red" : "amber");
  return `<div class="card facts" data-facts><div class="card-h"><div><h3>${ic("package")}工厂资料卡 · 事实来源</h3><p>${esc(f.name_zh)} · ${esc(p.name_zh)}。代码按这张卡核对，标亮的字段就是风险提示的依据</p></div></div>
    <div class="facts-b">${rows.map(([k, label, v]) => `<div class="fact${cites[k] ? ` hit ${sev(k)}` : ""}" data-fact="${k}" data-cites="${(cites[k] || []).join(",")}"><span>${label}</span><b>${esc(v)}</b>${cites[k] ? `<em>${cites[k].map((i) => `#${i + 1}`).join(" ")}</em>` : ""}</div>`).join("")}</div></div>`;
}
function wireFacts(root) {
  const facts = $("[data-facts]", root);
  if (!facts) return;
  const rowsFor = (i) => $$(".fact[data-cites]", facts).filter((r) => r.dataset.cites.split(",").includes(String(i)));
  $$(".finding[data-f]", root).forEach((card) => {
    const on = (v) => rowsFor(card.dataset.f).forEach((r) => r.classList.toggle("pulse", v));
    card.addEventListener("mouseenter", () => on(true)); card.addEventListener("mouseleave", () => on(false));
    card.addEventListener("click", () => { const r = rowsFor(card.dataset.f)[0]; if (r) { r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); } });
  });
  $$(".fact.hit", facts).forEach((row) => {
    const cards = () => row.dataset.cites.split(",").map((i) => $(`.finding[data-f="${i}"]`, root)).filter(Boolean);
    row.addEventListener("mouseenter", () => cards().forEach((c) => c.classList.add("hot")));
    row.addEventListener("mouseleave", () => cards().forEach((c) => c.classList.remove("hot")));
    row.addEventListener("click", () => cards()[0]?.scrollIntoView({ block: "center", behavior: "smooth" }));
  });
}

function wireLinks(root) {
  $$("mark[data-f]", root).forEach((m) => {
    const scope = m.closest("[data-scope]") || root;
    m.addEventListener("click", () => {
      const f = $(`.finding[data-f="${m.dataset.f}"]`, scope);
      if (f) { f.scrollIntoView({ behavior: "smooth", block: "center" }); f.classList.add("hot"); setTimeout(() => f.classList.remove("hot"), 1400); }
    });
  });
  $$(".finding[data-f]", root).forEach((f) => {
    const scope = f.closest("[data-scope]") || root;
    f.addEventListener("mouseenter", () => $$(`mark[data-f="${f.dataset.f}"]`, scope).forEach((m) => m.classList.add("hot")));
    f.addEventListener("mouseleave", () => $$(`mark[data-f="${f.dataset.f}"]`, scope).forEach((m) => m.classList.remove("hot")));
  });
}

function diffHtml(ops) {
  if (!ops) return "";
  return ops.map((o) => o.op === "equal" ? esc(o.text) : o.op === "insert" ? `<ins>${esc(o.text)}</ins>` : `<del>${esc(o.text)}</del>`).join("");
}

function editBtn(benchId) {
  return `<button class="btn sm" data-edit="${benchId}">${ic("file-text", "sm")}编辑输入</button>`;
}
function wireEdit(root) {
  $$("[data-edit]", root).forEach((b) => b.addEventListener("click", () => {
    const bench = document.getElementById(b.dataset.edit);
    bench.classList.toggle("collapsed");
    b.innerHTML = bench.classList.contains("collapsed") ? `${ic("file-text", "sm")}编辑输入` : `${ic("x", "sm")}收起输入`;
  }));
}
function stepsBar(names, trace, running) {
  const items = names.map((n, i) => {
    const t = trace && trace[i];
    const cls = running ? (i === 0 ? "run" : "") : "done";
    // replay = no model call, the recorded answer was reused, so there is no latency worth showing
    const meta = !t ? "" : t.meta.source === "replay"
      ? `<span class="t" data-tip="这一步没有调用模型，用的是 ${esc(t.meta.model || "")} 录制的结果（回放模式）；切到实时模式后这里显示实际耗时">回放 · 录制结果</span>`
      : `<span class="t" data-tip="这一步实时调用了 ${esc(t.meta.model || "模型")}">实时 ${fmtS(t.meta.seconds)}</span>`;
    const num = running ? (i === 0 ? ic("loader-circle", "sm spin") : i + 1) : ic("circle-check-big", "sm");
    return `<div class="step ${cls}"><span class="n">${num}</span><span>${esc(n)}</span>${meta}</div>`;
  });
  return `<div class="steps">${items.join('<div class="step-line"></div>')}</div>`;
}

function roundsHtml(st, key) {
  if (!st.history.length) return "";
  return st.history.map((r, i) => {
    const risk = r.risk || worst(Object.values(r.platforms || {}).map((p) => p.risk));
    return `<button class="round ${i === st.view ? "on" : ""}" data-round="${key}:${i}"><span class="d ${risk}"></span>第 ${i + 1} 轮</button>`;
  }).join("");
}

function composer(id, chips, round) {
  return `<div class="composer"><div class="chips">${chips.map((c) => `<button class="chip" data-chip="${id}">${esc(c)}</button>`).join("")}</div>
    <div class="in"><textarea id="${id}-ins" rows="1" placeholder="用中文提修改意见，例如：按风险提示全部修改"></textarea>
    <button class="btn icon mic" data-mic="${id}-ins" data-lang="zh-CN" title="${esc(MIC_TIP)}">${ic("mic")}</button>
    <button class="btn primary" id="${id}-rev">${ic("send", "sm")}改出第 ${round} 轮</button></div></div>`;
}

function wireComposer(id, fn) {
  $$(`[data-chip="${id}"]`).forEach((b) => b.addEventListener("click", () => { $(`#${id}-ins`).value = b.textContent; $(`#${id}-ins`).focus(); }));
  $(`#${id}-rev`).addEventListener("click", fn);
  wireMics($(`#${id}-ins`).closest(".composer"));
  $(`#${id}-ins`).addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fn(); } });
}

// ------------------------------------------------------------------ voice input
// Speech to text is done by the browser (Chrome sends the audio to its speech service, so it needs the internet);
// no model call and no audio is stored. Only Chrome and Edge have it.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const MIC_TIP = "语音输入：由浏览器把语音转成文字（Chrome / Edge，需联网，音频会发到浏览器的语音服务），不经过我们的模型";
const MIC_LANGS = [["en-US", "英语"], ["es-MX", "西语"], ["de-DE", "德语"], ["ja-JP", "日语"], ["ru-RU", "俄语"], ["zh-CN", "中文"]];
const LANG_FOR = { en: "en-US", es: "es-MX", de: "de-DE", ja: "ja-JP", ru: "ru-RU" };
let micOn = null;
function micBar(targetId, langs) {
  const pick = langs ? `<select class="mic-lang" data-for="${targetId}" title="说的是哪种语言">${MIC_LANGS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select>` : "";
  return `<div class="mic-bar"><button type="button" class="btn sm mic" data-mic="${targetId}" data-lang="zh-CN" title="${esc(MIC_TIP)}">${ic("mic", "sm")}<span>语音输入</span></button>${pick}
    <span class="small muted">${langs ? "听买家电话或语音时直接转写" : "用中文说出意图"}</span></div>`;
}
function wireMics(root) {
  $$("[data-mic]", root).forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    const sel = $(`.mic-lang[data-for="${b.dataset.mic}"]`);
    toggleMic(b, $(`#${b.dataset.mic}`), sel ? sel.value : b.dataset.lang);
  }));
}
function toggleMic(btn, el, lang) {
  if (micOn) { const same = micOn.btn === btn; micOn.rec.stop(); if (same) return; }
  if (!SpeechRec) return toast("这个浏览器不支持语音识别，请用 Chrome 或 Edge 打开");
  const rec = new SpeechRec();
  rec.lang = lang; rec.interimResults = true; rec.continuous = true;
  const before = el.value, sep = before && !/\s$/.test(before) && !lang.startsWith("zh") && !lang.startsWith("ja") ? " " : "";
  let done = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) done += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    el.value = before + sep + done + interim;
  };
  rec.onerror = (e) => toast(({ "not-allowed": "没有麦克风权限：请在浏览器地址栏允许使用麦克风", "service-not-allowed": "浏览器不允许使用语音服务",
    "no-speech": "没有听到声音，请再试一次", network: "语音识别需要联网（浏览器把音频发到它的语音服务）", "audio-capture": "没有找到麦克风" })[e.error] || `语音识别出错：${e.error}`);
  rec.onend = () => { btn.classList.remove("on"); if (micOn && micOn.rec === rec) micOn = null; };
  try { rec.start(); } catch (err) { return toast(`语音识别没有启动：${err.message}`); }
  btn.classList.add("on"); micOn = { rec, btn };
}

function loadingCard(names) {
  return `<div class="card">${stepsBar(names, null, true)}<div class="card-b stack">
    <div class="skel" style="height:18px;width:40%"></div><div class="skel" style="height:14px"></div><div class="skel" style="height:14px;width:92%"></div>
    <div class="skel" style="height:14px;width:85%"></div><div class="skel" style="height:120px"></div></div></div>`;
}

function emptyCard(iconName, title, lines) {
  return `<div class="card"><div class="empty" style="padding:60px 24px">${ic(iconName)}<div style="font-weight:600;color:hsl(var(--foreground));margin-bottom:6px">${esc(title)}</div>
    ${lines.map((l) => `<div class="small">${esc(l)}</div>`).join("")}</div></div>`;
}

// ------------------------------------------------------------------ navigation
function go(p) {
  page = p;
  $$(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.page === p));
  $$(".page").forEach((s) => s.classList.toggle("on", s.id === "page-" + p));
  $("#crumb").textContent = PAGES[p];
  if (p === "overview") renderOverview();
  if (p === "board") renderBoard();
  if (p === "inbox") renderInbox();
  if (p === "eval") showEvalTab(evalTab);
  if (p === "fair") renderFair();
  if (p === "kb") renderKB();
  if (p === "logs") renderLogs();
  if (p === "agents") renderAgents();
  if (p === "selfcheck") renderSelfcheck();
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------------ overview
function groupRuns(entries) {
  const runs = new Map();
  for (const e of entries) {
    if (!runs.has(e.run_id)) runs.set(e.run_id, { id: e.run_id, workflow: e.workflow, trigger: e.trigger, ts: e.ts, steps: [], reviews: [] });
    const r = runs.get(e.run_id);
    if (e.findings) r.reviews.push(e); else r.steps.push(e);
  }
  return [...runs.values()];
}

const pct = (n, total) => (total ? (n / total) * 100 : 0);
// One stacked bar: segments [{n, cls, label}], each with a hover tip; zero-width segments are skipped.
function sbar(segs) {
  const total = segs.reduce((k, x) => k + x.n, 0);
  return `<div class="sbar">${segs.filter((x) => x.n).map((x) => `<i class="${x.cls}" style="flex:${x.n}" data-tip="${esc(x.label)} ${x.n}（${Math.round(pct(x.n, total))}%）"></i>`).join("")}</div>`;
}
const swatch = (cls, label, n) => `<span class="sw"><i class="${cls}"></i>${esc(label)}${n == null ? "" : ` <b style="color:hsl(var(--foreground))">${n}</b>`}</span>`;
const CHANNEL = { image: { name: "主图", sub: "Amazon 主图要求", ico: "img" }, amazon_us: { name: "Amazon 美国站", sub: "英语 · Listing", ico: "amz" }, tiktok_mx: { name: "TikTok 墨西哥", sub: "西语 · 种草脚本", ico: "tt" } };
const CELL_STATES = [["listed", "已上架"], ["green", "可上架"], ["amber", "需人工确认"], ["red", "不能发"], ["none", "未生成"]];
const cellState = (c) => (c.listed ? "listed" : c.risk || "none");
const WF_SHORT = { "A 询盘回复": "询盘", "B 多平台上架": "上架", "C 主图检查": "主图", "收件箱整理": "收件箱", "已有文案检查": "体检" };
const WF_ICON = { "收件箱整理": "history", "已有文案检查": "scan-search" };

async function renderOverview() {
  const [{ entries }, kb, board] = await Promise.all([api("/api/logs"), KB ? KB : api("/api/kb"), api("/api/board").catch(() => null)]);
  KB = kb;
  if (META) $("#ov-eyebrow").innerHTML = `${ic("building-2", "sm")}${esc(META.factory.name_zh)} ·`;
  const runs = groupRuns(entries);
  const reviews = entries.filter((e) => e.findings);
  const all = reviews.flatMap((e) => e.findings);
  const reds = all.filter((f) => f.severity === "red").length;
  const dropped = reviews.reduce((n, e) => n + (e.dropped || []).length, 0);
  const calls = entries.filter((e) => e.meta).length;
  const verified = kb.rules.filter((r) => r.verified).length;
  const domains = new Set(kb.rules.map((r) => host(r.url))).size;
  const cats = new Set(kb.rules.map((r) => r.category)).size;
  const byWf = {};
  runs.forEach((r) => { const k = WF_SHORT[r.workflow] || r.workflow; byWf[k] = (byWf[k] || 0) + 1; });
  const wfTop = Object.entries(byWf).sort((a, b) => b[1] - a[1]);
  const wfRest = wfTop.slice(3).reduce((k, [, n]) => k + n, 0);
  const kpi = (tone, iconName, k, v, viz, d) => `<div class="card kpi ${tone}"><div class="k">${ic(iconName)}${esc(k)}</div><div class="v">${v}</div><div class="viz">${viz}</div><div class="d">${d}</div></div>`;
  $("#ov-stats").innerHTML =
    kpi("", "book-open-check", "已核实规则", `${verified}<small> / ${kb.rules.length}</small>`,
      sbar([{ n: verified, cls: "s-c1", label: "已核实" }, { n: kb.rules.length - verified, cls: "s-none", label: "待核实" }]),
      `${cats} 类 · ${domains} 个公开来源，每条带原文与链接`) +
    kpi("", "zap", "运行次数", runs.length,
      `<div class="pills">${wfTop.slice(0, 3).map(([k, n]) => `<span>${esc(k)}<b>${n}</b></span>`).join("")}${wfRest ? `<span>其他<b>${wfRest}</b></span>` : ""}</div>`,
      `模型调用 ${calls} 次`) +
    kpi("red", "shield-alert", "拦下的风险", all.length,
      sbar([{ n: reds, cls: "s-red", label: "红色 · 不能发" }, { n: all.length - reds, cls: "s-amber", label: "黄色 · 需人工确认" }]),
      swatch("s-red", "红色", reds) + swatch("s-amber", "黄色", all.length - reds)) +
    kpi("green", "ban", "丢弃的无出处提示", dropped, `<div class="pills"><span>出处守卫 · 代码执行</span></div>`, dropped ? "模型说不出依据，没有展示给用户" : "0 表示模型这几次都给出了出处；编造的提示见评测页红队测试（5 条全部拦下）");

  // channel health, from the product board
  if (board) {
    const rows = board.rows;
    $("#ov-chan-note").textContent = `商品看板 · ${rows.length} 个产品 × ${board.channels.length} 个渠道的最新检查结果（看板跟踪主图、Amazon 美国站和 TikTok 墨西哥；另外 9 个平台在“多平台上架”里生成）`;
    $("#ov-chan-legend").innerHTML = CELL_STATES.map(([k, label]) => swatch(`s-${k}`, label)).join("");
    $("#ov-chan").innerHTML = board.channels.map((ch) => {
      const cells = rows.map((r) => r.cells[ch]);
      const count = (k) => cells.filter((c) => cellState(c) === k).length;
      const ok = count("listed") + count("green");
      const C = CHANNEL[ch] || { name: ch, sub: "", ico: "img" };
      const icoHtml = C.ico === "img" ? `<span class="cico img">${ic("package", "sm")}</span>` : `<span class="cico pl ${C.ico}">${PLAT[ch].mark}</span>`;
      return `<div class="chan"><div class="nm">${icoHtml}<div><b>${esc(C.name)}</b><span>${esc(C.sub)}</span></div></div>
        <div>${sbar(CELL_STATES.map(([k, label]) => ({ n: count(k), cls: `s-${k}`, label })))}
          <div class="counts">${CELL_STATES.filter(([k]) => count(k)).map(([k, label]) => `<span>${esc(label)} <b>${count(k)}</b></span>`).join("")}</div></div>
        <div class="rt"><b>${ok}<small class="muted" style="font-size:12px;font-weight:500"> / ${cells.length}</small></b>可上架或已上架</div></div>`;
    }).join("");
  } else {
    $("#ov-chan").innerHTML = `<div class="empty">${ic("package")}<div>看板数据暂时读不到</div></div>`;
  }

  // where the findings came from
  const byRule = all.filter((f) => f.by === "rule").length;
  const fromKb = all.filter((f) => f.source && f.source.type === "kb").length;
  $("#ov-risk-note").textContent = `调用日志里的 ${all.length} 条风险提示`;
  $("#ov-risk").innerHTML = all.length ? `
    <div class="split"><div class="h">谁发现的<span>代码规则先查，模型再审</span></div>
      ${sbar([{ n: byRule, cls: "s-c1", label: "代码规则" }, { n: all.length - byRule, cls: "s-c2", label: "模型审核" }])}
      <div class="lab">${swatch("s-c1", "代码规则", byRule)}${swatch("s-c2", "模型审核", all.length - byRule)}</div></div>
    <div class="split"><div class="h">依据是什么<span>每条都挂出处</span></div>
      ${sbar([{ n: fromKb, cls: "s-c1", label: "公开规则原文" }, { n: all.length - fromKb, cls: "s-c2", label: "工厂资料卡字段" }])}
      <div class="lab">${swatch("s-c1", "公开规则原文", fromKb)}${swatch("s-c2", "工厂资料卡", all.length - fromKb)}</div></div>
    <div class="note">${ic("info", "sm")}<span>模型审核的提示必须带规则编号，且引用的原文真的出现在规则里，否则由代码丢弃。</span></div>`
    : `<div class="empty">${ic("shield-check")}<div>还没有风险提示</div></div>`;

  // most cited sources
  const ruleTitle = Object.fromEntries(kb.rules.map((r) => [r.id, r.title_zh]));
  const cited = {};
  all.forEach((f) => {
    const s = f.source || {};
    const id = s.type === "kb" ? s.rule_id : "资料卡";
    const name = s.type === "kb" ? (ruleTitle[s.rule_id] || s.title_zh || s.rule_id) : (s.label_zh || "").replace(/^产品资料：/, "");
    const key = `${id}|${name}`;
    cited[key] = (cited[key] || 0) + 1;
  });
  const top = Object.entries(cited).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topMax = top.length ? top[0][1] : 1;
  $("#ov-rules").innerHTML = top.length ? top.map(([key, n]) => {
    const [id, name] = key.split("|");
    return `<div class="rank" data-tip="${esc(id)} · ${esc(name)} · ${n} 次"><div class="h"><span class="mono-chip">${esc(id)}</span><span class="nm">${esc(name)}</span><b>${n}</b></div><div class="t"><i style="width:${pct(n, topMax)}%"></i></div></div>`;
  }).join("") : `<div class="empty">${ic("book-open-check")}<div>还没有引用记录</div></div>`;

  const recent = runs.slice(-6).reverse();
  $("#ov-runs").innerHTML = recent.length ? `<table class="tbl runs"><thead><tr><th>工作流</th><th>时间</th><th>结果</th><th style="text-align:right">提示</th></tr></thead><tbody>${recent.map((r) => {
    const risk = worst(r.reviews.map((x) => x.risk));
    const n = r.reviews.reduce((k, x) => k + x.findings.length, 0);
    const letter = /^[A-C] /.test(r.workflow) ? r.workflow[0] : "";
    const name = letter ? r.workflow.slice(2) : r.workflow;
    const mark = letter || ic(WF_ICON[r.workflow] || "zap", "sm");
    return `<tr data-go="logs"><td><div class="wfc"><span class="wfk ${letter || "x"}">${mark}</span><div><b>${esc(name)}</b><span>${esc(r.trigger)}</span></div></div></td>
      <td class="tm">${esc((r.ts || "").slice(5, 16))}</td><td><span class="badge ${risk}">${RISK[risk]}</span></td><td style="text-align:right;font-variant-numeric:tabular-nums">${n}</td></tr>`;
  }).join("")}</tbody></table>` : `<div class="empty">${ic("history")}<div>还没有运行记录</div></div>`;
  $$("#ov-runs [data-go]").forEach((t) => t.addEventListener("click", () => go("logs")));
}

// ------------------------------------------------------------------ A: inquiry
function renderSamples() {
  $("#inq-samples").innerHTML = META.inquiries.map((q, i) => `<button class="sample" data-i="${i}"><span class="flag">${flagOf(q)}</span><span><b>${esc(q.label_zh)}</b><span>${esc(q.text.slice(0, 64))}…</span></span></button>`).join("");
  $$("#inq-samples .sample").forEach((b) => b.addEventListener("click", () => pickSample(+b.dataset.i)));
}
function pickSample(i) {
  const q = META.inquiries[i];
  state.inqId = q.id;
  $$("#inq-samples .sample").forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
  $("#inq-text").value = q.text; $("#inq-intent").value = q.intent_zh; $("#inq-product").value = q.product_id;
  const sel = $('.mic-lang[data-for="inq-text"]'); if (sel && LANG_FOR[q.language]) sel.value = LANG_FOR[q.language];
}

function analysisCard(u, flag) {
  const b = u.buyer || {};
  const items = (arr, fn) => (arr && arr.length ? arr.map(fn).join("") : `<div class="small muted">无</div>`);
  return `<div class="card" style="margin-top:16px"><div class="card-h"><div><h3>${ic("user")}询盘分析</h3><p>每一条都标了询盘原文；找不到原文出处的条目已被丢弃${u.dropped_without_quote ? `（${u.dropped_without_quote} 条）` : ""}</p></div></div>
    <div class="analysis-grid"><div class="buyer"><div class="row"><div class="avatar">${flag || FLAG[b.language] || "🌐"}</div><div><b>${esc(b.country_guess || "未知国家")}</b><div class="small muted">${esc(b.business_type_zh || "")}</div></div></div>
      <div class="kv"><span>渠道</span><b>${esc(b.sales_channel_zh || "—")}</b><span>语言</span><b>${esc(b.language || "—")}</b></div>
      <div class="sep"></div><div class="small">${esc(u.summary_zh || "")}</div></div>
    <div class="items">
      <div class="section-t">和工厂资料对不上</div>${items(u.conflicts, (c) => `<div class="item"><span class="badge ${c.severity}">${SEV[c.severity] || ""}</span><div><b>${esc(c.topic_zh)}</b>：买家要 ${esc(c.buyer_wants)} → 工厂 ${esc(c.factory_can)}<div class="q">“${esc(c.quote)}”</div></div></div>`)}
      <div class="section-t">买家需求</div>${items(u.requests, (r) => `<div class="item"><span class="badge">${esc(r.topic_zh)}</span><div>${esc(r.value)}<div class="q">“${esc(r.quote)}”</div></div></div>`)}
      <div class="section-t">询盘质量信号</div>${items(u.signals, (s) => `<div class="item"><span class="badge ${s.positive ? "green" : "amber"}">${s.positive ? "＋" : "－"}</span><div>${esc(s.signal_zh)}<div class="q">“${esc(s.quote)}”</div></div></div>`)}
    </div></div></div>`;
}

function tasksCard(r) {
  if (!r.tasks || !r.tasks.length) return "";
  return `<div class="card" style="margin-top:16px"><div class="card-h"><div><h3>${ic("building-2")}已派发给其他岗位的任务（${r.tasks.length}）</h3><p>每条都挂着询盘原文；挂不上的已丢弃${r.tasks_dropped ? `（${r.tasks_dropped} 条）` : ""}。在“询盘收件箱 → 协同任务”里跟进。</p></div><button class="btn sm" data-go-tasks>${ic("arrow-right", "sm")}去看任务</button></div>
    <div class="card-b grid g3">${r.tasks.map((t) => `<div class="task"><div class="row"><span class="badge brand">${esc(t.role_zh)}</span>${t.priority === "high" ? '<span class="badge red">急</span>' : ""}</div><div style="margin-top:6px">${esc(t.task_zh)}</div><div class="q">“${esc(t.quote)}”</div></div>`).join("")}</div></div>`;
}

// The reply and the listing are two steps of one job: same product card, same factory, no re-typing.
function journeyCard() {
  const p = META.products.find((x) => x.id === $("#inq-product").value);
  return `<div class="card journey"><div class="card-b"><span class="ji">${ic("git-compare-arrows")}</span>
    <div class="jt"><b>下一步：同一个产品去上架</b><span>这条回复用的是「${esc(p ? p.name_zh : "")}」的资料卡，上架文案用同一份资料，不用重新录入</span></div>
    <button class="btn sm" data-go-tasks>${ic("history", "sm")}看派发的任务</button>
    <button class="btn sm primary" id="inq-next-listing">${ic("store", "sm")}为这个产品生成上架文案</button></div></div>`;
}
// Remember the reply this listing is attached to, so the listing page can check the two against each other.
function handoffFromInquiry() {
  const r = state.inq.history[state.inq.history.length - 1];
  const q = META.inquiries.find((x) => x.id === state.inqId);
  state.handoff = r ? { product_id: $("#inq-product").value, reply: r.reply, round: r.round, label: q ? q.label_zh : "这位买家" } : null;
}
async function showHandoff() {
  const h = state.handoff, r = state.lst.history[state.lst.history.length - 1];
  state.handoffHtml = "";
  if (!h || !r || h.product_id !== state.lstProduct) return;
  const plats = Object.keys(r.platforms);
  let res;
  try { res = await api("/api/handoff", { product_id: h.product_id, reply: h.reply, listing: Object.fromEntries(plats.map((p) => [p, r.platforms[p].fields])) }); }
  catch (e) { return toast(e.message); }
  const tables = plats.map((p) => res.platforms[p]);
  const conflicts = tables.reduce((n, t) => n + t.conflicts, 0);
  const name = (p) => META.listing_catalog.platforms[p]?.name || p;
  const cell = (v) => `<span class="${/写成|宣称无检测/.test(v) ? "hf-bad" : /如实|一致|提到/.test(v) ? "hf-ok" : "muted"}">${esc(v)}</span>`;
  const rows = tables[0].rows.map((row, i) => {
    const ok = tables.every((t) => t.rows[i].ok);
    return `<tr><td><b>${esc(row.fact)}</b><div class="small muted">${esc(row.kind_zh)}</div></td><td class="small">${esc(row.card)}</td><td>${cell(row.reply)}</td>
      ${tables.map((t) => `<td>${cell(t.rows[i].listing)}</td>`).join("")}<td>${ok ? `<span class="badge green">${ic("circle-check-big", "sm")}对得上</span>` : `<span class="badge red">${ic("circle-x", "sm")}打架</span>`}</td></tr>`;
  }).join("");
  state.handoffHtml = `<div class="card handoff"><div class="card-h"><div><h3>${ic("git-compare-arrows")}回复和上架文案对得上吗</h3>
      <p>同一张资料卡：给「${esc(h.label)}」的回复（第 ${h.round} 轮）↔ ${esc(plats.map(name).join("、"))}。代码逐项核对，不经过模型。</p></div>
      <span class="badge ${conflicts ? "red" : "green"}">${conflicts ? `${conflicts} 处说法打架` : "0 处说法打架"}</span></div>
    <table class="tbl hf-tbl"><thead><tr><th>资料卡上的事实</th><th>资料卡</th><th>回复里</th>${plats.map((p) => `<th>${esc(name(p))} 里</th>`).join("")}<th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $("#lst-out").insertAdjacentHTML("afterbegin", state.handoffHtml);
}
function listingFromInquiry(pid) {
  handoffFromInquiry();
  go("listing"); pickProduct(pid);
  $("#lst-bench").classList.remove("collapsed");
  const p = META.products.find((x) => x.id === pid);
  toast(`已选好「${p ? p.name_zh : pid}」的资料卡，点“生成 → 校验”`, "ok");
}

function renderInquiry() {
  const st = state.inq;
  $("#inq-rounds").innerHTML = roundsHtml(st, "inq");
  $$("#inq-rounds [data-round]").forEach((b) => b.addEventListener("click", () => { st.view = +b.dataset.round.split(":")[1]; renderInquiry(); }));
  if (!st.history.length) {
    $("#inq-out").innerHTML = emptyCard("mail-question", "选一条示例询盘，点“理解 → 生成 → 校验”", ["系统会找出买家要求和工厂资料对不上的地方，", "用买家的语言写回复，并逐条标出风险和依据。"]);
    return;
  }
  const r = st.history[st.view];
  const latest = st.view === st.history.length - 1;
  const names = r.trace.map((t) => `${t.role} · ${t.step.split(" · ")[0]}`);
  $("#inq-out").innerHTML = `
    <div class="card"><div class="steps-wrap">${stepsBar(names, r.trace, false)}${editBtn("inq-bench")}</div>
      ${!latest ? `<div class="callout" style="margin:12px 16px">${ic("info")}<div>正在查看第 ${st.view + 1} 轮（历史）。修改会基于最新一轮。</div></div>` : ""}
    </div>
    <div class="result" style="margin-top:16px" data-scope>
      <div class="stack"><div class="card"><div class="tabs" id="inq-tabs">
          <button class="on" data-t="reply">${ic("send", "sm")}发给买家 <span class="badge">${flagOf(r)} ${esc(r.language)}</span></button>
          <button data-t="brief">${ic("building-2", "sm")}内部备忘 <span class="badge">中文</span></button>
          <button data-t="diff" ${r.diff ? "" : "disabled"}>${ic("git-compare-arrows", "sm")}与上一轮对比</button>
        </div>
        <div data-pane="reply" class="doc">${highlight(r.reply, r.findings, "reply")}</div>
        <div data-pane="brief" class="brief" hidden>${esc(r.internal_brief_zh)}</div>
        <div data-pane="diff" class="doc diff" hidden>${diffHtml(r.diff)}</div>
        ${r.notes_zh ? `<div class="card-b small muted" style="border-top:1px solid hsl(var(--border))">${ic("sparkles", "sm")} 写法：${esc(r.notes_zh)}</div>` : ""}
      </div>${factsCard($("#inq-product").value, r.findings)}</div>
      <div class="card">${riskPanel(r)}</div>
    </div>
    ${latest ? journeyCard() : ""}
    ${tasksCard(r)}
    ${analysisCard(st.history[0].understanding, flagOf(r))}
    ${latest ? composer("inq", ["按风险提示全部修改", "语气更热情一点，强调可以寄样", "把定金改成 50%", "再简短一点"], st.history.length + 1) : ""}`;
  $$("#inq-tabs button").forEach((b) => b.addEventListener("click", () => {
    $$("#inq-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $$("#inq-out [data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.t));
  }));
  wireLinks($("#inq-out")); wireEdit($("#inq-out")); wireFacts($("#inq-out"));
  $$("#inq-out [data-go-tasks]").forEach((b) => b.addEventListener("click", () => { go("inbox"); showInboxTab("tasks"); }));
  $("#inq-next-listing")?.addEventListener("click", () => listingFromInquiry($("#inq-product").value));
  if (latest) wireComposer("inq", reviseInquiry);
}

async function runInquiry() {
  if (state.inq.busy) return;
  const btn = $("#inq-run");
  state.inq.busy = true; busy(btn, true, "运行中…");
  $("#inq-out").innerHTML = loadingCard(["询盘分析员 · 理解", "外贸业务员 · 生成", "合规审核员 · 校验", "反馈"]);
  try {
    const r = await api("/api/inquiry", { inquiry_text: $("#inq-text").value, intent_zh: $("#inq-intent").value, product_id: $("#inq-product").value, round: 1, inquiry_id: state.inqId });
    state.inq.history = [r]; state.inq.view = 0; $("#inq-bench").classList.add("collapsed");
  } catch (e) { toast(e.message); }
  state.inq.busy = false; busy(btn, false); renderInquiry();
}

function fixInstruction(ins, lines) {
  return ins.includes("风险提示") ? ins + "\n风险提示：\n" + lines.join("\n") : ins;
}

async function reviseInquiry() {
  const st = state.inq;
  const ins = $("#inq-ins").value.trim();
  if (!ins) return $("#inq-ins").focus();
  if (st.busy) return;
  st.busy = true; busy($("#inq-rev"), true, "修改并重新校验…");
  try {
    const p = st.history[st.history.length - 1];
    const instruction = fixInstruction(ins, p.findings.map((f, i) => `${i + 1}. ${f.problem_zh}（原文：${f.quote}）建议：${f.suggestion_zh}`));
    const r = await api("/api/inquiry", { inquiry_text: $("#inq-text").value, intent_zh: $("#inq-intent").value, product_id: $("#inq-product").value,
      understanding: p.understanding, language: p.language, previous: { reply: p.reply, internal_brief_zh: p.internal_brief_zh }, instruction_zh: instruction, round: p.round + 1, inquiry_id: state.inqId });
    st.history.push(r); st.view = st.history.length - 1;
    toast(`第 ${r.round} 轮完成：${RISK[r.risk]}`, "ok");
  } catch (e) { toast(e.message); }
  st.busy = false; renderInquiry();
}

// ------------------------------------------------------------------ B: listing
function renderProducts() {
  $("#lst-products").innerHTML = META.products.map((p) => `<button class="product" data-id="${p.id}"><b>${esc(p.name_zh)}${isCustom(p) ? ' <span class="badge brand">新增</span>' : ""}</b><span>${factoryOf(p) ? `另一家工厂：${esc(factoryOf(p).name_zh)} · ` : ""}MOQ ${p.moq_units} · ${esc(p.certifications_held.join(" / "))}</span></button>`).join("")
    + `<button class="product add" id="lst-add">${ic("package", "sm")}<b>新增商品</b><span>填资料卡，生成要在实时模式下</span></button>`;
  $$("#lst-products .product[data-id]").forEach((b) => b.addEventListener("click", () => pickProduct(b.dataset.id)));
  $("#lst-add").addEventListener("click", () => openProductForm());
  pickProduct(META.products.some((p) => p.id === state.lstProduct) ? state.lstProduct : META.products[0].id);
}
function renderListingOptions() {
  const { platforms, languages } = META.listing_catalog;
  let saved = {};
  try { saved = JSON.parse(store.get("td-listing-targets") || "{}"); } catch (e) { saved = {}; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  $("#lst-amz")?.closest(".toggle")?.remove();
  $("#lst-tt")?.closest(".toggle")?.remove();
  $("#page-listing .page-head p").textContent = "工作流 B · 一份中文产品资料 → 多个平台，可分别选择输出语言";
  $("#lst-platform-options").innerHTML = Object.entries(platforms).map(([id, p]) => {
    const checked = typeof saved[id]?.selected === "boolean" ? saved[id].selected : !!p.default_selected;
    const language = languages[saved[id]?.language] ? saved[id].language : p.default_language;
    return `<div class="listing-platform" data-platform="${id}">
      <label class="listing-platform-check"><input type="checkbox" data-platform-select ${checked ? "checked" : ""}><span>${esc(p.name)}</span></label>
      <select data-platform-language aria-label="${esc(p.name)}输出语言">${Object.entries(languages).map(([code, lang]) =>
        `<option value="${code}" ${code === language ? "selected" : ""}>${esc(lang.name)}</option>`).join("")}</select></div>`;
  }).join("");
  const save = () => store.set("td-listing-targets", JSON.stringify(Object.fromEntries(
    $$("#lst-platform-options [data-platform]").map((row) => [row.dataset.platform, {
      selected: $("[data-platform-select]", row).checked,
      language: $("[data-platform-language]", row).value,
    }]),
  )));
  $$("#lst-platform-options [data-platform-select], #lst-platform-options [data-platform-language]").forEach((el) => el.addEventListener("change", save));
  const note = $("#lst-mode-note");
  note.hidden = META.llm.mode !== "replay";
  note.textContent = "离线回放仅适用于已录制的完全相同请求。目前已有缓存覆盖部分 Amazon 美国站英语和 TikTok 墨西哥西语示例；其他平台、语言、产品或修改轮次需要先联网录制。";
}
function pickProduct(id) {
  state.lstProduct = id;
  $$("#lst-products .product").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  $("#lst-card").textContent = JSON.stringify(META.products.find((p) => p.id === id), null, 1);
}

function amazonPreview(d, showUsTitleLimit = false) {
  const f = d.findings, c = d.content || {};
  const bullets = (c.bullets || []).map((b, i) => `<li>${highlight(b, f, `bullets[${i + 1}]`)}</li>`).join("");
  const len = (c.title || "").length;
  return `<div class="amz-preview"><div class="fieldlab">标题 ${showUsTitleLimit ? `<span class="badge ${len > 75 ? "red" : "green"}">${len} / 75 字符</span>` : ""}</div>
    <div class="t">${highlight(c.title, f, "title")}</div>
    <div class="fieldlab">五点描述</div><ul>${bullets}</ul>
    <div class="fieldlab">描述</div><div class="desc">${highlight(c.description, f, "description")}</div>
    <div class="fieldlab">后台搜索词</div><div class="st mono">${highlight(c.search_terms, f, "search_terms")}</div></div>`;
}

function tiktokPreview(d) {
  const f = d.findings, c = d.content || {};
  const shots = (c.script || []).map((s, i) => `<div class="shot"><div class="s">${ic("play", "sm")}镜头 ${i + 1} · ${esc(s.shot_zh || "")}</div><div>${highlight(s.line || "", f, `script[${i + 1}]`)}</div></div>`).join("");
  return `<div class="phone-wrap"><div class="phone"><div class="screen"><div class="notch"></div>
      <div class="hook">${esc(c.hook || "")}</div>
      <svg class="kettle" width="90" height="90" viewBox="0 0 24 24" fill="none" stroke="#cfe0ff" stroke-width="1.2"><path d="M7 8h9l1 11H6z"/><path d="M16 10c2.5 0 3 3 1 4"/><path d="M8 8l1-3h5l1 3"/></svg>
      <div class="cap">${esc((c.caption || "").slice(0, 110))}</div><div class="tags">${esc((c.hashtags || []).join(" "))}</div>
      <div class="rail"><i></i><i></i><i></i></div></div></div>
    <div style="min-width:0"><div class="fieldlab">开场 3 秒</div><div class="shot">${highlight(c.hook, f, "hook")}</div>
      <div class="fieldlab">分镜脚本</div><div class="shots">${shots}</div>
      <div class="fieldlab">发布文案</div><div class="shot">${highlight(c.caption, f, "caption")}</div>
      <div class="fieldlab">话题</div><div class="shot mono">${highlight((c.hashtags || []).join(" "), f, "hashtags")}</div></div></div>`;
}

function genericListingPreview(d) {
  const f = d.findings, c = d.content || {};
  const bullets = (c.bullets || []).map((b, i) => `<li>${highlight(b, f, `bullets[${i + 1}]`)}</li>`).join("");
  const keywords = Array.isArray(c.keywords)
    ? c.keywords.map((word, i) => highlight(word, f, `keywords[${i + 1}]`)).join(", ")
    : highlight(c.keywords || "", f, "keywords");
  return `<div class="generic-listing-preview"><div class="fieldlab">标题</div><h3>${highlight(c.title, f, "title")}</h3>
    <div class="fieldlab">简短描述</div><div>${highlight(c.short_description, f, "short_description")}</div>
    <div class="fieldlab">卖点</div><ul>${bullets}</ul><div class="fieldlab">商品描述</div><div class="desc">${highlight(c.description, f, "description")}</div>
    <div class="fieldlab">关键词</div><div class="mono">${highlight(keywords, f, "keywords")}</div></div>`;
}

function renderListing() {
  const st = state.lst;
  $("#lst-rounds").innerHTML = roundsHtml(st, "lst");
  $$("#lst-rounds [data-round]").forEach((b) => b.addEventListener("click", () => { st.view = +b.dataset.round.split(":")[1]; renderListing(); }));
  if (!st.history.length) {
    $("#lst-out").innerHTML = emptyCard("store", "选择产品与上架渠道", ["可为每个渠道分别选择文案输出语言。", "生成的文案会按已有规则和产品资料逐项校验。"]);
    return;
  }
  const r = st.history[st.view];
  const latest = st.view === st.history.length - 1;
  const names = r.trace.map((t) => `${t.role}`);
  const cards = Object.entries(r.platforms).map(([p, d]) => {
    const P = META.listing_catalog.platforms[p];
    const format = P.kind === "tiktok" ? "短视频脚本" : "商品 Listing";
    const hasDiff = d.diff && Object.values(d.diff).some((ops) => ops.some((o) => o.op !== "equal"));
    return `<div class="card" data-scope data-plat="${p}" dir="${d.language === "ar" ? "rtl" : "auto"}">
      <div class="card-h"><div class="plat"><span class="pl ${P.kind === "amazon" ? "amz" : P.kind === "tiktok" ? "tt" : "other"}">${P.kind === "amazon" ? "a" : P.kind === "tiktok" ? "♪" : "店"}</span><div><h3>${esc(d.platform_name || P.name)}</h3><p>${esc(d.language_name || META.listing_catalog.languages[d.language]?.name || "")} · ${format}</p></div></div>
        <div class="row"><div class="seg"><button class="on" data-v="pre">预览</button><button data-v="diff" ${hasDiff ? "" : "disabled"}>对比</button></div><span class="badge ${d.risk}">${RISK[d.risk]}</span></div></div>
      <div data-view="pre">${P.kind === "amazon" ? amazonPreview(d, true) : P.kind === "tiktok" ? tiktokPreview(d) : genericListingPreview(d)}</div>
      <div data-view="diff" hidden class="card-b">${d.diff ? Object.entries(d.diff).filter(([, ops]) => ops.some((o) => o.op !== "equal")).map(([k, ops]) => `<div class="fieldlab">${esc(k)}</div><div class="doc compact diff">${diffHtml(ops)}</div>`).join("") : ""}</div>
      <div class="sep" style="margin:0"></div>${riskPanel(d)}</div>`;
  }).join("");
  $("#lst-out").innerHTML = `<div class="card"><div class="steps-wrap">${stepsBar(names, r.trace, false)}${editBtn("lst-bench")}</div>
      ${!latest ? `<div class="callout" style="margin:12px 16px">${ic("info")}<div>正在查看第 ${st.view + 1} 轮（历史）。</div></div>` : ""}</div>
    <div class="grid ${Object.keys(r.platforms).length > 1 ? "g2" : ""}" style="margin-top:16px;align-items:start">${cards}</div>
    ${latest && r.board_channels?.length ? `<div class="card journey"><div class="card-b"><span class="ji">${ic("package")}</span>
      <div class="jt"><b>支持的渠道已写入商品看板</b><span>Amazon 美国站与 TikTok 墨西哥的最新检查结果会显示在看板中</span></div>
      <button class="btn sm primary" data-go-board>${ic("package", "sm")}去商品看板</button></div></div>` : ""}
    ${latest ? composer("lst", ["按风险提示全部修改", "标题更简洁，突出核心卖点", ...(Object.keys(r.platforms).includes("tiktok_mx") ? ["TikTok 开头更抓人一点"] : [])], st.history.length + 1) : ""}`;
  $$("#lst-out [data-plat]").forEach((card) => $$(".seg button", card).forEach((b) => b.addEventListener("click", () => {
    $$(".seg button", card).forEach((x) => x.classList.toggle("on", x === b));
    $$("[data-view]", card).forEach((v) => (v.hidden = v.dataset.view !== b.dataset.v));
  })));
  wireLinks($("#lst-out")); wireEdit($("#lst-out"));
  $$("#lst-out [data-go-board]").forEach((b) => b.addEventListener("click", () => go("board")));
  if (latest) wireComposer("lst", reviseListing);
  if (latest && state.handoffHtml) $("#lst-out").insertAdjacentHTML("afterbegin", state.handoffHtml);
}

const selectedPlatforms = () => $$("#lst-platform-options [data-platform]").filter((row) => $("[data-platform-select]", row).checked).map((row) => row.dataset.platform);
const selectedLanguages = (platforms) => Object.fromEntries(platforms.map((id) => [id, $("[data-platform-language]", $(`#lst-platform-options [data-platform='${id}']`)).value]));

async function runListing() {
  if (state.lst.busy) return;
  const plats = selectedPlatforms();
  if (!plats.length) return toast("至少选一个平台");
  const languages = selectedLanguages(plats);
  const btn = $("#lst-run");
  state.lst.busy = true; busy(btn, true, "生成中…");
  $("#lst-out").innerHTML = loadingCard(plats.flatMap((p) => [`${META.listing_catalog.platforms[p].name} · 生成`, "合规审核"]));
  try {
    const r = await api("/api/listing", { product_id: state.lstProduct, platforms: plats, languages, round: 1 });
    state.lst.history = [r]; state.lst.view = 0; $("#lst-bench").classList.add("collapsed");
  } catch (e) { toast(e.message); }
  state.handoffHtml = "";
  state.lst.busy = false; busy(btn, false); renderListing();
  await showHandoff();
}

async function reviseListing() {
  const st = state.lst;
  const ins = $("#lst-ins").value.trim();
  if (!ins) return $("#lst-ins").focus();
  if (st.busy) return;
  st.busy = true; busy($("#lst-rev"), true, "修改并重新校验…");
  try {
    const p = st.history[st.history.length - 1];
    const instruction = fixInstruction(ins, Object.entries(p.platforms).flatMap(([pl, d]) => d.findings.map((f) => `[${pl}] ${f.field}：${f.problem_zh}（原文：${f.quote}）建议：${f.suggestion_zh}`)));
    const previous = Object.fromEntries(Object.entries(p.platforms).map(([pl, d]) => [pl, { content: d.content }]));
    const platforms = Object.keys(p.platforms);
    const languages = Object.fromEntries(platforms.map((id) => [id, p.platforms[id].language]));
    const r = await api("/api/listing", { product_id: state.lstProduct, platforms, languages, previous, instruction_zh: instruction, round: p.round + 1 });
    st.history.push(r); st.view = st.history.length - 1;
    toast(`第 ${r.round} 轮完成`, "ok");
  } catch (e) { toast(e.message); }
  state.handoffHtml = "";
  st.busy = false; renderListing();
  await showHandoff();
}

// ------------------------------------------------------------------ check
function renderCheckControls() {
  const SHORT = { alibaba_rfq: "阿里国际站", amazon_us: "Amazon US", tiktok_mx: "TikTok MX", amazon_uk: "Amazon UK", amazon_de: "Amazon DE", amazon_jp: "Amazon JP", ebay: "eBay", shopify: "Shopify", etsy: "Etsy", walmart_us: "Walmart US", mercadolibre_mx: "Mercado Libre", aliexpress: "AliExpress" };
  $("#chk-platform").innerHTML = Object.keys(META.platforms).map((k) => `<button data-p="${k}" class="${k === state.chkPlatform ? "on" : ""}">${esc(SHORT[k] || k)}</button>`).join("");
  $$("#chk-platform button").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); state.chkPlatform = b.dataset.p; renderCheckControls(); }));
}
async function runCheck() {
  const btn = $("#chk-run");
  busy(btn, true, "检查中…");
  try {
    const r = await api("/api/check", { platform: state.chkPlatform, product_id: $("#chk-product").value, text: $("#chk-text").value });
    $("#chk-bench").classList.add("collapsed");
    $("#chk-out").innerHTML = `<div class="result" data-scope><div class="stack"><div class="card"><div class="card-h"><h3>${ic("file-text")}待检查文案</h3><div class="row"><span class="badge">${esc(META.platforms[state.chkPlatform])}</span>${editBtn("chk-bench")}</div></div>
      <div class="doc">${highlight(r.fields.text, r.findings, "text")}</div></div>${factsCard($("#chk-product").value, r.findings)}</div><div class="card">${riskPanel(r)}</div></div>`;
    wireLinks($("#chk-out")); wireEdit($("#chk-out")); wireFacts($("#chk-out"));
  } catch (e) { toast(e.message); }
  busy(btn, false);
}


// ------------------------------------------------------------------ product board
const CH = {
  image: { name: "主图", sub: "Amazon 主图要求", icon: "scan-search" },
  amazon_us: { name: "Amazon 美国站", sub: "英语 · Listing", icon: "store" },
  tiktok_mx: { name: "TikTok 墨西哥", sub: "西语 · 种草视频", icon: "play" },
};
const boardState = { data: null, selected: new Set(), running: new Set(), busy: false };
const priceRange = (p) => { const v = Object.values(p.fob_ningbo_usd || {}); return v.length ? `FOB $${Math.min(...v).toFixed(2)}–${Math.max(...v).toFixed(2)}` : ""; };

async function renderBoard() {
  boardState.data = await api("/api/board");
  const rows = boardState.data.rows;
  const cells = rows.flatMap((r) => Object.values(r.cells));
  const n = (f) => cells.filter(f).length;
  // Numbers that changed since the last render get a +N / −N chip and a pulse, so a new product or a fresh check is visible at a glance.
  const vals = { products: rows.length, ok: n((c) => c.risk === "green" || c.listed), amber: n((c) => c.risk === "amber" && !c.listed),
    red: n((c) => c.risk === "red"), none: n((c) => !c.risk) };
  const prev = boardState.prevStats; boardState.prevStats = vals;
  const changed = (key) => prev && vals[key] !== prev[key];
  const chip = (key) => (changed(key) ? `<span class="delta ${vals[key] > prev[key] ? "up" : "down"}">${vals[key] > prev[key] ? "+" : "−"}${Math.abs(vals[key] - prev[key])}</span>` : "");
  const stat = (key, k, iconName, v, d, cls = "") => `<div class="card stat${changed(key) ? " bump" : ""}"><div class="k">${esc(k)}${ic(iconName)}</div><div class="v ${cls}">${v}${chip(key)}</div><div class="d">${d}</div></div>`;
  $("#board-stats").innerHTML =
    stat("products", "产品", "package", vals.products, `${cells.length} 个渠道格子`) +
    stat("ok", "可上架 / 已上架", "circle-check-big", vals.ok, `其中已上架 ${n((c) => c.listed)}`, "green") +
    stat("amber", "需人工确认", "triangle-alert", vals.amber, "黄色：有依据的风险点", "amber") +
    stat("red", "不能发", "shield-alert", vals.red, "红色：明确违反规则", "red") +
    stat("none", "未生成 / 未上传", "circle-dot", vals.none, "点格子开始");
  $("#board-body").innerHTML = rows.map((r) => {
    const p = META.products.find((x) => x.id === r.product_id);
    const thumb = r.has_image ? `<img src="/api/image/${r.product_id}?t=${Date.now()}" alt="">` : ic("package", "lg");
    const cellHtml = (ch) => {
      const c = r.cells[ch];
      const key = `${r.product_id}:${ch}`;
      if (boardState.running.has(key)) return `<button class="cell running" disabled><span class="st">${ic("loader-circle", "sm spin")}生成并校验中…</span><span class="meta">请稍候</span></button>`;
      if (!c.risk) return `<button class="cell none" data-cell="${key}"><span class="st"><i></i>${ch === "image" ? "未上传" : "未生成"}</span><span class="meta">${ch === "image" ? "上传主图检查" : "点击生成"}</span></button>`;
      const cls = c.listed ? "listed" : c.risk;
      const counts = [c.red ? `<span class="badge red">红 ${c.red}</span>` : "", c.amber ? `<span class="badge amber">黄 ${c.amber}</span>` : ""].join("");
      return `<button class="cell ${cls}" data-cell="${key}"><span class="st"><i></i>${esc(c.status)}</span><span class="meta">${counts || '<span class="badge green">0 风险</span>'}<span>${esc((c.updated || "").slice(5))}</span></span></button>`;
    };
    return `<tr class="${boardState.selected.has(r.product_id) ? "sel" : ""}${boardState.flash === r.product_id ? " flash" : ""}" data-row="${esc(r.product_id)}"><td><input type="checkbox" class="ck" data-sel="${r.product_id}" ${boardState.selected.has(r.product_id) ? "checked" : ""}></td>
      <td><div class="prod"><div class="thumb">${thumb}</div><div><b>${esc(p.name_zh)}${isCustom(p) ? ` <button class="btn sm ghost" data-edit="${esc(p.id)}">${ic("file-text", "sm")}编辑</button>` : ""}</b><span>${esc(p.id)} · ${esc(p.name_en)}</span><span>MOQ ${p.moq_units} · ${esc(priceRange(p))}</span></div></div></td>
      <td>${cellHtml("image")}</td><td>${cellHtml("amazon_us")}</td><td>${cellHtml("tiktok_mx")}</td></tr>`;
  }).join("");
  $$("#board-body [data-cell]").forEach((b) => b.addEventListener("click", () => { const [pid, ch] = b.dataset.cell.split(":"); openCell(pid, ch); }));
  $$("#board-body [data-edit]").forEach((b) => b.addEventListener("click", () => openProductForm(b.dataset.edit)));
  if (boardState.flash) { $(`#board-body tr[data-row="${boardState.flash}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); boardState.flash = null; }
  $$("#board-body [data-sel]").forEach((c) => c.addEventListener("change", () => {
    c.checked ? boardState.selected.add(c.dataset.sel) : boardState.selected.delete(c.dataset.sel); renderBoard();
  }));
  $("#board-all").checked = boardState.selected.size === rows.length;
  const label = $("#board-batch-label"); // absent while the button shows its spinner
  if (label) label.textContent = boardState.selected.size ? `批量生成选中的 ${boardState.selected.size} 个产品` : "批量生成全部 Listing";
}

async function runBatch() {
  if (boardState.busy) return;
  const ids = boardState.selected.size ? [...boardState.selected] : META.products.map((p) => p.id);
  boardState.busy = true; busy($("#board-batch"), true, "批量生成中…");
  let done = 0; const total = ids.length;
  const bar = () => { $("#board-progress").innerHTML = `<div class="progress"><i style="width:${(done / total) * 100}%"></i></div><div class="small muted">${done} / ${total} 个产品完成 · 每个产品生成 Amazon + TikTok 两个平台并逐条校验</div>`; };
  bar();
  try {
    for (const pid of ids) {
      ["amazon_us", "tiktok_mx"].forEach((ch) => boardState.running.add(`${pid}:${ch}`));
      await renderBoard();
      try { await api("/api/listing", { product_id: pid, platforms: ["amazon_us", "tiktok_mx"], round: 1 }); }
      catch (e) { toast(`${pid}：${e.message}`); }
      ["amazon_us", "tiktok_mx"].forEach((ch) => boardState.running.delete(`${pid}:${ch}`));
      done++; bar(); await renderBoard();
    }
    toast(`批量生成完成：${total} 个产品`, "ok");
  } catch (e) {
    toast(`批量生成中断：${e.message}`);
  } finally {
    boardState.running.clear(); boardState.busy = false; busy($("#board-batch"), false); renderBoard();
  }
  setTimeout(() => { $("#board-progress").innerHTML = ""; }, 4000);
}

function closeSheet() { $("#sheet").classList.remove("on"); $("#scrim").classList.remove("on"); $("#sheet").setAttribute("aria-hidden", "true"); }
function openSheet(head, body, foot) {
  $("#sheet-h").innerHTML = head + `<div style="margin-left:auto"></div><button class="btn icon ghost" id="sheet-x" title="关闭">${ic("x")}</button>`;
  $("#sheet-b").innerHTML = body; $("#sheet-f").innerHTML = foot || "";
  $("#sheet").classList.add("on"); $("#scrim").classList.add("on"); $("#sheet").setAttribute("aria-hidden", "false");
  $("#sheet-x").addEventListener("click", closeSheet);
}

function sheetHead(p, ch) {
  const C = CH[ch];
  return `<div class="thumb" style="width:40px;height:40px">${ic(C.icon)}</div><div><h3>${esc(p.name_zh)} · ${esc(C.name)}</h3><p>${esc(p.id)} · ${esc(C.sub)}</p></div>`;
}

async function openCell(pid, ch) {
  const p = META.products.find((x) => x.id === pid);
  const row = boardState.data.rows.find((r) => r.product_id === pid);
  const cell = row.cells[ch];
  if (ch === "image") return openImageCell(p, row, cell);
  if (!cell.risk) {
    openSheet(sheetHead(p, ch), emptyCard(CH[ch].icon, "这个渠道还没有生成", ["点下方按钮，按资料卡生成并逐条校验。"]),
      `<button class="btn primary" id="cell-gen">${ic("sparkles", "sm")}生成并校验</button>`);
    $("#cell-gen").addEventListener("click", () => regenCell(pid, ch));
    return;
  }
  const r = await api(`/api/board/cell?product=${pid}&channel=${ch}`);
  const preview = ch === "amazon_us" ? amazonPreview(r) : tiktokPreview(r);
  openSheet(sheetHead(p, ch) + `<span class="badge ${r.risk}" style="margin-left:8px">${esc(cell.status)}</span>`,
    `<div class="card" data-scope>${preview}<div class="sep" style="margin:0"></div>${riskPanel(r)}</div>`,
    `<span class="small muted" style="margin-right:auto">第 ${r.round || 1} 轮 · ${esc(cell.updated || "")}</span>
     <button class="btn" id="cell-open">${ic("store", "sm")}在上架页修改</button>
     <button class="btn" id="cell-regen">${ic("history", "sm")}重新生成</button>
     <button class="btn primary" id="cell-list" ${r.risk === "red" && !cell.listed ? 'disabled title="红色不能标记上架"' : ""}>${ic("circle-check-big", "sm")}${cell.listed ? "取消已上架" : "标记已上架"}</button>`);
  wireLinks($("#sheet-b"));
  $("#cell-regen").addEventListener("click", () => regenCell(pid, ch));
  $("#cell-open").addEventListener("click", () => { closeSheet(); go("listing"); pickProduct(pid); });
  $("#cell-list").addEventListener("click", async () => {
    try { await api("/api/board/mark", { product_id: pid, channel: ch, listed: !cell.listed }); toast(cell.listed ? "已取消上架标记" : "已标记为已上架", "ok"); closeSheet(); renderBoard(); }
    catch (e) { toast(e.message); }
  });
}

async function regenCell(pid, ch) {
  closeSheet();
  boardState.running.add(`${pid}:${ch}`); await renderBoard();
  try { await api("/api/listing", { product_id: pid, platforms: [ch], round: 1 }); toast("生成并校验完成", "ok"); }
  catch (e) { toast(e.message); }
  boardState.running.delete(`${pid}:${ch}`); boardState.flash = pid; renderBoard();
}

function metricHtml(m) {
  if (!m) return `<div class="callout warn">${ic("triangle-alert")}<div>本机没有安装 Pillow，像素检查没有运行。</div></div>`;
  const cls = (ok, warn) => (ok ? "ok" : warn ? "warn" : "bad");
  return `<div class="metrics">
    <div class="metric ${cls(m.longest_side >= 1000, m.longest_side >= 500)}"><span>尺寸（最长边 ≥500，≥1000 可放大）</span><b>${m.width} × ${m.height}</b></div>
    <div class="metric ${cls(m.white_border >= 0.98)}"><span>四周白色比例（纯白背景）</span><b>${(m.white_border * 100).toFixed(1)}%</b></div>
    ${m.background_ok === false ? `<div class="metric"><span>产品占画面 / 是否贴边</span><b class="muted" style="font-size:13px">背景不是白色，无法估算</b></div>` : `
    <div class="metric ${cls(m.fill >= 0.85, true)}"><span>产品占画面（外接框估算，≥85%）</span><b>${(m.fill * 100).toFixed(1)}%</b></div>
    <div class="metric ${cls(!m.touches_edge, true)}"><span>产品是否贴边（可能被裁切）</span><b>${m.touches_edge ? "贴边" : "完整"}</b></div>`}</div>`;
}

async function openImageCell(p, row, cell) {
  let r = cell.risk ? await api(`/api/board/cell?product=${p.id}&channel=image`) : null;
  const samples = (boardState.data.samples || []).slice().sort((a, b) => (b.startsWith(p.id) - a.startsWith(p.id)));
  let chosen = null;
  const bbox = (m) => (m && m.bbox && m.background_ok !== false ? `<div class="bb" style="left:${m.bbox[0] * 100}%;top:${m.bbox[1] * 100}%;width:${m.bbox[2] * 100}%;height:${m.bbox[3] * 100}%"><span>产品区域 ${(m.fill * 100).toFixed(0)}%</span></div>` : "");
  const body = () => `
    ${r ? `<div class="grid g2" style="align-items:start"><div class="stack"><div class="imgbox"><img src="/api/image/${p.id}?t=${Date.now()}" alt="主图">${bbox(r.metrics)}</div>${metricHtml(r.metrics)}
        ${r.description_zh ? `<div class="small muted">${ic("sparkles", "sm")} 模型看到的：${esc(r.description_zh)}</div>` : ""}</div>
      <div class="card" data-scope>${riskPanel(r)}</div></div>` : emptyCard("scan-search", "还没有上传主图", ["选一张示例图，或上传自己的图片，按 Amazon 美国站主图要求检查。"])}
    <div class="card"><div class="card-h"><div><h3>${ic("file-text")}换一张图检查</h3><p>示例图都是示意图（不是实拍照片），用来演示各种情况</p></div></div>
      <div class="card-b"><div class="samples-pick" id="pick">${samples.map((s) => `<button data-s="${s}" title="${s}"><img src="samples/${s}" alt="${s}"></button>`).join("")}
        <label class="btn" style="height:72px">${ic("file-text", "sm")}上传图片<input type="file" accept="image/png,image/jpeg,image/webp" id="pick-file" hidden></label></div>
        <div class="small muted" id="pick-name" style="margin-top:8px">未选择</div></div></div>`;
  const render = () => {
    openSheet(sheetHead(p, "image") + (r ? `<span class="badge ${r.risk}" style="margin-left:8px">${esc(RISK[r.risk])}</span>` : ""), body(),
      `<span class="small muted" style="margin-right:auto">代码测尺寸、白底、占比、贴边；模型只看文字、徽章、道具、是否实拍</span>
       ${r ? `<button class="btn" id="img-list" ${r.risk === "red" && !cell.listed ? 'disabled title="红色不能标记上架"' : ""}>${ic("circle-check-big", "sm")}${cell.listed ? "取消已上架" : "标记已上架"}</button>` : ""}
       <button class="btn primary" id="img-run" disabled>${ic("scan-search", "sm")}检查这张图</button>`);
    if (r) {
      wireLinks($("#sheet-b"));
      $("#img-list")?.addEventListener("click", async () => {
        try { await api("/api/board/mark", { product_id: p.id, channel: "image", listed: !cell.listed }); closeSheet(); renderBoard(); } catch (e) { toast(e.message); }
      });
    }
    const pickReady = (name) => { $("#pick-name").textContent = `已选择：${name}`; $("#img-run").disabled = false; };
    $$("#pick [data-s]").forEach((b) => b.addEventListener("click", async () => {
      $$("#pick [data-s]").forEach((x) => x.classList.toggle("on", x === b));
      const blob = await fetch(`samples/${b.dataset.s}`).then((x) => x.blob());
      chosen = { name: b.dataset.s, url: await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); }) };
      pickReady(b.dataset.s);
    }));
    $("#pick-file").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 8 * 1024 * 1024) return toast("图片太大（>8MB）");
      const fr = new FileReader(); fr.onload = () => { chosen = { name: f.name, url: fr.result }; pickReady(f.name); }; fr.readAsDataURL(f);
    });
    $("#img-run").addEventListener("click", async () => {
      if (!chosen) return;
      busy($("#img-run"), true, "测量像素、看图审核中…");
      try { r = await api("/api/image-check", { product_id: p.id, image: chosen.url, name: chosen.name }); cell.listed = false; toast(`主图检查完成：${RISK[r.risk]}`, "ok"); boardState.flash = p.id; renderBoard(); render(); }
      catch (e) { toast(e.message); busy($("#img-run"), false); }
    });
  };
  render();
}


// ------------------------------------------------------------------ inbox & tasks
let inboxTab = "list", taskRole = "全部", taskInquiry = null;
function showInboxTab(v) {
  inboxTab = v;
  $$("#inbox-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  $("#inbox-list").hidden = v !== "list"; $("#inbox-tasks").hidden = v !== "tasks";
}

async function renderInbox() {
  const data = await api("/api/inbox");
  const open = data.tasks.filter((t) => t.status !== "已完成").length;
  $("#task-count").textContent = data.tasks.length ? `(${open})` : "";
  const triaged = data.items.filter((x) => x.priority).length;
  $("#inbox-list").innerHTML = `<div class="card">${data.items.map((x) => {
    const q = x.inquiry, p = x.priority, u = x.understanding || {};
    const b = u.buyer || {};
    const reds = (u.conflicts || []).filter((c) => c.severity === "red").length, ambers = (u.conflicts || []).length - reds;
    const reply = x.reply ? `<span class="badge ${x.reply.risk}">已生成第 ${x.reply.round} 轮 · ${RISK[x.reply.risk]}</span>` : `<span class="badge">未回复</span>`;
    const why = p ? `<details><summary class="small muted" style="cursor:pointer;margin-top:6px">为什么是 ${p.score} 分</summary><div class="why"><div><span class="d">50</span><span>基础分</span></div>${p.components.map((c) => `<div><span class="d ${c.delta > 0 ? "p" : "n"}">${c.delta > 0 ? "+" : ""}${c.delta}</span><span>${esc(c.label_zh)}${c.quote ? ` <span class="muted">“${esc(c.quote)}”</span>` : ""}</span></div>`).join("")}</div></details>` : "";
    return `<div class="mail"><div class="prio ${p ? p.level : "none"}"${p ? ` style="--p:${Math.max(0, Math.min(100, p.score))}"` : ""}>${p ? `${p.score}<small>${p.level}优先</small>` : "未整理"}</div>
      <div class="body"><b>${flagOf(q)} ${esc(q.label_zh)}</b>${q.imported ? ' <span class="badge brand">导入</span>' : ""} <span class="small muted">${esc(q.id)} · ${esc(b.country_guess || "")} ${esc(b.business_type_zh || "")}</span>
        <div class="sum">${esc(u.summary_zh || "")}</div><div class="q">${esc(q.text)}</div>${why}</div>
      <div class="side">${reds ? `<span class="badge red">硬冲突 ${reds}</span>` : ""}${ambers ? `<span class="badge amber">待确认 ${ambers}</span>` : ""}${reply}
        <button class="btn sm" data-open="${esc(q.id)}">${ic("send", "sm")}处理</button></div></div>`;
  }).join("")}</div>
  <p class="small muted" style="margin-top:8px">已整理 ${triaged} / ${data.items.length} 条。分数 = 50 + 正面信号 ×8 − 负面信号 ×8 − 硬冲突 ×6 − 待确认 ×3 + 数量加分（≥MOQ +8，≥3×MOQ +15，低于 MOQ −10），限制在 0–100。</p>`;
  $$("#inbox-list [data-open]").forEach((b) => b.addEventListener("click", () => {
    const i = META.inquiries.findIndex((q) => q.id === b.dataset.open);
    go("inquiry"); pickSample(i); runInquiry();
  }));
  const roles = ["全部", ...new Set(data.tasks.map((t) => t.role_zh))];
  const tasks = data.tasks.filter((t) => (taskRole === "全部" || t.role_zh === taskRole) && (!taskInquiry || t.inquiry_id === taskInquiry));
  const col = (st) => `<div class="col"><h4><span>${st}</span><span class="muted">${tasks.filter((t) => t.status === st).length}</span></h4>${tasks.filter((t) => t.status === st).map((t) => {
    const i = data.task_status.indexOf(st);
    return `<div class="task"><div class="row"><span class="badge brand">${esc(t.role_zh)}</span>${t.priority === "high" ? '<span class="badge red">急</span>' : ""}<span class="small muted" style="margin-left:auto">${esc(t.inquiry_id)}</span></div>
      <div style="margin-top:6px">${esc(t.task_zh)}</div><div class="q">“${esc(t.quote)}”</div>
      <div class="acts"><button class="btn sm ghost" data-mv="${t.id}:${i - 1}" ${i === 0 ? "disabled" : ""}>←</button><span class="small muted">${esc(t.inquiry_label_zh)}</span><button class="btn sm ghost" data-mv="${t.id}:${i + 1}" ${i === 2 ? "disabled" : ""}>→</button></div></div>`;
  }).join("") || '<div class="small muted" style="padding:6px">空</div>'}</div>`;
  $("#inbox-tasks").innerHTML = data.tasks.length ? `<div class="chips" style="margin-bottom:12px">${roles.map((r) => `<button class="chip ${r === taskRole ? "on" : ""}" data-role="${esc(r)}">${esc(r)}</button>`).join("")}${taskInquiry ? `<span class="chip on">只看 ${esc(taskInquiry)} 的任务</span><button class="chip" id="task-all">显示全部询盘</button>` : ""}</div>
    <div class="kanban">${data.task_status.map(col).join("")}</div>`
    : emptyCard("building-2", "还没有任务", ["处理询盘时，系统会把需要采购、生产、美工跟进的事拆成任务，每条都挂着询盘原文。"]);
  $$("#inbox-tasks [data-role]").forEach((b) => b.addEventListener("click", () => { taskRole = b.dataset.role; renderInbox(); }));
  $("#task-all")?.addEventListener("click", () => { taskInquiry = null; renderInbox(); });
  $$("#inbox-tasks [data-mv]").forEach((b) => b.addEventListener("click", async () => {
    const [id, i] = b.dataset.mv.split(":");
    try { await api("/api/tasks/status", { id, status: data.task_status[+i] }); renderInbox(); } catch (e) { toast(e.message); }
  }));
  showInboxTab(inboxTab);
}

async function runTriage() {
  const btn = $("#inbox-triage");
  busy(btn, true, "理解每条询盘并打分…");
  $("#inbox-progress").innerHTML = `<div class="progress"><i style="width:35%"></i></div><div class="small muted">询盘分析员逐条读询盘，代码按公式打分…</div>`;
  try {
    const r = await api("/api/inbox/triage", {});
    toast(`已整理 ${r.triaged.length} 条询盘${r.failed?.length ? `；${r.failed.length} 条没有录好的结果（导入的新询盘要切到实时模式）` : ""}`, "ok");
  }
  catch (e) { toast(e.message); }
  $("#inbox-progress").innerHTML = ""; busy(btn, false); renderInbox();
}

// ------------------------------------------------------------------ eval
async function renderEval() {
  const data = await api("/api/eval");
  const onlyFails = $("#eval-fails").checked;
  const NAME = { dev: ["开发集", "边做边写，包含真实录制中出现过的误报句子；检查器是照着它修的，成绩偏乐观"],
    heldout: ["盲测集 1", "由没看过检查代码的人按规则说明写；它首次运行发现的 3 个缺陷已修复，所以现在的成绩不再是盲测成绩"],
    heldout2: ["盲测集 2", "修好盲测集 1 的问题后，另一个没看过代码、也没看过盲测集 1 的人写的；它首次运行发现的问题也已修复，剩 1 条已知局限"] };
  const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const sets = Object.entries(data.sets);
  const frs = data.first_runs || {};
  const cards = sets.map(([k, v]) => {
    const s = v.summary;
    return `<div class="card stat evset"><div class="k">${esc(NAME[k][0])}${ic(k === "dev" ? "file-text" : "shield-check")}</div>
      <div class="v">${s.passed} / ${s.cases} <small>用例全对</small></div>
      <div class="d">精确率 <b>${pct(s.precision)}</b> · 召回率 <b>${pct(s.recall)}</b> · 干净用例误报 ${s.clean_flagged}/${s.clean_cases}</div>
      <div class="d" style="margin-top:6px">${esc(NAME[k][1])}</div></div>`;
  }).join("");
  const first = Object.entries(frs).map(([k, fr]) => `<div class="callout warn" style="margin:12px 0 0">${ic("info")}<div><b>${esc(NAME[k][0])} 首次运行（修复前，${esc(fr.recorded)} 记录）：${fr.summary.passed}/${fr.summary.cases} 用例全对，精确率 ${pct(fr.summary.precision)}，召回率 ${pct(fr.summary.recall)}。</b>
    失败的用例：${fr.failures.map((f) => `${esc(f.id)}（期望 ${esc(f.expected.join("/") || "无")}，实际 ${esc(f.got.join("/") || "无")}）`).join("；")}。修复后都加了回归测试。</div></div>`).join("")
    + `<p class="small" style="margin:12px 0 0"><b>怎么读这些数字：</b>真正的盲测成绩是上面黄色框里的“首次运行”。修复之后的满分只说明这些缺陷不会再犯，不代表没见过的句子也全对。</p>`
    + (data.known_limits_zh || []).map((t) => `<div class="callout" style="margin:8px 0 0">${ic("triangle-alert")}<div><b>已知局限：</b>${esc(t)}</div></div>`).join("");
  const rows = sets.flatMap(([k, v]) => v.results.filter((r) => !onlyFails || !r.pass).map((r) => {
    const text = Object.entries(r.fields).map(([f, t]) => `<span class="muted">${esc(f)}:</span> ${esc(t)}`).join("<br>");
    const chip = (l, cls = "") => `<span class="mono-chip ${cls}" title="${esc(data.labels_zh[l] || l)}">${esc(l)}</span>`;
    const chips = (arr, cls = "") => arr.map((l) => chip(l, cls)).join("") || '<span class="small muted">无</span>';
    const got = [...r.got.filter((l) => r.expected.includes(l)).map((l) => chip(l)), ...r.false_alarm.map((l) => chip(l, "extra"))].join("") || '<span class="small muted">无</span>';
    return `<tr><td><span class="badge">${esc(NAME[k][0])}</span><div class="mono small" style="margin-top:4px">${esc(r.id)}</div></td><td><span class="badge">${esc(r.platform)}</span></td>
      <td class="small">${text}<div class="muted" style="margin-top:4px">${esc(r.why_zh)}</div></td>
      <td><div class="chipset">${chips(r.expected)}</div></td><td><div class="chipset">${got}</div>${r.missed.length ? `<div class="chipset" style="margin-top:4px">漏：${chips(r.missed, "miss")}</div>` : ""}</td>
      <td>${r.pass ? `<span class="badge green">${ic("circle-check-big", "sm")}对</span>` : `<span class="badge red">${ic("circle-x", "sm")}错</span>`}</td></tr>`;
  })).join("");
  $("#eval-out").innerHTML = `<div class="grid g3">${cards}</div>${first}
    <div class="card" style="margin-top:16px"><div class="board-wrap"><table class="tbl"><thead><tr><th>集合</th><th>平台</th><th>文本</th><th>标准答案</th><th>检查器结果</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="empty">全部通过</div></td></tr>'}</tbody></table></div></div>
    <p class="small muted" style="margin-top:8px">标签：${Object.entries(data.labels_zh).map(([k, v]) => `${k} = ${v}`).join("；")}；其余是知识库规则编号。模型审核层（语义判断、看图）不在这里评测，它的结果都要过出处守卫。</p>`;
}


// ------------------------------------------------------------------ eval tabs: comparison & red team
let evalTab = "compare";
function showEvalTab(v) {
  evalTab = v;
  $$("#eval-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  ["compare", "rules", "redteam", "savings"].forEach((k) => ($(`#eval-${k}`).hidden = k !== v));
  return ({ compare: renderCompare, rules: renderEval, redteam: renderRedteam, savings: renderSavings })[v]();
}

let BASE = null;
async function renderCompare() {
  try { BASE = await api("/api/baseline"); }
  catch (e) { $("#eval-compare").innerHTML = emptyCard("git-compare-arrows", "还没有运行对照实验", ["在 app 目录运行：python3 tools/run_baseline.py"]); return; }
  const arms = Object.keys(BASE.arms), S = BASE.summary;
  const max = Math.max(...arms.map((a) => S[a].replies), 1);
  const cards = arms.map((a) => {
    const s = S[a], bad = s.replies_with_red;
    const cls = bad ? "red" : s.amber ? "amber" : "green";
    return `<div class="card stat"><div class="k">${esc(BASE.arms[a].name_zh)}${ic(a.startsWith("tradedesk") ? "shield-check" : "sparkles")}</div>
      <div class="v ${cls}">${bad}<small> / ${s.replies} 条回复不能发</small></div>
      <div class="bar" style="grid-template-columns:1fr;margin:8px 0 4px"><span class="t"><i style="width:${(bad / max) * 100}%;background:hsl(var(--red))"></i></span></div>
      <div class="d">红色问题 <b>${s.red}</b>（代码规则 ${s.red_by_rules} · 模型审核 ${s.red_by_model}）· 黄色 ${s.amber} · 全绿 ${s.replies_green}</div>
      <div class="d" style="margin-top:6px">${esc(BASE.arms[a].desc_zh)}</div>
      ${Object.keys(s.red_by_label).length ? `<ul class="cmp-why">${Object.entries(s.red_by_label).map(([k, n]) => `<li title="${esc(k)}"><span class="by">${k.startsWith("模型:") ? "模型" : "代码"}</span><span class="nm">${esc((BASE.label_names_zh || {})[k] || k)}</span><b>${n}</b></li>`).join("")}</ul>` : ""}</div>`;
  }).join("");
  const rows = Object.entries(BASE.inquiries).map(([qid, q]) => `<tr><td><b>${FLAG[q.language] || ""} ${esc(q.label_zh)}</b><div class="small muted mono">${esc(qid)}</div></td>${arms.map((a) => {
    const it = BASE.rows[a].find((x) => x.inquiry_id === qid);
    if (!it) return "<td></td>";
    const reds = it.findings.filter((f) => f.severity === "red").length, ambers = it.findings.length - reds;
    return `<td><button class="cell ${it.risk}" data-cmp="${a}:${qid}" style="min-width:130px"><span class="st"><i></i>${RISK[it.risk]}</span><span class="meta">${reds ? `<span class="badge red">红 ${reds}</span>` : ""}${ambers ? `<span class="badge amber">黄 ${ambers}</span>` : ""}${!reds && !ambers ? '<span class="badge green">0</span>' : ""}</span></button></td>`;
  }).join("")}</tr>`).join("");
  $("#eval-compare").innerHTML = `
    <div class="callout" style="margin:0 0 16px">${ic("info")}<div><b>同一把尺子：</b>${esc(BASE.note_zh)} 模型：${esc(BASE.model)} · 运行于 ${esc(BASE.recorded)}。“直接用通用 AI”组的提问原文：<span class="mono small">“${esc(BASE.baseline_ask_zh)}”</span> + 询盘原文。点任意格子看回复全文和每条问题的依据。</div></div>
    <div class="grid g4">${cards}</div>${compareTakeaway(S)}
    <div class="card" style="margin-top:16px"><div class="board-wrap"><table class="board"><thead><tr><th>询盘</th>${arms.map((a) => `<th>${esc(BASE.arms[a].name_zh)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  $$("#eval-compare [data-cmp]").forEach((b) => b.addEventListener("click", () => {
    const [a, qid] = b.dataset.cmp.split(":");
    const it = BASE.rows[a].find((x) => x.inquiry_id === qid);
    openSheet(`<div class="thumb" style="width:40px;height:40px">${ic("git-compare-arrows")}</div><div><h3>${esc(BASE.arms[a].name_zh)} · ${esc(BASE.inquiries[qid].label_zh)}</h3><p>${esc(BASE.arms[a].desc_zh)}</p></div><span class="badge ${it.risk}" style="margin-left:8px">${RISK[it.risk]}</span>`,
      `<div class="result" data-scope style="grid-template-columns:1fr"><div class="card"><div class="card-h"><h3>${ic("send")}回复全文</h3></div><div class="doc">${highlight(it.reply, it.findings, "reply")}</div></div>
       <div class="card">${riskPanel(Object.assign({ rules_checked: [] }, it))}</div></div>`);
    wireLinks($("#sheet-b"));
  }));
}

// Read the result off the numbers, including the part that is not TradeDesk's doing.
function compareTakeaway(S) {
  const p = S.plain, f = S.with_facts, t = S.tradedesk, x = S.tradedesk_fixed;
  if (!p || !f || !t || !x) return "";
  const facts = f.replies_with_red === 0 && p.replies_with_red > 0
    ? `不给工厂资料，通用 AI ${p.replies_with_red}/${p.replies} 条回复带红色问题（编造认证、免费样品、低于起订量报价）；附上资料后红色清零。<b>差距主要来自工厂资料本身。</b>`
    : `不给工厂资料，通用 AI ${p.replies_with_red}/${p.replies} 条回复带红色问题；附上资料后还有 ${f.replies_with_red} 条。`;
  return `<div class="callout" style="margin:16px 0 0">${ic("scan-search")}<div><b>怎么读这个结果：</b>${facts}
    TradeDesk 做的是把资料自动带进每一次回复，不靠业务员记得粘贴；需人工确认的黄色从 ${f.amber} 条降到 ${t.amber} 条，改一轮后 ${x.amber} 条，可直接发的回复从 ${f.replies_green} 条到 ${x.replies_green} 条，每条提示都挂出处。</div></div>`;
}

// ------------------------------------------------------------------ savings
// Measured numbers (from the repo's records) and example assumptions are shown apart; the arithmetic is printed out.
const cny = (n) => `¥${Math.round(n).toLocaleString("zh-CN")}`;
let SV = null, svTimer = null;
async function renderSavings() {
  SV = SV || (await api("/api/savings"));
  const m = SV.measured;
  const meas = (k, v) => `<div class="sv-m"><div class="v">${v}</div><b>${esc(m[k].label)}</b><span>${esc(m[k].source)}</span></div>`;
  $("#eval-savings").innerHTML = `
    <div class="callout" style="margin:0 0 16px">${ic("info")}<div><b>两类数字分开标。</b><span class="badge brand">实测</span> 来自仓库里的记录，写明了出处；
      <span class="badge">假设</span> 是示例值，请按自己工厂的情况改。${esc(SV.unmeasured)}</div></div>
    <div class="grid g3" style="align-items:start">
      <div class="card"><div class="card-h"><div><h3>${ic("zap")}替换掉什么</h3><p>省下的是这三块</p></div></div>
        <div class="card-b"><ol class="sv-list">${SV.replaces.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
          <div class="note" style="margin-top:12px">${ic("shield-check", "sm")}<span><b>不替换：</b>${esc(SV.not_replaced)}</span></div></div></div>
      <div class="card"><div class="card-h"><div><h3>${ic("database")}实测</h3><p>从记录里算出来，不是估计</p></div><span class="badge brand">实测</span></div>
        <div class="card-b sv-meas">${meas("usd_per_inquiry", `$${m.usd_per_inquiry.value}`)}${meas("usd_per_listing", `$${m.usd_per_listing.value}`)}${meas("live_seconds_per_inquiry", `${m.live_seconds_per_inquiry.value} 秒`)}</div></div>
      <div class="card"><div class="card-h"><div><h3>${ic("cpu")}假设（可改）</h3><p>示例值，按你的工厂填</p></div><span class="badge">假设</span></div>
        <div class="card-b sv-in">${SV.assumptions.map((a) => `<label><span>${esc(a.label)}</span><span class="f"><input type="number" min="0" step="any" data-k="${a.key}" value="${a.value}">${a.unit ? `<em>${esc(a.unit)}</em>` : ""}</span></label>`).join("")}</div></div>
    </div>
    <div class="card" id="sv-time" style="margin-top:16px"></div>
    <div class="card" id="sv-out" style="margin-top:16px"></div>`;
  timingCard();
  $$("#eval-savings [data-k]").forEach((i) => i.addEventListener("input", () => { clearTimeout(svTimer); svTimer = setTimeout(updateSavings, 250); }));
  savingsResult(SV);
}
let swStart = null, swTimer = null;
function timingCard() {
  const T = SV.timings || { tasks: {}, records: [] }, t = T.tasks || {};
  const col = (k) => { const x = t[k] || {}; return `<div class="sv-t"><span>${esc(x.label || "")}</span><b>${x.median != null ? `${x.median} 分钟` : "还没测"}</b><small>${x.n ? `中位数 · n=${x.n}` : "点“开始计时”现场测一次"}</small></div>`; };
  const both = t.manual?.n && t.tradedesk?.n;
  $("#sv-time").innerHTML = `<div class="card-h"><div><h3>${ic("history")}现场实测：人工 vs 用 TradeDesk</h3><p>请人当场计时：手写一条回复，再用 TradeDesk 生成 + 复核一条。只记真实测到的数，样本少就照实写 n</p></div><span class="badge brand">实测</span></div>
    <div class="card-b"><div class="sv-tcols">${col("manual")}${col("tradedesk")}</div>
      <div class="sv-tform"><select id="tm-task"><option value="manual">人工回一条询盘</option><option value="tradedesk">用 TradeDesk 生成 + 复核一条</option></select>
        <button class="btn sm" id="tm-sw">${ic("play", "sm")}<span id="tm-sw-l">开始计时</span></button>
        <input type="number" id="tm-min" min="0.1" step="0.1" placeholder="或直接填分钟">
        <input type="text" id="tm-note" placeholder="备注：谁测的、哪条询盘（可选）">
        <button class="btn sm primary" id="tm-add">记下这次</button></div>
      ${T.records.length ? `<div class="sv-trec">${T.records.map((e, i) => `<span>${esc(e.ts.slice(5))} · ${e.task === "manual" ? "人工" : "TradeDesk"} ${e.minutes} 分钟${e.note ? ` · ${esc(e.note)}` : ""} <button class="btn sm ghost" data-tdel="${i}" title="删除这条">×</button></span>`).join("")}</div>` : ""}
      ${both ? `<button class="btn sm" id="tm-use" style="margin-top:10px">${ic("circle-check-big", "sm")}用实测中位数替换下面两项假设（人工 ${t.manual.median} 分钟、复核 ${t.tradedesk.median} 分钟）</button>` : ""}
      <p class="small muted" style="margin:8px 0 0">样本只有几次时，不能当平均值讲；没测过的就不写。</p></div>`;
  $("#tm-sw").addEventListener("click", () => {
    if (!swStart) { swStart = Date.now(); swTimer = setInterval(() => ($("#tm-sw-l").textContent = `停止（${((Date.now() - swStart) / 60000).toFixed(1)} 分钟）`), 1000); $("#tm-sw-l").textContent = "停止（0.0 分钟）"; return; }
    clearInterval(swTimer); $("#tm-min").value = Math.max(0.1, (Date.now() - swStart) / 60000).toFixed(1); swStart = null; $("#tm-sw-l").textContent = "开始计时";
  });
  $("#tm-add").addEventListener("click", async () => {
    try { SV = await api("/api/savings/timing", { task: $("#tm-task").value, minutes: $("#tm-min").value, note: $("#tm-note").value }); timingCard(); toast("已记下", "ok"); } catch (e) { toast(e.message); }
  });
  $$("#sv-time [data-tdel]").forEach((b) => b.addEventListener("click", async () => {
    try { SV = await api("/api/savings/timing/delete", { index: +b.dataset.tdel }); timingCard(); } catch (e) { toast(e.message); }
  }));
  $("#tm-use")?.addEventListener("click", () => {
    $('#eval-savings [data-k="manual_minutes_per_reply"]').value = t.manual.median;
    $('#eval-savings [data-k="review_minutes_per_reply"]').value = t.tradedesk.median;
    updateSavings(); toast(`已用实测替换：人工 ${t.manual.median} 分钟（n=${t.manual.n}）、复核 ${t.tradedesk.median} 分钟（n=${t.tradedesk.n}）`, "ok");
  });
}
async function updateSavings() {
  const values = Object.fromEntries($$("#eval-savings [data-k]").map((i) => [i.dataset.k, i.value]));
  try { SV = await api("/api/savings", { assumptions: values }); savingsResult(SV); $$("#eval-savings [data-k]").forEach((i) => i.classList.remove("bad")); }
  catch (e) { toast(e.message); $$("#eval-savings [data-k]").forEach((i) => i.classList.toggle("bad", e.message.includes(SV.assumptions.find((a) => a.key === i.dataset.k).label))); }
}
function savingsResult(v) {
  const a = Object.fromEntries(v.assumptions.map((x) => [x.key, x.value])), e = v.estimate, m = v.measured;
  const T = (v.timings || {}).tasks || {};
  const src = (key, task) => (T[task]?.n && T[task].median === a[key] ? `（实测 n=${T[task].n}）` : "（假设）");
  const tile = (k, val, d, cls = "") => `<div class="sv-k ${cls}"><span>${esc(k)}</span><b>${val}</b><small>${d}</small></div>`;
  $("#sv-out").innerHTML = `<div class="card-h"><div><h3>${ic("scan-search")}每月测算</h3><p>用上面的实测单价和你填的假设算出来；每一行都写出了算式</p></div></div>
    <div class="card-b"><div class="sv-tiles">
      ${tile("省下的人工", `${e.hours_saved} 小时`, `${e.replies_per_month} 条询盘`)}
      ${tile("人工成本", cny(e.labor_cny), "按假设时薪")}
      ${tile("外包费用", cny(e.outsourcing_cny), `${a.listings_per_month} 个产品`)}
      ${tile("模型费用", "−" + cny(e.model_cny), "实测单价")}
      ${tile("每月净节省", cny(e.net_cny), "人工 + 外包 − 模型", e.net_cny >= 0 ? "pos" : "neg")}</div>
      <div class="sv-f">
        <div><span>人工</span><code>${a.inquiries_per_day} 条/天 × ${a.workdays_per_month} 天 × (${a.manual_minutes_per_reply}${src("manual_minutes_per_reply", "manual")} − ${a.review_minutes_per_reply}${src("review_minutes_per_reply", "tradedesk")}) 分钟 ÷ 60 = ${e.hours_saved} 小时；× ${a.hourly_wage_cny} 元 = ${cny(e.labor_cny)}</code></div>
        <div><span>外包</span><code>${a.listings_per_month} 个 × ${a.outsourcing_cny_per_listing} 元 = ${cny(e.outsourcing_cny)}</code></div>
        <div><span>模型</span><code>(${e.replies_per_month} 条 × $${m.usd_per_inquiry.value} + ${a.listings_per_month} 个 × $${m.usd_per_listing.value}) × ${a.usd_to_cny} = ${cny(e.model_cny)}</code></div>
        <div><span>净节省</span><code>${cny(e.labor_cny)} + ${cny(e.outsourcing_cny)} − ${cny(e.model_cny)} = ${cny(e.net_cny)}</code></div>
      </div>
      <p class="small muted" style="margin:12px 0 0">模型单价按录制时用的 claude-opus-5-5 官方价；现场 Tokenhub 上 gpt-5.5 的价格不同，没有换算。复核时间和外包是否全部省掉，要在工厂试用时确认。</p></div>`;
}

let RT = null;
async function renderRedteam() {
  RT = RT || (await api("/api/redteam"));
  const preset = RT.injections.map((i) => i.finding);
  $("#eval-redteam").innerHTML = `
    <div class="callout" style="margin:0 0 16px">${ic("shield-check")}<div><b>出处守卫是代码，不是模型。</b>${esc(RT.note_zh)} 你可以直接改右边的 JSON，自己编一条提示试试能不能混过去。</div></div>
    <div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-h"><div><h3>${ic("file-text")}靶子：真实录制的回复</h3><p>审核员只拿到这些规则：${RT.rules_offered.map((r) => `<span class="mono-chip">${esc(r.id)}</span>`).join(" ")}</p></div></div><div class="doc compact" style="max-height:460px;overflow:auto">${esc(RT.reply)}</div></div>
      <div class="card"><div class="card-h"><div><h3>${ic("ban")}注入的“模型提示”</h3><p>${RT.injections.map((i, k) => `${k + 1}. ${esc(i.label_zh)}`).join("　")}</p></div><button class="btn sm ghost" id="rt-reset">恢复预设</button></div>
        <div class="card-b"><textarea id="rt-json" rows="14" class="mono" spellcheck="false">${esc(JSON.stringify(preset, null, 1))}</textarea>
        <button class="btn primary" id="rt-run" style="width:100%;margin-top:10px">${ic("shield-check", "sm")}注入并检查</button></div></div>
    </div><div id="rt-out" style="margin-top:16px"></div>`;
  $("#rt-reset").addEventListener("click", () => { $("#rt-json").value = JSON.stringify(preset, null, 1); });
  $("#rt-run").addEventListener("click", runRedteam);
}
async function runRedteam() {
  let items;
  try { items = JSON.parse($("#rt-json").value); } catch (e) { return toast("JSON 格式不对：" + e.message); }
  const r = await api("/api/redteam", { findings: items });
  $("#rt-out").innerHTML = `<div class="card"><div class="card-h"><h3>${ic("shield-check")}守卫判定：保留 ${r.kept} 条 · 拦下 ${r.dropped} 条</h3></div>
    <table class="tbl"><tbody>${r.results.map((x, k) => `<tr><td style="width:40px"><b>${k + 1}</b></td>
      <td>${x.kept ? `<span class="badge green">${ic("circle-check-big", "sm")}保留</span>` : `<span class="badge red">${ic("ban", "sm")}拦下</span>`}</td>
      <td class="small"><b>${esc(x.reason_zh)}</b><div class="mono muted" style="margin-top:4px;word-break:break-all">${esc(typeof x.item === "string" ? x.item : JSON.stringify(x.item))}</div></td></tr>`).join("")}</tbody></table></div>`;
}

// ------------------------------------------------------------------ fair-ground
async function renderFair() {
  const lb = await api("/api/play/leaderboard");
  const url = lb.lan_url;
  let qrImg = "";
  if (url && window.qrcode) { const qr = qrcode(0, "M"); qr.addData(url); qr.make(); qrImg = qr.createImgTag(6, 0); }
  $("#fair-out").innerHTML = `<div class="grid g2" style="align-items:start">
    <div class="card"><div class="card-h"><h3>${ic("zap")}现场二维码</h3></div><div class="card-b">${url
      ? `<div style="background:#fff;display:inline-block;padding:12px;border-radius:12px">${qrImg}</div><p class="mono small">${esc(url)}</p><p class="small muted">手机和这台电脑连同一个 Wi-Fi 才能打开。</p>`
      : `<div class="callout warn" style="margin:0">${ic("info")}<div>现在服务只在本机可用。游园会开始前，停掉服务，用下面的命令重新启动，手机才能扫码访问（手机只能打开找茬页面）：<pre class="json" style="margin-top:8px">cd app && TRADEDESK_MODE=replay python3 server.py --lan</pre></div></div>`}</div></div>
    <div class="card"><div class="card-h"><h3>${ic("history")}排行榜 · ${lb.players} 人挑战过</h3><button class="btn sm ghost" id="fair-refresh">刷新</button></div>
      ${lb.top.length ? `<table class="tbl"><tbody>${lb.top.map((e, k) => `<tr><td><b>${k + 1}</b></td><td>${esc(e.name)}</td><td>${e.found} / ${e.total}</td><td class="small muted">${esc(e.ts)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">还没有人挑战</div>`}</div></div>`;
  $("#fair-refresh").addEventListener("click", renderFair);
}

// ------------------------------------------------------------------ KB
let kbCat = "all";
async function renderKB() {
  KB = KB || (await api("/api/kb"));
  const CAT = catNames();
  const verified = KB.rules.filter((r) => r.verified).length;
  $("#kb-note").textContent = `${verified}/${KB.rules.length} 条已对照原文逐字核实 · 最近更新 ${KB.version} · 未核实的规则不参与检查`;
  const SC = KB.source_check, scBy = Object.fromEntries((SC?.results || []).map((x) => [x.id, x]));
  $("#kb-src").innerHTML = SC ? `${ic("globe", "sm")}<span><b>出处自检 ${esc(SC.checked_at)}</b>：程序重新抓取 ${SC.total} 条规则的官方页面 ·
      <span class="hf-ok">${SC.summary.found} 条原文仍在</span> · ${SC.summary.browser} 条${esc(SC.status_zh.browser)}（${esc(SC.detail_zh.browser)}） ·
      ${SC.summary.blocked} 条${esc(SC.status_zh.blocked)} · <span class="${SC.summary.missing ? "hf-bad" : ""}">${SC.summary.missing} 条没找到</span>${SC.summary.error ? ` · ${SC.summary.error} 条抓取失败` : ""}</span>`
    : `${ic("globe", "sm")}<span>还没跑过出处自检：点右边按钮，程序会重新抓取每条规则的官方页面，看原文还在不在（需联网，约 30 秒）</span>`;
  const counts = {};
  KB.rules.forEach((r) => (counts[r.category] = (counts[r.category] || 0) + 1));
  $("#kb-cats").innerHTML = [["all", "全部", KB.rules.length], ...Object.entries(counts).map(([c, n]) => [c, CAT[c] || c, n])]
    .map(([c, n, k]) => `<button class="chip ${kbCat === c ? "on" : ""}" data-c="${c}">${esc(n)} · ${k}</button>`).join("");
  $$("#kb-cats .chip").forEach((b) => b.addEventListener("click", () => { kbCat = b.dataset.c; renderKB(); }));
  const q = ($("#kb-q").value || "").trim().toLowerCase();
  const rows = KB.rules.filter((r) => (kbCat === "all" || r.category === kbCat) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
  $("#kb-body").innerHTML = rows.map((r) => `<tr data-id="${esc(r.id)}"><td><span class="badge brand mono">${esc(r.id)}</span></td><td><b>${esc(r.title_zh)}</b><div class="small muted">${esc(r.summary_zh)}</div></td>
      <td><span class="badge">${esc(CAT[r.category] || r.category)}</span></td>
      <td>${r.check && r.check.kind === "llm" ? `<span class="badge">${ic("sparkles", "sm")}模型判断</span>` : `<span class="badge">${ic("cpu", "sm")}代码</span>`}</td>
      <td class="small"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(host(r.url))}</a><div class="muted">${esc(r.source_type)}</div></td>
      <td>${r.verified ? `<span class="badge green">${ic("circle-check-big", "sm")}已核实</span>` : `<span class="badge amber">未核实</span>`}${scBy[r.id] ? `<div class="small ${scBy[r.id].status === "found" ? "hf-ok" : scBy[r.id].status === "missing" ? "hf-bad" : "muted"}" style="margin-top:4px">${esc(SC.status_zh[scBy[r.id].status])}</div>` : ""}</td></tr>
    <tr class="detail" data-for="${esc(r.id)}" hidden><td></td><td colspan="5"><div class="src" style="border:0;margin:0;padding:0"><blockquote>“${esc(r.excerpt)}”</blockquote>
      <div>${r.check ? `<code>${esc(JSON.stringify(r.check))}</code>` : ""}</div></div></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">没有匹配的规则</div></td></tr>`;
  $$("#kb-body tr[data-id]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const d = $(`#kb-body tr[data-for="${tr.dataset.id}"]`); d.hidden = !d.hidden;
  }));
}

// ------------------------------------------------------------------ logs
async function recheckSources() {
  const btn = $("#kb-recheck"); busy(btn, true, "抓取中…");
  try { const r = await api("/api/kb/source-check", {}); KB = null; toast(`出处自检完成：${r.summary.found} 条原文仍在，${r.summary.missing} 条没找到`, "ok"); }
  catch (e) { toast(e.message); }
  busy(btn, false); renderKB();
}

async function renderLogs() {
  const { entries } = await api("/api/logs");
  const runs = groupRuns(entries).reverse();
  if (!runs.length) { $("#log-list").innerHTML = emptyCard("scroll-text", "还没有调用记录", ["运行一次工作流后，这里会显示每一步的输入、返回和校验结果。"]); return; }
  $("#log-list").innerHTML = runs.map((r) => {
    const risk = r.reviews.length ? worst(r.reviews.map((x) => x.risk)) : "green";
    const total = r.steps.reduce((s, x) => s + (x.meta?.seconds || 0), 0);
    const toks = r.steps.reduce((s, x) => s + ((x.meta?.usage?.input_tokens || 0) + (x.meta?.usage?.output_tokens || 0)), 0);
    const max = Math.max(...r.steps.map((x) => x.meta?.seconds || 0), 0.01);
    const rows = r.steps.map((x) => `<div class="lrow"><span><b>${esc(x.role)}</b><div class="small muted">${esc(x.step)}</div></span>
        <span><span class="bar" style="width:${Math.max(4, ((x.meta?.seconds || 0) / max) * 100)}%"></span></span><span class="small mono">${fmtS(x.meta?.seconds)}${x.meta?.source === "replay" ? " ↺" : ""}</span></div>
        <details class="io"><summary class="small muted" style="cursor:pointer">输入与返回</summary><div class="grid g2" style="margin-top:8px"><pre class="json">${esc(x.input_preview || "")}</pre><pre class="json">${esc(JSON.stringify(x.output, null, 1))}</pre></div></details>`).join("");
    const reviews = r.reviews.map((x) => `<details style="margin-top:6px"><summary class="small" style="cursor:pointer"><span class="badge ${x.risk}">${RISK[x.risk]}</span> ${esc(x.step)} · ${x.findings.length} 条提示 · 丢弃 ${(x.dropped || []).length}</summary><pre class="json" style="margin-top:8px">${esc(JSON.stringify({ findings: x.findings, dropped: x.dropped, review_skipped: x.review_skipped }, null, 1))}</pre></details>`).join("");
    return `<div class="card run"><div class="card-h"><div><h3>${esc(r.workflow)} <span class="badge mono">${esc(r.id)}</span></h3><p>触发：${esc(r.trigger)} · ${esc(r.ts)} · ${r.steps.length} 次模型调用 · ${fmtS(total)}${toks ? ` · ${toks.toLocaleString()} tokens` : ""}</p></div><span class="badge ${risk}">${RISK[risk]}</span></div>
      <div class="steps-t">${rows}${reviews}</div></div>`;
  }).join("");
}


// ------------------------------------------------------------------ agents (the same document tools/export_config.py writes)
let AG = null;
async function renderAgents() {
  AG = AG || (await api("/api/agents"));
  const roleOf = Object.fromEntries([...AG.agents.map((a) => [a.id, a.role_zh]), ...AG.listing_agents.map((l) => [l.role, l.role_zh])]);
  const who = (a) => a.split(" / ").map((id) => roleOf[id] || id).join(" / ");
  const m = AG.model, kb = AG.knowledge_base;
  $("#agents-out").innerHTML = `
    <div class="ag-stats"><div><b>${AG.agents.length}</b><span>个智能体</span></div><div><b>${AG.listing_agents.length}</b><span>个上架平台角色</span></div>
      <div><b>${AG.workflows.length}</b><span>条工作流</span></div><div><b>${kb.rules_verified}</b><span>条带出处规则</span></div>
      <div class="ag-model">${ic("cpu", "sm")}<span><b>${esc(m.model)}</b> · temperature ${m.temperature} · seed ${m.seed} · 只输出 JSON · 模式 ${m.modes.join(" / ")}<br><span class="muted">${esc(m.endpoint)} · key 不在这里显示</span></span></div></div>
    <div class="card ag-wfs"><div class="card-h"><div><h3>${ic("git-compare-arrows")}工作流：哪一步是模型，哪一步是代码</h3><p>灰色是代码，蓝色是智能体；每个智能体的输出都要过代码护栏</p></div></div>
      <div class="card-b">${AG.workflows.map((w) => `<div class="ag-wf"><div class="ag-wf-h"><span class="badge solid">${esc(w.id)}</span><b>${esc(w.name_zh)}</b><span class="small muted">触发：${esc(w.trigger_zh)}</span></div>
        <ol class="ag-steps">${w.steps.map((st) => `<li><span class="badge ${st.agent ? "brand" : ""}">${st.agent ? esc(who(st.agent)) : "代码"}</span><span>${esc(st.step_zh)}${st.guard_zh ? `<small>护栏：${esc(st.guard_zh)}</small>` : ""}${st.detail_zh ? `<small>${esc(st.detail_zh)}</small>` : ""}${st.kb_zh ? `<small>${esc(st.kb_zh)}</small>` : ""}</span></li>`).join("")}</ol></div>`).join("")}</div></div>
    <div class="grid g2" style="margin-top:16px">${AG.agents.map((a) => `<div class="card"><div class="card-h"><div><h3>${ic("sparkles")}${esc(a.role_zh)}</h3><p class="mono">${esc(a.prompt_file)}</p></div></div>
      <div class="card-b"><dl class="ag-dl"><dt>职责</dt><dd>${esc(a.task_zh)}</dd><dt>输入</dt><dd>${esc(a.input_zh || "")}</dd><dt>输出</dt><dd>${esc(a.output_zh || "")}</dd>
        <dt>护栏</dt><dd>${esc(a.guard_zh || "")}</dd><dt>交互</dt><dd>${esc(a.interaction_zh)}</dd></dl>
        <details class="io"><summary class="small muted" style="cursor:pointer">提示词全文（花括号里的内容运行时从资料卡和设置填入）</summary><pre class="json">${esc(a.prompt_text)}</pre></details></div></div>`).join("")}</div>
    <div class="card" style="margin-top:16px"><div class="card-h"><div><h3>${ic("store")}11 个上架平台的生成角色</h3><p>每个平台一个提示词，注入这个平台适用的规则；生成后都过规则校验和合规审核</p></div></div>
      <table class="tbl"><thead><tr><th>平台</th><th>角色</th><th>默认语言</th><th>适用规则</th><th>提示词</th></tr></thead><tbody>${AG.listing_agents.map((l) => `<tr data-pl="${esc(l.platform)}"><td><b>${esc(l.platform_name)}</b></td><td>${esc(l.role_zh)}</td><td>${esc(AG.listing_languages[l.default_language] || l.default_language)}</td><td><span class="badge">${l.rules.length} 条</span></td><td class="mono small">${esc(l.prompt_file)}</td></tr>
        <tr class="detail" data-for="${esc(l.platform)}" hidden><td colspan="5"><div class="small muted" style="margin-bottom:6px">${esc(l.rules.join("、"))}</div><pre class="json">${esc(l.prompt_text)}</pre></td></tr>`).join("")}</tbody></table></div>`;
  $$("#agents-out tr[data-pl]").forEach((tr) => tr.addEventListener("click", () => { const d = $(`#agents-out tr[data-for="${tr.dataset.pl}"]`); d.hidden = !d.hidden; }));
}
function downloadAgents() {
  if (!AG) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(AG, null, 2)], { type: "application/json" }));
  a.download = "tradedesk-agents.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ booth self-check
async function renderSelfcheck() {
  $("#sc-out").innerHTML = loadingCard(["回放每一条演示路径", "检查模型、知识库和本地数据"]);
  let r;
  try { r = await api("/api/selfcheck"); } catch (e) { $("#sc-out").innerHTML = ""; return toast(e.message); }
  const speech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const env = [...r.env,
    { item: "语音输入", ok: speech, info: true, detail_zh: speech ? "这个浏览器支持（Chrome / Edge，需联网）" : "这个浏览器不支持，用 Chrome 或 Edge 打开" },
    { item: "屏幕宽度", ok: innerWidth >= 1280, info: true, detail_zh: `${innerWidth} px${innerWidth < 1280 ? "：窄于 1280，建议全屏或把浏览器缩放调小" : ""}` }];
  const todo = env.filter((e) => !e.ok && !e.info).length + r.steps.filter((x) => !x.ok).length;
  const mark = (e) => (e.ok ? `<span class="sc-ok">${ic("circle-check-big", "sm")}</span>` : e.info ? `<span class="sc-info">${ic("info", "sm")}</span>` : `<span class="sc-bad">${ic("circle-x", "sm")}</span>`);
  $("#sc-out").innerHTML = `<div class="card sc-hero ${todo ? "bad" : "ok"}"><div class="card-b">${ic(todo ? "triangle-alert" : "shield-check")}<div><b>${todo ? `还有 ${todo} 项要处理` : "可以开摊"}</b>
      <span>${esc(r.checked_at)} · ${r.steps.filter((x) => x.ok).length} / ${r.steps.length} 步演示路径在回放模式下离线可走 · 当前 ${esc(MODE_ZH[r.mode] || r.mode)} · ${esc(r.model)}</span></div></div></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><div class="card-h"><h3>${ic("cpu")}环境</h3></div><table class="tbl sc-tbl"><tbody>${env.map((e) => `<tr><td>${mark(e)}</td><td><b>${esc(e.item)}</b></td><td class="small">${esc(e.detail_zh)}</td></tr>`).join("")}</tbody></table></div>
      <div class="card"><div class="card-h"><div><h3>${ic("play")}演示路径回放</h3><p>在临时目录里把每一步回放一遍，不联网、不改看板</p></div></div><table class="tbl sc-tbl"><tbody>${r.steps.map((x) => `<tr><td>${mark(x)}</td><td><span class="badge">${esc(x.path)}</span></td><td><b>${esc(x.step)}</b>${x.ok ? `<div class="small muted">${x.model_steps} 次模型步骤，全部有录好的结果</div>` : `<div class="small" style="color:hsl(var(--red))">${esc(x.reason_zh)}：切到“实时 + 录制”联网走一遍这一步</div>`}</td></tr>`).join("")}</tbody></table></div></div>
    ${liveCard(r.live_checks || [])}`;
  $("#lv-text").value = liveSample($("#lv-product").value);
  $("#lv-new").addEventListener("click", () => ($("#lv-text").value = liveSample($("#lv-product").value)));
  $("#lv-product").addEventListener("change", () => ($("#lv-text").value = liveSample($("#lv-product").value)));
  $("#lv-run").addEventListener("click", runLiveCheck);
}
function liveSample(pid) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const p = META.products.find((x) => x.id === pid) || META.products[0];
  return `Hi, we are a ${pick(["home goods importer", "kitchenware wholesaler", "small appliance distributor", "online retailer"])} in ${pick(["Houston", "Monterrey", "Chicago", "Guadalajara", "Miami", "Phoenix"])}. Please quote ${(300 + 50 * Math.floor(Math.random() * 94)).toLocaleString("en-US")} pcs of your ${p.name_en}, FOB Ningbo. We need it ${pick(["UL listed", "ETL certified", "FDA approved", "BPA free"])} and delivered within ${15 + Math.floor(Math.random() * 31)} days. Payment: ${pick(["100% 60 days after delivery", "30% deposit, 70% before shipment", "L/C at sight", "net 30"])}. Thanks, ${pick(["Alex", "Maria", "Daniel", "Sofia", "Chris", "Lucia"])}`;
}
function liveRunHtml(r) {
  if (!r.ok) return `<div class="live-run bad"><b>${esc(r.ts)} · 没跑通</b><span>${esc(r.error || "")}</span></div>`;
  return `<div class="live-run"><b>${esc(r.ts)} · ${esc(r.model)} · ${r.steps.length} 次实时调用 · ${r.seconds} 秒 · <span class="badge ${r.risk}">${esc(RISK[r.risk])}</span> ${r.findings} 条提示</b>
    <span>${r.steps.map((x) => `${esc(x.role)} ${x.seconds}s`).join(" → ")}</span><details><summary class="small muted">询盘与回复开头</summary><div class="small">${esc(r.text)}</div><div class="small muted" style="margin-top:4px">${esc(r.reply_head)}…</div></details></div>`;
}
function liveCard(runs) {
  return `<div class="card" style="margin-top:16px"><div class="card-h"><div><h3>${ic("zap")}实时验证：用一条没录过的新询盘跑一遍</h3><p>不读缓存，真调用模型：理解 → 回复 → 合规审核，3 次调用，约 20 秒，会花 Tokenhub 额度。每次的结果都留记录，也写进调用日志</p></div></div>
    <div class="card-b"><div class="live-form"><select id="lv-product" class="product-select">${META.products.map((p) => `<option value="${p.id}">${esc(prodLabel(p))}</option>`).join("")}</select>
      <textarea id="lv-text" rows="3"></textarea>
      <div class="row"><button class="btn sm ghost" id="lv-new">${ic("history", "sm")}换一条随机询盘</button><div style="flex:1"></div><button class="btn primary" id="lv-run">${ic("zap", "sm")}实时跑一遍</button></div></div>
      <div id="lv-out">${runs.length ? runs.map(liveRunHtml).join("") : '<div class="small muted">还没做过实时验证。</div>'}</div></div></div>`;
}
async function runLiveCheck() {
  const btn = $("#lv-run"); busy(btn, true, "实时调用中，约 20 秒…");
  try {
    const r = await api("/api/selfcheck/live", { product_id: $("#lv-product").value, text: $("#lv-text").value });
    toast(r.ok ? `实时跑通：${r.steps.length} 次调用，${r.seconds} 秒` : `没跑通：${r.error}`, r.ok ? "ok" : "err");
    await renderSelfcheck();
  } catch (e) { toast(e.message); busy(btn, false); }
}

async function warmBooth() {
  const btn = $("#sc-warm"); busy(btn, true, "回放中…");
  try { const r = await api("/api/selfcheck/warm", {}); KB = null; toast(`已回放 ${r.warmed} / ${r.total} 步：概览、看板、收件箱现在有数据了`, "ok"); }
  catch (e) { toast(e.message); }
  busy(btn, false); renderSelfcheck();
}
async function testModel() {
  const btn = $("#sc-test"); busy(btn, true, "连接中…");
  try {
    const r = await api("/api/settings/test", {});
    toast(r.ok ? `模型连得上：${r.model}，${r.seconds} 秒` : `连不上：${r.error}`, r.ok ? "ok" : "err");
  } catch (e) { toast(e.message); }
  busy(btn, false);
}

// ------------------------------------------------------------------ CSV import
async function reloadMeta() {
  META = await api("/api/meta");
  renderSamples();
  $$(".product-select").forEach((s) => { const v = s.value; s.innerHTML = META.products.map((p) => `<option value="${p.id}">${esc(prodLabel(p))}</option>`).join(""); if (META.products.some((p) => p.id === v)) s.value = v; });
  renderProducts();
}

// ------------------------------------------------------------------ products added in the app (新增商品)
const isCustom = (p) => (META.custom_product_ids || []).includes(p.id);
const linesOf = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
function openProductForm(editId) {
  const editing = editId && META.products.find((p) => p.id === editId);
  const F = META.product_form, base = editing || null;
  const factories = [["", META.factory.name_zh], ...(META.other_factories || []).map((f) => [f.id, f.name_zh])];
  const body = `<div class="stack pform">
    ${META.llm.mode === "replay" ? `<div class="callout">${ic("info")}<div>现在是回放模式。新商品没有录好的结果：保存后，生成上架文案、检查主图要切到实时模式（左下角模型卡片，需要联网和 key）。文案体检里的代码规则不用模型，回放模式也能出结果。</div></div>` : ""}
    ${editing ? "" : `<label><span class="fieldlab">从现有商品复制（可选）</span><select id="pf-copy"><option value="">不复制，从空白开始</option>${META.products.map((p) => `<option value="${p.id}">${esc(prodLabel(p))}</option>`).join("")}</select></label>`}
    <div class="grid g2"><label><span class="fieldlab">中文名 *</span><input type="text" id="pf-name-zh" maxlength="40" placeholder="例如：1.5L 玻璃电热水壶"></label>
      <label><span class="fieldlab">英文名 *</span><input type="text" id="pf-name-en" maxlength="80" placeholder="1.5L Glass Electric Kettle"></label></div>
    <div class="grid g2"><label><span class="fieldlab">属于哪家工厂</span><select id="pf-factory">${factories.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("")}</select></label>
      <label><span class="fieldlab">MOQ（台 / 件）*</span><input type="text" id="pf-moq" inputmode="numeric" placeholder="500"></label></div>
    <label><span class="fieldlab">FOB 宁波价格阶梯（美元）*，每行“数量区间: 单价”</span><textarea id="pf-price" rows="3" placeholder="500-1999: 9.8\n2000+: 9.2"></textarea></label>
    <label><span class="fieldlab">规格，每行“名称: 内容”</span><textarea id="pf-specs" rows="4" placeholder="容量: 1.5L\n电压: 120V 60Hz\n材质: 高硼硅玻璃 + 304 不锈钢"></textarea></label>
    <label><span class="fieldlab">卖点，每行一条</span><textarea id="pf-points" rows="3" placeholder="蓝色 LED 灯，烧水看得见\n干烧自动断电"></textarea></label>
    <label><span class="fieldlab">已有的认证，每行一条</span><textarea id="pf-held" rows="2" placeholder="CE (LVD/EMC)\nCB report (IEC 60335-2-15)"></textarea></label>
    <div><span class="fieldlab">没有的认证：文案里写成“有”，代码会标红</span><div class="pf-checks">${F.known_not_held.map((c) => `<label><input type="checkbox" data-nh="${esc(c)}">${esc(c)}</label>`).join("")}</div>
      <input type="text" id="pf-nh-other" placeholder="其他没有的认证，逗号分隔（只交给模型审核参考）" style="margin-top:6px"></div>
    <div><span class="fieldlab">没有成品检测报告的材料宣称：写了就表示“不能宣称”，文案出现 ${esc(F.materials.join(" / "))} free 会被标出</span>
      <div class="grid g3">${F.materials.map((m) => `<label class="pf-mat"><span>${esc(m)}</span><input type="text" data-mat="${esc(m)}" placeholder="例如：未做检测 / 只有供应商声明"></label>`).join("")}</div></div>
    <label><span class="fieldlab">包装</span><input type="text" id="pf-pack" maxlength="80" placeholder="color box, 6 units per carton"></label>
    <div id="pf-err"></div></div>`;
  openSheet(`<div class="thumb" style="width:40px;height:40px">${ic("package")}</div><div><h3>${editing ? `编辑商品 · ${esc(editing.id)}` : "新增商品"}</h3><p>资料卡就是工厂的事实来源：生成和检查都按这张卡核对</p></div>`, body,
    `${editing ? `<button class="btn ghost" id="pf-del">删除这个商品</button>` : ""}<div style="flex:1"></div><button class="btn primary" id="pf-save">${ic("circle-check-big", "sm")}保存</button>`);
  const fill = (p) => {
    $("#pf-name-zh").value = p ? (editing ? p.name_zh : `${p.name_zh}（复制）`) : ""; $("#pf-name-en").value = p ? p.name_en : "";
    $("#pf-factory").value = p?.factory_id || ""; $("#pf-moq").value = p ? p.moq_units : "";
    $("#pf-price").value = linesOf(p?.fob_ningbo_usd); $("#pf-specs").value = Object.entries(p?.specs || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("\n");
    $("#pf-points").value = (p?.selling_points_zh || []).join("\n"); $("#pf-held").value = (p?.certifications_held || []).join("\n");
    const nh = p?.certifications_not_held || [];
    $$("[data-nh]").forEach((c) => (c.checked = nh.includes(c.dataset.nh)));
    $("#pf-nh-other").value = nh.filter((c) => !F.known_not_held.includes(c)).join(", ");
    $$("[data-mat]").forEach((i) => (i.value = (p?.material_tests || {})[i.dataset.mat] || ""));
    $("#pf-pack").value = p?.packaging || "";
  };
  fill(base);
  $("#pf-copy")?.addEventListener("change", (e) => fill(META.products.find((p) => p.id === e.target.value) || null));
  $("#pf-save").addEventListener("click", async () => {
    const product = {
      name_zh: $("#pf-name-zh").value, name_en: $("#pf-name-en").value, factory_id: $("#pf-factory").value,
      moq_units: $("#pf-moq").value, fob_ningbo_usd: $("#pf-price").value, specs: $("#pf-specs").value,
      selling_points_zh: $("#pf-points").value, certifications_held: $("#pf-held").value,
      certifications_not_held: [...$$("[data-nh]").filter((c) => c.checked).map((c) => c.dataset.nh), ...$("#pf-nh-other").value.split(/[,，]/)],
      material_tests: Object.fromEntries($$("[data-mat]").map((i) => [i.dataset.mat, i.value])), packaging: $("#pf-pack").value,
    };
    busy($("#pf-save"), true, "保存中…");
    try {
      const r = await api("/api/products/save", { product, id: editing ? editing.id : null });
      await reloadMeta(); closeSheet();
      if (page === "board") { boardState.flash = r.product.id; renderBoard(); } else if (page === "listing") pickProduct(r.product.id);
      toast(`已保存：${r.product.name_zh}（${r.product.id}）。生成上架文案、检查主图要在实时模式下`, "ok");
    } catch (e) { $("#pf-err").innerHTML = `<div class="callout" style="border-color:hsl(var(--red) / .4)">${ic("triangle-alert")}<div>${esc(e.message)}</div></div>`; busy($("#pf-save"), false); }
  });
  $("#pf-del")?.addEventListener("click", async () => {
    try { await api("/api/products/delete", { id: editing.id }); await reloadMeta(); closeSheet(); if (page === "board") renderBoard(); toast("已删除", "ok"); }
    catch (e) { $("#pf-err").innerHTML = `<div class="callout">${ic("triangle-alert")}<div>${esc(e.message)}</div></div>`; }
  });
}
function openImport() {
  openSheet(`<div class="thumb" style="width:40px;height:40px">${ic("database")}</div><div><h3>导入询盘（CSV）</h3><p>任何能另存为 CSV 的询盘列表都可以</p></div>`,
    `<div class="stack imp">
      <p>需要一列询盘内容，列名写 <code>text</code>、<code>message</code> 或 <code>询盘内容</code>。可选列：<code>buyer</code> / 买家、<code>country</code> / 国家、<code>product</code> / 产品（写编号或产品名）、<code>subject</code> / 主题。逗号、分号、Tab 分隔都行。</p>
      <label><span class="fieldlab">没写产品的行，默认是</span><select id="imp-product">${META.products.map((p) => `<option value="${p.id}">${esc(prodLabel(p))}</option>`).join("")}</select></label>
      <label><span class="fieldlab">选择文件</span><input type="file" id="imp-file" accept=".csv,.tsv,.txt,text/csv"></label>
      <div class="callout">${ic("info")}<div>导入的是新询盘，没有录好的结果：整理和回复要在实时模式下进行（左下角模型卡片，需要联网和 key）。回放模式下它们会显示“未整理”。<a href="samples/inquiries-sample.csv" download>下载示例 CSV</a></div></div>
      <div id="imp-out"></div></div>`,
    `<button class="btn ghost" id="imp-clear">清除已导入的询盘</button><div style="flex:1"></div><button class="btn primary" id="imp-run">${ic("database", "sm")}导入</button>`);
  $("#imp-run").addEventListener("click", async () => {
    const f = $("#imp-file").files[0];
    if (!f) return toast("先选一个 CSV 文件");
    busy($("#imp-run"), true, "导入中…");
    try {
      const r = await api("/api/inbox/import", { csv: await f.text(), product_id: $("#imp-product").value });
      $("#imp-out").innerHTML = `<div class="callout">${ic("circle-check-big")}<div><b>导入 ${r.added.length} 条</b>${r.skipped.length ? `，跳过 ${r.skipped.length} 行：<ul class="small">${r.skipped.slice(0, 8).map((x) => `<li>第 ${x.line} 行：${esc(x.reason_zh)}</li>`).join("")}</ul>` : ""}</div></div>`;
      await reloadMeta(); renderInbox();
    } catch (e) { toast(e.message); }
    busy($("#imp-run"), false);
  });
  $("#imp-clear").addEventListener("click", async () => {
    try { await api("/api/inbox/import/clear", {}); await reloadMeta(); renderInbox(); toast("已清除导入的询盘", "ok"); } catch (e) { toast(e.message); }
  });
}

// ------------------------------------------------------------------ model settings
const MODE_ZH = { live: "实时调用", record: "实时 + 录制缓存", replay: "回放（不联网）" };
const PROVIDER_ZH = { openai: "OpenAI 兼容（赛事 Tokenhub）", anthropic: "Claude（官方或 Tokenhub）" };
const DEFAULTS = { openai: { endpoint: "https://api.tokenhubcloud.net/v1", model: "gpt-5.5" }, anthropic: { endpoint: "https://api.anthropic.com", model: "claude-opus-5-5" } };
const ENDPOINT_HINT = {
  openai: "赛事 Tokenhub 填 https://api.tokenhubcloud.net/v1（使用指南「速查卡」里的 OpenAI 兼容 Base URL）",
  anthropic: "官方填 https://api.anthropic.com；走赛事 Tokenhub 填 https://api.tokenhubcloud.net",
};

async function openSettings() {
  const cfg = await api("/api/settings");
  let provider = cfg.provider;
  // Each interface type keeps its own address and key in app/.env; switching shows that type's saved ones.
  const saved = (p) => (cfg.saved && cfg.saved[p]) || {};
  const hint = () => (cfg.provider === provider ? (cfg.key_set && cfg.key_hint) : saved(provider).key_hint);
  const body = () => `
    <div class="callout" style="margin:0">${ic("shield-check")}<div>key 只保存在这台电脑的 <code>app/.env</code>（不会提交），保存后页面不会再显示完整 key。<b>不要在微信或群里发 key。</b></div></div>
    ${cfg.env_overrides.length ? `<div class="callout warn" style="margin:0">${ic("triangle-alert")}<div>启动命令里设置了 ${esc(cfg.env_overrides.join("、"))}；保存后以这里的设置为准，重启服务时又会回到启动命令的设置。</div></div>` : ""}
    <div class="card"><div class="card-b">
      <label class="field">接口类型<div class="seg" id="set-prov">${Object.entries(PROVIDER_ZH).map(([k, v]) => `<button data-p="${k}" class="${k === provider ? "on" : ""}">${esc(v)}</button>`).join("")}</div></label>
      <label class="field">接口地址 <span class="muted" style="font-weight:400">${esc(ENDPOINT_HINT[provider])}</span><input type="text" id="set-endpoint" value="${esc(cfg.provider === provider ? cfg.endpoint : saved(provider).endpoint || DEFAULTS[provider].endpoint)}" placeholder="${esc(DEFAULTS[provider].endpoint || "https://…/v1")}"></label>
      <label class="field">模型名 <span class="muted" style="font-weight:400">不同 key 能用的模型不一样，点「查可用模型」从列表里选</span><input type="text" id="set-model" value="${esc(cfg.provider === provider ? cfg.model : DEFAULTS[provider].model)}" placeholder="点「查可用模型」后选择"></label>
      <div><button class="btn sm" id="set-list">${ic("search", "sm")}查可用模型</button><div class="chips" id="set-models" style="margin-top:8px"></div></div>
      <label class="field">API key <span class="muted" style="font-weight:400">${hint() ? `已保存 ${esc(hint())}，留空表示不修改` : "还没有保存 key"}</span>
        <input type="password" id="set-key" autocomplete="off" spellcheck="false" placeholder="${hint() ? "留空 = 不修改" : "粘贴 key"}"></label>
      <label class="field">模式<select id="set-mode">${Object.entries(MODE_ZH).map(([k, v]) => `<option value="${k}" ${k === cfg.mode ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      <p class="small muted" style="margin:0">实时：每次点击都调用模型。录制：实时调用并存下结果，供断网时回放。回放：只用存下的结果，不联网、不需要 key。换了接口或模型后，回放缓存要重新录制（运行 <code>python3 tools/record_demo.py</code>）。</p>
    </div></div>
    <div id="set-result"></div>`;
  const render = () => {
    openSheet(`<div class="thumb" style="width:40px;height:40px">${ic("cpu")}</div><div><h3>模型设置</h3><p>当前：${esc(cfg.active.model)} · ${esc(MODE_ZH[cfg.active.mode] || cfg.active.mode)}</p></div>`, body(),
      `<button class="btn" id="set-test">${ic("zap", "sm")}测试连接</button><button class="btn primary" id="set-save">${ic("circle-check-big", "sm")}保存</button>`);
    $$("#set-prov button").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); provider = b.dataset.p; render(); }));
    $("#set-save").addEventListener("click", async () => {
      busy($("#set-save"), true, "保存中…");
      try {
        const r = await api("/api/settings", { provider, endpoint: $("#set-endpoint").value, model: $("#set-model").value, api_key: $("#set-key").value, mode: $("#set-mode").value });
        Object.assign(cfg, r); META.llm = r.active; renderModelCard(); toast("已保存，立即生效", "ok"); render();
      } catch (e) { $("#set-result").innerHTML = `<div class="callout warn" style="margin:0">${ic("circle-x")}<div>${esc(e.message)}</div></div>`; busy($("#set-save"), false); }
    });
    $("#set-list").addEventListener("click", async (e) => {
      e.preventDefault();
      busy($("#set-list"), true, "查询中…");
      try {
        const r = await api("/api/settings/models", { provider, endpoint: $("#set-endpoint").value, model: $("#set-model").value, api_key: $("#set-key").value });
        $("#set-models").innerHTML = !r.ok ? `<div class="callout warn" style="margin:0">${ic("circle-x")}<div>${esc(r.error)}</div></div>`
          : r.models.length ? r.models.map((m) => `<button class="chip" data-model="${esc(m)}">${esc(m)}</button>`).join("") : `<span class="small muted">这个 key 没有可用的模型，找现场技术组</span>`;
        $$("#set-models [data-model]").forEach((b) => b.addEventListener("click", (ev) => { ev.preventDefault(); $("#set-model").value = b.dataset.model; $$("#set-models .chip").forEach((c) => c.classList.toggle("on", c === b)); }));
      } catch (err) { $("#set-models").innerHTML = `<div class="callout warn" style="margin:0">${ic("circle-x")}<div>${esc(err.message)}</div></div>`; }
      busy($("#set-list"), false);
    });
    $("#set-test").addEventListener("click", async () => {
      busy($("#set-test"), true, "测试中…");
      try {
        const r = await api("/api/settings/test", {});
        $("#set-result").innerHTML = r.ok ? `<div class="callout" style="margin:0">${ic("circle-check-big")}<div>连接正常：${esc(r.model)} · ${r.seconds}s${r.usage ? ` · ${r.usage.input_tokens}/${r.usage.output_tokens} tokens` : ""}（测试的是已保存的设置）</div></div>`
          : `<div class="callout warn" style="margin:0">${ic("circle-x")}<div>连接失败：${esc(r.error || "返回内容不对")}</div></div>`;
      } catch (e) { $("#set-result").innerHTML = `<div class="callout warn" style="margin:0">${ic("circle-x")}<div>${esc(e.message)}</div></div>`; }
      busy($("#set-test"), false);
    });
  };
  render();
}


// ------------------------------------------------------------------ auto tour (captions, replay data, optional loop)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tourState = { on: false, paused: false, loop: false };
function spot(sel) {
  $$(".tour-spot").forEach((e) => e.classList.remove("tour-spot"));
  const el = typeof sel === "string" ? $(sel) : sel;
  if (el) { el.classList.add("tour-spot"); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
}
async function tourSteps() {
  const base = await api("/api/baseline").catch(() => null);
  const ev = await api("/api/eval").catch(() => null);
  const fr = (ev && ev.first_runs) || {};
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const blind = fr.heldout && fr.heldout2 ? `两份盲测集（没看过代码的人出题）首次运行，精确率 ${pct(fr.heldout.summary.precision)} / ${pct(fr.heldout2.summary.precision)}，召回率 ${pct(fr.heldout.summary.recall)} / ${pct(fr.heldout2.summary.recall)}。` : "检查器用两份盲测集评测过。";
  const S = base && base.summary;
  const cmp = S ? `直接把询盘丢给通用 AI：${S.plain.replies} 条回复 ${S.plain.replies_with_red} 条带红色问题，编造认证、承诺免费样品。附上工厂资料后 ${S.with_facts.replies_with_red} 条：差距来自资料。` : "对照实验：同一把尺子测通用 AI 和 TradeDesk。";
  const cmpSub = S ? `TradeDesk 把资料自动带进每次回复，需人工确认的黄色从 ${S.with_facts.amber} 条降到 ${S.tradedesk_fixed.amber} 条，每条提示都挂出处` : "";
  return [
    { d: 6000, cap: "TradeDesk 出海工作台：询盘 → 回复 → 上架，每一条风险提示都有出处。", sub: "给宁波中小外贸工厂的 AI 助手（演示数据为虚构）",
      run: async () => { go("overview"); await sleep(400); spot("#ov-stats"); } },
    { d: 7000, cap: `业务员每天先看收件箱：${META.inquiries.length} 条询盘按优先级排好，每一分都能看到依据。`, sub: "分数由代码按公开公式计算，依据是询盘原文",
      run: async () => { go("inbox"); await renderInbox(); showInboxTab("list"); const d = $("#inbox-list details"); if (d) d.open = true; spot($("#inbox-list .mail")); } },
    { d: 8000, cap: "这条美国询盘里埋了五个坑：要 UL、要 BPA free、FOB 空运、20 天交货、货到 60 天付款。", sub: "询盘分析员逐条找出和工厂资料对不上的地方，每条都标了询盘原文",
      run: async () => { go("inquiry"); pickSample(0); state.inqId = null; await runInquiry(); await sleep(300); spot($("#inq-out .analysis-grid")); } },
    { d: 8000, cap: "回复如实说明了没有 UL、FOB 只走海运。校验又抓到一处更细的问题：集装箱货用 FCA 更合适。", sub: "依据是 ICC 的原文和链接，不是模型自己说的",
      run: async () => { window.scrollTo({ top: 0, behavior: "smooth" }); await sleep(300); spot($("#inq-out .finding")); } },
    { d: 7500, cap: "业务员只说一句“按风险提示全部修改”，第 2 轮就变绿；需要采购、生产、美工跟进的事自动派成任务。", sub: "右上角是轮次，“与上一轮对比”里能看到新增的那句话",
      run: async () => { $("#inq-ins").value = "按风险提示全部修改"; await reviseInquiry(); $('#inq-tabs [data-t="diff"]')?.click(); await sleep(200); spot($("#inq-out .result .card")); } },
    { d: 6500, cap: `商品看板：${META.products.length} 个产品 × 主图 / Amazon / TikTok，运营一眼看到哪里卡住了。`, sub: "一键批量生成上品，导出 CSV",
      run: async () => { go("board"); await renderBoard(); spot($(".board")); } },
    { d: 8500, cap: "主图检查：白底、占比、尺寸由代码测像素；徽章、促销字、道具由模型看图，必须写出看到了什么。", sub: "这张图被标了 5 条红；红色时“标记已上架”按钮是灰的",
      run: async () => { await openCell("KET-17S", "image"); } },
    { d: 6500, cap: "同一份中文资料，同时生成 Amazon 美国站英文 Listing 和 TikTok 墨西哥西语脚本，各按平台规则检查。", sub: "Amazon 标题现在最多 75 个字符，这里实时计数；上架可选 11 个平台、6 种语言，这里演示默认的两个",
      run: async () => { closeSheet(); go("listing"); await runListing(); await sleep(200); spot($("#lst-out .grid")); } },
    { d: 9500, cap: cmp, sub: cmpSub || "同样 8 条询盘，同一套代码规则 + 同一个合规审核员来测",
      run: async () => { go("eval"); await showEvalTab("compare"); spot($("#eval-compare .grid")); } },
    { d: 8000, cap: "出处守卫是代码，不是模型：编造的规则编号、回复里没有的原文，当场被拦下。", sub: "6 条注入：5 条编造的全部拦下，1 条真实的保留",
      run: async () => { await showEvalTab("redteam"); await runRedteam(); spot($("#rt-out")); } },
    { d: 7000, cap: blind, sub: "首次成绩在修复前冻结保存；修复后的满分不算盲测成绩",
      run: async () => { await showEvalTab("rules"); spot($("#eval-out .grid")); } },
    { d: 6000, cap: "让宁波工厂的每一句对外承诺，都有依据。", sub: "TradeDesk · INTERCITY HACK 宁波站 · 赛道二",
      run: async () => { go("overview"); spot(null); } },
  ];
}

async function startTour(loop = false) {
  if (tourState.on) return;
  Object.assign(tourState, { on: true, paused: false, loop });
  document.body.classList.add("touring");
  const box = document.createElement("div");
  box.className = "tour"; box.id = "tour";
  document.body.appendChild(box);
  if (META.llm.mode !== "replay") toast("当前是实时模式：自动演示会真实调用模型，每一步会慢一些", "ok");
  do {
    const steps = await tourSteps();
    for (let i = 0; i < steps.length && tourState.on; i++) {
      const st = steps[i];
      box.innerHTML = `<div class="cap">${esc(st.cap)}</div><div class="sub">${esc(st.sub || "")}</div>
        <div class="bar"><div class="dots">${steps.map((_, k) => `<i class="${k < i ? "done" : k === i ? "now" : ""}" style="--d:${st.d}ms"></i>`).join("")}</div>
        <button id="tour-pause">${tourState.paused ? "继续" : "暂停"}</button><button id="tour-next">下一步</button><button id="tour-stop">退出</button></div>`;
      let skip = false;
      $("#tour-stop").onclick = () => { tourState.on = false; skip = true; };
      $("#tour-next").onclick = () => { skip = true; };
      $("#tour-pause").onclick = () => { tourState.paused = !tourState.paused; $("#tour-pause").textContent = tourState.paused ? "继续" : "暂停"; box.querySelectorAll(".dots i.now").forEach((e) => (e.style.animationPlayState = tourState.paused ? "paused" : "running")); };
      try { await st.run(); } catch (e) { console.warn("tour step failed", e); }
      let left = st.d;
      while (left > 0 && !skip && tourState.on) { await sleep(100); if (!tourState.paused) left -= 100; }
    }
  } while (tourState.on && tourState.loop);
  tourState.on = false;
  closeSheet(); spot(null); box.remove(); document.body.classList.remove("touring");
}

// ------------------------------------------------------------------ roles
// Booth mode: a visitor picks a role and sees only that lane, its pages in the sidebar and a fixed path of real
// actions one step at a time. Every step uses requests that are recorded, so the whole path replays offline.
const ROLE_INQUIRY = "INQ-US-01";

function cardTitled(root, text) {
  return [...$$(".card-h h3", root)].find((h) => h.textContent.includes(text))?.closest(".card");
}

async function roleInquiryRound(n) {
  go("inquiry");
  if (!state.inq.history.length || state.inqId !== ROLE_INQUIRY) { pickSample(META.inquiries.findIndex((q) => q.id === ROLE_INQUIRY)); await runInquiry(); }
  if (n > 1 && state.inq.history.length < 2) { $("#inq-ins").value = "按风险提示全部修改"; await reviseInquiry(); }
  if (n > 1) { $('#inq-tabs [data-t="diff"]')?.click(); spot("#inq-out .risk-hero"); }
  else spot(cardTitled($("#inq-out"), "询盘分析") || "#inq-out .risk-hero");
}

// What the factory card says it does not have: the claims a buyer will never see on these pages.
function buyerNote() {
  const p = META.products[0];
  const untested = Object.entries(p.material_tests || {}).filter(([, v]) => /未/.test(v)).map(([k]) => k);
  return `<div class="callout buyer-note">${ic("shield-check")}<div><b>这页没写的话</b>工厂没有 ${esc(p.certifications_not_held.join("、"))}，
    没做过 ${esc(untested.join("、"))} 检测，所以你在这些页面上看不到这类说法。页面只写资料卡里有的认证：${esc(p.certifications_held.join("、"))}。<span class="small muted">依据：工厂资料卡</span></div></div>`;
}

async function roleListing(ids) {
  go("listing");
  pickProduct(META.products[0].id);
  $$("#lst-platform-options [data-platform]").forEach((row) => {
    $("[data-platform-select]", row).checked = ids.includes(row.dataset.platform);
    $("[data-platform-language]", row).value = META.listing_catalog.platforms[row.dataset.platform].default_language;
  });
  await runListing();
  if (role === "consumer" && state.lst.history.length) $("#lst-out").insertAdjacentHTML("afterbegin", buyerNote());
}

async function roleCheck() {
  go("check");
  state.chkPlatform = "amazon_us"; renderCheckControls();
  $("#chk-product").value = META.products[0].id;
  $("#chk-text").value = sampleFor(META.products[0].id);
  await runCheck();
}

const ROLE_LANES = {
  reviewer: {
    name: "合规审查员", mark: "审", sub: "发出前的最后一道关 · 建议先看这条", fit: "所有评委", pages: ["eval", "check", "kb", "agents"],
    out: "红黄绿结论，每条问题都附规则原文和链接；别的工具写的文案也能查",
    steps: [
      { t: "通用 AI 写的 8 条回复", d: "同样 8 条询盘：通用 AI 只看询盘，8 条都带红（编 UL 认证、按低于起订量报价）；贴上工厂资料红色清零，仍有 20 处待确认；TradeDesk 改一轮后 3 条可直接发。点格子看原文。",
        run: async () => { go("eval"); await showEvalTab("compare"); spot("#eval-compare .grid"); } },
      { t: "贴一段文案就查", d: "不管是 ChatGPT 还是别的工具写的，贴进来就查。这段标题埋了 6 个问题，系统还多查出一条：78 字符，超过 75。",
        run: roleCheck },
      { t: "每条问题都有出处", d: "每条提示都挂着规则原文和链接，或资料卡上的字段；模型说不出出处的提示，代码直接丢掉。",
        run: async () => { if (!$("#chk-out .finding")) await roleCheck(); spot("#chk-out .finding"); } },
      { t: "编造的提示拦得住吗", d: "往审核结果里塞 5 条编造的提示（假编号、原文对不上），看代码怎么全部拦下。",
        run: async () => { go("eval"); await showEvalTab("redteam"); await runRedteam(); } },
      { t: "6 个智能体怎么分工", d: "每个智能体的职责、输入、输出、护栏和提示词全文都在这页；哪一步是代码、哪一步是模型，按工作流列清楚，可以导出成 JSON。",
        run: async () => { go("agents"); await renderAgents(); spot("#agents-out .ag-wfs"); } },
    ],
  },
  merchant: {
    name: "商户", mark: "商", sub: "工厂的业务员和运营 · B2B 询盘", fit: "行业、投资评委", pages: ["inbox", "inquiry", "listing"],
    out: "能直接发给进口商的回复、中文内部备忘、派给采购 / 生产 / 美工的任务、附给买家的 Amazon 文案",
    steps: [
      { t: "收件箱排好优先级", d: "询盘按公开公式打好了分。高亮这条只有 50 分：和工厂资料有 3 处硬冲突、2 处待确认。分低不是不回，是提醒要小心回。",
        run: async () => {
          go("inbox");
          const d = await api("/api/inbox");
          if (!d.items.some((x) => x.priority)) await runTriage();
          spot($(`#inbox-list [data-open="${ROLE_INQUIRY}"]`)?.closest(".mail"));
        } },
      { t: "理解并回复这条询盘", d: "先看“询盘分析”：UL、BPA、FOB 空运、20 天交货、货到 60 天付款，五个坑逐条带原文；英文回复如实写明做不到。",
        run: () => roleInquiryRound(1) },
      { t: "一句中文改第 2 轮", d: "只说一句“按风险提示全部修改”，系统在上一版基础上改：风险变成“可以发”，改动逐词标出来。",
        run: () => roleInquiryRound(2) },
      { t: "看派出去的任务", d: "这条询盘里要采购、生产、美工跟进的事，已自动拆成任务，每条都挂着询盘原文。",
        run: async () => { taskInquiry = ROLE_INQUIRY; go("inbox"); await renderInbox(); showInboxTab("tasks"); } },
      { t: "附上 Amazon 美国站文案", d: "Mark 在 Amazon 卖货：同一张资料卡生成他能用的英文 Listing，代码再核对回复和 Listing 有没有说法打架。",
        run: async () => {
          if (state.inqId !== ROLE_INQUIRY || state.inq.history.length < 2) await roleInquiryRound(2);
          handoffFromInquiry();
          await roleListing(["amazon_us"]);
          spot("#lst-out .handoff");
        } },
    ],
  },
  consumer: {
    name: "消费者", mark: "买", sub: "海外买家看到的商品页 · B2C 上架", fit: "关心本地化和 B2C 的评委", pages: ["listing", "check"],
    out: "按平台和语言生成、只写工厂真有的认证和参数的商品页",
    steps: [
      { t: "美国和墨西哥的商品页", d: "美国买家在 Amazon 看到英文 Listing，墨西哥买家在 TikTok 看到西语短视频。这里只显示买家看得到的部分。",
        run: () => roleListing(["amazon_us", "tiktok_mx"]) },
      { t: "换到德国和墨西哥电商", d: "换成 Amazon 德国站（德语）和 Mercado Libre 墨西哥（西语）：格式和语言跟着平台走，都按当地规则检查过。",
        run: () => roleListing(["amazon_de", "mercadolibre_mx"]) },
      { t: "页面上不会出现的话", d: "工厂没有 UL、没测过 BPA，所以商品页不会有 “UL Listed”“BPA Free”；有人把这种文案贴进来，系统直接判红。",
        run: roleCheck },
    ],
  },
};
const ROLE_ORDER = Object.keys(ROLE_LANES);
let role = null, roleStep = 0, roleBusy = false, roleDone = false;

function showRolePicker() {
  let el = $("#rolepick");
  if (!el) { el = document.createElement("div"); el.id = "rolepick"; el.className = "rolepick"; document.body.appendChild(el); }
  el.innerHTML = `<div class="rp-inner"><span class="rp-kick">TradeDesk 出海工作台 · 不帮你写，帮你在发出前查</span><h1>你是哪一类用户？</h1>
    <div class="rp-proof"><b class="r">8 / 8</b><span>通用 AI 只看询盘：条条带红</span><i>→</i><b class="a">0 红</b><span>贴上工厂资料：仍有 20 处待确认</span><i>→</i><b class="g">3 / 8</b><span>TradeDesk 改一轮：可直接发，待确认 8 处</span></div>
    <p>选一个角色，按你的路径走一遍。每一步都是工作台里的真实操作，左边只留这条路径用得到的页面。</p>
    <div class="rp-cards">${Object.entries(ROLE_LANES).map(([k, r]) => `<button class="rp-card ${k}" data-role="${k}">
      <span class="rp-ic">${r.mark}</span><b>${r.name}</b><small>${esc(r.sub)}</small>
      <span class="rp-meta">约 1 分钟 · ${r.steps.length} 步 · 适合${esc(r.fit)}</span>
      <span class="rp-path">${r.steps.map((s, i) => `<span><i>${i + 1}</i>${esc(s.t)}</span>`).join("")}</span>
      <span class="rp-out">产出：${esc(r.out)}</span></button>`).join("")}</div>
    <div class="rp-foot"><button class="rp-all" data-role="">进入完整工作台（全部功能）</button><button class="rp-all" id="rp-selfcheck">开摊前自检</button><a class="rp-all" href="sandbox.html">Sandbox 演练（模拟情境）</a></div></div>`;
  el.hidden = false;
  $$("#rolepick [data-role]").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
  $("#rp-selfcheck").addEventListener("click", () => { setRole(""); go("selfcheck"); });
}

function setRole(key) {
  role = ROLE_LANES[key] ? key : null;
  roleStep = 0; roleDone = false; taskInquiry = null; state.handoff = null; state.handoffHtml = "";
  $("#rolepick")?.setAttribute("hidden", "");
  document.body.classList.toggle("role-mode", !!role);
  document.body.classList.toggle("buyer-view", role === "consumer");
  document.body.dataset.role = role || "";
  const lane = role && ROLE_LANES[role];
  $$(".nav button").forEach((b) => { b.hidden = !!lane && !lane.pages.includes(b.dataset.page); });
  $$(".nav-label").forEach((l) => { l.hidden = !!lane && !$$("button:not([hidden])", l.nextElementSibling).length; });
  history.replaceState(null, "", role ? `#role=${role}` : location.pathname);
  renderRoleGuide();
  if (lane) runRoleStep(0); else go("overview");
}

function renderRoleGuide() {
  const g = $("#roleguide"), lane = role && ROLE_LANES[role];
  if (!lane) { g.hidden = true; return; }
  const st = lane.steps[roleStep], last = roleStep === lane.steps.length - 1;
  const next = ROLE_ORDER[(ROLE_ORDER.indexOf(role) + 1) % ROLE_ORDER.length];
  g.hidden = false;
  g.innerHTML = `<div class="rg-who ${role}"><span class="rg-ic">${lane.mark}</span><div><b>${lane.name}</b><small>${esc(lane.sub)}</small></div></div>
    <ol class="rg-steps">${lane.steps.map((s, i) => `<li class="${i < roleStep ? "done" : i === roleStep ? "now" : ""}"><button data-step="${i}"><i>${i < roleStep ? "✓" : i + 1}</i>${esc(s.t)}</button></li>`).join("")}</ol>
    <div class="rg-acts">${last ? `<button class="btn sm primary" id="rg-nextlane">下一条线：${esc(ROLE_LANES[next].name)}${ic("arrow-right", "sm")}</button>`
        : `<button class="btn sm primary" id="rg-next">下一步：${esc(lane.steps[roleStep + 1].t)}${ic("arrow-right", "sm")}</button>`}
      ${roleDone ? `<button class="btn sm" id="rg-again">${ic("history", "sm")}重新体验</button>` : ""}
      <button class="btn sm ghost" id="rg-switch">换个角色</button></div>
    ${roleDone ? `<div class="rg-celebrate" aria-live="polite"><i>${ic("circle-check-big")}</i><b>${esc(lane.name)}这条线走完了</b><span>${lane.steps.length} 步都是真实操作 · 换下一位评委点“重新体验”</span>${"<s></s>".repeat(12)}</div>` : ""}
    <p class="rg-desc"><b>第 ${roleStep + 1} 步 · ${esc(st.t)}</b>${esc(st.d)}${last ? `<span class="rg-done">走完了 · 产出：${esc(lane.out)}</span>` : ""}</p>`;
  $$("#roleguide [data-step]").forEach((b) => b.addEventListener("click", () => runRoleStep(+b.dataset.step)));
  $("#rg-next")?.addEventListener("click", () => runRoleStep(roleStep + 1));
  $("#rg-nextlane")?.addEventListener("click", () => setRole(next));
  $("#rg-again")?.addEventListener("click", () => setRole(role));
  $("#rg-switch").addEventListener("click", showRolePicker);
}

async function runRoleStep(i) {
  const lane = role && ROLE_LANES[role];
  if (!lane || roleBusy || i < 0 || i >= lane.steps.length) return;
  roleStep = i; roleDone = false; renderRoleGuide();
  roleBusy = true; $("#roleguide").classList.add("busy");
  let ok = true;
  try { await lane.steps[i].run(); } catch (e) { ok = false; toast(e.message); }
  roleBusy = false; $("#roleguide").classList.remove("busy");
  if (ok && i === lane.steps.length - 1) { roleDone = true; renderRoleGuide(); }
}

// ------------------------------------------------------------------ boot
function renderModelCard() {
  const m = META.llm;
  const live = m.mode !== "replay";
  $("#model-card").innerHTML = `<div class="row" style="justify-content:space-between"><b>${esc(m.model)}</b><span class="dot ${live ? "live" : "replay"}"></span></div>
    <div class="muted" style="margin-top:2px">${live ? (m.mode === "record" ? "实时 · 录制缓存" : "实时调用") : "回放模式 · 不联网"} · ${esc(m.provider === "anthropic" ? "Claude API" : "OpenAI 兼容")}</div>
    <div class="small" style="margin-top:6px;color:hsl(var(--brand))">${ic("cpu", "sm")} 点击设置模型和 key</div>`;
  $("#mode-pill").innerHTML = `<span class="dot ${live ? "live" : "replay"}"></span><b>${live ? (m.mode === "record" ? "实时 · 录制" : "实时") : "回放 · 不联网"}</b>${esc(m.model)}`;
}
// Hover tips for chart marks (the same numbers are also printed beside each chart).
function wireTips() {
  const tip = document.createElement("div");
  tip.className = "tip"; document.body.appendChild(tip);
  addEventListener("mouseover", (e) => { const t = e.target.closest?.("[data-tip]"); if (t) { tip.textContent = t.dataset.tip; tip.classList.add("on"); } else tip.classList.remove("on"); });
  addEventListener("mousemove", (e) => { if (!tip.classList.contains("on")) return; const w = tip.offsetWidth; tip.style.left = Math.min(e.clientX + 12, innerWidth - w - 8) + "px"; tip.style.top = e.clientY + 16 + "px"; });
}
function setTheme(t) { document.documentElement.dataset.theme = t; store.set("td-theme", t); $("#theme-btn use").setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon"); }

async function boot() {
  const sprite = await fetch("icons.svg").then((r) => r.text());
  document.body.insertAdjacentHTML("afterbegin", sprite);
  META = await api("/api/meta");
  renderModelCard();
  const listingEntry = $('[data-go="listing"] .p');
  if (listingEntry) listingEntry.textContent = "一份中文资料生成多平台商品文案，并为每个平台单独选择输出语言。";
  $$(".product-select").forEach((s) => { s.innerHTML = META.products.map((p) => `<option value="${p.id}">${esc(prodLabel(p))}</option>`).join(""); });
  $("#inq-text").insertAdjacentHTML("afterend", micBar("inq-text", true));
  $("#inq-intent").insertAdjacentHTML("afterend", micBar("inq-intent", false));
  wireMics($("#inq-bench .left"));
  renderSamples(); pickSample(0); renderInquiry();
  renderProducts(); renderListingOptions(); renderListing();
  renderCheckControls();
  $("#chk-text").value = sampleFor($("#chk-product").value);
  // Switching the product swaps in that product's sample, unless the text was edited by hand.
  $("#chk-product").addEventListener("change", () => { if (Object.values(META.check_samples || {}).includes($("#chk-text").value)) $("#chk-text").value = sampleFor($("#chk-product").value); });
  $("#chk-out").innerHTML = emptyCard("scan-search", "贴入文案后点“检查”", ["示例里埋了 6 个问题：长度、感叹号、促销用语、主观评价、未持有的认证、没检测过的材料宣称。"]);
  $$("[data-page]").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $("#inq-run").addEventListener("click", runInquiry);
  $("#lst-run").addEventListener("click", runListing);
  $("#chk-run").addEventListener("click", runCheck);
  $("#log-refresh").addEventListener("click", renderLogs);
  $("#board-batch").addEventListener("click", runBatch);
  $("#board-add").addEventListener("click", () => openProductForm());
  $("#ov-roles").addEventListener("click", showRolePicker);
  // One-click samples on the check page (the texts the demo cache was recorded with).
  const SAMPLE_NAMES = { "KET-17S": "水壶标题：埋了 6 个问题", "TMB-50V": "保温杯标题（另一家工厂）" };
  $("#chk-samples").innerHTML = `<span class="small muted">试试示例：</span>` + Object.keys(META.check_samples || {}).map((pid) =>
    `<button class="chip" data-sample="${esc(pid)}">${esc(SAMPLE_NAMES[pid] || pid)}</button>`).join("");
  $$("#chk-samples [data-sample]").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault(); state.chkPlatform = "amazon_us"; renderCheckControls();
    $("#chk-product").value = b.dataset.sample; $("#chk-text").value = sampleFor(b.dataset.sample); runCheck();
  }));
  $("#tour-btn").addEventListener("click", () => startTour(false));
  $("#role-btn").addEventListener("click", showRolePicker);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && tourState.on) tourState.on = false; });
  $("#model-card").addEventListener("click", () => openSettings().catch((e) =>
    toast(/not found|404/i.test(e.message) ? "服务端还是旧版本：在终端按 Ctrl+C 停掉服务，再重新启动" : `打不开模型设置：${e.message}`)));
  $("#mode-pill").addEventListener("click", () => $("#model-card").click());
  wireTips();
  $("#model-card").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#model-card").click(); } });
  $("#inbox-triage").addEventListener("click", runTriage);
  $("#inbox-import").addEventListener("click", openImport);
  $("#agents-dl").addEventListener("click", downloadAgents);
  $("#kb-recheck").addEventListener("click", recheckSources);
  $("#sc-run").addEventListener("click", renderSelfcheck);
  $("#sc-warm").addEventListener("click", warmBooth);
  $("#sc-test").addEventListener("click", testModel);
  $$("#inbox-tabs button").forEach((b) => b.addEventListener("click", () => showInboxTab(b.dataset.v)));
  $("#eval-fails").addEventListener("change", renderEval);
  $$("#eval-tabs button").forEach((b) => b.addEventListener("click", () => showEvalTab(b.dataset.v)));
  $("#board-all").addEventListener("change", (e) => { boardState.selected = new Set(e.target.checked ? META.products.map((p) => p.id) : []); renderBoard(); });
  $("#scrim").addEventListener("click", closeSheet);
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  $("#kb-q").addEventListener("input", renderKB);
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#theme-btn use").setAttribute("href", cur === "dark" ? "#i-sun" : "#i-moon");
  $("#theme-btn").addEventListener("click", () => setTheme((document.documentElement.dataset.theme || cur) === "dark" ? "light" : "dark"));
  addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !(document.activeElement.id || "").endsWith("-ins")) {
      e.preventDefault();
      ({ inquiry: runInquiry, listing: runListing, check: runCheck })[page]?.();
    } else if (!typing && !role && !e.metaKey && !e.ctrlKey && /^[1-9]$/.test(e.key) && !$("#sheet").classList.contains("on")) go(Object.keys(PAGES)[+e.key - 1]);
  });
  renderOverview();
  if (/^#roles?\b/.test(location.hash)) { const m = location.hash.match(/^#role=(\w+)/); return m ? setRole(m[1]) : showRolePicker(); }
  if (/^#tour/.test(location.hash)) return startTour(location.hash === "#tour=loop");
  await runDemoFromHash();
}

// #demo=<page>:<sample or product index>:<rounds>:<tab>:<theme>  e.g. #demo=inquiry:0:2:diff:light
// Replays a fixed scenario so the presenter (or a screenshot script) lands on the exact state.
async function runDemoFromHash() {
  const m = location.hash.match(/^#demo=([a-z]+):?(\d*):?(\d*):?([a-z]*):?([a-z]*)/);
  if (!m) return;
  const [, p, idx, rounds, tab, theme] = m;
  document.body.classList.add("demo");
  if (theme) setTheme(theme);
  go(p);
  const n = Math.max(1, +rounds || 1);
  if (p === "inquiry") {
    pickSample(+idx || 0); await runInquiry();
    for (let i = 1; i < n; i++) { $("#inq-ins").value = "按风险提示全部修改"; await reviseInquiry(); }
    if (tab) $(`#inq-tabs [data-t="${tab}"]`)?.click();
  } else if (p === "listing") {
    pickProduct(META.products[+idx || 0].id); await runListing();
    for (let i = 1; i < n; i++) { $("#lst-ins").value = "按风险提示全部修改"; await reviseListing(); }
  } else if (p === "check") {
    await runCheck();
  } else if (p === "eval") {
    const tab = ({ "1": "rules", "2": "redteam", "3": "savings" })[idx] || "compare";
    await showEvalTab(tab);
    if (tab === "redteam") await runRedteam();
  } else if (p === "inbox") {
    await renderInbox();
    if (idx === "1") showInboxTab("tasks");
  } else if (p === "board") {
    await renderBoard();
    const cell = location.hash.match(/^#demo=board:([A-Z0-9-]+):([a-z_]+)/);
    if (cell) await openCell(cell[1], cell[2]);
  }
  window.scrollTo({ top: 0 });
  document.body.dataset.ready = "1";
}
boot().catch((e) => toast("启动失败：" + e.message));
