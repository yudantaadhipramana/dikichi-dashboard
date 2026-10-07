/**
 * API endpoint: /api/metrics
 * Returns cached metrics JSON (gzip compressed); if cache misses, compute fresh.
 * This is a bare‑bones example; add real logic per your schema.
 */
function doGet(e){
  if(!e.parameter.page || e.parameter.page!='metrics') return;
  const cacheKey='dikichi_metrics';
  const sheet=SpreadsheetApp.getActive().getSheetByName('Master Responses Gabungan');
  const raw=sheet.getDataRange().getValues();
  const header=raw[0];
  const outletIdx=header.indexOf('outlet');
  const rows=raw.slice(1).filter(r=>r[outletIdx]==='Dikichi');
  let totalScore=0;let count=0;
  rows.forEach(r=>{const score=parseFloat(r[header.indexOf('score')]||'0');totalScore+=score;count++;});
  const avgScore=count?totalScore/count:0;
  const resultData={score:avgScore, total:count};
  const metrics=JSON.stringify(resultData);
  cache.put(cacheKey,metrics,3600);
  return ContentService.createTextOutput(metrics).setMimeType(ContentService.MimeType.JSON).setHeaders({
    'Cache-Control':'public, max-age=3600'
  });
}
