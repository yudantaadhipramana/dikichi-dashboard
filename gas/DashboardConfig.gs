/****************************************************
 * DIKICHI
 * PRODUCT EXCELLENCE DASHBOARD
 *
 * CONFIGURATION
 *
 * SINGLE SOURCE OF TRUTH untuk seluruh konfigurasi
 * dashboard. Web App tidak boleh bergantung pada
 * SpreadsheetApp.getActiveSpreadsheet().
 ****************************************************/

const DASHBOARD_CONFIG = {

  /**************************************************
   * DATA SOURCE
   *
   * HANYA SATU sheet yang dipakai:
   * "Master Responses Gabungan"
   *
   * Sheet ini sudah difilter pada level sumber:
   * Outlet = "Dikichi" untuk SELURUH baris (klon dari dashboard Mie Gacoan).
   * Dashboard tetap memfilter ulang secara eksplisit
   * (defensif) agar tidak pernah menampilkan outlet
   * lain apabila sheet bertambah data.
   **************************************************/

  SPREADSHEET_ID:
    "1i-nGUWKqmVgNOdDjN2f8c5gk5lsgS-PaLbABLjqteaA",

  MASTER_SHEET:
    "Master Responses Gabungan",

  /*
   * Nilai kolom Outlet yang dianggap milik
   * dashboard ini. Perbandingan case-insensitive.
   */
  OUTLET_FILTER:
    "Dikichi",

  CACHE_KEY:
    "DIKICHI_DASHBOARD_DATA",

  CACHE_SECONDS:
    1800,

  REFRESH_INTERVAL_MS:
    300000,

  /**************************************************
   * MINIMUM SAMPLE UNTUK GAUGE PERIODE
   *
   * Bulan terbaru hanya dipakai sebagai "This Month"
   * pada gauge apabila jumlah auditnya >= nilai ini.
   * Tanpa guard, bulan yang baru berjalan (misal
   * baru 2 audit) menghasilkan skor ekstrem seperti
   * 5.00 yang menyesatkan.
   **************************************************/

  MONTH_COMPARISON_MIN_AUDITS:
    20,

  /**************************************************
   * SCORE THRESHOLDS
   *
   * Satu-satunya tempat angka ambang boleh
   * ditulis. Sebelumnya angka 3.00 / 4.00
   * tersebar sebagai literal di Analytics dan
   * frontend, sehingga sempat tidak konsisten
   * dengan Quality Standard yang ditampilkan.
   *
   * HANYA boleh dibaca dari config ini.
   **************************************************/

  SCORE_THRESHOLDS: {

    /* batas STRONG FAIL (bawah) */
    STRONG_FAIL:
      2.00,

    /* batas MIDDLE FAIL */
    MIDDLE_FAIL:
      2.00,

    /* batas BORDERLINE PASS */
    BORDERLINE_PASS:
      3.00,

    /* batas MIDDLE PASS */
    MIDDLE_PASS:
      3.60,

    /* batas HIGH PASS */
    HIGH_PASS:
      4.50

  },

  BRAND: {

    NAME:
      "DIKICHI",

    SUBTITLE:
      "Product Excellence Dashboard",

    SCRIPT_TITLE:
      "Dikichi - Product Excellence Dashboard"

  },

  /**************************************************
   * HEADER MAP
   *
   * Nama kolom aktual di sheet
   * "Master Responses Gabungan".
   **************************************************/

  HEADERS: {

    START_TIME:
      "start_time",

    END_TIME:
      "end_time",

    DATE:
      "Tanggal Audit",

    AUDIT_ID:
      "audit_id",

    AUDITOR:
      "Nama Auditor",

    OUTLET:
      "Outlet",

    BRANCH:
      "Branch / Cabang",

    PRODUCT:
      "Product",

    SUBMISSION_ID:
      "_id",

    ITEM:
      "Item",

    PARAMETER:
      "Parameter",

    SCORE:
      "Score / Hasil Evaluasi",

    NOTE:
      "Catatan Khusus",

    FINDING:
      "Finding / Alasan Evaluasi",

    EVIDENCE:
      "Evidence Photo",

    EVIDENCE_URL:
      "Evidence Photo_URL",

    EVIDENCE_ID:
      "evidence_id"

  },

  /**************************************************
   * QUALITY STANDARD — 5 TIER GRADE
   *
   * SOURCE OF TRUTH:
   *   HIGH PASS        = 4.50 - 5.00
   *   MIDDLE PASS      = 3.60 - 4.49
   *   BORDERLINE PASS  = 3.00 - 3.59
   *   MIDDLE FAIL      = 2.00 - 2.99
   *   STRONG FAIL      = < 2.00
   *
   * Threshold identik dengan standar Product
   * Excellence Kintoun agar bahasa kualitas
   * konsisten di seluruh unit bisnis.
   **************************************************/

  GRADE: {

    HIGH_PASS: {
      label:
        "HIGH PASS",
      min:
        4.50
    },

    MIDDLE_PASS: {
      label:
        "MIDDLE PASS",
      min:
        3.60
    },

    BORDERLINE_PASS: {
      label:
        "BORDERLINE PASS",
      min:
        3.00
    },

    MIDDLE_FAIL: {
      label:
        "MIDDLE FAIL",
      min:
        2.00
    },

    STRONG_FAIL: {
      label:
        "STRONG FAIL",
      min:
        0
    }

  },

  /*
   * Bobot risiko per grade.
   * Dipakai untuk menghitung priority score
   * pada Quality Attention.
   */
  GRADE_WEIGHT: {

    "HIGH PASS":
      0.10,

    "MIDDLE PASS":
      0.35,

    "BORDERLINE PASS":
      0.60,

    "MIDDLE FAIL":
      0.80,

    "STRONG FAIL":
      1.00

  }

};
