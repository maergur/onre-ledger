#!/usr/bin/env python3
"""
Fetch one full snapshot of OnRe's public points leaderboard into a snapshot store.

Writes (date = UTC+3 calendar day; a later run on the same day overwrites it):
  <store>/leaderboard-full-YYYYMMDD.json.gz       {date, ts, system, rows:[{address, points}]}
  <store>/leaderboard-breakdown-YYYYMMDD.json.gz  {date, ts, rows:[{address, rank, points, lines}]}
  <store>/series.json                             [[date, system, users, ts], ...] one row per day
and prunes snapshots older than KEEP_DAYS.

OnRe's API refuses browser requests (any Origin header) and Python's default urllib
User-Agent, so every request goes through plain curl.

Usage: python3 fetch.py --store DIR
"""
import json, os, sys, glob, gzip, re, subprocess, time, datetime
from concurrent.futures import ThreadPoolExecutor

API = "https://rewards.api.onre.finance/api/v1/points/leaderboard?page=%d&size=1000"
KEEP_DAYS = 8
TZ = datetime.timedelta(hours=3)          # OnRe day boundaries are read in UTC+3


def get(url):
    for i in range(8):
        if i:
            time.sleep(3 * i)
        r = subprocess.run(["curl", "-s", "--max-time", "60", "-H", "Accept: application/json", url],
                           capture_output=True, text=True)
        try:
            return json.loads(r.stdout)
        except ValueError:
            pass
    sys.exit("fetch failed after retries: %s" % url)


def flat(d, p=""):
    o = {}
    for k, v in d.items():
        if isinstance(v, dict):
            o.update(flat(v, p + k + "."))
        else:
            o[p + k] = v
    return o


def main():
    store = sys.argv[sys.argv.index("--store") + 1]
    os.makedirs(store, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + TZ
    ts, date = now.isoformat(timespec="seconds"), now.date()

    first = get(API % 0)["leaderboard"]
    pages = first["totalPages"]
    with ThreadPoolExecutor(6) as ex:
        rest = list(ex.map(lambda n: get(API % n)["leaderboard"], range(1, pages)))
    rows = [r for pg in [first] + rest for r in pg["content"]]
    seen = {}
    for r in rows:                      # a reordering board can repeat a wallet across pages
        seen[r["address"]] = r
    rows = sorted(seen.values(), key=lambda r: -r["totalPoints"])
    if len(rows) < 1000:
        sys.exit("suspiciously few rows (%d); not writing" % len(rows))
    system = sum(r["totalPoints"] for r in rows)

    tag = date.strftime("%Y%m%d")

    def dump(name, obj):
        with gzip.open(os.path.join(store, name), "wt") as f:
            json.dump(obj, f, separators=(",", ":"))

    dump("leaderboard-full-%s.json.gz" % tag,
         {"date": date.isoformat(), "ts": ts, "system": system,
          "rows": [{"address": r["address"], "points": r["totalPoints"]} for r in rows]})
    dump("leaderboard-breakdown-%s.json.gz" % tag,
         {"date": date.isoformat(), "ts": ts,
          "rows": [{"address": r["address"], "rank": i + 1, "points": r["totalPoints"],
                    "lines": {k: v for k, v in flat(r.get("pointsBreakdown") or {}).items()
                              if v and k not in ("exponent.yt", "exponent.lp")}}
                   for i, r in enumerate(rows)]})

    sp = os.path.join(store, "series.json")
    series = json.load(open(sp)) if os.path.exists(sp) else []
    series = [s for s in series if s[0] != date.isoformat()] + [[date.isoformat(), system, len(rows), ts]]
    series.sort()
    json.dump(series, open(sp, "w"), separators=(",", ":"))

    cutoff = date - datetime.timedelta(days=KEEP_DAYS)
    for p in glob.glob(os.path.join(store, "leaderboard-*-*.json*")):
        m = re.search(r"-(\d{8})\.json", p)
        if m and datetime.datetime.strptime(m.group(1), "%Y%m%d").date() < cutoff:
            os.remove(p)

    print("snapshot %s %s: %d wallets, system %s" % (date, ts[11:16], len(rows), format(system, ",")))


if __name__ == "__main__":
    main()
