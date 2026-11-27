// Explicit installation of the verified offline site. This script is installed by
// the single-site-dist builder on every public page, not only /workspace/.
const SW_PATH = "/t3-sw.js";
const MANIFEST_PATH = "/t3-offline-manifest.json";
const SCHEMA = "iwxa.t3.domain-offline/1";
const LAST_OFFER_KEY = "iwxa.t3.offline.last-update-offer.v2";
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
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
  el.textContent = "#iwxa-t3-domain-controls,#iwxa-t3-weekly-offer{font:var(--iwxa-assistant-font,inherit);box-sizing:border-box;color:var(--iwxa-assistant-ink,inherit);max-width:100%;overflow-wrap:anywhere}\n#iwxa-t3-domain-controls{display:flex;flex-direction:column;align-items:flex-start;gap:var(--iwxa-assistant-gap,8px)}\n#iwxa-t3-domain-controls[data-inline-fallback]{position:static;margin:12px;padding:var(--iwxa-assistant-padding,12px);border:1px solid var(--iwxa-assistant-border,#cbd8e4);border-radius:var(--iwxa-assistant-radius,8px)}\n#iwxa-t3-domain-controls>*,#iwxa-t3-weekly-offer>*{min-width:0;max-width:100%}\n#iwxa-t3-domain-controls button,#iwxa-t3-weekly-offer button{font:inherit;min-height:44px;max-width:100%;white-space:normal;padding:8px 12px;border:1px solid var(--iwxa-assistant-border,#c0d2de);border-radius:var(--iwxa-assistant-radius,8px);color:var(--iwxa-assistant-ink,#153c56);background:var(--iwxa-assistant-control,#f6f9fc);cursor:pointer}\n#iwxa-t3-domain-controls button:hover:not(:disabled),#iwxa-t3-weekly-offer button:hover:not(:disabled){background:var(--iwxa-assistant-control-hover,var(--iwxa-assistant-control,#f6f9fc))}\n#iwxa-t3-install-offline,#iwxa-t3-install-update,#iwxa-t3-weekly-check{color:var(--iwxa-assistant-accent-ink,#fff)!important;background:var(--iwxa-assistant-accent,#174c74)!important;border-color:var(--iwxa-assistant-accent,#174c74)!important;font-weight:600}\n#iwxa-t3-domain-controls button:disabled,#iwxa-t3-weekly-offer button:disabled{opacity:.55;cursor:default}\n#iwxa-t3-domain-controls button:focus-visible,#iwxa-t3-weekly-offer button:focus-visible{outline:2px solid var(--iwxa-assistant-focus,#2477aa);outline-offset:2px}\n#iwxa-t3-domain-controls [hidden],#iwxa-t3-weekly-offer[hidden]{display:none!important}\n#iwxa-t3-domain-controls p{margin:0;font-size:.875em;line-height:1.5}\n#iwxa-t3-update-offer{border-inline-start:3px solid var(--iwxa-assistant-accent,#174c74);padding-inline-start:10px}\n#iwxa-t3-weekly-offer{display:flex;flex-wrap:wrap;align-items:center;gap:var(--iwxa-assistant-gap,8px);padding:var(--iwxa-assistant-padding,12px);border-bottom:1px solid var(--iwxa-assistant-border,#cbd8e4);background:var(--iwxa-assistant-surface,transparent)}\n#iwxa-t3-weekly-offer p{margin:0;flex:1 1 12rem}\ndetails[data-iwxa-update-available]:not([open])>summary::after{content:' · Доступна проверка обновления';font-weight:400}\n";
  document.head.append(el);
}
function createControl() {
  const mount = document.querySelector("[data-iwxa-t3-controls]");
  const box = document.createElement("section");
  box.id = "iwxa-t3-domain-controls";
  box.setAttribute("aria-label", "Установка на устройство");
  if (!mount) box.setAttribute("data-inline-fallback", "");
  const button = (id,label,hidden=false) => {
    const node = document.createElement("button");
    node.type = "button";node.id = id;node.textContent = label;node.hidden = hidden;
    return node;
  };
  const installOffline = button("iwxa-t3-install-offline","Установить автономную версию");
  installOffline.disabled = true;
  const installApp = button("iwxa-t3-install-app","Установить приложение",standalone());
  const installHint = document.createElement("p");
  installHint.dataset.iwxaPwaHint = "";installHint.hidden = true;
  const offer = document.createElement("p");
  offer.id = "iwxa-t3-update-offer";offer.setAttribute("role","status");
  offer.textContent = "Хотите обновить автономную версию?";offer.hidden = true;
  const updateCheck = button("iwxa-t3-check-update","Проверить обновление",true);
  const updateInstall = button("iwxa-t3-install-update","Установить обновление",true);
  const later = button("iwxa-t3-update-later","Позже",true);
  const reloadWindow = button("iwxa-t3-apply-window-change","Применить изменения в этом окне",true);
  const state = document.createElement("p");
  state.setAttribute("role", "status");state.setAttribute("aria-live", "polite");
  state.textContent = "Проверяем установку…";
  box.append(installOffline,installApp,installHint,offer,updateCheck,updateInstall,later,reloadWindow,state);
  if (mount) mount.append(box);else document.body.prepend(box);
  const noticeSlot=document.querySelector("[data-iwxa-update-offer-slot]");
  let weekly=null,weeklyCheck=null,weeklyLater=null;
  if(noticeSlot){
    weekly=document.createElement("section");weekly.id="iwxa-t3-weekly-offer";weekly.hidden=true;
    const question=document.createElement("p");question.textContent="Хотите обновить автономную версию?";question.setAttribute("role","status");
    weeklyCheck=button("iwxa-t3-weekly-check","Проверить обновление");weeklyLater=button("iwxa-t3-weekly-later","Позже");
    weekly.append(question,weeklyCheck,weeklyLater);noticeSlot.append(weekly);
  }
  style();
  return {box,installOffline,state,installApp,installHint,offer,updateCheck,updateInstall,later,reloadWindow,weekly,weeklyCheck,weeklyLater,
    active:false,complete:false,blocked:true,busy:false,appInstalled:false,pendingUpdate:null};
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
      ui.appInstalled = true;ui.installApp.hidden = true;
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
        ui.appInstalled=true;ui.installApp.hidden=true;
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
function offerBadge(ui,on) {
  const owner=ui.box.closest?.("details")||ui.box;
  if(on)owner.dataset.iwxaUpdateAvailable="";
  else delete owner.dataset.iwxaUpdateAvailable;
}
function syncControls(ui) {
  ui.installOffline.hidden = ui.active && ui.complete && !ui.blocked;
  ui.installOffline.textContent = ui.active ? "Восстановить автономную версию" : "Установить автономную версию";
  ui.installOffline.disabled = ui.busy || ui.blocked;
  ui.updateCheck.hidden = !ui.active || !ui.complete || ui.blocked || !!ui.pendingUpdate;
  ui.updateCheck.disabled = ui.busy;
  ui.updateInstall.hidden = !ui.pendingUpdate;
  ui.updateInstall.disabled = ui.busy || ui.blocked;
  ui.later.hidden = ui.offer.hidden && !ui.pendingUpdate;
  ui.later.disabled = ui.busy;
  if(ui.weekly)ui.weekly.hidden=ui.offer.hidden||ui.busy;
}
function render(ui, active, complete=active) {
  ui.active = active;ui.complete = complete;ui.blocked = false;
  if(!active || !complete) {ui.offer.hidden=true;ui.pendingUpdate=null;offerBadge(ui,false);}
  document.documentElement.toggleAttribute("data-iwxa-t3-autonomous", active);
  syncControls(ui);
  if (active && complete) tell(ui, "Автономная версия установлена. Модель помощника устанавливается отдельно.");
  else if(active) tell(ui, "Автономная версия неполная. Восстановите её при подключении к интернету.");
  else tell(ui, "Установите автономную версию, чтобы пользоваться сайтом без интернета.");
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
  if (await foreignWorker() || (reg?.active && !isOwn(reg.active))) {
    ui.active=false;ui.complete=false;ui.blocked=true;ui.offer.hidden=true;ui.pendingUpdate=null;offerBadge(ui,false);
    document.documentElement.removeAttribute("data-iwxa-t3-autonomous");
    syncControls(ui);
    tell(ui,"Автономная версия недоступна из-за другой службы офлайн-запуска. Ваши данные не изменены.");
    return;
  }
  if (!reg?.active) {render(ui,false);return;}
  const answer = await message(reg.active,"T3_STATUS");
  if(answer?.type!=="STATUS")throw Error("T3_DOMAIN_STATUS_INVALID");
  render(ui,answer.active===true,answer.complete===true);
  if(ui.active&&!isOwn(navigator.serviceWorker.controller)){
    ui.reloadWindow.hidden=false;
    tell(ui,"Локальная версия установлена. Примените её в этом окне.");
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
  const agreed = window.confirm("Установить автономную версию сайта?\n" +
    "Будет загружено " + manifest.files.length + " файлов, около " + size + " МБ.\n" +
    "Модель помощника не скачивается. Сохранённые данные останутся на устройстве. Завершите незаконченный ввод перед установкой.");
  if (!agreed) return;
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  const reg = await navigator.serviceWorker.register(SW_PATH, {scope:"/", updateViaCache:"none"});
  await navigator.serviceWorker.ready;
  if (!isOwn(reg.active)) throw Error("T3_DOMAIN_SW_NOT_ACTIVE");
  const receipt = await message(reg.active, "T3_INSTALL", ({done,total}) => {
    tell(ui, "Устанавливаю автономный сайт: " + done + " / " + total + " файлов.");
  }, {expectedVersion: manifest.version});
  if (receipt?.type !== "READY" || receipt.version !== manifest.version ||
      receipt.files !== manifest.files.length) throw Error("T3_DOMAIN_INSTALL_NOT_VERIFIED");
  setPreference(LAST_OFFER_KEY,String(Date.now()));
  tell(ui, "Автономная версия установлена. Открываю сайт…");
  ui.notifyChanged?.();
  location.reload();
}
async function checkForUpdate(ui) {
  if(ui.busy||ui.blocked||!ui.active)return;
  ui.busy=true;ui.offer.hidden=true;ui.pendingUpdate=null;offerBadge(ui,false);syncControls(ui);
  // Only the user's click reaches this function. A reminder is local.
  setPreference(LAST_OFFER_KEY,String(Date.now()));
  tell(ui,"Проверяю наличие обновления…");
  try{
    const reg=await registration();
    if(!isOwn(reg?.active))throw Error("T3_DOMAIN_WORKER_UNAVAILABLE");
    const result=await message(reg.active,"T3_CHECK_UPDATE");
    if(result?.type!=="UPDATE_STATUS")throw Error("T3_DOMAIN_UPDATE_REPLY_INVALID");
    if(!result.available){tell(ui,"Установлена актуальная автономная версия.");return;}
    if(!Number.isSafeInteger(result.totalBytes)||result.totalBytes<1||
       !Number.isInteger(result.files)||result.files<4||!/^[a-f0-9]{64}$/.test(result.version))
      throw Error("T3_DOMAIN_UPDATE_INVALID");
    ui.pendingUpdate=result;
    tell(ui,"Доступна новая версия. Размер загрузки около "+(result.totalBytes/1048576).toFixed(1)+" МБ.");
  }catch{tell(ui,"Проверка обновления недоступна. Установленная версия сохранена.");}
  finally{ui.busy=false;syncControls(ui);}
}
function maybeOfferUpdate(ui){
  if(!ui.active||!ui.complete||ui.blocked||ui.busy||ui.pendingUpdate||
    !ui.offer.hidden||document.hidden||navigator.onLine===false)return false;
  const now=Date.now(),previous=Number(preference(LAST_OFFER_KEY))||0;
  if(previous>now){setPreference(LAST_OFFER_KEY,String(now));return false;}
  if(previous>0&&now-previous<CHECK_INTERVAL_MS)return false;
  if(!setPreference(LAST_OFFER_KEY,String(now)))return false;
  ui.offer.hidden=false;offerBadge(ui,true);syncControls(ui);return true;
}
function dismissOffer(ui){
  if(ui.busy)return;
  ui.offer.hidden=true;ui.pendingUpdate=null;offerBadge(ui,false);syncControls(ui);
  tell(ui,ui.complete?"Автономная версия установлена.":"Автономная версия неполная.");
}
async function applyUpdate(ui) {
  const update = ui.pendingUpdate;
  if (!update || ui.busy || ui.blocked) return;
  // Native confirmation occurs directly within the user's click.
  const mb = (update.totalBytes / (1024 * 1024)).toFixed(1);
  if (!window.confirm("Установить обновление автономной версии?\n" +
    "Проверю " + update.files + " файлов (около " + mb + " МБ).\n" +
    "До успешной проверки прежняя версия сохраняется. Модель помощника не скачивается. Завершите незаконченный ввод перед обновлением.")) return;
  ui.busy=true;syncControls(ui);
  try {
    const reg = await registration();
    if (!isOwn(reg?.active)) throw Error("T3_DOMAIN_WORKER_UNAVAILABLE");
    const receipt = await message(reg.active, "T3_INSTALL",
      ({done, total}) => tell(ui, "Обновляю локальный сайт: " + done + " / " + total),
      {expectedVersion: update.version});
    if (receipt?.type !== "READY" || receipt.version !== update.version ||
        receipt.files !== update.files) throw Error("T3_DOMAIN_UPDATE_NOT_VERIFIED");
    setPreference(LAST_OFFER_KEY,String(Date.now()));
    ui.pendingUpdate=null;ui.offer.hidden=true;offerBadge(ui,false);
    tell(ui, "Обновление установлено. Открываю новую версию…");
    ui.notifyChanged?.();
    location.reload();
  } catch (error) {
    tell(ui, "Обновление не установлено. Предыдущая автономная версия сохранена.");
  } finally {
    ui.busy=false;syncControls(ui);
  }
}
async function main() {
  if(!document.body||document.getElementById("iwxa-t3-domain-controls"))return;
  const ui=createControl();
  ui.installApp.addEventListener("click",()=>void installApplication(ui));
  ui.later.addEventListener("click",()=>dismissOffer(ui));
  ui.weeklyLater?.addEventListener("click",()=>dismissOffer(ui));
  ui.weeklyCheck?.addEventListener("click",()=>{
    const disclosure=ui.box.closest("details");if(disclosure)disclosure.open=true;
    ui.box.scrollIntoView?.({block:"center",behavior:"auto"});
    void checkForUpdate(ui);
  });
  ui.updateCheck.addEventListener("click",()=>void checkForUpdate(ui));
  ui.updateInstall.addEventListener("click",()=>void applyUpdate(ui));
  const refreshStatus=async()=>{
    if(ui.busy||ui.pendingUpdate)return;
    ui.busy=true;syncControls(ui);
    try{await status(ui);}
    catch{ui.blocked=true;tell(ui,"Не удалось проверить автономную версию.");}
    finally{ui.busy=false;syncControls(ui);}
    maybeOfferUpdate(ui);
  };
  const shared=typeof BroadcastChannel==="function"?new BroadcastChannel("iwxa-t3-domain-mode"):null;
  ui.notifyChanged=()=>shared?.postMessage({type:"changed"});
  ui.reloadWindow.addEventListener("click",()=>location.reload());
  window.addEventListener("pagehide",()=>shared?.close(),{once:true});
  shared?.addEventListener("message",event=>{
    if(event.data?.type!=="changed")return;
    ui.reloadWindow.hidden=false;
    if(!ui.busy){ui.pendingUpdate=null;ui.offer.hidden=true;offerBadge(ui,false);void refreshStatus();}
    tell(ui,"Версия изменена в другом окне. Примените изменения после завершения текущей работы.");
  });
  if(!("serviceWorker" in navigator)||!("caches" in window)||!window.isSecureContext){
    tell(ui,"Автономная установка не поддерживается этим браузером.");return;
  }
  ui.installOffline.addEventListener("click",async()=>{
    if(ui.busy||ui.blocked)return;
    if(ui.active){await checkForUpdate(ui);return;}
    ui.busy=true;syncControls(ui);
    try{await enable(ui);}
    catch{tell(ui,"Не удалось установить автономную версию. Сохранённые данные не изменены.");}
    finally{ui.busy=false;syncControls(ui);}
  });
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden&&!ui.busy&&!ui.pendingUpdate&&ui.offer.hidden)void refreshStatus();
    ui.installApp.hidden=ui.appInstalled||standalone();
  });
  window.addEventListener("appinstalled",()=>{ui.appInstalled=true;ui.installApp.hidden=true;});
  window.addEventListener("online",()=>{if(!ui.busy)void refreshStatus();});
  await refreshStatus();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, {once:true});
else void main();
