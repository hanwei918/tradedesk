"use strict";
/* TradeDesk front end — vanilla JS, no build step. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (n, cls = "") => `<svg class="ic ${cls}"><use href="#i-${n}"/></svg>`;
const RISK = { red: "不能发", amber: "需人工确认", green: "可以发" };
const RISK_ICON = { red: "shield-alert", amber: "triangle-alert", green: "shield-check" };
const SEV = { red: "红", amber: "黄" };
const FLAG = { en: "🇺🇸", es: "🇲🇽" };
const PAGES = { overview: "概览", board: "商品看板", inbox: "询盘收件箱", inquiry: "询盘回复", listing: "多平台上架", check: "文案体检", eval: "评测与对照", kb: "规则知识库", logs: "调用日志", fair: "游园会找茬" };
const PLAT = { amazon_us: { name: "Amazon 美国站", lang: "英语", cls: "amz", mark: "a" }, tiktok_mx: { name: "TikTok Shop 墨西哥", lang: "西班牙语", cls: "tt", mark: "♪" } };
let META = null, KB = null, page = "overview";
const state = { inq: { history: [], view: -1, busy: false }, lst: { history: [], view: -1, busy: false }, chkPlatform: "amazon_us" };

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
const catNames = () => ({ platform_amazon: "Amazon 平台", platform_amazon_image: "Amazon 主图", platform_alibaba: "阿里国际站", platform_tiktok: "TikTok Shop", compliance_us: "美国合规", compliance_mx: "墨西哥合规", contract: "合同条款", culture: "商务礼仪" });

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
    const meta = t ? `<span class="t">${t.meta.source === "replay" ? "回放 " : ""}${fmtS(t.meta.seconds)}</span>` : "";
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
    <button class="btn primary" id="${id}-rev">${ic("send", "sm")}改出第 ${round} 轮</button></div></div>`;
}

function wireComposer(id, fn) {
  $$(`[data-chip="${id}"]`).forEach((b) => b.addEventListener("click", () => { $(`#${id}-ins`).value = b.textContent; $(`#${id}-ins`).focus(); }));
  $(`#${id}-rev`).addEventListener("click", fn);
  $(`#${id}-ins`).addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fn(); } });
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
  if (META) $("#ov-eyebrow").innerHTML = `${ic("building-2", "sm")}${esc(META.factory.name_zh)}`;
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
    kpi("green", "ban", "丢弃的无出处提示", dropped, `<div class="pills"><span>出处守卫 · 代码执行</span></div>`, "模型说不出依据，没有展示给用户");

  // channel health, from the product board
  if (board) {
    const rows = board.rows;
    $("#ov-chan-note").textContent = `商品看板 · ${rows.length} 个产品 × ${board.channels.length} 个渠道的最新检查结果`;
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
  $("#inq-samples").innerHTML = META.inquiries.map((q, i) => `<button class="sample" data-i="${i}"><span class="flag">${FLAG[q.language] || "🌐"}</span><span><b>${esc(q.label_zh)}</b><span>${esc(q.text.slice(0, 64))}…</span></span></button>`).join("");
  $$("#inq-samples .sample").forEach((b) => b.addEventListener("click", () => pickSample(+b.dataset.i)));
}
function pickSample(i) {
  const q = META.inquiries[i];
  state.inqId = q.id;
  $$("#inq-samples .sample").forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
  $("#inq-text").value = q.text; $("#inq-intent").value = q.intent_zh; $("#inq-product").value = q.product_id;
}

function analysisCard(u) {
  const b = u.buyer || {};
  const items = (arr, fn) => (arr && arr.length ? arr.map(fn).join("") : `<div class="small muted">无</div>`);
  return `<div class="card" style="margin-top:16px"><div class="card-h"><div><h3>${ic("user")}询盘分析</h3><p>每一条都标了询盘原文；找不到原文出处的条目已被丢弃${u.dropped_without_quote ? `（${u.dropped_without_quote} 条）` : ""}</p></div></div>
    <div class="analysis-grid"><div class="buyer"><div class="row"><div class="avatar">${FLAG[b.language] || "🌐"}</div><div><b>${esc(b.country_guess || "未知国家")}</b><div class="small muted">${esc(b.business_type_zh || "")}</div></div></div>
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
      <div class="card"><div class="tabs" id="inq-tabs">
          <button class="on" data-t="reply">${ic("send", "sm")}发给买家 <span class="badge">${FLAG[r.language] || ""} ${esc(r.language)}</span></button>
          <button data-t="brief">${ic("building-2", "sm")}内部备忘 <span class="badge">中文</span></button>
          <button data-t="diff" ${r.diff ? "" : "disabled"}>${ic("git-compare-arrows", "sm")}与上一轮对比</button>
        </div>
        <div data-pane="reply" class="doc">${highlight(r.reply, r.findings, "reply")}</div>
        <div data-pane="brief" class="brief" hidden>${esc(r.internal_brief_zh)}</div>
        <div data-pane="diff" class="doc diff" hidden>${diffHtml(r.diff)}</div>
        ${r.notes_zh ? `<div class="card-b small muted" style="border-top:1px solid hsl(var(--border))">${ic("sparkles", "sm")} 写法：${esc(r.notes_zh)}</div>` : ""}
      </div>
      <div class="card">${riskPanel(r)}</div>
    </div>
    ${tasksCard(r)}
    ${analysisCard(st.history[0].understanding)}
    ${latest ? composer("inq", ["按风险提示全部修改", "语气更热情一点，强调可以寄样", "把定金改成 50%", "再简短一点"], st.history.length + 1) : ""}`;
  $$("#inq-tabs button").forEach((b) => b.addEventListener("click", () => {
    $$("#inq-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $$("#inq-out [data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.t));
  }));
  wireLinks($("#inq-out")); wireEdit($("#inq-out"));
  $$("#inq-out [data-go-tasks]").forEach((b) => b.addEventListener("click", () => { go("inbox"); showInboxTab("tasks"); }));
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
  $("#lst-products").innerHTML = META.products.map((p) => `<button class="product" data-id="${p.id}"><b>${esc(p.name_zh)}</b><span>MOQ ${p.moq_units} · ${esc(p.certifications_held.join(" / "))}</span></button>`).join("");
  $$("#lst-products .product").forEach((b) => b.addEventListener("click", () => pickProduct(b.dataset.id)));
  pickProduct(META.products[0].id);
}
function pickProduct(id) {
  state.lstProduct = id;
  $$("#lst-products .product").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  $("#lst-card").textContent = JSON.stringify(META.products.find((p) => p.id === id), null, 1);
}

function amazonPreview(d) {
  const f = d.findings, c = d.content || {};
  const bullets = (c.bullets || []).map((b, i) => `<li>${highlight(b, f, `bullets[${i + 1}]`)}</li>`).join("");
  const len = (c.title || "").length;
  return `<div class="amz-preview"><div class="fieldlab">标题 <span class="badge ${len > 75 ? "red" : "green"}">${len} / 75 字符</span></div>
    <div class="t">${highlight(c.title, f, "title")}</div><div class="meta">Visit the [Brand] Store（预览占位）</div>
    <div class="fieldlab">About this item</div><ul>${bullets}</ul>
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

function renderListing() {
  const st = state.lst;
  $("#lst-rounds").innerHTML = roundsHtml(st, "lst");
  $$("#lst-rounds [data-round]").forEach((b) => b.addEventListener("click", () => { st.view = +b.dataset.round.split(":")[1]; renderListing(); }));
  if (!st.history.length) {
    $("#lst-out").innerHTML = emptyCard("store", "选择产品和平台，点“生成 → 校验”", ["Amazon 按 Seller Central 规则检查：标题 ≤75 字符、禁用字符、促销用语…", "TikTok 墨西哥按平台内容政策和 NOM 规则检查。"]);
    return;
  }
  const r = st.history[st.view];
  const latest = st.view === st.history.length - 1;
  const names = r.trace.map((t) => `${t.role}`);
  const cards = Object.entries(r.platforms).map(([p, d]) => {
    const P = PLAT[p];
    const hasDiff = d.diff && Object.values(d.diff).some((ops) => ops.some((o) => o.op !== "equal"));
    return `<div class="card" data-scope data-plat="${p}">
      <div class="card-h"><div class="plat"><span class="pl ${P.cls}">${P.mark}</span><div><h3>${esc(P.name)}</h3><p>${esc(P.lang)} · ${p === "amazon_us" ? "Listing" : "种草短视频"}</p></div></div>
        <div class="row"><div class="seg"><button class="on" data-v="pre">预览</button><button data-v="diff" ${hasDiff ? "" : "disabled"}>对比</button></div><span class="badge ${d.risk}">${RISK[d.risk]}</span></div></div>
      <div data-view="pre">${p === "amazon_us" ? amazonPreview(d) : tiktokPreview(d)}</div>
      <div data-view="diff" hidden class="card-b">${d.diff ? Object.entries(d.diff).filter(([, ops]) => ops.some((o) => o.op !== "equal")).map(([k, ops]) => `<div class="fieldlab">${esc(k)}</div><div class="doc compact diff">${diffHtml(ops)}</div>`).join("") : ""}</div>
      <div class="sep" style="margin:0"></div>${riskPanel(d)}</div>`;
  }).join("");
  $("#lst-out").innerHTML = `<div class="card"><div class="steps-wrap">${stepsBar(names, r.trace, false)}${editBtn("lst-bench")}</div>
      ${!latest ? `<div class="callout" style="margin:12px 16px">${ic("info")}<div>正在查看第 ${st.view + 1} 轮（历史）。</div></div>` : ""}</div>
    <div class="grid ${Object.keys(r.platforms).length > 1 ? "g2" : ""}" style="margin-top:16px;align-items:start">${cards}</div>
    ${latest ? composer("lst", ["按风险提示全部修改", "标题再短一点，突出 304 不锈钢", "TikTok 开头更抓人一点"], st.history.length + 1) : ""}`;
  $$("#lst-out [data-plat]").forEach((card) => $$(".seg button", card).forEach((b) => b.addEventListener("click", () => {
    $$(".seg button", card).forEach((x) => x.classList.toggle("on", x === b));
    $$("[data-view]", card).forEach((v) => (v.hidden = v.dataset.view !== b.dataset.v));
  })));
  wireLinks($("#lst-out")); wireEdit($("#lst-out"));
  if (latest) wireComposer("lst", reviseListing);
}

const selectedPlatforms = () => [["#lst-amz", "amazon_us"], ["#lst-tt", "tiktok_mx"]].filter(([s]) => $(s).checked).map(([, p]) => p);

async function runListing() {
  if (state.lst.busy) return;
  const plats = selectedPlatforms();
  if (!plats.length) return toast("至少选一个平台");
  const btn = $("#lst-run");
  state.lst.busy = true; busy(btn, true, "生成中…");
  $("#lst-out").innerHTML = loadingCard(plats.flatMap((p) => [`${PLAT[p].name} · 生成`, "合规审核"]));
  try {
    const r = await api("/api/listing", { product_id: state.lstProduct, platforms: plats, round: 1 });
    state.lst.history = [r]; state.lst.view = 0; $("#lst-bench").classList.add("collapsed");
  } catch (e) { toast(e.message); }
  state.lst.busy = false; busy(btn, false); renderListing();
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
    const r = await api("/api/listing", { product_id: state.lstProduct, platforms: Object.keys(p.platforms), previous, instruction_zh: instruction, round: p.round + 1 });
    st.history.push(r); st.view = st.history.length - 1;
    toast(`第 ${r.round} 轮完成`, "ok");
  } catch (e) { toast(e.message); }
  st.busy = false; renderListing();
}

// ------------------------------------------------------------------ check
function renderCheckControls() {
  const SHORT = { alibaba_rfq: "阿里国际站", amazon_us: "Amazon US", tiktok_mx: "TikTok MX" };
  $("#chk-platform").innerHTML = Object.keys(META.platforms).map((k) => `<button data-p="${k}" class="${k === state.chkPlatform ? "on" : ""}">${esc(SHORT[k] || k)}</button>`).join("");
  $$("#chk-platform button").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); state.chkPlatform = b.dataset.p; renderCheckControls(); }));
}
async function runCheck() {
  const btn = $("#chk-run");
  busy(btn, true, "检查中…");
  try {
    const r = await api("/api/check", { platform: state.chkPlatform, product_id: $("#chk-product").value, text: $("#chk-text").value });
    $("#chk-bench").classList.add("collapsed");
    $("#chk-out").innerHTML = `<div class="result" data-scope><div class="card"><div class="card-h"><h3>${ic("file-text")}待检查文案</h3><div class="row"><span class="badge">${esc(META.platforms[state.chkPlatform])}</span>${editBtn("chk-bench")}</div></div>
      <div class="doc">${highlight(r.fields.text, r.findings, "text")}</div></div><div class="card">${riskPanel(r)}</div></div>`;
    wireLinks($("#chk-out")); wireEdit($("#chk-out"));
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
  const stat = (k, iconName, v, d, cls = "") => `<div class="card stat"><div class="k">${esc(k)}${ic(iconName)}</div><div class="v ${cls}">${v}</div><div class="d">${d}</div></div>`;
  $("#board-stats").innerHTML =
    stat("产品", "package", rows.length, `${cells.length} 个渠道格子`) +
    stat("可上架 / 已上架", "circle-check-big", n((c) => c.risk === "green" || c.listed), `其中已上架 ${n((c) => c.listed)}`, "green") +
    stat("需人工确认", "triangle-alert", n((c) => c.risk === "amber" && !c.listed), "黄色：有依据的风险点", "amber") +
    stat("不能发", "shield-alert", n((c) => c.risk === "red"), "红色：明确违反规则", "red") +
    stat("未生成 / 未上传", "circle-dot", n((c) => !c.risk), "点格子开始");
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
    return `<tr class="${boardState.selected.has(r.product_id) ? "sel" : ""}"><td><input type="checkbox" class="ck" data-sel="${r.product_id}" ${boardState.selected.has(r.product_id) ? "checked" : ""}></td>
      <td><div class="prod"><div class="thumb">${thumb}</div><div><b>${esc(p.name_zh)}</b><span>${esc(p.id)} · ${esc(p.name_en)}</span><span>MOQ ${p.moq_units} · ${esc(priceRange(p))}</span></div></div></td>
      <td>${cellHtml("image")}</td><td>${cellHtml("amazon_us")}</td><td>${cellHtml("tiktok_mx")}</td></tr>`;
  }).join("");
  $$("#board-body [data-cell]").forEach((b) => b.addEventListener("click", () => { const [pid, ch] = b.dataset.cell.split(":"); openCell(pid, ch); }));
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
  boardState.running.delete(`${pid}:${ch}`); renderBoard();
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
      try { r = await api("/api/image-check", { product_id: p.id, image: chosen.url, name: chosen.name }); cell.listed = false; toast(`主图检查完成：${RISK[r.risk]}`, "ok"); renderBoard(); render(); }
      catch (e) { toast(e.message); busy($("#img-run"), false); }
    });
  };
  render();
}


// ------------------------------------------------------------------ inbox & tasks
let inboxTab = "list", taskRole = "全部";
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
      <div class="body"><b>${FLAG[q.language] || ""} ${esc(q.label_zh)}</b> <span class="small muted">${esc(q.id)} · ${esc(b.country_guess || "")} ${esc(b.business_type_zh || "")}</span>
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
  const tasks = data.tasks.filter((t) => taskRole === "全部" || t.role_zh === taskRole);
  const col = (st) => `<div class="col"><h4><span>${st}</span><span class="muted">${tasks.filter((t) => t.status === st).length}</span></h4>${tasks.filter((t) => t.status === st).map((t) => {
    const i = data.task_status.indexOf(st);
    return `<div class="task"><div class="row"><span class="badge brand">${esc(t.role_zh)}</span>${t.priority === "high" ? '<span class="badge red">急</span>' : ""}<span class="small muted" style="margin-left:auto">${esc(t.inquiry_id)}</span></div>
      <div style="margin-top:6px">${esc(t.task_zh)}</div><div class="q">“${esc(t.quote)}”</div>
      <div class="acts"><button class="btn sm ghost" data-mv="${t.id}:${i - 1}" ${i === 0 ? "disabled" : ""}>←</button><span class="small muted">${esc(t.inquiry_label_zh)}</span><button class="btn sm ghost" data-mv="${t.id}:${i + 1}" ${i === 2 ? "disabled" : ""}>→</button></div></div>`;
  }).join("") || '<div class="small muted" style="padding:6px">空</div>'}</div>`;
  $("#inbox-tasks").innerHTML = data.tasks.length ? `<div class="chips" style="margin-bottom:12px">${roles.map((r) => `<button class="chip ${r === taskRole ? "on" : ""}" data-role="${esc(r)}">${esc(r)}</button>`).join("")}</div>
    <div class="kanban">${data.task_status.map(col).join("")}</div>`
    : emptyCard("building-2", "还没有任务", ["处理询盘时，系统会把需要采购、生产、美工跟进的事拆成任务，每条都挂着询盘原文。"]);
  $$("#inbox-tasks [data-role]").forEach((b) => b.addEventListener("click", () => { taskRole = b.dataset.role; renderInbox(); }));
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
  try { const r = await api("/api/inbox/triage", {}); toast(`已整理 ${r.triaged.length} 条询盘`, "ok"); }
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
  ["compare", "rules", "redteam"].forEach((k) => ($(`#eval-${k}`).hidden = k !== v));
  return ({ compare: renderCompare, rules: renderEval, redteam: renderRedteam })[v]();
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
  $("#kb-note").textContent = `${verified}/${KB.rules.length} 条已对照原文逐字核实 · 抓取日期 ${KB.version} · 未核实的规则不参与检查`;
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
      <td>${r.verified ? `<span class="badge green">${ic("circle-check-big", "sm")}已核实</span>` : `<span class="badge amber">未核实</span>`}</td></tr>
    <tr class="detail" data-for="${esc(r.id)}" hidden><td></td><td colspan="5"><div class="src" style="border:0;margin:0;padding:0"><blockquote>“${esc(r.excerpt)}”</blockquote>
      <div>${r.check ? `<code>${esc(JSON.stringify(r.check))}</code>` : ""}</div></div></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">没有匹配的规则</div></td></tr>`;
  $$("#kb-body tr[data-id]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const d = $(`#kb-body tr[data-for="${tr.dataset.id}"]`); d.hidden = !d.hidden;
  }));
}

// ------------------------------------------------------------------ logs
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
    { d: 7000, cap: "业务员每天先看收件箱：8 条询盘按优先级排好，每一分都能看到依据。", sub: "分数由代码按公开公式计算，依据是询盘原文",
      run: async () => { go("inbox"); await renderInbox(); showInboxTab("list"); const d = $("#inbox-list details"); if (d) d.open = true; spot($("#inbox-list .mail")); } },
    { d: 8000, cap: "这条美国询盘里埋了五个坑：要 UL、要 BPA free、FOB 空运、20 天交货、货到 60 天付款。", sub: "询盘分析员逐条找出和工厂资料对不上的地方，每条都标了询盘原文",
      run: async () => { go("inquiry"); pickSample(0); state.inqId = null; await runInquiry(); await sleep(300); spot($("#inq-out .analysis-grid")); } },
    { d: 8000, cap: "回复如实说明了没有 UL、FOB 只走海运。校验又抓到一处更细的问题：集装箱货用 FCA 更合适。", sub: "依据是 ICC 的原文和链接，不是模型自己说的",
      run: async () => { window.scrollTo({ top: 0, behavior: "smooth" }); await sleep(300); spot($("#inq-out .finding")); } },
    { d: 7500, cap: "业务员只说一句“按风险提示全部修改”，第 2 轮就变绿；需要采购、生产、美工跟进的事自动派成任务。", sub: "右上角是轮次，“与上一轮对比”里能看到新增的那句话",
      run: async () => { $("#inq-ins").value = "按风险提示全部修改"; await reviseInquiry(); $('#inq-tabs [data-t="diff"]')?.click(); await sleep(200); spot($("#inq-out .result .card")); } },
    { d: 6500, cap: "商品看板：4 个产品 × 主图 / Amazon / TikTok，运营一眼看到哪里卡住了。", sub: "一键批量生成上品，导出 CSV",
      run: async () => { go("board"); await renderBoard(); spot($(".board")); } },
    { d: 8500, cap: "主图检查：白底、占比、尺寸由代码测像素；徽章、促销字、道具由模型看图，必须写出看到了什么。", sub: "这张图被标了 5 条红；红色时“标记已上架”按钮是灰的",
      run: async () => { await openCell("KET-17S", "image"); } },
    { d: 6500, cap: "同一份中文资料，同时生成 Amazon 美国站英文 Listing 和 TikTok 墨西哥西语脚本，各按平台规则检查。", sub: "Amazon 标题现在最多 75 个字符，这里实时计数",
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
  $$(".product-select").forEach((s) => { s.innerHTML = META.products.map((p) => `<option value="${p.id}">${esc(p.name_zh)}</option>`).join(""); });
  renderSamples(); pickSample(0); renderInquiry();
  renderProducts(); renderListing();
  renderCheckControls();
  $("#chk-text").value = "BEST SELLER!! [Brand] 1.7L Electric Kettle, BPA Free, UL Listed, Free Shipping";
  $("#chk-out").innerHTML = emptyCard("scan-search", "贴入文案后点“检查”", ["示例里埋了 6 个问题：长度、感叹号、促销用语、主观评价、未持有的认证、没检测过的材料宣称。"]);
  $$("[data-page]").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $("#inq-run").addEventListener("click", runInquiry);
  $("#lst-run").addEventListener("click", runListing);
  $("#chk-run").addEventListener("click", runCheck);
  $("#log-refresh").addEventListener("click", renderLogs);
  $("#board-batch").addEventListener("click", runBatch);
  $("#tour-btn").addEventListener("click", () => startTour(false));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && tourState.on) tourState.on = false; });
  $("#model-card").addEventListener("click", () => openSettings().catch((e) =>
    toast(/not found|404/i.test(e.message) ? "服务端还是旧版本：在终端按 Ctrl+C 停掉服务，再重新启动" : `打不开模型设置：${e.message}`)));
  $("#mode-pill").addEventListener("click", () => $("#model-card").click());
  wireTips();
  $("#model-card").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#model-card").click(); } });
  $("#inbox-triage").addEventListener("click", runTriage);
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
    } else if (!typing && !e.metaKey && !e.ctrlKey && /^[1-9]$/.test(e.key) && !$("#sheet").classList.contains("on")) go(Object.keys(PAGES)[+e.key - 1]);
  });
  renderOverview();
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
    const tab = ({ "1": "rules", "2": "redteam" })[idx] || "compare";
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
