// A domain-wide, explicit T3 autonomy switch. This script is installed by
// the single-site-dist builder on every public page, not only /workspace/.
const SW_PATH = "/t3-sw.js";
const MANIFEST_PATH = "/t3-offline-manifest.json";
const SCHEMA = "iwxa.t3.domain-offline/1";
const AUTO_CHECK_KEY = "iwxa.t3.offline.offer-updates.v1";
const LAST_CHECK_KEY = "iwxa.t3.offline.last-update-check.v1";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
function preference(name) {
  try { return localStorage.getItem(name); } catch { return null; }
}
function setPreference(name,value) {
  try { localStorage.setItem(name,value); return true; } catch { return false; }
}
const OWN_SW = new URL(SW_PATH, location.origin).href;
const isOwn = worker => !!worker && worker.scriptURL === OWN_SW;
// Installation does not create another runtime. Native browser event is optional.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
});
const standalone = () => window.matchMedia?.("(display-mode: standalone)")?.matches ||
  window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
  navigator.standalone === true;

function style() {
  const el = document.createElement("style");
  el.textContent = [
    "#iwxa-t3-domain-controls{font:14px system-ui,sans-serif;box-sizing:border-box;color:#f8fafc;background:#142638;border:1px solid #46657b;border-radius:12px;padding:10px 12px;box-shadow:0 8px 20px #0a223333;max-width:min(92vw,340px);z-index:2147483000}",
    "#iwxa-t3-domain-controls[data-floating]{position:fixed;bottom:16px;left:16px}",
    "#iwxa-t3-domain-controls label{display:flex;align-items:center;gap:9px;font-weight:650;cursor:pointer}",
    "#iwxa-t3-domain-controls button{font:inherit;margin:8px 5px 0 0;padding:5px 9px;border:1px solid #80a9bd;border-radius:6px;color:#f8fafc;background:#20516b;cursor:pointer}",
    "#iwxa-t3-domain-controls button:disabled{opacity:.55;cursor:default}",
    "#iwxa-t3-domain-controls [hidden]{display:none!important}",
    "#iwxa-t3-domain-controls input{width:18px;height:18px;accent-color:#3b9d8c}",
    "#iwxa-t3-domain-controls [role=status]{margin:4px 0 0;font-size:12px;line-height:1.4;color:#d5e4ec}",
    "#iwxa-t3-domain-controls input:focus-visible{outline:2px solid #89ceee;outline-offset:3px}",
    "#iwxa-t3-domain-controls [data-iwxa-pwa-hint]{font-size:12px;line-height:1.4;margin:6px 0;color:#d5e4ec}",
    "#iwxa-t3-domain-controls [data-iwxa-t3-auto-update-label]{font-weight:400;font-size:12px;margin-top:8px}"
  ].join("");
  document.head.append(el);
}
function createControl() {
  const mount = document.querySelector("[data-iwxa-t3-controls]");
  const box = document.createElement("section");
  box.id = "iwxa-t3-domain-controls";
  box.setAttribute("aria-label", "Режим автономного сайта IWXA T3");
  if (!mount) box.setAttribute("data-floating", "");
  const label = document.createElement("label");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.disabled = true; // Do not accept clicks before the worker state is known.
  toggle.role = "switch";
  toggle.id = "iwxa-t3-domain-switch";
  toggle.setAttribute("aria-label", "Включить полностью локальный режим сайта T3");
  const text = document.createElement("span");
  text.textContent = "T3 · Автономный сайт";
  label.append(toggle, text);
  const installApp = document.createElement("button");
  installApp.type = "button";
  installApp.id = "iwxa-t3-install-app";
  installApp.textContent = "Установить приложение";
  installApp.hidden = standalone();
  const installHint = document.createElement("p");
  installHint.dataset.iwxaPwaHint = "";
  installHint.hidden = true;
  const sharedNote = document.createElement("p");
  sharedNote.dataset.iwxaPwaHint = "";
  sharedNote.textContent = "Режим общий для сайта и установленного приложения в одном профиле браузера.";
  const automaticLabel = document.createElement("label");
  automaticLabel.dataset.iwxaT3AutoUpdateLabel = "";
  const automatic = document.createElement("input");
  automatic.id = "iwxa-t3-auto-check-updates";
  automatic.type = "checkbox";
  automatic.checked = preference(AUTO_CHECK_KEY) === "on";
  const automaticText = document.createElement("span");
  automaticText.textContent = "Предлагать проверку обновлений (не чаще раза в сутки)";
  automaticLabel.append(automatic, automaticText);
  const updateCheck = document.createElement("button");
  updateCheck.type = "button";
  updateCheck.textContent = "Проверить обновление T3";
  updateCheck.hidden = true;
  const updateInstall = document.createElement("button");
  updateInstall.type = "button";
  updateInstall.textContent = "Установить обновление";
  updateInstall.hidden = true;
  // A second window must not be force-reloaded while the user edits a form.
  const reloadWindow = document.createElement("button");
  reloadWindow.type = "button";
  reloadWindow.id = "iwxa-t3-apply-window-change";
  reloadWindow.textContent = "Применить изменения в этом окне";
  reloadWindow.hidden = true;
  const state = document.createElement("p");
  state.setAttribute("role", "status");
  state.setAttribute("aria-live", "polite");
  state.textContent = "Режим не включён.";
  box.append(label, installApp, installHint, automaticLabel,
    updateCheck, updateInstall, reloadWindow, sharedNote, state);
  (mount || document.body).append(box);
  style();
  return {toggle, state, installApp, installHint, automatic, updateCheck,
    updateInstall, reloadWindow, pendingUpdate: null, autoCheckInFlight:false};
}
function tell(ui, text) { ui.state.textContent = text; }
async function installApplication(ui) {
  if (standalone()) {ui.installApp.hidden = true;return;}
  // Newer Chromium supports navigator.install(); call synchronously in the
  // user's click activation. The browser always owns the confirmation UI.
  if (typeof navigator.install === "function") {
    try {
      await navigator.install();
      ui.installHint.hidden = false;
      ui.installHint.textContent = "Приложение установлено или открыто браузером.";
      ui.installApp.hidden = true;
      return;
    } catch(error) {
      if(error?.name==="AbortError" || error?.name==="NotAllowedError") {
        ui.installHint.hidden = false;
        ui.installHint.textContent = "Установка отменена. Можно повторить действие.";
        return;
      }
      // Unsupported/invalid-data browsers can still expose the older prompt.
    }
  }
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === "accepted") {
        ui.installHint.hidden = false;
        ui.installHint.textContent = "Установка подтверждена браузером.";
        return;
      }
    } catch { /* Browser may revoke an old prompt. Offer manual instructions. */ }
  }
  const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  ui.installHint.hidden = false;
  ui.installHint.textContent = ios ?
    "Откройте меню «Поделиться» и выберите «На экран Домой»." :
    "Откройте меню браузера и выберите «Установить этот сайт как приложение» или «Добавить на главный экран».";
}
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  const button = document.getElementById("iwxa-t3-install-app");
  if(button)button.hidden = true;
});
function render(ui, enabled) {
  ui.toggle.checked = enabled;
  ui.toggle.disabled = false;
  ui.updateCheck.hidden = !enabled;
  ui.updateInstall.hidden = true;
  ui.pendingUpdate = null;
  document.documentElement.toggleAttribute("data-iwxa-t3-autonomous", enabled);
  if (enabled) tell(ui, "Работает локальная копия страниц и T3 Kernel. Модель ИИ устанавливается отдельно.");
  else tell(ui, "Сайт работает в обычном режиме. Включение загрузит его офлайн-копию.");
}
async function registration() {
  return navigator.serviceWorker.getRegistration("/");
}
async function foreignWorker() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  return registrations.some(reg =>
    reg.active && new URL(reg.scope).origin === location.origin && !isOwn(reg.active));
}
function message(worker, type, progress = () => {}, extra = {}) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(Error("T3_DOMAIN_WORKER_TIMEOUT"));
    }, type === "T3_INSTALL" ? 30 * 60 * 1000 : 10000);
    channel.port1.onmessage = ({data}) => {
      if (data?.type === "PROGRESS") { progress(data); return; }
      clearTimeout(timer);
      channel.port1.close();
      if (data?.type === "FAILED") reject(Error(data.message || "T3_DOMAIN_INSTALL_FAILED"));
      else resolve(data);
    };
    try { worker.postMessage({type, ...extra}, [channel.port2]); }
    catch (error) { clearTimeout(timer); channel.port1.close(); reject(error); }
  });
}
async function status(ui) {
  const reg = await registration();
  if (await foreignWorker()) {
    if (isOwn(reg?.active)) {
      ui.toggle.checked = true;
      ui.toggle.disabled = false; // Always allow user opt-out.
      tell(ui, "Обнаружен другой Service Worker: полная автономность не подтверждена. Выключите T3.");
    } else {
      ui.toggle.disabled = true;
      tell(ui, "Обнаружен другой Service Worker в домене. Автономный T3 не включается поверх него.");
    }
    return;
  }
  if (reg?.active && !isOwn(reg.active)) {
    ui.toggle.disabled = true;
    tell(ui, "Сайт управляется другой службой офлайн-запуска. Сохранение T3 не активировано.");
    return;
  }
  if (!reg?.active) {
    render(ui, false);
    return;
  }
  // The authoritative opt-in lives in the existing SW. A newly opened tab
  // may not be controlled yet, but it must not misreport that T3 is disabled.
  const answer = await message(reg.active, "T3_STATUS");
  render(ui, answer?.active === true);
  if (answer?.active === true && !isOwn(navigator.serviceWorker.controller)) {
    ui.reloadWindow.hidden = false;
    tell(ui, "Локальная версия установлена. Примените её в этом окне.");
  }
  if (answer?.active === true && answer.complete !== true) {
    tell(ui, "Офлайн-копия неполная. Выключите режим T3 и установите её снова.");
  }
}
async function enable(ui) {
  if (await foreignWorker()) throw Error("T3_DOMAIN_SW_SCOPE_CONFLICT");
  const previous = await registration();
  if (previous?.active && !isOwn(previous.active)) throw Error("T3_DOMAIN_SW_CONFLICT");
  // Do not download assets, the model, or a Kernel without a user click.
  const response = await fetch(MANIFEST_PATH, {cache:"no-store"});
  if (!response.ok) throw Error("T3_DOMAIN_MANIFEST_UNAVAILABLE");
  const manifest = await response.json();
  if (manifest.schema !== SCHEMA || !manifest.complete_static_tree ||
      !Number.isSafeInteger(manifest.total_bytes) || manifest.total_bytes < 1 ||
      !Array.isArray(manifest.files)) throw Error("T3_DOMAIN_MANIFEST_INVALID");
  const size = (manifest.total_bytes / (1024 * 1024)).toFixed(1);
  const agreed = window.confirm("Установить автономную копию этого домена T3?\n" +
    "Будет загружено " + manifest.files.length + " файлов, около " + size + " МБ.\n" +
    "Модель ИИ не скачивается. Данные пользователя останутся в исходном Kernel браузера.");
  if (!agreed) { render(ui, false); return; }
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  const reg = await navigator.serviceWorker.register(SW_PATH, {scope:"/", updateViaCache:"none"});
  await navigator.serviceWorker.ready;
  if (!isOwn(reg.active)) throw Error("T3_DOMAIN_SW_NOT_ACTIVE");
  const receipt = await message(reg.active, "T3_INSTALL", ({done,total}) => {
    tell(ui, "Устанавливаю автономный сайт: " + done + " / " + total + " файлов.");
  }, {expectedVersion: manifest.version});
  if (receipt?.type !== "READY" || receipt.version !== manifest.version ||
      receipt.files !== manifest.files.length) throw Error("T3_DOMAIN_INSTALL_NOT_VERIFIED");
  tell(ui, "Офлайн-копия установлена. Переключаю сайт на локальный режим…");
  ui.notifyChanged?.();
  location.reload();
}
async function checkForUpdate(ui) {
  if (ui.toggle.disabled) return;
  ui.updateCheck.disabled = true;
  ui.updateInstall.hidden = true;
  ui.pendingUpdate = null;
  tell(ui, "Проверяю наличие обновления на исходном сайте…");
  try {
    const reg = await registration();
    if (!isOwn(reg?.active)) throw Error("T3_DOMAIN_WORKER_UNAVAILABLE");
    const result = await message(reg.active, "T3_CHECK_UPDATE");
    if (result?.type !== "UPDATE_STATUS") throw Error("T3_DOMAIN_UPDATE_REPLY_INVALID");
    if (!result.available) {
      tell(ui, "Установлена актуальная офлайн-версия T3. Все данные остаются локальными.");
      return;
    }
    if (!Number.isSafeInteger(result.totalBytes) || result.totalBytes < 1 ||
        !Number.isInteger(result.files) || result.files < 4 ||
        !/^[a-f0-9]{64}$/.test(result.version)) throw Error("T3_DOMAIN_UPDATE_INVALID");
    ui.pendingUpdate = result;
    ui.updateInstall.hidden = false;
    tell(ui, "Доступна новая офлайн-версия. Для установки требуется отдельное подтверждение.");
  } catch (error) {
    tell(ui, "Проверка обновления недоступна: " + (error?.message || String(error)) +
      ". Существующая локальная версия не затронута.");
  } finally { ui.updateCheck.disabled = false; }
}
function maybeCheckUpdate(ui) {
  // User opted in explicitly. No service worker background task, no timers,
  // no automatic installation or remote model download.
  if(!ui.automatic.checked || !ui.toggle.checked ||
     ui.toggle.disabled || navigator.onLine === false || ui.autoCheckInFlight)return;
  const now=Date.now(),previous=Number(preference(LAST_CHECK_KEY)) || 0;
  if(previous>0 && now>=previous && now-previous<CHECK_INTERVAL_MS)return;
  if(!setPreference(LAST_CHECK_KEY,String(now)))return;
  ui.autoCheckInFlight=true;
  void checkForUpdate(ui).finally(()=>{ui.autoCheckInFlight=false;});
}
async function applyUpdate(ui) {
  const update = ui.pendingUpdate;
  if (!update) return;
  // Native confirmation occurs directly within the user's click.
  const mb = (update.totalBytes / (1024 * 1024)).toFixed(1);
  if (!window.confirm("Установить обновление автономного T3?\n" +
    "Проверю " + update.files + " файлов (около " + mb + " МБ).\n" +
    "До успешной проверки все ресурсы предыдущей версии сохраняются. Модель ИИ не устанавливается.")) return;
  ui.updateInstall.disabled = true;
  ui.updateCheck.disabled = true;
  ui.toggle.disabled = true;
  try {
    const reg = await registration();
    if (!isOwn(reg?.active)) throw Error("T3_DOMAIN_WORKER_UNAVAILABLE");
    const receipt = await message(reg.active, "T3_INSTALL",
      ({done, total}) => tell(ui, "Обновляю локальный сайт: " + done + " / " + total),
      {expectedVersion: update.version});
    if (receipt?.type !== "READY" || receipt.version !== update.version ||
        receipt.files !== update.files) throw Error("T3_DOMAIN_UPDATE_NOT_VERIFIED");
    tell(ui, "Обновление подтверждено. Открываю новую автономную версию…");
    ui.notifyChanged?.();
    location.reload();
  } catch (error) {
    tell(ui, "Обновление не установлено: " + (error?.message || String(error)) +
      ". Предыдущая офлайн-версия сохранена.");
  } finally {
    ui.updateInstall.disabled = false;
    ui.updateCheck.disabled = false;
    ui.toggle.disabled = false;
  }
}
async function disable(ui) {
  const reg = await registration();
  if (reg?.active && isOwn(reg.active)) {
    await message(reg.active, "T3_DISABLE");
    await reg.unregister();
  }
  render(ui, false);
  ui.notifyChanged?.();
  // The previous document may still be controlled by the old worker.
  location.reload();
}
async function main() {
  if (!document.body) return;
  const ui = createControl();
  ui.installApp.addEventListener("click", () => void installApplication(ui));
  ui.automatic.addEventListener("change", ()=>{
    if(!setPreference(AUTO_CHECK_KEY,ui.automatic.checked?"on":"off")) {
      ui.automatic.checked=false;
      tell(ui,"Не удалось сохранить настройку. Проверка обновлений остаётся ручной.");
      return;
    }
    if(ui.automatic.checked)maybeCheckUpdate(ui);
  });
  window.addEventListener("storage", event => {
    if(event.key===AUTO_CHECK_KEY)
      ui.automatic.checked=event.newValue==="on";
  });
  const shared = typeof BroadcastChannel === "function" ?
    new BroadcastChannel("iwxa-t3-domain-mode") : null;
  ui.notifyChanged = () => shared?.postMessage({type:"changed"});
  ui.reloadWindow.addEventListener("click", () => location.reload());
  window.addEventListener("pagehide", () => shared?.close(), {once:true});
  shared?.addEventListener("message", event => {
    if(event.data?.type !== "changed") return;
    // Broadcast is a hint, never an authority. Re-read the one SW's state.
    ui.reloadWindow.hidden = false;
    if(ui.toggle.disabled) {
      tell(ui, "T3 изменён в другом окне. Примените изменения после завершения текущего действия.");
      return;
    }
    void status(ui).then(()=>{
      ui.reloadWindow.hidden = false;
      tell(ui, "T3 изменён в другом окне. Примените изменения, когда закончите ввод.");
    }).catch(()=>{
      tell(ui, "Не удалось прочитать новый режим. Примените изменения в этом окне.");
    });
  });
  if (!("serviceWorker" in navigator) || !("caches" in window) ||
      !window.isSecureContext) {
    ui.toggle.disabled = true;
    tell(ui, "Для автономного T3 требуется HTTPS и поддержка Service Worker.");
    return;
  }
  try { await status(ui); maybeCheckUpdate(ui); }
  catch (error) { ui.toggle.disabled = true; tell(ui, "Не удалось проверить T3: " + error.message); }
  ui.updateCheck.addEventListener("click", () => void checkForUpdate(ui));
  ui.updateInstall.addEventListener("click", () => void applyUpdate(ui));
  ui.toggle.addEventListener("change", async () => {
    ui.toggle.disabled = true;
    try {
      if (ui.toggle.checked) await enable(ui);
      else await disable(ui);
    } catch (error) {
      const errorText = error?.message || String(error);
      try { await status(ui); } catch { ui.toggle.checked = false; }
      tell(ui, "Не удалось изменить режим T3: " + errorText);
    } finally { ui.toggle.disabled = false; }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !ui.toggle.disabled) {
      // Preserve a pending update offer while switching between browser
      // and installed app windows. A fresh status would hide the offer.
      if(!ui.pendingUpdate)void status(ui).then(()=>maybeCheckUpdate(ui)).catch(()=>{});
    }
    ui.installApp.hidden = standalone();
  });
  window.addEventListener("online", ()=>maybeCheckUpdate(ui));
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, {once:true});
else void main();
