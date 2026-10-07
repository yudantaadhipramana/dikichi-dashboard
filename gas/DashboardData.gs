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
        this.normalizeDate(
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
