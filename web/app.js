import { parseCSV, aggregate, cleanReport, totals } from "./audit-model.js";
const $ = (s) => document.querySelector(s),
  key = "quiet-hours-v1";
let reports = [],
  selected = null,
  storage = null,
  persistenceWarning = "";
const message = (t) =>
  ($("#message").textContent =
    t + (persistenceWarning ? " " + persistenceWarning : ""));
try {
  storage = localStorage;
  const saved = JSON.parse(storage.getItem(key));
  if (saved && [1, 7, 30].includes(saved.days))
    $("#days").value = String(saved.days);
  if (Array.isArray(saved?.reports))
    reports = saved.reports
      .filter((r) => /^[a-f0-9]{64}$/.test(r.id))
      .map((r) => ({
        id: r.id,
        report: cleanReport(r.report, Number($("#days").value)),
      }));
} catch {
  message(
    "Saved reports could not be read. New aggregates stay in memory unless storage becomes available.",
  );
}
function save() {
  try {
    storage.setItem(
      key,
      JSON.stringify({ days: Number($("#days").value), reports }),
    );
    persistenceWarning = "";
  } catch {
    persistenceWarning =
      "Storage is blocked or full. Export the aggregate report before leaving; this session is temporary.";
    message("Changes are in memory.");
  }
}
function prune() {
  reports = reports
    .map((r) => ({
      ...r,
      report: cleanReport(r.report, Number($("#days").value)),
    }))
    .filter((r) => r.report.daily.length);
  if (!reports.some((r) => r.id === selected))
    selected = reports.at(-1)?.id || null;
  save();
}
function render() {
  $("#reports").innerHTML = reports.length
    ? `<div class="report-list" aria-label="Choose an aggregate report">${reports.map((r, i) => `<button data-report="${r.id}" aria-pressed="${r.id === selected}">IMPORT ${i + 1} / ${r.report.source.toUpperCase()}</button>`).join("")}</div>`
    : "";
  const row = reports.find((r) => r.id === selected);
  if (!row) {
    $("#report").innerHTML =
      '<div class="empty"><h2>Nothing collected yet.</h2><p>Import a local file or try the fictional sample. You will see dated totals without saved event rows or device names.</p></div>';
    return;
  }
  const r = row.report,
    t = totals(r),
    known = t.blocked + t.allowed,
    total = known + t.unknown,
    share = known ? (t.blocked / known) * 100 : 0;
  $("#report").innerHTML =
    `<h2>The shape of your DNS traffic.</h2><p>Report created ${new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC. Kept ${r.daily.length} UTC date buckets. ${r.skipped} old/future rows skipped at import.</p><div class="stats"><div><b>${total.toLocaleString()}</b><small>QUERIES IN KEPT BUCKETS</small></div><div><b>${known ? share.toFixed(1) + "%" : "—"}</b><small>BLOCKED / KNOWN OUTCOMES</small></div><div><b>${t.unknown.toLocaleString()}</b><small>UNKNOWN OUTCOMES</small></div></div><div class="split" role="img" aria-label="${t.blocked} blocked, ${t.allowed} allowed, ${t.unknown} unknown outcomes"><span class="blocked" style="width:${total ? (t.blocked / total) * 100 : 0}%"></span><span class="allowed" style="width:${total ? (t.allowed / total) * 100 : 0}%"></span></div><div class="report-actions"><button id="export">Export aggregate JSON ↓</button><button id="remove" class="danger">Remove this report</button></div><div class="table-wrap"><table><caption class="help">Per UTC date. Device counts are not additive across dates or imports.</caption><thead><tr><th>Date</th><th>Blocked</th><th>Allowed</th><th>Unknown</th><th>Distinct devices</th><th>Blocked share</th></tr></thead><tbody>${r.daily
      .map((d) => {
        const n = d.blocked + d.allowed,
          p = n ? (d.blocked / n) * 100 : 0;
        return `<tr><td>${d.date}</td><td>${d.blocked}</td><td>${d.allowed}</td><td>${d.unknown}</td><td>${d.unique_devices}</td><td><span class="bar" aria-hidden="true"><i style="width:${p}%"></i></span> ${n ? p.toFixed(1) + "%" : "—"}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
}
async function add(text, format) {
  if (text.length > 5_000_000) throw Error("Use an input smaller than 5 MB.");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (reports.some((r) => r.id === hash)) {
    selected = hash;
    render();
    message(
      "This exact file is already imported. Its totals were not counted again.",
    );
    return;
  }
  const days = Number($("#days").value),
    report =
      format === "json"
        ? cleanReport(JSON.parse(text), days)
        : aggregate(parseCSV(text), { days });
  if (!report.daily.length) {
    message("No date buckets remain inside the chosen retention window.");
    return;
  }
  if (reports.length >= 20)
    throw Error(
      "Keep up to 20 separate imports. Export and remove one before adding another.",
    );
  reports.push({ id: hash, report });
  selected = hash;
  save();
  render();
  message(
    "Aggregate report ready. No raw rows, domains, filenames or device identifiers were saved.",
  );
}
$("#file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5_000_000)
      throw Error("Use a file smaller than 5 MB, or the streaming Python CLI.");
    await add(
      await file.text(),
      file.name.toLowerCase().endsWith(".json") ? "json" : "csv",
    );
  } catch (error) {
    message(
      error instanceof SyntaxError
        ? "The JSON file is invalid."
        : error.message,
    );
  } finally {
    e.target.value = "";
  }
});
$("#sample").addEventListener("click", async () => {
  const now = new Date(),
    lines = ["time,device,outcome,domain"];
  for (let i = 0; i < 160; i++) {
    const t = new Date(+now - i * 10 * 60000);
    lines.push(
      `${t.toISOString()},sample-device-${i % 3},${i % 4 === 0 ? "blocked" : "allowed"},fictional.invalid`,
    );
  }
  try {
    await add(lines.join("\n"), "csv");
  } catch (e) {
    message(e.message);
  }
});
$("#reports").addEventListener("click", (e) => {
  const b = e.target.closest("[data-report]");
  if (b) {
    selected = b.dataset.report;
    render();
  }
});
$("#report").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b?.id === "remove") {
    reports = reports.filter((r) => r.id !== selected);
    selected = reports.at(-1)?.id || null;
    save();
    render();
    message(
      "Aggregate report removed. The original source file was untouched.",
    );
  } else if (b?.id === "export") {
    const r = reports.find((r) => r.id === selected);
    if (!r) return;
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(r.report, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "quiet-hours-aggregate.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
$("#days").addEventListener("change", () => {
  prune();
  render();
  message(
    "Retention updated. Old aggregate date buckets were removed from this app.",
  );
});
$("#forget").addEventListener("click", () => {
  if (
    !confirm(
      "Remove all aggregate reports saved by Quiet Hours in this browser? Export any report you want to keep first.",
    )
  )
    return;
  reports = [];
  selected = null;
  save();
  render();
  message(
    "Every saved aggregate report was removed from this app. Original files were untouched.",
  );
});
prune();
render();
