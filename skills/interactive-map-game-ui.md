# Interactive Map Game UI Skill

Use when building educational drag-map or zone-based explainer games in this project (D3 + SVG).

## Drag behavior
- Use `d3.drag()` on a dedicated storm `<g>` with a visible hit target (circle).
- Clamp positions to map padding; use `touch-action: none` on the map wrapper.
- Raise the storm on drag start; restore `cursor: grab` / `grabbing` on end.
- On drop, optionally snap to nearest zone center within `1.25 * radius`.
- Throttle live panel updates with `requestAnimationFrame` during drag.

## Map layers
- One active layer mode at a time (or a defined “all” blend with opacity caps).
- Fade layers with `transition` on group `opacity` (250–350ms), not instant toggles.
- Keep legends short; label schematic layers as educational, not observations.

## Readout panel
- Show location type, storm response wording, growth category, impact badge, ingredient bars.
- Animate score bar widths with CSS `transition`.
- Keep a **fixed caution** block always visible (“not a real forecast”).

## Popups
- Show on drop when zone has `popupTitle`; close button + Escape key.
- Position near storm; do not block the entire map.

## Challenges
- Optional guided prompts with clear success vs hint messages.
- Do not block exploration after success.

## Layout
- Laptop-first 3-column grid: controls | map | panel.
- Collapse to single column under ~960px; map first on mobile.
- Avoid nested scroll inside the game card.

## Accessibility
- `aria-live` on feedback and legend.
- Map `tabindex="0"` + arrow keys to nudge storm.
- Layer toggles use `aria-pressed`.

## Tone
- “Likely supports strengthening”, “storm ingredients”, “educational simulation”.
- Never “predicts”, “proves damage”, “real forecast”.

## Reduced motion
- Respect `prefers-reduced-motion: reduce` for transitions (project-wide rule applies).
