import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { aggregate, parseCSV, cleanReport } from "../web/audit-model.js";
test("quoted CSV fields are read but domains and identifiers never enter a report", () => {
  const rows = parseCSV(
    'time,device,outcome,domain\n2026-10-23T10:00:00Z,"private, laptop",blocked,secret.example\n',
  );
  const r = aggregate(rows, { now: new Date("2026-10-23T12:00Z") });
  assert.equal(r.daily[0].blocked, 1);
  assert.doesNotMatch(JSON.stringify(r), /private|secret|domain/);
  assert.throws(() => parseCSV('time,device,outcome\n"unfinished'));
});
test("old/future dates are excluded and report imports whitelist fields", () => {
  const r = aggregate(
    [
      { time: "2026-10-23T01:00Z", device: "x", outcome: "allowed" },
      { time: "2026-10-24T01:00Z", device: "x", outcome: "blocked" },
    ],
    { now: new Date("2026-10-23T12:00Z"), days: 1 },
  );
  assert.equal(r.skipped, 1);
  const clean = cleanReport(
    { ...r, domain: "must disappear" },
    1,
    new Date("2026-10-23T12:00Z"),
  );
  assert.equal(clean.domain, undefined);
});
test("the real sample flow saves aggregates, exposes a report and applies retention", async () => {
  const window = new Window({ url: "https://example.test" });
  window.document.write(
    await readFile(new URL("../web/index.html", import.meta.url), "utf8"),
  );
  const globals = {
    window,
    document: window.document,
    localStorage: window.localStorage,
  };
  const old = new Map(
    Object.keys(globals).map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  for (const [k, v] of Object.entries(globals))
    Object.defineProperty(globalThis, k, {
      value: v,
      writable: true,
      configurable: true,
    });
  try {
    await import("../web/app.js");
    window.document.querySelector("#sample").click();
    await new Promise((r) => setTimeout(r, 30));
    assert.match(
      window.document.querySelector("#report").textContent,
      /The shape/,
    );
    const saved = window.localStorage.getItem("quiet-hours-v1");
    assert.doesNotMatch(saved, /fictional.invalid|sample-device|domain/);
    const select = window.document.querySelector("#days");
    select.value = "1";
    select.dispatchEvent(new window.Event("change"));
    assert.match(
      window.document.querySelector("#message").textContent,
      /Retention updated/,
    );
  } finally {
    for (const [k, d] of old) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
    await window.happyDOM.abort();
  }
});
