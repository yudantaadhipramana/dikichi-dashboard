/****************************************************
 * MIE GACOAN
 * PRODUCT EXCELLENCE DASHBOARD
 *
 * UTILITY FUNCTIONS
 *
 * SINGLE SOURCE OF TRUTH untuk seluruh kalkulasi
 * (average, rounding, grade, date keys).
 *
 * Nama fungsi dipertahankan identik dengan konvensi
 * Product Excellence Dashboard yang sudah dipakai
 * (Kintoun) supaya mesin analytics dan frontend dapat
 * dipakai ulang tanpa drift kalkulasi.
 ****************************************************/


/**
 * Rata-rata numerik yang aman.
 * Nilai non-numerik dibuang, BUKAN dianggap 0.
 */
function dashboardAverage(values) {

  if (
    !values ||
    !values.length
  ) {

    return 0;

  }


  var numbers =
    [];


  for (
    var i = 0;
    i < values.length;
    i++
  ) {

    var number =
      Number(
        values[i]
      );


    if (!isNaN(number)) {

      numbers.push(
        number
      );

    }

  }


  if (!numbers.length) {

    return 0;

  }


  var sum =
    0;


  for (
    var j = 0;
    j < numbers.length;
    j++
  ) {

    sum +=
      numbers[j];

  }


  return (
    sum /
    numbers.length
  );

}


/**
 * Pembulatan aman ke sejumlah desimal.
 */
function dashboardRound(value, decimals) {

  if (
    value === null ||
    value === undefined ||
    isNaN(value)
  ) {

    return 0;

  }


  if (
    decimals === undefined ||
    decimals === null
  ) {

    decimals =
      2;

  }


  var multiplier =
    Math.pow(
      10,
      decimals
    );


  return (
    Math.round(
      Number(value) * multiplier
    ) / multiplier
  );

}


/**
 * Validasi score.
 * Skala penilaian Mie Gacoan = 1..5.
 */
function dashboardIsValidScore(score) {

  var value =
    Number(score);


  return (
    !isNaN(value) &&
    value >= 1 &&
    value <= 5
  );

}


/**
 * Grade dari score.
 *
 * Quality Standard (5 tier) — SOURCE OF TRUTH:
 *   HIGH PASS        = 4.50 - 5.00
 *   MIDDLE PASS      = 3.60 - 4.49
 *   BORDERLINE PASS  = 3.00 - 3.59
 *   MIDDLE FAIL      = 2.00 - 2.99
 *   STRONG FAIL      = < 2.00
 *
 * Dibulatkan 2 desimal lebih dulu untuk menghindari
 * floating-point drift (3.599999999 tetap BORDERLINE PASS).
 */
function dashboardGetGrade(score) {

  var value =
    Number(score);


  if (isNaN(value)) {

    return "STRONG FAIL";

  }


  value =
    Math.round(
      value * 100
    ) / 100;


  if (value >= 4.50) {

    return "HIGH PASS";

  }


  if (value >= 3.60) {

    return "MIDDLE PASS";

  }


  if (value >= 3.00) {

    return "BORDERLINE PASS";

  }


  if (value >= 2.00) {

    return "MIDDLE FAIL";

  }


  return "STRONG FAIL";

}


/**
 * Bobot risiko per grade.
 * Dipakai untuk priority score Quality Attention.
 */
function dashboardGradeWeight(grade) {

  var weights =
    DASHBOARD_CONFIG
      .GRADE_WEIGHT ||
    {};


  return (
    weights[grade] !== undefined
      ? weights[grade]
      : 0
  );

}


/**
 * Bobot risiko dari score.
 */
function dashboardGradeWeightFromScore(score) {

  return dashboardGradeWeight(
    dashboardGetGrade(score)
  );

}


/**
 * Ambang batas score dari Quality Standard.
 *
 * Satu-satunya akses ke DASHBOARD_CONFIG.SCORE_THRESHOLDS,
 * supaya tidak ada lagi angka ambang yang ditulis
 * sebagai literal di Analytics/frontend (sumber
 * inkonsistensi Under Borderline Rate vs tier yang
 * ditampilkan).
 *
 * Fallback = standard resmi bila config belum
 * ter-deploy / kosong.
 */
function dashboardThresholds() {

  var fallback = {

    STRONG_FAIL:
      2.00,

    MIDDLE_FAIL:
      2.00,

    BORDERLINE_PASS:
      3.00,

    MIDDLE_PASS:
      3.60,

    HIGH_PASS:
      4.50

  };


  var config =
    (typeof DASHBOARD_CONFIG !== "undefined" &&
     DASHBOARD_CONFIG &&
     DASHBOARD_CONFIG.SCORE_THRESHOLDS) ||
    {};


  var result =
    {};


  Object.keys(
    fallback
  ).forEach(
    function(key) {

      var value =
        Number(
          config[key]
        );


      result[key] =
        isNaN(value)
          ? fallback[key]
          : value;

    }
  );


  return result;

}


/**
 * Date key yyyy-MM-dd (timezone script).
 */
function dashboardDateKey(date) {

  var d =
    new Date(date);


  if (isNaN(d.getTime())) {

    return "";

  }


  return Utilities.formatDate(
    d,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );

}


/**
 * Month key yyyy-MM.
 */
function dashboardMonthKey(date) {

  var d =
    new Date(date);


  if (isNaN(d.getTime())) {

    return "";

  }


  return Utilities.formatDate(
    d,
    Session.getScriptTimeZone(),
    "yyyy-MM"
  );

}


/**
 * Hour key yyyy-MM-dd HH:00.
 */
function dashboardHourKey(date) {

  var d =
    new Date(date);


  if (isNaN(d.getTime())) {

    return "";

  }


  return Utilities.formatDate(
    d,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:00"
  );

}


/**
 * ISO-8601 week number (1..53).
 */
function dashboardWeekNumber(date) {

  var d =
    new Date(date);


  if (isNaN(d.getTime())) {

    return 0;

  }


  var target =
    new Date(
      Date.UTC(
        d.getFullYear(),
        d.getMonth(),
        d.getDate()
      )
    );


  var dayNum =
    target.getUTCDay() || 7;


  target.setUTCDate(
    target.getUTCDate() + 4 - dayNum
  );


  var yearStart =
    new Date(
      Date.UTC(
        target.getUTCFullYear(),
        0,
        1
      )
    );


  var weekNo =
    Math.ceil(
      (
        (
          (target - yearStart) / 86400000
        ) + 1
      ) / 7
    );


  if (weekNo < 1) {

    return 1;

  }


  if (weekNo > 53) {

    return 53;

  }


  return weekNo;

}


/**
 * Persentase aman.
 */
function dashboardPercent(part, total, decimals) {

  if (!total) {

    return 0;

  }


  return dashboardRound(
    (
      Number(part) /
      Number(total)
    ) * 100,
    decimals === undefined
      ? 1
      : decimals
  );

}


/**
 * Normalisasi nama CABANG.
 *
 * Sheet sumber masih memuat ejaan campuran untuk
 * cabang yang sama, mis. "Majalengka" (71 audit) dan
 * "MAJALENGKA" (138 audit). Tanpa normalisasi, satu
 * cabang terpecah menjadi dua baris di ranking dan
 * rata-ratanya terbelah dua.
 *
 * Patokan penulisan mengikuti sheet `_master` yang
 * memakai huruf besar, jadi seluruh nama cabang
 * diseragamkan ke uppercase + spasi tunggal.
 *
 * @param {*} value nilai mentah kolom "Branch / Cabang"
 * @return {string} nama cabang ternormalisasi
 */
function dashboardNormalizeBranch(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }


  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

}
