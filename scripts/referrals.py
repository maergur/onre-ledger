#!/usr/bin/env python3
"""
Keep a cache of OnRe's public referral graph (who referred whom, and each referrer's code).

  <store>/referrals.json
    {"status": {wallet: [referrer_or_"", code_used_or_"", active_flag(1/0/null), checked_unix]},
     "codes":  {wallet: [code, is_custom(1/0), usage_count, checked_unix]}}

Endpoints (public, unauthenticated):  /referrals/status/<wallet>   /referrals/code/<wallet>
The API rate-limits bursts (HTTP 429), so calls are sequential and paced, and a run stops at the
first 429. Order: referrers' codes first, then never-checked wallets by rank, then stale pending/unreferred ones. A referrer never changes once set, so referred+active wallets are not re-checked.

Usage: python3 referrals.py --store DIR [--budget N] [--minutes M]
"""
import json, os, sys, glob, gzip, re, subprocess, time

API = "https://rewards.api.onre.finance/api/v1/referrals/%s/%s"
GAP = 0.25
B58 = re.compile(r"[1-9A-HJ-NP-Za-km-z]{32,44}")
CODE = re.compile(r"[A-Za-z0-9_-]{1,40}")
PENDING_AGE, UNREFERRED_AGE, CODE_AGE = 2 * 86400, 7 * 86400, 3 * 86400


class Throttled(Exception):
    pass


def call(kind, wallet):
    r = subprocess.run(["curl", "-s", "-w", "\n%{http_code}", "--max-time", "20", API % (kind, wallet)],
                       capture_output=True, text=True)
    body, _, code = r.stdout.rpartition("\n")
    if code == "429":
        raise Throttled()
    try:
        return code, json.loads(body)
    except ValueError:
        return code, None


def main():
    store = sys.argv[sys.argv.index("--store") + 1]
    budget = int(sys.argv[sys.argv.index("--budget") + 1]) if "--budget" in sys.argv else 900
    minutes = float(sys.argv[sys.argv.index("--minutes") + 1]) if "--minutes" in sys.argv else 10
    p = sorted(glob.glob(os.path.join(store, "leaderboard-full-*.json*")))[-1]
    with (gzip.open(p, "rt") if p.endswith(".gz") else open(p)) as f:
        ranked = [r["address"] for r in sorted(json.load(f)["rows"], key=lambda r: -r["points"])]
    rp = os.path.join(store, "referrals.json")
    db = json.load(open(rp)) if os.path.exists(rp) else {"status": {}, "codes": {}}
    st, cd = db["status"], db["codes"]
    now = int(time.time())

    # referrers' codes first (few, and what the page shows), best-ranked first; then the status sweep
    rank = {a: i for i, a in enumerate(ranked)}
    referrers = sorted({v[0] for v in st.values() if v[0]}, key=lambda a: rank.get(a, 10**9))
    todo = [("code", a) for a in referrers if a not in cd or now - cd[a][3] > CODE_AGE]
    # big wallets' own codes too, even when nobody on the board used them (e.g. #1's custom code)
    todo += [("code", a) for a in ranked[:300] if a not in referrers and (a not in cd or now - cd[a][3] > CODE_AGE)]
    todo += [("status", a) for a in ranked if a not in st]
    todo += [("status", a) for a in ranked if a in st and st[a][0] and not st[a][2] and now - st[a][3] > PENDING_AGE]
    todo += [("status", a) for a in ranked if a in st and not st[a][0] and now - st[a][3] > UNREFERRED_AGE]

    done, t0 = 0, time.time()
    try:
        for kind, a in todo:
            if done >= budget or time.time() - t0 > minutes * 60:
                break
            code, j = call(kind, a)
            if kind == "status" and code == "200" and isinstance(j, dict):
                ref = j.get("referrerWalletAddress") or ""
                used = j.get("referralCode") or ""
                st[a] = [ref if B58.fullmatch(ref) else "", used if CODE.fullmatch(used) else "",
                         None if j.get("isActive") is None else int(bool(j.get("isActive"))), now]
            elif kind == "code" and code == "200" and isinstance(j, dict) and CODE.fullmatch(j.get("code") or ""):
                cd[a] = [j["code"], int(bool(j.get("isCustom"))), int(j.get("usageCount") or 0), now]
            elif kind == "code" and code == "404":
                cd[a] = ["", 0, 0, now]
            done += 1
            time.sleep(GAP)
    except Throttled:
        print("referrals: throttled after %d calls; continuing next run" % done)
    json.dump(db, open(rp, "w"), separators=(",", ":"))
    cov = sum(1 for a in ranked if a in st)
    print("referrals: %d calls this run; status for %d/%d wallets (%.0f%%), %d referred, %d referrer codes"
          % (done, cov, len(ranked), 100.0 * cov / max(1, len(ranked)), sum(1 for v in st.values() if v[0]), len(cd)))


if __name__ == "__main__":
    main()
