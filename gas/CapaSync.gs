/**
 * Sends item findings to PE Platform. Set CAPA_INGEST_URL and CAPA_INGEST_SECRET
 * in Script Properties, then run installCapaSync once from the script editor.
 */
function installCapaSync() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("CAPA_INGEST_URL") || !props.getProperty("CAPA_INGEST_SECRET")) {
    throw new Error("CAPA sync settings are missing");
  }
  if (!props.getProperty("CAPA_SYNC_START_AT")) {
    props.setProperty("CAPA_SYNC_START_AT", new Date().toISOString());
  }
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "syncDikichiCapa") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("syncDikichiCapa").timeBased().everyMinutes(5).create();
}

function syncDikichiCapa() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    // Read the source sheet. The dashboard cache can be up to 30 minutes old.
    var rows = DashboardData.readFromSheet();
    var grouped = {};
    rows.forEach(function(row) {
      if (row.score === null || row.score === undefined || !isFinite(Number(row.score))) return;
      var key = row.auditId + "\u0000" + row.item;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    });
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty("CAPA_INGEST_URL");
    var secret = props.getProperty("CAPA_INGEST_SECRET");
    var startAt = Date.parse(props.getProperty("CAPA_SYNC_START_AT") || "");
    var lastSuccessAt = Date.parse(props.getProperty("CAPA_SYNC_LAST_SUCCESS_AT") || "");
    var scanFrom = Math.max(startAt, isFinite(lastSuccessAt) ? lastSuccessAt - 24 * 60 * 60 * 1000 : startAt);
    var failed = false;
    var allProperties = props.getProperties();
    var sent = {};
    var retainedSince = Date.now() - 14 * 24 * 60 * 60 * 1000;
    Object.keys(allProperties).forEach(function(name) {
      if (name.indexOf("CAPA_SENT_") !== 0) return;
      if (Number(allProperties[name]) < retainedSince) props.deleteProperty(name);
      else sent[name] = true;
    });
    if (!url || !secret || !isFinite(startAt)) throw new Error("CAPA sync settings are missing");
    Object.keys(grouped).forEach(function(key) {
      var itemRows = grouped[key];
      var sentKey = "CAPA_SENT_" + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key)
        .map(function(byte) { return (byte + 256).toString(16).slice(-2); }).join("").slice(0, 24);
      if (sent[sentKey]) return;
      var score = itemRows.reduce(function(sum, row) { return sum + Number(row.score); }, 0) / itemRows.length;
      if (score >= 3) return;
      var first = itemRows[0];
      if (Date.parse(first.timestamp) < scanFrom) return;
      var payload = {
        auditId: first.auditId,
        outlet: first.branch,
        item: first.item,
        product: first.product || "",
        auditor: first.name || "",
        auditedAt: first.timestamp,
        parameters: itemRows.map(function(row) {
          return {
            name: row.attribute || "Parameter",
            score: Number(row.score),
            feedback: row.feedback || "",
            evidence: row.documentation || ""
          };
        })
      };
      var response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        headers: { "x-capa-secret": secret },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      var status = response.getResponseCode();
      if (status >= 400) {
        failed = true;
        console.error("CAPA sync failed for audit " + first.auditId + " (" + status + ")");
      }
      else props.setProperty(sentKey, String(Date.now()));
    });
    if (!failed) props.setProperty("CAPA_SYNC_LAST_SUCCESS_AT", new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
}
