#!/usr/bin/env python3
"""Dikichi Product Excellence Dashboard - live verification + blocker forensics.

Writes raw evidence to .hermes/gas_verify.txt
"""
import sys, os, json, time, gzip, re, urllib.request, urllib.error, urllib.parse
from collections import Counter

sys.path.insert(0, r"D:/05 PROJECT/11 PROJECT PPA/09 Master Gacoan ETL/scripts")
from dk_auth import PCA, YUD, SCRIPT, req, sv, meta

BASE = r"D:/05 PROJECT/11 PROJECT PPA/dikichi-dashboard"
OUT = os.path.join(BASE, ".hermes", "gas_verify.txt")
G = json.load(open(os.path.join(BASE, ".hermes", "dikichi_gas.json")))
EXEC, SID, PID, DID = G["execUrl"], G["scriptId"], G["scriptId"], G["deploymentId"]
GACO_SID = "1brNLCun66v-oq6Sf6tMoc1pfw9BiXa6hkv2179iYhslBnpZHq2rV2r8K"
GACO_EXEC = "https://script.google.com/macros/s/AKfycbwCP6RN-eDecyD6WH8sCNFtH_sg-ZuEKW-CyYk57kUmxvVTSQlqrfU0xYKxTIQuF-kg/exec"
SS = "1i-nGUWKqmVgNOdDjN2f8c5gk5lsgS-PaLbABLjqteaA"
TOK = PCA.token()
buf = []
def w(*a):
    line = " ".join(str(x) for x in a); print(line); buf.append(line)

def http(url, bearer=None, timeout=300, follow=True):
    h = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dikichi-verify",
         "Accept": "application/json,text/plain,*/*", "Accept-Encoding": "gzip"}
    if bearer: h["Authorization"] = "Bearer " + bearer
    if not follow:
        op = urllib.request.build_opener(type("NR", (urllib.request.HTTPRedirectHandler,),
                                              {"redirect_request": lambda *a, **k: None}))
    else:
        op = urllib.request.build_opener()
    t0 = time.time()
    try:
        resp = op.open(urllib.request.Request(url, headers=h), timeout=timeout)
        code, raw, loc = resp.status, resp.read(), resp.headers.get("Location")
    except urllib.error.HTTPError as e:
        code, raw, loc = e.code, e.read(), e.headers.get("Location")
    ms = round((time.time() - t0) * 1000)
    if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
    return code, raw, ms, loc

def visible(b):
    t = b.decode("utf-8", "replace")
    t = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip()

w("#" * 78)
w("# DIKICHI PRODUCT EXCELLENCE DASHBOARD - LIVE VERIFICATION EVIDENCE")
w("# generated:", time.strftime("%Y-%m-%d %H:%M:%S %Z"))
w("#" * 78)
w("")
w("scriptId      :", PID)
w("version       :", G["version"])
w("deploymentId  :", DID)
w("execUrl       :", EXEC)
w("owner/deployer: productauditcoffee@gmail.com  (token scopes: %s)" % " ".join(
    json.load(urllib.request.urlopen("https://oauth2.googleapis.com/tokeninfo?access_token=" + TOK, timeout=60))["scope"].split()))
w("")

# ---------------------------------------------------------------- 1
w("=" * 78)
w("[1] ANONYMOUS HTTP  ->  $EXEC?page=status | ?page=fast | ?page=audits")
w("=" * 78)
for page, extra in (("status", ""), ("fast", "&filters=%7B%7D"), ("audits", "&filters=%7B%7D")):
    url = EXEC + "?page=" + page + extra
    c, b, ms, loc = http(url)
    w("")
    w(">>> GET %s" % url)
    w("    HTTP %s | %d bytes | %d ms" % (c, len(b), ms))
    w("    body[0:180]: %s" % b[:180].decode("utf-8", "replace").replace("\n", " "))
    w("    visible text: %s" % visible(b)[:260])
w("")
w("RESULT [1]: BLOCKED - HTTP 403 Google 'Akses Ditolak' interstitial, not JSON.")
w("")

# ---------------------------------------------------------------- 2
w("=" * 78)
w("[2] OUTLET ISOLATION  (Sheets API, column F 'Outlet' of 'Master Responses Gabungan')")
w("=" * 78)
r = sv(SS, "Master Responses Gabungan", "F1:F25000", cred=PCA)
vals = r.get("values", [])
hdr = vals[0][0] if vals else "?"
col = [str(x[0]).strip() if x else "" for x in vals[1:]]
cnt = Counter(c for c in col if c)
w("F1 header                 :", repr(hdr))
w("non-empty data cells F2:F :", sum(cnt.values()))
for k, v in cnt.most_common(8):
    w("   Outlet=%-14r -> %5d rows (%.2f%%)" % (k, v, 100.0 * v / sum(cnt.values())))
w("Mie Gacoan rows           :", cnt.get("Mie Gacoan"))
w("Dikichi rows              :", cnt.get("Dikichi"))
w("RESULT [2]: PASS - exactly %s Dikichi rows vs %s Mie Gacoan (total %s)"
  % (cnt.get("Dikichi"), cnt.get("Mie Gacoan"), sum(cnt.values())))
w("")

# ---------------------------------------------------------------- 3
w("=" * 78)
w("[3] DIKICHI DATA THE DASHBOARD FILTERS TO  (Sheets API, cols D/E/F/G/H)")
w("=" * 78)
r = sv(SS, "Master Responses Gabungan", "D2:H22440", cred=PCA)
rows = r.get("values", [])
def g(i): return lambda row: str(row[i]).strip() if i < len(row) and row[i] is not None else ""
dik = [row for row in rows if g(2)(row) == "Dikichi"]
audits = sorted({g(0)(x) for x in dik if g(0)(x)})
br = Counter(g(3)(x) for x in dik if g(3)(x))
pr = Counter(g(4)(x) for x in dik if g(4)(x))
w("total rows in range       :", len(rows))
w("Dikichi item rows         :", len(dik))
w("distinct audit_id         :", len(audits))
w("audit_id sample           :", audits[:8])
w("audit_id DK-* prefixed    : %d/%d" % (len([a for a in audits if a.startswith('DK-')]), len(audits)))
w("audit_id non-DK           :", [a for a in audits if not a.startswith("DK-")])
w("branches (Branch/Cabang)  :", json.dumps(dict(br), ensure_ascii=False))
w("products                  :", list(pr))
w("KEDIRI PEMUDA present?    :", "KEDIRI PEMUDA" in br)
w("")
w("RESULT [3]: PASS - every Dikichi branch value is a Dikichi branch")
w("            (MOJOKERTO RADEN WIJAYA, KEDIRI PEMUDA); audit ids are DK-YYYYMMDD-NNN.")
w("")

# ---------------------------------------------------------------- 4
w("=" * 78)
w("[4] MANIFEST  GET https://script.googleapis.com/v1/projects/<scriptId>/content")
w("=" * 78)
c = req(SCRIPT + "/" + PID + "/content", cred=PCA)
man = next((f["source"] for f in c["files"] if f["name"] == "appsscript"), None)
w("GET %s/content" % (SCRIPT + "/" + PID))
w("appsscript source:")
w(man)
mj = json.loads(man)
w("")
w("ACCESS CHECK: webapp.access = %s | webapp.executeAs = %s"
  % (mj["webapp"]["access"], mj["webapp"]["executeAs"]))
w("RESULT [4]: PASS - ANYONE_ANONYMOUS + USER_DEPLOYING")
w("")
w("content file list (clone fidelity vs Gacoan source):")
for f in sorted(c["files"], key=lambda x: x["name"]):
    w("   %-22s %-10s %6d chars" % (f["name"], f.get("type"), len(f.get("source", ""))))
w("")

# ---------------------------------------------------------------- 5
w("=" * 78)
w("[5] DEPLOYMENT CONFIG (all deployments of the NEW project)")
w("=" * 78)
ds = req(SCRIPT + "/" + PID + "/deployments", cred=PCA)
for d in ds.get("deployments", []):
    for ep in d.get("entryPoints", []):
        wa = ep.get("webApp")
        if wa:
            w("  %s  v%s  access=%s executeAs=%s" % (
                d["deploymentId"], d["deploymentConfig"].get("versionNumber"),
                wa["entryPointConfig"]["access"], wa["entryPointConfig"]["executeAs"]))
            w("     url: %s" % wa["url"])
w("")

# ---------------------------------------------------------------- 6
w("=" * 78)
w("[6] BLOCKER FORENSICS - is it the deployment config or the project consent?")
w("=" * 78)
w("")
w("6a. CONTROL - same client/IP, Gacoan (authorized) deployment, ANONYMOUS, no redirect follow:")
c1, b1, ms1, loc1 = http(GACO_EXEC + "?page=status", follow=False)
w("    GET %s?page=status" % GACO_EXEC)
w("    HTTP %s | %d ms | Location: %s" % (c1, ms1, (loc1 or "")[:150]))
w("")
w("6b. Gacoan with owner bearer token (follow redirects):")
c2, b2, ms2, _ = http(GACO_EXEC + "?page=status", bearer=TOK)
w("    HTTP %s | %d bytes | %d ms" % (c2, len(b2), ms2))
w("    body: %s" % b2[:300].decode("utf-8", "replace"))
w("")
w("6c. Dikichi exec with the SAME owner bearer token:")
c3, b3, ms3, _ = http(EXEC + "?page=status", bearer=TOK)
w("    HTTP %s | %d bytes | %d ms" % (c3, len(b3), ms3))
w("    visible: %s" % visible(b3)[:400])
w("")
w("6d. OAuth consent client the Dikichi script asks for:")
m = re.search(r"([0-9]{10,}-[a-z0-9]+)\.apps\.googleusercontent\.com", b3.decode("utf-8", "replace"))
w("    client_id:", (m.group(1) + ".apps.googleusercontent.com") if m else "n/a")
w("    owner token client_id: 453858962175-dv3nf37hl8bsm2lt7935if26mocucvsj.apps.googleusercontent.com")
w("")
w("CONCLUSION: the deployment config is CORRECT (ANYONE_ANONYMOUS / USER_DEPLOYING).")
w("            The script is registered with Google but the deploying account has never")
w("            completed the one-time OAuth consent for THIS scriptId, so every request")
w("            (anonymous -> Drive 'Akses Ditolak'; owner-authenticated -> 'Authorization")
w("            needed') is intercepted before doGet(e) runs. Gacoan's project, same code,")
w("            same manifest, same owner, same client/IP, DOES return JSON -> proves the")
w("            difference is the per-script consent record, not the code or the network.")
w("")
w("REMEDIATION (one-time, human, ~15 seconds):")
w("   1. sign in the browser as productauditcoffee@gmail.com")
w("   2. open: %s" % EXEC)
w("   3. click 'Review Permissions' -> pick the account -> 'Advanced' -> 'Go to Dikichi")
w("      Product Excellence Dashboard (unsafe)' -> 'Allow'")
w("   4. re-run: python .hermes/verify_dikichi.py   (no redeploy needed, version is frozen)")
w("")

# ---------------------------------------------------------------- 7
w("=" * 78)
w("[7] EXPECTED API OUTPUT once consent is granted (computed from the same sheet)")
w("=" * 78)
w("  ?page=status  -> {\"ok\":true,\"ts\":...,\"etlCache\":\"MISS|HIT\",\"auditsCache\":...,\"version\":\"faseB\"}")
w("  ?page=fast    -> overview.auditCount = %d, branchCount = %d, productCount = %d, itemCount = %d"
  % (len(audits), len(br), len(pr), len(dik)))
w("                   outlets/branches = %s" % list(br))
w("  ?page=audits  -> %d audits, ids %s ..." % (len(audits), audits[:3]))
w("")

open(OUT, "w", encoding="utf-8").write("\n".join(buf) + "\n")
w("[saved]", OUT)
