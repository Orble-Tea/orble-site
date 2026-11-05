import { chromium } from "@playwright/test";
const b = await chromium.launch(); const p = await b.newPage();
p.on("pageerror", e => console.log("PAGEERROR:", e.message));
p.on("console", m => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 300)); });
await p.goto(process.argv[2], { waitUntil: "networkidle" });
await b.close();
