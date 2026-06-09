"""Build a compact country-emissions dataset for the "Follow the Fuel" leaderboard.

Run from the project root:  python3 scripts/process_emissions.py

Source (priority ladder, see plan "Data contingencies"):
  A1. Local raw CSV if present (scripts/owid-co2-data.csv or /tmp/owid-co2.csv)
  A2. Download Our World in Data owid-co2-data.csv (merges Global Carbon Project + population)
  A3. Bundled hand-curated data/emissions_seed.csv (offline, ~15 majors at decade checkpoints)

Output: data/emissions_country_year.json  (committed, so the site works without re-running)

This is an OFFLINE build tool. The website never runs Python; it only loads the JSON.
"""
import json
import os
import sys
import urllib.request

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

OWID_URL = "https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv"
LOCAL_RAW_CANDIDATES = [
    "scripts/owid-co2-data.csv",
    "/tmp/owid-co2.csv",
    "/tmp/owid-co2-data.csv",
]
SEED_CSV = "data/emissions_seed.csv"
OUT_JSON = "data/emissions_country_year.json"

YEAR_MIN = 1850
TOP_N_KEEP = 15  # a country is kept if it reaches this rank in ANY metric in ANY year
# Always-relevant majors kept even if they never crack the top 15 in a given metric.
MAJORS = {"USA", "CHN", "IND", "RUS", "DEU", "GBR", "JPN"}

# Fallback name -> ISO map (used only if the source lacks reliable iso_code).
NAME_TO_ISO = {
    "United States": "USA", "China": "CHN", "India": "IND", "Russia": "RUS",
    "Germany": "DEU", "United Kingdom": "GBR", "Japan": "JPN", "Canada": "CAN",
    "France": "FRA", "Italy": "ITA", "Poland": "POL", "Ukraine": "UKR",
    "South Korea": "KOR", "Iran": "IRN", "Saudi Arabia": "SAU", "Indonesia": "IDN",
    "Brazil": "BRA", "Mexico": "MEX", "South Africa": "ZAF", "Australia": "AUS",
    "Qatar": "QAT", "Kuwait": "KWT", "United Arab Emirates": "ARE", "Belgium": "BEL",
    "Czechia": "CZE", "Kazakhstan": "KAZ", "Turkey": "TUR", "Spain": "ESP",
    "Netherlands": "NLD", "Luxembourg": "LUX",
}

METRIC_COLS = {"annual": "co2", "cumulative": "cumulative_co2", "per_capita": "co2_per_capita"}


def load_source():
    """Return (DataFrame, source_label, tier). Walks the acquisition ladder."""
    for path in LOCAL_RAW_CANDIDATES:
        if os.path.exists(path):
            print(f"[source] using local raw CSV: {path}")
            return pd.read_csv(path), "Our World in Data (CO2 + GCP)", "A1-local"
    try:
        print(f"[source] downloading OWID: {OWID_URL}")
        os.makedirs("scripts", exist_ok=True)
        cache = "scripts/owid-co2-data.csv"
        urllib.request.urlretrieve(OWID_URL, cache)
        return pd.read_csv(cache), "Our World in Data (CO2 + GCP)", "A2-download"
    except Exception as exc:  # noqa: BLE001 - any network/IO failure drops to seed
        print(f"[source] OWID download failed ({exc}); falling back to seed CSV")
    if os.path.exists(SEED_CSV):
        print(f"[source] using bundled seed: {SEED_CSV}")
        return pd.read_csv(SEED_CSV), "Curated seed (OWID/GCP published figures)", "A3-seed"
    sys.exit("FATAL: no emissions source available (no raw CSV, no network, no seed).")


def ensure_iso(df):
    if "iso_code" not in df.columns or df["iso_code"].isna().all():
        df["iso_code"] = df["country"].map(NAME_TO_ISO)
    else:
        # Fill any blanks from the name map where we can.
        missing = df["iso_code"].isna()
        df.loc[missing, "iso_code"] = df.loc[missing, "country"].map(NAME_TO_ISO)
    return df


def is_real_country(iso):
    return isinstance(iso, str) and len(iso) == 3 and not iso.startswith("OWID")


def extract_world(df_all):
    """World cumulative/annual CO2 at the latest year, for honest 'share of all CO2' math.

    Read before we drop aggregate rows (World has an OWID_* iso). Returns None if absent
    (e.g. the seed CSV has no World row); callers then fall back to summing countries.
    """
    w = df_all[df_all["country"] == "World"]
    if w.empty:
        return None
    w = w[w["year"] >= YEAR_MIN]
    if w.empty:
        return None
    latest = w.sort_values("year").iloc[-1]
    res = {"year": int(latest["year"])}
    if "cumulative_co2" in w.columns and pd.notna(latest.get("cumulative_co2")):
        res["cumulative"] = round(float(latest["cumulative_co2"]), 2)
    if "co2" in w.columns and pd.notna(latest.get("co2")):
        res["annual"] = round(float(latest["co2"]), 2)
    return res if res.get("cumulative") else None


def main():
    df, source_label, tier = load_source()
    df = ensure_iso(df)

    # Capture world totals before aggregate rows get filtered out below.
    world = extract_world(df)

    # Keep real countries and the modern era we care about.
    df = df[df["iso_code"].apply(is_real_country)].copy()
    df = df[df["year"] >= YEAR_MIN].copy()
    df["year"] = df["year"].astype(int)

    # Derive missing metrics where possible.
    metrics = []
    if "co2" in df.columns:
        metrics.append("annual")
    if "cumulative_co2" not in df.columns and "co2" in df.columns:
        df = df.sort_values(["iso_code", "year"])
        df["cumulative_co2"] = df.groupby("iso_code")["co2"].cumsum()
        print("[derive] cumulative_co2 = cumulative sum of annual co2")
    if "cumulative_co2" in df.columns:
        metrics.append("cumulative")
    if "co2_per_capita" not in df.columns and {"co2", "population"} <= set(df.columns):
        df["co2_per_capita"] = df["co2"] / df["population"] * 1e6  # t per person
        print("[derive] co2_per_capita = co2 / population")
    if "co2_per_capita" in df.columns and df["co2_per_capita"].notna().any():
        metrics.append("per_capita")
    else:
        print("[degrade] no per-capita data -> running annual + cumulative only")

    metrics = [m for m in ("annual", "cumulative", "per_capita") if m in metrics]
    if not metrics:
        sys.exit("FATAL: source has none of the required emission metrics.")

    # Decide which countries to keep: top-N in any metric in any year, plus majors.
    keep = set(MAJORS)
    for metric in metrics:
        col = METRIC_COLS[metric]
        sub = df[["iso_code", "year", col]].dropna()
        for _, grp in sub.groupby("year"):
            top = grp.nlargest(TOP_N_KEEP, col)["iso_code"]
            keep.update(top.tolist())
    keep = {iso for iso in keep if iso in set(df["iso_code"])}

    names = df.dropna(subset=["country"]).groupby("iso_code")["country"].agg(lambda s: s.mode().iloc[0])

    countries = []
    for iso in sorted(keep):
        cdf = df[df["iso_code"] == iso].sort_values("year")
        series = {}
        for metric in metrics:
            col = METRIC_COLS[metric]
            pairs = [[int(y), round(float(v), 2)]
                     for y, v in zip(cdf["year"], cdf[col]) if pd.notna(v)]
            if pairs:
                series[metric] = pairs
        if series.get("annual") or series.get("cumulative"):
            countries.append({"iso": iso, "name": str(names.get(iso, iso)), "series": series})

    year_max = int(df["year"].max())

    # Fall back to summing tracked countries if the source lacked a World row.
    if not (world and world.get("cumulative")):
        total = 0.0
        for c in countries:
            pairs = c["series"].get("cumulative")
            if pairs:
                total += pairs[-1][1]
        world = {"year": year_max, "cumulative": round(total, 2), "estimated": True}

    out = {
        "meta": {
            "yearMin": YEAR_MIN,
            "yearMax": year_max,
            "source": source_label,
            "sourceTier": tier,
            "metrics": metrics,
            "world": world,
            "note": "Annual + cumulative CO2 (MtCO2), per-capita (t/person). Real countries only. "
                    "meta.world = global cumulative CO2 since 1750 (OWID World), used for share-of-total.",
        },
        "countries": countries,
    }

    sanity(out, metrics)

    with open(OUT_JSON, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_JSON) / 1024
    print(f"[done] {OUT_JSON}: {len(countries)} countries, "
          f"{YEAR_MIN}-{year_max}, metrics={metrics}, {size_kb:.0f} KB, tier={tier}")


def _top_iso(out, metric, year):
    best, best_v = None, float("-inf")
    for c in out["countries"]:
        pairs = c["series"].get(metric)
        if not pairs:
            continue
        # nearest <= year, else earliest
        val = None
        for y, v in pairs:
            if y <= year:
                val = v
            else:
                break
        if val is None:
            continue
        if val > best_v:
            best, best_v = c["iso"], val
    return best


def sanity(out, metrics):
    """Fail loud if the output is empty or contradicts well-known facts."""
    assert out["countries"], "no countries produced"
    ymax = out["meta"]["yearMax"]
    if "cumulative" in metrics:
        top_cum = _top_iso(out, "cumulative", ymax)
        assert top_cum == "USA", f"expected USA top cumulative at {ymax}, got {top_cum}"
    if "annual" in metrics:
        top_ann = _top_iso(out, "annual", ymax)
        assert top_ann == "CHN", f"expected China top annual at {ymax}, got {top_ann}"
    if {"annual", "per_capita"} <= set(metrics):
        top_pc = _top_iso(out, "per_capita", ymax)
        top_cum = _top_iso(out, "cumulative", ymax)
        assert top_pc != top_cum, "per-capita leader should differ from cumulative leader"
    print("[sanity] gates passed")


if __name__ == "__main__":
    main()
