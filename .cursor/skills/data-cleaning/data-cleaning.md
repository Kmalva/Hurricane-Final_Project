# Data Cleaning Skill

When working with datasets:
- Inspect column names before coding charts.
- Parse years as numbers.
- Parse dates as Date objects only when needed.
- Convert numeric columns safely.
- Handle missing values explicitly.
- Do not fabricate missing values.
- Create derived columns only when the math is justified.
- Keep a note of limitations.

If data from multiple files must be merged:
- Merge by year when possible.
- Check for missing years.
- Keep source columns clear.
- Output a clean merged CSV if needed.

Always preserve the original data files.