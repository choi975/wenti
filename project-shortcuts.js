/* Project Index shortcuts v2: 0..3 fixed; 4..9 resolved live with offline fallback. */
(() => {
  "use strict";
  if (window.ProjectShortcuts) return;
  const FIXED = Object.freeze({
    0: "https://index.choi975.workers.dev/",
    1: "https://todo.choi975.workers.dev/",
    2: "https://badminton.choi975.workers.dev/",
    3: "https://sien-day.choi975.workers.dev/",
  });
  const API = "https://index.choi975.workers.dev/api/shortcuts/";
  const CACHE_KEY = "choi975-project-shortcuts-v2";
  let busy = false;
  let noticeTimer;
  function readCache() {
    try {
      const data = JSON.parse(localStorage.getItem(CACHE_KEY));
      return data && data.version === 2 && data.targets && typeof data.targets === "object" ? data.targets : {};
    } catch { return {}; }
  }
  function safeUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
      const worker = /^[a-z0-9]+(?:-[a-z0-9]+)*\.choi975\.workers\.dev$/.test(url.hostname);
      const pages = url.hostname === "choi975.github.io" && /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(url.pathname);
      return worker || pages ? url.href : null;
    } catch { return null; }
  }
  function writeCache(number, url) {
    const targets = readCache();
    if (url) targets[number] = { url, updatedAt: Date.now() };
    else delete targets[number];
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 2, targets })); } catch { /* Navigation works even when storage is unavailable. */ }
  }
  function notify(message) {
    let node = document.getElementById("project-shortcut-notice");
    if (!node) {
      node = document.createElement("div");
      node.id = "project-shortcut-notice";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      Object.assign(node.style, { position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647", maxWidth: "calc(100vw - 32px)", padding: "12px 18px", borderRadius: "10px", background: "#202830", color: "#fff", font: "14px/1.5 system-ui, sans-serif", pointerEvents: "none" });
      document.body.append(node);
    }
    node.textContent = message;
    node.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { node.hidden = true; }, 3500);
  }
  async function resolve(number) {
    if (FIXED[number]) return { url: FIXED[number], source: "fixed" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(API + number, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      if (payload.number !== Number(number) || !Object.prototype.hasOwnProperty.call(payload, "url")) throw new Error("Invalid shortcut response");
      if (payload.url === null) {
        writeCache(number, null);
        return { url: null, source: "empty" };
      }
      const url = safeUrl(payload.url);
      if (!url) throw new Error("Invalid shortcut URL");
      writeCache(number, url);
      return { url, source: "live" };
    } catch {
      const url = safeUrl(readCache()[number]?.url);
      return { url, source: url ? "cache" : "unavailable" };
    } finally { clearTimeout(timer); }
  }
  async function navigate(number, newTab) {
    if (FIXED[number]) {
      if (newTab) window.open(FIXED[number], "_blank", "noopener,noreferrer");
      else window.location.assign(FIXED[number]);
      return;
    }
    if (busy) return;
    busy = true;
    let popup = null;
    try {
      if (newTab) {
        popup = window.open("about:blank", "_blank");
        if (!popup) { notify("浏览器阻止了新标签页，请允许弹出窗口后重试。"); return; }
        popup.opener = null;
        popup.document.title = "正在读取快捷键配置…";
        popup.document.body.textContent = "正在从项目索引读取快捷键配置…";
        Object.assign(popup.document.body.style, { font: "16px/1.6 system-ui, sans-serif", padding: "32px", color: "#202830" });
      }
      const result = await resolve(number);
      if (!result.url) {
        if (popup && !popup.closed) popup.close();
        notify(result.source === "empty" ? "快捷键 " + number + " 尚未分配项目。" : "无法读取快捷键配置，且本机没有可用缓存。");
        return;
      }
      if (result.source === "cache") notify("云端查询失败，已使用上次成功查询的缓存。");
      if (popup) { if (!popup.closed) popup.location.replace(result.url); }
      else window.location.assign(result.url);
    } finally { busy = false; }
  }
  window.ProjectShortcuts = Object.freeze({ resolve, navigate, fixed: FIXED });
  window.addEventListener("keydown", (event) => {
    if (!event.altKey || event.metaKey || event.shiftKey || event.isComposing) return;
    const key = /^[0-9]$/.test(event.key) ? event.key : /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1];
    if (key === undefined) return;
    const target = event.target;
    const active = document.activeElement;
    if ([target, active].some((node) => node && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) void navigate(Number(key), event.ctrlKey);
  }, true);
})();
