// Screenshot the page in headless Chrome through the DevTools protocol (no Puppeteer needed: Node 22 has WebSocket).
//
//   node scripts/screenshot.mjs <url> <out.png> [width=1400] [mobile 0|1] [steps...]
//
// steps run in order after the page loads: a key name (Down, Up, Enter, Esc, or any single character like a, 2, ?),
// waitNNN (sleep NNN ms), or js:<expression> (prints the result). It also prints whether anything sticks out
// sideways (horizontal overflow), the usual bug at phone width. Chrome's own --window-size cannot go below
// ~500px, which is why a phone is emulated with Emulation.setDeviceMetricsOverride instead.
// Example: node scripts/screenshot.mjs "http://127.0.0.1:8765/?theme=phosphor" /tmp/phone.png 390 1 Down Enter
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, width = "1400", mobile = "0", ...keys] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = mkdtempSync(join(tmpdir(), "codex-status-webui-chrome-"));          // throwaway profile, removed at the end
const port = 9300 + (process.pid % 500);
const chrome = spawn(CHROME,
  ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch (e) {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.consoleAPICalled") logs.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +width, height: mobile === "1" ? 844 : 1000, deviceScaleFactor: mobile === "1" ? 2 : 1, mobile: mobile === "1" });
await send("Page.navigate", { url });
await sleep(2500);
for (const k of keys) {
  if (k.startsWith("wait")) { await sleep(+k.slice(4)); continue; }
  if (k.startsWith("js:")) { console.log("js:", JSON.stringify(await evalJs(k.slice(3)))); continue; }
  const special = { Down: ["ArrowDown", 40], Up: ["ArrowUp", 38], Enter: ["Enter", 13], Esc: ["Escape", 27] }[k];
  const [key, code] = special || [k, k.toUpperCase().charCodeAt(0)];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code, text: special ? undefined : k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code });
  await sleep(250);
}
await sleep(400);
console.log("overflow:", await evalJs("JSON.stringify({vw: innerWidth, sw: document.documentElement.scrollWidth, wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.keybar') && !e.closest('.seg')).slice(0,6).map(e => e.tagName + '.' + e.className)})"));
const h = await evalJs("document.documentElement.scrollHeight");
await send("Emulation.setDeviceMetricsOverride", { width: +width, height: Math.min(h, 6000), deviceScaleFactor: mobile === "1" ? 2 : 1, mobile: mobile === "1" });
await sleep(300);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
if (logs.length) console.log("console:", logs.join("\n"));
ws.close();
chrome.kill();
await sleep(300);
try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
