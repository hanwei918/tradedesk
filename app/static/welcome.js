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
        <button class="gt-card main" type="button" data-gate="sandbox"><b>🚀 启动合规演练</b><small>Launch Sandbox · 模拟情境，4 个通关任务，约 3 分钟</small></button>
        <button class="gt-card" type="button" data-gate="workbench"><b>🧭 进入完整工作台</b><small>Open Workbench · 询盘、上架、看板、规则库，真实工作流</small></button>
        <div class="gt-links"><button type="button" data-gate="roles">按角色体验</button><button type="button" data-gate="tech">了解底层机制 · View tech specs</button></div>
      </div>
    </div>
  </main>
  <div class="gt-sky" aria-hidden="true">
    <div class="gt-cloud c2"></div>
    <div class="gt-plane"><span class="gt-trail"></span><svg viewBox="0 0 160 60">
      <path d="M20 24 L8 5 H21 L42 24Z" fill="#74a0ff"/><path d="M70 28 L57 13 H65 L93 27Z" fill="#94a3b8"/>
      <path d="M8 30 C8 26 14 24 24 24 H128 C142 24 152 27 156 30 C152 33 142 36 128 36 H24 C14 36 8 34 8 30Z" fill="#e2e8f0"/>
      <rect x="40" y="27" width="84" height="2.6" rx="1.3" fill="#48e2db"/><path d="M145 27 C150 28 153 29 154.5 30 L145 30Z" fill="#0f172a"/>
      <path d="M68 32 L48 55 H63 L98 33Z" fill="#cbd5e1"/>
    </svg></div>
    <div class="gt-cloud c1"></div>
  </div>
  <div class="gt-sea" aria-hidden="true">
    <div class="gt-wave w3"></div>
    <div class="gt-boat"><span class="gt-wake"></span><svg class="gt-ship" viewBox="0 0 240 96">
      <rect x="30" y="18" width="26" height="30" rx="2" fill="#e2e8f0"/><rect x="34" y="23" width="18" height="5" rx="1" fill="#0f172a"/><rect x="40" y="6" width="6" height="14" fill="#94a3b8"/>
      <g><rect x="64" y="30" width="24" height="18" rx="1.5" fill="#48e2db"/><rect x="90" y="30" width="24" height="18" rx="1.5" fill="#74a0ff"/><rect x="116" y="30" width="24" height="18" rx="1.5" fill="#b795ff"/><rect x="142" y="30" width="24" height="18" rx="1.5" fill="#48e2db"/><rect x="168" y="30" width="24" height="18" rx="1.5" fill="#74a0ff"/>
        <rect x="77" y="12" width="24" height="18" rx="1.5" fill="#74a0ff"/><rect x="103" y="12" width="24" height="18" rx="1.5" fill="#48e2db"/><rect x="129" y="12" width="24" height="18" rx="1.5" fill="#b795ff"/><rect x="155" y="12" width="24" height="18" rx="1.5" fill="#74a0ff"/></g>
      <path d="M6 48 H222 L238 48 L210 80 H22 Z" fill="#1e3a8a"/><path d="M6 48 H238 L233 56 H9 Z" fill="#f87171"/><path d="M22 80 H210 L206 86 H26 Z" fill="#0b1437"/>
    </svg></div>
    <div class="gt-wave w2"></div>
    <div class="gt-wave w1"></div>
  </div>
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
    // the slider drives the ship: it sails forward and the waves run back as the knob moves
    const place = (v) => { x = v; knob.style.transform = `translateX(${v}px)`; const r = max ? v / max : 0; track.style.setProperty("--p", r); gate.style.setProperty("--sail", r); };

    function unlock() {
      if (unlocked) return;
      unlocked = true;
      max = track.clientWidth - knob.offsetWidth - 8;
      place(max);
      track.classList.add("done");
      gate.classList.add("gt-sailing", "gt-scanning");
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
      if (!unlocked) { knob.classList.add("back"); gate.classList.add("gt-return"); place(0); setTimeout(() => { knob.classList.remove("back"); gate.classList.remove("gt-return"); }, 300); }
    };
    knob.addEventListener("pointerup", release);
    knob.addEventListener("pointercancel", release);
    knob.addEventListener("keydown", (e) => { if (["Enter", " ", "ArrowRight"].includes(e.key)) { e.preventDefault(); unlock(); } });
    gate.querySelectorAll("[data-gate]").forEach((b) => b.addEventListener("click", () => {
      const go = b.dataset.gate;
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
