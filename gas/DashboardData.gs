/****************************************************
 * DIKICHI
 * PRODUCT EXCELLENCE DASHBOARD
 *
 * DATA SERVICE
 *
 * SOURCE OF TRUTH:
 * "Master Responses Gabungan"
 *
 * PENTING:
 * Dashboard adalah Web App. Service ini membuka
 * spreadsheet secara EKSPLISIT lewat SPREADSHEET_ID,
 * tidak pernah memakai getActiveSpreadsheet().
 *
 * Bentuk data sumber = LONG FORMAT (satu baris =
 * satu observasi parameter):
 *
 *   audit_id | Tanggal Audit | Nama Auditor | Outlet |
 *   Branch / Cabang | Product | Item | Parameter |
 *   Score / Hasil Evaluasi | ...
 *
 * Tidak ada product-block mapping seperti pada form
 * lama, sehingga ETL hanya melakukan:
 *   read -> filter Outlet -> normalisasi field -> cache
 ****************************************************/


const DashboardData = {


  /**************************************************
   * GET SPREADSHEET
   **************************************************/

  getSpreadsheet: function() {

    const spreadsheetId =
      DASHBOARD_CONFIG
        .SPREADSHEET_ID;


    if (!spreadsheetId) {

      throw new Error(
        "DASHBOARD_CONFIG.SPREADSHEET_ID belum diatur."
      );

    }


    return SpreadsheetApp.openById(
      spreadsheetId
    );

  },


  /**************************************************
   * GET DATA
   *
   * Strategi cache:
   *  1. coba format chunked (META + chunk keys)
   *  2. fallback ke format legacy single-key
   *  3. kalau cache miss -> baca sheet
   *
   * CacheService punya limit 100KB per value, jadi
   * payload besar WAJIB dipecah. Kegagalan cache
   * tidak boleh pernah menggagalkan request.
   **************************************************/

  getData: function() {

    const cache =
      CacheService
        .getScriptCache();


    var payload =
      null;


    try {

      var meta =
        cache.get(
          DASHBOARD_CONFIG.CACHE_KEY + "_META"
        );


      if (meta) {

        var metaInfo =
          JSON.parse(meta);

        var parts =
          [];

        var complete =
          true;


        for (
          var ci = 0;
          ci < metaInfo.chunks;
          ci++
        ) {

          var part =
            cache.get(
              DASHBOARD_CONFIG.CACHE_KEY + "_" + ci
            );


          if (
            part === null ||
            part === undefined
          ) {

            complete = false;
            break;

          }


          parts.push(part);

        }


        if (complete) {

          payload =
            parts.join("");

        }

      }
      else {

        payload =
          cache.get(
            DASHBOARD_CONFIG.CACHE_KEY
          );

      }

    }
    catch (readError) {

      payload =
        null;

    }


    if (payload) {

      try {

        const parsed =
          JSON.parse(payload);


        if (
          Array.isArray(parsed) &&
          parsed.length
        ) {

          return parsed;

        }

      }
      catch (parseError) {

        /*
         * Cache korup -> buang, bangun ulang
         * dari sheet.
         */

        this.clearCache();

      }

    }


    const data =
      this.readFromSheet();


    /*
     * Jangan pernah meng-cache dataset kosong.
     * State kosong sementara tidak boleh menjadi
     * state dashboard yang ter-cache.
     */

    if (data.length) {

      this.writeCache(data);

    }


    return data;

  },


  /**************************************************
   * READ + NORMALIZE FROM SHEET
   **************************************************/

  readFromSheet: function() {

    const ss =
      this.getSpreadsheet();


    const sheet =
      ss.getSheetByName(
        DASHBOARD_CONFIG.MASTER_SHEET
      );


    if (!sheet) {

      throw new Error(
        'Sheet "' +
        DASHBOARD_CONFIG.MASTER_SHEET +
        '" tidak ditemukan di spreadsheet "' +
        DASHBOARD_CONFIG.SPREADSHEET_ID +
        '".'
      );

    }


    const values =
      sheet
        .getDataRange()
        .getValues();


    if (
      !values ||
      values.length <= 1
    ) {

      return [];

    }


    const headers =
      values[0].map(
        function(header) {

          return String(
            header
          ).trim();

        }
      );


    const column =
      {};


    headers.forEach(
      function(header, index) {

        if (header) {

          column[header] =
            index;

        }

      }
    );


    validateDashboardHeaders(
      column
    );


    const H =
      DASHBOARD_CONFIG
        .HEADERS;


    const targetOutlet =
      String(
        DASHBOARD_CONFIG
          .OUTLET_FILTER ||
        ""
      )
        .trim()
        .toLowerCase();


    const data =
      [];


    for (
      let i = 1;
      i < values.length;
      i++
    ) {

      const row =
        values[i];


      /**********************************************
       * OUTLET GATE
       *
       * Hanya menerima record milik outlet ini.
       * Perbandingan case-insensitive supaya variasi
       * penulisan tidak membocorkan outlet lain.
       **********************************************/

      const outlet =
        String(
          row[column[H.OUTLET]] || ""
        ).trim();


      if (
        targetOutlet &&
        outlet.toLowerCase() !== targetOutlet
      ) {

        continue;

      }


      /**********************************************
       * SCORE
       *
       * Sel kosong BUKAN observasi valid.
       * Cek blank SEBELUM Number() karena
       * Number("") === 0.
       **********************************************/

      const scoreCell =
        row[column[H.SCORE]];


      if (
        scoreCell === "" ||
        scoreCell === null ||
        scoreCell === undefined ||
        String(scoreCell).trim() === ""
      ) {

        continue;

      }


      const score =
        Number(scoreCell);


      if (
        !dashboardIsValidScore(score)
      ) {

        continue;

      }


      /**********************************************
       * AUDIT ID
       **********************************************/

      const auditId =
        String(
          row[column[H.AUDIT_ID]] || ""
        ).trim();


      if (!auditId) {

        continue;

      }


      /**********************************************
       * TIMESTAMP
       *
       * start_time = waktu audit dimulai.
       * Fallback ke Tanggal Audit bila kosong
       * (sebagian baris legacy tidak mengisinya).
       **********************************************/

      var timestampDate =
        dashboardResolveAuditInstant(
          row[column[H.DATE]],
          row[column[H.START_TIME]]
        );


      if (!timestampDate) {

        timestampDate =
          this.normalizeDate(
            row[column[H.DATE]]
          );

      }


      if (!timestampDate) {

        continue;

      }


      /**********************************************
       * TEXT FIELDS
       **********************************************/

      const finding =
        this.cleanText(
          row[column[H.FINDING]]
        );


      const note =
        this.cleanText(
          row[column[H.NOTE]]
        );


      /*
       * Feedback = temuan evaluasi.
       * Finding diprioritaskan karena itu penjelasan
       * resmi mengapa score diberikan; Catatan Khusus
       * hanya pelengkap. Kalau keduanya ada, gabung
       * supaya tidak ada informasi hilang.
       */

      var feedback =
        finding;


      if (
        note &&
        note !== finding
      ) {

        feedback =
          feedback
            ? feedback + " | " + note
            : note;

      }


      /**********************************************
       * PUSH NORMALIZED ROW
       **********************************************/

      data.push({

        auditId:
          auditId,

        submissionId:
          String(
            row[column[H.SUBMISSION_ID]] || ""
          ).trim(),

        timestamp:
          timestampDate.toISOString(),

        dateKey:
          dashboardDateKey(
            timestampDate
          ),

        month:
          dashboardMonthKey(
            timestampDate
          ),

        week:
          dashboardWeekNumber(
            timestampDate
          ),

        hour:
          dashboardHourKey(
            timestampDate
          ),

        name:
          this.cleanText(
            row[column[H.AUDITOR]]
          ),

        outlet:
          outlet,

        branch:
          dashboardNormalizeBranch(
            this.cleanText(
              row[column[H.BRANCH]]
            )
          ),

        product:
          this.cleanText(
            row[column[H.PRODUCT]]
          ),

        item:
          this.cleanText(
            row[column[H.ITEM]]
          ),

        attribute:
          this.cleanText(
            row[column[H.PARAMETER]]
          ),

        score:
          score,

        grade:
          dashboardGetGrade(score),

        feedback:
          feedback,

        finding:
          finding,

        note:
          note,

        documentation:
          this.cleanText(
            row[column[H.EVIDENCE_URL]]
          ),

        evidenceFile:
          this.cleanText(
            row[column[H.EVIDENCE]]
          ),

        evidenceId:
          this.cleanText(
            row[column[H.EVIDENCE_ID]]
          )

      });

    }


    return data;

  },


  /**************************************************
   * WRITE CACHE (CHUNKED)
   **************************************************/

  writeCache: function(data) {

    const cache =
      CacheService
        .getScriptCache();


    try {

      var CHUNK_SIZE =
        90000; /* ~90KB, headroom di bawah limit 100KB */

      var payload =
        JSON.stringify(data);

      var chunkCount =
        Math.ceil(
          payload.length / CHUNK_SIZE
        );

      var chunkKeys =
        [];


      for (
        var i = 0;
        i < chunkCount;
        i++
      ) {

        var chunkKey =
          DASHBOARD_CONFIG.CACHE_KEY + "_" + i;


        cache.put(
          chunkKey,
          payload.substring(
            i * CHUNK_SIZE,
            (i + 1) * CHUNK_SIZE
          ),
          DASHBOARD_CONFIG.CACHE_SECONDS
        );


        chunkKeys.push(chunkKey);

      }


      cache.put(
        DASHBOARD_CONFIG.CACHE_KEY + "_META",
        JSON.stringify({

          chunks:
            chunkCount,

          keys:
            chunkKeys,

          total:
            payload.length

        }),
        DASHBOARD_CONFIG.CACHE_SECONDS
      );

    }
    catch (cacheError) {

      /*
       * Cache adalah optimasi, bukan syarat.
       * Kegagalan tulis cache tidak boleh
       * menggagalkan pengiriman data.
       */

      console.warn(
        "Dashboard cache write skipped: " +
        cacheError.message
      );

    }

  },


  /**************************************************
   * AUDIT LIST CACHE (fase A)
   *
   * Payload audits (~2.6 MB) dipisah dari payload
   * utama. Tiap chunk dibatasi ~90 KB seperti cache
   * ETL supaya selalu di bawah limit 100 KB/key.
   * TTL sama dengan CACHE_SECONDS.
   **************************************************/

  /**
   * peekDataCache (fase B)
   *
   * Cek cache ETL TANPA membangunnya. getData()
   * akan membaca sheet kalau cache kosong — untuk
   * endpoint /status kita hanya ingin tahu HIT/MISS,
   * bukan memicu 20 ribu baris terbaca.
   */
  peekDataCache: function() {

    const cache =
      CacheService
        .getScriptCache();

    try {

      const meta =
        cache.get(
          DASHBOARD_CONFIG.CACHE_KEY + "_META"
        );

      if (!meta) return null;

      const metaInfo =
        JSON.parse(meta);

      for (var i = 0; i < metaInfo.chunks; i++) {

        const part =
          cache.get(
            DASHBOARD_CONFIG.CACHE_KEY + "_" + i
          );

        if (part === null || part === undefined) {

          return null;

        }

      }

      return "HIT";

    }
    catch (ignore) {

      return null;

    }

  },

  getAuditsCache: function() {

    const cache =
      CacheService
        .getScriptCache();

    try {

      const meta =
        cache.get(
          DASHBOARD_CONFIG.CACHE_KEY + "_AUDITS_META"
        );

      if (!meta) return null;

      const metaInfo =
        JSON.parse(meta);

      var parts = [];
      var complete = true;

      for (var i = 0; i < metaInfo.chunks; i++) {

        const part =
          cache.get(
            DASHBOARD_CONFIG.CACHE_KEY + "_AUDITS_" + i
          );

        if (part === null || part === undefined) {
          complete = false;
          break;
        }

        parts.push(part);

      }

      if (!complete) return null;

      const payload =
        parts.join("");

      const parsed =
        JSON.parse(payload);

      return Array.isArray(parsed) && parsed.length
        ? parsed
        : null;

    }
    catch (readError) {

      return null;

    }

  },

  writeAuditsCache: function(audits) {

    if (!audits || !audits.length) return;

    const cache =
      CacheService
        .getScriptCache();

    try {

      const payload =
        JSON.stringify(audits);

      const chunkSize =
        90000;

      var chunks = [];

      for (var i = 0; i < payload.length; i += chunkSize) {
        chunks.push(payload.slice(i, i + chunkSize));
      }

      /* hapus chunk lama yang jumlahnya berbeda */
      this.removeAuditsCache();

      chunks.forEach(
        function(chunk, ci) {
          cache.put(
            DASHBOARD_CONFIG.CACHE_KEY + "_AUDITS_" + ci,
            chunk,
            DASHBOARD_CONFIG.CACHE_SECONDS
          );
        }
      );

      cache.put(
        DASHBOARD_CONFIG.CACHE_KEY + "_AUDITS_META",
        JSON.stringify({ chunks: chunks.length }),
        DASHBOARD_CONFIG.CACHE_SECONDS
      );

    }
    catch (writeError) {

      /* cache gagal -> tidak fatal, request berikut
         tinggal bangun ulang dari sheet. */

      console.error(
        "writeAuditsCache failed: " +
          writeError.message
      );

    }

  },

  removeAuditsCache: function() {

    const cache =
      CacheService
        .getScriptCache();

    try {

      const meta =
        cache.get(
          DASHBOARD_CONFIG.CACHE_KEY + "_AUDITS_META"
        );

      if (meta) {

        const metaInfo =
          JSON.parse(meta);

        for (var i = 0; i < metaInfo.chunks; i++) {
          cache.remove(
            DASHBOARD_CONFIG.CACHE_KEY + "_AUDITS_" + i
          );
        }

        cache.remove(
          DASHBOARD_CONFIG.CACHE_KEY + "_AUDITS_META"
        );

      }

    }
    catch (removeError) {
      /* best effort */
    }

  },

  /**************************************************
   * CLEAR CACHE
   **************************************************/

  clearCache: function() {

    const cache =
      CacheService
        .getScriptCache();


    const key =
      DASHBOARD_CONFIG.CACHE_KEY;


    /*
     * Baca META dulu untuk tahu jumlah chunk,
     * baru hapus semua chunk + META + legacy key.
     */

    var meta =
      cache.get(
        key + "_META"
      );


    if (meta) {

      try {

        var metaInfo =
          JSON.parse(meta);


        for (
          var i = 0;
          i < metaInfo.chunks;
          i++
        ) {

          cache.remove(
            key + "_" + i
          );

        }

      }
      catch (metaError) {

        /* META basi -> chunk kedaluwarsa sendiri */

      }

      cache.remove(
        key + "_META"
      );

    }


    cache.remove(
      key
    );

    /* fase A: audits cache ikut dibuang supaya tidak
       ada payload basi setelah refresh. */

    this.removeAuditsCache();

    /* fase B: buang juga cache HASIL build (per filter).
       Tanpa ini, refresh tidak akan terlihat efeknya
       karena build() mengembalikan hasil lama. */

    this.removeBuildCache();

  },


  /**************************************************
   * BUILD RESULT CACHE (fase B)
   *
   * DashboardAnalytics.build() ~60 detik untuk 20.460
   * baris. Hasilnya di-cache supaya request berikutnya
   * tidak mengulang agregasi. Harus ikut dibuang saat
   * clearCache supaya data tidak basi.
   **************************************************/

  removeBuildCache: function() {

    const cache =
      CacheService
        .getScriptCache();

    try {

      ["FAST", "FULL"].forEach(function(mode) {

        const key = "DASHBOARD_BUILD_" + mode;

        cache.remove(key);

        const meta = cache.get(key + "_META");

        if (meta) {

          try {

            const info = JSON.parse(meta);

            for (var i = 0; i < info.chunks; i++) {

              cache.remove(key + "_" + i);

            }

          }
          catch (ignore) {

            /* META basi -> chunk kedaluwarsa sendiri */

          }

          cache.remove(key + "_META");
          cache.remove(key + "_MODE");

        }

      });

    }
    catch (ignore) {

      /* best effort */

    }

  },


  /**************************************************
   * TEXT NORMALIZER
   **************************************************/

  cleanText: function(value) {

    if (
      value === null ||
      value === undefined
    ) {

      return "";

    }


    return String(value)
      .replace(/\s+/g, " ")
      .trim();

  },


  /**************************************************
   * DATE NORMALIZER
   *
   * Sheet dapat mengirim Date object atau string
   * dd/MM/yyyy (dengan atau tanpa jam).
   **************************************************/

  normalizeDate: function(value) {

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
      String(value)
        .trim();


    if (!text) {

      return null;

    }


    /*
     * dd/MM/yyyy [HH:mm[:ss]]
     */

    const match =
      text.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
      );


    if (match) {

      const parsed =
        new Date(
          Number(match[3]),
          Number(match[2]) - 1,
          Number(match[1]),
          Number(match[4] || 0),
          Number(match[5] || 0),
          Number(match[6] || 0)
        );


      return isNaN(
        parsed.getTime()
      )
        ? null
        : parsed;

    }


    /*
     * ISO / format lain yang dikenali Date().
     */

    const parsed =
      new Date(text);


    return isNaN(
      parsed.getTime()
    )
      ? null
      : parsed;

  }

};


/****************************************************
 * HEADER VALIDATION
 *
 * Gagal cepat dengan pesan jelas kalau struktur
 * sheet berubah, supaya tidak muncul sebagai
 * dashboard kosong tanpa penjelasan.
 ****************************************************/

function validateDashboardHeaders(
  column
) {

  const headers =
    DASHBOARD_CONFIG
      .HEADERS;


  const missing =
    [];


  Object.keys(headers)
    .forEach(
      function(key) {

        const expected =
          headers[key];


        if (
          column[expected] === undefined
        ) {

          missing.push(
            expected
          );

        }

      }
    );


  if (missing.length) {

    throw new Error(
      'Kolom berikut tidak ditemukan di sheet "' +
      DASHBOARD_CONFIG.MASTER_SHEET +
      '": ' +
      missing.join(", ") +
      "."
    );

  }

}


/****************************************************
 * AUDIT TIMESTAMP RESOLVER
 *
 * Kolom start_time di sheet hanya memuat JAM
 * ('17:29:20') atau serial waktu Sheets (fraksi
 * hari), sedangkan "Tanggal Audit" hanya memuat
 * tanggal. normalizeDate() membuang komponen jam,
 * sehingga setiap audit sebelumnya jatuh ke 00:00.
 *
 * Fungsi di bawah menggabungkan tanggal + jam memakai
 * instant yang dibangun EKSPLISIT dari WIB (UTC+7),
 * sehingga hasilnya tidak bergantung pada timezone
 * server tempat Apps Script berjalan.
 ****************************************************/

var DASHBOARD_AUDIT_TZ_OFFSET_MINUTES =
  420; /* WIB = UTC+7 */


/**
 * Gabungkan nilai kolom tanggal + kolom jam menjadi
 * satu instant audit.
 *
 * @param {*} dateValue nilai kolom "Tanggal Audit"
 * @param {*} timeValue nilai kolom "start_time"
 * @return {Date|null} instant audit, atau null kalau
 *   tanggal tidak dapat dibaca.
 */
function dashboardResolveAuditInstant(
  dateValue,
  timeValue
) {

  var dateParts =
    dashboardParseDateParts(dateValue);

  var timeParts =
    dashboardParseTimeParts(timeValue);


  var year;
  var month;
  var day;
  var hour;
  var minute;
  var second;


  if (
    timeParts &&
    timeParts.full
  ) {

    /*
     * Nilai jam memuat tanggal+jam sendiri
     * (Date / ISO / serial penuh) -> pakai itu.
     */

    year = timeParts.year;
    month = timeParts.month;
    day = timeParts.day;

    hour = timeParts.hour;
    minute = timeParts.minute;
    second = timeParts.second;

  }
  else {

    if (!dateParts) {

      return null;

    }


    year = dateParts.year;
    month = dateParts.month;
    day = dateParts.day;

    hour = timeParts
      ? timeParts.hour
      : dateParts.hour;

    minute = timeParts
      ? timeParts.minute
      : dateParts.minute;

    second = timeParts
      ? timeParts.second
      : dateParts.second;

  }


  /*
   * Bangun instant dari komponen WIB: Date.UTC()
   * menafsirkan input sebagai UTC, lalu geser mundur
   * 7 jam supaya jam dinding WIB = jam masukan.
   */

  var utcMs =
    Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second
    ) -
    DASHBOARD_AUDIT_TZ_OFFSET_MINUTES *
      60 *
      1000;


  var instant =
    new Date(utcMs);


  return isNaN(
    instant.getTime()
  )
    ? null
    : instant;

}


/**
 * Baca komponen {year, month, day, hour, minute, second}
 * dari nilai kolom TANGGAL. Mengembalikan null kalau
 * tidak ada tanggal.
 */
function dashboardParseDateParts(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;

  }


  if (value instanceof Date) {

    var dateParts =
      dashboardJakartaParts(value);

    return (
      dateParts &&
      dateParts.year > 1900
    )
      ? dateParts
      : null;

  }


  if (typeof value === "number") {

    if (
      isNaN(value) ||
      !isFinite(value) ||
      value < 1
    ) {

      return null;

    }


    var serialParts =
      dashboardSerialFullParts(value);

    return (
      serialParts &&
      serialParts.year > 1900
    )
      ? serialParts
      : null;

  }


  var text =
    String(value).trim();

  if (!text) {

    return null;

  }


  return dashboardParseFullText(text);

}


/**
 * Baca komponen jam dari nilai kolom JAM.
 * 'full' = true berarti nilainya membawa tanggal
 * sendiri (harus dipakai apa adanya).
 */
function dashboardParseTimeParts(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;

  }


  if (value instanceof Date) {

    var dateParts =
      dashboardJakartaParts(value);

    if (!dateParts) {

      return null;

    }


    /*
     * Cell time-only dari Sheets dibaca sebagai Date
     * di epoch 1899-12-30. Kalau tahunnya masih epoch
     * itu, perlakukan sebagai JAM saja.
     */

    if (dateParts.year <= 1900) {

      dateParts.full = false;

    }


    return dateParts;

  }


  if (typeof value === "number") {

    return dashboardSerialTimeParts(value);

  }


  var text =
    String(value).trim();

  if (!text) {

    return null;

  }


  var clock =
    text.match(
      /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
    );


  if (clock) {

    var hour =
      Number(clock[1]);

    var minute =
      Number(clock[2]);

    var second =
      Number(clock[3] || 0);


    if (
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {

      return null;

    }


    return {
      full: false,
      year: 0,
      month: 1,
      day: 1,
      hour: hour,
      minute: minute,
      second: second
    };

  }


  /*
   * yyyy-MM-dd[ T]HH:mm[:ss] TANPA zona waktu.
   * Diperlakukan sebagai jam dinding WIB (UTC+7),
   * bukan zona server, supaya hasil tidak bergantung
   * pada timezone tempat Apps Script berjalan.
   */

  var isoLocal =
    text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/
    );


  if (isoLocal) {

    var isoYear =
      Number(isoLocal[1]);

    var isoMonth =
      Number(isoLocal[2]);

    var isoDay =
      Number(isoLocal[3]);

    var isoHour =
      Number(isoLocal[4]);

    var isoMinute =
      Number(isoLocal[5]);

    var isoSecond =
      Number(isoLocal[6] || 0);


    if (
      isoMonth < 1 ||
      isoMonth > 12 ||
      isoDay < 1 ||
      isoDay > 31 ||
      isoHour > 23 ||
      isoMinute > 59 ||
      isoSecond > 59
    ) {

      return null;

    }


    return {
      full: true,
      year: isoYear,
      month: isoMonth,
      day: isoDay,
      hour: isoHour,
      minute: isoMinute,
      second: isoSecond
    };

  }


  var fullParts =
    dashboardParseFullText(text);

  if (fullParts) {

    fullParts.full = true;

    return fullParts;

  }


  return null;

}


/**
 * Komponen jam dari serial waktu Sheets.
 * < 1 = fraksi hari (jam saja);
 * >= 1 = serial tanggal+jam penuh.
 */
function dashboardSerialTimeParts(value) {

  if (
    isNaN(value) ||
    !isFinite(value) ||
    value < 0
  ) {

    return null;

  }


  if (value < 1) {

    var totalSeconds =
      Math.round(
        value * 86400
      );


    return {
      full: false,
      year: 0,
      month: 1,
      day: 1,
      hour: Math.floor(
        totalSeconds / 3600
      ),
      minute: Math.floor(
        (totalSeconds % 3600) / 60
      ),
      second: totalSeconds % 60
    };

  }


  return dashboardSerialFullParts(value);

}


/**
 * Komponen tanggal+jam dari serial Sheets (>= 1).
 * Serial 25569 = 1970-01-01; dibaca sebagai UTC
 * karena serial tidak membawa timezone.
 */
function dashboardSerialFullParts(value) {

  var ms =
    Math.round(
      (value - 25569) * 86400000
    );


  var date =
    new Date(ms);


  if (isNaN(date.getTime())) {

    return null;

  }


  return {
    full: true,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds()
  };

}


/**
 * Komponen jam dinding WIB (Asia/Jakarta, UTC+7)
 * dari sebuah instant Date. Tidak bergantung pada
 * timezone server.
 */
function dashboardJakartaParts(date) {

  if (
    !(date instanceof Date) ||
    isNaN(date.getTime())
  ) {

    return null;

  }


  var shifted =
    new Date(
      date.getTime() +
      DASHBOARD_AUDIT_TZ_OFFSET_MINUTES *
        60 *
        1000
    );


  return {
    full: true,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };

}


/**
 * Baca 'dd/MM/yyyy [HH:mm[:ss]]' atau string ISO /
 * format lain yang dikenali Date().
 * 'full' selalu false di sini kecuali jamnya ada
 * (pemanggil yang menaikkan bendera).
 */
function dashboardParseFullText(text) {

  var match =
    text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );


  if (match) {

    var day =
      Number(match[1]);

    var month =
      Number(match[2]);

    var year =
      Number(match[3]);

    var hour =
      Number(match[4] || 0);

    var minute =
      Number(match[5] || 0);

    var second =
      Number(match[6] || 0);


    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {

      return null;

    }


    return {
      full: false,
      year: year,
      month: month,
      day: day,
      hour: hour,
      minute: minute,
      second: second
    };

  }


  var parsed =
    new Date(text);


  if (isNaN(parsed.getTime())) {

    return null;

  }


  return dashboardJakartaParts(parsed);

}
