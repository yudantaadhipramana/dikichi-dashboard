#!/usr/bin/env node
/*
 * Membangun analytics.js (dipakai frontend Vercel) dari sumber
 * Apps Script di gas/. Logika agregasi HANYA ditulis di gas/;
 * file ini menyalinnya apa adanya ke dalam satu IIFE dengan shim
 * untuk API khusus Apps Script.
 *
 * Jalankan ulang setiap kali gas/DashboardConfig.gs,
 * gas/DashboardUtils.gs atau gas/DashboardAnalytics.gs berubah:
 *   node tools/build-analytics.js
 */

var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var sources = ["DashboardConfig.gs", "DashboardUtils.gs", "DashboardAnalytics.gs"];

var body = sources.map(function(name) {
  return "/* ---- gas/" + name + " ---- */\n" +
    fs.readFileSync(path.join(root, "gas", name), "utf8");
}).join("\n\n");

var out = [
  "/* AUTO-GENERATED oleh tools/build-analytics.js dari gas/*.gs.",
  "   JANGAN diedit langsung; ubah sumbernya di gas/ lalu build ulang. */",
  "(function(global) {",
  "\"use strict\";",
  "",
  "var SCRIPT_TZ = \"Asia/Jakarta\";",
  "",
  "/* Shim Utilities.formatDate untuk pola yang dipakai DashboardUtils. */",
  "var Session = { getScriptTimeZone: function() { return SCRIPT_TZ; } };",
  "var Utilities = {",
  "  formatDate: function(date, tz, pattern) {",
  "    var parts = {};",
  "    new Intl.DateTimeFormat(\"en-GB\", {",
  "      timeZone: tz, year: \"numeric\", month: \"2-digit\", day: \"2-digit\",",
  "      hour: \"2-digit\", minute: \"2-digit\", hourCycle: \"h23\"",
  "    }).formatToParts(date).forEach(function(p) { parts[p.type] = p.value; });",
  "    return pattern",
  "      .replace(\"yyyy\", parts.year).replace(\"MM\", parts.month)",
  "      .replace(\"dd\", parts.day).replace(\"HH\", parts.hour).replace(\"mm\", parts.minute);",
  "  }",
  "};",
  "",
  "/* Apps Script menghitung tanggal \"lokal\" di zona script (WIB).",
  "   Browser memakai zona pengunjung (WITA/WIT/luar negeri), sehingga",
  "   batas hari/minggu/bulan bisa bergeser. Date di dalam bundle ini",
  "   dipaksa berperilaku seperti WIB (UTC+7, tanpa DST). */",
  "var NativeDate = global.Date;",
  "var WIB_OFFSET_MS = 7 * 3600000;",
  "var NAIVE_ISO = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?$/;",
  "class JakartaDate extends NativeDate {",
  "  constructor() {",
  "    var a = Array.prototype.slice.call(arguments);",
  "    if (a.length >= 2) {",
  "      super(NativeDate.UTC.apply(null, a) - WIB_OFFSET_MS);",
  "    } else if (a.length === 1) {",
  "      var v = a[0];",
  "      super(typeof v === \"string\" && NAIVE_ISO.test(v) ? v + \"+07:00\" : v);",
  "    } else {",
  "      super();",
  "    }",
  "  }",
  "  _wib() { return new NativeDate(this.getTime() + WIB_OFFSET_MS); }",
  "  getFullYear() { return this._wib().getUTCFullYear(); }",
  "  getMonth() { return this._wib().getUTCMonth(); }",
  "  getDate() { return this._wib().getUTCDate(); }",
  "  getDay() { return this._wib().getUTCDay(); }",
  "  getHours() { return this._wib().getUTCHours(); }",
  "}",
  "var Date = JakartaDate;",
  "",
  "/* Baris ternormalisasi dari ?page=rows menggantikan pembacaan sheet. */",
  "var CURRENT_ROWS = [];",
  "var DashboardData = { getData: function() { return CURRENT_ROWS; } };",
  "",
  body,
  "",
  "global.DikichiAnalytics = {",
  "  config: DASHBOARD_CONFIG,",
  "  build: function(rows, filters, options, lastUpdated) {",
  "    CURRENT_ROWS = rows || [];",
  "    var result = DashboardAnalytics.buildUncached(filters || {}, options || {});",
  "    /* lastUpdated = waktu data diambil dari server, bukan waktu hitung. */",
  "    if (lastUpdated && result.metadata) result.metadata.lastUpdated = lastUpdated;",
  "    return result;",
  "  },",
  "  audits: function(rows, filters) {",
  "    CURRENT_ROWS = rows || [];",
  "    DashboardAnalytics._memoAuditScores = null;",
  "    DashboardAnalytics._memoItemScores = null;",
  "    DashboardAnalytics._memoAuditData = null;",
  "    return DashboardAnalytics.getAuditSummary(",
  "      DashboardAnalytics.applyFilters(CURRENT_ROWS, filters || {})",
  "    );",
  "  }",
  "};",
  "",
  "})(typeof window !== \"undefined\" ? window : globalThis);",
  ""
].join("\n");

var target = path.join(root, "analytics.js");

if (process.argv[2] === "--check") {
  /* Gagal kalau analytics.js tidak sesuai dengan gas/ saat ini. */
  var current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (current !== out) {
    console.error("analytics.js BASI: jalankan `node tools/build-analytics.js` lalu commit.");
    process.exit(1);
  }
  console.log("analytics.js sesuai dengan gas/");
  process.exit(0);
}

fs.writeFileSync(target, out);
console.log("analytics.js ditulis (" + out.length + " byte)");
