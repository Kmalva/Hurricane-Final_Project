# Hurricane Fuel — How a Warming Atlantic Loads the Dice

An interactive, D3.js explorable explanation of how warming Atlantic Ocean temperatures and
atmospheric moisture can create conditions that support more destructive hurricanes — told through
a long-term temperature record and real NOAA GOES satellite imagery.

## Launch page
https://kmalva.github.io/Hurricane-Final_Project/

## The story (and–but–therefore)
- **And** — the Atlantic has warmed for over a century and may keep warming.
- **But** — the storm ingredients are changing because the climate around them is changing; the storm is local but the warming behind it is global.
- **Therefore** — to understand hurricane risk we follow the fuel back to the global emissions system heating the ocean that every storm feeds on.

## Visualizations
1. **Atlantic SST scrollytelling** — annual sea surface temperature, 1900–2100, with projections revealed on scroll.
2. **The fuel tank** — a GOES sea surface temperature heatmap of the tropical Atlantic with side-by-side **hurricane season vs non-hurricane season** maps (Sep 2022 vs Feb 2022 multi-day clear-sky median composites, bounded GOES interpolation + ERSST v5 gap-fill, shared color scale), MDR annotation, and seasonal callouts.
3. **Ingredients of a storm (interactive centerpiece)** — Hurricane Ian (2022) as GOES saw it, with toggleable visible / infrared / sea-surface-temp / water-vapor layers, a hover read-out, and annotations.
4. **Follow the Fuel (emissions leaderboard)** — a scroll-driven racing leaderboard that pivots from one storm to the global emissions pattern warming the ocean. A warm scroll-driven wipe hands off from the storm; bars then reorder as you scroll through time; toggle **annual / cumulative** metrics to see the ranking change, and pin a country to see its share of all CO₂ ever emitted and how that ties back to hurricane fuel. Loads `data/emissions_country_year.json`.
5. **Make a hurricane (drag-map game)** — drag a storm across an Atlantic exploration map with educational zones, SST and moisture preview maps (with legends and storm-position dots), click-to-expand ingredient views, and transparent scoring. Uses `data/hurricane_zones.json` plus optional GOES SST backdrop. Not a forecast.

## Data sources
- **Long-term SST:** NOAA ERSST v5 (observed) and CMIP6 GFDL-ESM4 (SSP1-2.6 / SSP2-4.5 / SSP5-8.5 projections). *(Separate source from GOES; shown as long-term context.)*
- **Satellite imagery & SST:** NOAA GOES-16 (`ABI-L2-SSTF`, `ABI-L2-MCMIPC`), accessed anonymously via the
  [NOAA Open Data on AWS registry](https://registry.opendata.aws/noaa-goes/).
- **Country CO₂ emissions:** [Our World in Data CO₂ dataset](https://github.com/owid/co2-data) (compiles the Global Carbon Project + population). Real countries only, 1850–present.

## How the data was processed
`process_goes.ipynb` pulls GOES-16 from S3 (anonymous), masks by data-quality flag, converts Kelvin to °C,
reprojects the geostationary grid to latitude/longitude, downsamples, and exports lightweight artifacts:

- `data/goes_sst_grid_hurricane.json`, `data/goes_sst_grid_offseason.json` — Viz 2 seasonal SST grids (°C, with per-cell `quality`: goes / interpolated / ersst / land)
- `data/goes_storm_sst.json` — storm-region SST grid (°C)
- `data/goes_metadata.json` — describes which artifacts exist (keeps the frontend flexible)
- `assets/goes_storm_visible.webp`, `goes_storm_ir.webp`, `goes_water_vapor.webp`, `goes_storm_sst.webp`, seasonal SST WebP fallbacks

**The website never reads NetCDF, never hits S3, and needs no Python at runtime** — it only loads the committed JSON/WebP.

To regenerate Viz 2 seasonal maps: `python3 scripts/export_viz2_seasons.py` (multi-day GOES median + bounded interpolation + ERSST fill; needs network for S3/NOAA).

Other artifacts: `pip install xarray s3fs netCDF4 zarr h5netcdf h5py pyproj matplotlib pillow scipy global_land_mask certifi`, then run `process_goes.ipynb`.

The **drag-map game** (`hurricane-game.js`) loads `data/hurricane_zones.json` for illustrative zone scores; optional GOES SST grid for the sea-surface temperature layer. Moisture is a schematic IDW field derived from zone scores.

The **Follow the Fuel leaderboard** (`follow-the-fuel.js`) loads `data/emissions_country_year.json`, built offline by `scripts/process_emissions.py` from the Our World in Data CO₂ dataset. The script walks a contingency ladder (local raw CSV → download OWID → bundled `data/emissions_seed.csv` → inlined seed), derives cumulative/per-capita where missing, gracefully drops per-capita if population is unavailable, and runs known-truth sanity gates before writing. The committed JSON means the site works without re-running the script. To refresh: `pip install pandas`, then `python3 scripts/process_emissions.py`.

## Limitations
- Hurricane damage depends on landfall, population exposure, infrastructure, preparedness, and reporting — not ocean temperature alone.
- GOES water-vapor imagery shows atmospheric moisture, not measured precipitation.
- Correlation between climate variables and hurricane activity does not, by itself, prove causation.
- The project focuses on long-term environmental patterns, not on predicting individual storms.
- The drag-map game uses illustrative zone scores and a schematic moisture field; it is not a hurricane forecast or damage model.
- The Follow the Fuel leaderboard shows country CO₂ *contribution* to the warming system, not a direct cause of any individual storm; annual and cumulative metrics each tell a different, incomplete story.

## Run locally
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Built with [D3.js](https://d3js.org/) and [Scrollama](https://github.com/russellsamora/scrollama). NOAA data is open to the public; this project is not endorsed by or affiliated with NOAA.
