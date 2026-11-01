"use strict";
// The extension's only screen: pick a product, check a reply against the local TradeDesk, show findings with sources.
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RISK = { red: ["red", "有明确违规，不能直接发"], amber: ["amber", "有风险点，需要人确认"], green: ["green", "没有发现问题"] };
let cfg = { server: "http://127.0.0.1:8765", code: "", product: "", market: "", model: false };

async function api(path, body) {
  const r = await fetch(cfg.server.replace(/\/$/, "") + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-TradeDesk-Code": cfg.code.trim().toUpperCase() },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error("配对码不对或没填：到 TradeDesk“开摊自检”页复制配对码，点右上角“设置”填进来");
  if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function connect() {
  const status = $("#status");
  if (!cfg.code) { status.textContent = "还没填配对码：点右上角“设置”"; $("#settings").hidden = false; return false; }
  try {
    const meta = await api("/api/plugin/meta");
    $("#product").innerHTML = meta.products.map((p) => `<option value="${esc(p.id)}">${esc(p.name_zh || p.name_en)} · ${esc(p.id)}</option>`).join("");
    if (cfg.product && meta.products.some((p) => p.id === cfg.product)) $("#product").value = cfg.product;
    $("#market").value = cfg.market || "";
    $("#model").checked = !!cfg.model;
    status.textContent = `已连接 · ${meta.llm.mode === "replay" ? "回放模式（不调用模型）" : "实时模式 · " + meta.llm.model}`;
    status.className = "ok";
    return true;
  } catch (e) {
    status.textContent = e.message.includes("Failed to fetch") ? "连不上本机 TradeDesk：先在电脑上启动它（app/ 里运行 python3 server.py）" : e.message;
    status.className = "err";
    return false;
  }
}

function render(r) {
  const findings = r.findings || [];
  const [cls, label] = RISK[r.risk] || RISK.amber;
  const skipped = r.review_skipped ? `<p class="note">${esc(r.review_skipped.reason_zh || "模型审核没有运行")}，所以结果不会显示绿色。</p>` : "";
  const items = findings.map((f, i) => {
    const s = f.source || {};
    const src = s.rule_id
      ? `<b>${esc(s.rule_id)}</b> ${esc(s.title_zh || "")}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">原文</a>` : ""}`
      : esc(s.label_zh || "工厂资料卡");
    return `<article class="f ${f.severity === "red" ? "red" : "amber"}"><div class="h"><span>#${i + 1}</span><b>${esc(f.problem_zh)}</b></div>
      ${f.quote ? `<q>${esc(f.quote)}</q>` : ""}${f.suggestion_zh ? `<p class="fix">改法：${esc(f.suggestion_zh)}</p>` : ""}<small>依据：${src}</small></article>`;
  }).join("");
  $("#result").innerHTML = `<div class="risk ${cls}">${label} · ${findings.length} 条</div>${skipped}${items || '<p class="note">代码规则没发现问题。</p>'}`;
}

async function run() {
  const text = $("#text").value.trim();
  if (text.length < 5) { $("#result").innerHTML = '<p class="note">先选中或粘贴一段回复。</p>'; return; }
  cfg.product = $("#product").value; cfg.market = $("#market").value; cfg.model = $("#model").checked;
  await chrome.storage.local.set({ cfg });
  const btn = $("#run");
  btn.disabled = true; btn.textContent = cfg.model ? "检查中（含模型审核）…" : "检查中…";
  try {
    const body = { product_id: cfg.product, platform: "alibaba_rfq", text, rules_only: !cfg.model };
    if (cfg.market) body.market = cfg.market;
    render(await api("/api/check", body));
  } catch (e) {
    $("#result").innerHTML = `<p class="note err">${esc(e.message)}</p>`;
  }
  btn.disabled = false; btn.textContent = "检查这段回复";
}

async function boot() {
  const saved = (await chrome.storage.local.get("cfg")).cfg;
  if (saved) cfg = { ...cfg, ...saved };
  $("#server").value = cfg.server; $("#code").value = cfg.code;
  const ok = await connect();
  const { pending } = await chrome.storage.session.get("pending");
  if (pending) {
    $("#text").value = pending;
    await chrome.storage.session.remove("pending");
    if (ok) run();
  }
}

$("#toggle-settings").addEventListener("click", () => { $("#settings").hidden = !$("#settings").hidden; });
$("#save").addEventListener("click", async () => {
  cfg.server = $("#server").value.trim() || "http://127.0.0.1:8765";
  cfg.code = $("#code").value.trim().toUpperCase();
  await chrome.storage.local.set({ cfg });
  if (await connect()) $("#settings").hidden = true;
});
$("#run").addEventListener("click", run);
boot();
