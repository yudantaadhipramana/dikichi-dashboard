/**
 * API endpoint: /api/metrics
 * Returns cached metrics JSON (gzip compressed); if cache misses, compute fresh.
 * This is a bare‑bones example; add real logic per your schema.
 */
function doGet(e){
  if(!e.parameter.page || e.parameter.page!='metrics') return;
  const cacheKey='dikichi_metrics';
  const cache=CacheService.getScriptCache();
  let metrics=cache.get(cacheKey);
  if(!metrics){
    // generate metrics (placeholder)
    const data={score:65, avgScore:78, count:1234};
    metrics=JSON.stringify(data);
    cache.put(cacheKey,metrics,3600);
  }
  const result=Utilities.newBlob(metrics,'application/json');
  return ContentService.createTextOutput(metrics).setMimeType(ContentService.MimeType.JSON).setHeaders({
    'Cache-Control':'public, max-age=3600',
    'Content-Encoding':'gzip'
  });
}
