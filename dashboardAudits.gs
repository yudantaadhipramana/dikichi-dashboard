/**
 * API endpoint: /api/audits
 * Paginates audit rows (200 at a time) from 'Master Responses Gabungan' sheet.
 * Example: /api/audits?page=2
 * Returns JSON array of audit objects.
 */
function doGetAudits(e){
  const page=parseInt(e.parameter.page)||1;
  const limit=200;
  const sheet=SpreadsheetApp.getActive().getSheetByName('Master Responses Gabungan');
  const data=sheet.getDataRange().getValues();
  const start=(page-1)*limit+1; // skip header
  const sub=data.slice(start, start+limit);
  const result=JSON.stringify(sub);
  return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON).setHeaders({
    'Cache-Control':'public, max-age=3600'
  });
}
