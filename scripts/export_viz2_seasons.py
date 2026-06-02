"""Export Viz 2 hurricane + off-season GOES SST grids (run from project root)."""
import datetime as dt
import json
import os
import sys

import numpy as np
import s3fs
import xarray as xr
from pyproj import CRS, Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

import matplotlib
matplotlib.use("Agg")
import matplotlib.cm as cm
from PIL import Image

fs = s3fs.S3FileSystem(anon=True)
CACHE = "/tmp/goes_cache"
os.makedirs(CACHE, exist_ok=True)
os.makedirs("data", exist_ok=True)
os.makedirs("assets", exist_ok=True)

BROAD_BOX = dict(lon0=-98.0, lon1=-15.0, lat0=7.0, lat1=33.0)
SST_HOURS = [12, 15, 17]
SEASONS = [
    ("hurricane", (2022, 9, 20), "data/goes_sst_grid_hurricane.json", "assets/goes_sst_layer_hurricane.webp"),
    ("offseason", (2022, 2, 15), "data/goes_sst_grid_offseason.json", "assets/goes_sst_layer_offseason.webp"),
]


def doy(y, m, d):
    return (dt.date(y, m, d) - dt.date(y, 1, 1)).days + 1


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


def bin_to_grid(lon, lat, vals, box, nx):
    span_lon = box["lon1"] - box["lon0"]
    span_lat = box["lat1"] - box["lat0"]
    ny = max(20, int(round(nx * span_lat / span_lon)))
    le = np.linspace(box["lon0"], box["lon1"], nx + 1)
    ae = np.linspace(box["lat0"], box["lat1"], ny + 1)
    lon, lat, vals = lon.ravel(), lat.ravel(), vals.ravel()
    m = np.isfinite(lon) & np.isfinite(lat) & np.isfinite(vals)
    lon, lat, vals = lon[m], lat[m], vals[m]
    ix = np.clip(np.digitize(lon, le) - 1, 0, nx - 1)
    iy = np.clip(np.digitize(lat, ae) - 1, 0, ny - 1)
    sums = np.zeros((ny, nx))
    cnts = np.zeros((ny, nx))
    np.add.at(sums, (iy, ix), vals)
    np.add.at(cnts, (iy, ix), 1)
    with np.errstate(invalid="ignore"):
        return np.where(cnts > 0, sums / cnts, np.nan), ny


def export_broad_sst(season_id, ymd, json_path, webp_path):
    y, m, d = ymd
    print(f"\n=== {season_id}: {y}-{m:02d}-{d:02d} ===")
    sums = cnts = lon = lat = None
    H = crs = None
    ref = None
    xr0 = xr1 = yr0 = yr1 = None
    for h in SST_HOURS:
        files = fs.glob(f"s3://noaa-goes16/ABI-L2-SSTF/{y}/{doy(y, m, d):03d}/{h:02d}/*.nc")
        if not files:
            print(f"  {h:02d}Z: no files")
            continue
        ds = open_local(files[0])
        if H is None:
            H, crs = get_proj(ds)
            xr0, xr1, yr0, yr1 = xy_bounds_for_box(H, crs, BROAD_BOX)
        sub = slice_xy(ds, xr0, xr1, yr0, yr1)
        S = 3
        sst = np.where(sub["DQF"].values[::S, ::S] == 0, sub["SST"].values[::S, ::S], np.nan) - 273.15
        if lon is None:
            lon, lat = latlon_grid(sub, H, crs, stride=S)
            ref = sst.shape
            lon, lat = lon[: ref[0], : ref[1]], lat[: ref[0], : ref[1]]
            sums = np.zeros(ref)
            cnts = np.zeros(ref)
        sst = sst[: ref[0], : ref[1]]
        g = np.isfinite(sst)
        sums[g] += sst[g]
        cnts[g] += 1
        ds.close()
        print(f"  {h:02d}Z ok, valid px: {int(g.sum())}")
    with np.errstate(invalid="ignore"):
        comp = np.where(cnts > 0, sums / cnts, np.nan)
    grid, ny = bin_to_grid(lon, lat, comp, BROAD_BOX, nx=200)
    nx = grid.shape[1]
    vmin = float(np.nanpercentile(grid, 2))
    vmax = float(np.nanpercentile(grid, 98))
    flat = [None if not np.isfinite(v) else round(float(v), 2) for v in grid[::-1].ravel()]
    payload = dict(
        nx=nx,
        ny=ny,
        lon0=BROAD_BOX["lon0"],
        lon1=BROAD_BOX["lon1"],
        lat0=BROAD_BOX["lat1"],
        lat1=BROAD_BOX["lat0"],
        vmin=round(vmin, 2),
        vmax=round(vmax, 2),
        unit="degC",
        values=flat,
    )
    with open(json_path, "w") as f:
        json.dump(payload, f)
    norm = np.clip((grid[::-1].astype(float) - vmin) / (vmax - vmin), 0, 1)
    rgba = (cm.get_cmap("inferno")(norm) * 255).astype(np.uint8)
    rgba[~np.isfinite(grid[::-1]), 3] = 0
    Image.fromarray(rgba, "RGBA").save(webp_path, "WEBP", quality=88, method=6)
    print(f"  wrote {json_path} ({nx}x{ny}) range {vmin:.1f}..{vmax:.1f} C")
    return vmin, vmax, f"{y}-{m:02d}-{d:02d}"


def main():
    results = {}
    for sid, ymd, jpath, wpath in SEASONS:
        vmin, vmax, day = export_broad_sst(sid, ymd, jpath, wpath)
        results[sid] = dict(vmin=round(vmin, 2), vmax=round(vmax, 2), day=day, grid=jpath, layer=wpath)

    cd_vmin = min(results["hurricane"]["vmin"], results["offseason"]["vmin"])
    cd_vmax = max(results["hurricane"]["vmax"], results["offseason"]["vmax"])

    meta_path = "data/goes_metadata.json"
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
    else:
        meta = {}

    meta["sst_seasons"] = {
        "hurricane": {
            "label": "Hurricane season",
            "period": "Jun–Nov (Atlantic)",
            "day": results["hurricane"]["day"],
            "grid": results["hurricane"]["grid"],
            "layer": results["hurricane"]["layer"],
            "vmin": results["hurricane"]["vmin"],
            "vmax": results["hurricane"]["vmax"],
        },
        "offseason": {
            "label": "Non-hurricane season",
            "period": "Dec–May (Atlantic)",
            "day": results["offseason"]["day"],
            "grid": results["offseason"]["grid"],
            "layer": results["offseason"]["layer"],
            "vmin": results["offseason"]["vmin"],
            "vmax": results["offseason"]["vmax"],
        },
        "color_domain": {"vmin": round(cd_vmin, 2), "vmax": round(cd_vmax, 2)},
    }
    art = meta.setdefault("artifacts", {})
    art["sst_grid_hurricane"] = results["hurricane"]["grid"]
    art["sst_grid_offseason"] = results["offseason"]["grid"]
    art["sst_layer_hurricane"] = results["hurricane"]["layer"]
    art["sst_layer_offseason"] = results["offseason"]["layer"]
    # legacy alias for hurricane
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
