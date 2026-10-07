#!/usr/bin/env python3
"""Create + deploy NEW Apps Script project for Dikichi Product Excellence Dashboard.

NEVER touches existing projects. Idempotent: scriptId saved to state file.
"""
import sys, os, json
sys.path.insert(0, r"D:/05 PROJECT/11 PROJECT PPA/09 Master Gacoan ETL/scripts")
from dk_auth import req, PCA, SCRIPT

BASE = r"D:/05 PROJECT/11 PROJECT PPA/dikichi-dashboard"
GAS  = os.path.join(BASE, "gas")
HERM = os.path.join(BASE, ".hermes")
STATE = os.path.join(HERM, "dikichi_script_state.json")
TITLE = "Dikichi Product Excellence Dashboard"

os.makedirs(HERM, exist_ok=True)
state = json.load(open(STATE)) if os.path.exists(STATE) else {}

# ---- 1. CREATE PROJECT (standalone) ----
pid = state.get("scriptId")
if not pid:
    r = req(SCRIPT, "POST", {"title": TITLE}, cred=PCA)
    print("CREATE ->", json.dumps(r)[:300])
    pid = r.get("scriptId")
    if not pid:
        sys.exit("no scriptId; aborting")
    state["scriptId"] = pid
    json.dump(state, open(STATE, "w"), indent=1)
print("scriptId:", pid)

# ---- 2. WRITE CONTENT ----
def load(f):
    return open(os.path.join(GAS, f), encoding="utf-8").read()

files = []
for f in ["Code.gs", "DashboardConfig.gs", "DashboardData.gs",
          "DashboardAnalytics.gs", "DashboardUtils.gs"]:
    files.append({"name": f[:-3], "type": "SERVER_JS", "source": load(f)})
for f in ["Index.html", "JS.html", "CSS.html"]:
    files.append({"name": f[:-5], "type": "HTML", "source": load(f)})
files.append({"name": "appsscript", "type": "JSON", "source": load("appsscript.json")})

r = req(SCRIPT + "/" + pid + "/content", "PUT", {"files": files}, cred=PCA)
if "error" in r:
    sys.exit("CONTENT PUT FAILED: " + json.dumps(r)[:800])
print("written files:", [(f["name"], f.get("type")) for f in r.get("files", [])])

# verify by re-reading
c = req(SCRIPT + "/" + pid + "/content", cred=PCA)
print("verify content:")
for f in sorted(c.get("files", []), key=lambda x: x["name"]):
    print("   %-22s %-10s %6d chars" % (f["name"], f.get("type"), len(f.get("source", ""))))

# ---- 3. VERSION ----
v = req(SCRIPT + "/" + pid + "/versions", "POST",
        {"description": "Dikichi Dashboard - clone of Gacoan backend, OUTLET_FILTER=Dikichi"}, cred=PCA)
print("VERSION ->", json.dumps(v)[:200])
vn = v.get("versionNumber")
if not vn:
    sys.exit("no versionNumber")
state["version"] = vn
json.dump(state, open(STATE, "w"), indent=1)

# ---- 4. DEPLOYMENT ----
dep = req(SCRIPT + "/" + pid + "/deployments", "POST",
          {"scriptId": pid, "versionNumber": vn, "manifestFileName": "appsscript",
           "description": "Dikichi Dashboard API"}, cred=PCA)
print("DEPLOYMENT ->", json.dumps(dep)[:400])
did = dep.get("deploymentId")
if not did:
    sys.exit("no deploymentId")
state["deploymentId"] = did
state["execUrl"] = "https://script.google.com/macros/s/%s/exec" % did
json.dump(state, open(STATE, "w"), indent=1)

# ---- 5. VERIFY ACCESS CONFIG ----
gd = req(SCRIPT + "/" + pid + "/deployments/" + did, cred=PCA)
print("\nGET deployment:")
print(json.dumps(gd, indent=1)[:1500])
json.dump(state, open(STATE, "w"), indent=1)
print("\nSTATE:", json.dumps(state, indent=1))
