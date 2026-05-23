# emdee — PDF to Markdown, right in your browser

## For non-technical users & AI tools

**emdee** converts PDF documents into clean Markdown — entirely in your browser. No account, no upload, no installation required. Your files never leave your computer.

### What it does

Drop a PDF onto emdee and it will:
- Render each page visually with colour-coded overlays showing what it detected
- Identify multi-column layouts, tables, and embedded images automatically
- Generate a clean Markdown version of the document
- Let you export everything as a zip file containing a `.md` file and all extracted images

### How to use it

**Option 1 — Open directly (no install needed)**
1. Download this repository as a zip (click the green **Code** button → **Download ZIP**)
2. Unzip it
3. Open `index.html` in Chrome or Safari

**Option 2 — Run the local dev server**
```bash
bash serve.sh
```
Then open [http://localhost:8000](http://localhost:8000) in your browser.

### Loading a PDF and using the sliders

1. Drag a PDF onto the upload zone, or click it to browse for a file
2. The left pane renders the page with coloured bounding boxes:
   - **Green** = Column 1 text
   - **Purple** = Column 2 text
   - **Amber** = Tables
   - **Red** = Images
3. The right pane shows the generated Markdown — switch between **Live Preview** and **Markdown Source** using the tabs
4. Use the sliders to tune the layout detection:
   - **Column Separation** — how wide a gap must be before it's treated as a column split
   - **Row Merge Margin** — vertical tolerance for grouping text into the same line
   - **Min Column Items** — minimum text blocks required to confirm a multi-column layout
   - **Export Image Scale** — resolution multiplier for extracted images (higher = sharper, larger file)
5. Use the arrow buttons (or ← → keys) to move between pages

### Exporting

Click **Export Markdown Package** to download a zip containing:
- `document.md` — the full document in Markdown, one page per section
- `images/` — all extracted images as PNG files, referenced in the Markdown

---

## For developers & contributors

### Tech stack

emdee is vanilla JavaScript with no build step. Dependencies are loaded from CDN:

| Library | Purpose |
| --- | --- |
| [PDF.js 3.4](https://mozilla.github.io/pdf.js/) | PDF rendering and operator list extraction |
| [JSZip 3.10](https://stuk.github.io/jszip/) | In-browser zip assembly for export |
| [marked.js 9.1](https://marked.js.org/) | Markdown → HTML for the live preview |

### File structure

```
emdee/
├── index.html      # App shell, sidebar controls, workspace panes
├── app.js          # All application logic (state, parsing pipeline, export)
├── styles.css      # Design system, layout, component styles
└── serve.sh        # One-liner Python dev server (port 8000)
```

### Architecture — layout parsing pipeline

Each PDF page passes through this sequence in `parseAndRenderPage()`:

1. **Render** — PDF.js draws the page to a `<canvas>` at 1.5× scale
2. **Extract** — text fragments and the operator list (for image/path positions) are pulled from PDF.js
3. **Merge** — adjacent inline text fragments on the same baseline are merged into logical blocks (`mergeInlineFragments`)
4. **Detect tables** — rows with multiple horizontally-separated cells are grouped into table regions (`detectTables`)
5. **Detect columns** — a horizontal density histogram finds low-density gaps in the middle 30% of the page width; slice voting confirms a genuine two-column split (`detectColumns`)
6. **Compile** — blocks are assigned to columns or full-width, sorted in reading order, and interleaved with table and image elements (`compilePageElements`)
7. **Overlay** — SVG rectangles are drawn over the canvas to visualise each detected region
8. **Generate Markdown** — font size statistics calibrate heading thresholds dynamically; tables become pipe tables; images become `![...](images/...)` references (`generatePageMarkdown`)
9. **Crop images** — each detected image region is snapshotted from the canvas at the configured scale

Results are cached per page so navigation is instant on revisit. Changing a slider invalidates only the current page cache and re-runs the pipeline after a 300 ms debounce.

### Contributing

1. Fork this repository
2. Create a branch: `git checkout -b feature/your-feature-name`
3. Make your changes and test against a variety of PDFs
4. Open a pull request with a short description of what you changed and why

Issues and feature requests are welcome — please open a GitHub Issue.

---

*MIT License — see [LICENSE](LICENSE)*
