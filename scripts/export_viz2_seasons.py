"""Export Viz 2 hurricane + off-season GOES SST grids (run from project root).

Multi-day clear-sky GOES median composite, bounded spatial interpolation,
and ERSST v5 monthly fallback for persistent cloud gaps.
"""
import datetime as dt
import json
import os
import ssl
import sys
import urllib.request

import certifi
import numpy as np
import s3fs
import xarray as xr
from global_land_mask import globe
from pyproj import CRS, Transformer
from scipy.interpolate import griddata
from scipy.spatial import cKDTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

import matplotlib
matplotlib.use("Agg")
import matplotlib.cm as cm
from PIL import Image

try:
    import scipy  # noqa: F401
except ImportError as exc:
    raise SystemExit("scipy is required: pip install scipy") from exc

try:
    import global_land_mask  # noqa: F401
except ImportError as exc:
    raise SystemExit("global_land_mask is required: pip install global_land_mask") from exc

fs = s3fs.S3FileSystem(anon=True)
CACHE = "/tmp/goes_cache"
ERSST_CACHE = os.path.join(CACHE, "ersst")
SSL_CTX = ssl.create_default_context(cafile=certifi.where())
os.makedirs(CACHE, exist_ok=True)
os.makedirs(ERSST_CACHE, exist_ok=True)
os.makedirs("data", exist_ok=True)
os.makedirs("assets", exist_ok=True)

BROAD_BOX = dict(lon0=-98.0, lon1=-15.0, lat0=7.0, lat1=33.0)
GRID_NX = 200
SST_HOURS = [6, 9, 12, 15, 18, 21]
SST_MIN_C = 15.0
SST_MAX_C = 35.0
INTERP_MAX_DEG = 2.0
COMPOSITE_DAYS = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]

SEASONS = [
    ("hurricane", 2022, 9, "data/goes_sst_grid_hurricane.json", "assets/goes_sst_layer_hurricane.webp"),
    ("offseason", 2022, 2, "data/goes_sst_grid_offseason.json", "assets/goes_sst_layer_offseason.webp"),
]

ERSST_URL = "https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/netcdf/ersst.v5.{ym}.nc"


def download_file(url, dest):
    if os.path.exists(dest):
        return
    print(f"  downloading {os.path.basename(dest)} ...")
    with urllib.request.urlopen(url, context=SSL_CTX) as resp:
        with open(dest, "wb") as f:
            f.write(resp.read())


def doy(y, m, d):
    return (dt.date(y, m, d) - dt.date(y, 1, 1)).days + 1


def days_in_month(year, month):
    if month == 12:
        nxt = dt.date(year + 1, 1, 1)
    else:
        nxt = dt.date(year, month + 1, 1)
    return (nxt - dt.date(year, month, 1)).days


def composite_days_for_month(year, month):
    dim = days_in_month(year, month)
    return [d for d in COMPOSITE_DAYS if d <= dim]


def fetch_local(s3path):
    local = os.path.join(CACHE, s3path.split("/")[-1])
    if not os.path.exists(local):
        print("  downloading", s3path.split("/")[-1][:50], "...")
        fs.get(s3path, local)
    return local


def open_local(s3path):
    return xr.open_dataset(fetch_local(s3path), engine="h5netcdf")


def get_proj(ds):
    p = ds["goes_imager_projection"]
    H = float(p.attrs["perspective_point_height"])
    lon0 = float(p.attrs["longitude_of_projection_origin"])
    a = float(p.attrs["semi_major_axis"])
    b = float(p.attrs["semi_minor_axis"])
    sweep = p.attrs.get("sweep_angle_axis", "x")
    crs = CRS.from_proj4(
        f"+proj=geos +h={H} +lon_0={lon0} +a={a} +b={b} +sweep={sweep} +units=m +no_defs"
    )
    return H, crs


def xy_bounds_for_box(H, crs, box, pad=0.5):
    fwd = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    LO, LA = np.meshgrid(
        np.linspace(box["lon0"] - pad, box["lon1"] + pad, 25),
        np.linspace(box["lat0"] - pad, box["lat1"] + pad, 25),
    )
    X, Y = fwd.transform(LO.ravel(), LA.ravel())
    X = X[np.isfinite(X)] / H
    Y = Y[np.isfinite(Y)] / H
    return X.min(), X.max(), Y.min(), Y.max()


def slice_xy(ds, xr0, xr1, yr0, yr1):
    xv, yv = ds["x"].values, ds["y"].values
    return ds.sel(
        x=slice(xr0, xr1) if xv[0] < xv[-1] else slice(xr1, xr0),
        y=slice(yr0, yr1) if yv[0] < yv[-1] else slice(yr1, yr0),
    )


def latlon_grid(sub, H, crs, stride=1):
    inv = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    XX, YY = np.meshgrid(sub["x"].values[::stride] * H, sub["y"].values[::stride] * H)
    return inv.transform(XX, YY)


def grid_shape(box, nx):
    span_lon = box["lon1"] - box["lon0"]
    span_lat = box["lat1"] - box["lat0"]
    ny = max(20, int(round(nx * span_lat / span_lon)))
    return ny, nx


def cell_centers(box, nx, ny):
    lon_edges = np.linspace(box["lon0"], box["lon1"], nx + 1)
    lat_edges = np.linspace(box["lat0"], box["lat1"], ny + 1)
    lon_c = (lon_edges[:-1] + lon_edges[1:]) / 2
    lat_c = (lat_edges[:-1] + lat_edges[1:]) / 2
    LO, LA = np.meshgrid(lon_c, lat_c)
    return lon_edges, lat_edges, LO, LA


def bin_observations_median(lon, lat, vals, box, nx):
    ny, _ = grid_shape(box, nx)
    lon_edges, lat_edges, _, _ = cell_centers(box, nx, ny)
    lon, lat, vals = lon.ravel(), lat.ravel(), vals.ravel()
    m = np.isfinite(lon) & np.isfinite(lat) & np.isfinite(vals)
    lon, lat, vals = lon[m], lat[m], vals[m]
    ix = np.clip(np.digitize(lon, lon_edges) - 1, 0, nx - 1)
    iy = np.clip(np.digitize(lat, lat_edges) - 1, 0, ny - 1)
    grid = np.full((ny, nx), np.nan)
    obs_count = np.zeros((ny, nx), dtype=np.int32)
    buckets = {}
    for i in range(len(vals)):
        key = (iy[i], ix[i])
        buckets.setdefault(key, []).append(vals[i])
    for (iy_i, ix_i), bucket in buckets.items():
        grid[iy_i, ix_i] = float(np.median(bucket))
        obs_count[iy_i, ix_i] = len(bucket)
    return grid, ny, obs_count


def build_land_mask(box, nx, ny):
    _, _, LO, LA = cell_centers(box, nx, ny)
    # global_land_mask expects (lat, lon)
    return globe.is_land(LA, LO)


def bounded_interpolate(grid, land_mask, max_deg):
    ny, nx = grid.shape
    _, _, LO, LA = cell_centers(BROAD_BOX, nx, ny)
    valid = np.isfinite(grid) & ~land_mask
    if not valid.any():
        return grid.copy(), np.zeros_like(grid, dtype=bool)

    src_lon = LO[valid]
    src_lat = LA[valid]
    src_val = grid[valid]
    tree = cKDTree(np.column_stack([src_lon, src_lat]))

    out = grid.copy()
    filled = np.zeros((ny, nx), dtype=bool)
    need = ~land_mask & ~np.isfinite(grid)
    if not need.any():
        return out, filled

    tgt_lon = LO[need]
    tgt_lat = LA[need]
    dist, _ = tree.query(np.column_stack([tgt_lon, tgt_lat]), k=1)
    close = dist <= max_deg
    if not close.any():
        return out, filled

    interp_vals = griddata(
        (src_lon, src_lat),
        src_val,
        (tgt_lon[close], tgt_lat[close]),
        method="linear",
    )
    nan_m = ~np.isfinite(interp_vals)
    if nan_m.any():
        nearest = griddata(
            (src_lon, src_lat),
            src_val,
            (tgt_lon[close][nan_m], tgt_lat[close][nan_m]),
            method="nearest",
        )
        interp_vals[nan_m] = nearest

    need_idx = np.argwhere(need)
    close_idx = np.argwhere(close).ravel()
    for j, (r, c) in enumerate(need_idx[close_idx]):
        out[r, c] = float(interp_vals[j])
        filled[r, c] = True
    return out, filled


def fetch_ersst_month(year, month):
    ym = f"{year}{month:02d}"
    local = os.path.join(ERSST_CACHE, f"ersst.v5.{ym}.nc")
    download_file(ERSST_URL.format(ym=ym), local)
    return xr.open_dataset(local)


def ersst_to_grid(year, month, nx, ny):
    ds = fetch_ersst_month(year, month)
    sst = ds["sst"].squeeze()
    if "time" in sst.dims:
        sst = sst.isel(time=0)
    lon = (sst.lon.values + 180) % 360 - 180
    sst = sst.assign_coords(lon=lon).sortby("lon")
    crop = sst.sel(
        lon=slice(BROAD_BOX["lon0"], BROAD_BOX["lon1"]),
        lat=slice(BROAD_BOX["lat0"], BROAD_BOX["lat1"]),
    )
    vals = crop.values.astype(float)
    src_lat = crop.lat.values
    src_lon = crop.lon.values
    _, _, tgt_lo, tgt_la = cell_centers(BROAD_BOX, nx, ny)
    pts = np.column_stack([src_lon.repeat(len(src_lat)), np.tile(src_lat, len(src_lon))])
    src = vals.ravel()
    ok = np.isfinite(src)
    grid = griddata(
        pts[ok],
        src[ok],
        (tgt_lo.ravel(), tgt_la.ravel()),
        method="linear",
    )
    grid = grid.reshape(ny, nx)
    nan_m = ~np.isfinite(grid)
    if nan_m.any():
        nearest = griddata(
            pts[ok],
            src[ok],
            (tgt_lo.ravel()[nan_m.ravel()], tgt_la.ravel()[nan_m.ravel()]),
            method="nearest",
        )
        grid.ravel()[nan_m.ravel()] = nearest
    ds.close()
    return grid


def collect_goes_observations(year, month, days):
    all_lon, all_lat, all_val = [], [], []
    H = crs = None
    xr0 = xr1 = yr0 = yr1 = None
    ref = None
    used_days = []

    for d in days:
        day_valid = 0
        for h in SST_HOURS:
            files = fs.glob(
                f"s3://noaa-goes16/ABI-L2-SSTF/{year}/{doy(year, month, d):03d}/{h:02d}/*.nc"
            )
            if not files:
                continue
            try:
                ds = open_local(files[0])
            except Exception as exc:
                print(f"  {year}-{month:02d}-{d:02d} {h:02d}Z: open failed ({exc})")
                continue
            if H is None:
                H, crs = get_proj(ds)
                xr0, xr1, yr0, yr1 = xy_bounds_for_box(H, crs, BROAD_BOX)
            sub = slice_xy(ds, xr0, xr1, yr0, yr1)
            S = 3
            raw = sub["SST"].values[::S, ::S] - 273.15
            dqf = sub["DQF"].values[::S, ::S]
            sst = np.where(dqf == 0, raw, np.nan)
            sst = np.where((sst >= SST_MIN_C) & (sst <= SST_MAX_C), sst, np.nan)
            lon_g, lat_g = latlon_grid(sub, H, crs, stride=S)
            if ref is None:
                ref = sst.shape
            lon_g = lon_g[: ref[0], : ref[1]]
            lat_g = lat_g[: ref[0], : ref[1]]
            sst = sst[: ref[0], : ref[1]]
            g = np.isfinite(sst)
            day_valid += int(g.sum())
            if g.any():
                all_lon.append(lon_g[g])
                all_lat.append(lat_g[g])
                all_val.append(sst[g])
            ds.close()
        if day_valid:
            used_days.append(f"{year}-{month:02d}-{d:02d}")
            print(f"  {year}-{month:02d}-{d:02d}: {day_valid} valid native px")

    if not all_lon:
        return None, None, None, used_days
    return np.concatenate(all_lon), np.concatenate(all_lat), np.concatenate(all_val), used_days


def export_broad_sst(season_id, year, month, json_path, webp_path):
    days = composite_days_for_month(year, month)
    print(f"\n=== {season_id}: {year}-{month:02d} ({len(days)} sample days) ===")

    lon, lat, vals, used_days = collect_goes_observations(year, month, days)
    if lon is None:
        print("  no GOES observations; ERSST-only fallback")
        ny, nx = grid_shape(BROAD_BOX, GRID_NX)
        grid = ersst_to_grid(year, month, nx, ny)
        quality = np.full((ny, nx), "ersst", dtype=object)
        land_mask = build_land_mask(BROAD_BOX, nx, ny)
        quality[land_mask] = "land"
        grid[land_mask] = np.nan
        meta_source = "ERSST v5 monthly only (GOES unavailable)"
        coverage = dict(goes=0.0, interpolated=0.0, ersst=float((~land_mask).mean()), land=float(land_mask.mean()))
    else:
        grid, ny, obs_count = bin_observations_median(lon, lat, vals, BROAD_BOX, GRID_NX)
        nx = grid.shape[1]
        land_mask = build_land_mask(BROAD_BOX, nx, ny)
        quality = np.full((ny, nx), "", dtype=object)
        quality[land_mask] = "land"
        goes_mask = (~land_mask) & np.isfinite(grid)
        quality[goes_mask] = "goes"

        grid_interp, interp_mask = bounded_interpolate(grid, land_mask, INTERP_MAX_DEG)
        quality[interp_mask] = "interpolated"

        ersst_grid = ersst_to_grid(year, month, nx, ny)
        ersst_mask = (~land_mask) & ~goes_mask & ~interp_mask
        grid_interp[ersst_mask] = ersst_grid[ersst_mask]
        quality[ersst_mask] = "ersst"

        grid = grid_interp
        grid[land_mask] = np.nan
        total = ny * nx
        coverage = {
            "goes": round(float((quality == "goes").sum() / total), 4),
            "interpolated": round(float((quality == "interpolated").sum() / total), 4),
            "ersst": round(float((quality == "ersst").sum() / total), 4),
            "land": round(float((quality == "land").sum() / total), 4),
        }
        meta_source = "GOES-16 ABI-L2-SSTF composite + bounded interpolation + ERSST v5 fill"
        print(
            f"  coverage: goes={coverage['goes']:.1%} interp={coverage['interpolated']:.1%} "
            f"ersst={coverage['ersst']:.1%} land={coverage['land']:.1%}"
        )

    ocean = ~land_mask if lon is not None else ~(quality == "land")
    ocean_vals = grid[ocean & np.isfinite(grid)]
    vmin = float(np.nanpercentile(ocean_vals, 2))
    vmax = float(np.nanpercentile(ocean_vals, 98))

    # JSON stores rows north-to-south (lat0=north)
    grid_out = grid[::-1]
    quality_out = quality[::-1]
    flat_vals = [
        None if (not np.isfinite(v) or quality_out.ravel()[i] == "land") else round(float(v), 2)
        for i, v in enumerate(grid_out.ravel())
    ]
    flat_quality = [str(q) for q in quality_out.ravel()]

    payload = dict(
        nx=grid.shape[1],
        ny=ny,
        lon0=BROAD_BOX["lon0"],
        lon1=BROAD_BOX["lon1"],
        lat0=BROAD_BOX["lat1"],
        lat1=BROAD_BOX["lat0"],
        vmin=round(vmin, 2),
        vmax=round(vmax, 2),
        unit="degC",
        values=flat_vals,
        quality=flat_quality,
        meta=dict(
            source=meta_source,
            composite_days=used_days,
            hours_utc=SST_HOURS,
            coverage=coverage,
        ),
    )
    with open(json_path, "w") as f:
        json.dump(payload, f)

    norm = np.clip((grid_out.astype(float) - vmin) / max(vmax - vmin, 1e-6), 0, 1)
    rgba = (cm.colormaps["inferno"](norm) * 255).astype(np.uint8)
    rgba[quality_out == "land", 3] = 0
    rgba[(quality_out != "land") & ~np.isfinite(grid_out), 3] = 0
    Image.fromarray(rgba, "RGBA").save(webp_path, "WEBP", quality=88, method=6)
    print(f"  wrote {json_path} ({payload['nx']}x{ny}) range {vmin:.1f}..{vmax:.1f} C")
    rep_day = used_days[len(used_days) // 2] if used_days else f"{year}-{month:02d}-15"
    return vmin, vmax, rep_day, coverage


def main():
    results = {}
    for sid, year, month, jpath, wpath in SEASONS:
        vmin, vmax, day, coverage = export_broad_sst(sid, year, month, jpath, wpath)
        results[sid] = dict(
            vmin=round(vmin, 2),
            vmax=round(vmax, 2),
            day=day,
            grid=jpath,
            layer=wpath,
            coverage=coverage,
        )

    cd_vmin = min(results["hurricane"]["vmin"], results["offseason"]["vmin"])
    cd_vmax = max(results["hurricane"]["vmax"], results["offseason"]["vmax"])

    meta_path = "data/goes_metadata.json"
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
    else:
        meta = {}

    for sid in ("hurricane", "offseason"):
        r = results[sid]
        period = "Jun–Nov (Atlantic)" if sid == "hurricane" else "Dec–May (Atlantic)"
        label = "Hurricane season" if sid == "hurricane" else "Non-hurricane season"
        meta.setdefault("sst_seasons", {})[sid] = {
            "label": label,
            "period": period,
            "day": r["day"],
            "grid": r["grid"],
            "layer": r["layer"],
            "vmin": r["vmin"],
            "vmax": r["vmax"],
            "coverage": r["coverage"],
        }

    meta["sst_seasons"]["color_domain"] = {"vmin": round(cd_vmin, 2), "vmax": round(cd_vmax, 2)}
    art = meta.setdefault("artifacts", {})
    art["sst_grid_hurricane"] = results["hurricane"]["grid"]
    art["sst_grid_offseason"] = results["offseason"]["grid"]
    art["sst_layer_hurricane"] = results["hurricane"]["layer"]
    art["sst_layer_offseason"] = results["offseason"]["layer"]
    art["sst_grid"] = results["hurricane"]["grid"]
    art["sst_layer"] = results["hurricane"]["layer"]
    meta["sst"] = dict(
        vmin=results["hurricane"]["vmin"],
        vmax=results["hurricane"]["vmax"],
        day=results["hurricane"]["day"],
    )

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print("\nUpdated", meta_path)
    print("color_domain:", meta["sst_seasons"]["color_domain"])


if __name__ == "__main__":
    main()
