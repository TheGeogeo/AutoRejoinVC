/**
 * @name AutoRejoinVC
 * @author TheGeogeo
 * @version 1.0.5
 * @description Lock/unlock per voice channel with auto-reconnect. Single locked channel. Large icon (28px). Progressive backoff 500–3000 ms.
 * @website https://github.com/TheGeogeo/AutoRejoinVC
 * @source  https://github.com/TheGeogeo/AutoRejoinVC/blob/main/AutoRejoinVC.plugin.js
 */

// Remote raw URL of this plugin for update checks.
// Example below assumes your repo is public on GitHub:
const UPDATE_URL = "https://raw.githubusercontent.com/TheGeogeo/AutoRejoinVC/refs/heads/main/AutoRejoinVC.plugin.js";

module.exports = class AutoRejoinVC {
  constructor(meta) {
    this.meta = meta;
    this.pluginId = "AutoRejoinVC";
    this.currentVersion = meta?.version || "0.0.0";
    this.cssId = "auto-rejoin-vc-css";
    this.observer = null;

    // BD helpers
    this.Webpack = BdApi.Webpack;
    this.Data = BdApi.Data;
    this.DOM = BdApi.DOM;
    this.UI = BdApi.UI;

    // Stores & Discord utils
    this.UserStore = this.Webpack.getStore("UserStore");
    this.ChannelStore = this.Webpack.getStore("ChannelStore");
    this.VoiceStateStore = this.Webpack.getStore("VoiceStateStore");
    this.Router = this.Webpack.getModule(m => m?.transitionTo && m?.replaceWith);

    // Single locked channel
    this.state = { locked: this.Data.load(this.pluginId, "locked") || null };

    // Backoff
    this.minDelay = 500;   // ms
    this.maxDelay = 3000;  // ms
    this.retryDelay = this.minDelay;
    this.timer = null;
    this._lastRetryToastDelay = null;
    this._lastRetryToastTs = 0;
    this._lastRouterJump = 0;
  }

  log(...a){ BdApi.Logger.log(this.pluginId, ...a); }
  error(...a){ BdApi.Logger.error(this.pluginId, ...a); }

  isVoiceChannel(ch){ return !!ch && (ch.type === 2 || ch.type === 13); }
  getCurrentUserId(){ return this.UserStore?.getCurrentUser?.()?.id; }
  getCurrentVoiceChannelId(){
    const uid = this.getCurrentUserId(); if(!uid) return null;
    try { return this.VoiceStateStore?.getVoiceStateForUser?.(uid)?.channelId ?? null; }
    catch { return null; }
  }
  getGuildIdFromChannelId(id){ const ch = this.ChannelStore?.getChannel?.(id); return ch?.guild_id ?? ch?.guildId ?? null; }

  saveLocked(target){
    this.state.locked = target;
    this.Data.save(this.pluginId, "locked", target);
    this.refreshAllSlots();
    // reset backoff on each state change
    this.retryDelay = this.minDelay;
  }

  // Only report success when the voice join actually happened
  async tryJoinVoiceChannel(guildId, channelId) {
    // Guard: already connected
    if (this.getCurrentVoiceChannelId() === channelId) return true;

    const selectors = [
      `a[data-list-item-id="channels___${guildId}_${channelId}"]`,
      `a[data-list-item-id="channels___${channelId}"]`,
      `a[href="/channels/${guildId}/${channelId}"]`
    ];

    // Helper: click and confirm via VoiceState
    const clickAndConfirm = async (el) => {
      try { el.click(); } catch {}
      // Wait briefly for Discord to process the click and update voice state
      const joined = await this.waitForVoiceJoin(channelId, 1200);
      if (joined) return true;

      // As an extra safety, small delay then re-check
      await new Promise(r => setTimeout(r, 200));
      return this.getCurrentVoiceChannelId() === channelId;
    };

    // Try direct click on existing DOM item
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const ok = await clickAndConfirm(el);
        if (ok) return true;
      }
    }

    // Fallback: navigate to the channel view, but rate-limit router jumps
    if (this.Router && guildId && channelId) {
      const now = Date.now();
      if (now - this._lastRouterJump > 4000) {
        try {
          this.Router.transitionTo(`/channels/${guildId}/${channelId}`);
          this._lastRouterJump = now;
        } catch (e) {
          this.error("Router transition failed:", e);
        }
      }

      // Give the UI a moment to render, then try again
      await new Promise(r => setTimeout(r, 250));

      // Re-check in case something else already connected us
      if (this.getCurrentVoiceChannelId() === channelId) return true;

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const ok = await clickAndConfirm(el);
          if (ok) return true;
        }
      }
    }

    // Consider it a failure; backoff will increase
    return false;
  }

  /* ---------- UI ---------- */

  renderSlot(slot, guildId, channelId){
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    const active = !!this.state.locked &&
                   this.state.locked.guildId === guildId &&
                   this.state.locked.channelId === channelId;
    slot.appendChild(active ? this.createUnlockButton(guildId, channelId)
                            : this.createLockButton(guildId, channelId));
  }

  svgIcon(){
    return `
      <svg class="arvc-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 6V3L8 7l4 4V8c2.757 0 5 2.243 5 5a5 5 0 1 1-9.8 1h-2.05A7.002 7.002 0 0 0 12 20c3.866 0 7-3.134 7-7s-3.134-7-7-7z"></path>
      </svg>
    `;
  }

  createLockButton(guildId, channelId) {
    const btn = document.createElement("button");
    btn.className = "arvc-toggle arvc-unlocked"; // red state
    btn.type = "button";
    btn.setAttribute("aria-label", "Enable auto-reconnect");
    btn.title = "Enable auto-reconnect";
    btn.dataset.guildId = guildId || "";
    btn.dataset.channelId = channelId;
    btn.innerHTML = this.svgIcon();

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const gId = guildId || this.getGuildIdFromChannelId(channelId);
      if (!gId) {
        this.UI.showToast("Unable to identify guild for this channel.", { type: "danger" });
        return;
      }

      // Persist the single locked target
      this.saveLocked({ guildId: gId, channelId });
      this.UI.showToast("Auto-reconnect enabled", { type: "success" });

      // Do not attempt an immediate join if we are already in the target channel
      if (this.getCurrentVoiceChannelId() !== channelId) {
        setTimeout(() => this.tryJoinVoiceChannel(gId, channelId), 150);
      }
    });

    return btn;
  }

  createUnlockButton(guildId, channelId){
    const btn = document.createElement("button");
    btn.className = "arvc-toggle arvc-locked"; // green
    btn.type = "button";
    btn.setAttribute("aria-label","Disable auto-reconnect");
    btn.title = "Disable auto-reconnect";
    btn.dataset.guildId = guildId || "";
    btn.dataset.channelId = channelId;
    btn.innerHTML = this.svgIcon();

    btn.addEventListener("click",(e)=>{
      e.preventDefault(); e.stopPropagation();
      this.saveLocked(null);
      this.UI.showToast("Auto-reconnect disabled",{type:"info"});
    });
    return btn;
  }

  injectSlotForAnchor(anchor){
    if(!anchor || anchor.querySelector(".arvc-slot")) return;

    const dataId = anchor.getAttribute("data-list-item-id") || "";
    if(!dataId.startsWith("channels___")) return;

    const ids = dataId.replace(/^channels___/,"").split("_");
    const channelId = ids.pop(); if(!channelId) return;

    const chan = this.ChannelStore.getChannel(channelId);
    if(!this.isVoiceChannel(chan)) return;

    let guildId = this.getGuildIdFromChannelId(channelId);
    if(!guildId){
      const href = anchor.getAttribute("href") || "";
      const m = href.match(/\/channels\/(\d+)\/(\d+)/);
      if(m) guildId = m[1];
    }

    const slot = document.createElement("span");
    slot.className = "arvc-slot";
    if(guildId) slot.dataset.guildId = guildId;
    slot.dataset.channelId = channelId;

    anchor.appendChild(slot);
    this.renderSlot(slot, guildId, channelId);
  }

  refreshAllSlots(){
    document.querySelectorAll(".arvc-slot").forEach(slot=>{
      const channelId = slot.dataset.channelId;
      const guildId = slot.dataset.guildId || this.getGuildIdFromChannelId(channelId);
      this.renderSlot(slot, guildId, channelId);
    });
  }

  // Waits until VoiceState reflects that we joined targetChannelId, or times out
  waitForVoiceJoin(targetChannelId, timeout = 1200) {
    return new Promise(resolve => {
      let settled = false;

      const check = () => {
        if (settled) return;
        if (this.getCurrentVoiceChannelId() === targetChannelId) {
          settled = true;
          off();
          resolve(true);
        }
      };

      const off = () => {
        try { this.VoiceStateStore?.removeChangeListener?.(check); } catch {}
      };

      try { this.VoiceStateStore?.addChangeListener?.(check); } catch {}

      // Failsafe timeout
      setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        resolve(false);
      }, timeout);
    });
  }

  /* ---------- Backoff loop (500–3000 ms) ---------- */

  startLoop() {
    if (this.timer) return;
    this.retryDelay = this.minDelay;

    const tick = async () => {
      // No locked channel: idle at min delay
      if (!this.state.locked) {
        this.retryDelay = this.minDelay;
        this.timer = setTimeout(tick, this.retryDelay);
        return;
      }

      const { guildId, channelId } = this.state.locked;

      // Already in the target channel: keep delay at minimum and do nothing
      if (this.getCurrentVoiceChannelId() === channelId) {
        this.retryDelay = this.minDelay;
        this.timer = setTimeout(tick, this.retryDelay);
        return;
      }

      // Attempt to reconnect
      const ok = await this.tryJoinVoiceChannel(guildId, channelId);

      // Progressive backoff on failure, reset on success
      const prevDelay = this.retryDelay;
      this.retryDelay = ok
        ? this.minDelay
        : Math.min(Math.floor(this.retryDelay * 1.7), this.maxDelay);

      // Show a toast on failure indicating the next retry delay (rate-limited)
      if (!ok) {
        const now = Date.now();
        const shouldToast =
          this.retryDelay !== this._lastRetryToastDelay ||
          (now - (this._lastRetryToastTs || 0)) > 15000; // at most every 15s at max delay

        if (shouldToast) {
          this.UI.showToast(`Reconnect failed. Next retry in ${this.retryDelay} ms`, {
            type: "warning",
            timeout: Math.min(5000, this.retryDelay) // keep it readable
          });
          this._lastRetryToastDelay = this.retryDelay;
          this._lastRetryToastTs = now;
        }
      } else {
        // On success, clear toast memory so future failures can notify again
        this._lastRetryToastDelay = null;
        this._lastRetryToastTs = 0;
      }

      this.timer = setTimeout(tick, this.retryDelay);
    };

    this.timer = setTimeout(tick, this.retryDelay);
  }

  stopLoop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /* ---------- Update Checker ---------- */

  /**
   * Check for updates and show BD's update banner if a newer version is available.
   * Tries BetterDiscord's built-in PluginUpdater first, then ZeresPluginLibrary,
   * and finally falls back to a simple fetch+compare.
   */
  checkForUpdates() {
    const name = "AutoRejoinVC";
    const current = this.currentVersion;

    // 1) Prefer BetterDiscord's built-in PluginUpdater (if present)
    const BDUpdater = window.PluginUpdater || BdApi?.PluginUpdater;
    if (BDUpdater && typeof BDUpdater.checkForUpdate === "function") {
      try {
        // Accepts either a BetterDiscord addon id or a direct raw URL.
        BDUpdater.checkForUpdate(name, current, UPDATE_URL);
        return;
      } catch (e) {
        try { BdApi.Logger.warn(this.pluginId, "BD PluginUpdater failed:", e); } catch {}
      }
    }

    // 2) Fallback to ZeresPluginLibrary's PluginUpdater (if user has it)
    const ZLib = window.ZeresPluginLibrary || window.ZLibrary || global?.ZeresPluginLibrary;
    if (ZLib?.PluginUpdater?.checkForUpdate) {
      try {
        ZLib.PluginUpdater.checkForUpdate(name, current, UPDATE_URL);
        return;
      } catch (e) {
        try { BdApi.Logger.warn(this.pluginId, "ZLib PluginUpdater failed:", e); } catch {}
      }
    }

    // 3) Last resort: manual compare using BdApi.Net.fetch
    //    Looks for a semantic version like "1.2.3" in the remote file.
    const doManualCheck = async () => {
      try {
        const res = await BdApi.Net.fetch(UPDATE_URL, { method: "GET" });
        if (!res || !res.text) return;
        const text = await res.text();
        const match = text.match(/@version\s+([0-9]+\.[0-9]+\.[0-9]+)/i) || text.match(/["']([0-9]+\.[0-9]+\.[0-9]+)["']/);
        if (!match) return;
        const remote = String(match[1]);
        const newer = (a, b) => {
          const pa = a.split(".").map(n => parseInt(n, 10) || 0);
          const pb = b.split(".").map(n => parseInt(n, 10) || 0);
          for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] > pa[i];
          return false;
        };
        if (newer(current, remote)) {
          // Show a clear banner-like toast. BD's native banner is nicer, but this is a safe fallback.
          BdApi.UI.showToast(`${name} update available: ${current} → ${remote}`, { type: "info", timeout: 6000 });
        }
      } catch (e) {
        try { BdApi.Logger.warn(this.pluginId, "Manual update check failed:", e); } catch {}
      }
    };
    doManualCheck();
  }

  /* ---------- Lifecycle ---------- */

  start(){
    this.addStyles();
    this.startObserver();
    this.startLoop();
    this.log("Started (backoff 500–3000 ms)");

    this.checkForUpdates();
  }

  stop(){
    this.stopObserver();
    this.stopLoop();
    this.removeStyles();
    document.querySelectorAll(".arvc-slot").forEach(n=>n.remove());
    this.log("Stopped");
  }

  startObserver(){
    const handle = ()=>{
      const anchors = document.querySelectorAll('a[data-list-item-id^="channels___"]');
      anchors.forEach(a=>this.injectSlotForAnchor(a));
    };
    this.observer = new MutationObserver(handle);
    this.observer.observe(document.body,{childList:true,subtree:true});
    handle();
  }
  stopObserver(){ this.observer?.disconnect(); this.observer=null; }

  addStyles(){
    const css = `
      :root { --arvc-size: 28px; }

      .arvc-slot{
        display: inline-flex;
        margin-left: 10px;
        vertical-align: middle;
        flex-shrink: 0;
      }
      .arvc-toggle{
        width: var(--arvc-size);
        height: var(--arvc-size);
        line-height: 0;
        border: none;
        background: transparent;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform .12s ease, opacity .12s ease;
        opacity: .95;
        flex-shrink: 0;
      }
      .arvc-toggle:hover{ transform: scale(1.08); opacity: 1; }
      .arvc-toggle:focus{ outline: 2px solid currentColor; outline-offset: 2px; border-radius: 4px; }

      .arvc-ico{ width: 100%; height: 100%; display: block; }
      .arvc-ico path{ fill: currentColor; }

      .arvc-unlocked{ color: #dc2626; } /* rouge */
      .arvc-locked{   color: #16a34a; } /* vert  */
    `;
    this.DOM.addStyle(this.cssId, css);
  }
  removeStyles(){ this.DOM.removeStyle(this.cssId); }

  getSettingsPanel() {
    // ---- Root
    const wrap = document.createElement("div");
    wrap.className = "arvc-settings arvc-light";

    // ---- scoped CSS for the panel (white background + strong contrast)
    const style = document.createElement("style");
    style.textContent = `
      .arvc-settings.arvc-light {
        --arvc-bg: #ffffff;
        --arvc-bg-subtle: #f8fafc;
        --arvc-text: #0f172a;        /* slate-900 */
        --arvc-muted: #475569;       /* slate-600 */
        --arvc-border: #e5e7eb;      /* gray-200 */
        --arvc-input: #111827;       /* gray-900 */
        --arvc-input-bg: #ffffff;
        --arvc-input-border: #d1d5db;/* gray-300 */
        --arvc-btn: #111827;
        --arvc-btn-bg: #f3f4f6;
        --arvc-btn-fill: #2563eb;    /* blue-600 */
        --arvc-btn-fill-text: #ffffff;
      }
      .arvc-settings {
        padding: 16px;
        line-height: 1.45;
        max-width: 720px;
        color: var(--arvc-text);
      }
      .arvc-title {
        font-weight: 800; font-size: 16px; margin-bottom: 8px;
      }
      .arvc-card {
        background: var(--arvc-bg);
        border: 1px solid var(--arvc-border);
        border-radius: 10px;
        padding: 14px;
        box-shadow: 0 1px 2px rgba(0,0,0,.04);
      }
      .arvc-status {
        display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
      }
      .arvc-row {
        display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
      }
      .arvc-dot {
        display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; vertical-align:middle;
      }
      .arvc-muted { color: var(--arvc-muted); }
      .arvc-actions {
        display:grid; grid-template-columns: 1fr auto; align-items:center; gap:12px;
      }
      /* Inputs */
      .arvc-settings input.bd-text-input {
        width:100%;
        background: var(--arvc-input-bg) !important;
        color: var(--arvc-input) !important;
        border: 1px solid var(--arvc-input-border) !important;
        border-radius: 8px; padding: 8px 10px; box-sizing: border-box;
      }
      .arvc-field label {
        display:block; font-size:12px; color: var(--arvc-muted); margin-bottom:4px;
      }
      /* Buttons (scoped) */
      .arvc-settings .bd-button {
        color: var(--arvc-btn);
        background: var(--arvc-btn-bg);
        border: 1px solid var(--arvc-border);
        padding: 8px 12px; border-radius: 8px;
      }
      .arvc-settings .bd-button-filled {
        background: var(--arvc-btn-fill);
        color: var(--arvc-btn-fill-text);
        border: 1px solid var(--arvc-btn-fill);
      }
      .arvc-settings .bd-button[disabled] {
        opacity: .55; cursor: not-allowed;
      }
      /* Backoff header */
      .arvc-backoff-head {
        display:grid; grid-template-columns: 1fr auto; align-items:center; margin-bottom: 8px;
      }
      .arvc-backoff-head .current {
        color: var(--arvc-muted);
      }
      /* Ligne reset sous les inputs */
      .arvc-reset {
        grid-column: 1 / -1; justify-self: start;
      }
    `;
    wrap.appendChild(style);

    // Stores utiles
    const GuildStore = this.Webpack.getStore?.("GuildStore");

    // Infos friendly
    const locked = this.state.locked;
    const ch = locked ? this.ChannelStore?.getChannel?.(locked.channelId) : null;
    const g  = locked ? GuildStore?.getGuild?.(locked.guildId) : null;
    const channelLabel = ch?.name ? `#${ch.name}` : (locked ? `#${locked.channelId}` : "—");
    const guildLabel   = g?.name  ? g.name        : (locked ? `${locked.guildId}` : "—");

    // ---- Titre
    const title = document.createElement("div");
    title.className = "arvc-title";
    wrap.appendChild(title);

    // ---- Carte Statut
    const status = document.createElement("div");
    status.className = "arvc-card arvc-status";

    const statusLeft = document.createElement("div");
    const dot = document.createElement("span");
    dot.className = "arvc-dot";
    dot.style.background = locked ? "#16a34a" : "#9ca3af"; // green / gris

    const statusText = document.createElement("span");
    statusText.innerHTML = locked
      ? `AutoRejoinVC – Settings<br><span class="arvc-muted">Locked channel :</span> <code>${channelLabel}</code> <span class="arvc-muted">(${guildLabel})</span>`
      : `AutoRejoinVC – Settings<br><span class="arvc-muted">No locked channel</span>`;

    statusLeft.appendChild(dot);
    statusLeft.appendChild(statusText);

    const statusRight = document.createElement("div");
    statusRight.style.display = "flex";
    statusRight.style.gap = "8px";

    const btnUnlock = document.createElement("button");
    btnUnlock.className = "bd-button bd-button-filled";
    btnUnlock.textContent = "Unlock";
    btnUnlock.disabled = !locked;
    btnUnlock.addEventListener("click", () => {
      this.saveLocked(null);
      this.UI.showToast("Auto-reconnect disabled", { type: "info" });
      dot.style.background = "#9ca3af";
      statusText.innerHTML = `AutoRejoinVC – Settings<br><span class="arvc-muted">No locked channel</span>`;
      btnUnlock.disabled = true;
      btnJoinNow.disabled = true;
    });

    statusRight.appendChild(btnUnlock);

    status.appendChild(statusLeft);
    status.appendChild(statusRight);
    wrap.appendChild(status);

    // ---- Carte Backoff
    const backoff = document.createElement("div");
    backoff.className = "arvc-card";

    // Header
    const head = document.createElement("div");
    head.className = "arvc-backoff-head";
    const headTitle = document.createElement("div");
    headTitle.style.fontWeight = "700";
    headTitle.textContent = "Reconnection (progressive backoff)";
    const headCurrent = document.createElement("div");
    headCurrent.className = "current";
    headCurrent.innerHTML = `Current : <code>${this.retryDelay} ms</code>`;
    head.appendChild(headTitle);
    head.appendChild(headCurrent);
    backoff.appendChild(head);

    // Inputs
    const row = document.createElement("div"); row.className = "arvc-row";

    const fieldMin = document.createElement("div"); fieldMin.className = "arvc-field";
    const lblMin = document.createElement("label"); lblMin.textContent = "Minimum delay (ms)";
    const inpMin = document.createElement("input");
    inpMin.type = "number"; inpMin.min = "100"; inpMin.max = "10000"; inpMin.step = "100";
    inpMin.value = String(this.minDelay); inpMin.className = "bd-text-input";
    fieldMin.appendChild(lblMin); fieldMin.appendChild(inpMin);

    const fieldMax = document.createElement("div"); fieldMax.className = "arvc-field";
    const lblMax = document.createElement("label"); lblMax.textContent = "Maximum delay (ms)";
    const inpMax = document.createElement("input");
    inpMax.type = "number"; inpMax.min = "100"; inpMax.max = "20000"; inpMax.step = "100";
    inpMax.value = String(this.maxDelay); inpMax.className = "bd-text-input";
    fieldMax.appendChild(lblMax); fieldMax.appendChild(inpMax);

    row.appendChild(fieldMin); row.appendChild(fieldMax);
    backoff.appendChild(row);

    // Actions (Reset under inputs + Apply on the right)
    const actions = document.createElement("div");
    actions.className = "arvc-actions";

    const btnReset = document.createElement("button");
    btnReset.className = "bd-button arvc-reset";
    btnReset.textContent = "Reset (500 / 3000)";
    btnReset.addEventListener("click", () => {
      inpMin.value = "500"; inpMax.value = "3000";
    });

    const btnApply = document.createElement("button");
    btnApply.className = "bd-button bd-button-filled";
    btnApply.textContent = "Apply";
    btnApply.addEventListener("click", () => {
      let min = parseInt(inpMin.value, 10);
      let max = parseInt(inpMax.value, 10);
      if (!Number.isFinite(min)) min = 500;
      if (!Number.isFinite(max)) max = 3000;
      min = Math.max(100, Math.min(min, 10000));
      max = Math.max(min, Math.min(max, 20000));
      this.minDelay = min; this.maxDelay = max; this.retryDelay = this.minDelay;
      headCurrent.innerHTML = `Current : <code>${this.retryDelay} ms</code>`;
      this.UI.showToast(`Backoff set to ${min}–${max} ms`, { type: "success" });
    });

    actions.appendChild(btnReset);
    actions.appendChild(btnApply);
    backoff.appendChild(actions);

    // Hint
    const hint = document.createElement("div");
    hint.className = "arvc-muted";
    hint.style.fontSize = "12px";
    hint.textContent = "Tip: the current value resets to the minimum after a successful reconnection.";
    backoff.appendChild(hint);

    wrap.appendChild(backoff);

    return wrap;
  }


};
