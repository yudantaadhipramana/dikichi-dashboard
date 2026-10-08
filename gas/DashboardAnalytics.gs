/****************************************************
 * DIKICHI
 * PRODUCT EXCELLENCE DASHBOARD
 *
 * ANALYTICS ENGINE
 *
 * Hierarki data Dikichi punya TIGA level:
 *
 *   Product  ->  Item  ->  Parameter
 *   (Dimsum)     (Siomay)   (Rasa)
 *
 * Karena itu agregasi di sini lebih dalam daripada
 * dashboard satu-level. Setiap level tetap dihitung
 * dari unit observasi yang sama (satu baris = satu
 * penilaian parameter) supaya tidak ada pembobotan
 * ganda.
 *
 * DEFINISI AUDIT
 * --------------
 * audit_id adalah unit audit sebenarnya, dan satu
 * audit_id = satu kombinasi (tanggal, auditor,
 * cabang, produk, item). Dashboard ini menampilkan
 * seluruhnya secara transparan melalui Audit Explorer
 * sehingga user tahu nilai KPI berasal dari berapa
 * audit.
 *
 * Semua rata-rata dihitung pada level audit terlebih
 * dulu (buildAuditScores), lalu dirata-ratakan lagi
 * antar audit. Cara ini mencegah audit dengan jumlah
 * parameter lebih banyak mendominasi hasil.
 ****************************************************/


const DashboardAnalytics = {


  /**************************************************
   * BUILD
   *
   * Payload lengkap untuk frontend.
   **************************************************/

  /**************************************************
   * BUILD (dengan cache hasil)
   *
   * PERF fase B: build() memakan ~60 detik untuk
   * 20.460 baris (diukur via ?page=perf, Aug 2026:
   * buildMs 61022). Data di-cache, tapi HASIL build
   * selalu dihitung ulang -> tiap request tetap 60 s.
   *
   * Solusi: simpan hasil build di CacheService per
   * filter (default filter paling sering dipakai).
   * Cache dibuang otomatis saat clearCache/refresh,
   * jadi data tidak pernah basi.
   **************************************************/

  /**************************************************
   * TANPA FILTER EFEKTIF?
   *
   * Frontend mengirim objek filter lengkap dengan nilai
   * kosong ("" atau []). Dianggap default kalau SEMUA
   * nilainya kosong. Dipakai untuk memutuskan cache.
   **************************************************/

  hasNoEffectiveFilter: function(filters) {

    if (!filters) {
      return true;
    }

    const keys =
      Object.keys(filters);

    for (var i = 0; i < keys.length; i++) {

      const v =
        filters[keys[i]];

      if (v === null ||
          v === undefined) {
        continue;
      }

      if (Array.isArray(v)) {

        if (v.length > 0) {
          return false;
        }

      }

      else if (String(v).trim() !== "") {

        return false;

      }

    }

    return true;

  },


  build: function(filters, options) {

    filters = filters || {};
    options = options || {};

    /* Hanya cache kasus default (tanpa filter efektif).

       PENTING: frontend SELALU mengirim semua kunci filter
       walau isinya kosong (month:"", dates:[], ...). Jadi
       Object.keys().length selalu 9 -> dulu dianggap "ada
       filter" dan cache tidak pernah kena, akibatnya build
       61 detik diulang tiap request. Sekarang filter kosong
       dianggap default. */

    const isDefault =
      DashboardAnalytics.hasNoEffectiveFilter(filters);

    const key =
      "DASHBOARD_BUILD_" +
      (options.excludeAudits ? "FAST" : "FULL");

    if (isDefault) {

      const cache =
        CacheService.getScriptCache();

      try {

        var hit = cache.get(key);

        /* Kalau payload-nya besar, hasil disimpan
           terpecah (key_0, key_1, ...). Rangkai lagi. */

        if (!hit) {

          const meta =
            cache.get(key + "_META");

          if (meta) {

            const info = JSON.parse(meta);

            var parts = [];

            var complete = true;

            for (var pi = 0; pi < info.chunks; pi++) {

              const part =
                cache.get(key + "_" + pi);

              if (part === null || part === undefined) {

                complete = false;
                break;

              }

              parts.push(part);

            }

            if (complete) {

              hit = parts.join("");

            }

          }

        }

        if (hit) {

          const parsed = JSON.parse(hit);

          /* Staged load: audits selalu diambil terpisah. */

          if (options.excludeAudits) {

            parsed.audits = null;
            parsed.itemTrend = null;

          }

          return parsed;

        }

      }
      catch (ignore) {

        /* cache rusak -> hitung ulang */

      }

    }


    const result =
      this.buildUncached(filters, options);


    if (isDefault) {

      try {

        /* Payload ~0.22 MB (fast) — aman jauh di bawah
           batas 100 KB/key? Tidak. Jadi hanya simpan
           kalau muat; kalau tidak, biarkan (tetap benar,
           cuma tidak dipercepat). */

        const ser = JSON.stringify(result);

        if (ser.length < 100000) {

          CacheService
            .getScriptCache()
            .put(key, ser, DASHBOARD_CONFIG.CACHE_SECONDS);

        }
        else {

          /* Pecah jadi chunk seperti cache ETL. */

          const chunks = [];

          for (var ci = 0; ci * 90000 < ser.length; ci++) {

            chunks.push(ser.substr(ci * 90000, 90000));

          }

          const c2 = CacheService.getScriptCache();

          for (var cj = 0; cj < chunks.length; cj++) {

            c2.put(key + "_" + cj, chunks[cj],
              DASHBOARD_CONFIG.CACHE_SECONDS);

          }

          c2.put(key + "_META",
            JSON.stringify({ chunks: chunks.length }),
            DASHBOARD_CONFIG.CACHE_SECONDS);

          /* Penanda: hasil ada di chunk, bukan key tunggal. */

          c2.put(key + "_MODE", "CHUNK",
            DASHBOARD_CONFIG.CACHE_SECONDS);

        }

      }
      catch (writeError) {

        /* cache gagal -> tidak fatal */

      }

    }

    return result;

  },


  buildUncached: function(filters, options) {

    filters =
      filters || {};

    options =
      options || {};


    /*
     * PERF: reset memo per build().
     * buildAuditScores dipanggil 12x &
     * buildItemScores 5x oleh section
     * berbeda pada data yang SAMA —
     * tanpa memo, itu ~0,7s kerja ulang
     * per request.
     */

    this._memoAuditScores = null;
    this._memoItemScores = null;
    this._memoAuditData = null;


    const rawData =
      DashboardData
        .getData();


    const filtered =
      this.applyFilters(
        rawData,
        filters
      );


    const trendModes =
      this.getTrendModes(
        filtered
      );


    const products =
      this.getProducts(
        filtered
      );


    const items =
      this.getItems(
        filtered
      );


    const attributes =
      this.getAttributes(
        filtered
      );


    const painPoints =
      this.getPainPoints(
        filtered
      );


    const itemPainPoints =
      this.getItemPainPoints(
        filtered
      );


    return {


      /**********************************************
       * METADATA
       **********************************************/

      metadata:
        this.getMetadata(
          rawData
        ),


      /**********************************************
       * ACTIVE FILTER STATE
       **********************************************/

      filters:
        filters,


      /**********************************************
       * EXECUTIVE OVERVIEW
       **********************************************/

      overview:
        this.getOverview(
          filtered
        ),


      /**********************************************
       * PERIOD COMPARISON
       **********************************************/

      comparisons:
        this.getComparisons(
          filtered,
          filters
        ),


      /**********************************************
       * GRADE DISTRIBUTION
       **********************************************/

      gradeDistribution:
        this.getGradeDistribution(
          filtered
        ),


      /**********************************************
       * PRODUCT PERFORMANCE (level 1)
       **********************************************/

      products:
        products,


      /**********************************************
       * ITEM PERFORMANCE (level 2)
       **********************************************/

      items:
        items,


      /**********************************************
       * PARAMETER PERFORMANCE (level 3)
       **********************************************/

      attributes:
        attributes,


      /**********************************************
       * BRANCH PERFORMANCE
       **********************************************/

      outlets:
        this.getOutlets(
          filtered
        ),


      /**********************************************
       * QUALITY ATTENTION
       **********************************************/

      painPoints:
        painPoints,


      itemPainPoints:
        itemPainPoints,


      qualityAttention:
        painPoints.length
          ? painPoints[0]
          : null,


      /**********************************************
       * QUALITY TREND
       **********************************************/

      trend:
        trendModes.daily,


      trendModes:
        trendModes,


      /**********************************************
       * HOURLY (legacy, tidak ditampilkan
       * sebagai section terpisah)
       **********************************************/

      hourly:
        this.getHourlyTrend(
          filtered
        ),


      /**********************************************
       * AUDIT EXPLORER
       **********************************************/

      monthlyItemMatrix:
        this.getMonthlyItemMatrix(
          filtered
        ),


      monthlyBranchMatrix:
        this.getMonthlyBranchMatrix(
          filtered
        ),


      audits:
        options.excludeAudits
          ? null
          : this.getAuditSummary(
              filtered
            ),


      /**********************************************
       * PER-PRODUCT TREND
       **********************************************/

      productTrend:
        this.getProductTrend(
          filtered
        ),


      /**********************************************
       * PER-ITEM TREND
       **********************************************/

      /* PERF v2 (fase A): itemTrend tidak pernah dipakai
         frontend (0 referensi di JS.html) tapi membakar
         ~359 KB per request. Dipotong total dari payload.
         Kembalikan ke getItemTrend(filtered) kalau nanti
         ada chart item trend. Lihat wiki "Fase A". */
      itemTrend:
        null

    };

  },


  /**************************************************
   * FILTER
   *
   * Supported:
   *   dates[]      (multi-select, YYYY-MM-DD)
   *   date         (legacy single)
   *   weeks[]      (ISO 8601 week number)
   *   outlet[]     (BRANCH untuk dashboard ini)
   *   product[]
   *   item[]
   *   attribute[]  (parameter)
   *   grade[]
   **************************************************/

  applyFilters: function(
    data,
    filters
  ) {

    if (
      !data ||
      !data.length
    ) {

      return [];

    }


    /*
     * Filter grade harus dievaluasi pada level AUDIT,
     * bukan level baris parameter, karena grade
     * melekat pada audit agregat.
     */

    var allowedAuditIds =
      null;


    if (
      filters.grade &&
      filters.grade.length
    ) {

      const audits =
        this.buildAuditScores(
          data
        );


      allowedAuditIds =
        {};


      audits.forEach(
        function(audit) {

          if (
            filters.grade.indexOf(
              audit.grade
            ) !== -1
          ) {

            allowedAuditIds[
              audit.auditId
            ] = true;

          }

        }
      );

    }


    return data.filter(
      function(row) {


        /* ---------- GRADE ---------- */

        if (
          allowedAuditIds &&
          !allowedAuditIds[row.auditId]
        ) {

          return false;

        }


        /* ---------- BRANCH (kolom Outlet) ---------- */

        if (
          filters.outlet &&
          filters.outlet.length &&
          filters.outlet.indexOf(
            row.branch
          ) === -1
        ) {

          return false;

        }


        /* ---------- PRODUCT ---------- */

        if (
          filters.product &&
          filters.product.length &&
          filters.product.indexOf(
            row.product
          ) === -1
        ) {

          return false;

        }


        /* ---------- ITEM ---------- */

        if (
          filters.item &&
          filters.item.length &&
          filters.item.indexOf(
            row.item
          ) === -1
        ) {

          return false;

        }


        /* ---------- PARAMETER ---------- */

        if (
          filters.attribute &&
          filters.attribute.length &&
          filters.attribute.indexOf(
            row.attribute
          ) === -1
        ) {

          return false;

        }


        /* ---------- DATE ---------- */

        if (
          filters.date ||
          (
            filters.dates &&
            filters.dates.length
          )
        ) {

          const rowDate =
            row.dateKey ||
            dashboardDateKey(
              row.timestamp
            );


          if (
            filters.dates &&
            filters.dates.length
          ) {

            if (
              filters.dates.indexOf(
                rowDate
              ) === -1
            ) {

              return false;

            }

          }
          else if (
            filters.date &&
            rowDate !== filters.date
          ) {

            return false;

          }

        }


        /* ---------- WEEK ---------- */

        if (
          filters.weeks &&
          filters.weeks.length
        ) {

          const weekNo =
            row.week !== undefined &&
            row.week !== null
              ? row.week
              : dashboardWeekNumber(
                  row.timestamp
                );


          if (
            filters.weeks.indexOf(
              weekNo
            ) === -1
          ) {

            return false;

          }

        }


        /* ---------- MONTH ---------- */

        if (
          filters.month
        ) {

          const rowMonth =
            row.month ||
            dashboardMonthKey(
              row.timestamp
            );


          if (
            rowMonth !== filters.month
          ) {

            return false;

          }

        }


        return true;

      }
    );

  },


  /**************************************************
   * BUILD AUDIT SCORES
   *
   * Agregasi pada level audit_id. Hasilnya dipakai
   * ulang oleh hampir semua fungsi lain sehingga
   * angka antar-section selalu konsisten.
   **************************************************/

  buildAuditScores: function(data) {

    /*
     * MEMO: satu build() memakai data referensi
     * sama — hasil pertama dipakai ulang.
     */

    if (
      this._memoAuditScores &&
      this._memoAuditData === data
    ) {

      return this._memoAuditScores;

    }


    const grouped =
      {};


    if (
      !data ||
      !data.length
    ) {

      return [];

    }


    data.forEach(
      function(row) {

        if (
          !grouped[row.auditId]
        ) {

          grouped[row.auditId] =
            [];

        }


        grouped[row.auditId]
          .push(row);

      }
    );


    const result =
      Object.keys(grouped)
      .map(
        function(auditId) {

          const rows =
            grouped[auditId];


          const scores =
            rows
              .map(
                function(row) {

                  return row.score;

                }
              )
              .filter(
                function(score) {

                  return (
                    score !== null &&
                    score !== undefined &&
                    !isNaN(score)
                  );

                }
              );


          const score =
            dashboardAverage(
              scores
            );


          const first =
            rows[0];


          /*
           * Rincian per parameter. `item` disertakan
           * supaya drill-down tidak kehilangan konteks
           * hierarki (parameter mana milik item mana).
           */

          /*
           * PERF: attributes di-slim — tanpa
           * feedback/finding/note/evidenceFile
           * duplikat per baris (payload 8.4MB ->
           * ~2MB). Teks lengkap tetap tersedia
           * di feedback top-level audit.
           */

          const attributes =
            rows.map(
              function(row) {

                return {

                  item:
                    row.item,

                  attribute:
                    row.attribute,

                  score:
                    row.score,

                  scorePercent:
                    row.score === null ||
                    row.score === undefined
                      ? null
                      : dashboardRound(
                          row.score / 5 * 100
                        )

                };

              }
            );


          /*
           * Catatan per ITEM (`Catatan Khusus` di
           * sheet sumber). Satu audit menguji
           * beberapa item, jadi catatan digabung
           * per item — dedup supaya payload tetap
           * ramping (teks identik tidak diulang
           * untuk tiap parameter item itu).
           */

          const itemNotes =
            {};


          rows.forEach(
            function(row) {

              const text =
                String(
                  row.feedback || ""
                )
                .trim();

              if (!text) {

                return;

              }

              const key =
                row.item || "";

              if (!itemNotes[key]) {

                itemNotes[key] =
                  text;

              }

            }
          );


          return {

            auditId:
              auditId,

            submissionId:
              first.submissionId,

            timestamp:
              first.timestamp,

            dateKey:
              first.dateKey,

            month:
              first.month,

            week:
              first.week,

            name:
              first.name,

            auditor:
              first.name,

            outlet:
              first.branch,

            branch:
              first.branch,

            product:
              first.product,

            item:
              first.item,

            score:
              dashboardRound(
                score
              ),

            scorePercent:
              dashboardRound(
                score / 5 * 100
              ),

            grade:
              dashboardGetGrade(
                score
              ),

            feedback:
              first.feedback,

            documentation:
              first.documentation,

            evidenceFile:
              first.evidenceFile,

            parameterCount:
              rows.length,

            itemNotes:
              itemNotes,

            attributes:
              attributes

          };

        }
      );


    this._memoAuditScores =
      result;

    this._memoAuditData =
      data;


    return result;

  },


  /**************************************************
   * EXECUTIVE OVERVIEW
   **************************************************/

  getOverview: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    const scores =
      audits
        .map(
          function(audit) {

            return audit.score;

          }
        )
        .filter(
          function(value) {

            return (
              value !== null &&
              value !== undefined
            );

          }
        );


    const score =
      dashboardAverage(
        scores
      );


    /*
     * Ambang mengikuti Quality Standard (SOURCE
     * OF TRUTH) lewat DASHBOARD_CONFIG.SCORE_THRESHOLDS.
     * failCount = audit di bawah batas MIDDLE FAIL,
     * borderlineCount = rentang BORDERLINE PASS.
     */

    const T =
      dashboardThresholds();


    const failCount =
      audits.filter(
        function(audit) {

          return (
            audit.score !== null &&
            Number(audit.score) < T.MIDDLE_FAIL
          );

        }
      ).length;


    const borderlineCount =
      audits.filter(
        function(audit) {

          return (
            audit.score !== null &&
            Number(audit.score) >= T.BORDERLINE_PASS &&
            Number(audit.score) < T.MIDDLE_PASS
          );

        }
      ).length;


    /*
     * Under Borderline Rate:
     * audit dengan score di bawah batas BORDERLINE
     * PASS dibagi TOTAL audit (bukan total baris
     * parameter). Ambang WAJIB sama dengan tier
     * BORDERLINE PASS di Quality Standard.
     */

    const underBorderlineCount =
      audits.filter(
        function(audit) {

          return (
            audit.score !== null &&
            audit.score !== undefined &&
            Number(audit.score) < T.BORDERLINE_PASS
          );

        }
      ).length;


    const uniqueCount =
      function(list) {

        return new Set(
          list.filter(
            function(value) {

              return value;

            }
          )
        ).size;

      };


    return {

      score:
        dashboardRound(
          score
        ),

      scorePercent:
        dashboardRound(
          score / 5 * 100
        ),

      maxScore:
        5,

      grade:
        dashboardGetGrade(
          score
        ),

      auditCount:
        audits.length,

      failCount:
        failCount,

      borderlineCount:
        borderlineCount,

      underBorderlineCount:
        underBorderlineCount,

      underBorderlineRate:
        audits.length
          ? dashboardRound(
              underBorderlineCount /
              audits.length * 100
            )
          : null,

      failRate:
        audits.length
          ? dashboardRound(
              failCount /
              audits.length * 100
            )
          : null,

      outletCount:
        uniqueCount(
          audits.map(
            function(audit) {

              return audit.branch;

            }
          )
        ),

      branchCount:
        uniqueCount(
          audits.map(
            function(audit) {

              return audit.branch;

            }
          )
        ),

      productCount:
        uniqueCount(
          audits.map(
            function(audit) {

              return audit.product;

            }
          )
        ),

      itemCount:
        uniqueCount(
          this.buildItemScores(
            data
          ).map(
            function(itemAudit) {

              return itemAudit.item;

            }
          )
        ),

      attributeCount:
        uniqueCount(
          (
            function() {

              const list =
                [];


              audits.forEach(
                function(audit) {

                  (audit.attributes || [])
                    .forEach(
                      function(attribute) {

                        list.push(
                          attribute.attribute
                        );

                      }
                    );

                }
              );


              return list;

            }
          )()
        ),

      auditorCount:
        uniqueCount(
          audits.map(
            function(audit) {

              return audit.auditor;

            }
          )
        ),

      observationCount:
        data.length

    };

  },


  /**************************************************
   * GRADE DISTRIBUTION
   **************************************************/

  getGradeDistribution: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    const result = {

      "HIGH PASS":
        0,

      "MIDDLE PASS":
        0,

      "BORDERLINE PASS":
        0,

      "MIDDLE FAIL":
        0,

      "STRONG FAIL":
        0

    };


    audits.forEach(
      function(audit) {

        if (
          audit.grade &&
          result.hasOwnProperty(
            audit.grade
          )
        ) {

          result[audit.grade]++;

        }

      }
    );


    return result;

  },


  /**************************************************
   * PRODUCT PERFORMANCE (level 1)
   *
   * Setiap product membawa rincian item-nya
   * (level 2) untuk drill-down.
   **************************************************/

  getProducts: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    const itemAudits =
      this.buildItemScores(
        data
      );


    const grouped =
      {};


    audits.forEach(
      function(audit) {

        const product =
          audit.product || "(tidak diketahui)";


        if (!grouped[product]) {

          grouped[product] = {

            scores:
              [],

            audits:
              [],

            items:
              {}

          };

        }


        grouped[product]
          .scores
          .push(
            audit.score
          );


        grouped[product]
          .audits
          .push(
            audit
          );

      }
    );


    /*
     * Item diambil dari penilaian item (audit+item),
     * bukan dari audit, supaya produk dengan banyak
     * item tidak kehilangan rincian.
     */

    itemAudits.forEach(
      function(itemAudit) {

        const product =
          itemAudit.product || "(tidak diketahui)";


        const item =
          itemAudit.item || "(tidak diketahui)";


        if (!grouped[product]) {

          grouped[product] = {

            scores:
              [],

            audits:
              [],

            items:
              {}

          };

        }


        if (!grouped[product].items[item]) {

          grouped[product].items[item] = {

            scores:
              [],

            itemAudits:
              []

          };

        }


        grouped[product]
          .items[item]
          .scores
          .push(
            itemAudit.score
          );


        grouped[product]
          .items[item]
          .itemAudits
          .push(
            itemAudit
          );

      }
    );


    return Object.keys(grouped)
      .map(
        function(product) {

          const entry =
            grouped[product];


          const score =
            dashboardAverage(
              entry.scores
            );


          /* ---------- ITEM DETAIL ---------- */

          const items =
            Object.keys(entry.items)
              .map(
                function(item) {

                  const itemEntry =
                    entry.items[item];


                  const itemScore =
                    dashboardAverage(
                      itemEntry.scores
                    );


                  /* Parameter breakdown dalam item */

                  const parameterGroups =
                    {};


                  itemEntry.itemAudits.forEach(
                    function(itemAudit) {

                      itemAudit.parameters.forEach(
                        function(parameter) {

                          if (
                            parameter.score === null ||
                            parameter.score === undefined
                          ) {

                            return;

                          }


                          if (
                            !parameterGroups[
                              parameter.attribute
                            ]
                          ) {

                            parameterGroups[
                              parameter.attribute
                            ] = [];

                          }


                          parameterGroups[
                            parameter.attribute
                          ].push(
                            parameter.score
                          );

                        }
                      );

                    }
                  );


                  const parameters =
                    Object.keys(
                      parameterGroups
                    )
                    .map(
                      function(parameter) {

                        const parameterScore =
                          dashboardAverage(
                            parameterGroups[
                              parameter
                            ]
                          );


                        return {

                          attribute:
                            parameter,

                          score:
                            dashboardRound(
                              parameterScore
                            ),

                          scorePercent:
                            dashboardRound(
                              parameterScore / 5 * 100
                            ),

                          grade:
                            dashboardGetGrade(
                              parameterScore
                            ),

                          observations:
                            parameterGroups[
                              parameter
                            ].length

                        };

                      }
                    )
                    .sort(
                      function(a, b) {

                        return (
                          a.score -
                          b.score
                        );

                      }
                    );


                  return {

                    item:
                      item,

                    product:
                      product,

                    score:
                      dashboardRound(
                        itemScore
                      ),

                    scorePercent:
                      dashboardRound(
                        itemScore / 5 * 100
                      ),

                    grade:
                      dashboardGetGrade(
                        itemScore
                      ),

                    audits:
                      itemEntry.itemAudits.length,

                    parameters:
                      parameters

                  };

                }
              )
              .sort(
                function(a, b) {

                  return (
                    a.score -
                    b.score
                  );

                }
              );


          return {

            product:
              product,

            score:
              dashboardRound(
                score
              ),

            scorePercent:
              dashboardRound(
                score / 5 * 100
              ),

            grade:
              dashboardGetGrade(
                score
              ),

            audits:
              entry.audits.length,

            items:
              items

          };

        }
      )
      .sort(
        function(a, b) {

          return (
            b.score -
            a.score
          );

        }
      );

  },


  /**************************************************
   * BUILD ITEM AUDIT SCORES
   *
   * Unit observasi yang BENAR untuk level item.
   *
   * Kenapa perlu fungsi ini:
   * satu audit_id mencakup 1 produk tetapi BANYAK
   * item sekaligus (mis. audit Dimsum menguji
   * Siomay, Ceker, dan lain-lain dalam sekali
   * kunjungan). Jadi "item" TIDAK boleh diambil
   * dari item pertama audit — skor item harus
   * dihitung per pasangan (audit_id, item).
   *
   * Contoh nyata: audit_id punya 11 item berbeda,
   * maka ia menyumbang 11 skor item, bukan 1.
   *
   * Nama field `audits` di keluaran berarti
   * "jumlah penilaian item" (penilaian = satu
   * kombinasi audit_id + item), sehingga saat
   * dirata-rata tidak ada item dengan jumlah
   * parameter lebih banyak yang mendominasi.
   **************************************************/

  buildItemScores: function(data) {

    /*
     * MEMO: sama seperti buildAuditScores.
     */

    if (
      this._memoItemScores &&
      this._memoItemData === data
    ) {

      return this._memoItemScores;

    }


    const grouped =
      {};


    if (
      !data ||
      !data.length
    ) {

      return [];

    }


    data.forEach(
      function(row) {

        const key =
          row.auditId +
          "\u0000" +
          row.item;


        if (!grouped[key]) {

          grouped[key] =
            [];

        }


        grouped[key].push(
          row
        );

      }
    );


    const result =
      Object.keys(grouped)
      .map(
        function(key) {

          const rows =
            grouped[key];


          const scores =
            rows
              .map(
                function(row) {

                  return row.score;

                }
              )
              .filter(
                function(score) {

                  return (
                    score !== null &&
                    score !== undefined &&
                    !isNaN(score)
                  );

                }
              );


          const score =
            dashboardAverage(
              scores
            );


          const first =
            rows[0];


          /*
           * Parameter breakdown untuk item ini saja,
           * tidak seluruh parameter audit.
           */

          const parameterGroups =
            {};


          rows.forEach(
            function(row) {

              if (
                row.score === null ||
                row.score === undefined
              ) {

                return;

              }


              if (
                !parameterGroups[row.attribute]
              ) {

                parameterGroups[row.attribute] =
                  [];

              }


              parameterGroups[row.attribute]
                .push(
                  row.score
                );

            }
          );


          const parameters =
            Object.keys(parameterGroups)
              .map(
                function(parameter) {

                  const parameterScore =
                    dashboardAverage(
                      parameterGroups[parameter]
                    );


                  return {

                    attribute:
                      parameter,

                    score:
                      dashboardRound(
                        parameterScore
                      ),

                    scorePercent:
                      dashboardRound(
                        parameterScore / 5 * 100
                      ),

                    grade:
                      dashboardGetGrade(
                        parameterScore
                      ),

                    observations:
                      parameterGroups[
                        parameter
                      ].length

                  };

                }
              )
              .sort(
                function(a, b) {

                  return (
                    a.score -
                    b.score
                  );

                }
              );


          return {

            /* kunci tunggal, dipakai untuk filter grade */

            itemAuditId:
              key,

            auditId:
              first.auditId,

            outlet:
              first.branch,

            branch:
              first.branch,

            product:
              first.product,

            item:
              first.item,

            auditor:
              first.name,

            name:
              first.name,

            timestamp:
              first.timestamp,

            dateKey:
              first.dateKey,

            month:
              first.month,

            week:
              first.week,

            score:
              dashboardRound(
                score
              ),

            scorePercent:
              dashboardRound(
                score / 5 * 100
              ),

            grade:
              dashboardGetGrade(
                score
              ),

            parameterCount:
              rows.length,

            parameters:
              parameters

          };

        }
      );


    this._memoItemScores =
      result;

    this._memoItemData =
      data;


    return result;

  },


  /**************************************************
   * ITEM PERFORMANCE (level 2)
   *
   * Agregasi dari buildItemScores(), sehingga satu
   * kunjungan yang menguji 11 item menyumbang 11
   * penilaian — bukan 1.
   **************************************************/

  getItems: function(data) {

    const itemAudits =
      this.buildItemScores(
        data
      );


    const grouped =
      {};


    itemAudits.forEach(
      function(itemAudit) {

        const item =
          itemAudit.item || "(tidak diketahui)";


        if (!grouped[item]) {

          grouped[item] = {

            scores:
              [],

            itemAudits:
              [],

            products:
              {}

          };

        }


        grouped[item]
          .scores
          .push(
            itemAudit.score
          );


        grouped[item]
          .itemAudits
          .push(
            itemAudit
          );


        if (itemAudit.product) {

          grouped[item]
            .products[
              itemAudit.product
            ] = true;

        }

      }
    );


    return Object.keys(grouped)
      .map(
        function(item) {

          const entry =
            grouped[item];


          const score =
            dashboardAverage(
              entry.scores
            );


          /*
           * Parameter breakdown diagregasi ulang dari
           * seluruh itemAudit milik item ini.
           */

          const parameterGroups =
            {};


          entry.itemAudits.forEach(
            function(itemAudit) {

              itemAudit.parameters.forEach(
                function(parameter) {

                  if (
                    !parameterGroups[
                      parameter.attribute
                    ]
                  ) {

                    parameterGroups[
                      parameter.attribute
                    ] = [];

                  }


                  parameterGroups[
                    parameter.attribute
                  ].push(
                    parameter.score
                  );

                }
              );

            }
          );


          const parameters =
            Object.keys(
              parameterGroups
            )
            .map(
              function(parameter) {

                const parameterScore =
                  dashboardAverage(
                    parameterGroups[
                      parameter
                    ]
                  );


                return {

                  attribute:
                    parameter,

                  score:
                    dashboardRound(
                      parameterScore
                    ),

                  scorePercent:
                    dashboardRound(
                      parameterScore / 5 * 100
                    ),

                  grade:
                    dashboardGetGrade(
                      parameterScore
                    ),

                  observations:
                    parameterGroups[
                      parameter
                    ].length

                };

              }
            )
            .sort(
              function(a, b) {

                return (
                  a.score -
                  b.score
                );

              }
            );


          return {

            item:
              item,

            product:
              Object.keys(
                entry.products
              ).join(", "),

            score:
              dashboardRound(
                score
              ),

            scorePercent:
              dashboardRound(
                score / 5 * 100
              ),

            grade:
              dashboardGetGrade(
                score
              ),

            audits:
              entry.itemAudits.length,

            parameters:
              parameters

          };

        }
      )
      .sort(
        function(a, b) {

          return (
            b.score -
            a.score
          );

        }
      );

  },


  /**************************************************
   * PARAMETER PERFORMANCE (level 3)
   **************************************************/

  getAttributes: function(data) {

    const grouped =
      {};


    data.forEach(
      function(row) {

        if (
          row.score === null ||
          row.score === undefined
        ) {

          return;

        }


        if (
          !grouped[row.attribute]
        ) {

          grouped[row.attribute] = {

            scores:
              [],

            items:
              {}

          };

        }


        grouped[row.attribute]
          .scores
          .push(
            row.score
          );


        if (row.item) {

          grouped[row.attribute]
            .items[row.item] =
              true;

        }

      }
    );


    return Object.keys(grouped)
      .map(
        function(attribute) {

          const entry =
            grouped[attribute];


          const scores =
            entry.scores;


          const score =
            dashboardAverage(
              scores
            );


          const T =
            dashboardThresholds();


          const lowCount =
            scores.filter(
              function(value) {

                return (
                  Number(value) <
                  T.BORDERLINE_PASS
                );

              }
            ).length;


          return {

            attribute:
              attribute,

            items:
              Object.keys(
                entry.items
              ).join(", "),

            score:
              dashboardRound(
                score
              ),

            scorePercent:
              dashboardRound(
                score / 5 * 100
              ),

            grade:
              dashboardGetGrade(
                score
              ),

            observations:
              scores.length,

            lowScoreCount:
              lowCount,

            lowScoreRate:
              scores.length
                ? dashboardRound(
                    lowCount /
                    scores.length * 100
                  )
                : 0

          };

        }
      )
      .sort(
        function(a, b) {

          return (
            a.score -
            b.score
          );

        }
      );

  },


  /**************************************************
   * BRANCH PERFORMANCE
   *
   * Catatan: kolom "Outlet" pada sheet sumber berisi
   * nama BRAND ("Dikichi") untuk seluruh baris,
   * sedangkan nama cabang ada di kolom
   * "Branch / Cabang". Karena itu section ini
   * menghitung per CABANG.
   **************************************************/

  getOutlets: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    const grouped =
      {};


    audits.forEach(
      function(audit) {

        const branch =
          audit.branch || "(tidak diketahui)";


        if (!grouped[branch]) {

          grouped[branch] = {

            scores:
              [],

            audits:
              [],

            products:
              {}

          };

        }


        grouped[branch]
          .scores
          .push(
            audit.score
          );


        grouped[branch]
          .audits
          .push(
            audit
          );


        if (audit.product) {

          grouped[branch]
            .products[
              audit.product
            ] = true;

        }

      }
    );


    return Object.keys(grouped)
      .map(
        function(branch) {

          const entry =
            grouped[branch];


          const score =
            dashboardAverage(
              entry.scores
            );


          const productScores =
            {};


          entry.audits.forEach(
            function(audit) {

              if (!productScores[audit.product]) {

                productScores[audit.product] =
                  [];

              }


              productScores[audit.product]
                .push(
                  audit.score
                );

            }
          );


          const products =
            Object.keys(productScores)
              .map(
                function(product) {

                  const productScore =
                    dashboardAverage(
                      productScores[product]
                    );


                  return {

                    product:
                      product,

                    score:
                      dashboardRound(
                        productScore
                      ),

                    grade:
                      dashboardGetGrade(
                        productScore
                      ),

                    audits:
                      productScores[
                        product
                      ].length

                  };

                }
              )
              .sort(
                function(a, b) {

                  return (
                    a.score -
                    b.score
                  );

                }
              );


          return {

            outlet:
              branch,

            branch:
              branch,

            score:
              dashboardRound(
                score
              ),

            scorePercent:
              dashboardRound(
                score / 5 * 100
              ),

            grade:
              dashboardGetGrade(
                score
              ),

            audits:
              entry.audits.length,

            products:
              products

          };

        }
      )
      .sort(
        function(a, b) {

          return (
            b.score -
            a.score
          );

        }
      );

  },


  /**************************************************
   * QUALITY ATTENTION (PARAMETER LEVEL)
   *
   * Priority score gabungan:
   *   gap dari HIGH PASS  x 0.50
   *   low score rate      x 0.25
   *   grade risk weight   x 0.25
   **************************************************/

  getPainPoints: function(data) {

    const attributes =
      this.getAttributes(
        data
      );


    return attributes
      .map(
        function(item) {

          /*
           * Jarak ke batas HIGH PASS (4.50), bukan ke
           * skor maksimum 5.00 — konsisten dengan
           * standar Kintoun.
           */

          const gapFromHighPass =
            Math.max(
              0,
              dashboardThresholds().HIGH_PASS -
                item.score
            );


          const lowScoreRate =
            item.lowScoreRate / 100;


          const gradeWeight =
            dashboardGradeWeight(
              item.grade
            );


          const attentionScore =
            (
              gapFromHighPass * 0.50
            ) +
            (
              lowScoreRate * 0.25
            ) +
            (
              gradeWeight * 0.25
            );


          return {

            attribute:
              item.attribute,

            items:
              item.items,

            score:
              item.score,

            scorePercent:
              item.scorePercent,

            grade:
              item.grade,

            observations:
              item.observations,

            lowScoreCount:
              item.lowScoreCount,

            lowScoreRate:
              item.lowScoreRate,

            gradeWeight:
              gradeWeight,

            gapFromHighPass:
              dashboardRound(
                gapFromHighPass
              ),

            attentionScore:
              dashboardRound(
                attentionScore,
                3
              )

          };

        }
      )
      .sort(
        function(a, b) {

          return (
            b.attentionScore -
            a.attentionScore
          );

        }
      );

  },


  /**************************************************
   * QUALITY ATTENTION (ITEM LEVEL)
   **************************************************/

  getItemPainPoints: function(data) {

    const items =
      this.getItems(
        data
      );


    return items
      .map(
        function(item) {

          /*
           * Jarak ke batas HIGH PASS (4.50), bukan ke
           * skor maksimum 5.00 — konsisten dengan
           * standar Kintoun.
           */

          const gapFromHighPass =
            Math.max(
              0,
              dashboardThresholds().HIGH_PASS -
                item.score
            );


          const audits =
            item.audits || 0;


          /*
           * Rasio parameter item yang berada di bawah
           * BORDERLINE PASS (score < 3.00) sebagai
           * proxy risiko item.
           *
           * `item.audits` pada level item berarti jumlah
           * PENILAIAN ITEM (audit+item), bukan jumlah
           * audit unik.
           */

          const lowParameters =
            (item.parameters || [])
              .filter(
                function(parameter) {

                  return (
                    Number(parameter.score) <
                    dashboardThresholds().BORDERLINE_PASS
                  );

                }
              ).length;


          const totalParameters =
            (item.parameters || []).length;


          const lowRate =
            totalParameters
              ? lowParameters / totalParameters
              : 0;


          const gradeWeight =
            dashboardGradeWeight(
              item.grade
            );


          const attentionScore =
            (
              gapFromHighPass * 0.50
            ) +
            (
              lowRate * 0.25
            ) +
            (
              gradeWeight * 0.25
            );


          return {

            item:
              item.item,

            product:
              item.product,

            score:
              item.score,

            scorePercent:
              item.scorePercent,

            grade:
              item.grade,

            audits:
              audits,

            lowParameterCount:
              lowParameters,

            parameterCount:
              totalParameters,

            lowRate:
              dashboardRound(
                lowRate * 100
              ),

            gradeWeight:
              gradeWeight,

            gapFromHighPass:
              dashboardRound(
                gapFromHighPass
              ),

            attentionScore:
              dashboardRound(
                attentionScore,
                3
              )

          };

        }
      )
      .sort(
        function(a, b) {

          return (
            b.attentionScore -
            a.attentionScore
          );

        }
      );

  },


  /**************************************************
   * TREND MODES
   **************************************************/

  getTrendModes: function(data) {

    return {

      allTime:
        this.getAllTimeTrend(
          data
        ),

      daily:
        this.getDailyTrend(
          data
        ),

      weekly:
        this.getWeeklyTrend(
          data
        ),

      monthly:
        this.getMonthlyTrend(
          data
        )

    };

  },


  /**************************************************
   * TREND HELPER
   *
   * Semua mode trend memakai bentuk output yang
   * sama supaya frontend cukup punya satu renderer.
   **************************************************/

  buildTrend: function(data, keyFunction, labelFunction) {

    const audits =
      this.buildAuditScores(
        data
      );


    const grouped =
      {};


    audits.forEach(
      function(audit) {

        if (
          audit.score === null ||
          audit.score === undefined
        ) {

          return;

        }


        const key =
          keyFunction(
            audit
          );


        if (!key) {

          return;

        }


        if (!grouped[key]) {

          grouped[key] = {

            scores:
              [],

            audits:
              []

          };

        }


        grouped[key]
          .scores
          .push(
            audit.score
          );


        grouped[key]
          .audits
          .push(
            audit
          );

      }
    );


    return Object.keys(grouped)
      .sort()
      .map(
        function(key) {

          const entry =
            grouped[key];


          const score =
            dashboardAverage(
              entry.scores
            );


          return {

            period:
              key,

            label:
              labelFunction
                ? labelFunction(key)
                : key,

            date:
              key,

            score:
              dashboardRound(
                score
              ),

            scorePercent:
              dashboardRound(
                score / 5 * 100
              ),

            grade:
              dashboardGetGrade(
                score
              ),

            audits:
              entry.audits.length

          };

        }
      );

  },


  /**************************************************
   * ALL TIME TREND (granularitas jam)
   **************************************************/

  getAllTimeTrend: function(data) {

    return this.buildTrend(
      data,
      function(audit) {

        return (
          audit.timestamp
            ? dashboardHourKey(
                audit.timestamp
              )
            : ""
        );

      }
    );

  },


  /**************************************************
   * DAILY TREND
   **************************************************/

  getDailyTrend: function(data) {

    return this.buildTrend(
      data,
      function(audit) {

        return audit.dateKey ||
          dashboardDateKey(
            audit.timestamp
          );

      }
    );

  },


  /**************************************************
   * WEEKLY TREND (ISO 8601)
   **************************************************/

  getWeeklyTrend: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    const grouped =
      {};


    audits.forEach(
      function(audit) {

        if (
          audit.score === null ||
          audit.score === undefined
        ) {

          return;

        }


        const date =
          dashboardDateKey(
            audit.timestamp
          );


        /*
         * Kunci sort harus kronologis. Memakai nomor
         * minggu saja akan salah karena "Week 52"
         * (Desember) akan terurut sebelum "Week 02"
         * (Januari) bila dibandingkan sebagai string.
         * Karena itu kunci memakai tahun + nomor minggu.
         */

        const year =
          date
            ? date.substring(0, 4)
            : "";


        const week =
          audit.week !== undefined &&
          audit.week !== null
            ? audit.week
            : dashboardWeekNumber(
                audit.timestamp
              );


        if (!year || !week) {

          return;

        }


        const key =
          year +
          "-W" +
          String(week).padStart(
            2,
            "0"
          );


        if (!grouped[key]) {

          grouped[key] = {

            scores:
              [],

            audits:
              []

          };

        }


        grouped[key]
          .scores
          .push(
            audit.score
          );


        grouped[key]
          .audits
          .push(
            audit
          );

      }
    );


    return Object.keys(grouped)
      .sort()
      .map(
        function(key) {

          const entry =
            grouped[key];


          const score =
            dashboardAverage(
              entry.scores
            );


          return {

            period:
              key,

            label:
              key.replace(
                "-W",
                " W"
              ),

            date:
              key,

            score:
              dashboardRound(
                score
              ),

            scorePercent:
              dashboardRound(
                score / 5 * 100
              ),

            grade:
              dashboardGetGrade(
                score
              ),

            audits:
              entry.audits.length

          };

        }
      );

  },


  /**************************************************
   * MONTHLY TREND
   **************************************************/

  getMonthlyTrend: function(data) {

    return this.buildTrend(
      data,
      function(audit) {

        return audit.month ||
          dashboardMonthKey(
            audit.timestamp
          );

      }
    );

  },


  /**************************************************
   * HOURLY TREND (legacy)
   **************************************************/

  getHourlyTrend: function(data) {

    return this.buildTrend(
      data,
      function(audit) {

        return (
          audit.timestamp
            ? dashboardHourKey(
                audit.timestamp
              )
            : ""
        );

      }
    );

  },


  /**************************************************
   * PERIOD COMPARISON
   **************************************************/

  getComparisons: function(data, filters) {

    const audits =
      this.buildAuditScores(
        data
      );


    if (!audits.length) {

      return {

        today:
          null,

        week:
          null,

        month:
          null

      };

    }


    /*
     * Titik acuan = tanggal audit terbaru pada
     * dataset yang sedang difilter. Memakai
     * "hari ini" akan menghasilkan perbandingan
     * kosong ketika data historis.
     */

    const timestamps =
      audits
        .map(
          function(audit) {

            return new Date(
              audit.timestamp
            ).getTime();

          }
        )
        .filter(
          function(value) {

            return !isNaN(value);

          }
        );


    if (!timestamps.length) {

      return {

        today:
          null,

        week:
          null,

        month:
          null

      };

    }


    const reference =
      new Date(
        Math.max.apply(
          null,
          timestamps
        )
      );


    return {

      today:
        this.comparePeriods(
          audits,
          "day",
          reference
        ),

      week:
        this.comparePeriods(
          audits,
          "week",
          reference
        ),

      month:
        this.getMonthlyComparison(
          data
        )

    };

  },


  /**************************************************
   * COMPARE PERIODS
   *
   * Membandingkan periode berjalan dengan periode
   * sebelumnya yang sama panjang (dihitung mundur
   * dari tanggal acuan).
   **************************************************/

  /**************************************************
   * MONTHLY COMPARISON (GAUGE)
   *
   * This Month = bulan terakhir yang sampelnya
   * memadai (>= MONTH_COMPARISON_MIN_AUDITS).
   * Last Month = bulan kalender tepat sebelumnya.
   * Memakai bucket kalender nyata, bukan baris
   * terakhir dataset.
   **************************************************/

  getMonthlyComparison: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    const minAudits =
      (
        typeof DASHBOARD_CONFIG !== "undefined" &&
        DASHBOARD_CONFIG.MONTH_COMPARISON_MIN_AUDITS
      )
        ? DASHBOARD_CONFIG.MONTH_COMPARISON_MIN_AUDITS
        : 20;


    const buckets = {};


    audits.forEach(
      function(audit) {

        const key =
          audit.month;

        if (!key) {

          return;

        }


        if (!buckets[key]) {

          buckets[key] = [];

        }


        buckets[key].push(
          audit
        );

      }
    );


    const months =
      Object.keys(buckets)
        .sort();


    if (!months.length) {

      return null;

    }


    /* bulan terakhir yang jumlah auditnya memadai */

    let currentKey = null;

    for (
      let i = months.length - 1;
      i >= 0;
      i--
    ) {

      if (buckets[months[i]].length >= minAudits) {

        currentKey = months[i];

        break;

      }

    }


    /* fallback: bulan terakhir yang punya data */

    if (!currentKey) {

      currentKey = months[months.length - 1];

    }


    /* bulan kalender tepat satu bulan sebelum currentKey */

    const parts =
      String(currentKey)
        .split("-");

    const previousKey =
      dashboardMonthKey(
        new Date(
          Number(parts[0]),
          Number(parts[1]) - 2,
          1
        )
      );


    const currentSummary =
      this.summarizeAuditBucket(
        buckets[currentKey] || []
      );


    const previousList =
      buckets[previousKey] || [];


    const previousSummary =
      previousList.length
        ? this.summarizeAuditBucket(
            previousList
          )
        : null;


    const difference =
      (
        currentSummary &&
        currentSummary.score !== null &&
        previousSummary &&
        previousSummary.score !== null
      )
        ? dashboardRound(
            currentSummary.score -
            previousSummary.score
          )
        : null;


    return {

      granularity:
        "month",

      current:
        currentSummary,

      previous:
        previousSummary,

      score:
        currentSummary
          ? currentSummary.score
          : null,

      previousScore:
        previousSummary
          ? previousSummary.score
          : null,

      difference:
        difference,

      direction:
        difference === null
          ? null
          : difference > 0
            ? "up"
            : difference < 0
              ? "down"
              : "flat",

      currentLabel:
        "This month",

      previousLabel:
        "Last month",

      currentMonth:
        currentKey,

      previousMonth:
        previousKey,

      minAudits:
        minAudits,

      sampleSufficient:
        (
          buckets[currentKey] || []
        ).length >= minAudits,

      currentRange:
        currentKey,

      previousRange:
        previousKey

    };

  },


  /**************************************************
   * SUMMARIZE AUDIT BUCKET
   *
   * Ringkasan skor untuk satu periode (daftar
   * audit sudah dibatasi ke periode tersebut).
   **************************************************/

  summarizeAuditBucket: function(list) {

    const scores =
      list
        .map(
          function(audit) {

            return audit.score;

          }
        )
        .filter(
          function(value) {

            return (
              value !== null &&
              value !== undefined &&
              !isNaN(
                Number(value)
              )
            );

          }
        );


    if (!list.length || !scores.length) {

      return {

        score: null,

        scorePercent: null,

        grade: null,

        auditCount: list.length,

        failCount: 0,

        underBorderlineCount: 0

      };

    }


    const score =
      dashboardAverage(
        scores
      );


    return {

      score:
        dashboardRound(
          score
        ),

      scorePercent:
        dashboardRound(
          score / 5 * 100
        ),

      grade:
        dashboardGetGrade(
          score
        ),

      auditCount:
        list.length,

      failCount:
        list.filter(
          function(audit) {

            return (
              Number(audit.score) <
              dashboardThresholds().MIDDLE_FAIL
            );

          }
        ).length,

      underBorderlineCount:
        list.filter(
          function(audit) {

            return (
              Number(audit.score) <
              dashboardThresholds().BORDERLINE_PASS
            );

          }
        ).length

    };

  },


  comparePeriods: function(
    audits,
    granularity,
    reference
  ) {

    const startOfDay =
      function(date) {

        return new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate()
        );

      };


    var currentStart;
    var currentEnd;
    var previousStart;
    var previousEnd;
    var currentLabel;
    var previousLabel;


    if (granularity === "day") {

      currentStart =
        startOfDay(
          reference
        );


      currentEnd =
        new Date(
          currentStart.getTime() +
          86399999
        );


      previousStart =
        new Date(
          currentStart.getTime() -
          86400000
        );


      previousEnd =
        new Date(
          currentStart.getTime() -
          1
        );


      currentLabel =
        "Today";


      previousLabel =
        "Previous day";

    }
    else if (granularity === "week") {

      const day =
        reference.getDay();


      const offsetToMonday =
        day === 0
          ? 6
          : day - 1;


      currentStart =
        startOfDay(
          new Date(
            reference.getTime() -
            offsetToMonday * 86400000
          )
        );


      currentEnd =
        new Date(
          currentStart.getTime() +
          7 * 86400000 -
          1
        );


      previousStart =
        new Date(
          currentStart.getTime() -
          7 * 86400000
        );


      previousEnd =
        new Date(
          currentStart.getTime() -
          1
        );


      currentLabel =
        "This week";


      previousLabel =
        "Last week";

    }
    else {

      currentStart =
        new Date(
          reference.getFullYear(),
          reference.getMonth(),
          1
        );


      currentEnd =
        new Date(
          reference.getFullYear(),
          reference.getMonth() + 1,
          0,
          23,
          59,
          59,
          999
        );


      previousStart =
        new Date(
          reference.getFullYear(),
          reference.getMonth() - 1,
          1
        );


      previousEnd =
        new Date(
          reference.getFullYear(),
          reference.getMonth(),
          0,
          23,
          59,
          59,
          999
        );


      currentLabel =
        "This month";


      previousLabel =
        "Last month";

    }


    const current =
      this.summarizeRange(
        audits,
        currentStart,
        currentEnd
      );


    const previous =
      this.summarizeRange(
        audits,
        previousStart,
        previousEnd
      );


    const difference =
      current.score !== null &&
      previous.score !== null
        ? dashboardRound(
            current.score -
            previous.score
          )
        : null;


    return {

      granularity:
        granularity,

      current:
        current,

      previous:
        previous,

      score:
        current.score,

      previousScore:
        previous.score,

      difference:
        difference,

      direction:
        difference === null
          ? null
          : difference > 0
            ? "up"
            : difference < 0
              ? "down"
              : "flat",

      currentLabel:
        currentLabel,

      previousLabel:
        previousLabel,

      currentRange:
        dashboardDateKey(
          currentStart
        ) +
        " s/d " +
        dashboardDateKey(
          currentEnd
        ),

      previousRange:
        dashboardDateKey(
          previousStart
        ) +
        " s/d " +
        dashboardDateKey(
          previousEnd
        )

    };

  },


  /**************************************************
   * SUMMARIZE RANGE
   **************************************************/

  summarizeRange: function(
    audits,
    start,
    end
  ) {

    const within =
      audits.filter(
        function(audit) {

          const time =
            new Date(
              audit.timestamp
            ).getTime();


          return (
            !isNaN(time) &&
            time >= start.getTime() &&
            time <= end.getTime()
          );

        }
      );


    const scores =
      within
        .map(
          function(audit) {

            return audit.score;

          }
        )
        .filter(
          function(value) {

            return (
              value !== null &&
              value !== undefined
            );

          }
        );


    const score =
      dashboardAverage(
        scores
      );


    return {

      score:
        within.length
          ? dashboardRound(
              score
            )
          : null,

      scorePercent:
        within.length
          ? dashboardRound(
              score / 5 * 100
            )
          : null,

      grade:
        within.length
          ? dashboardGetGrade(
              score
            )
          : null,

      auditCount:
        within.length,

      failCount:
        within.filter(
          function(audit) {

            return (
              Number(audit.score) <
              dashboardThresholds().MIDDLE_FAIL
            );

          }
        ).length,

      underBorderlineCount:
        within.filter(
          function(audit) {

            return (
              Number(audit.score) <
              dashboardThresholds().BORDERLINE_PASS
            );

          }
        ).length

    };

  },


  /**************************************************
   * AUDIT EXPLORER
   **************************************************/

  /**************************************************
   * MONTHLY ITEM MATRIX (TABLE A)
   *
   * Skor rata-rata per ITEM per bulan (yyyy-MM),
   * dikelompokkan per product. Unit = skor audit
   * per (audit_id, item) — sama dengan level 2.
   * Missing month = null (bukan 0).
   **************************************************/

  getMonthlyItemMatrix: function(data) {

    /*
     * Unit observasi = (audit_id, item), sama dengan
     * level 2 dashboard (buildItemScores). TIDAK
     * merata-rata baris parameter langsung, karena
     * itu memberi bobot lebih pada item dengan
     * jumlah parameter lebih banyak.
     */

    const itemAudits =
      this.buildItemScores(
        data
      );


    const monthsSet = {};
    const groupsMap = {};


    itemAudits.forEach(
      function(ia) {

        if (
          !ia.item ||
          !ia.month ||
          ia.score === null ||
          ia.score === undefined ||
          isNaN(Number(ia.score))
        ) {

          return;

        }


        monthsSet[ia.month] = true;


        const product =
          ia.product || "Other";


        if (!groupsMap[product]) {

          groupsMap[product] = {
            product: product,
            itemMap: {}
          };

        }


        if (!groupsMap[product].itemMap[ia.item]) {

          groupsMap[product].itemMap[ia.item] = {
            item: ia.item,
            sums: {},
            counts: {}
          };

        }


        const cell =
          groupsMap[product].itemMap[ia.item];

        const value =
          Number(ia.score);


        cell.sums[ia.month] =
          (cell.sums[ia.month] || 0) + value;

        cell.counts[ia.month] =
          (cell.counts[ia.month] || 0) + 1;

      }
    );


    const months =
      Object.keys(monthsSet)
        .sort();


    const groups =
      Object.keys(groupsMap)
        .sort()
        .map(
          function(product) {

            const source =
              groupsMap[product];

            const items =
              Object.keys(source.itemMap)
                .sort()
                .map(
                  function(itemName) {

                    const src =
                      source.itemMap[itemName];

                    const scores = {};

                    months.forEach(
                      function(m) {

                        scores[m] =
                          src.counts[m]
                            ? dashboardRound(
                                src.sums[m] /
                                src.counts[m]
                              )
                            : null;

                      }
                    );


                    return {

                      item:
                        itemName,

                      scores:
                        scores,

                      auditCount:
                        months.reduce(
                          function(total, m) {

                            return total +
                              (src.counts[m] || 0);

                          },
                          0
                        )

                    };

                  }
                );


            return {

              product:
                product,

              items:
                items

            };

          }
        );


    return {

      months:
        months,

      groups:
        groups

    };

  },


  getMonthlyBranchMatrix: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    const monthsSet = {};
    const branchMap = {};


    audits.forEach(
      function(audit) {

        if (
          !audit.branch ||
          !audit.month ||
          audit.score === null ||
          audit.score === undefined
        ) {

          return;

        }


        monthsSet[audit.month] = true;


        if (!branchMap[audit.branch]) {

          branchMap[audit.branch] = {
            branch: audit.branch,
            sums: {},
            counts: {}
          };

        }


        const cell =
          branchMap[audit.branch];

        cell.sums[audit.month] =
          (cell.sums[audit.month] || 0) +
          audit.score;

        cell.counts[audit.month] =
          (cell.counts[audit.month] || 0) + 1;

      }
    );


    const months =
      Object.keys(monthsSet).sort();


    const branches =
      Object.keys(branchMap)
        .sort()
        .map(
          function(name) {

            const src =
              branchMap[name];

            const scores = {};

            months.forEach(
              function(m) {

                scores[m] =
                  src.counts[m]
                    ? dashboardRound(
                        src.sums[m] /
                        src.counts[m]
                      )
                    : null;

              }
            );


            return {
              branch: name,
              scores: scores
            };

          }
        );


    const years = {};

    months.forEach(
      function(m) {

        const year =
          m.slice(0, 4);

        if (!years[year]) {

          years[year] = [];

        }

        years[year].push(m);

      }
    );


    return {
      years: years,
      branches: branches
    };

  },


  getAuditSummary: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    return audits.sort(
      function(a, b) {

        return (
          new Date(b.timestamp).getTime() -
          new Date(a.timestamp).getTime()
        );

      }
    );

  },


  /**************************************************
   * PER-PRODUCT TREND
   *
   * Returns: { productName: [{date, score}] }
   **************************************************/

  getProductTrend: function(data) {

    const audits =
      this.buildAuditScores(
        data
      );


    const byProduct =
      {};


    audits.forEach(
      function(audit) {

        if (
          audit.score === null ||
          audit.score === undefined
        ) {

          return;

        }


        const product =
          audit.product || "Unknown";


        if (!byProduct[product]) {

          byProduct[product] =
            [];

        }


        byProduct[product].push({

          date:
            audit.dateKey ||
            dashboardDateKey(
              audit.timestamp
            ),

          score:
            audit.score,

          grade:
            audit.grade

        });

      }
    );


    Object.keys(byProduct)
      .forEach(
        function(product) {

          byProduct[product].sort(
            function(a, b) {

              return a.date < b.date
                ? -1
                : a.date > b.date
                  ? 1
                  : 0;

            }
          );

        }
      );


    return byProduct;

  },


  /**************************************************
   * PER-ITEM TREND
   *
   * Returns: { itemName: [{date, score}] }
   **************************************************/

  getItemTrend: function(data) {

    const itemAudits =
      this.buildItemScores(
        data
      );


    const byItem =
      {};


    itemAudits.forEach(
      function(itemAudit) {

        if (
          itemAudit.score === null ||
          itemAudit.score === undefined
        ) {

          return;

        }


        const item =
          itemAudit.item || "Unknown";


        if (!byItem[item]) {

          byItem[item] =
            [];

        }


        byItem[item].push({

          date:
            itemAudit.dateKey ||
            dashboardDateKey(
              itemAudit.timestamp
            ),

          score:
            itemAudit.score,

          grade:
            itemAudit.grade

        });

      }
    );


    Object.keys(byItem)
      .forEach(
        function(item) {

          byItem[item].sort(
            function(a, b) {

              return a.date < b.date
                ? -1
                : a.date > b.date
                  ? 1
                  : 0;

            }
          );

        }
      );


    return byItem;

  },


  /**************************************************
   * METADATA
   *
   * Dipakai frontend untuk mengisi filter dan
   * menampilkan status data.
   **************************************************/

  getMetadata: function(data) {

    const outlets =
      new Set();

    const products =
      new Set();

    const items =
      new Set();

    const attributes =
      new Set();

    const auditors =
      new Set();

    const dates =
      new Set();

    const months =
      new Set();


    data.forEach(
      function(row) {

        if (row.branch) {

          outlets.add(
            row.branch
          );

        }


        if (row.product) {

          products.add(
            row.product
          );

        }


        if (row.item) {

          items.add(
            row.item
          );

        }


        if (row.attribute) {

          attributes.add(
            row.attribute
          );

        }


        if (row.name) {

          auditors.add(
            row.name
          );

        }


        if (row.timestamp) {

          const date =
            new Date(
              row.timestamp
            );


          if (
            !isNaN(
              date.getTime()
            )
          ) {

            dates.add(
              dashboardDateKey(
                date
              )
            );


            months.add(
              dashboardMonthKey(
                date
              )
            );

          }

        }

      }
    );


    return {

      outlets:
        Array.from(outlets)
          .sort(),

      branches:
        Array.from(outlets)
          .sort(),

      products:
        Array.from(products)
          .sort(),

      items:
        Array.from(items)
          .sort(),

      attributes:
        Array.from(attributes)
          .sort(),

      auditors:
        Array.from(auditors)
          .sort(),

      grades: [

        "HIGH PASS",

        "MIDDLE PASS",

        "BORDERLINE PASS",

        "MIDDLE FAIL",

        "STRONG FAIL"

      ],

      dates:
        Array.from(dates)
          .sort(),

      months:
        Array.from(months)
          .sort(),

      lastUpdated:
        new Date()
          .toISOString(),

      totalRows:
        data.length,

      outletFilter:
        DASHBOARD_CONFIG
          .OUTLET_FILTER,

      brand:
        DASHBOARD_CONFIG
          .BRAND
            .NAME,

      spreadsheetId:
        DASHBOARD_CONFIG
          .SPREADSHEET_ID,

      sheetName:
        DASHBOARD_CONFIG
          .MASTER_SHEET

    };

  }


};


/****************************************************
 * COMPATIBILITY ENTRY POINT
 *
 * Dipakai oleh fungsi diagnostic / test yang
 * memanggil DashboardAnalytics.getAnalytics().
 * Engine utama tetap build().
 ****************************************************/

DashboardAnalytics.getAnalytics = function(filters) {

  return DashboardAnalytics.build(
    filters || {}
  );

};
