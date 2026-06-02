# Hurricane Fuel — How a Warming Atlantic Loads the Dice

An interactive, D3.js explorable explanation of how warming Atlantic Ocean temperatures and
atmospheric moisture can create conditions that support more destructive hurricanes — told through
a long-term temperature record and real NOAA GOES satellite imagery.

## Launch page
https://kmalva.github.io/Hurricane-Final_Project/

## The story (and–but–therefore)
- **And** — the Atlantic has warmed for over a century and may keep warming.
- **But** — warmth and moisture aren't the whole story; damage depends on landfall, exposure, and preparedness.
- **Therefore** — hurricane risk is a long-term climate issue: warming oceans + moisture + intensity + community vulnerability.

## Visualizations
1. **Atlantic SST scrollytelling** — annual sea surface temperature, 1900–2100, with projections revealed on scroll.
2. **The fuel tank** — a GOES sea surface temperature heatmap of the tropical Atlantic with **hurricane season vs non-hurricane season** toggles (Sep 2022 vs Feb 2022 composites, shared color scale), MDR annotation, and seasonal callouts.
3. **Ingredients of a storm (interactive centerpiece)** — Hurricane Ian (2022) as GOES saw it, with toggleable visible / infrared / sea-surface-temp / water-vapor layers, a hover read-out, and annotations.
4. **Build a hurricane: ingredients lab** — after the takeaway, a five-slider educational simulation (ocean temp, moisture, wind shear, coastal exposure, preparedness) with live D3/SVG storm visuals, preset scenarios, and transparent scoring. Not a forecast; optional faint GOES background only.

## Data sources
- **Long-term SST:** NOAA ERSST v5 (observed) and CMIP6 GFDL-ESM4 (SSP1-2.6 / SSP2-4.5 / SSP5-8.5 projections). *(Separate source from GOES; shown as long-term context.)*
- **Satellite imagery & SST:** NOAA GOES-16 (`ABI-L2-SSTF`, `ABI-L2-MCMIPC`), accessed anonymously via the
  [NOAA Open Data on AWS registry](https://registry.opendata.aws/noaa-goes/).

## How the data was processed
`process_goes.ipynb` pulls GOES-16 from S3 (anonymous), masks by data-quality flag, converts Kelvin to °C,
reprojects the geostationary grid to latitude/longitude, downsamples, and exports lightweight artifacts:

- `data/goes_sst_grid_hurricane.json`, `data/goes_sst_grid_offseason.json` — Viz 2 seasonal SST grids (°C)
- `data/goes_storm_sst.json` — storm-region SST grid (°C)
- `data/goes_metadata.json` — describes which artifacts exist (keeps the frontend flexible)
- `assets/goes_storm_visible.webp`, `goes_storm_ir.webp`, `goes_water_vapor.webp`, `goes_storm_sst.webp`, seasonal SST WebP fallbacks

**The website never reads NetCDF, never hits S3, and needs no Python at runtime** — it only loads the committed JSON/WebP.

To regenerate Viz 2 seasonal maps: `python3 scripts/export_viz2_seasons.py` (or run the Viz 2 cells in `process_goes.ipynb`).

Other artifacts: `pip install xarray s3fs netCDF4 zarr h5netcdf h5py pyproj matplotlib pillow`, then run `process_goes.ipynb`.

The **ingredients lab** (`hurricane-lab.js`) uses client-side sliders and a simplified scoring formula only — no extra data files required.

## Limitations
- Hurricane damage depends on landfall, population exposure, infrastructure, preparedness, and reporting — not ocean temperature alone.
- GOES water-vapor imagery shows atmospheric moisture, not measured precipitation.
- Correlation between climate variables and hurricane activity does not, by itself, prove causation.
- The project focuses on long-term environmental patterns, not on predicting individual storms.
- The ingredients lab is an educational simulation, not a hurricane forecast or damage model.

## Run locally
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Built with [D3.js](https://d3js.org/) and [Scrollama](https://github.com/russellsamora/scrollama). NOAA data is open to the public; this project is not endorsed by or affiliated with NOAA.
