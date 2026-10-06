#!/usr/bin/env python3
"""
Rebuild the public OnRe community dashboard from the local snapshot files.

Inputs  (all written by the daily onre-measured-accrual run):
  ~/onre-dashboard/leaderboard-full-YYYYMMDD.json   full population snapshots
  ~/onre-dashboard/history.json                     system total / user count series

Outputs (one self-contained page, the full wallet index is inlined):
  ~/onre-dashboard/community/index.html       Artifact page (no doctype; the Artifact host wraps it)
  ~/onre-dashboard/community/standalone.html  same page as a full HTML document, for any static host

Per-wallet rates are averaged over the widest span of snapshots available, up to
MAX_SPAN days. A single day of batch timing can park an active wallet at zero, so
a wider span is materially more honest; the span actually used is reported on the
page. Run with --span N to override.

Usage:  python3 build.py [--span N] [--data DIR] [--series FILE] [--src DIR] [--out DIR]

  --data    directory holding leaderboard-full-* / leaderboard-breakdown-* snapshots
            (.json or .json.gz); default ~/onre-dashboard
  --series  public series file [[date, system, users, ts], ...]; when given, history.json
            is NOT read at all (this is how the public repo builds)
  --src     directory with _head.html, _app.js, events.json, site.json; default: this folder
  --out     where index.html / standalone.html are written; default: --src
"""
import json, os, sys, glob, re, datetime, gzip

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_SPAN = 4


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


span_arg = int(arg("--span")) if arg("--span") else None
ROOT = os.path.abspath(os.path.expanduser(arg("--data", os.path.join(HERE, ".."))))
SERIES = arg("--series")
NAMES = arg("--names")
SRC = os.path.abspath(arg("--src", HERE))
OUT = os.path.abspath(arg("--out", SRC))


def load(p):
    with (gzip.open(p, "rt") if p.endswith(".gz") else open(p)) as f:
        return json.load(f)


def dated(prefix):
    """{date: path} for one snapshot family; a .json.gz wins over a .json of the same date."""
    out = {}
    for p in sorted(glob.glob(os.path.join(ROOT, prefix + "-*.json*"))):
        m = re.search(prefix + r"-(\d{8})\.json(\.gz)?$", p)
        if m:
            d = datetime.date(int(m.group(1)[:4]), int(m.group(1)[4:6]), int(m.group(1)[6:]))
            if d not in out or p.endswith(".gz"):
                out[d] = p
    return sorted(out.items())


def snapshots():
    return dated("leaderboard-full")


ASSET = {"onyc": "ONyc", "usdc": "USDC", "usdg": "USDG", "usds": "USDS",
         "onycJitosol": "ONyc / JitoSOL", "usdgOnyc": "USDG / ONyc", "onycUsdc": "ONyc / USDC"}
FIXED = {
    "wallet": ("OnRe", "ONyc held in wallet"),
    "permissionlessBoost": ("OnRe", "Permissionless boost"),
    "onreYieldPlus": ("OnRe", "Yield+"),
    "referralBonus": ("Referrals", "Referral bonus"),
    "exponentVault": ("Exponent", "Vault"),
    "carrot": ("Carrot", "Carrot"),
    "carrotLending": ("Carrot", "Lending"),
    "ratex": ("RateX", "RateX"),
    "elemental": ("Elemental", "Elemental"),
}
PROTO = {"kamino": "Kamino", "loopscale": "Loopscale", "orca": "Orca", "exponent": "Exponent"}
RESIDUAL = ("Not itemised", "Credited without a source")


def source_label(k):
    """Public, human label (protocol, product) for one API breakdown leaf key."""
    if k in FIXED:
        return FIXED[k]
    p = k.split(".")
    if p[0] == "exponent" and len(p) == 4 and p[1] == "markets":
        return ("Exponent", "%s %s" % (p[3].upper(), p[2]))          # "YT SEP-2026"
    if p[0] == "exponent" and len(p) == 3 and p[1] == "tranching":
        return ("Exponent", "%s tranche" % p[2].capitalize())         # "Senior tranche"
    if p[0] in PROTO and len(p) == 2:
        return (PROTO[p[0]], ASSET.get(p[1], p[1]))
    return (p[0][:1].upper() + p[0][1:], " ".join(p[1:]) or p[0])


def breakdown_snaps():
    return dated("leaderboard-breakdown")


def sources(rows, span):
    """Per-wallet points by source, plus earning by source when two full breakdown
    snapshots exist. Everything is keyed by public labels, never by raw API keys."""
    full_snaps = []
    for d, p in breakdown_snaps():
        s = load(p)
        if len(s["rows"]) >= 10000:                       # skip partial top-N captures
            full_snaps.append((d, s))
    if not full_snaps:
        return None, None, None
    bdate, bs = full_snaps[-1]
    prev = None
    for d, s in full_snaps[:-1]:
        if 0 < (bdate - d).days <= span:
            prev = (d, s)
            break
    labels, index = [], {}

    def ki(lab):
        if lab not in index:
            index[lab] = len(labels)
            labels.append(lab)
        return index[lab]

    def lines_of(r):
        out = {}
        for k, v in r["lines"].items():
            if v:
                i = ki(source_label(k))
                out[i] = out.get(i, 0) + v
        resid = r["points"] - sum(r["lines"].values())
        if resid > 1000:                                  # total ahead of its own itemisation
            i = ki(RESIDUAL)
            out[i] = out.get(i, 0) + resid
        return out

    cur = {r["address"]: lines_of(r) for r in bs["rows"]}
    rate, rdays, rfrom = None, None, None
    if prev:
        pd_, ps = prev
        if bs.get("ts") and ps.get("ts"):
            hrs = (datetime.datetime.fromisoformat(bs["ts"])
                   - datetime.datetime.fromisoformat(ps["ts"])).total_seconds() / 3600.0
        else:
            hrs = (bdate - pd_).days * 24.0
        rdays = hrs / 24.0
        rfrom = pd_.isoformat()
        old = {r["address"]: lines_of(r) for r in ps["rows"]}
        rate = {}
        for a, ln in cur.items():
            o = old.get(a)
            if o is None:
                continue
            rr = {i: int((v - o.get(i, 0)) / rdays) for i, v in ln.items() if v - o.get(i, 0) > 0}
            if rr:
                rate[a] = rr

    nk = len(labels)
    tot_p, tot_w, tot_r = [0] * nk, [0] * nk, [0] * nk
    proto_w = {}
    bd, br = [], []
    for r in rows:
        a = r["address"]
        ln = cur.get(a, {})
        flat = []
        for i, v in sorted(ln.items(), key=lambda x: -x[1]):
            flat += [i, v]
            tot_p[i] += v
            tot_w[i] += 1
        for p in {labels[i][0] for i in ln}:
            proto_w[p] = proto_w.get(p, 0) + 1
        bd.append(flat)
        if rate is not None:
            rr = rate.get(a, {})
            fr = []
            for i, v in sorted(rr.items(), key=lambda x: -x[1]):
                fr += [i, v]
                tot_r[i] += v
            br.append(fr)
    summary = {
        "asOf": bdate.isoformat(),
        "labels": [list(l) for l in labels],
        "pts": tot_p, "wallets": tot_w, "protoWallets": proto_w,
        "rate": tot_r if rate is not None else None,
        "rateFrom": rfrom, "rateDays": round(rdays, 2) if rdays else None,
    }
    return summary, bd, (br if rate is not None else None)


def main():
    snaps = snapshots()
    if len(snaps) < 2:
        sys.exit("need at least 2 leaderboard-full-*.json snapshots, found %d" % len(snaps))

    span = span_arg or MAX_SPAN
    newest_d, newest_p = snaps[-1]
    # widest available window, capped at span days
    base_d, base_p = snaps[0]
    for d, p in snaps:
        if (newest_d - d).days <= span:
            base_d, base_p = d, p
            break
    cur = load(newest_p)
    old = load(base_p)
    # Global series: [[date, system, users, ts], ...]. The public repo passes --series and
    # never touches history.json; locally it is derived from history.json's global fields.
    if SERIES:
        base_series = [list(r) for r in load(SERIES)]
    else:
        hist = json.load(open(os.path.join(ROOT, "history.json")))
        base_series, seen_d = [], set()
        for rowset in hist.values():
            for r in rowset:
                if r.get("system") and r["date"] not in seen_d:
                    seen_d.add(r["date"])
                    base_series.append([r["date"], r["system"], r["users"], r.get("ts")])
    # Full snapshots written before 2026-10-06 carry no capture time; borrow it from
    # the series row of the same date when that row has one.
    hist_ts = {r[0]: r[3] for r in base_series if r[3]}
    for s in (cur, old):
        if not s.get("ts") and s.get("date") in hist_ts:
            s["ts"] = hist_ts[s["date"]]

    # Time-normalised span. Runs land anywhere from ~09:20 to ~16:12, so counting
    # calendar days alone mis-states a rate by up to ~30%. Use the real capture
    # timestamps when both snapshots carry one; fall back to calendar days.
    if cur.get("ts") and old.get("ts"):
        hours = (datetime.datetime.fromisoformat(cur["ts"])
                 - datetime.datetime.fromisoformat(old["ts"])).total_seconds() / 3600.0
    else:
        hours = max(1, (newest_d - base_d).days) * 24.0
    days = max(hours / 24.0, 1e-6)
    prev = {r["address"]: r["points"] for r in old["rows"]}
    rows = sorted(cur["rows"], key=lambda r: -r["points"])

    addrs, pts, rts, seen = [], [], [], []
    for r in rows:
        a = r["address"]
        addrs.append(a[:44].ljust(44))
        pts.append(r["points"])
        if a in prev:
            rts.append(max(0, int((r["points"] - prev[a]) / days)))
            seen.append(1)
        else:
            rts.append(0)
            seen.append(0)
    addrs = "".join(addrs)

    # Full snapshots are internally consistent and carry a real capture time, so
    # prefer them wherever one exists for a date. A history row can have been
    # rewritten by a later poll, which would pair a late total with an early
    # timestamp and distort that day's bar.
    snap_by_date = {}
    for d, p_ in snaps:
        sd = load(p_)
        snap_by_date[sd["date"]] = (sd["system"], sd.get("ts") or hist_ts.get(sd["date"]))
    # global fields only - never publish an individual wallet's breakdown
    series = []
    for r in base_series:
        sysv, ts = snap_by_date.get(r[0], (r[1], r[3]))
        series.append([r[0], sysv, r[2], ts])
    series.sort()

    # hand-edited public event log; global facts only, see the task file
    ev_path = os.path.join(SRC, "events.json")
    events = json.load(open(ev_path)) if os.path.exists(ev_path) else []
    for e in events:
        if e.get("kind") not in ("bad", "warn", "ahead", "neutral"):
            sys.exit("events.json: bad kind %r on %s" % (e.get("kind"), e.get("date")))
    events.sort(key=lambda e: e["date"], reverse=True)
    # builder credit + optional referral code; the referral block renders only when a code is set
    site_path = os.path.join(SRC, "site.json")
    site = json.load(open(site_path)) if os.path.exists(site_path) else {}

    meta = {
        "asOf": newest_d.isoformat(),
        "asOfTime": (cur.get("ts") or "")[11:16],
        "system": cur["system"],
        "users": len(rows),
        "rateFrom": base_d.isoformat(),
        "rateTo": newest_d.isoformat(),
        "rateDays": round(days, 2),
        "rateHours": round(hours, 2),
        "totalRate": sum(rts),
        "movedCount": sum(1 for r in rts if r > 0),
        "series": series,
        "events": events,
        "site": site,
    }

    full = {"addrs": addrs, "pts": pts, "rts": rts, "seen": seen}
    # primary .sol names (public SNS data) for the wallets that set one: {rank index: name}
    if NAMES and os.path.exists(NAMES):
        nm = load(NAMES)
        sol = {}
        for i, r in enumerate(rows):
            v = nm.get(r["address"])
            if v and v[0] and re.fullmatch(r"[a-z0-9_.-]{1,64}", v[0]):
                sol[str(i)] = v[0]
        if sol:
            full["sol"] = sol
    src, bd, br = sources(rows, span)
    if src:
        meta["sources"] = src
        full["bd"] = bd
        if br is not None:
            full["br"] = br

    # --- guard: nothing wallet-specific may reach the published page ---
    # history.json is keyed by the operator's own wallet and carries a per-line
    # `breakdown`. Only the global date/system/users fields are read above. This
    # checks STRUCTURE, not prose.
    blob = json.dumps(meta) + json.dumps(full)
    banned = ["breakdown", "referralBonus", "loopscale.", "exponent.markets",
              "permissionlessBoost", "pointsBreakdown", "tranching", "activeMultipliers"]
    leaked = [t for t in banned if t in blob]
    if leaked:
        sys.exit("REFUSING TO BUILD: personal per-line data in payload: %s" % leaked)

    def safe(s):
        return s.replace("</", "<\\/").replace("<!--", "<\\u0021--")

    head = open(os.path.join(SRC, "_head.html")).read()
    app = open(os.path.join(SRC, "_app.js")).read()
    os.makedirs(OUT, exist_ok=True)
    page = (head
            + '<script id="payload" type="application/json">'
            + safe(json.dumps(meta, separators=(",", ":")))
            + '</script>\n<script id="full" type="application/json">'
            + safe(json.dumps(full, separators=(",", ":")))
            + "</script>\n<script>\n" + app + "</script>\n")
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(page)
    # Standalone copy: split the template at </style> into head and body.
    cut = page.index("</style>") + len("</style>")
    standalone = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
                  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                  + page[:cut] + "\n</head>\n<body>\n" + page[cut:] + "</body>\n</html>\n")
    with open(os.path.join(OUT, "standalone.html"), "w") as f:
        f.write(standalone)

    print("built %s" % newest_d)
    print("  wallets       %s" % format(len(rows), ","))
    print("  system        %s" % format(cur["system"], ","))
    print("  rate window   %s -> %s (%.2f days / %.2f h, from %d snapshots)"
          % (base_d, newest_d, days, hours, len(snaps)))
    print("  moved         %s of %s wallets" % (format(meta["movedCount"], ","), format(len(rows), ",")))
    print("  index.html    %.2f MB (self-contained)" % (os.path.getsize(os.path.join(OUT, "index.html")) / 1e6))
    print("  standalone    %.2f MB" % (os.path.getsize(os.path.join(OUT, "standalone.html")) / 1e6))


if __name__ == "__main__":
    main()
