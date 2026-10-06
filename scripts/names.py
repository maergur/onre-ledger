#!/usr/bin/env python3
"""
Keep a cache of primary .sol names (Solana Name Service) for the top wallets.

  <store>/names.json   {address: [name_or_empty, checked_unix_seconds]}

Each run looks up at most BUDGET wallets among the TOP wallets by points: never-checked first,
then the stalest beyond MAX_AGE. Uses the public SNS proxy (sdk-proxy.sns.id) through curl.

Usage: python3 names.py --store DIR [--budget N]
"""
import json, os, sys, glob, gzip, re, subprocess, time

TOP, BUDGET, MAX_AGE, PAUSE = 2000, 150, 3 * 86400, 1.0   # the proxy rate-limits bursts (HTTP 429)
API = "https://sdk-proxy.sns.id/favorite-domain/%s"


class Throttled(Exception):
    pass


def lookup(addr):
    for i in range(2):
        r = subprocess.run(["curl", "-s", "-w", "\n%{http_code}", "--max-time", "12", API % addr],
                           capture_output=True, text=True)
        body, _, code = r.stdout.rpartition("\n")
        if code == "429":
            raise Throttled()
        try:
            j = json.loads(body)
        except ValueError:
            time.sleep(2)
            continue
        if j.get("s") == "ok" and isinstance(j.get("result"), dict) and j["result"].get("reverse"):
            name = j["result"]["reverse"].strip().lower()
            return name if re.fullmatch(r"[a-z0-9_.-]{1,64}", name) else ""
        return ""                       # "error" = no primary name set
    return None                         # network trouble: retry next run


def main():
    store = sys.argv[sys.argv.index("--store") + 1]
    budget = int(sys.argv[sys.argv.index("--budget") + 1]) if "--budget" in sys.argv else BUDGET
    snaps = sorted(glob.glob(os.path.join(store, "leaderboard-full-*.json*")))
    if not snaps:
        sys.exit("no snapshot to take wallets from")
    p = snaps[-1]
    with (gzip.open(p, "rt") if p.endswith(".gz") else open(p)) as f:
        rows = json.load(f)["rows"]
    top = [r["address"] for r in sorted(rows, key=lambda r: -r["points"])[:TOP]]
    np_ = os.path.join(store, "names.json")
    names = json.load(open(np_)) if os.path.exists(np_) else {}
    now = int(time.time())
    todo = [a for a in top if a not in names] + \
           sorted([a for a in top if a in names and now - names[a][1] > MAX_AGE], key=lambda a: names[a][1])
    todo = todo[:budget]
    done = 0
    for a in todo:                      # one at a time, paced; stop at the first throttle
        try:
            n = lookup(a)
        except Throttled:
            print("names: throttled after %d lookups; continuing next run" % done)
            break
        if n is not None:
            names[a] = [n, now]
        done += 1
        time.sleep(PAUSE)
    keep = set(top)                     # drop wallets that fell out of the top
    names = {a: v for a, v in names.items() if a in keep}
    json.dump(names, open(np_, "w"), separators=(",", ":"))
    found = sum(1 for v in names.values() if v[0])
    print("names: checked %d this run, %d cached, %d with a .sol name" % (done, len(names), found))


if __name__ == "__main__":
    main()
