#!/usr/bin/env node
/*
 * Uji paritas: hasil agregasi di browser (analytics.js) harus sama
 * dengan hasil Apps Script (gas/*.gs) untuk data dan filter yang sama.
 *
 *   node tools/test-analytics-parity.js
 *
 * Server disimulasikan di VM Node dengan mock SpreadsheetApp/CacheService
 * dan TZ=Asia/Jakarta (zona waktu script). Client dijalankan di proses
 * terpisah dengan beberapa zona waktu pengunjung.
 */

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var cp = require("child_process");

var root = path.join(__dirname, "..");
var mode = process.argv[2] || "main";
var tmp = process.argv[3];

var FILTER_CASES = [
  {},
  { month: "", date: "", dates: [], weeks: [], outlet: [], product: [], item: [], attribute: [], grade: [] },
  { outlet: ["KEDIRI PEMUDA"] },
  { product: ["Ayam Ori", "Teh"] },
  { grade: ["MIDDLE FAIL", "STRONG FAIL"] },
  { dates: ["2026-10-03", "2026-10-04"] },
  { weeks: [40] },
  { item: ["Ayam Hot"], attribute: ["Visual"] }
];

function syntheticSheet() {
  /* PRNG deterministik supaya hasil bisa diulang. */
  var seed = 7;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  var header = ["start_time", "end_time", "Tanggal Audit", "audit_id", "Nama Auditor", "Outlet",
    "Branch / Cabang", "Product", "_id", "Item", "Parameter", "Score / Hasil Evaluasi",
    "Catatan Khusus", "Finding / Alasan Evaluasi", "Evidence Photo", "Evidence Photo_URL", "evidence_id"];
  var products = {
    "Ayam Ori": ["Ayam Hot", "Ayam Original"], "Ayam Crispy Ori Geprek": ["Geprek Level 1"],
    "Ayam Nashville": ["Nashville Paha"], "French Fries": ["Fries Reguler"], "Teh": ["Es Teh"], "Milo": ["Es Milo"]
  };
  var params = ["Visual", "Aroma", "Rasa", "Tekstur", "Suhu"];
  var values = [header];
  for (var a = 1; a <= 61; a++) {
    var day = 1 + Math.floor(rnd() * 50);            /* Sep s.d. pertengahan Okt 2026 */
    var d = new Date(Date.UTC(2026, 8, day, 0, 0, 0));
    var hourWib = pick([8, 12, 17, 23]);              /* 23 WIB menguji batas hari */
    var start = new Date(d.getTime() + (hourWib - 7) * 3600000 + 1800000);
    var dd = ("0" + d.getUTCDate()).slice(-2) + "/" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "/" + d.getUTCFullYear();
    var branch = rnd() < 0.85 ? "MOJOKERTO RADEN WIJAYA" : "Kediri  pemuda";
    var auditId = "DK-T-" + a;
    var prodList = rnd() < 0.3 ? ["Ayam Ori", pick(Object.keys(products))] : [pick(Object.keys(products))];
    prodList.forEach(function(prod) {
      var item = pick(products[prod]);
      params.forEach(function(param) {
        var score = rnd() < 0.05 ? "" : pick([1, 2, 2.5, 3, 3, 4, 4, 5]);
        values.push([start.toISOString(), "", dd, auditId, pick(["Andrias", "Yudanta"]),
          rnd() < 0.02 ? "Mie Gacoan" : "Dikichi", branch, prod, "sub-" + a, item, param, score,
          rnd() < 0.2 ? "catatan " + a : "", score !== "" && score < 3 ? "finding " + param : "",
          "", rnd() < 0.3 ? "https://example.com/p" + a + ".jpg" : "", "ev-" + a]);
      });
    });
  }
  return values;
}

function loadServer(values) {
  var store = {};
  var ctx = {
    console: { log: function() {}, warn: function() {}, error: console.error },
    CacheService: { getScriptCache: function() { return {
      get: function(k) { return store[k] === undefined ? null : store[k]; },
      put: function(k, v) { store[k] = v; }, remove: function(k) { delete store[k]; } }; } },
    SpreadsheetApp: { openById: function() { return { getSheetByName: function() { return {
      getDataRange: function() { return { getValues: function() { return values; } }; },
      getSheetId: function() { return 0; } }; } }; } },
    ScriptApp: { getProjectTriggers: function() { return []; },
      newTrigger: function() { var t = { timeBased: function() { return t; }, everyMinutes: function() { return t; }, create: function() {} }; return t; },
      deleteTrigger: function() {} },
    ContentService: { createTextOutput: function(t) { return { t: t, setMimeType: function() { return this; } }; }, MimeType: { JSON: 1 } },
    Logger: { log: function() {} },
    Session: { getScriptTimeZone: function() { return "Asia/Jakarta"; } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "analytics.js"), "utf8"), ctx); /* hanya untuk Utilities shim */
  ctx.Utilities = vm.runInContext("(" + function() {
    return { formatDate: function(date, tz, pattern) {
      var parts = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date)
        .forEach(function(p) { parts[p.type] = p.value; });
      return pattern.replace("yyyy", parts.year).replace("MM", parts.month).replace("dd", parts.day)
        .replace("HH", parts.hour).replace("mm", parts.minute);
    } };
  } + ")()", ctx);
  ["DashboardConfig", "DashboardUtils", "DashboardData", "DashboardAnalytics", "Code"].forEach(function(f) {
    vm.runInContext(fs.readFileSync(path.join(root, "gas", f + ".gs"), "utf8")
      .replace(/^const (\w+)\s*=/m, "var $1 ="), ctx);
  });
  return ctx;
}

function get(ctx, page, filters) {
  var e = { parameter: { page: page } };
  if (filters) e.parameter.filters = JSON.stringify(filters);
  return JSON.parse(ctx.doGet(e).t);
}

if (require.main !== module) {
  module.exports = { syntheticSheet: syntheticSheet, loadServer: loadServer, get: get };
}
else if (mode === "server") {
  var ctx = loadServer(syntheticSheet());
  var rows = get(ctx, "rows");
  var out = { rows: rows, cases: FILTER_CASES.map(function(f) {
    return { fast: get(ctx, "fast", f), audits: get(ctx, "audits", f) };
  }) };
  fs.writeFileSync(tmp, JSON.stringify(out));
}
else if (mode === "client") {
  require(path.join(root, "analytics.js"));
  var srv = JSON.parse(fs.readFileSync(tmp, "utf8"));
  var fails = 0;
  FILTER_CASES.forEach(function(f, i) {
    var fast = JSON.parse(JSON.stringify(DikichiAnalytics.build(srv.rows.rows, f, { excludeAudits: true })));
    /* lastUpdated = jam saat dihitung, wajar berbeda antar proses. */
    delete fast.metadata.lastUpdated;
    delete srv.cases[i].fast.metadata.lastUpdated;
    /* Server mengembalikan filter dari request pertama yang di-cache
       ({} vs objek kosong lengkap); keduanya sama-sama "tanpa filter". */
    delete fast.filters;
    delete srv.cases[i].fast.filters;
    var audits = JSON.parse(JSON.stringify(DikichiAnalytics.audits(srv.rows.rows, f)));
    ["fast", "audits"].forEach(function(k) {
      var a = JSON.stringify(k === "fast" ? fast : audits), b = JSON.stringify(srv.cases[i][k]);
      if (a !== b) { fails++; console.log("  BEDA  case " + i + " " + k + " " + JSON.stringify(f)); }
    });
  });
  console.log("  TZ=" + process.env.TZ + " rows=" + srv.rows.count + " -> " +
    (fails ? fails + " perbedaan" : "identik (" + FILTER_CASES.length * 2 + " payload)"));
  process.exit(fails ? 1 : 0);
}
else {
  var file = path.join(require("os").tmpdir(), "dikichi-parity-" + process.pid + ".json");
  cp.execFileSync(process.execPath, [__filename, "server", file], { env: Object.assign({}, process.env, { TZ: "Asia/Jakarta" }), stdio: "inherit" });
  var ok = true;
  ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "UTC"].forEach(function(tz) {
    try { cp.execFileSync(process.execPath, [__filename, "client", file], { env: Object.assign({}, process.env, { TZ: tz }), stdio: "inherit" }); }
    catch (e) { ok = false; }
  });
  fs.unlinkSync(file);
  process.exit(ok ? 0 : 1);
}
