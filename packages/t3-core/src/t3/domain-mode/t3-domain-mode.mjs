// A domain-wide, explicit T3 autonomy switch. This script is installed by
// the single-site-dist builder on every public page, not only /workspace/.
const SW_PATH = "/t3-sw.js";
const MANIFEST_PATH = "/t3-offline-manifest.json";
const SCHEMA = "iwxa.t3.domain-offline/1";
const OWN_SW = new URL(SW_PATH, location.origin).href;
const isOwn = worker => !!worker && worker.scriptURL === OWN_SW;

function style() {
  const el = document.createElement("style");
  el.textContent = [
    "#iwxa-t3-domain-controls{font:14px system-ui,sans-serif;box-sizing:border-box;color:#f8fafc;background:#142638;border:1px solid #46657b;border-radius:12px;padding:10px 12px;box-shadow:0 8px 20px #0a223333;max-width:min(92vw,340px);z-index:2147483000}",
    "#iwxa-t3-domain-controls[data-floating]{position:fixed;bottom:16px;left:16px}",
    "#iwxa-t3-domain-controls label{display:flex;align-items:center;gap:9px;font-weight:650;cursor:pointer}",
    "#iwxa-t3-domain-controls input{width:18px;height:18px;accent-color:#3b9d8c}",
    "#iwxa-t3-domain-controls [role=status]{margin:4px 0 0;font-size:12px;line-height:1.4;color:#d5e4ec}",
    "#iwxa-t3-domain-controls input:focus-visible{outline:2px solid #89ceee;outline-offset:3px}"
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
  toggle.role = "switch";
  toggle.id = "iwxa-t3-domain-switch";
  toggle.setAttribute("aria-label", "Включить полностью локальный режим сайта T3");
  const text = document.createElement("span");
  text.textContent = "T3 · Автономный сайт";
  label.append(toggle, text);
  const state = document.createElement("p");
  state.setAttribute("role", "status");
  state.setAttribute("aria-live", "polite");
  state.textContent = "Режим не включён.";
  box.append(label, state);
  (mount || document.body).append(box);
  style();
  return {toggle, state};
}
function tell(ui, text) { ui.state.textContent = text; }
function render(ui, enabled) {
  ui.toggle.checked = enabled;
  document.documentElement.toggleAttribute("data-iwxa-t3-autonomous", enabled);
  if (enabled) tell(ui, "Работает локальная копия страниц и T3 Kernel. Модель ИИ устанавливается отдельно.");
  else tell(ui, "Сайт работает в обычном режиме. Включение загрузит его офлайн-копию.");
}
async function registration() {
  return navigator.serviceWorker.getRegistration("/");
}
function message(worker, type, progress = () => {}) {
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
    try { worker.postMessage({type}, [channel.port2]); }
    catch (error) { clearTimeout(timer); channel.port1.close(); reject(error); }
  });
}
async function status(ui) {
  const reg = await registration();
  if (reg?.active && !isOwn(reg.active)) {
    ui.toggle.disabled = true;
    tell(ui, "Сайт управляется другой службой офлайн-запуска. Сохранение T3 не активировано.");
    return;
  }
  if (!reg?.active || !isOwn(navigator.serviceWorker.controller)) {
    render(ui, false);
    return;
  }
  const answer = await message(reg.active, "T3_STATUS");
  render(ui, answer?.active === true);
}
async function enable(ui) {
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
  });
  if (receipt?.type !== "READY" || receipt.version !== manifest.version ||
      receipt.files !== manifest.files.length) throw Error("T3_DOMAIN_INSTALL_NOT_VERIFIED");
  tell(ui, "Офлайн-копия установлена. Переключаю сайт на локальный режим…");
  location.reload();
}
async function disable(ui) {
  const reg = await registration();
  if (reg?.active && isOwn(reg.active)) {
    await message(reg.active, "T3_DISABLE");
    await reg.unregister();
  }
  render(ui, false);
  // The previous document may still be controlled by the old worker.
  location.reload();
}
async function main() {
  if (!document.body) return;
  const ui = createControl();
  if (!("serviceWorker" in navigator) || !("caches" in window) ||
      !window.isSecureContext) {
    ui.toggle.disabled = true;
    tell(ui, "Для автономного T3 требуется HTTPS и поддержка Service Worker.");
    return;
  }
  try { await status(ui); }
  catch (error) { ui.toggle.disabled = true; tell(ui, "Не удалось проверить T3: " + error.message); }
  ui.toggle.addEventListener("change", async () => {
    ui.toggle.disabled = true;
    try {
      if (ui.toggle.checked) await enable(ui);
      else await disable(ui);
    } catch (error) {
      tell(ui, "T3 не включён: " + (error?.message || String(error)));
      try { await status(ui); } catch { ui.toggle.checked = false; }
    } finally { ui.toggle.disabled = false; }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !ui.toggle.disabled) void status(ui).catch(() => {});
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, {once:true});
else void main();
