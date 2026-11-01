/* Entry gate: the first thing a visitor sees on the workbench. Slide to unlock, a short scan, then pick
   the Sandbox walk-through or the full workbench. Skipped for links with a #hash (demos, role lanes, tours)
   and once per tab; #welcome or a click on the sidebar logo shows it again. Numbers are the measured ones. */
(() => {
  const KEY = "td-entered";
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seen = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  const remember = () => { try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* private mode */ } };

  const HTML = `
  <div class="gt-top"><span class="gt-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="4.5" width="9" height="6" rx="1.5"/><rect x="2.5" y="13" width="9" height="6" rx="1.5" opacity=".72"/><rect x="12.5" y="13" width="9" height="6" rx="1.5"/></svg></span><b>TradeDesk</b><span class="gt-event">INTERCITY HACK 宁波站 · 赛道二 · TEAM HE</span></div>
  <div class="gt-ghost" aria-hidden="true">STOP AI FROM MAKING EXPENSIVE PROMISES</div>
  <main class="gt-main">
    <span class="gt-kick">TRADEDESK · 出海工作台</span>
    <h1>不帮你写更像的文案，<br>只帮你<span>拦下最贵的错误</span>。</h1>
    <p class="gt-en">Stop AI from making expensive promises.</p>
    <p class="gt-pos">给出海工厂的发出前合规校验层<i>·</i>The pre-send compliance layer for export factories</p>
    <div class="gt-tags">
      <span>🛡️ 没出处就丢弃<small>No source, no claim</small></span>
      <span>🌍 多地区合规拦截<small>Multi-region rules</small></span>
      <span>⚡ 代码级硬拦截<small>Code-level checks</small></span>
    </div>
    <div class="gt-proof"><span><b class="r">8 / 8</b>通用 AI 只看询盘，条条带红</span><span><b class="a">0 红</b>贴上工厂资料，仍有 20 处待确认</span><span><b class="g">3 / 8</b>TradeDesk 改一轮，可直接发</span></div>
    <div class="gt-stage">
      <div class="gt-track" role="group" aria-label="向右滑动进入 TradeDesk">
        <span class="gt-fill"></span>
        <span class="gt-hint">向右滑动，进入 TradeDesk<em>Slide to enter</em></span>
        <button class="gt-knob" type="button" aria-label="滑动解锁，或按回车进入">➜</button>
      </div>
      <div class="gt-choices" hidden>
        <button class="gt-card main" type="button" data-go="sandbox"><b>🚀 启动合规演练</b><small>Launch Sandbox · 模拟情境，4 个通关任务，约 3 分钟</small></button>
        <button class="gt-card" type="button" data-go="workbench"><b>🧭 进入完整工作台</b><small>Open Workbench · 询盘、上架、看板、规则库，真实工作流</small></button>
        <div class="gt-links"><button type="button" data-go="roles">按角色体验</button><button type="button" data-go="tech">了解底层机制 · View tech specs</button></div>
      </div>
    </div>
  </main>
  <footer class="gt-foot"><b>由 TEAM HE 开发 · Harvey 周翰维 · Ellie 桑睿哲 · 致敬宁波出海企业</b><span>示例工厂、客户和回复均为虚构；数字来自实测：对照实验、盲测集、红队测试。</span></footer>
  <div class="gt-scan" aria-hidden="true"><i></i><p><b>Secure Environment Initialized…</b><span>正在初始化安全环境：载入资料卡 · 61 条带出处规则 · 出处守卫</span></p></div>`;

  function close(after) {
    const gate = document.getElementById("gate");
    remember();
    if (!gate) return after?.();
    gate.classList.add("gt-out");
    setTimeout(() => { gate.remove(); document.body.classList.remove("gt-lock"); after?.(); }, calm() ? 0 : 450);
  }

  function open() {
    if (document.getElementById("gate")) return;
    const gate = document.createElement("section");
    gate.id = "gate";
    gate.className = "gate";
    gate.setAttribute("aria-label", "TradeDesk 进门页");
    gate.innerHTML = HTML;
    document.body.appendChild(gate);
    document.body.classList.add("gt-lock");
    const knob = gate.querySelector(".gt-knob"), track = gate.querySelector(".gt-track");
    let start = 0, x = 0, max = 0, dragging = false, unlocked = false;
    const place = (v) => { x = v; knob.style.transform = `translateX(${v}px)`; track.style.setProperty("--p", max ? v / max : 0); };

    function unlock() {
      if (unlocked) return;
      unlocked = true;
      max = track.clientWidth - knob.offsetWidth - 8;
      place(max);
      track.classList.add("done");
      gate.classList.add("gt-scanning");
      setTimeout(() => {
        gate.classList.remove("gt-scanning");
        track.hidden = true;
        gate.querySelector(".gt-choices").hidden = false;
        gate.querySelector(".gt-card.main").focus({ preventScroll: true });
      }, calm() ? 0 : 1500);
    }
    knob.addEventListener("pointerdown", (e) => {
      if (unlocked) return;
      dragging = true; max = track.clientWidth - knob.offsetWidth - 8; start = e.clientX - x;
      knob.setPointerCapture(e.pointerId); track.classList.add("drag");
    });
    knob.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      place(Math.max(0, Math.min(max, e.clientX - start)));
      if (x >= max * 0.94) { dragging = false; unlock(); }
    });
    const release = () => {
      if (!dragging) return;
      dragging = false; track.classList.remove("drag");
      if (!unlocked) { knob.classList.add("back"); place(0); setTimeout(() => knob.classList.remove("back"), 300); }
    };
    knob.addEventListener("pointerup", release);
    knob.addEventListener("pointercancel", release);
    knob.addEventListener("keydown", (e) => { if (["Enter", " ", "ArrowRight"].includes(e.key)) { e.preventDefault(); unlock(); } });
    gate.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
      const go = b.dataset.go;
      if (go === "sandbox") { remember(); gate.classList.add("gt-out"); setTimeout(() => { location.href = "sandbox.html"; }, calm() ? 0 : 350); }
      else if (go === "workbench") close(() => window.go?.("overview"));
      else if (go === "roles") close(() => window.showRolePicker?.());
      else if (go === "tech") close(() => window.go?.("agents"));
    }));
    setTimeout(() => knob.focus({ preventScroll: true }), 50);
  }

  document.querySelector(".brand")?.addEventListener("click", open);
  if (location.hash === "#welcome") { history.replaceState(null, "", location.pathname); open(); }
  else if (!location.hash && !seen()) open();
})();
