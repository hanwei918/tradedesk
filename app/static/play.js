"use strict";
/* Fair-ground game: find the problems before the AI shows you. Answers come from the code rules (no model call). */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (n, cls = "") => `<svg class="ic ${cls}"><use href="#i-${n}"/></svg>`;
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
const game = { list: [], i: 0, found: 0, total: 0, name: store.get("td-player") || "" };

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function tokens(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) out.push({ s: m.index, e: m.index + m[0].length, t: m[0] });
  return out;
}

function head(sub) {
  return `<div class="hero"><div class="logo">${ic("search", "lg")}</div><div><h1>AI 找茬挑战</h1><p>${esc(sub)}</p></div></div>`;
}

function start() {
  $("#app").innerHTML = `<div class="wrap">${head("你能比 AI 先找到外贸文案里的坑吗？")}
    <div class="card"><div class="card-b">
      <p style="margin-top:0">一共 3 题。每题点出你觉得<b>有问题的词</b>，再看 AI 找到了什么，每一条都附规则出处。</p>
      <label class="field">你的昵称（上排行榜用）<input type="text" id="name" maxlength="16" value="${esc(game.name)}" placeholder="例如：宁波小王"></label>
      <button class="btn primary" id="go" style="width:100%">开始挑战</button></div></div>
    <p class="small muted" style="text-align:center;margin-top:16px">TradeDesk · INTERCITY HACK 宁波站 · 题目为虚构示例</p></div>`;
  $("#go").addEventListener("click", () => { game.name = $("#name").value.trim() || "匿名"; store.set("td-player", game.name); game.i = 0; game.found = 0; game.total = 0; question(); });
}

function question() {
  const c = game.list[game.i];
  const toks = tokens(c.text);
  $("#app").innerHTML = `<div class="wrap">${head(`${game.i + 1} / ${game.list.length} · ${game.name}`)}
    <div class="card"><div class="card-h"><div><h3>${esc(c.title_zh)}</h3><p>${esc(c.hint_zh)}</p></div></div>
      <div class="text" id="text">${toks.map((t, k) => `<span class="tok" data-k="${k}">${esc(t.t)}</span>`).join(" ")}</div>
      <div class="card-b" style="border-top:1px solid hsl(var(--border))"><p class="small muted" style="margin-top:0">点一下选中，再点一下取消。</p>
      <button class="btn primary" id="submit" style="width:100%">${ic("scan-search", "sm")}提交，看 AI 找到了什么</button></div></div></div>`;
  document.querySelectorAll(".tok").forEach((el) => el.addEventListener("click", () => el.classList.toggle("on")));
  $("#submit").addEventListener("click", async () => {
    const taps = [...document.querySelectorAll(".tok.on")].map((el) => { const t = toks[+el.dataset.k]; return [t.s, t.e]; });
    const r = await api("/api/play/check", { id: c.id, taps });
    reveal(c, toks, r);
  });
}

function reveal(c, toks, r) {
  game.found += r.found; game.total += r.total;
  document.querySelectorAll(".tok").forEach((el) => {
    const t = toks[+el.dataset.k];
    if (r.findings.some((f) => f.span && t.s < f.span[1] && t.e > f.span[0])) el.classList.add("ai");
  });
  const rows = r.findings.map((f) => `<div class="res"><span class="${f.found ? "ok" : f.span ? "no" : ""}">${f.found ? ic("circle-check-big") : f.span ? ic("circle-x") : ic("info")}</span>
    <div><b>${esc(f.problem_zh)}</b>${f.quote ? `<div class="small muted">原文：${esc(f.quote)}</div>` : ""}
    <div class="small muted">依据：${f.source.type === "kb" ? `${esc(f.source.rule_id)} ${esc(f.source.title_zh || "")}` : esc(f.source.label_zh)}</div></div></div>`).join("");
  $("#submit").parentElement.innerHTML = `<div class="row" style="justify-content:space-between"><b>本题你找到 ${r.found} / ${r.total}</b><span class="small muted">绿 = 你也找到了，红下划线 = 你漏了</span></div>
    ${rows}<button class="btn primary" id="next" style="width:100%;margin-top:12px">${game.i + 1 < game.list.length ? "下一题" : "看总成绩"}</button>`;
  $("#next").addEventListener("click", () => { game.i += 1; game.i < game.list.length ? question() : finish(); });
}

async function finish() {
  const me = await api("/api/play/score", { name: game.name, found: game.found, total: game.total });
  const lb = await api("/api/play/leaderboard");
  const rank = lb.top.findIndex((e) => e.name === me.name && e.ts === me.ts);
  $("#app").innerHTML = `<div class="wrap">${head(game.name)}
    <div class="card"><div class="card-b" style="text-align:center"><div class="small muted">你找到了</div><div class="big">${game.found} / ${game.total}</div>
      <p>${rank >= 0 ? `目前排名第 ${rank + 1}` : "继续加油！"}</p>
      <p class="small muted">AI 找到了全部 ${game.total} 处，每一条都给出了依据：平台规则的原文，或工厂资料卡上的字段。<br>这就是 TradeDesk：说不出出处的话，系统不让 AI 说。</p>
      <button class="btn" id="again">再玩一次</button></div></div></div>`;
  $("#again").addEventListener("click", start);
}

async function screen() {
  const draw = async () => {
    const lb = await api("/api/play/leaderboard");
    const url = lb.lan_url || `${location.origin}/play`;
    const qr = qrcode(0, "M"); qr.addData(url); qr.make();
    $("#qr").innerHTML = qr.createImgTag(8, 0);
    $("#url").textContent = url;
    $("#lb").innerHTML = lb.top.length ? `<table class="tbl"><tbody>${lb.top.map((e, k) => `<tr><td><b>${k + 1}</b></td><td>${esc(e.name)}</td><td style="text-align:right"><b>${e.found}</b> / ${e.total}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">还没有人挑战，扫码成为第一个！</p>`;
    $("#count").textContent = lb.players;
  };
  $("#app").innerHTML = `<div class="screen"><div id="qr"></div><div>
    <h1>AI 找茬挑战</h1><p>手机连上场馆 Wi-Fi，扫码 3 道题：你能比 AI 先找到外贸文案里的坑吗？</p>
    <p class="mono small" id="url"></p><div class="card lb"><div class="card-h"><h3>${ic("zap")}排行榜 · 已有 <span id="count">0</span> 人挑战</h3></div><div id="lb"></div></div></div></div>`;
  await draw();
  setInterval(draw, 3000);
}

(async function boot() {
  const sprite = await fetch("icons.svg").then((r) => r.text());
  document.body.insertAdjacentHTML("afterbegin", sprite);
  if (location.hash === "#screen") return screen();
  game.list = await api("/api/play/challenges");
  start();
})().catch((e) => { document.body.insertAdjacentHTML("beforeend", `<p style="padding:16px;color:red">${esc(e.message)}</p>`); });
