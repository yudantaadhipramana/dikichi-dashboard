/**
 * API endpoint: /api/metrics
 * Returns cached metrics JSON (gzip compressed); if cache misses, compute fresh.
 * This is a bare‑bones example; add real logic per your schema.
 */
function doGet(e){
  const req=e.parameter.req;
  if(req==='metrics') return doGetMetrics();
  if(req==='audits') return doGetAudits();
  return ContentService.createTextOutput({error:'unknown request'}).setMimeType(ContentService.MimeType.JSON);
}

function doGetMetrics(){
  const cacheKey='dikichi_metrics';
  const cache=CacheService.getScriptCache();
  let metrics=cache.get(cacheKey);
  if(!metrics){
    const sheet=SpreadsheetApp.getActive().getSheetByName('Master Responses Gabungan');
    const raw=sheet.getDataRange().getValues();
    const header=raw[0];
    const outletIdx=header.indexOf('outlet');
    const rows=raw.slice(1).filter(r=>r[outletIdx]==='Dikichi');
    let totalScore=0;let count=0;
    rows.forEach(r=>{const score=parseFloat(r[header.indexOf('score')]||'0');totalScore+=score;count++;});
    const avgScore=count?totalScore/count:0;
    metrics=JSON.stringify({score:avgScore, total:count});
    cache.put(cacheKey,metrics,3600);
  }
  return ContentService.createTextOutput(metrics).setMimeType(ContentService.MimeType.JSON).setHeaders({
    'Cache-Control':'public, max-age=3600'
  });
}

function doGetAudits(){
  const page=parseInt(e.parameter.page)||1;
  const limit=200;
  const sheet=SpreadsheetApp.getActive().getSheetByName('Master Responses Gabungan');
  const raw=sheet.getDataRange().getValues();
  const header=raw[0];
  const outletIdx=header.indexOf('outlet');
  const rows=raw.slice(1).filter(r=>r[outletIdx]==='Dikichi');
  const start=(page-1)*limit;
  const sub=rows.slice(start, start+limit);
  return ContentService.createTextOutput(JSON.stringify(sub)).setMimeType(ContentService.MimeType.JSON).setHeaders({
    'Cache-Control':'public, max-age=3600'
  });
}
