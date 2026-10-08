/* =========================================================
   DIKICHI
   PRODUCT QUALITY INTELLIGENCE
   FRONTEND CONTROLLER
   VERSION: V3.1
   ========================================================= */


/* =========================================================
   GLOBAL STATE
   ========================================================= */

const DashboardState = {

  data: null,

  filters: {

    month: "",

    date: "",

    dates: [],

    weeks: [],

    outlet: [],

    product: [],

    item: [],

    attribute: [],

    grade: []

  },

  trendMode: "allTime",

  productTrendMode: "allTime",

  loading: false,

  chartsReady: false,

  chartsLoading: false,

  autoRefreshInterval: null,

  lastRenderedAudits: [],

  lastError: null,

  kpiProductRows: 0,

  kpiProductRecheck: false

};


/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  function() {

    initializeDashboard();

  }
);


function initializeDashboard() {

  setLoadingState(
    true
  );


  /*
   * IMPORTANT:
   *
   * Data dashboard TIDAK lagi
   * menunggu Google Charts.
   */

  loadDashboard();


  /*
   * Google Charts berjalan
   * secara paralel.
   */

  loadGoogleCharts();


  /*
   * Init multi-select toggles
   */

  initMultiSelectToggles();

}



/* =========================================================
   GOOGLE CHARTS
   ========================================================= */

function loadGoogleCharts() {

  if (
    typeof google === "undefined" ||
    !google.charts
  ) {

    console.warn(
      "Google Charts is not available yet."
    );

    return;

  }


  google.charts.load(
    "current",
    {
      packages: [
        "corechart"
      ]
    }
  );


  google.charts.setOnLoadCallback(
    function() {

      DashboardState.chartsReady =
        true;


      /*
       * Jika data sudah tersedia,
       * langsung render chart.
       */

      if (
        DashboardState.data
      ) {

        renderQualityTrend(
          DashboardState.data.trend
        );


        renderGradeDistribution(
          DashboardState.data
            .gradeDistribution
        );

      }

    }
  );

}



/* =========================================================
   TRANSPORT (fase B — static frontend)
   =========================================================
   Versi GAS lama memakai google.script.run. Versi statis
   memakai fetch ke JSON API di deployment GAS baru
   (deployment v27 lama tidak tersentuh).

   Cara upgrade: API_BASE di bawah cukup diarahkan ke URL
   /exec deployment baru.
   ========================================================= */

var API_BASE = window.__API_BASE__ ||
  "https://script.google.com/macros/s/AKfycbwDrSripeMtToDmXIFPWvqfEhVS7ALee1CWmiyUVbhNXm0_T7TEzxCqLYjWZDE6GSJp/exec";

/*
 * VERSI LAMA (rollback) — JANGAN dihapus:
 *   Mie Gacoan (referensi, masih hidup, TIDAK disentuh):
 *   https://script.google.com/macros/s/AKfycbyDtJAWnp5ushY_fKztxS9h1d34_KVSCjVEDfSQnF_9yBur1pOGhcfuvRXIDWN86alw/exec
 * Rollback front-end = deployment Vercel sebelumnya (dikichi-dashboard project > Deployments).
 */

function apiFetch(params) {

  var qs = Object.keys(params || {})
    .map(function(k) {

      return encodeURIComponent(k) + "=" +
        encodeURIComponent(params[k]);

    })
    .join("&");

  var url = API_BASE + (qs ? ("?" + qs) : "");

  /*
   * Apps Script sporadis merespons 404/500 untuk payload
   * besar (audits ~2.5 MB) saat cache dingin atau quota
   * terkena. Retry exponential backoff 3x sebelum menyerah.
   */

  function attempt(attemptNo) {

    return fetch(url, { cache: "no-store" })
      .then(function(res) {

        if (!res.ok) {

          throw new Error("HTTP " + res.status);

        }

        return res.json();

      })
      .catch(function(err) {

        var isLast =
          attemptNo >= 3;

        if (isLast) {

          throw err;

        }

        var delayMs =
          800 * Math.pow(2, attemptNo - 1);

        return new Promise(function(resolve) {

          setTimeout(function() {

            resolve(attempt(attemptNo + 1));

          }, delayMs);

        });

      });

  }

  return attempt(1);
}

/**
 * Shim google.script.run supaya kode render tidak perlu
 * diubah satu per satu: denganSuccessHandler(...)
 * .withFailureHandler(...) .namaFungsi(arg) dipetakan ke
 * endpoint JSON yang setara.
 */
function serverCall(fnName, arg) {

  var filters =
    (arg && typeof arg === "object") ? arg : {};

  var filtersParam =
    JSON.stringify(filters);

  if (fnName === "getDashboardDataFast") {

    return apiFetch({
      page: "fast",
      filters: filtersParam
    });

  }

  if (fnName === "getDashboardAudits") {

    return apiFetch({
      page: "audits",
      filters: filtersParam
    });

  }

  if (fnName === "getMasterDikichiDownloadUrl") {

    return apiFetch({ page: "download" })
      .then(function(r) { return r && r.url; });

  }

  if (
    fnName === "runETLAndRefresh" ||
    fnName === "refreshDashboardData"
  ) {

    /* Refresh: buang cache di server supaya data
       diambil ulang dari sheet saat request berikutnya. */

    return apiFetch({ page: "refresh" });

  }

  return Promise.reject(
    new Error("Unknown server function: " + fnName)
  );

}

if (typeof google === "undefined") {
  window.google = {};
}

if (!google.script) {
  google.script = {};
}

google.script.run = (function() {

  var _ok = null;
  var _fail = null;

  var api = {

    withSuccessHandler: function(fn) {
      _ok = fn;
      return api;
    },

    withFailureHandler: function(fn) {
      _fail = fn;
      return api;
    }

  };

  [
    "getDashboardDataFast",
    "getDashboardAudits",
    "getMasterDikichiDownloadUrl",
    "runETLAndRefresh",
    "refreshDashboardData"
  ].forEach(function(fnName) {

    api[fnName] = function(arg) {

      serverCall(fnName, arg)
        .then(function(result) {

          if (_ok) _ok(result);

        })
        .catch(function(err) {

          if (_fail) _fail(err);
          else console.error(fnName + " ERROR:", err);

        });

    };

  });

  return api;

})();


/* =========================================================
   LOAD DASHBOARD
   ========================================================= */

function loadDashboard() {

  setLoadingState(true);
  showDashboardLoading();

  if (
    typeof google === "undefined" ||
    !google.script ||
    !google.script.run
  ) {

    handleDashboardError(
      new Error(
        "Google Apps Script bridge is unavailable."
      )
    );

    return;

  }

  /*
   * STAGED LOAD v1.2: request payload ringan
   * dulu (tanpa Audit Explorer) supaya KPI &
   * chart muncul cepat; tabel audit di-fetch
   * belakangan oleh loadAuditsLazy().
   */

  google.script.run

    .withSuccessHandler(
      handleDashboardSuccess
    )

    .withFailureHandler(
      handleDashboardError
    )

    .getDashboardDataFast(
      Object.assign(
        {},
        DashboardState.filters
      )
    );

}


/* =========================================================
   SUCCESS
   ========================================================= */

function handleDashboardSuccess(
  result
) {

  if (
    !result
  ) {

    handleDashboardError(
      new Error(
        "getDashboardData() returned empty data."
      )
    );

    return;

  }


  DashboardState.data =
    result;


  DashboardState.lastError =
    null;


  populateFilters(
    result.metadata
  );


  renderDashboard(
    result
  );


  setLoadingState(
    false
  );


  /*
   * STAGED LOAD v1.2: ambil Audit Explorer
   * di belakang layar setelah panel utama
   * tampil.
   */

  loadAuditsLazy();


  updateLastUpdated(
    result.metadata
      ? result.metadata.lastUpdated
      : null
  );


  startAutoRefresh();


  showToast(
    "Dashboard updated"
  );

}


/* =========================================================
   ERROR
   ========================================================= */

function handleDashboardError(
  error
) {

  DashboardState.lastError =
    error;


  setLoadingState(
    false
  );


  const message =
    error &&
    error.message
      ? error.message
      : String(
          error ||
          "Unknown dashboard error."
        );


  console.error(
    "DIKICHI DASHBOARD ERROR:",
    error
  );


  renderDashboardError(
    message
  );


  showToast(
    "Dashboard failed to load"
  );

}


/* =========================================================
   STAGED LOAD v1.2 — LAZY AUDIT EXPLORER
   ========================================================= */

function loadAuditsLazy() {

  if (
    typeof google === "undefined" ||
    !google.script ||
    !google.script.run
  ) {

    return;

  }

  google.script.run

    .withSuccessHandler(function(audits) {

      DashboardState.audits = audits;

      /*
       * Sinkron balik: modal drill-down lain
       * membaca DashboardState.data.audits.
       */

      if (DashboardState.data) {

        DashboardState.data.audits = audits;

      }

      renderRecentAudits(audits);

    })

    .withFailureHandler(function(err) {

      console.warn("loadAuditsLazy failed:", err);

      var container = document.getElementById("recentAuditTable");

      if (container) {

        container.innerHTML = '<tr><td colspan="8" class="table-loading">Failed to load audit records.</td></tr>';

      }

    })

    .getDashboardAudits(
      Object.assign({}, DashboardState.filters)
    );

}


/* =========================================================
   PERIOD PERFORMANCE GAUGE
   Half-donut SVG mandiri (tanpa library chart).
   Sumber: data.comparisons.month -> {current, previous}
   ========================================================= */

/* Geometri gauge v2 - lebih kecil, satu busur, tanpa tick.
   Lihat komentar GAUGE_SEGS untuk pemetaan warna standard. */
var GAUGE_W = 240;
var GAUGE_H = 142;
var GAUGE_CX = 120;
var GAUGE_CY = 114;
var GAUGE_R_OUT = 90;
var GAUGE_R_IN = 68;

/* Segmen warna mengikuti Quality Standard
   (SOURCE OF TRUTH), dalam pecahan 0..1 dari skala 1-5:
     STRONG FAIL      < 2.00        -> 0.00-0.40
     MIDDLE FAIL      2.00-2.99     -> 0.40-0.60
     BORDERLINE PASS  3.00-3.59     -> 0.60-0.72
     MIDDLE PASS      3.60-4.49     -> 0.72-0.90
     HIGH PASS        4.50-5.00     -> 0.90-1.00  */
var GAUGE_SEGS = [
  { color: "#D92755", from: 0.00, to: 0.40 },
  { color: "#E84B16", from: 0.40, to: 0.60 },
  { color: "#E58A00", from: 0.60, to: 0.72 },
  { color: "#0E9AA7", from: 0.72, to: 0.90 },
  { color: "#009B72", from: 0.90, to: 1.00 }
];

function gaugePct(score) {

  var v = Number(score);

  if (!isFinite(v)) return 0;

  return Math.max(0, Math.min(1, v / 5));

}

function gaugeColor(score) {

  var grade = dashboardGrade(score);

  var map = {
    "HIGH PASS":        "#009B72",
    "MIDDLE PASS":      "#0E9AA7",
    "BORDERLINE PASS":  "#E58A00",
    "MIDDLE FAIL":      "#E84B16",
    "STRONG FAIL":      "#D92755"
  };

  return map[grade] || "#8A7A90";

}

function gaugePoint(cx, cy, r, frac) {

  var angle = Math.PI * (1 - frac);

  return {
    x: cx + r * Math.cos(angle),
    y: cy - r * Math.sin(angle)
  };

}

function gaugeArc(cx, cy, rOut, rIn, fromFrac, toFrac) {

  var p1 = gaugePoint(cx, cy, rOut, fromFrac);
  var p2 = gaugePoint(cx, cy, rOut, toFrac);
  var p3 = gaugePoint(cx, cy, rIn, toFrac);
  var p4 = gaugePoint(cx, cy, rIn, fromFrac);

  var large = (toFrac - fromFrac) > 0.5 ? 1 : 0;

  return [
    "M", p1.x.toFixed(2), p1.y.toFixed(2),
    "A", rOut, rOut, 0, large, 1, p2.x.toFixed(2), p2.y.toFixed(2),
    "L", p3.x.toFixed(2), p3.y.toFixed(2),
    "A", rIn, rIn, 0, large, 0, p4.x.toFixed(2), p4.y.toFixed(2),
    "Z"
  ].join(" ");

}

function gaugeEsc(text) {

  return String(text === null || text === undefined ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

}

function renderPeriodGauge(comparisons) {

  var host = document.getElementById("periodGauge");

  if (!host) return;

  var month = (comparisons && comparisons.month) ? comparisons.month : null;

  var current = (month && month.current) ? month.current.score : null;
  var previous = (month && month.previous) ? month.previous.score : null;

  if (current === null || current === undefined || !isFinite(Number(current))) {

    host.innerHTML =
      '<div class="gauge-empty">' +
      'No audit data for the selected period.' +
      '</div>';

    return;

  }

  current = Number(current);
  previous = (previous === null || previous === undefined || !isFinite(Number(previous)))
    ? null
    : Number(previous);

  var cur = gaugePct(current);
  var diff = previous === null ? null : Math.round((current - previous) * 100) / 100;
  var diffPct = (diff === null || !previous) ? null : Math.round(diff / previous * 1000) / 10;

  var parts = [];

  /* ---------- 1) busur: track tipis + segmen standard ---------- */

  parts.push('<div class="gauge-figure">');

  parts.push('<svg viewBox="0 0 ' + GAUGE_W + " " + GAUGE_H + '" ' +
    'class="gauge-svg" role="img" ' +
    'aria-label="This month ' + current.toFixed(2) + ' of 5">');

  parts.push('<path d="' + gaugeArc(GAUGE_CX, GAUGE_CY, GAUGE_R_OUT, GAUGE_R_IN, 0, 1) +
    '" fill="#F0E9F1"/>');

  GAUGE_SEGS.forEach(function(seg) {

    var from = Math.min(seg.from, cur);
    var to = Math.min(seg.to, cur);

    if (to <= from) return;

    parts.push('<path d="' +
      gaugeArc(GAUGE_CX, GAUGE_CY, GAUGE_R_OUT, GAUGE_R_IN, from, to) +
      '" fill="' + seg.color + '"/>');

  });

  /* skor dominan, tanpa tick di sekeliling busur */
  parts.push('<text x="' + GAUGE_CX + '" y="96" text-anchor="middle" ' +
    'class="gauge-value-svg" fill="' + gaugeColor(current) + '">' +
    current.toFixed(2) +
    '<tspan class="gauge-outof-svg" dx="4">/ 5</tspan></text>');

  parts.push('<text x="' + GAUGE_CX + '" y="122" text-anchor="middle" ' +
    'class="gauge-grade-svg">' + gaugeEsc(dashboardGrade(current)) + '</text>');

  parts.push('</svg>');

  parts.push('</div>');

  /* ---------- 2) blok meta: delta, lalu periode ---------- */

  parts.push('<div class="gauge-meta">');

  if (diff !== null) {

    var arrow = diff > 0 ? "\u25B2" : (diff < 0 ? "\u25BC" : "\u25AC");

    var cls = diff > 0 ? "gauge-delta--up" : (diff < 0 ? "gauge-delta--down" : "gauge-delta--flat");

    var pctTxt = (diffPct !== null && isFinite(diffPct))
      ? '<span class="gauge-delta-pct">(' + (diffPct > 0 ? "+" : "") + diffPct + '%)</span>'
      : "";

    parts.push('<div class="gauge-delta ' + cls + '">' +
      '<span>' + arrow + " " + (diff > 0 ? "+" : "") + diff.toFixed(2) + '</span>' +
      pctTxt +
      '</div>');

  } else {

    parts.push('<div class="gauge-delta gauge-delta--flat">' +
      '<span>&#8212;</span></div>');

  }

  var curMonthTxt = (month && month.currentMonth)
    ? matrixMonthShort(month.currentMonth) + " " + String(month.currentMonth).slice(0, 4)
    : "\u2014";

  var curCountTxt = (month && month.current && isFinite(Number(month.current.auditCount)))
    ? " \u00B7 " + Number(month.current.auditCount) + " audits"
    : "";

  var lowSample = (month && month.sampleSufficient === false);

  var prevMonthTxt = (month && month.previousMonth)
    ? matrixMonthShort(month.previousMonth) + " " + String(month.previousMonth).slice(0, 4)
    : "\u2014";

  var prevCountTxt = (month && month.previous && isFinite(Number(month.previous.auditCount)))
    ? " \u00B7 " + Number(month.previous.auditCount) + " audits"
    : "";

  parts.push('<div class="gauge-periods">');

  parts.push('<div class="gauge-period' + (lowSample ? " is-low" : "") + '">' +
    '<span class="gauge-period-label">THIS MONTH</span>' +
    '<span class="gauge-period-value">' + curMonthTxt + curCountTxt +
    (lowSample ? " \u00B7 low sample" : "") + '</span>' +
    '</div>');

  parts.push('<div class="gauge-period is-muted">' +
    '<span class="gauge-period-label">LAST MONTH</span>' +
    '<span class="gauge-period-value">' + prevMonthTxt + prevCountTxt +
    (previous === null ? " \u00B7 &#8212;" : " \u00B7 " + previous.toFixed(2) + " / 5") +
    '</span>' +
    '</div>');

  parts.push('</div>');

  parts.push('</div>');

  host.innerHTML = parts.join("");

}


/* =========================================================
   MONTHLY MATRIX TABLES (TABLE A & B)
   ========================================================= */

var MATRIX_MONTHS = {
  "01": "JAN", "02": "FEB", "03": "MAR", "04": "APR",
  "05": "MEI", "06": "JUN", "07": "JUL", "08": "AGU",
  "09": "SEP", "10": "OKT", "11": "NOV", "12": "DES"
};

function matrixMonthShort(yyyyMm) {

  return MATRIX_MONTHS[String(yyyyMm).slice(5, 7)] || String(yyyyMm).slice(5, 7);

}

function matrixYearsOf(months) {

  var years = [];

  months.forEach(function(m) {

    var y = String(m).slice(0, 4);

    if (years.indexOf(y) === -1) years.push(y);

  });

  return years;

}

function matrixMonthsIn(months, year) {

  return months.filter(function(m) {
    return String(m).slice(0, 4) === year;
  });

}

function matrixCell(value) {

  if (value === null || value === undefined || !isFinite(Number(value))) {

    return '<td class="mx-cell mx-empty">&#8212;</td>';

  }

  var grade = dashboardGrade(value);

  var cls = {
    "HIGH PASS":        "mx-ex",
    "MIDDLE PASS":      "mx-good",
    "BORDERLINE PASS":  "mx-bd",
    "MIDDLE FAIL":      "mx-ni",
    "STRONG FAIL":      "mx-fl"
  }[grade] || "";

  return '<td class="mx-cell ' + cls + '" title="' + grade + '">' +
    Number(value).toFixed(2) + "</td>";

}

function matrixPercentCell(value) {

  if (value === null || value === undefined || !isFinite(Number(value))) {

    return '<td class="mx-cell mx-empty">&#8212;</td>';

  }

  var grade = dashboardGrade(value);

  var cls = {
    "HIGH PASS":        "mx-ex",
    "MIDDLE PASS":      "mx-good",
    "BORDERLINE PASS":  "mx-bd",
    "MIDDLE FAIL":      "mx-ni",
    "STRONG FAIL":      "mx-fl"
  }[grade] || "";

  return '<td class="mx-cell ' + cls + '" title="' + grade + '">' +
    (Number(value) / 5 * 100).toFixed(1) + "%</td>";

}

function matrixHead(months, firstCols) {

  var years = matrixYearsOf(months);

  var html = [];

  html.push("<thead>");

  /* baris 1: label kolom + grup tahun */
  html.push("<tr>");

  firstCols.forEach(function(col) {

    html.push('<th class="' + col.cls + '" rowspan="2">' + col.label + "</th>");

  });

  years.forEach(function(y) {

    html.push('<th class="mx-year" colspan="' + matrixMonthsIn(months, y).length + '">' +
      y + "</th>");

  });

  html.push("</tr>");

  /* baris 2: nama bulan */
  html.push("<tr>");

  months.forEach(function(m) {

    html.push("<th>" + matrixMonthShort(m) + "</th>");

  });

  html.push("</tr></thead>");

  return html.join("");

}

function renderItemMatrix(matrix) {

  var host = document.getElementById("itemMatrix");

  if (!host) return;

  if (!matrix || !matrix.groups || !matrix.groups.length) {

    host.innerHTML = createNoDataState(
      "No matrix data",
      "No audit records for the selected filters."
    );

    return;

  }

  var months = matrix.months || [];

  if (!months.length) {

    host.innerHTML = createNoDataState(
      "No matrix data",
      "No audit records for the selected filters."
    );

    return;

  }

  var html = ['<table class="mx-table mx-with-cat">'];

  html.push(matrixHead(months, [
    { cls: "mx-cat",  label: "KATEGORI" },
    { cls: "mx-item", label: "PRODUCT / ITEM" }
  ]));

  html.push("<tbody>");

  matrix.groups.forEach(function(group) {

    group.items.forEach(function(row, ri) {

      html.push("<tr>");

      if (ri === 0) {

        html.push('<td class="mx-cat" rowspan="' + group.items.length + '">' +
          escapeHtml(group.product) + "</td>");

      }

      html.push('<td class="mx-item">' + escapeHtml(row.item) + "</td>");

      months.forEach(function(m) {
        html.push(matrixCell(row.scores ? row.scores[m] : null));
      });

      html.push("</tr>");

    });

  });

  html.push("</tbody></table>");

  host.innerHTML = html.join("");

}

function renderBranchMatrix(matrix) {

  var host = document.getElementById("branchMatrix");

  if (!host) return;

  if (!matrix || !matrix.branches || !matrix.branches.length) {

    host.innerHTML = createNoDataState(
      "No matrix data",
      "No audit records for the selected filters."
    );

    return;

  }

  var months = [];

  var years = Object.keys(matrix.years || {}).sort();

  years.forEach(function(y) {

    (matrix.years[y] || []).forEach(function(m) {
      months.push(m);
    });

  });

  if (!months.length) {

    host.innerHTML = createNoDataState(
      "No matrix data",
      "No audit records for the selected filters."
    );

    return;

  }

  var html = ['<table class="mx-table">'];

  html.push(matrixHead(months, [
    { cls: "mx-item mx-first", label: "OUTLET / RESTO" }
  ]));

  html.push("<tbody>");

  matrix.branches.forEach(function(row) {

    html.push("<tr>");

    html.push('<td class="mx-item mx-first">' + escapeHtml(row.branch) + "</td>");

    months.forEach(function(m) {
      html.push(matrixPercentCell(row.scores ? row.scores[m] : null));
    });

    html.push("</tr>");

  });

  html.push("</tbody></table>");

  host.innerHTML = html.join("");

}


/* =========================================================
   RENDER ALL
   ========================================================= */

function renderDashboard(
  data
) {

  if (!data) {

    return;

  }


  renderOverview(
    data.overview
  );


  renderAttention(
    data.painPoints
  );


  renderPeriodGauge(
    data.comparisons
  );


  renderItemMatrix(
    data.monthlyItemMatrix
  );


  renderBranchMatrix(
    data.monthlyBranchMatrix
  );


  renderProducts(
    data.products
  );


  renderItems(
    data.items
  );


  renderOutlets(
    data.outlets
  );


  renderRecentAudits(
    data.audits
  );


  /*
   * Charts are intentionally separated.
   */

  renderCharts(
    data
  );

}


/* =========================================================
   RENDER CHARTS
   ========================================================= */

function renderCharts(
  data
) {

  if (
    !data
  ) {

    return;

  }


  if (
    !DashboardState.chartsReady
  ) {

    return;

  }


  renderQualityTrend(
    getSelectedTrend()
  );


  renderGradeDistribution(
    data.gradeDistribution
  );


  renderProductTrendChart(
    data.productTrend || {},
    getSelectedTrend()
  );

}


/* =========================================================
   OVERVIEW
   ========================================================= */

function renderOverview(
  overview
) {

  if (!overview) {

    return;

  }


  const score =
    Number(
      overview.score
    );


  const scorePercent =
    overview.scorePercent !== undefined &&
    overview.scorePercent !== null

      ? Number(
          overview.scorePercent
        )

      : (
          isFinite(score)
            ? score / 5 * 100
            : null
        );


  setText(
    "overallScore",
    isFinite(score)
      ? formatScore(score) + " / 5"
      : "\u2014"
  );


  setText(
    "overallScorePercent",
    isFinite(scorePercent)
      ? formatPercent(scorePercent)
      : "\u2014"
  );


  setText(
    "overallGrade",
    overview.grade ||
    dashboardGrade(score)
  );


  setText(
    "overallScoreLikert",
    "Overall product audit quality"
  );


  setText(
    "failRate",
    formatPercent(
      overview.underBorderlineRate
    )
  );


  setText(
    "underBorderlineCount",
    isFinite(Number(overview.underBorderlineCount))
      ? formatNumber(overview.underBorderlineCount) + " audits below borderline"
      : (overview.underBorderlineCount ? String(overview.underBorderlineCount) : "\u2014")
  );


  applyGradeClass(
    document.getElementById(
      "overallGrade"
    ),
    overview.grade
  );


  renderKpiProductList();

}


/* =========================================================
   QUALITY ATTENTION KPI
   ========================================================= */

function renderQualityAttentionKPI() {

  const items =
    DashboardState.data &&
    Array.isArray(
      DashboardState.data.painPoints
    )
      ? DashboardState.data.painPoints
      : [];


  if (!items.length) {

    setText(
      "attentionAttribute",
      "\u2014"
    );


    setText(
      "attentionScore",
      "\u2014"
    );


    setText(
      "attentionDescription",
      "No current quality issue identified."
    );


    return;

  }


  const attention =
    items
      .slice()
      .sort(
        function(a, b) {

          return (
            Number(
              b.attentionScore || 0
            ) -
            Number(
              a.attentionScore || 0
            )
          );

        }
      )[0];


  setText(
    "attentionAttribute",
    attention.attribute ||
    "\u2014"
  );


  setText(
    "attentionScore",
    formatScore(
      attention.score
    ) +
    " / 5 \u00b7 " +
    (
      attention.grade ||
      dashboardGrade(
        attention.score
      )
    )
  );


  setText(
    "attentionDescription",
    getAttentionDescription(
      attention
    )
  );

}


/* =========================================================
   QUALITY ATTENTION TABLE
   ========================================================= */

function renderAttention(
  painPoints
) {

  const container =
    document.getElementById(
      "attentionTable"
    );


  if (!container) {

    return;

  }


  if (
    !Array.isArray(
      painPoints
    ) ||
    !painPoints.length
  ) {

    container.innerHTML =
      createNoDataState(
        "No quality attention",
        "No quality attributes require attention under the current filters."
      );

    return;

  }


  const rows =
    painPoints
      .map(
        function(item, index) {

          const score =
            Number(
              item.score || 0
            );


          const scorePercent =
            item.scorePercent !== undefined &&
            item.scorePercent !== null

              ? Number(
                  item.scorePercent
                )

              : score / 5 * 100;


          return `
            <tr
              class="clickable-row attention-row${index === 0 ? ' attention-row--top' : ''}"
              onclick="openAttentionDetail(${index})"
            >
              <td class="rank-cell">${index + 1}</td>

              <td>
                <span class="table-primary">${escapeHtml(item.attribute || "\u2014")}</span>
              </td>

              <td class="attention-score-cell">
                <span class="attention-score-main ${getScoreClass(score)}">${formatScore(score)} / 5</span>
                <br>
                <span class="attention-score-pct">${formatPercent(scorePercent)}</span>
                <div class="attention-score-bar-wrap">
                  <div class="attention-score-bar ${getScoreClass(score)}" style="width:${Math.min(100,scorePercent).toFixed(1)}%"></div>
                </div>
              </td>

              <td>${createGradeBadge(item.grade || dashboardGrade(score))}</td>

              <td class="attention-obs">
                ${formatNumber(item.observations)}
              </td>

              <td class="attention-low-signal">
                <span class="attention-low-pct">${formatPercent(item.lowScoreRate)}</span>
                <br>
                <span class="attention-low-label">low-score rate</span>
              </td>

              <td>${(function(){
                var s = Number(item.attentionScore || 0);
                var total = painPoints.length;
                var label, cls;
                if (index === 0) { label = "\u25cf HIGH"; cls = "attention-pri--high"; }
                else if (index < Math.ceil(total / 2)) { label = "\u25cf MODERATE"; cls = "attention-pri--moderate"; }
                else { label = "\u25cf LOW"; cls = "attention-pri--low"; }
                return '<span class="attention-priority-badge ' + cls + '" title="Score: ' + s.toFixed(3) + '">' + label + '</span>';
              })()}</td>
            </tr>
          `;

        }
      )
      .join("");


  container.innerHTML = `

    <div class="table-scroll">

      <table class="data-table">

        <thead>

          <tr>
          <th>#</th>
          <th>Attribute</th>
          <th>Quality Score</th>
          <th>Status</th>
          <th>Observations</th>
          <th>Low-Score Signal</th>
          <th>Priority</th>
          </tr>

        </thead>


        <tbody>

          ${rows}

        </tbody>

      </table>

    </div>

  `;

}


/* =========================================================
   PRODUCT PERFORMANCE
   ========================================================= */

function renderProducts(products) {

  var container = document.getElementById("productTable");
  if (!container) return;

  if (!Array.isArray(products) || !products.length) {
    container.innerHTML = createNoDataState("No product data", "There is no product audit data for the selected filters.");
    return;
  }

  var sorted = products.slice().sort(function(a, b) {
    return Number(b.score || 0) - Number(a.score || 0);
  });

  var rows = sorted.map(function(product, index) {
    var score   = Number(product.score || 0);
    var percent = (product.scorePercent !== undefined && product.scorePercent !== null)
      ? Number(product.scorePercent)
      : score / 5 * 100;
    var scoreClass = getScoreClass(score);

    // Score cell: big bold number + small percentage below
    var scoreHtml =
      '<span class="prod-score-main ' + scoreClass + '">' + formatScore(score) + '</span>' +
      '<span class="prod-score-pct">' + formatPercent(percent) + '</span>';

    return '<tr class="clickable-row" onclick="openProductDetail(' + index + ')">' +
      '<td class="rank-cell">' + (index + 1) + '</td>' +
      '<td><span class="table-primary prod-name">' + escapeHtml(product.product || '\u2014') + '</span></td>' +
      '<td class="prod-score-cell">' + scoreHtml + '</td>' +
      '<td>' + createGradeBadge(product.grade || dashboardGrade(score)) + '</td>' +
      '<td class="prod-audits-cell">' + formatNumber(product.audits) + '</td>' +
      '</tr>';
  }).join('');

  container.innerHTML =
    '<div class="table-scroll">' +
      '<table class="data-table product-ranking-table">' +
        '<thead><tr>' +
          '<th style="width:36px">#</th>' +
          '<th>Product</th>' +
          '<th style="width:110px">Score</th>' +
          '<th style="width:110px">Grade</th>' +
          '<th style="width:60px;text-align:center">Audits</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}


/* =========================================================
   ITEM PERFORMANCE (level 2)
   ========================================================= */

function renderItems(items) {

  var container = document.getElementById("itemTable");
  if (!container) return;

  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = createNoDataState("No item data", "There is no item audit data for the selected filters.");
    return;
  }

  var sorted = items.slice().sort(function(a, b) {
    return Number(b.score || 0) - Number(a.score || 0);
  });

  DashboardState.sortedItems = sorted;

  var rows = sorted.map(function(item, index) {
    var score   = Number(item.score || 0);
    var percent = (item.scorePercent !== undefined && item.scorePercent !== null)
      ? Number(item.scorePercent)
      : score / 5 * 100;
    var scoreClass = getScoreClass(score);

    var scoreHtml =
      '<span class="prod-score-main ' + scoreClass + '">' + formatScore(score) + '</span>' +
      '<span class="prod-score-pct">' + formatPercent(percent) + '</span>';

    return '<tr class="clickable-row" onclick="openItemDetail(' + index + ')">' +
      '<td class="rank-cell">' + (index + 1) + '</td>' +
      '<td><span class="table-primary prod-name">' + escapeHtml(item.item || '\\u2014') + '</span></td>' +
      '<td>' + escapeHtml(item.product || '\\u2014') + '</td>' +
      '<td class="prod-score-cell">' + scoreHtml + '</td>' +
      '<td>' + createGradeBadge(item.grade || dashboardGrade(score)) + '</td>' +
      '<td class="prod-audits-cell">' + formatNumber(item.audits) + '</td>' +
      '</tr>';
  }).join('');

  container.innerHTML =
    '<div class="table-scroll">' +
      '<table class="data-table product-ranking-table">' +
        '<thead><tr>' +
          '<th style="width:36px">#</th>' +
          '<th>Item</th>' +
          '<th>Product</th>' +
          '<th style="width:110px">Score</th>' +
          '<th style="width:110px">Grade</th>' +
          '<th style="width:60px;text-align:center">Audits</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}


/* =========================================================
   ITEM DETAIL MODAL
   ========================================================= */

function openItemDetail(index) {

  var items = DashboardState.sortedItems ||
    (DashboardState.data && DashboardState.data.items);

  var item = items && items[index];
  if (!item) return;

  var parameters = Array.isArray(item.parameters) ? item.parameters : [];

  var parameterRows = parameters.map(function(parameter) {
    var pScore = Number(parameter.score || 0);
    return '<tr>' +
      '<td>' + escapeHtml(parameter.attribute || '\\u2014') + '</td>' +
      '<td><strong>' + formatScore(pScore) + '</strong></td>' +
      '<td>' + createGradeBadge(parameter.grade || dashboardGrade(pScore)) + '</td>' +
      '<td>' + formatNumber(parameter.observations) + '</td>' +
      '</tr>';
  }).join('');

  var html =
    '<div class="detail-header">' +
      '<div class="detail-score ' + getScoreClass(Number(item.score || 0)) + '">' +
        formatScore(Number(item.score || 0)) +
      '</div>' +
      '<div class="detail-meta">' +
        '<div class="detail-title">' + escapeHtml(item.item || '\\u2014') + '</div>' +
        '<div class="detail-subtitle">' + escapeHtml(item.product || '') + '</div>' +
      '</div>' +
      '<div>' + createGradeBadge(item.grade || dashboardGrade(Number(item.score || 0))) + '</div>' +
    '</div>' +
    '<div class="detail-stats">' +
      '<div class="detail-stat"><span class="detail-stat-value">' + formatNumber(item.audits) + '</span><span class="detail-stat-label">Item Audits</span></div>' +
      '<div class="detail-stat"><span class="detail-stat-value">' + formatNumber(parameters.length) + '</span><span class="detail-stat-label">Parameters</span></div>' +
      '<div class="detail-stat"><span class="detail-stat-value">' + formatPercent(item.scorePercent) + '</span><span class="detail-stat-label">Score %</span></div>' +
    '</div>' +
    (parameterRows
      ? '<table class="data-table"><thead><tr>' +
          '<th>Parameter</th><th>Score</th><th>Grade</th><th>Observations</th>' +
        '</tr></thead><tbody>' + parameterRows + '</tbody></table>'
      : createNoDataState("No parameter data", ""));

  openModal(
    "ITEM DETAIL",
    item.item || "Item",
    html
  );
}


/* =========================================================
   OUTLET PERFORMANCE
   ========================================================= */

function renderOutlets(
  outlets
) {

  const container =
    document.getElementById(
      "outletTable"
    );


  if (!container) {

    return;

  }


  if (
    !Array.isArray(outlets) ||
    !outlets.length
  ) {

    container.innerHTML =
      createNoDataState(
        "No outlet data",
        "There is no outlet audit data for the selected filters."
      );

    return;

  }


  const sorted =
    outlets
      .slice()
      .sort(
        function(a, b) {
          return (
            Number(b.score || 0) -
            Number(a.score || 0)
          );
        }
      );


  // Pre-compute attention per outlet from data.audits
  const auditsByOutlet = {};
  var allAudits = DashboardState.data && Array.isArray(DashboardState.data.audits)
    ? DashboardState.data.audits : [];
  allAudits.forEach(function(a) {
    if (!a.outlet) return;
    if (!auditsByOutlet[a.outlet]) auditsByOutlet[a.outlet] = [];
    auditsByOutlet[a.outlet].push(a);
  });

  function outletAttentionLabel(outletName) {
    var oas = auditsByOutlet[outletName] || [];
    var attrTotals = {};
    var attrCounts = {};
    oas.forEach(function(a) {
      if (!Array.isArray(a.attributes)) return;
      a.attributes.forEach(function(attr) {
        if (attr.score === null || attr.score === undefined || isNaN(Number(attr.score))) return;
        attrTotals[attr.attribute] = (attrTotals[attr.attribute] || 0) + Number(attr.score);
        attrCounts[attr.attribute] = (attrCounts[attr.attribute] || 0) + 1;
      });
    });
    var keys = Object.keys(attrTotals);
    if (!keys.length) return "\u2014";
    var minAvg = Infinity;
    keys.forEach(function(k) { minAvg = Math.min(minAvg, attrTotals[k] / attrCounts[k]); });
    var worst = keys.filter(function(k) { return Math.abs(attrTotals[k] / attrCounts[k] - minAvg) < 0.005; });
    return worst.map(function(k) {
      return escapeHtml(k) + " (" + formatScore(attrTotals[k] / attrCounts[k]) + ")";
    }).join(", ");
  }


  const rows =
    sorted
      .map(
        function(outlet, index) {

          const score = Number(outlet.score || 0);

          const percent =
            outlet.scorePercent !== undefined && outlet.scorePercent !== null
              ? Number(outlet.scorePercent)
              : score / 5 * 100;

          const attention = outletAttentionLabel(outlet.outlet);

          return `
            <tr
              class="clickable-row outlet-row"
              onclick="openOutletDetail(${index})"
            >
              <td class="rank-cell">${String(index + 1).padStart(2, "0")}</td>

              <td>
                <span class="table-primary">${escapeHtml(outlet.outlet || "\u2014")}</span>
              </td>

              <td class="outlet-score-cell">
                <span class="outlet-score-main ${getScoreClass(score)}">${formatScore(score)} / 5</span><br>
                <span class="outlet-score-pct">${formatPercent(percent)}</span>
                <div class="outlet-score-bar-wrap">
                  <div class="outlet-score-bar ${getScoreClass(score)}" style="width:${Math.min(100, percent).toFixed(1)}%"></div>
                </div>
              </td>

              <td>${createGradeBadge(outlet.grade || dashboardGrade(score))}</td>

              <td class="outlet-audits-cell">${formatNumber(outlet.audits)}</td>

              <td class="outlet-attention-cell">${attention}</td>

              <td class="outlet-trend-cell">\u2014</td>

            </tr>
          `;

        }
      )
      .join("");


  container.innerHTML = `

    <div class="table-scroll">

      <table class="data-table">

        <thead>

          <tr>
            <th>#</th>
            <th>Outlet</th>
            <th>Score</th>
            <th>Grade</th>
            <th>Audits</th>
            <th>Attention</th>
            <th>Trend</th>
          </tr>

        </thead>


        <tbody>

          ${rows}

        </tbody>

      </table>

    </div>

  `;

}


/* =========================================================
   RECENT AUDITS
   ========================================================= */

function renderRecentAudits(audits) {

  var container = document.getElementById("recentAuditTable");
  if (!container) return;

  /*
   * STAGED LOAD v1.2: audits === null berarti
   * masih di-fetch lazy — tampilkan skeleton,
   * JANGAN "No audit records".
   */

  if (audits === null || audits === undefined) {
    container.innerHTML = '<tr><td colspan="8" class="table-loading">Loading audit records\u2026</td></tr>';
    DashboardState.lastRenderedAudits = [];
    return;
  }

  var safeAudits = Array.isArray(audits) ? audits : [];
  DashboardState.lastRenderedAudits = safeAudits;

  if (!safeAudits.length) {
    container.innerHTML = createNoDataState("No audit records", "No completed product audits were found.");
    return;
  }

  var EYE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

  var PAGE_SIZE   = 25;
  var sortCol     = -1;
  var sortAsc     = true;
  var searchTerm  = "";
  var currentPage = 1;
  var currentData = safeAudits.slice();

  function buildRows(data) {
    return data.map(function(audit) {
      var score = Number(audit.score || 0);
      var docs  = (audit.dokumentasi || audit.documentation || "")
        .split(",")
        .map(function(d) { return d.trim(); })
        .filter(function(d) { return d.length > 0; })
        .map(function(d, di) {
          return '<a href="' + escapeHtml(d) + '" target="_blank" class="doc-link eye-link" title="Lihat foto ' + (di+1) + '">' + EYE_ICON + '</a>';
        }).join(" ");
      return '<tr>' +
        '<td class="table-primary">' + escapeHtml(audit.auditId || '\u2014') + '</td>' +
        '<td>' + formatDateTime(audit.timestamp) + '</td>' +
        '<td>' + escapeHtml(audit.outlet  || '\u2014') + '</td>' +
        '<td>' + escapeHtml(audit.product || '\u2014') + '</td>' +
        '<td class="score-cell ' + getScoreClass(score) + '">' + formatScore(score) + '</td>' +
        '<td>' + createGradeBadge(audit.grade || dashboardGrade(score)) + '</td>' +
        '<td class="feedback-cell">' + escapeHtml(audit.feedback || audit.catatan || "") + '</td>' +
        '<td>' + (docs || '\u2014') + '</td>' +
        '</tr>';
    }).join("");
  }

  function getFiltered() {
    if (!searchTerm) return currentData;
    var q = searchTerm.toLowerCase();
    return currentData.filter(function(a) {
      return [a.auditId, a.outlet, a.product, a.feedback, a.catatan, a.grade]
        .some(function(v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  function buildPagination(total, page) {
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (totalPages <= 1) return '';
    var start = (page - 1) * PAGE_SIZE + 1;
    var end   = Math.min(page * PAGE_SIZE, total);

    // Page range: show max 5 page buttons around current
    var pages = [];
    var range = 2;
    for (var p = Math.max(1, page - range); p <= Math.min(totalPages, page + range); p++) {
      pages.push(p);
    }

    var btns = pages.map(function(p) {
      var active = p === page ? ' audit-page-active' : '';
      return '<button class="audit-page-btn' + active + '" data-page="' + p + '">' + p + '</button>';
    }).join('');

    var prevDisabled = page <= 1 ? ' disabled' : '';
    var nextDisabled = page >= totalPages ? ' disabled' : '';

    return '<div class="audit-pagination">' +
      '<span class="audit-page-info">Showing ' + start + '-' + end + ' of ' + total + ' records</span>' +
      '<div class="audit-page-controls">' +
        '<button class="audit-page-btn audit-page-nav" data-page="' + (page-1) + '"' + prevDisabled + '>&lsaquo; Prev</button>' +
        btns +
        '<button class="audit-page-btn audit-page-nav" data-page="' + (page+1) + '"' + nextDisabled + '>Next &rsaquo;</button>' +
      '</div>' +
    '</div>';
  }

  function rerender() {
    var filtered   = getFiltered();
    var total      = filtered.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = 1;

    var pageData = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    var tbody = container.querySelector("tbody");
    var count = container.querySelector("#auditRecordCount");
    var pager = container.querySelector("#auditPagination");

    if (tbody) tbody.innerHTML = buildRows(pageData);
    if (count) count.textContent = total + "/" + safeAudits.length + " records";
    if (pager) {
      pager.innerHTML = buildPagination(total, currentPage);
      // Attach page button events
      pager.querySelectorAll(".audit-page-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          if (this.disabled) return;
          var p = parseInt(this.getAttribute("data-page"));
          if (!isNaN(p) && p >= 1 && p <= totalPages) {
            currentPage = p;
            rerender();
          }
        });
      });
    }
  }

  var headers  = ["Audit ID","Timestamp","Outlet","Product","Score","Grade","Feedback","Photos"];
  var colKeys  = ["auditId","timestamp","outlet","product","score","grade","feedback","dokumentasi"];
  var theadCells = headers.map(function(h, i) {
    var s = (i < 7) ? ' class="sortable"' : "";
    return "<th" + s + ' data-col="' + i + '">' + h + "</th>";
  }).join("");

  container.innerHTML =
    '<div class="audit-search-bar">' +
      '<input type="text" class="audit-search-input" placeholder="Search audit ID, product, feedback..." id="auditSearchInput">' +
      '<span class="audit-record-count" id="auditRecordCount">' + safeAudits.length + '/' + safeAudits.length + ' records</span>' +
    '</div>' +
    '<div class="table-scroll">' +
      '<table class="data-table" id="auditRichTable">' +
        '<thead><tr>' + theadCells + '</tr></thead>' +
        '<tbody></tbody>' +
      '</table>' +
    '</div>' +
    '<div id="auditPagination"></div>';

  // Search
  var searchInput = container.querySelector("#auditSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", function() {
      searchTerm  = this.value;
      currentPage = 1;
      rerender();
    });
  }

  // Sort
  container.querySelectorAll("th.sortable").forEach(function(th) {
    th.addEventListener("click", function() {
      var col = parseInt(this.getAttribute("data-col"));
      if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
      container.querySelectorAll("th").forEach(function(t) { t.classList.remove("sort-asc","sort-desc"); });
      this.classList.add(sortAsc ? "sort-asc" : "sort-desc");
      var key = colKeys[col];
      currentData = safeAudits.slice().sort(function(a, b) {
        var av = String(a[key] || "");
        var bv = String(b[key] || "");
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      currentPage = 1;
      rerender();
    });
  });

  rerender();
}


/* =========================================================
   QUALITY TREND
   ========================================================= */

function changeTrendMode(
  mode
) {

  const validModes =
    [
      "allTime",
      "daily",
      "weekly",
      "monthly"
    ];


  if (
    validModes.indexOf(mode) === -1
  ) {

    mode =
      "allTime";

  }


  DashboardState.trendMode =
    mode;


  updatePeriodButtons(
    "trendPeriodSwitcher",
    mode
  );


  renderQualityTrend(
    getSelectedTrend()
  );

}


function getSelectedTrend() {

  if (
    !DashboardState.data
  ) {

    return [];

  }


  const modes =
    DashboardState.data.trendModes;


  if (
    modes &&
    Array.isArray(
      modes[
        DashboardState.trendMode
      ]
    )
  ) {

    return modes[
      DashboardState.trendMode
    ];

  }


  if (
    Array.isArray(
      DashboardState.data.trend
    )
  ) {

    return DashboardState.data.trend;

  }


  return [];

}


function renderQualityTrend(
  trend
) {

  const container =
    document.getElementById(
      "qualityTrendChart"
    );


  if (!container) {

    return;

  }


  if (
    !DashboardState.chartsReady
  ) {

    container.innerHTML = `

      <div class="chart-loading">

        Chart library is loading...

      </div>

    `;

    return;

  }


  if (
    !Array.isArray(trend) ||
    !trend.length
  ) {

    container.innerHTML =
      createNoDataState(
        "No trend data",
        "There is not enough audit data to display this trend."
      );

    return;

  }


  const normalized =
    normalizeTrend(
      trend
    );


  if (!normalized.length) {

    container.innerHTML =
      createNoDataState(
        "No trend data",
        "Trend data could not be interpreted."
      );

    return;

  }


  const scores = normalized.map(function(item) {
    return Number(item.score);
  });

  // SMA window=3
  const smaValues = scores.map(function(_, i) {
    const window = scores.slice(Math.max(0, i - 2), i + 1);
    return window.reduce(function(a, b) { return a + b; }, 0) / window.length;
  });

  const dataTable =
    new google.visualization.DataTable();


  dataTable.addColumn(
    "string",
    "Period"
  );


  dataTable.addColumn(
    "number",
    "Quality Score"
  );


  dataTable.addColumn(
    {
      type: "string",
      role: "style"
    }
  );


  dataTable.addColumn(
    {
      type: "string",
      role: "annotation"
    }
  );


  dataTable.addColumn(
    {
      type: "string",
      role: "tooltip"
    }
  );


  dataTable.addColumn(
    "number",
    "SMA"
  );


  normalized.forEach(
    function(item, i) {

      const score = Number(item.score);

      dataTable.addRow(
        [

          trendDisplayLabel(
            item
          ),

          score,

          getGradeHexColor(score),

          formatScore(score),

          createTrendTooltip(
            item
          ),

          smaValues[i]

        ]
      );

    }
  );


  const chart =
    new google.visualization.ComboChart(
      container
    );


  chart.draw(
    dataTable,
    {

      backgroundColor:
        "transparent",


      seriesType:
        "bars",


      series: {
        1: {
          type: "line",
          color: "#572B7A",
          lineWidth: 2,
          pointSize: 4,
          pointShape: "circle"
        }
      },


      legend:
        {
          position:
            "none"
        },


      chartArea:
        {
          left:
            55,

          top:
            25,

          right:
            20,

          bottom:
            55,

          width:
            "88%",

          height:
            "75%"
        },


      hAxis:
        {

          textStyle:
            {
              color:
                "#8B7E92",

              fontSize:
                10
            },

          slantedText:
            normalized.length > 12,

          slantedTextAngle:
            35

        },


      vAxis:
        {

          viewWindow:
            {
              min:
                0,

              max:
                5
            },

          ticks:
            [
              0,
              1,
              2,
              3,
              4,
              5
            ],

          textStyle:
            {
              color:
                "#8B7E92",

              fontSize:
                10
            }

        },


      bar:
        {
          groupWidth:
            "58%"
        },


      annotations:
        {
          alwaysOutside:
            false,

          stem:
            {
              color:
                "transparent"
            },

          textStyle:
            {
              fontSize:
                9,

              bold:
                true,

              color:
                "#572B7A"
            }
        },


      tooltip:
        {
          textStyle:
            {
              fontSize:
                11
            }
        },


      animation:
        {
          startup:
            true,

          duration:
            450,

          easing:
            "out"
        }

    }
  );

}


/* ---------------------------------------------------------
   GRADE HEX COLOR HELPER
   --------------------------------------------------------- */

function getGradeHexColor(score) {

  var grade = dashboardGrade(score);

  var map = {
    "HIGH PASS":       "#009B72",
    "MIDDLE PASS":     "#0E9AA7",
    "BORDERLINE PASS": "#E58A00",
    "MIDDLE FAIL":     "#E84B16",
    "STRONG FAIL":     "#D92755"
  };

  return map[grade] || "#8A7A90";

}


/* =========================================================
   PRODUCT TREND CHART
   ========================================================= */

function changeProductTrendMode(mode) {

  const validModes = ["allTime", "daily", "weekly", "monthly"];

  if (validModes.indexOf(mode) === -1) {
    mode = "allTime";
  }

  DashboardState.productTrendMode = mode;

  updatePeriodButtons(
    "productTrendPeriodSwitcher",
    mode
  );

  if (DashboardState.data) {
    renderProductTrendChart(
      DashboardState.data.productTrend || {},
      DashboardState.data.trend || []
    );
  }

}


function renderProductTrendChart(productTrend, overallTrend) {

  var container = document.getElementById("productTrendChart");
  if (!container) return;

  if (!DashboardState.chartsReady) {
    container.innerHTML = '<div class="chart-loading">Chart library is loading...</div>';
    return;
  }

  var rawProductNames = Object.keys(productTrend || {});
  if (!rawProductNames.length) {
    container.innerHTML = createNoDataState("No product trend data", "Not enough data to display per-product trend.");
    return;
  }

  // MODE SLICING - group raw {date, score} by mode
  var mode = DashboardState.productTrendMode || "allTime";

  function getWeekKey(dateStr) {
    var d = new Date(dateStr);
    var day = d.getDay(); // 0=Sun
    var diff = (day === 0) ? -6 : 1 - day; // Monday start
    var mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    return mon.toISOString().slice(0,10);
  }
  function getMonthKey(dateStr) { return dateStr.slice(0,7); }
  function getDayKey(dateStr) { return dateStr.slice(0,10); }

  function sliceByMode(points, m) {
    if (m === "allTime") return points; // use raw points as-is (each audit = 1 point)
    var grouped = {};
    points.forEach(function(p) {
      var key = m === "daily"   ? getDayKey(p.date)
              : m === "weekly"  ? getWeekKey(p.date)
              : m === "monthly" ? getMonthKey(p.date)
              : p.date;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(p.score);
    });
    return Object.keys(grouped).sort().map(function(k) {
      var scores = grouped[k];
      var avg = scores.reduce(function(a,b){return a+b;},0) / scores.length;
      return { date: k, score: Math.round(avg*100)/100 };
    });
  }

  // Build sliced data per product
  var sliced = {};
  rawProductNames.forEach(function(pName) {
    var pts = sliceByMode(productTrend[pName] || [], mode);
    if (pts.length) sliced[pName] = pts;
  });

  var productNames = Object.keys(sliced);
  if (!productNames.length) {
    container.innerHTML = createNoDataState("No product trend data", "Not enough data for selected period.");
    return;
  }

  // Build unified date axis
  var dateSet = {};
  productNames.forEach(function(pName) {
    sliced[pName].forEach(function(pt) { dateSet[pt.date] = true; });
  });
  var allDates = Object.keys(dateSet).sort();

  if (!allDates.length) {
    container.innerHTML = createNoDataState("No product trend data", "Not enough data to display per-product trend.");
    return;
  }

  // Product line palette - distinct, strong, non-clash with quality bands
  var palette = [
    "#572B7A",  // purple  (logo)
    "#D6338F",  // magenta
    "#F8C000",  // yellow  (logo)
    "#7B4BC9",  // violet
    "#E84B16",  // red-orange
    "#0E9AA7",  // teal
    "#FF7CBE"   // pink    (logo)
  ];

  var dataTable = new google.visualization.DataTable();
  dataTable.addColumn("string", "Period");
  productNames.forEach(function(pName) { dataTable.addColumn("number", pName); });

  // Quality band columns: floor + ceil pairs for 5 tiers
  // Quality Standard (SOURCE OF TRUTH): HIGH PASS=4.50-5.00, MIDDLE PASS=3.60-4.49,
  //               BORDERLINE PASS=3.00-3.60, MIDDLE FAIL=2.00-3.00, STRONG FAIL=0-2.00
  dataTable.addColumn("number", "HP floor");
  dataTable.addColumn("number", "HP ceil");
  dataTable.addColumn("number", "MP floor");
  dataTable.addColumn("number", "MP ceil");
  dataTable.addColumn("number", "BP floor");
  dataTable.addColumn("number", "BP ceil");
  dataTable.addColumn("number", "MF floor");
  dataTable.addColumn("number", "MF ceil");
  dataTable.addColumn("number", "SF floor");
  dataTable.addColumn("number", "SF ceil");

  var productMaps = {};
  productNames.forEach(function(pName) {
    productMaps[pName] = {};
    sliced[pName].forEach(function(pt) { productMaps[pName][pt.date] = pt.score; });
  });

  allDates.forEach(function(date) {
    var row = [date];
    productNames.forEach(function(pName) {
      var v = productMaps[pName][date];
      row.push(v !== undefined ? v : null);
    });
    // Band pairs [floor, ceil]
    row.push(4.50, 5.00);   // HIGH PASS
    row.push(3.60, 4.49);   // MIDDLE PASS
    row.push(3.00, 3.59);   // BORDERLINE PASS
    row.push(2.00, 2.99);   // MIDDLE FAIL
    row.push(0.00, 1.99);   // STRONG FAIL
    dataTable.addRow(row);
  });

  var seriesConfig = {};
  productNames.forEach(function(_, i) {
    seriesConfig[i] = {
      type: "line",
      color: palette[i % palette.length],
      lineWidth: 2.5,
      pointSize: 4
    };
  });

  var n = productNames.length;

  // Band colors - senada Quality Standard, strong opacity, clearly distinct
  var bandDefs = [
    { color: "#00875A", opacity: 0.22 }, // HIGH PASS - deep green
    { color: "#4DC68C", opacity: 0.18 }, // MIDDLE PASS - light green
    { color: "#F5A623", opacity: 0.20 }, // BORDERLINE PASS - amber/orange
    { color: "#E84B16", opacity: 0.18 }, // MIDDLE FAIL - red-orange
    { color: "#D92755", opacity: 0.20 }  // STRONG FAIL - crimson
  ];

  bandDefs.forEach(function(band, bi) {
    // floor series - invisible baseline
    seriesConfig[n + bi * 2] = {
      type: "area",
      color: band.color,
      lineWidth: 0,
      areaOpacity: 0,
      visibleInLegend: false,
      enableInteractivity: false
    };
    // ceil series - colored fill above floor
    seriesConfig[n + bi * 2 + 1] = {
      type: "area",
      color: band.color,
      lineWidth: 0,
      areaOpacity: band.opacity,
      visibleInLegend: false,
      enableInteractivity: false
    };
  });

  var chart = new google.visualization.ComboChart(container);

  chart.draw(dataTable, {
    backgroundColor: "transparent",
    seriesType: "line",
    series: seriesConfig,
    legend: {
      position: "right",
      textStyle: { fontSize: 11, color: "#2E1440", bold: true }
    },
    chartArea: {
      left: 55, top: 20, right: 160, bottom: 40,
      width: "80%", height: "78%"
    },
    hAxis: {
      textStyle: { color: "#8B7E92", fontSize: 10 },
      slantedText: allDates.length > 12,
      slantedTextAngle: 35
    },
    vAxis: {
      viewWindow: { min: 0, max: 5 },
      ticks: [0, 1, 2, 3, 4, 5],
      textStyle: { color: "#8B7E92", fontSize: 10 }
    },
    tooltip: { textStyle: { fontSize: 11 } },
    animation: { startup: true, duration: 450, easing: "out" }
  });

}


/* =========================================================
   GRADE DISTRIBUTION
   ========================================================= */

function renderGradeDistribution(distribution) {

  var container = document.getElementById("gradeDistributionChart");
  if (!container) return;

  if (!distribution) {
    container.innerHTML = createNoDataState("No grade data", "No grade distribution available.");
    return;
  }

  var GRADES = ["HIGH PASS","MIDDLE PASS","BORDERLINE PASS","MIDDLE FAIL","STRONG FAIL"];
  var COLORS = ["#00875A","#009B72","#E58A00","#E84B16","#D92755"];
  var LABELS = ["High Pass","Middle Pass","Borderline Pass","Middle Fail","Strong Fail"];

  var data = [];
  GRADES.forEach(function(g,i){
    var cnt = Number(distribution[g]||0);
    if(cnt>0) data.push({grade:g, label:LABELS[i], color:COLORS[i], count:cnt});
  });

  if(!data.length){
    container.innerHTML = createNoDataState("No grade data","No completed audits.");
    return;
  }

  var total = data.reduce(function(s,d){return s+d.count;},0);

  // Canvas: donut center, label zones outside left/right
  var W=560, H=320, CX=280, CY=155, R=105, ri=60, GAP=1.5;
  // Label zones: left x<=130, right x>=430
  var LZONE=130, RZONE=430, ROW_H=30;

  function rad(deg){return(deg-90)*Math.PI/180;}
  function pt(r,deg){
    return{
      x:+(CX+r*Math.cos(rad(deg))).toFixed(1),
      y:+(CY+r*Math.sin(rad(deg))).toFixed(1)
    };
  }
  function arcPath(a,b){
    // Single segment full circle: SVG arc can't span 360deg - split into two halves
    if((b-a) >= 359.9){
      var top=pt(R,0), bot=pt(R,180), topi=pt(ri,0), boti=pt(ri,180);
      return["M",top.x,top.y,"A",R,R,0,1,1,bot.x,bot.y,
             "A",R,R,0,1,1,top.x,top.y,
             "M",topi.x,topi.y,"A",ri,ri,0,1,0,boti.x,boti.y,
             "A",ri,ri,0,1,0,topi.x,topi.y,"Z"].join(" ");
    }
    var s=pt(R,a+GAP/2), e=pt(R,b-GAP/2),
        si=pt(ri,b-GAP/2), ei=pt(ri,a+GAP/2);
    var lg=(b-a-GAP)>180?1:0;
    return["M",s.x,s.y,"A",R,R,0,lg,1,e.x,e.y,
           "L",si.x,si.y,"A",ri,ri,0,lg,0,ei.x,ei.y,"Z"].join(" ");
  }

  // Build raw label data first (natural Y from arc midpoint)
  // Single-segment guard: if only 1 grade, line at 3 o'clock
  var singleSegment = (data.length === 1);
  var segs=[], raw=[], cur=0;

  data.forEach(function(d){
    var sw=d.count/total*360, st=cur, en=cur+sw, mid=st+sw/2;
    var pct=(d.count/total*100).toFixed(1)+"%";

    segs.push(
      '<path d="'+arcPath(st,en)+'" fill="'+d.color+'"'+
      ' style="cursor:pointer;transition:filter 0.15s"'+
      ' onmouseover="this.setAttribute(\'filter\',\'brightness(0.85)\')"'+
      ' onmouseout="this.removeAttribute(\'filter\')"'+
      ' onclick="openGradeDetailPopup(\''+d.grade+'\')">' +
      '<title>'+d.label+': '+d.count+' ('+pct+')</title></path>'
    );

    var midPt = pt(R+2, mid);
    // Direction: based on actual X position relative to center
    var isRight = (parseFloat(midPt.x) >= CX);

    raw.push({
      color: d.color, label: d.label, pct: pct,
      arcX: parseFloat(midPt.x), arcY: parseFloat(midPt.y),
      isRight: isRight,
      naturalY: parseFloat(midPt.y)
    });

    cur=en;
  });

  // Separate into left/right groups, sort by natural Y
  var leftItems  = raw.filter(function(x){return !x.isRight;}).sort(function(a,b){return a.naturalY-b.naturalY;});
  var rightItems = raw.filter(function(x){return  x.isRight;}).sort(function(a,b){return a.naturalY-b.naturalY;});

  // Spread labels: bidirectional from center to avoid forward-stacking at bottom
  function spreadY(items) {
    if(!items.length) return;
    // Sort by natural Y (already done before call, but re-sort to be safe)
    items.sort(function(a,b){return a.naturalY-b.naturalY;});
    var mid = Math.floor(items.length/2);
    // Set center item to its natural Y
    items[mid].y = items[mid].naturalY;
    // Spread downward from center
    for(var i=mid+1;i<items.length;i++){
      var minY = items[i-1].y + ROW_H;
      items[i].y = Math.max(items[i].naturalY, minY);
    }
    // Spread upward from center
    for(var i=mid-1;i>=0;i--){
      var maxY = items[i+1].y - ROW_H;
      items[i].y = Math.min(items[i].naturalY, maxY);
    }
    // Clamp to canvas bounds
    for(var i=0;i<items.length;i++){
      items[i].y = Math.max(20, Math.min(H-20, items[i].y));
    }
  }

  leftItems.forEach(function(x){x.y=x.naturalY;});
  rightItems.forEach(function(x){x.y=x.naturalY;});
  spreadY(leftItems);
  spreadY(rightItems);

  // Build label SVG elements
  var lbls=[];
  var allItems = leftItems.concat(rightItems);

  allItems.forEach(function(d){
    var zoneX  = d.isRight ? RZONE : LZONE;
    var textX  = d.isRight ? (RZONE+8) : (LZONE-8);
    var anchor = d.isRight ? "start" : "end";

    lbls.push(
      // line from arc point to zone boundary (same Y as label)
      '<line x1="'+d.arcX+'" y1="'+d.arcY+'"'+
            ' x2="'+zoneX+'" y2="'+d.y+'"'+
            ' stroke="'+d.color+'" stroke-width="1.4" stroke-opacity="0.7"/>'+
      // grade name
      '<text x="'+textX+'" y="'+(d.y-6)+'"'+
            ' text-anchor="'+anchor+'" font-size="9.5" font-weight="700"'+
            ' fill="'+d.color+'">'+d.label+'</text>'+
      // percentage
      '<text x="'+textX+'" y="'+(d.y+9)+'"'+
            ' text-anchor="'+anchor+'" font-size="13" font-weight="800"'+
            ' fill="#2E1440">'+d.pct+'</text>'
    );
  });

  // Center
  var cx=
    '<text x="'+CX+'" y="'+(CY-6)+'" text-anchor="middle"'+
    ' font-size="28" font-weight="800" fill="#2E1440">'+total+'</text>'+
    '<text x="'+CX+'" y="'+(CY+12)+'" text-anchor="middle"'+
    ' font-size="9" font-weight="700" letter-spacing="2" fill="#9C8FA3">AUDITS</text>';

  var svg=
    '<svg viewBox="0 0 '+W+' '+H+'"'+
    ' preserveAspectRatio="xMidYMid meet"'+
    ' style="width:100%;max-height:300px;display:block;">'+
    segs.join('')+lbls.join('')+cx+'</svg>';

  container.style.cssText="width:100%;padding:8px 0;";
  container.innerHTML=svg;
}


/* =========================================================
   FILTERS
   ========================================================= */

function populateFilters(
  metadata
) {

  if (!metadata) {

    return;

  }


  // Date hierarchy multi-select (Year > Month > Day)
  populateDateHierarchy(
    "dateFilter",
    metadata.dates || [],
    DashboardState.filters.dates || []
  );


  // Week ISO 8601 multi-select
  populateWeekFilter(
    "weekFilter",
    metadata.dates || [],
    DashboardState.filters.weeks || []
  );


  populateMultiSelect(
    "outletFilter",
    metadata.outlets || [],
    DashboardState.filters.outlet,
    "All Outlets"
  );


  populateMultiSelect(
    "productFilter",
    metadata.products || [],
    DashboardState.filters.product,
    "All Products"
  );


  populateMultiSelect(
    "itemFilter",
    metadata.items || [],
    DashboardState.filters.item,
    "All Items"
  );


  populateMultiSelect(
    "attributeFilter",
    metadata.attributes || [],
    DashboardState.filters.attribute,
    "All Attributes"
  );


  populateMultiSelect(
    "gradeFilter",
    metadata.grades || [],
    DashboardState.filters.grade,
    "All Grades"
  );

}


function populateSelect(
  elementId,
  values,
  selected,
  defaultLabel,
  formatter
) {

  const select =
    document.getElementById(
      elementId
    );


  if (!select) {

    return;

  }


  select.innerHTML =
    "";


  const defaultOption =
    document.createElement(
      "option"
    );


  defaultOption.value =
    "";


  defaultOption.textContent =
    defaultLabel;


  select.appendChild(
    defaultOption
  );


  (
    Array.isArray(values)
      ? values
      : []
  )
    .filter(
      function(value) {

        return (
          value !== null &&
          value !== undefined &&
          String(value).trim() !== ""
        );

      }
    )
    .forEach(
      function(value) {

        const option =
          document.createElement(
            "option"
          );


        option.value =
          value;


        option.textContent =
          formatter
            ? formatter(value)
            : value;


        if (
          String(value) ===
          String(selected || "")
        ) {

          option.selected =
            true;

        }


        select.appendChild(
          option
        );

      }
    );

}


/* ---------------------------------------------------------
   MULTI-SELECT HELPERS
   --------------------------------------------------------- */

function populateMultiSelect(
  elementId,
  values,
  selectedArr,
  placeholder
) {

  const container =
    document.getElementById(
      elementId
    );


  if (!container) {

    return;

  }


  const selected =
    Array.isArray(selectedArr)
      ? selectedArr
      : [];


  const dropdown =
    container.querySelector(
      ".multi-select-dropdown"
    );


  if (!dropdown) {

    return;

  }


  dropdown.innerHTML = "";

  // Prevent checkbox/option clicks from bubbling to document close handler
  dropdown.addEventListener("click", function(e) { e.stopPropagation(); });


  // "All" option
  const allItem =
    document.createElement("label");

  allItem.className =
    "multi-select-option is-all";

  const allCb =
    document.createElement("input");

  allCb.type = "checkbox";
  allCb.value = "";
  allCb.checked = selected.length === 0;
  allCb.addEventListener("change", function() {
    if (this.checked) {
      dropdown.querySelectorAll(
        "input[type=checkbox]:not(.all-cb)"
      ).forEach(function(c) {
        c.checked = false;
      });
      updateMultiSelectLabel(container, placeholder, []);
      applyFilters();
    }
  });
  allCb.classList.add("all-cb");
  allItem.appendChild(allCb);
  allItem.appendChild(
    document.createTextNode(placeholder)
  );
  dropdown.appendChild(allItem);


  (
    Array.isArray(values) ? values : []
  )
    .filter(function(v) {
      return v !== null && v !== undefined &&
        String(v).trim() !== "";
    })
    .forEach(function(value) {

      const item =
        document.createElement("label");

      item.className = "multi-select-option";

      const cb =
        document.createElement("input");

      cb.type = "checkbox";
      cb.value = value;
      cb.checked = selected.indexOf(String(value)) !== -1;

      cb.addEventListener("change", function() {
        const allCbEl =
          dropdown.querySelector(".all-cb");

        const checked =
          getMultiValues(elementId);

        if (allCbEl) {
          allCbEl.checked = checked.length === 0;
        }

        updateMultiSelectLabel(
          container,
          placeholder,
          checked
        );

        applyFilters();
      });

      item.appendChild(cb);
      item.appendChild(
        document.createTextNode(value)
      );

      dropdown.appendChild(item);

    });


  updateMultiSelectLabel(
    container,
    placeholder,
    selected
  );

}


function updateMultiSelectLabel(
  container,
  placeholder,
  selected
) {

  const label =
    container.querySelector(
      ".multi-select-label"
    );


  if (!label) return;


  if (!selected || selected.length === 0) {

    label.textContent = placeholder;

  } else if (selected.length === 1) {

    label.textContent = selected[0];

  } else {

    label.textContent =
      selected.length + " selected";

  }

}


function getMultiValues(
  elementId
) {

  const container =
    document.getElementById(
      elementId
    );


  if (!container) return [];


  const checked =
    container.querySelectorAll(
      ".multi-select-dropdown input[type=checkbox]:checked:not(.all-cb)"
    );


  return Array.prototype.slice
    .call(checked)
    .map(function(c) { return c.value; });

}


function initMultiSelectToggles() {

  document.querySelectorAll(
    ".multi-select"
  ).forEach(function(ms) {

    const trigger =
      ms.querySelector(".multi-select-trigger");


    if (!trigger) return;


    trigger.addEventListener(
      "click",
      function(e) {

        e.stopPropagation();

        const isOpen =
          ms.classList.contains("is-open");


        document.querySelectorAll(
          ".multi-select.is-open"
        ).forEach(function(o) {
          o.classList.remove("is-open");
        });


        if (!isOpen) {
          ms.classList.add("is-open");
        }

      }
    );

  });


  document.addEventListener(
    "click",
    function(e) {

      // Only close if click was outside every .multi-select container
      if (!e.target.closest(".multi-select")) {
        document.querySelectorAll(
          ".multi-select.is-open"
        ).forEach(function(o) {
          o.classList.remove("is-open");
        });
      }

    }
  );

}


function applyFilters() {

  DashboardState.filters = {

    month: "",

    date: "",

    dates:
      getMultiValues(
        "dateFilter"
      ),

    weeks:
      getMultiValues(
        "weekFilter"
      ).map(function(w) { return Number(w); }),

    outlet:
      getMultiValues(
        "outletFilter"
      ),

    product:
      getMultiValues(
        "productFilter"
      ),

    item:
      getMultiValues(
        "itemFilter"
      ),

    attribute:
      getMultiValues(
        "attributeFilter"
      ),

    grade:
      getMultiValues(
        "gradeFilter"
      )

  };


  loadDashboard();

}


function resetFilters() {

  DashboardState.filters = {

    month: "",

    date: "",

    outlet: [],

    product: [],

    item: [],

    attribute: [],

    grade: []

  };


  // Reset native selects
  ["monthFilter", "dateFilter"].forEach(
    function(id) {
      setValue(id, "");
    }
  );


  // Reset multi-selects
  [
    "outletFilter",
    "productFilter",
    "itemFilter",
    "attributeFilter",
    "gradeFilter"
  ].forEach(function(id) {

    const container =
      document.getElementById(id);

    if (!container) return;

    container.querySelectorAll(
      ".multi-select-dropdown input[type=checkbox]"
    ).forEach(function(cb) {
      cb.checked = false;
    });

    const allCb =
      container.querySelector(".all-cb");

    if (allCb) allCb.checked = true;

    const placeholder =
      container.getAttribute("data-placeholder") || "";

    updateMultiSelectLabel(container, placeholder, []);

  });


  loadDashboard();

}


/* =========================================================
   PERIOD BUTTONS
   ========================================================= */

function updatePeriodButtons(
  containerId,
  activePeriod
) {

  const container =
    document.getElementById(
      containerId
    );


  if (!container) {

    return;

  }


  container
    .querySelectorAll(
      "button[data-period]"
    )
    .forEach(
      function(button) {

        button.classList.toggle(
          "active",
          button.dataset.period ===
          activePeriod
        );

      }
    );

}


/* =========================================================
   MODAL
   ========================================================= */

function openModal(
  title,
  eyebrow,
  body
) {

  setText(
    "modalTitle",
    title
  );


  setText(
    "modalEyebrow",
    eyebrow
  );


  const bodyElement =
    document.getElementById(
      "modalBody"
    );


  if (bodyElement) {

    bodyElement.innerHTML =
      body || "";

  }


  const overlay =
    document.getElementById(
      "modalOverlay"
    );


  if (overlay) {

    overlay.classList.add(
      "is-open"
    );

  }


  document.body.style.overflow =
    "hidden";

}


function closeModal() {

  const overlay =
    document.getElementById(
      "modalOverlay"
    );


  if (overlay) {

    overlay.classList.remove(
      "is-open"
    );

  }


  document.body.style.overflow =
    "";

}


function closeModalOnOverlay(
  event
) {

  if (
    event.target &&
    event.target.id ===
    "modalOverlay"
  ) {

    closeModal();

  }

}


document.addEventListener(
  "keydown",
  function(event) {

    if (
      event.key ===
      "Escape"
    ) {

      closeModal();

    }

  }
);


/* =========================================================
   DETAIL \u2014 PRODUCT
   ========================================================= */

function openProductDetail(
  index
) {

  const products =
    DashboardState.data &&
    Array.isArray(
      DashboardState.data.products
    )
      ? DashboardState.data.products
      : [];


  const product =
    products[index];


  if (!product) {

    return;

  }


  const productItemNames = {};

  (Array.isArray(product.items) ? product.items : []).forEach(
    function(entry) {

      if (entry && entry.item) {

        productItemNames[
          String(entry.item).trim().toLowerCase()
        ] = true;

      }

    }
  );


  if (product.product) {

    productItemNames[
      String(product.product).trim().toLowerCase()
    ] = true;

  }


  const allAttributes =
    DashboardState.data &&
    Array.isArray(DashboardState.data.attributes)
      ? DashboardState.data.attributes
      : [];


  const matchedAttributes = allAttributes.filter(
    function(attribute) {

      if (!attribute || !attribute.items) {

        return false;

      }


      return String(attribute.items)
        .split(",")
        .some(
          function(name) {

            return productItemNames[
              String(name).trim().toLowerCase()
            ] === true;

          }
        );

    }
  );


  let breakdown = matchedAttributes.map(
    function(attribute) {

      return {
        attribute: attribute.attribute,
        score: attribute.score,
        grade: attribute.grade,
        observations: attribute.observations
      };

    }
  );


  if (!breakdown.length) {

    const parameterMap = {};

    (Array.isArray(product.items) ? product.items : []).forEach(
      function(entry) {

        const parameters =
          entry && Array.isArray(entry.parameters)
            ? entry.parameters
            : [];

        parameters.forEach(
          function(parameter) {

            if (!parameter || !parameter.attribute) {

              return;

            }


            const key =
              String(parameter.attribute).trim().toLowerCase();

            if (!parameterMap[key]) {

              parameterMap[key] = {
                attribute: parameter.attribute,
                scores: [],
                observations: 0
              };

            }


            if (
              parameter.score !== null &&
              parameter.score !== undefined &&
              isFinite(Number(parameter.score))
            ) {

              parameterMap[key].scores.push(
                Number(parameter.score)
              );

            }


            if (
              parameter.observations !== null &&
              parameter.observations !== undefined &&
              isFinite(Number(parameter.observations))
            ) {

              parameterMap[key].observations +=
                Number(parameter.observations);

            }

          }
        );

      }
    );


    breakdown = Object.keys(parameterMap)
      .map(
        function(key) {

          const entry = parameterMap[key];

          const avg = entry.scores.length
            ? entry.scores.reduce(
                function(sum, value) {
                  return sum + value;
                },
                0
              ) / entry.scores.length
            : null;

          return {
            attribute: entry.attribute,
            score: avg,
            grade:
              avg !== null
                ? dashboardGrade(avg)
                : "\u2014",
            observations: entry.observations
          };

        }
      )
      .filter(
        function(entry) {
          return entry.score !== null;
        }
      );

  }


  breakdown.sort(
    function(a, b) {
      return Number(a.score || 0) - Number(b.score || 0);
    }
  );


  const rows = breakdown.map(
    function(item) {

      return `

        <tr>

          <td class="table-primary">

            ${escapeHtml(
              item.attribute ||
              "\u2014"
            )}

          </td>


          <td>

            ${formatScore(
              item.score
            )}
            / 5

          </td>


          <td>

            ${createGradeBadge(
              item.grade ||
              dashboardGrade(
                item.score
              )
            )}

          </td>


          <td>

            ${formatNumber(
              item.observations
            )}

          </td>

        </tr>

      `;

    }
  )
    .join("");


  openModal(
    product.product ||
    "Product Detail",
    "PRODUCT PERFORMANCE",
    `

      <div class="detail-grid">

        ${detailItem(
          "Product",
          product.product
        )}


        ${detailItem(
          "Score",
          formatScore(product.score) +
          " / 5"
        )}


        ${detailItem(
          "Grade",
          product.grade ||
          dashboardGrade(product.score)
        )}


        ${detailItem(
          "Audits",
          formatNumber(product.audits)
        )}

      </div>


      <h3 class="modal-subtitle">
        Attribute Breakdown
      </h3>


      <table class="data-table">

        <thead>

          <tr>

            <th>Attribute</th>

            <th>Score</th>

            <th>Grade</th>

            <th>Observations</th>

          </tr>

        </thead>


        <tbody>

          ${
            rows ||
            `
              <tr>

                <td colspan="4">

                  No attribute data.

                </td>

              </tr>
            `
          }

        </tbody>

      </table>

    `
  );

}


/* =========================================================
   DETAIL \u2014 OUTLET
   ========================================================= */

function openOutletDetail(
  index
) {

  // Use sorted order matching renderOutlets
  const outlets =
    DashboardState.data &&
    Array.isArray(DashboardState.data.outlets)
      ? DashboardState.data.outlets.slice().sort(function(a,b){ return Number(b.score||0)-Number(a.score||0); })
      : [];

  const outlet = outlets[index];

  if (!outlet) return;

  const score = Number(outlet.score || 0);
  const percent = outlet.scorePercent !== undefined && outlet.scorePercent !== null
    ? Number(outlet.scorePercent) : score / 5 * 100;
  const grade = outlet.grade || dashboardGrade(score);

  // Get audits for this outlet
  var allAudits = DashboardState.data && Array.isArray(DashboardState.data.audits)
    ? DashboardState.data.audits : [];
  var outletAudits = allAudits.filter(function(a) { return a.outlet === outlet.outlet; });

  // Attention: lowest avg attribute
  var attrTotals = {}, attrCounts = {};
  outletAudits.forEach(function(a) {
    if (!Array.isArray(a.attributes)) return;
    a.attributes.forEach(function(attr) {
      if (attr.score === null || attr.score === undefined || isNaN(Number(attr.score))) return;
      attrTotals[attr.attribute] = (attrTotals[attr.attribute] || 0) + Number(attr.score);
      attrCounts[attr.attribute] = (attrCounts[attr.attribute] || 0) + 1;
    });
  });
  var attrKeys = Object.keys(attrTotals);
  var attentionText = "\u2014";
  var attentionRows = "";
  if (attrKeys.length) {
    var attrAvgs = attrKeys.map(function(k) {
      return { attr: k, avg: attrTotals[k] / attrCounts[k] };
    }).sort(function(a,b) { return a.avg - b.avg; });
    var minVal = attrAvgs[0].avg;
    var worstAttrs = attrAvgs.filter(function(x) { return Math.abs(x.avg - minVal) < 0.005; });
    attentionText = worstAttrs.map(function(x) {
      return escapeHtml(x.attr) + " (" + formatScore(x.avg) + ")";
    }).join(", ");
    attentionRows = attrAvgs.map(function(x) {
      return "<tr><td>" + escapeHtml(x.attr) + "</td>" +
        "<td class='score-cell " + getScoreClass(x.avg) + "'>" + formatScore(x.avg) + " / 5</td>" +
        "<td>" + createGradeBadge(dashboardGrade(x.avg)) + "</td></tr>";
    }).join("");
  }

  // Product breakdown: group by product
  var productMap = {};
  outletAudits.forEach(function(a) {
    if (!a.product) return;
    if (!productMap[a.product]) productMap[a.product] = { scores: [], attributes: {} };
    if (a.score !== null && a.score !== undefined) productMap[a.product].scores.push(Number(a.score));
    if (Array.isArray(a.attributes)) {
      a.attributes.forEach(function(attr) {
        if (attr.score === null || attr.score === undefined) return;
        if (!productMap[a.product].attributes[attr.attribute]) productMap[a.product].attributes[attr.attribute] = [];
        productMap[a.product].attributes[attr.attribute].push(Number(attr.score));
      });
    }
  });

  var productRows = Object.keys(productMap).map(function(pname) {
    var pd = productMap[pname];
    var pavg = pd.scores.length ? pd.scores.reduce(function(s,v){return s+v;},0)/pd.scores.length : null;
    var pgrade = pavg !== null ? dashboardGrade(pavg) : "\u2014";
    // product attention
    var pattrKeys = Object.keys(pd.attributes);
    var pAttention = "\u2014";
    if (pattrKeys.length) {
      var pattrAvgs = pattrKeys.map(function(k) {
        var arr = pd.attributes[k];
        return { attr: k, avg: arr.reduce(function(s,v){return s+v;},0)/arr.length };
      });
      var pMin = pattrAvgs.reduce(function(m,x){return x.avg<m?x.avg:m;},Infinity);
      pAttention = pattrAvgs.filter(function(x){return Math.abs(x.avg-pMin)<0.005;}).map(function(x){
        return escapeHtml(x.attr) + " (" + formatScore(x.avg) + ")";
      }).join(", ");
    }
    return "<tr>" +
      "<td class='table-primary'>" + escapeHtml(pname) + "</td>" +
      "<td class='score-cell " + (pavg !== null ? getScoreClass(pavg) : "") + "'>" + (pavg !== null ? formatScore(pavg) + " / 5" : "\u2014") + "</td>" +
      "<td>" + createGradeBadge(pgrade) + "</td>" +
      "<td style='font-size:12px;color:var(--text-muted)'>" + pAttention + "</td>" +
      "</tr>";
  }).join("");

  const body = `
    <div class="outlet-modal-summary">
      <div class="outlet-modal-kpi">
        <span class="outlet-modal-score ${getScoreClass(score)}">${formatScore(score)} / 5</span>
        <span class="outlet-modal-pct">${formatPercent(percent)}</span>
        ${createGradeBadge(grade)}
        <span class="outlet-modal-audits">${formatNumber(outlet.audits)} audits</span>
      </div>
      <div class="outlet-modal-attention">
        <span class="outlet-modal-attention-label">Primary Attention</span>
        <span class="outlet-modal-attention-value">${attentionText}</span>
      </div>
    </div>

    <h4 class="outlet-modal-section-title">Product Performance</h4>
    <div class="table-scroll" style="margin-bottom:20px">
      <table class="data-table">
        <thead><tr><th>Product</th><th>Score</th><th>Grade</th><th>Attention</th></tr></thead>
        <tbody>${productRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No product data</td></tr>'}</tbody>
      </table>
    </div>

    <h4 class="outlet-modal-section-title">Attribute Quality</h4>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Attribute</th><th>Avg Score</th><th>Grade</th></tr></thead>
        <tbody>${attentionRows || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No attribute data</td></tr>'}</tbody>
      </table>
    </div>
  `;

  openModal(
    outlet.outlet || "Outlet Detail",
    "OUTLET QUALITY DETAIL",
    body
  );

}


/* =========================================================
   DETAIL \u2014 ATTENTION
   ========================================================= */

function openAttentionDetail(index) {

  var items = DashboardState.data && Array.isArray(DashboardState.data.painPoints)
    ? DashboardState.data.painPoints : [];
  var item = items[index];
  if (!item) return;

  var attr     = item.attribute || "Attribute";
  var score    = Number(item.score || 0);
  var grade    = item.grade || dashboardGrade(score);
  var audits   = Number(item.observations || 0);
  var lsr      = Number(item.lowScoreRate || 0);
  var priority = index + 1;

  // Score gap to HIGH PASS (threshold 4.50)
  var gapToGood = 4.50 - score;
  var gapText   = gapToGood > 0
    ? '<span style="color:#E84B16;font-weight:700">' + gapToGood.toFixed(2) + ' pts to HIGH PASS</span>'
    : '<span style="color:#009B72;font-weight:700">Already ' + grade + '</span>';

  // Grade description
  var gradeDesc = {
    'HIGH PASS':       'performing at peak quality',
    'MIDDLE PASS':     'performing well but with room to grow',
    'BORDERLINE PASS': 'at borderline level and requires management attention',
    'MIDDLE FAIL':     'below acceptable standard and needs urgent attention',
    'STRONG FAIL':     'failing quality standard and requires immediate action'
  };
  var desc = gradeDesc[grade] || 'requiring attention';

  // Raw audits for drill-down
  var allAudits = DashboardState.data && Array.isArray(DashboardState.data.audits)
    ? DashboardState.data.audits : [];

  // Filter audits that have this attribute
  var relevantAudits = allAudits.filter(function(a) {
    return Array.isArray(a.attributes) && a.attributes.some(function(x) {
      return x.attribute === attr;
    });
  });

  // Helper: get attribute score for this attr from audit
  function getAttrScore(audit) {
    if (!Array.isArray(audit.attributes)) return null;
    var found = audit.attributes.find(function(x){ return x.attribute === attr; });
    return found ? Number(found.score) : null;
  }
  function getAttrFeedback(audit) {
    if (!Array.isArray(audit.attributes)) return '';
    var found = audit.attributes.find(function(x){ return x.attribute === attr; });
    return found ? (found.feedback || '') : '';
  }

  function getAttrItem(audit) {
    if (Array.isArray(audit.attributes)) {
      var found = audit.attributes.find(function(x){ return x.attribute === attr; });
      if (found && found.item) return String(found.item);
    }
    return audit.item || '';
  }
  /** ITEM column source for the AUDIT EVIDENCE table (item the attr score/feedback belongs to). */

  // -- AFFECTED PRODUCTS --------------------------------------------
  var productMap = {};
  relevantAudits.forEach(function(a) {
    var p    = a.product || 'Unknown';
    var asc  = getAttrScore(a);
    if (asc === null) return;
    if (!productMap[p]) productMap[p] = { scores:[], count:0 };
    productMap[p].scores.push(asc);
    productMap[p].count++;
  });
  var productRows = Object.keys(productMap).map(function(p) {
    var avg = productMap[p].scores.reduce(function(s,v){return s+v;},0) / productMap[p].scores.length;
    avg = Math.round(avg*100)/100;
    return { product: p, score: avg, audits: productMap[p].count, grade: dashboardGrade(avg) };
  }).sort(function(a,b){ return a.score - b.score; });

  var productTableHtml = productRows.length
    ? '<table class="data-table" style="width:100%"><thead><tr><th>PRODUCT</th><th style="text-align:right">SCORE</th><th style="text-align:center">AUDITS</th><th>GRADE</th></tr></thead><tbody>' +
      productRows.map(function(r){
        return '<tr><td>'+escapeHtml(r.product)+'</td>' +
          '<td style="text-align:right;font-weight:700">'+r.score.toFixed(2)+'</td>' +
          '<td style="text-align:center">'+r.audits+'</td>' +
          '<td>'+createGradeBadge(r.grade)+'</td></tr>';
      }).join('') + '</tbody></table>'
    : '<p style="color:var(--text-muted);font-style:italic">No product-level issue found for this attribute in selected dataset.</p>';

  // -- AFFECTED OUTLETS ---------------------------------------------
  var outletMap = {};
  relevantAudits.forEach(function(a) {
    var o   = a.outlet || 'Unknown';
    var asc = getAttrScore(a);
    if (asc === null) return;
    if (!outletMap[o]) outletMap[o] = { scores:[], count:0 };
    outletMap[o].scores.push(asc);
    outletMap[o].count++;
  });
  var outletRows = Object.keys(outletMap).map(function(o) {
    var avg = outletMap[o].scores.reduce(function(s,v){return s+v;},0) / outletMap[o].scores.length;
    avg = Math.round(avg*100)/100;
    return { outlet: o, score: avg, audits: outletMap[o].count, grade: dashboardGrade(avg) };
  }).sort(function(a,b){ return a.score - b.score; });

  var showAll = outletRows.length <= 5;
  var outletDisplay = showAll ? outletRows : outletRows.slice(0,5);

  var outletTableHtml = outletRows.length
    ? '<table class="data-table" style="width:100%"><thead><tr><th>OUTLET</th><th style="text-align:right">SCORE</th><th style="text-align:center">AUDITS</th><th>GRADE</th></tr></thead><tbody>' +
      outletDisplay.map(function(r){
        return '<tr><td>'+escapeHtml(r.outlet)+'</td>' +
          '<td style="text-align:right;font-weight:700">'+r.score.toFixed(2)+'</td>' +
          '<td style="text-align:center">'+r.audits+'</td>' +
          '<td>'+createGradeBadge(r.grade)+'</td></tr>';
      }).join('') +
      (!showAll ? '<tr><td colspan="4" style="color:var(--text-muted);font-style:italic;text-align:center">Showing 5 of '+outletRows.length+' outlets - worst first.</td></tr>' : '') +
      '</tbody></table>'
    : '<p style="color:var(--text-muted);font-style:italic">No outlet-level issue found for this attribute in selected dataset.</p>';

  // -- AUDIT EVIDENCE -----------------------------------------------
  // Sort by attr score asc (worst first), take top 20
  var evidenceAudits = relevantAudits.slice().sort(function(a,b){
    var as = getAttrScore(a), bs = getAttrScore(b);
    return (as||99) - (bs||99);
  }).slice(0,20);

  function fmtDate(ts) {
    if (!ts) return '-';
    var d = new Date(ts);
    if (isNaN(d)) return String(ts).slice(0,16);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() +
           ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  var evidenceHtml = evidenceAudits.length
    ? '<table class="data-table" style="width:100%"><thead><tr><th>DATE</th><th>OUTLET</th><th>PRODUCT</th><th>ITEM</th><th style="text-align:right">SCORE</th><th>FEEDBACK</th></tr></thead><tbody>' +
      evidenceAudits.map(function(a){
        var asc  = getAttrScore(a);
        var afb  = (getAttrFeedback(a) || '').trim() ||
                   ((a.itemNotes && a.itemNotes[getAttrItem(a)]) || '').trim();
        var scoreStr = asc !== null ? asc.toFixed(2) : '-';
        return '<tr>' +
          '<td style="white-space:nowrap;font-size:12px">'+fmtDate(a.timestamp)+'</td>' +
          '<td>'+escapeHtml(a.outlet||'-')+'</td>' +
          '<td>'+escapeHtml(a.product||'-')+'</td>' +
          '<td style="font-size:12px">'+escapeHtml(getAttrItem(a)||'-')+'</td>' +
          '<td style="text-align:right;font-weight:700;color:'+(asc!==null&&asc<4?'var(--grade-borderline)':'inherit')+'">'+scoreStr+'</td>' +
          '<td style="font-size:12px;color:var(--text-muted)">'+escapeHtml(afb||'-')+'</td>' +
          '</tr>';
      }).join('') + '</tbody></table>'
    : '<p style="color:var(--text-muted);font-style:italic">No audit evidence available for this attribute in selected dataset.</p>';

  // -- KPI CARDS -----------------------------------------------------
  var kpiHtml =
    '<div class="modal-stat-row">' +
      '<div class="modal-stat-card">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px">QUALITY SCORE</div>' +
        '<div style="font-size:22px;font-weight:800;color:var(--color-plum,#2E1440)">'+score.toFixed(2)+'<span style="font-size:13px;font-weight:400;color:var(--text-muted)"> / 5</span></div>' +
      '</div>' +
      '<div class="modal-stat-card">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px">GRADE</div>' +
        '<div style="margin-top:4px">'+createGradeBadge(grade)+'</div>' +
      '</div>' +
      '<div class="modal-stat-card">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px">AUDITS</div>' +
        '<div style="font-size:22px;font-weight:800;color:var(--color-plum,#2E1440)">'+audits+'</div>' +
      '</div>' +
      '<div class="modal-stat-card">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px">LOW SCORE RATE</div>' +
        '<div style="font-size:22px;font-weight:800;color:'+(lsr>30?'var(--grade-middle-fail)':'var(--color-plum,#2E1440)')+'">'+lsr.toFixed(1)+'<span style="font-size:13px;font-weight:400;color:var(--text-muted)">%</span></div>' +
      '</div>' +
    '</div>';

  // -- WHY IS THIS A PRIORITY? ---------------------------------------
  var whyHtml =
    '<div class="modal-panel">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:var(--text-muted);margin-bottom:8px">WHY IS THIS A PRIORITY?</div>' +
      '<p style="margin:0 0 10px;color:var(--color-plum,#2E1440);line-height:1.6">' +
        '<strong>'+escapeHtml(attr)+'</strong> is currently classified as <strong>'+grade+'</strong> and '+desc+'.' +
      '</p>' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:13px">' +
        '<span style="color:var(--text-muted)">Score gap to HIGH PASS:</span> '+gapText +
      '</div>' +
    '</div>';

  // -- SECTION BUILDER ----------------------------------------------
  function section(title, content) {
    return '<div style="margin-bottom:24px">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:var(--text-muted);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border-light,#F0E9F1)">'+title+'</div>' +
      content + '</div>';
  }

  var body = kpiHtml + whyHtml +
    section('AFFECTED PRODUCTS', productTableHtml) +
    section('AFFECTED OUTLETS', outletTableHtml) +
    section('AUDIT EVIDENCE', evidenceHtml);

  openModal(
    attr,
    'QUALITY PRIORITY #' + priority,
    '<div style="max-width:900px">' + body + '</div>'
  );
}


/* =========================================================
   DETAIL \u2014 AUDIT
   ========================================================= */

function openAuditExplorerDetail(
  index
) {

  const audit =
    DashboardState.lastRenderedAudits[
      index
    ];


  if (!audit) {

    return;

  }


  openSingleAuditModal(
    audit
  );

}


function openAuditExplorer() {

  const audits =
    DashboardState.data &&
    Array.isArray(
      DashboardState.data.audits
    )
      ? DashboardState.data.audits
      : [];


  openModal(
    "Audit Explorer",
    "AUDIT EXPLORER",
    createAuditTable(
      audits
    )
  );

}


function openSingleAuditModal(
  audit
) {

  if (!audit) {

    return;

  }


  const attributes =
    Array.isArray(
      audit.attributes
    )
      ? audit.attributes
      : [];


  const rows =
    attributes
      .map(
        function(item) {

          return `

            <tr>

              <td>

                ${escapeHtml(
                  item.attribute ||
                  "\u2014"
                )}

              </td>


              <td>

                ${formatScore(
                  item.score
                )}
                / 5

              </td>


              <td>

                ${createGradeBadge(
                  item.grade ||
                  dashboardGrade(item.score)
                )}

              </td>

            </tr>

          `;

        }
      )
      .join("");


  openModal(
    audit.auditId ||
    "Audit Detail",
    "PRODUCT AUDIT",
    `

      <div class="detail-grid">

        ${detailItem(
          "Audit ID",
          audit.auditId
        )}


        ${detailItem(
          "Timestamp",
          formatDateTime(
            audit.timestamp
          )
        )}


        ${detailItem(
          "Auditor",
          audit.auditor ||
          audit.name ||
          "\u2014"
        )}


        ${detailItem(
          "Outlet",
          audit.outlet
        )}


        ${detailItem(
          "Product",
          audit.product
        )}


        ${detailItem(
          "Score",
          formatScore(
            audit.score
          ) +
          " / 5"
        )}


        ${detailItem(
          "Grade",
          audit.grade ||
          dashboardGrade(
            audit.score
          )
        )}

      </div>


      <h3 class="modal-subtitle">
        Attribute Scores
      </h3>


      <table class="data-table">

        <thead>

          <tr>

            <th>Attribute</th>

            <th>Score</th>

            <th>Grade</th>

          </tr>

        </thead>


        <tbody>

          ${rows}

        </tbody>

      </table>


      <div class="feedback-box">

        <div class="feedback-label">
          Feedback
        </div>


        <div class="feedback-text">

          ${escapeHtml(
            audit.feedback ||
            "No feedback recorded."
          )}

        </div>

      </div>

    `
  );

}


/* =========================================================
   DETAIL \u2014 TREND
   ========================================================= */

function openTrendTable() {

  const trend =
    getSelectedTrend();


  const rows =
    trend
      .map(
        function(item) {

          const score =
            Number(
              item.score || 0
            );


          return `

            <tr>

              <td>

                ${escapeHtml(
                  trendDisplayLabel(
                    item
                  )
                )}

              </td>


              <td>

                ${formatScore(score)}
                / 5

              </td>


              <td>

                ${formatPercent(
                  item.scorePercent !== undefined
                    ? item.scorePercent
                    : score / 5 * 100
                )}

              </td>


              <td>

                ${formatNumber(
                  item.audits
                )}

              </td>


              <td>

                ${createGradeBadge(
                  item.grade ||
                  dashboardGrade(score)
                )}

              </td>

            </tr>

          `;

        }
      )
      .join("");


  openModal(
    "Quality Trend Data",
    "QUALITY TREND",
    `

      <table class="data-table">

        <thead>

          <tr>

            <th>Period</th>

            <th>Score</th>

            <th>Quality</th>

            <th>Audits</th>

            <th>Grade</th>

          </tr>

        </thead>


        <tbody>

          ${rows}

        </tbody>

      </table>

    `
  );

}


/* =========================================================
   DETAIL \u2014 GRADE
   ========================================================= */

function openGradeTable() {

  // View Data = ALL product audits, sorted newest first
  var audits = DashboardState.data && Array.isArray(DashboardState.data.audits)
    ? DashboardState.data.audits.slice()
    : [];

  audits.sort(function(a, b) {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  openProductAuditModal("All Product Audits", "VIEW DATA", audits);

}


/* =========================================================
   ITEM TABLE (VIEW DATA)
   ========================================================= */

function openItemTable() {

  var items = DashboardState.sortedItems ||
    (DashboardState.data && Array.isArray(DashboardState.data.items)
      ? DashboardState.data.items.slice()
      : []);

  if (!Array.isArray(items) || !items.length) {
    openModal(
      "ITEM PERFORMANCE",
      "Item Quality Ranking",
      createNoDataState("No item data", "There is no item audit data for the selected filters.")
    );
    return;
  }

  var sorted = items.slice().sort(function(a, b) {
    return Number(b.score || 0) - Number(a.score || 0);
  });

  var rows = sorted.map(function(item, index) {
    var score = Number(item.score || 0);
    return '<tr>' +
      '<td class="rank-cell">' + (index + 1) + '</td>' +
      '<td>' + escapeHtml(item.item || '\\u2014') + '</td>' +
      '<td>' + escapeHtml(item.product || '\\u2014') + '</td>' +
      '<td><strong>' + formatScore(score) + '</strong></td>' +
      '<td>' + createGradeBadge(item.grade || dashboardGrade(score)) + '</td>' +
      '<td>' + formatNumber(item.audits) + '</td>' +
      '</tr>';
  }).join('');

  var html =
    '<div class="table-scroll">' +
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th style="width:36px">#</th>' +
          '<th>Item</th>' +
          '<th>Product</th>' +
          '<th>Score</th>' +
          '<th>Grade</th>' +
          '<th>Audits</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';

  openModal(
    "ITEM PERFORMANCE",
    "Item Quality Ranking",
    html
  );

}


/* =========================================================
   AUDIT TABLE
   ========================================================= */

function createAuditTable(
  audits
) {

  if (
    !Array.isArray(audits) ||
    !audits.length
  ) {

    return createNoDataState(
      "No audit records",
      "No matching audit records were found."
    );

  }


  const rows =
    audits
      .slice(
        0,
        100
      )
      .map(
        function(audit) {

          return `

            <tr>

              <td>

                ${escapeHtml(
                  audit.auditId ||
                  "\u2014"
                )}

              </td>


              <td>

                ${formatDateTime(
                  audit.timestamp
                )}

              </td>


              <td>

                ${escapeHtml(
                  audit.outlet ||
                  "\u2014"
                )}

              </td>


              <td>

                ${escapeHtml(
                  audit.product ||
                  "\u2014"
                )}

              </td>


              <td>

                ${escapeHtml(
                  audit.item ||
                  "\u2014"
                )}

              </td>


              <td>

                ${formatScore(
                  audit.score
                )}
                / 5

              </td>


              <td>

                ${createGradeBadge(
                  audit.grade ||
                  dashboardGrade(
                    audit.score
                  )
                )}

              </td>

            </tr>

          `;

        }
      )
      .join("");


  return `

    <div class="table-scroll">

      <table class="data-table">

        <thead>

          <tr>

            <th>Audit ID</th>

            <th>Timestamp</th>

            <th>Outlet</th>

            <th>Product</th>

            <th>Item</th>

            <th>Score</th>

            <th>Grade</th>

          </tr>

        </thead>


        <tbody>

          ${rows}

        </tbody>

      </table>

    </div>

  `;

}


/* =========================================================
   AUTO REFRESH
   ========================================================= */

function startAutoRefresh() {

  if (
    DashboardState.autoRefreshInterval
  ) {

    clearInterval(
      DashboardState.autoRefreshInterval
    );

  }


  DashboardState.autoRefreshInterval =
    setInterval(
      function() {

        loadDashboard();

      },
      5 * 60 * 1000
    );

}


function manualRefresh() {

  if (DashboardState.loading) return;

  setLoadingState(true);
  showDashboardLoading();

  google.script.run

    .withSuccessHandler(function() {

      loadDashboard();

    })

    .withFailureHandler(function(err) {

      console.warn(
        "ETL warning: " +
        (err && err.message ? err.message : err)
      );

      // ETL gagal \u2014 tetap reload dari Master yg ada
      loadDashboard();

    })

    .runETLAndRefresh();

}


/* =========================================================
   LOADING
   ========================================================= */

function setLoadingState(
  loading
) {

  DashboardState.loading =
    loading;


  const liveText =
    document.getElementById(
      "liveText"
    );


  if (liveText) {

    liveText.textContent =
      loading
        ? "UPDATING"
        : "LIVE";

  }


  const button =
    document.getElementById(
      "refreshButton"
    );


  if (button) {

    button.classList.toggle(
      "is-loading",
      loading
    );

  }

}


/* =========================================================
   INITIAL LOADING UI
   ========================================================= */

function showDashboardLoading() {

  [
    "attentionTable",
    "productTable",
    "outletTable",
    "recentAuditTable"

  ].forEach(
    function(id) {

      const element =
        document.getElementById(
          id
        );


      if (element) {

        element.innerHTML = `

          <div class="table-loading">
            Loading dashboard data...
          </div>

        `;

      }

    }
  );

}


/* =========================================================
   ERROR UI
   ========================================================= */

function renderDashboardError(
  message
) {

  const targets = [

    "attentionTable",

    "productTable",

    "outletTable",

    "recentAuditTable",

    "qualityTrendChart",

    "gradeDistributionChart"

  ];


  targets.forEach(
    function(id) {

      const element =
        document.getElementById(
          id
        );


      if (!element) {

        return;

      }


      element.innerHTML = `

        <div class="error-state">

          <div class="error-state-title">

            Dashboard Error

          </div>


          <div class="error-state-message">

            ${escapeHtml(
              message
            )}

          </div>

        </div>

      `;

    }
  );

}


/* =========================================================
   LAST UPDATED
   ========================================================= */

function updateLastUpdated(
  value
) {

  const element =
    document.getElementById(
      "lastUpdated"
    );


  if (!element) {

    return;

  }


  if (!value) {

    element.textContent =
      "Updated just now";

    return;

  }


  const date =
    new Date(
      value
    );


  if (
    isNaN(
      date.getTime()
    )
  ) {

    element.textContent =
      "Updated just now";

    return;

  }


  element.textContent =
    "Updated " +
    date.toLocaleTimeString(
      "en-GB",
      {
        hour:
          "2-digit",

        minute:
          "2-digit"
      }
    );

}


/* =========================================================
   CHART RESIZE
   ========================================================= */

window.addEventListener(
  "resize",
  function() {

    if (
      !DashboardState.data ||
      !DashboardState.chartsReady
    ) {

      return;

    }


    renderCharts(
      DashboardState.data
    );

  }
);


/* =========================================================
   HELPERS \u2014 TREND
   ========================================================= */

function normalizeTrend(
  trend
) {

  return trend
    .filter(
      function(item) {

        return (
          item &&
          isFinite(
            Number(
              item.score
            )
          )
        );

      }
    )
    .map(
      function(item) {

        const score =
          Number(
            item.score
          );


        return {

          period:
            item.period ||
            item.date ||
            item.label ||
            "",

          date:
            item.date ||
            item.period ||
            "",

          score:
            score,

          scorePercent:
            item.scorePercent !== undefined &&
            item.scorePercent !== null

              ? Number(
                  item.scorePercent
                )

              : score / 5 * 100,

          grade:
            item.grade ||
            dashboardGrade(score),

          audits:
            Number(
              item.audits || 0
            )

        };

      }
    );

}


function trendDisplayLabel(
  item
) {

  if (
    DashboardState.trendMode ===
    "allTime"
  ) {

    return formatTrendDateTime(
      item.period
    );

  }


  if (
    DashboardState.trendMode ===
    "weekly"
  ) {

    return formatWeekLabel(
      item.period
    );

  }


  if (
    DashboardState.trendMode ===
    "monthly"
  ) {

    return formatMonthLabel(
      item.period
    );

  }


  return formatShortDate(
    item.date ||
    item.period
  );

}


function createTrendTooltip(
  item
) {

  return (

    "Period: " +
    trendDisplayLabel(item) +

    "\nScore: " +
    formatScore(item.score) +
    " / 5" +

    "\nQuality: " +
    formatPercent(item.scorePercent) +

    "\nGrade: " +
    item.grade +

    "\nAudits: " +
    formatNumber(item.audits)

  );

}


/* =========================================================
   HELPERS \u2014 GRADE
   ========================================================= */

/*
 * Ambang WAJIB cermin dari
 * DASHBOARD_CONFIG.SCORE_THRESHOLDS (DashboardConfig.gs)
 * supaya grade di frontend tidak pernah berbeda dengan
 * backend. JANGAN tulis angka ambang sebagai literal.
 */

var SCORE_THRESHOLDS = {

  STRONG_FAIL: 2.00,

  MIDDLE_FAIL: 2.00,

  BORDERLINE_PASS: 3.00,

  MIDDLE_PASS: 3.60,

  HIGH_PASS: 4.50

};

function dashboardGrade(
  score
) {

  if (
    score === null ||
    score === undefined ||
    score === ""
  ) {

    return "NO DATA";

  }

  const value =
    Math.round(Number(score) * 100) / 100;

  if (
    !isFinite(value)
  ) {

    return "NO DATA";

  }

  /* Quality Standard (SOURCE OF TRUTH):
     HIGH PASS 4.50-5.00 | MIDDLE PASS 3.60-4.49 |
     BORDERLINE PASS 3.00-3.59 | MIDDLE FAIL 2.00-2.99 |
     STRONG FAIL < 2.00 */
  if (value >= SCORE_THRESHOLDS.HIGH_PASS) { return "HIGH PASS"; }
  if (value >= SCORE_THRESHOLDS.MIDDLE_PASS) { return "MIDDLE PASS"; }
  if (value >= SCORE_THRESHOLDS.BORDERLINE_PASS) { return "BORDERLINE PASS"; }
  if (value >= SCORE_THRESHOLDS.MIDDLE_FAIL) { return "MIDDLE FAIL"; }
  return "STRONG FAIL";

}


function createGradeBadge(
  grade
) {

  const safeGrade =
    grade ||
    "NO DATA";

  const classMap = {

    "HIGH PASS":
      "grade-high-pass",

    "MIDDLE PASS":
      "grade-middle-pass",

    "BORDERLINE PASS":
      "grade-borderline-pass",

    "MIDDLE FAIL":
      "grade-middle-fail",

    "STRONG FAIL":
      "grade-strong-fail"

  };

  const gradeClass =
    classMap[safeGrade] ||
    "grade-no-data";


  return `

    <span class="grade-badge ${gradeClass}">

      ${escapeHtml(
        safeGrade
      )}

    </span>

  `;

}


function getScoreClass(
  score
) {

  const value = Math.round(Number(score) * 100) / 100;

  if (value >= SCORE_THRESHOLDS.HIGH_PASS) { return "score-high"; }
  if (value >= SCORE_THRESHOLDS.MIDDLE_PASS) { return "score-middle"; }
  if (value >= SCORE_THRESHOLDS.BORDERLINE_PASS) { return "score-borderline"; }
  if (value >= SCORE_THRESHOLDS.MIDDLE_FAIL) { return "score-warning"; }
  return "score-danger";

}


function getAttentionDescription(
  item
) {

  if (!item) {

    return "No current quality issue identified.";

  }


  const grade =
    item.grade ||
    dashboardGrade(
      item.score
    );


  if (
    grade === "MIDDLE FAIL" ||
    grade === "STRONG FAIL"
  ) {

    return "Critical quality issue requiring immediate review.";

  }


  if (
    grade === "BORDERLINE PASS"
  ) {

    return "Borderline quality area requiring close monitoring.";

  }


  return "Highest current attention area.";

}


function applyGradeClass(
  element,
  grade
) {

  if (!element) {

    return;

  }


  element.classList.remove(
    "grade-high",
    "grade-high-pass",
    "grade-middle",
    "grade-middle-pass",
    "grade-borderline",
    "grade-borderline-pass",
    "grade-middle-fail",
    "grade-strong-fail"
  );


  const map = {

    "HIGH PASS":
      "grade-high-pass",

    "MIDDLE PASS":
      "grade-middle-pass",

    "BORDERLINE PASS":
      "grade-borderline-pass",

    "MIDDLE FAIL":
      "grade-middle-fail",

    "STRONG FAIL":
      "grade-strong-fail"

  };


  if (
    map[grade]
  ) {

    element.classList.add(
      map[grade]
    );

  }

}


/* =========================================================
   HELPERS \u2014 DOM
   ========================================================= */

function setText(
  elementOrId,
  value
) {

  const element =
    typeof elementOrId === "string"

      ? document.getElementById(
          elementOrId
        )

      : elementOrId;


  if (!element) {

    return;

  }


  element.textContent =
    value === null ||
    value === undefined
      ? "\u2014"
      : value;

}


function getValue(
  id
) {

  const element =
    document.getElementById(
      id
    );


  return element
    ? element.value
    : "";

}


function setValue(
  id,
  value
) {

  const element =
    document.getElementById(
      id
    );


  if (element) {

    element.value =
      value || "";

  }

}


/* =========================================================
   HELPERS \u2014 FORMATTING
   ========================================================= */

function formatNumber(
  value
) {

  const number =
    Number(
      value || 0
    );


  return number.toLocaleString(
    "en-US"
  );

}


function formatScore(
  value
) {

  const number =
    Number(
      value
    );


  if (
    !isFinite(number)
  ) {

    return "\u2014";

  }


  return number.toFixed(2);

}


function formatPercent(
  value
) {

  const number =
    Number(
      value
    );


  if (
    !isFinite(number)
  ) {

    return "\u2014";

  }


  return number.toFixed(2) +
    "%";

}


function formatDate(
  value
) {

  const date =
    parseDashboardDate(
      value
    );


  if (!date) {

    return "\u2014";

  }


  return date.toLocaleDateString(
    "en-GB",
    {
      day:
        "2-digit",

      month:
        "2-digit",

      year:
        "numeric"
    }
  );

}


function formatShortDate(
  value
) {

  const date =
    parseDashboardDate(
      value
    );


  if (!date) {

    return "\u2014";

  }


  return date.toLocaleDateString(
    "en-GB",
    {
      day:
        "2-digit",

      month:
        "short"
    }
  );

}


function formatDateTime(
  value
) {

  const date =
    parseDashboardDate(
      value
    );


  if (!date) {

    return "\u2014";

  }


  return (
    date.toLocaleDateString(
      "en-GB",
      {
        day:
          "2-digit",

        month:
          "short",

        year:
          "numeric"
      }
    ) +
    " " +
    date.toLocaleTimeString(
      "en-GB",
      {
        hour:
          "2-digit",

        minute:
          "2-digit"
      }
    )
  );

}


function formatTrendDateTime(
  value
) {

  const date =
    parseDashboardDate(
      value
    );


  if (!date) {

    return String(
      value ||
      "\u2014"
    );

  }


  return (
    date.toLocaleDateString(
      "en-GB",
      {
        day:
          "2-digit",

        month:
          "short"
      }
    ) +
    " " +
    date.toLocaleTimeString(
      "en-GB",
      {
        hour:
          "2-digit",

        minute:
          "2-digit"
      }
    )
  );

}


function formatMonthLabel(
  value
) {

  const date =
    parseDashboardDate(
      value
    );


  if (!date) {

    return String(
      value ||
      "\u2014"
    );

  }


  return date.toLocaleDateString(
    "en-US",
    {
      month:
        "long",

      year:
        "numeric"
    }
  );

}


function formatWeekLabel(
  value
) {

  const date =
    parseDashboardDate(
      value
    );


  if (!date) {

    return String(
      value ||
      "\u2014"
    );

  }


  const start =
    getStartOfWeek(
      date
    );


  const end =
    new Date(
      start
    );


  end.setDate(
    end.getDate() + 6
  );


  return (
    start.toLocaleDateString(
      "en-GB",
      {
        day:
          "2-digit",

        month:
          "short"
      }
    ) +
    " \u2013 " +
    end.toLocaleDateString(
      "en-GB",
      {
        day:
          "2-digit",

        month:
          "short"
      }
    )
  );

}


/* =========================================================
   HELPERS \u2014 DATE
   ========================================================= */

function parseDashboardDate(
  value
) {

  if (
    value instanceof Date
  ) {

    return isNaN(
      value.getTime()
    )
      ? null
      : value;

  }


  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;

  }


  const text =
    String(
      value
    );


  const dateOnly =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );


  if (dateOnly) {

    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3])
    );

  }


  const monthOnly =
    text.match(
      /^(\d{4})-(\d{2})$/
    );


  if (monthOnly) {

    return new Date(
      Number(monthOnly[1]),
      Number(monthOnly[2]) - 1,
      1
    );

  }


  const date =
    new Date(
      value
    );


  return isNaN(
    date.getTime()
  )
    ? null
    : date;

}


function getStartOfWeek(
  date
) {

  const result =
    new Date(
      date
    );


  result.setHours(
    0,
    0,
    0,
    0
  );


  const day =
    result.getDay();


  const diff =
    day === 0
      ? 6
      : day - 1;


  result.setDate(
    result.getDate() -
    diff
  );


  return result;

}


/* =========================================================
   HELPERS \u2014 DETAIL
   ========================================================= */

function detailItem(
  label,
  value
) {

  return `

    <div class="detail-item">

      <div class="detail-label">

        ${escapeHtml(
          label
        )}

      </div>


      <div class="detail-value">

        ${escapeHtml(
          value === null ||
          value === undefined ||
          value === ""
            ? "\u2014"
            : value
        )}

      </div>

    </div>

  `;

}


function createNoDataState(
  title,
  description
) {

  return `

    <div class="no-data">

      <div class="no-data-title">

        ${escapeHtml(
          title
        )}

      </div>


      <div class="no-data-description">

        ${escapeHtml(
          description
        )}

      </div>

    </div>

  `;

}


/* =========================================================
   HELPERS \u2014 SECURITY
   ========================================================= */

function escapeHtml(
  value
) {

  return String(
    value === null ||
    value === undefined
      ? ""
      : value
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "\u0027"
    );

}


/* =========================================================
   TOAST
   ========================================================= */

let toastTimeout = null;


function showToast(
  message
) {

  const toast =
    document.getElementById(
      "toast"
    );


  if (!toast) {

    return;

  }


  toast.textContent =
    message;


  toast.classList.add(
    "is-visible"
  );


  if (
    toastTimeout
  ) {

    clearTimeout(
      toastTimeout
    );

  }


  toastTimeout =
    setTimeout(
      function() {

        toast.classList.remove(
          "is-visible"
        );

      },
      2200
    );

}


/* =========================================================
   END
   ========================================================= */





function _updateDateHierarchyLabel(container, selectedDates) {
  var label = container.querySelector(".multi-select-label");
  if (!label) return;
  if (!selectedDates || !selectedDates.length) {
    label.textContent = container.getAttribute("data-placeholder") || "All Dates";
  } else if (selectedDates.length === 1) {
    var p = selectedDates[0].split("-");
    var monthNames2 = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    label.textContent = p[2] + " " + (monthNames2[parseInt(p[1],10)] || p[1]) + " " + p[0];
  } else {
    label.textContent = selectedDates.length + " dates";
  }
}

function buildProductAuditRows(audits) {

  return audits.map(function(audit) {

    var score = Number(audit.score || 0);
    var grade = audit.grade || dashboardGrade(score);

    // Attention = lowest-scoring attribute(s)
    var attentionText = "\u2014";
    if (Array.isArray(audit.attributes) && audit.attributes.length) {
      var validAttrs = audit.attributes.filter(function(a) {
        return a.score !== null && a.score !== undefined && !isNaN(Number(a.score));
      });
      if (validAttrs.length) {
        var minScore = validAttrs.reduce(function(m, a) {
          return Math.min(m, Number(a.score));
        }, Infinity);
        var lowest = validAttrs.filter(function(a) {
          return Number(a.score) === minScore;
        });
        attentionText = lowest.map(function(a) {
          return escapeHtml(a.attribute) + " (" + formatScore(Number(a.score)) + ")";
        }).join(", ");
      }
    }

    return "<tr>" +
      "<td class=\"table-primary\">" + escapeHtml(audit.product || "\u2014") + "</td>" +
      "<td style=\"white-space:nowrap\">" + formatDateTime(audit.timestamp) + "</td>" +
      "<td>" + escapeHtml(audit.outlet || "\u2014") + "</td>" +
      "<td class=\"score-cell " + getScoreClass(score) + "\">" + formatScore(score) + " / 5</td>" +
      "<td>" + createGradeBadge(grade) + "</td>" +
      "<td style=\"font-size:12px;color:var(--text-muted)\">" + attentionText + "</td>" +
      "</tr>";

  }).join("");

}

function dhChanged(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var checked = [];
  container.querySelectorAll(".dh-cb:checked").forEach(function(cb) {
    checked.push(cb.value);
  });
  _updateDateHierarchyLabel(container, checked);
  applyFilters();
}

function dhToggle(id) {
  var el = document.getElementById(id);
  var arr = document.getElementById("arr-" + id);
  if (!el) return;
  if (el.style.display === "none") {
    el.style.display = "block";
    if (arr) arr.innerHTML = "\u25bc";
  } else {
    el.style.display = "none";
    if (arr) arr.innerHTML = "\u25b6";
  }
}

function downloadMasterDikichi() {

  google.script.run

    .withSuccessHandler(function(url) {

      if (!url) return;

      // Cross-origin URL: anchor.download ignored by browser.
      // window.open triggers download because Google returns
      // Content-Disposition: attachment for /export?format=xlsx
      window.open(url, "_blank");

    })

    .withFailureHandler(function(err) {

      alert(
        "Download gagal: " +
        (err && err.message ? err.message : String(err))
      );

    })

    .getMasterDikichiDownloadUrl();

}

function openGradeDetailPopup(grade) {

  var audits = DashboardState.data && Array.isArray(DashboardState.data.audits)
    ? DashboardState.data.audits.slice()
    : [];

  var filtered = audits.filter(function(a) {
    return (a.grade || dashboardGrade(Number(a.score || 0))) === grade;
  });

  filtered.sort(function(a, b) {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  var titleMap = {
    "HIGH PASS":      "High Pass \u2014 Product Details",
    "MIDDLE PASS":    "Middle Pass \u2014 Product Details",
    "BORDERLINE PASS": "Borderline Pass \u2014 Product Details",
    "MIDDLE FAIL":    "Middle Fail \u2014 Product Details",
    "STRONG FAIL":    "Strong Fail \u2014 Product Details"
  };

  var title = titleMap[grade] || grade + " \u2014 Product Details";

  if (!filtered.length) {
    openModal(title, "GRADE DISTRIBUTION",
      '<p style="color:var(--text-muted);padding:16px 0">No product audits found for this grade.</p>'
    );
    return;
  }

  openProductAuditModal(title, "GRADE DISTRIBUTION", filtered);

}

function openOverallQualityModal() {

  var data = DashboardState.data;
  if (!data) return;

  var outlets = Array.isArray(data.outlets) ? data.outlets : [];

  var rows = outlets
    .slice()
    .sort(function(a, b) { return Number(b.score || 0) - Number(a.score || 0); })
    .map(function(o) {
      var score = Number(o.score || 0);
      var pct   = o.scorePercent !== undefined && o.scorePercent !== null
                    ? Number(o.scorePercent)
                    : score / 5 * 100;
      var barW  = Math.min(100, Math.max(0, pct)).toFixed(1);
      var grade = o.grade || dashboardGrade(score);
      var color = getGradeHexColor(score);
      return (
        '<tr>' +
          '<td class="table-primary">' + escapeHtml(o.outlet || "\u2014") + '</td>' +
          '<td>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<div style="flex:1;height:6px;background:#F1EAF0;border-radius:3px;min-width:60px">' +
                '<div style="height:6px;border-radius:3px;background:' + color + ';width:' + barW + '%"></div>' +
              '</div>' +
              '<span class="' + getScoreClass(score) + '">' + formatScore(score) + ' / 5</span>' +
            '</div>' +
          '</td>' +
          '<td>' + formatPercent(pct) + '</td>' +
          '<td>' + createGradeBadge(grade) + '</td>' +
          '<td style="text-align:right">' + formatNumber(o.audits) + '</td>' +
        '</tr>'
      );
    }).join('');

  var body =
    '<div class="table-scroll">' +
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>Outlet</th><th>Score</th><th>%</th><th>Grade</th><th style="text-align:right">Audits</th>' +
        '</tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No outlet data</td></tr>') + '</tbody>' +
      '</table>' +
    '</div>';

  openModal("Outlet Breakdown", "OVERALL QUALITY", body);

}

function openProductAuditModal(title, eyebrow, audits) {

  var rows = buildProductAuditRows(audits);
  var countLabel = audits.length + " product audit" + (audits.length !== 1 ? "s" : "");

  var body =
    "<p style=\"font-size:12px;color:var(--text-muted);margin-bottom:12px\">" + countLabel + "</p>" +
    "<div class=\"table-scroll\" style=\"max-height:460px;overflow-y:auto\">" +
      "<table class=\"data-table\">" +
        "<thead><tr>" +
          "<th>Product</th>" +
          "<th>Timestamp</th>" +
          "<th>Outlet</th>" +
          "<th>Score</th>" +
          "<th>Grade</th>" +
          "<th>Attention</th>" +
        "</tr></thead>" +
        "<tbody>" + (rows || "<tr><td colspan=\"6\" style=\"text-align:center;color:var(--text-muted)\">No data</td></tr>") + "</tbody>" +
      "</table>" +
    "</div>";

  openModal(title, eyebrow, body);

}

function openProductPerformanceModal() {

  var data = DashboardState.data;
  if (!data) return;

  var products = Array.isArray(data.products) ? data.products : [];

  var rows = products
    .slice()
    .sort(function(a, b) { return Number(b.score || 0) - Number(a.score || 0); })
    .map(function(p, i) {
      var score = Number(p.score || 0);
      var pct   = p.scorePercent !== undefined && p.scorePercent !== null
                    ? Number(p.scorePercent)
                    : score / 5 * 100;
      var grade = p.grade || dashboardGrade(score);
      var barW  = Math.min(100, Math.max(0, pct)).toFixed(1);
      var color = getGradeHexColor(score);

      var attrRows = "";
      if (Array.isArray(p.attributes) && p.attributes.length) {
        attrRows =
          '<tr><td colspan="5" style="padding:0 8px 8px 28px">' +
            '<table style="width:100%;font-size:11px;color:var(--text-muted)">' +
              p.attributes.map(function(a) {
                var as = Number(a.score || 0);
                return (
                  '<tr>' +
                    '<td style="padding:2px 8px 2px 0">' + escapeHtml(a.attribute || "\u2014") + '</td>' +
                    '<td class="' + getScoreClass(as) + '">' + formatScore(as) + '</td>' +
                  '</tr>'
                );
              }).join('') +
            '</table>' +
          '</td></tr>';
      }

      return (
        '<tr>' +
          '<td class="rank-cell">' + (i + 1) + '</td>' +
          '<td class="table-primary">' + escapeHtml(p.product || "\u2014") + '</td>' +
          '<td>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<div style="flex:1;height:6px;background:#F1EAF0;border-radius:3px;min-width:60px">' +
                '<div style="height:6px;border-radius:3px;background:' + color + ';width:' + barW + '%"></div>' +
              '</div>' +
              '<span class="' + getScoreClass(score) + '">' + formatScore(score) + ' / 5</span>' +
            '</div>' +
          '</td>' +
          '<td>' + formatPercent(pct) + '</td>' +
          '<td>' + createGradeBadge(grade) + '</td>' +
          '<td style="text-align:right">' + formatNumber(p.audits) + '</td>' +
        '</tr>' +
        attrRows
      );
    }).join('');

  var body =
    '<div class="table-scroll">' +
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>#</th><th>Product</th><th>Score</th><th>%</th><th>Grade</th><th style="text-align:right">Audits</th>' +
        '</tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No product data</td></tr>') + '</tbody>' +
      '</table>' +
    '</div>';

  openModal("Product Performance", "PRODUCT PERFORMANCE", body);

}

function openUnderBorderlineModal() {

  var data = DashboardState.data;
  if (!data) return;

  var audits = Array.isArray(data.audits) ? data.audits : [];

  /*
   * Filter: audit dengan score di bawah batas
   * BORDERLINE PASS (lihat SCORE_THRESHOLDS).
   * Ambang HARUS sama dengan KPI card
   * "Under Borderline Rate" dari backend.
   */
  var belowBorderline = audits.filter(function(a) {
    return a.score !== null && a.score !== undefined &&
      Number(a.score) < SCORE_THRESHOLDS.BORDERLINE_PASS;
  }).sort(function(a, b) {
    return Number(a.score || 0) - Number(b.score || 0);
  });

  var rows = belowBorderline.map(function(a) {
    var score = Number(a.score || 0);
    var grade = a.grade || dashboardGrade(score);

    /* ATTENTION: parameter dengan score di bawah
       batas BORDERLINE PASS. */
    var attrBelow = Array.isArray(a.attributes)
      ? a.attributes.filter(function(attr) {
          return attr.score !== null && attr.score !== undefined &&
            Number(attr.score) < SCORE_THRESHOLDS.BORDERLINE_PASS;
        })
      : [];

    var attentionText = attrBelow.length
      ? attrBelow.map(function(attr) { return escapeHtml(attr.attribute); }).join(", ")
      : "\u2014";

    // FEEDBACK: product-level feedback only (one per audit row)
    var feedbackText = (a.feedback && a.feedback.trim())
      ? escapeHtml(a.feedback)
      : "\u2014";

    return (
      '<tr>' +
        '<td class="table-primary">' + escapeHtml(a.auditId || "\u2014") + '</td>' +
        '<td>' + formatDateTime(a.timestamp) + '</td>' +
        '<td>' + escapeHtml(a.outlet || "\u2014") + '</td>' +
        '<td>' + escapeHtml(a.product || "\u2014") + '</td>' +
        '<td style="font-size:11px">' + escapeHtml(a.item || "\u2014") + '</td>' +
        '<td class="score-cell ' + getScoreClass(score) + '">' + formatScore(score) + '</td>' +
        '<td>' + createGradeBadge(grade) + '</td>' +
        '<td style="font-size:11px;color:var(--text)">' + attentionText + '</td>' +
        '<td style="font-size:11px;color:var(--text-muted);line-height:1.5">' + feedbackText + '</td>' +
      '</tr>'
    );
  }).join('');

  var body =
    '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' +
      belowBorderline.length + ' audit' + (belowBorderline.length !== 1 ? 's' : '') +
      ' with score below BORDERLINE PASS (&lt; ' +
      Number(SCORE_THRESHOLDS.BORDERLINE_PASS).toFixed(2) + ')' +
    '</p>' +
    '<div class="table-scroll">' +
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>Audit ID</th><th>Date</th><th>Outlet</th><th>Product</th><th>Item</th>' +
          '<th>Score</th><th>Grade</th><th>Attention</th><th>Feedback</th>' +
        '</tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="9" style="text-align:center;color:var(--text-muted)">No under-borderline audits</td></tr>') + '</tbody>' +
      '</table>' +
    '</div>';

  openModal("Under Borderline Details", "UNDER BORDERLINE RATE", body);

}

function populateDateHierarchy(elementId, dates, selectedDates) {

  var container = document.getElementById(elementId);
  if (!container) return;

  var dropdown = container.querySelector(".date-hierarchy-dropdown");
  if (!dropdown) return;

  // Build hierarchy: { year: { month: [dateKey, ...] } }
  var hierarchy = {};
  dates.forEach(function(d) {
    var parts = d.split("-");
    if (parts.length < 3) return;
    var y = parts[0];
    var m = parts[1];
    if (!hierarchy[y]) hierarchy[y] = {};
    if (!hierarchy[y][m]) hierarchy[y][m] = [];
    hierarchy[y][m].push(d);
  });

  var monthNames = ["","January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  function formatDayLabel(dateStr) {
    var p = dateStr.split("-");
    var day = parseInt(p[2], 10);
    var mon = monthNames[parseInt(p[1], 10)] || p[1];
    return p[2] + " " + mon + " " + p[0];
  }

  var selectedSet = {};
  (selectedDates || []).forEach(function(d) { selectedSet[d] = true; });

  var html = "";
  Object.keys(hierarchy).sort().forEach(function(year) {
    var yId = "dhy-" + year;
    html += '<div class="dh-year">';
    html += '<div class="dh-toggle" data-dh-toggle="' + yId + '">';
    html += '<span class="dh-arrow" id="arr-' + yId + '">\u25b6</span> ' + year;
    html += '</div>';
    html += '<div class="dh-children" id="' + yId + '" style="display:none">';
    Object.keys(hierarchy[year]).sort().forEach(function(month) {
      var mId = "dhy-" + year + "-" + month;
      var mName = monthNames[parseInt(month, 10)] || month;
      html += '<div class="dh-month">';
      html += '<div class="dh-toggle" data-dh-toggle="' + mId + '">';
      html += '<span class="dh-arrow" id="arr-' + mId + '">\u25b6</span> ' + mName;
      html += '</div>';
      html += '<div class="dh-children" id="' + mId + '" style="display:none">';
      hierarchy[year][month].forEach(function(dateKey) {
        var checked = selectedSet[dateKey] ? " checked" : "";
        html += '<label class="dh-day">';
        html += '<input type="checkbox" class="dh-cb" value="' + dateKey + '"' + checked + '>';
        html += ' ' + formatDayLabel(dateKey);
        html += '</label>';
      });
      html += '</div></div>';
    });
    html += '</div></div>';
  });

  if (!html) {
    html = '<div style="padding:8px;font-size:12px;color:var(--text-muted)">No dates available</div>';
  }

  dropdown.innerHTML = html;

  // Update label from current selection
  _updateDateHierarchyLabel(container, selectedDates || []);

  // Event delegation \u2014 toggle expand/collapse
  dropdown.addEventListener("click", function(e) {
    var toggle = e.target.closest("[data-dh-toggle]");
    if (toggle) {
      var id = toggle.getAttribute("data-dh-toggle");
      var el = document.getElementById(id);
      var arr = document.getElementById("arr-" + id);
      if (el) {
        var open = el.style.display !== "none";
        el.style.display = open ? "none" : "block";
        if (arr) arr.innerHTML = open ? "\u25b6" : "\u25bc";
      }
    }
    // Checkbox change
    if (e.target.classList.contains("dh-cb")) {
      var checked2 = [];
      dropdown.querySelectorAll(".dh-cb:checked").forEach(function(cb) {
        checked2.push(cb.value);
      });
      _updateDateHierarchyLabel(container, checked2);
      applyFilters();
    }
  });
}

function populateWeekFilter(elementId, dates, selectedWeeks) {

  function getISOWeek(dateStr) {
    var d = new Date(dateStr + "T00:00:00Z");
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return {
      week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
      year: d.getUTCFullYear()
    };
  }

  // Collect unique weeks from dates
  var weekSet = {};
  dates.forEach(function(d) {
    var iw = getISOWeek(d);
    var key = String(iw.week);
    var label = "Week " + iw.week + " (" + iw.year + ")";
    weekSet[key] = label;
  });

  var weekValues = Object.keys(weekSet).sort(function(a,b) { return Number(a)-Number(b); });

  populateMultiSelect(
    elementId,
    weekValues,
    (selectedWeeks || []).map(String),
    "All Weeks",
    function(v) { return weekSet[v] || ("Week " + v); }
  );

}

/* =========================================================
   KPI PRODUCT LIST - jumlah baris menyesuaikan tinggi
   kartu, bukan angka tetap. Kartu lain di grid menentukan
   tinggi baris, jadi daftar ini mengisi ruang yang ada.
   ========================================================= */

var KPI_PRODUCT_MIN_ROWS = 3;
var KPI_PRODUCT_MAX_ROWS = 6;
var KPI_PRODUCT_ROW_H = 22;
var KPI_PRODUCT_GAP = 6;
var KPI_PRODUCT_CHROME = 42;   /* padding kartu atas+bawah */

function kpiProductCapacity() {

  var container = document.getElementById("kpiProductList");

  if (!container) return KPI_PRODUCT_MAX_ROWS;

  var card = container.closest
    ? container.closest(".kpi-card")
    : null;

  if (!card) return KPI_PRODUCT_MAX_ROWS;

  var label = card.querySelector(".kpi-label");
  var hint = card.querySelector(".kpi-click-hint");

  var available = card.clientHeight
    - KPI_PRODUCT_CHROME
    - (label ? label.offsetHeight : 0)
    - (hint ? hint.offsetHeight + 10 : 0)
    - 14;   /* jarak label -> list */

  if (!isFinite(available) || available <= 0) {

    return KPI_PRODUCT_MAX_ROWS;

  }

  var rows = Math.floor(
    (available + KPI_PRODUCT_GAP) / (KPI_PRODUCT_ROW_H + KPI_PRODUCT_GAP)
  );

  return Math.max(
    KPI_PRODUCT_MIN_ROWS,
    Math.min(KPI_PRODUCT_MAX_ROWS, rows)
  );

}

function renderKpiProductList() {

  const container =
    document.getElementById(
      "kpiProductList"
    );

  if (!container) return;

  const products =
    DashboardState.data &&
    Array.isArray(DashboardState.data.products)
      ? DashboardState.data.products
      : [];

  if (!products.length) {

    container.innerHTML =
      '<div class="kpi-description">No product data</div>';

    return;

  }

  const sorted =
    products
      .slice()
      .sort(function(a, b) {
        return Number(b.score || 0) - Number(a.score || 0);
      });

  const MAX_SHOWN = kpiProductCapacity();
  const shown = sorted.slice(0, MAX_SHOWN);

  container.innerHTML = shown
    .map(function(p) {

      const score = Number(p.score || 0);
      const pct = p.scorePercent !== undefined && p.scorePercent !== null
        ? Number(p.scorePercent)
        : score / 5 * 100;

      const barPct = Math.min(100, Math.max(0, pct));
      const gradeColor = getGradeHexColor(score);

      return (
        '<div class="kpi-product-item">' +
          '<div class="kpi-product-name">' + escapeHtml(p.product || "\u2014") + '</div>' +
          '<div class="kpi-product-bar-wrap">' +
            '<div class="kpi-product-bar" style="width:' + barPct.toFixed(1) + '%;background:' + gradeColor + '"></div>' +
          '</div>' +
          '<div class="kpi-product-score ' + getScoreClass(score) + '">' +
            formatScore(score) + ' / 5' +
          '</div>' +
        '</div>'
      );

    })
    .join('');

  if (sorted.length > MAX_SHOWN) {

    container.innerHTML +=
      '<div class="kpi-description" style="margin-top:4px">+' +
      (sorted.length - MAX_SHOWN) +
      ' more</div>';

  }

  DashboardState.kpiProductRows = MAX_SHOWN;

  /*
   * Saat render pertama, tinggi kartu belum final
   * (grid baru selesai setelah paint). Cek ulang satu
   * frame kemudian supaya jumlah baris benar-benar
   * mengisi ruang yang tersedia.
   */

  if (!DashboardState.kpiProductRecheck) {

    DashboardState.kpiProductRecheck = true;

    var raf = window.requestAnimationFrame
      || function(cb) { return setTimeout(cb, 16); };

    raf(function() {

      DashboardState.kpiProductRecheck = false;

      if (kpiProductCapacity() !== DashboardState.kpiProductRows) {

        renderKpiProductList();

      }

    });

  }

}

/* Re-render daftar produk saat ukuran kartu berubah,
   supaya jumlah baris selalu pas dengan ruang tersedia. */

var KPI_PRODUCT_RESIZE_TIMER = null;

window.addEventListener(
  "resize",
  function() {

    if (!DashboardState.data || !DashboardState.data.products) {

      return;

    }

    if (KPI_PRODUCT_RESIZE_TIMER) {

      clearTimeout(KPI_PRODUCT_RESIZE_TIMER);

    }

    KPI_PRODUCT_RESIZE_TIMER = setTimeout(
      function() {

        var capacity = kpiProductCapacity();

        if (capacity !== DashboardState.kpiProductRows) {

          renderKpiProductList();

        }

      },
      180
    );

  }
);