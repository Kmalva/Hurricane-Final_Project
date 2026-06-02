# D3 Scrollytelling Skill

Use D3.js with scroll-triggered narrative sections.

Requirements:
- Use IntersectionObserver or scroll progress tracking.
- Keep one sticky visualization area and update it as text sections enter the viewport.
- Each scroll step should trigger a meaningful visual change.
- Transitions should be smooth but not distracting.
- Do not animate every element at once.
- Maintain chart readability during transitions.

Pattern:
1. Create the base SVG once.
2. Load and parse data once.
3. Define update functions for each narrative state.
4. Trigger update functions on scroll step activation.
5. Keep state names readable, such as:
   - showHistoricalTemp
   - highlightRecentWarming
   - revealProjection
   - compareHurricaneActivity
   - showTakeaway