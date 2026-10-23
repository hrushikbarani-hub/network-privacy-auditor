export function parseCSV(text) {
  if (text.length > 5_000_000)
    throw Error("Use a CSV smaller than 5 MB, or the streaming Python CLI.");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell) throw Error("Invalid CSV quoting.");
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("An unfinished quoted field was found.");
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  if (rows.length > 100001) throw Error("Import limit is 100,000 data rows.");
  const headers = rows.shift() || [];
  if (
    new Set(headers).size !== headers.length ||
    !["time", "device", "outcome"].every((h) => headers.includes(h))
  )
    throw Error("CSV needs unique time, device and outcome headers.");
  return rows.map((r, i) => {
    if (r.length !== headers.length)
      throw Error(`Wrong field count at data row ${i + 1}.`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
  });
}
export function aggregate(rows, { now = new Date(), days = 7 } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw Error("Use retention between 1 and 30 days.");
  const cutoff = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - days + 1,
      ),
    )
      .toISOString()
      .slice(0, 10),
    buckets = new Map();
  let skipped = 0;
  rows.forEach((r, i) => {
    const when = new Date(r.time);
    if (
      !/(Z|[+-]\d\d:\d\d)$/.test(String(r.time)) ||
      !Number.isFinite(+when) ||
      !["blocked", "allowed", "unknown"].includes(r.outcome)
    )
      throw Error(`Invalid time or outcome at data row ${i + 1}.`);
    const day = when.toISOString().slice(0, 10);
    if (when > now || day < cutoff) {
      skipped++;
      return;
    }
    if (!buckets.has(day))
      buckets.set(day, {
        date: day,
        blocked: 0,
        allowed: 0,
        unknown: 0,
        devices: new Set(),
      });
    const b = buckets.get(day);
    b[r.outcome]++;
    if (r.device?.trim()) b.devices.add(r.device.trim());
  });
  return {
    schema: 1,
    created_at: now.toISOString(),
    retention_days: days,
    source: "csv",
    daily: [...buckets.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ devices, ...b }) => ({ ...b, unique_devices: devices.size })),
    skipped,
  };
}
export function cleanReport(raw, days = 7, now = new Date()) {
  if (raw?.schema !== 1 || !Array.isArray(raw.daily) || raw.daily.length > 31)
    throw Error("This is not an aggregate report for Quiet Hours.");
  const cutoff = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - days + 1,
    ),
  )
    .toISOString()
    .slice(0, 10);
  const seen = new Set();
  const daily = raw.daily
    .map((r) => {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
        !Number.isFinite(+new Date(r.date)) ||
        new Date(r.date).toISOString().slice(0, 10) !== r.date ||
        seen.has(r.date) ||
        ![r.blocked, r.allowed, r.unknown, r.unique_devices].every(
          (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000,
        ) ||
        r.unique_devices > r.blocked + r.allowed + r.unknown
      )
        throw Error("The aggregate report has invalid date buckets or counts.");
      seen.add(r.date);
      return {
        date: r.date,
        blocked: r.blocked,
        allowed: r.allowed,
        unknown: r.unknown,
        unique_devices: r.unique_devices,
      };
    })
    .filter(
      (r) => r.date >= cutoff && r.date <= now.toISOString().slice(0, 10),
    );
  return {
    schema: 1,
    created_at: new Date(raw.created_at).toISOString(),
    retention_days: days,
    source: raw.source === "pihole" ? "pihole" : "csv",
    daily,
    skipped:
      Number.isSafeInteger(raw.skipped) && raw.skipped >= 0 ? raw.skipped : 0,
  };
}
export function totals(report) {
  return report.daily.reduce(
    (a, d) => ({
      blocked: a.blocked + d.blocked,
      allowed: a.allowed + d.allowed,
      unknown: a.unknown + d.unknown,
    }),
    { blocked: 0, allowed: 0, unknown: 0 },
  );
}
