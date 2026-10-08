#!/usr/bin/env python3
"""Push Dikichi Dashboard GAS: patch DashboardConfig + new version + update SAME deployment (exec URL stabil).

Usage: python push_dikichi_dashboard.py "description"
Reads live content, replaces ONLY the file named 'DashboardConfig' with local gas/DashboardConfig.gs,
PUTs the full list back, creates a version, updates deployment AKfycbwDrS... in place.
"""
import sys, os, json, datetime
sys.path.insert(0, r"D:/05 PROJECT/11 PROJECT PPA/09 Master Gacoan ETL/scripts")
from dk_auth import req, PCA, SCRIPT

BASE = r"D:/05 PROJECT/11 PROJECT PPA/dikichi-dashboard"
STATE = os.path.join(BASE, ".hermes", "dikichi_script_state.json")
DESC = sys.argv[1] if len(sys.argv) > 1 else "Dikichi Dashboard update"
FRONT_DEPLOYMENT = "AKfycbwDrSripeMtToDmXIFPWvqfEhVS7ALee1CWmiyUVbhNXm0_T7TEzxCqLYjWZDE6GSJp"

state = json.load(open(STATE))
PID = state["scriptId"]

live = req(SCRIPT + "/" + PID + "/content", cred=PCA)
files = live.get("files") or []
if not files:
    sys.exit("cannot read live content: " + json.dumps(live)[:400])

MIRRORS = {
    "DashboardConfig": "gas/DashboardConfig.gs",
    "Index": "gas/Index.html",
    "JS": "gas/JS.html",
    "CSS": "gas/CSS.html",
    "Code": "gas/Code.gs",
    "DashboardData": "gas/DashboardData.gs",
    "DashboardAnalytics": "gas/DashboardAnalytics.gs",
    "DashboardUtils": "gas/DashboardUtils.gs",
}

# Nama file yang diganti dari mirror lokal: DashboardConfig selalu,
# sisanya hanya kalau disebut di argumen (mis. "... Index JS").
targets = ["DashboardConfig"] + [a for a in sys.argv[2:] if a]


def _local_source(name):
    rel = MIRRORS.get(name)
    if not rel:
        sys.exit("no local mirror mapped for live file '%s'" % name)
    p = os.path.join(BASE, rel)
    if not os.path.exists(p):
        sys.exit("local mirror missing: " + p)
    return open(p, encoding="utf-8").read()


hit = 0
for f in files:
    if f["name"] in targets:
        local_src = _local_source(f["name"])
        if f["source"] == local_src:
            print("WARN: live %s identical to local (no change)" % f["name"])
        f["source"] = local_src
        hit += 1
if hit != len(targets):
    sys.exit("expected %d target file(s) %s, matched %d (names=%s)"
             % (len(targets), targets, hit, [f["name"] for f in files]))
print("files to PUT:", [(f["name"], f.get("type"), len(f.get("source", ""))) for f in files])

# backup live state before push
open(os.path.join(BASE, ".hermes", "backup_gas_content_%s.json" % datetime.datetime.now().strftime("%Y%m%d_%H%M%S")), "w", encoding="utf-8").write(json.dumps(files, indent=1))

r = req(SCRIPT + "/" + PID + "/content", "PUT", {"files": files}, cred=PCA)
if r.get("error"):
    sys.exit("CONTENT PUT FAILED: " + json.dumps(r)[:800])
print("PUT ok;", len(r.get("files", [])), "files now live")

v = req(SCRIPT + "/" + PID + "/versions", "POST", {"description": DESC}, cred=PCA)
vn = v.get("versionNumber")
if not vn:
    sys.exit("no versionNumber: " + json.dumps(v)[:300])
print("VERSION ->", vn, "|", DESC)

dep = req(SCRIPT + "/" + PID + "/deployments/" + FRONT_DEPLOYMENT, "PUT",
          {"deploymentConfig": {"scriptId": PID, "versionNumber": vn, "manifestFileName": "appsscript",
                                "description": DESC}}, cred=PCA)
dc = (dep.get("deploymentConfig") or {})
print("DEPLOYMENT ->", dep.get("deploymentId", "")[:24], "ver", dc.get("versionNumber"), "|", dc.get("description"))
if dc.get("versionNumber") != vn:
    sys.exit("deployment update did not take: " + json.dumps(dep)[:400])
state.setdefault("history", []).append({"version": vn, "desc": DESC, "ts": datetime.datetime.now().isoformat(timespec="seconds")})
state["version"] = vn
state["deploymentId"] = dep.get("deploymentId", state.get("deploymentId"))
state["execUrl"] = "https://script.google.com/macros/s/%s/exec" % state["deploymentId"]
json.dump(state, open(STATE, "w"), indent=1)
print("state saved; execUrl", state["execUrl"])
