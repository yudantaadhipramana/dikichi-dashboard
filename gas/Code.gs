/****************************************************
 * MIE GACOAN
 * PRODUCT EXCELLENCE DASHBOARD
 *
 * WEB APP ENTRY POINT
 *
 * ARSITEKTUR
 * ----------
 *   Spreadsheet "PE Form Responses"
 *            |
 *            v
 *   Sheet "Master Responses Gabungan"      (long format)
 *            |
 *            v
 *   DashboardData.getData()   -> filter Outlet = "Mie Gacoan"
 *                              -> normalisasi field
 *                              -> cache chunked 240s
 *            |
 *            v
 *   DashboardAnalytics.build(filters)
 *            |
 *            v
 *   getDashboardData()  --(google.script.run)-->  JS.html
 *
 * CATATAN PENTING
 * ---------------
 * Berbeda dari dashboard Kintoun, sumber data di sini
 * SUDAH dalam bentuk long format (satu baris = satu
 * observasi parameter). Karena itu tidak ada tahap
 * product-block mapping / ETL tulis-ke-master.
 * Sheet "Master Responses Gabungan" adalah source of
 * truth langsung dan tidak pernah dimodifikasi oleh
 * dashboard ini.
 ****************************************************/


/* ==================================================
 * 1. WEB APP ENTRY
 * ================================================== */

function doGet(e) {

  /*
   * PRE-WARM: pastikan trigger cache hangat
   * aktif (idempotent, best effort).
   *
   * PERF v2 (fase A) FIX: blok ini dulunya DI BAWAH
   * `return` — tidak pernah tereksekusi (dead code),
   * sehingga trigger 20-menit tidak pernah terbentuk
   * dan cache selalu dingin saat user pertama buka
   * (>1 menit). Harus di ATAS return.
   */

  try {
    ensureWarmupTrigger();
  } catch (ignore) {
    /* web app tetap jalan walau trigger gagal */
  }


  /* ================================================
   * JSON API (fase B) — dipakai frontend statis.
   *
   * Routing lewat ?page=... supaya HTML dashboard
   * lama tetap utuh di URL default. Endpoint ini
   * hanya ada di DEPLOYMENT BARU; deployment v27
   * tetap snapshot lama dan tidak tersentuh.
   * ================================================ */

  const page =
    (e && e.parameter && e.parameter.page) || "";

  if (page) {

    try {

      if (page === "fast") {

        return jsonOutput(
          getDashboardDataFast(
            parseFiltersParam(e)
          )
        );

      }

      if (page === "audits") {

        return jsonOutput(
          getDashboardAudits(
            parseFiltersParam(e)
          )
        );

      }

      if (page === "download") {

        return jsonOutput({
          url: getMasterGacoanDownloadUrl()
        });

      }

      if (page === "refresh") {

        clearDashboardCache();

        return jsonOutput({
          ok: true,
          cleared: true,
          ts: (new Date()).toISOString()
        });

      }

      if (page === "perf") {

        /* DIAGNOSTIK: ukur tiap tahap supaya ketahuan
           bagian mana yang lambat (bukan menebak). */

        const timings = {};

        var tp = (new Date()).getTime();
        const peek = DashboardData.peekDataCache();
        timings.peekMs = (new Date()).getTime() - tp;

        tp = (new Date()).getTime();
        const raw = DashboardData.getData();
        timings.getDataMs = (new Date()).getTime() - tp;
        timings.rows = raw ? raw.length : 0;

        tp = (new Date()).getTime();
        const built = DashboardAnalytics
          .build({}, { excludeAudits: true });
        timings.buildMs = (new Date()).getTime() - tp;

        tp = (new Date()).getTime();
        const ser = JSON.stringify(built);
        timings.stringifyMs = (new Date()).getTime() - tp;
        timings.payloadMB =
          +(ser.length / 1048576).toFixed(2);

        tp = (new Date()).getTime();
        const ca = DashboardData.getAuditsCache();
        timings.auditsMs = (new Date()).getTime() - tp;
        timings.auditsLen = ca ? ca.length : 0;

        return jsonOutput({
          ok: true,
          peek: peek,
          timings: timings
        });

      }

      if (page === "status") {

        return jsonOutput({
          ok: true,
          ts: (new Date()).toISOString(),
          etlCache:
            (DashboardData.peekDataCache() || "MISS"),
          auditsCache:
            (DashboardData.getAuditsCache()
              ? "HIT"
              : "MISS"),
          version: "faseB"
        });

      }

      return jsonOutput({
        ok: false,
        error: "Unknown page: " + page
      });

    }
    catch (error) {

      return jsonOutput({
        ok: false,
        error: error.message
      });

    }

  }


  return HtmlService
    .createTemplateFromFile("Index")
    .evaluate()
    .setTitle(
      DASHBOARD_CONFIG
        .BRAND
        .SCRIPT_TITLE
    )
    .setXFrameOptionsMode(
      HtmlService
        .XFrameOptionsMode
        .ALLOWALL
    );

}


/* ==================================================
 * 1b. JSON API HELPERS (fase B)
 * ================================================== */

/**
 * Bungkus objek jadi JSON response.
 * ContentService otomatis digzip Google di edge,
 * jadi 2.6 MB di jaringan hanya ~400 KB.
 */
function jsonOutput(obj) {

  return ContentService
    .createTextOutput(
      JSON.stringify(obj)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );

}

/**
 * Ambil parameter `filters` (JSON string) dari URL.
 * Contoh: ?page=fast&filters={"outlet":["MALANG SUKUN"]}
 */
function parseFiltersParam(e) {

  try {

    const raw =
      (e && e.parameter && e.parameter.filters) || "";

    if (!raw) return {};

    return JSON.parse(raw);

  }
  catch (ignore) {

    return {};

  }

}


/* ==================================================
 * 2. HTML INCLUDE
 * ================================================== */

function include(filename) {

  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();

}


/* ==================================================
 * 3. DASHBOARD DATA ENDPOINT
 * ==================================================
 *
 * Dipanggil dari JS.html:
 *   google.script.run.getDashboardData(filters)
 *
 * Di boundary google.script.run object dinormalisasi
 * menjadi plain JSON-safe object supaya tidak ada
 * property/value khusus Apps Script yang gagal
 * diserialisasi ke browser.
 */

function getDashboardData(filters) {

  try {

    filters =
      filters || {};


    const result =
      DashboardAnalytics
        .build(filters);


    if (
      result === null ||
      result === undefined
    ) {

      throw new Error(
        "DashboardAnalytics.build() returned empty result."
      );

    }


    const safeResult =
      JSON.parse(
        JSON.stringify(result)
      );


    if (
      !safeResult ||
      typeof safeResult !== "object"
    ) {

      throw new Error(
        "Dashboard payload is not a valid object after JSON serialization."
      );

    }


    return safeResult;

  }
  catch (error) {

    console.error(
      "getDashboardData() ERROR: " +
      error.message
    );

    throw error;

  }

}


/*
 * STAGED LOAD (v1.2): payload ringan tanpa
 * Audit Explorer + per-product/item trend
 * (~0,45 MB) — KPI, chart & tabel utama muncul
 * jauh lebih cepat. Detail audit diambil
 * terpisah via getDashboardAudits().
 */

function getDashboardDataFast(filters) {

  const t0 = (new Date()).getTime();

  try {

    filters = filters || {};

    const result =
      DashboardAnalytics
        .build(filters, { excludeAudits: true });

    if (!result) {
      throw new Error("build() returned empty result.");
    }

    const elapsed =
      (new Date()).getTime() - t0;

    console.log(
      "getDashboardDataFast: " +
        elapsed +
        " ms | payload " +
        (JSON.stringify(result).length / 1048576).toFixed(2) +
        " MB" +
        " | auditsCache: " +
        (DashboardData.getAuditsCache() ? "HIT" : "MISS")
    );

    return JSON.parse(JSON.stringify(result));

  }
  catch (error) {

    console.error("getDashboardDataFast() ERROR: " + error.message);
    throw error;

  }

}


/*
 * Lazy-load Audit Explorer saja
 * (dipanggil frontend setelah fast render).
 */

function getDashboardAudits(filters) {

  try {

    filters = filters || {};

    /* PERF v2 (fase A): hasil audit list di-cache terpisah
       dari payload utama. Audit Explorer adalah request
       terberat (~2.6 MB) dan selalu dihitung ulang dari
       nol walau data tidak berubah. Filter default {} =
       payload yang sama tiap kali — cache-kan saja.

       PENTING (perbaikan): frontend SELALU mengirim semua
       kunci filter walau isinya kosong, jadi perbandingan
       string "{}" dulu TIDAK PERNAH cocok -> cache audit
       tidak pernah kena, request audits selalu 7-40 detik.
       Sekarang dipakai hasNoEffectiveFilter() supaya
       filter kosong = default. */

    const isDefaultFilter =
      DashboardAnalytics
        .hasNoEffectiveFilter(filters);

    const filterKey =
      isDefaultFilter
        ? "{}"
        : JSON.stringify(filters || {});

    if (filterKey === "{}") {

      const cached =
        DashboardData.getAuditsCache();

      if (cached) {

        return cached;

      }

    }

    const rawData =
      DashboardData
        .getData();

    const filtered =
      DashboardAnalytics
        .applyFilters(rawData, filters);

    const audits =
      DashboardAnalytics
        .getAuditSummary(filtered);

    const safe =
      JSON.parse(JSON.stringify(audits));

    if (filterKey === "{}") {

      DashboardData.writeAuditsCache(safe);

    }

    return safe;

  }
  catch (error) {

    console.error("getDashboardAudits() ERROR: " + error.message);
    throw error;

  }

}


/*
 * PRE-WARM (v1.2): trigger time-driven tiap 20
 * menit memanggil ini supaya cache ETL selalu
 * hangat — user hampir tidak pernah kena
 * cold read 20 ribu baris lagi.
 */

function warmDashboardCache() {

  try {

    DashboardData.getData();

    /* fase A: bangun + cache audit list juga di sini,
       karena Audit Explorer adalah request terberat
       (~2.6 MB). Tanpa ini, tiap buka halaman tetap
       membayar full aggregation walau ETL hangat. */

    try {

      const rawData =
        DashboardData
          .getData();

      const audits =
        DashboardAnalytics
          .getAuditSummary(rawData);

      DashboardData.writeAuditsCache(
        JSON.parse(JSON.stringify(audits))
      );

      console.log("warmDashboardCache: OK (data + audits)");

    }
    catch (auditError) {

      console.error(
        "warmDashboardCache audits: " +
          auditError.message
      );

    }

  }
  catch (error) {

    console.error("warmDashboardCache() ERROR: " + error.message);

  }

}


/*
 * Idempotent: pastikan tepat satu trigger
 * warmup aktif. Dipanggil dari doGet().
 */

function ensureWarmupTrigger() {

  try {

    const existing =
      ScriptApp
        .getProjectTriggers()
        .filter(function(t) {
          return t.getHandlerFunction() === "warmDashboardCache";
        });

    if (existing.length === 1) return;

    existing.forEach(function(t) {
      ScriptApp.deleteTrigger(t);
    });

    ScriptApp
      .newTrigger("warmDashboardCache")
      .timeBased()
      .everyMinutes(20)
      .create();

    console.log("ensureWarmupTrigger: created");

  }
  catch (error) {

    console.error("ensureWarmupTrigger() ERROR: " + error.message);

  }

}


/* ==================================================
 * 4. CACHE
 * ================================================== */

function clearDashboardCache() {

  try {

    DashboardData
      .clearCache();


    Logger.log(
      "Dashboard cache cleared."
    );

  }
  catch (error) {

    Logger.log(
      "Cache clear warning: " +
      error.message
    );

  }

}


/**
 * refreshDashboardData
 *
 * Dipanggil tombol Refresh di dashboard.
 * Buang cache lalu ambil ulang data dari sheet.
 */
function refreshDashboardData(filters) {

  try {

    clearDashboardCache();

    return getDashboardData(
      filters || {}
    );

  }
  catch (error) {

    console.error(
      "refreshDashboardData ERROR: " +
      error.message
    );

    throw error;

  }

}


/* ==================================================
 * 5. DOWNLOAD DATA
 * ==================================================
 *
 * Dipakai tombol "Download Data" pada Audit Explorer.
 * Mengekspor sheet sumber (bukan hasil olahan) supaya
 * angka yang diunduh identik dengan dashboard.
 */

function getMasterGacoanDownloadUrl() {

  const ss =
    SpreadsheetApp
      .openById(
        DASHBOARD_CONFIG
          .SPREADSHEET_ID
      );


  const sheet =
    ss.getSheetByName(
      DASHBOARD_CONFIG
        .MASTER_SHEET
    );


  if (!sheet) {

    throw new Error(
      'Sheet "' +
      DASHBOARD_CONFIG.MASTER_SHEET +
      '" tidak ditemukan.'
    );

  }


  return (
    "https://docs.google.com/spreadsheets/d/" +
    DASHBOARD_CONFIG.SPREADSHEET_ID +
    "/export?format=xlsx&gid=" +
    sheet.getSheetId()
  );

}


/* ==================================================
 * 6. DIAGNOSTICS
 * ================================================== */

/**
 * Cek struktur kolom sheet sumber terhadap
 * DASHBOARD_CONFIG.HEADERS.
 *
 * Jalankan dari Apps Script editor. Kalau ada kolom
 * yang hilang, dashboard akan gagal dengan pesan
 * jelas — fungsi ini menemukannya lebih awal.
 */
function diagnoseDashboardHeaders() {

  const ss =
    SpreadsheetApp
      .openById(
        DASHBOARD_CONFIG
          .SPREADSHEET_ID
      );


  const sheet =
    ss.getSheetByName(
      DASHBOARD_CONFIG
        .MASTER_SHEET
    );


  if (!sheet) {

    Logger.log(
      'Sheet "' +
      DASHBOARD_CONFIG.MASTER_SHEET +
      '" TIDAK DITEMUKAN.'
    );

    return;

  }


  const headers =
    sheet
      .getRange(
        1,
        1,
        1,
        sheet.getLastColumn()
      )
      .getValues()[0]
      .map(
        function(header) {

          return String(
            header
          ).trim();

        }
      );


  Logger.log(
    "SHEET: " +
    DASHBOARD_CONFIG.MASTER_SHEET
  );

  Logger.log(
    "HEADERS AKTUAL (" +
    headers.length +
    "): " +
    headers.join(" | ")
  );


  const expected =
    DASHBOARD_CONFIG
      .HEADERS;


  const missing =
    [];


  Object.keys(expected)
    .forEach(
      function(key) {

        if (
          headers.indexOf(
            expected[key]
          ) === -1
        ) {

          missing.push(
            key +
            " -> \"" +
            expected[key] +
            "\""
          );

        }

      }
    );


  if (missing.length) {

    Logger.log(
      "KOLOM HILANG (" +
      missing.length +
      "):"
    );

    missing.forEach(
      function(item) {

        Logger.log(
          "   - " +
          item
        );

      }
    );

  }
  else {

    Logger.log(
      "SEMUA KOLOM DITEMUKAN."
    );

  }

}


/**
 * Cek alur data end-to-end: baca sheet, filter outlet,
 * normalisasi, dan laporkan distribusinya.
 */
function testDashboardDataFlow() {

  Logger.log(
    "======================================"
  );

  Logger.log(
    "MIE GACOAN DASHBOARD DATA FLOW TEST"
  );

  Logger.log(
    "======================================"
  );


  try {

    DashboardData
      .clearCache();


    const data =
      DashboardData
        .getData();


    Logger.log(
      "TOTAL ROWS: " +
      data.length
    );


    if (!data.length) {

      Logger.log(
        "WARNING: 0 rows. Cek filter Outlet / kolom sheet."
      );

      return;

    }


    Logger.log(
      "--------------------------------------"
    );

    Logger.log(
      "FIRST 3 ROWS:"
    );

    Logger.log(
      JSON.stringify(
        data.slice(0, 3),
        null,
        2
      )
    );


    /* ---------- DISTRIBUSI ---------- */

    function countBy(field) {

      const map =
        {};


      data.forEach(
        function(row) {

          const key =
            String(
              row[field] || "(kosong)"
            );


          map[key] =
            (map[key] || 0) + 1;

        }
      );


      return map;

    }


    Logger.log(
      "--------------------------------------"
    );

    Logger.log(
      "BRANCH: " +
      JSON.stringify(
        countBy("outlet")
      )
    );


    Logger.log(
      "PRODUCT: " +
      JSON.stringify(
        countBy("product")
      )
    );


    Logger.log(
      "AUDITOR: " +
      JSON.stringify(
        countBy("name")
      )
    );


    /* ---------- VALIDASI ---------- */

    const audits =
      {};


    let invalidScore =
      0;


    let withEvidence =
      0;


    data.forEach(
      function(row) {

        audits[row.auditId] =
          true;


        if (
          !dashboardIsValidScore(
            row.score
          )
        ) {

          invalidScore++;

        }


        if (
          row.documentation
        ) {

          withEvidence++;

        }

      }
    );


    Logger.log(
      "--------------------------------------"
    );

    Logger.log(
      "UNIQUE AUDITS: " +
      Object.keys(audits).length
    );

    Logger.log(
      "INVALID SCORES: " +
      invalidScore
    );

    Logger.log(
      "ROWS WITH EVIDENCE URL: " +
      withEvidence
    );

    Logger.log(
      "======================================"
    );

  }
  catch (error) {

    Logger.log(
      "DATA FLOW ERROR: " +
      error.message
    );

    throw error;

  }

}


/**
 * Jalankan analytics penuh tanpa frontend, untuk
 * memastikan payload siap dikirim ke browser.
 */
function testDashboardEndpointPayload() {

  try {

    const result =
      getDashboardData({});


    Logger.log(
      "PAYLOAD KEYS: " +
      Object.keys(result).join(", ")
    );


    Logger.log(
      "OVERVIEW: " +
      JSON.stringify(
        result.overview,
        null,
        2
      )
    );


    Logger.log(
      "GRADE DISTRIBUTION: " +
      JSON.stringify(
        result.gradeDistribution
      )
    );


    Logger.log(
      "PRODUCTS: " +
      (
        result.products
          ? result.products.length
          : 0
      ) +
      " rows"
    );


    Logger.log(
      "ITEMS: " +
      (
        result.items
          ? result.items.length
          : 0
      ) +
      " rows"
    );


    Logger.log(
      "ATTRIBUTES: " +
      (
        result.attributes
          ? result.attributes.length
          : 0
      ) +
      " rows"
    );


    Logger.log(
      "BRANCHES: " +
      (
        result.outlets
          ? result.outlets.length
          : 0
      ) +
      " rows"
    );


    Logger.log(
      "AUDITS: " +
      (
        result.audits
          ? result.audits.length
          : 0
      ) +
      " rows"
    );


    Logger.log(
      "METADATA: " +
      JSON.stringify(
        result.metadata
      )
    );

  }
  catch (error) {

    Logger.log(
      "ENDPOINT PAYLOAD ERROR: " +
      error.message
    );

    throw error;

  }

}



/**
 * DIAGNOSTIC: fungsi paling sederhana.
 * Mengembalikan status lingkungan tanpa HtmlService / CacheService.
 */
function pingGacoan() {
  return "pong " + new Date().toISOString();
}
