const APP_VERSION = '0.5.1';

// Initialize PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// --- Application State ---
let pdfDoc = null;
let currentPageNum = 1;
let totalPages = 0;
let pdfFileName = 'document';
let activeTab = 'preview';
let currentZip = null; // reset per-document load

// Export option flags
let includePageNumbers = false;

// Configuration parameters
let colSepThreshold = 40;
let rowMergeMargin = 5;
let minColItemsCount = 4;
let imgCropScale = 2.0;

// Parsed document cache: { pageNum: { markdown, previewHtml, elements, images } }
const parsedPagesCache = {};

// --- DOM Elements ---
const dropzone        = document.getElementById('dropzone');
const fileInput       = document.getElementById('file-input');
const canvasContainer = document.getElementById('canvas-container');
const pdfCanvas       = document.getElementById('pdf-canvas');
const visualOverlay   = document.getElementById('visual-overlay');
const workspaceEmpty  = document.getElementById('workspace-empty');

const currentPageNumEl = document.getElementById('current-page-num');
const totalPagesNumEl  = document.getElementById('total-pages-num');
const prevPageBtn      = document.getElementById('prev-page');
const nextPageBtn      = document.getElementById('next-page');

const statColumnsEl = document.getElementById('stat-columns');
const statTablesEl  = document.getElementById('stat-tables');
const statImagesEl  = document.getElementById('stat-images');

const colSepSlider   = document.getElementById('col-sep-slider');
const rowMergeSlider = document.getElementById('row-merge-slider');
const minItemsSlider = document.getElementById('min-items-slider');
const imgScaleSlider = document.getElementById('img-scale-slider');

const colSepVal   = document.getElementById('col-sep-val');
const rowMergeVal = document.getElementById('row-merge-val');
const minItemsVal = document.getElementById('min-items-val');
const imgScaleVal = document.getElementById('img-scale-val');

const tabPreviewBtn    = document.getElementById('tab-preview');
const tabSourceBtn     = document.getElementById('tab-source');
const outputPreview    = document.getElementById('output-preview');
const outputSource     = document.getElementById('output-source');
const markdownTextarea = document.getElementById('markdown-textarea');
const exportBtn        = document.getElementById('export-btn');
const copyMdBtn        = document.getElementById('copy-md-btn');
const docInfoPanel     = document.getElementById('document-info');

// --- Initialisation ---

document.getElementById('version-badge').textContent = `v${APP_VERSION}`;
document.getElementById('page-numbers-check').addEventListener('change', (e) => {
    includePageNumbers = e.target.checked;
});

// --- Event Listeners ---

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileSelect);

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect();
    }
});

colSepSlider.addEventListener('input', (e) => {
    colSepThreshold = parseInt(e.target.value);
    colSepVal.textContent = colSepThreshold + 'px';
    triggerReparse();
});
rowMergeSlider.addEventListener('input', (e) => {
    rowMergeMargin = parseInt(e.target.value);
    rowMergeVal.textContent = rowMergeMargin + 'px';
    triggerReparse();
});
minItemsSlider.addEventListener('input', (e) => {
    minColItemsCount = parseInt(e.target.value);
    minItemsVal.textContent = minColItemsCount;
    triggerReparse();
});
imgScaleSlider.addEventListener('input', (e) => {
    imgCropScale = parseFloat(e.target.value);
    imgScaleVal.textContent = imgCropScale.toFixed(1) + 'x';
    triggerReparse();
});

prevPageBtn.addEventListener('click', () => navigatePage(-1));
nextPageBtn.addEventListener('click', () => navigatePage(1));

tabPreviewBtn.addEventListener('click', () => switchTab('preview'));
tabSourceBtn.addEventListener('click', () => switchTab('source'));

exportBtn.addEventListener('click', exportMarkdownPackage);

copyMdBtn.addEventListener('click', () => {
    const md = markdownTextarea.value;
    if (!md) return;
    navigator.clipboard.writeText(md).then(() => {
        showToast('Markdown copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Could not copy — try selecting manually.', 'error');
    });
});

// Keyboard page navigation
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigatePage(1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   navigatePage(-1);
});

// --- State Handlers ---

function handleFileSelect() {
    const file = fileInput.files[0];
    if (!file || file.type !== 'application/pdf') {
        showToast('Please select a valid PDF file.', 'error');
        return;
    }

    pdfFileName = file.name.replace(/\.[^/.]+$/, '');
    showToast('Loading document...', 'info');

    // Reset per-document state
    Object.keys(parsedPagesCache).forEach(k => delete parsedPagesCache[k]);
    currentZip = new JSZip(); // fresh zip per document

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        try {
            const typedarray = new Uint8Array(this.result);
            pdfDoc = await pdfjsLib.getDocument({ data: typedarray }).promise;
            totalPages = pdfDoc.numPages;
            currentPageNum = 1;

            totalPagesNumEl.textContent = totalPages;
            docInfoPanel.classList.remove('hidden');
            workspaceEmpty.classList.add('hidden');
            canvasContainer.style.display = 'block';
            exportBtn.removeAttribute('disabled');
            copyMdBtn.removeAttribute('disabled');

            await loadPage(currentPageNum);
            showToast('Document parsed successfully!', 'success');
        } catch (error) {
            console.error('PDF parsing error:', error);
            showToast('Failed to load PDF file.', 'error');
        }
    };
    fileReader.readAsArrayBuffer(file);
}

async function loadPage(pageNum) {
    if (!pdfDoc) return;
    currentPageNum = pageNum;
    currentPageNumEl.textContent = pageNum;
    prevPageBtn.disabled = pageNum <= 1;
    nextPageBtn.disabled = pageNum >= totalPages;
    showToast(`Parsing page ${pageNum}…`, 'info');

    if (parsedPagesCache[pageNum]) {
        await renderPageFromCache(pageNum);
    } else {
        await parseAndRenderPage(pageNum);
    }
}

function navigatePage(direction) {
    const target = currentPageNum + direction;
    if (target >= 1 && target <= totalPages) loadPage(target);
}

function switchTab(tab) {
    activeTab = tab;
    if (tab === 'preview') {
        tabPreviewBtn.classList.add('active');
        tabSourceBtn.classList.remove('active');
        outputPreview.classList.add('active');
        outputSource.classList.remove('active');
    } else {
        tabPreviewBtn.classList.remove('active');
        tabSourceBtn.classList.add('active');
        outputPreview.classList.remove('active');
        outputSource.classList.add('active');
    }
}

let reparseTimeout = null;
function triggerReparse() {
    if (!pdfDoc) return;
    if (reparseTimeout) clearTimeout(reparseTimeout);
    reparseTimeout = setTimeout(async () => {
        // Invalidate current page cache so it re-parses with new params
        delete parsedPagesCache[currentPageNum];
        showToast('Recalculating layout…', 'info');
        await parseAndRenderPage(currentPageNum);
    }, 300);
}

// --- Layout Parsing Core ---

async function parseAndRenderPage(pageNum) {
    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        // 1. Render PDF to canvas
        const canvasCtx = pdfCanvas.getContext('2d');
        pdfCanvas.width  = viewport.width;
        pdfCanvas.height = viewport.height;
        await page.render({ canvasContext: canvasCtx, viewport }).promise;

        // Setup SVG overlay
        visualOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
        visualOverlay.innerHTML = '';

        // 2. Extract text & graphics
        const textContent  = await page.getTextContent({ normalizeWhitespace: true });
        const operatorList = await page.getOperatorList();
        const pageImages   = await extractImagePositions(page, operatorList, viewport);

        // 3. Process text
        const textBlocks = processTextFragments(textContent.items, viewport);

        // 4. Detect structure
        const tables         = detectTables(textBlocks);
        const nonTableBlocks = textBlocks.filter(block =>
            !tables.some(t =>
                block.x >= t.x && block.right <= t.right &&
                block.y >= t.y && block.bottom <= t.bottom
            )
        );
        const columns = detectColumns(nonTableBlocks, viewport.width);

        // 5. Compile ordered elements
        const compiledElements = compilePageElements(textBlocks, columns, tables, pageImages, viewport.width);

        // 6. Draw overlays
        drawOverlayHighlights(compiledElements);

        // 7. Generate markdown
        const pageMarkdown = generatePageMarkdown(compiledElements, pageImages, pageNum);
        const previewHtml  = marked.parse(pageMarkdown);

        // 8. Crop images (with per-image error isolation)
        const croppedImages = await cropPageImages(pdfCanvas, pageImages);

        updatePageStats(compiledElements, pageImages);

        parsedPagesCache[pageNum] = {
            markdown:    pageMarkdown,
            previewHtml: previewHtml,
            elements:    compiledElements,
            images:      croppedImages
        };

        renderPageFromCache(pageNum);

    } catch (error) {
        console.error('Error during page processing:', error);
        showToast('Error parsing page layout.', 'error');
    }
}

async function renderPageFromCache(pageNum) {
    const cached = parsedPagesCache[pageNum];
    if (!cached) return;

    // Re-render the PDF page onto the canvas so the visual pane matches the page
    const page     = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    pdfCanvas.width  = viewport.width;
    pdfCanvas.height = viewport.height;
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

    visualOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    visualOverlay.innerHTML = '';
    drawOverlayHighlights(cached.elements);

    markdownTextarea.value  = cached.markdown;
    outputPreview.innerHTML = cached.previewHtml;

    const colCount   = cached.elements.some(e => e.column === 1 || e.column === 2) ? 2 : 1;
    const tableCount = cached.elements.filter(e => e.type === 'table').length;

    statColumnsEl.textContent = colCount;
    statTablesEl.textContent  = tableCount;
    statImagesEl.textContent  = cached.images.length;
}

// --- Text Processing ---

function processTextFragments(items, viewport) {
    const blocks = [];

    items.forEach(item => {
        if (!item.str.trim()) return;

        const start = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const end   = viewport.convertToViewportPoint(
            item.transform[4] + item.width,
            item.transform[5] + item.height
        );

        const x      = Math.min(start[0], end[0]);
        const y      = Math.min(start[1], end[1]);
        const width  = Math.abs(start[0] - end[0]);
        const height = Math.abs(start[1] - end[1]);

        // Extract font name to help detect bold/italic
        const fontName = (item.fontName || '').toLowerCase();
        const isBold   = /bold|heavy|black|semibold|demibold/i.test(fontName);
        const isItalic = /italic|oblique/i.test(fontName);

        blocks.push({
            str:      item.str,
            x, y, width, height,
            right:    x + width,
            bottom:   y + height,
            fontSize: Math.abs(item.transform[3]),
            isBold,
            isItalic
        });
    });

    return mergeInlineFragments(blocks);
}

function mergeInlineFragments(blocks) {
    if (blocks.length === 0) return [];

    blocks.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 3) return a.x - b.x;
        return a.y - b.y;
    });

    const merged = [];
    let current = { ...blocks[0] };

    for (let i = 1; i < blocks.length; i++) {
        const next = blocks[i];
        const sameLine = Math.abs(current.y - next.y) < 3;
        const gap = next.x - current.right;

        // List markers ("1.", "2.", "●", etc.) are often separated from their text by a wide
        // tab stop in Google Docs PDFs. Allow a larger merge gap for these fragments.
        const isListMarker = /^(\d+\.|[●•·▼▸►◦‣□○])$/.test(current.str.trim());
        const mergeGap = isListMarker ? 60 : 8;
        if (sameLine && gap < mergeGap) {
            current.str    += (gap > 1.5 ? ' ' : '') + next.str;
            current.width   = next.right - current.x;
            current.right   = next.right;
            current.height  = Math.max(current.height, next.height);
            // Propagate font properties: if any fragment is bold/italic keep it
            current.isBold   = current.isBold   || next.isBold;
            current.isItalic = current.isItalic || next.isItalic;
        } else {
            merged.push(current);
            current = { ...next };
        }
    }
    merged.push(current);
    return merged;
}

// --- Layout Clustering ---

function detectColumns(blocks, pageWidth) {
    if (blocks.length < minColItemsCount) return null;

    const binCount = 100;
    const binWidth = pageWidth / binCount;
    const histogram = new Array(binCount).fill(0);

    blocks.forEach(block => {
        const startBin = Math.max(0, Math.floor(block.x / binWidth));
        const endBin   = Math.min(binCount - 1, Math.floor(block.right / binWidth));
        for (let i = startBin; i <= endBin; i++) histogram[i]++;
    });

    const middleStart = Math.floor(binCount * 0.35);
    const middleEnd   = Math.floor(binCount * 0.65);

    let minDensity = Infinity;
    let minBinIndex = -1;
    for (let i = middleStart; i <= middleEnd; i++) {
        if (histogram[i] < minDensity) { minDensity = histogram[i]; minBinIndex = i; }
    }
    if (minBinIndex === -1) return null;

    const dividerX  = minBinIndex * binWidth;
    const sliceCount = 80;

    let maxBlockY = -Infinity, minBlockY = Infinity;
    blocks.forEach(b => { minBlockY = Math.min(minBlockY, b.y); maxBlockY = Math.max(maxBlockY, b.bottom); });

    const pageHeight = maxBlockY - minBlockY;
    if (pageHeight <= 0) return null;

    const sliceHeight  = pageHeight / sliceCount;
    const leftSlices   = new Array(sliceCount).fill(false);
    const rightSlices  = new Array(sliceCount).fill(false);
    const fullSlices   = new Array(sliceCount).fill(false);

    blocks.forEach(block => {
        const startSlice = Math.max(0, Math.floor((block.y - minBlockY) / sliceHeight));
        const endSlice   = Math.min(sliceCount - 1, Math.floor((block.bottom - minBlockY) / sliceHeight));
        for (let s = startSlice; s <= endSlice; s++) {
            if (block.right <= dividerX) {
                leftSlices[s] = true;
            } else if (block.x >= dividerX) {
                rightSlices[s] = true;
            } else {
                if (block.width > pageWidth * 0.45) {
                    fullSlices[s] = true;
                } else {
                    (block.x + block.width / 2 < dividerX ? leftSlices : rightSlices)[s] = true;
                }
            }
        }
    });

    let splitSlicesCount = 0, activeTextSlices = 0;
    for (let s = 0; s < sliceCount; s++) {
        if (leftSlices[s] || rightSlices[s] || fullSlices[s]) {
            activeTextSlices++;
            if (leftSlices[s] && rightSlices[s] && !fullSlices[s]) splitSlicesCount++;
        }
    }

    const splitRatio = activeTextSlices > 0 ? splitSlicesCount / activeTextSlices : 0;
    if (splitSlicesCount >= 6 && splitRatio >= 0.20) {
        return {
            dividerX,
            leftColBoundary:  dividerX - colSepThreshold / 2,
            rightColBoundary: dividerX + colSepThreshold / 2
        };
    }
    return null;
}

function detectTables(blocks) {
    if (blocks.length === 0) return [];

    const items = [...blocks].sort((a, b) => a.y - b.y);
    const lines = [];
    let currentLine = [items[0]];

    for (let i = 1; i < items.length; i++) {
        if (Math.abs(items[i].y - currentLine[0].y) < 6) {
            currentLine.push(items[i]);
        } else {
            lines.push(currentLine);
            currentLine = [items[i]];
        }
    }
    lines.push(currentLine);
    lines.forEach(line => line.sort((a, b) => a.x - b.x));

    const BULLET_CHARS = ['•', '·', '▼', '▸', '►', '◦', '‣', '□', '○', '●', '–', '—'];
    const tableRowCandidates = [];
    lines.forEach(line => {
        if (line.length >= 2) {
            // Skip list items — a leading bullet or short marker fragment is not a table cell
            const firstStr = line[0].str.trim();
            const isBulletLine = BULLET_CHARS.some(b => firstStr === b || firstStr.startsWith(b + ' '))
                || /^[•·▼▸►◦‣□○●]/.test(firstStr);
            if (isBulletLine) return;

            for (let i = 1; i < line.length; i++) {
                if (line[i].x - line[i - 1].right > 15) {
                    tableRowCandidates.push(line);
                    break;
                }
            }
        }
    });

    const tableGroups = [];
    if (tableRowCandidates.length > 0) {
        let currentGroup = [tableRowCandidates[0]];
        for (let i = 1; i < tableRowCandidates.length; i++) {
            const prevRow = currentGroup[currentGroup.length - 1];
            const gap = tableRowCandidates[i][0].y - prevRow[0].bottom;
            if (gap < 35) {
                currentGroup.push(tableRowCandidates[i]);
            } else {
                if (currentGroup.length >= 2) tableGroups.push(currentGroup);
                currentGroup = [tableRowCandidates[i]];
            }
        }
        if (currentGroup.length >= 2) tableGroups.push(currentGroup);
    }

    return tableGroups.map(constructTableData);
}

function constructTableData(rows) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rows.forEach(row => row.forEach(cell => {
        minX = Math.min(minX, cell.x);   maxX = Math.max(maxX, cell.right);
        minY = Math.min(minY, cell.y);   maxY = Math.max(maxY, cell.bottom);
    }));
    return {
        x: minX - 5, y: minY - 5,
        width: (maxX - minX) + 10, height: (maxY - minY) + 10,
        right: maxX + 5, bottom: maxY + 5,
        rows
    };
}

function compilePageElements(blocks, columns, tables, images, pageWidth) {
    const elements = [];

    const filteredBlocks = blocks.filter(block => {
        const inTable = tables.some(t =>
            block.x >= t.x && block.right <= t.right &&
            block.y >= t.y && block.bottom <= t.bottom
        );
        if (inTable) return false;
        // Only suppress text inside raster images, not vector-path bounding boxes.
        // Vector bounding boxes are approximate hulls of path clusters (card backgrounds,
        // table shading, decorative borders) — they routinely contain real heading text.
        const inImage = images.some(img =>
            !img.isVector &&
            block.x >= img.x - 3 && block.right <= img.right + 3 &&
            block.y >= img.y - 3 && block.bottom <= img.bottom + 3
        );
        return !inImage;
    });

    tables.forEach(table => elements.push({
        type: 'table',
        x: table.x, y: table.y, width: table.width, height: table.height,
        right: table.right, bottom: table.bottom,
        tableData: table,
        column: 0
    }));

    filteredBlocks.forEach(block => {
        let blockCol = 0;
        if (columns) {
            if (block.right <= columns.dividerX) {
                blockCol = 1;
            } else if (block.x >= columns.dividerX) {
                blockCol = 2;
            } else {
                const center = block.x + block.width / 2;
                if (block.width < pageWidth * 0.8) blockCol = center < columns.dividerX ? 1 : 2;
            }
        }
        elements.push({
            type: 'text',
            x: block.x, y: block.y, width: block.width, height: block.height,
            right: block.right, bottom: block.bottom,
            str:      block.str,
            fontSize: block.fontSize,
            isBold:   block.isBold,
            isItalic: block.isItalic,
            column:   blockCol
        });
    });

    images.forEach((img, idx) => elements.push({
        type: 'image',
        x: img.x, y: img.y, width: img.width, height: img.height,
        right: img.right, bottom: img.bottom,
        imageIndex: idx,
        isVector: img.isVector,
        column: 0
    }));

    // Sort: left column first, then right, full-width elements interleaved by Y
    elements.sort((a, b) => {
        const aC = a.column, bC = b.column;

        // Both columnar (1 or 2) — different columns: left before right
        if (aC !== 0 && bC !== 0 && aC !== bC) return aC - bC;

        // Full-width (0) vs columnar: slot by Y position relative to column content
        if (aC === 0 && bC !== 0) return a.y - b.y;
        if (aC !== 0 && bC === 0) return a.y - b.y;

        // Same column: sort top-to-bottom, ties left-to-right
        if (Math.abs(a.y - b.y) < rowMergeMargin) return a.x - b.x;
        return a.y - b.y;
    });

    return elements;
}

// --- Image Extraction ---

async function extractImagePositions(page, operatorList, viewport) {
    const images     = [];
    const pathPoints = [];
    const fnArray    = operatorList.fnArray;
    const argsArray  = operatorList.argsArray;

    let currentTransform = [1, 0, 0, 1, 0, 0];
    const stateStack = [];

    for (let i = 0; i < fnArray.length; i++) {
        const fn   = fnArray[i];
        const args = argsArray[i];

        if      (fn === pdfjsLib.OPS.save)      stateStack.push([...currentTransform]);
        else if (fn === pdfjsLib.OPS.restore)   { if (stateStack.length) currentTransform = stateStack.pop(); }
        else if (fn === pdfjsLib.OPS.transform) currentTransform = multiplyMatrices(currentTransform, args);
        else if (
            fn === pdfjsLib.OPS.paintImageXObject ||
            fn === pdfjsLib.OPS.paintInlineImageXObject ||
            fn === pdfjsLib.OPS.paintJpegXObject
        ) {
            const [a, b, c, d, e, f] = currentTransform;
            const corners = [[e,f],[a+e,b+f],[c+e,d+f],[a+c+e,b+d+f]];
            const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
            const screenRect = viewport.convertToViewportRectangle([
                Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)
            ]);
            const x = Math.min(screenRect[0], screenRect[2]);
            const y = Math.min(screenRect[1], screenRect[3]);
            const w = Math.abs(screenRect[0] - screenRect[2]);
            const h = Math.abs(screenRect[1] - screenRect[3]);
            if (w > 8 && h > 8 && w < viewport.width * 0.95 && h < viewport.height * 0.95) {
                images.push({ x, y, width: w, height: h, right: x+w, bottom: y+h, isVector: false });
            }
        } else if (fn === pdfjsLib.OPS.constructPath) {
            const coords = args[1];
            if (coords && coords.length > 0) {
                const [a, b, c, d, e, f] = currentTransform;
                for (let j = 0; j < coords.length - 1; j += 2) {
                    const tx = a * coords[j] + c * coords[j+1] + e;
                    const ty = b * coords[j] + d * coords[j+1] + f;
                    const pt = viewport.convertToViewportPoint(tx, ty);
                    pathPoints.push({ x: pt[0], y: pt[1] });
                }
            }
        }
    }

    // Cluster vector path points into chart/diagram bounding boxes.
    // Only treat a cluster as an image if it has enough points and a reasonable
    // aspect ratio — thin/flat shapes are decorative lines or table shading, not charts.
    const vectorGraphics = [];
    if (pathPoints.length >= 10) {
        const pts = [...pathPoints].sort((a, b) => a.y - b.y);
        let currentGroup = [pts[0]];
        const groups = [];

        for (let j = 1; j < pts.length; j++) {
            // Tighter Y-gap (40px vs 80px) avoids merging separate card/section backgrounds
            if (pts[j].y - currentGroup[currentGroup.length - 1].y < 40) {
                currentGroup.push(pts[j]);
            } else {
                groups.push(currentGroup);
                currentGroup = [pts[j]];
            }
        }
        groups.push(currentGroup);

        groups.forEach(group => {
            if (group.length < 20) return; // require more points — simple borders have far fewer
            const minX = Math.min(...group.map(p => p.x));
            const maxX = Math.max(...group.map(p => p.x));
            const minY = Math.min(...group.map(p => p.y));
            const maxY = Math.max(...group.map(p => p.y));
            const w = maxX - minX, h = maxY - minY;
            // Require minimum height of 60px and aspect ratio ≤ 8:1 to skip thin horizontal rules
            if (w > 50 && h > 60 && w / h <= 8 && w < viewport.width * 0.95 && h < viewport.height * 0.95) {
                vectorGraphics.push({
                    x: Math.max(0, minX - 10), y: Math.max(0, minY - 10),
                    width:  Math.min(viewport.width - minX,  w + 20),
                    height: Math.min(viewport.height - minY, h + 20),
                    right:  Math.min(viewport.width,  maxX + 10),
                    bottom: Math.min(viewport.height, maxY + 10),
                    isVector: true
                });
            }
        });
    }

    // Merge rasters + vectors, deduplicate
    const combined = [...images];
    vectorGraphics.forEach(vg => {
        const isDup = combined.some(img => {
            const ox = Math.max(0, Math.min(vg.right, img.right) - Math.max(vg.x, img.x));
            const oy = Math.max(0, Math.min(vg.bottom, img.bottom) - Math.max(vg.y, img.y));
            return (ox * oy) / (vg.width * vg.height) > 0.5;
        });
        if (!isDup) combined.push(vg);
    });

    return combined;
}

function multiplyMatrices(m1, m2) {
    return [
        m1[0]*m2[0] + m1[2]*m2[1],
        m1[1]*m2[0] + m1[3]*m2[1],
        m1[0]*m2[2] + m1[2]*m2[3],
        m1[1]*m2[2] + m1[3]*m2[3],
        m1[0]*m2[4] + m1[2]*m2[5] + m1[4],
        m1[1]*m2[4] + m1[3]*m2[5] + m1[5]
    ];
}

async function cropPageImages(pageCanvas, imagePositions) {
    const croppedFiles = [];
    for (let i = 0; i < imagePositions.length; i++) {
        const pos = imagePositions[i];
        // Skip vector-detected regions — they're decorative backgrounds, not exportable images
        if (pos.isVector) {
            croppedFiles.push({ index: i, dataUrl: null, boundingBox: pos });
            continue;
        }
        try {
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width  = Math.ceil(pos.width  * imgCropScale);
            cropCanvas.height = Math.ceil(pos.height * imgCropScale);
            const ctx = cropCanvas.getContext('2d');
            ctx.drawImage(pageCanvas, pos.x, pos.y, pos.width, pos.height,
                          0, 0, cropCanvas.width, cropCanvas.height);
            croppedFiles.push({ index: i, dataUrl: cropCanvas.toDataURL('image/png'), boundingBox: pos });
        } catch (err) {
            console.warn(`Image crop failed for index ${i}:`, err);
            // Push a placeholder so indices stay aligned with imagePositions
            croppedFiles.push({ index: i, dataUrl: null, boundingBox: pos });
        }
    }
    return croppedFiles;
}

// --- Overlay Visualization ---

function drawOverlayHighlights(elements) {
    elements.forEach(el => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', el.x);
        rect.setAttribute('y', el.y);
        rect.setAttribute('width',  el.width);
        rect.setAttribute('height', el.height);
        rect.setAttribute('rx', '3');
        rect.setAttribute('class', 'svg-highlight');
        if      (el.type === 'text'  && el.column === 1) rect.classList.add('svg-highlight-col1');
        else if (el.type === 'text'  && el.column === 2) rect.classList.add('svg-highlight-col2');
        else if (el.type === 'table')                    rect.classList.add('svg-highlight-table');
        else if (el.type === 'image')                    rect.classList.add('svg-highlight-image');
        visualOverlay.appendChild(rect);
    });
}

// --- Markdown Generation ---

// Compute font size stats to calibrate heading thresholds dynamically.
// `body` is the modal size of the lower 60% of elements — the true body text anchor,
// unaffected by decorative large elements (badge numbers, pull quotes) that skew p75.
function computeFontStats(elements) {
    const sizes = elements
        .filter(e => e.type === 'text')
        .map(e => e.fontSize)
        .sort((a, b) => a - b);
    if (sizes.length === 0) return { median: 12, p75: 14, body: 10 };
    const median = sizes[Math.floor(sizes.length / 2)];
    const p75    = sizes[Math.floor(sizes.length * 0.75)];

    const lowerSlice = sizes.slice(0, Math.ceil(sizes.length * 0.6));
    const freq = {};
    lowerSlice.forEach(s => {
        const key = Math.round(s * 2) / 2; // bucket to nearest 0.5pt
        freq[key] = (freq[key] || 0) + 1;
    });
    const body = parseFloat(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);

    return { median, p75, body };
}

function generatePageMarkdown(elements, images, pageNum) {
    const { median, p75, body } = computeFontStats(elements);

    // Anchor thresholds to body text size (modal of lower distribution),
    // so decorative large elements (badge numbers, pull quotes) don't inflate p75
    // and push heading thresholds above the actual headings.
    const base = body || median;
    const h1Threshold = Math.max(base * 1.9, p75 * 1.25);
    const h2Threshold = Math.max(base * 1.3,  p75 * 1.02);

    let markdown = `<!-- Page ${pageNum} -->\n\n`;

    for (let i = 0; i < elements.length; i++) {
        const el   = elements[i];
        const next = elements[i + 1];

        if (el.type === 'text') {
            const text = el.isBold ? `**${el.str}**` : (el.isItalic ? `*${el.str}*` : el.str);

            // Numbered subsection pattern (e.g. "2.1 Campaign Settings") → always H2
            const isNumberedSub = /^\d+\.\d+\s/.test(el.str);

            // Minimum string length guards: single-char badge numbers ("1","2") must not become headings
            const longEnough = el.str.trim().length >= 3;

            if (el.fontSize >= h1Threshold && longEnough) {
                markdown += `\n# ${el.str}\n\n`;
            } else if (longEnough && (
                el.fontSize >= h2Threshold ||
                (el.isBold && el.fontSize > base * 1.1) ||
                isNumberedSub
            )) {
                markdown += `\n## ${el.str}\n\n`;
            } else {
                const trimmed = el.str.trim();
                // Bullet list item: starts with a bullet character
                const LIST_BULLET_RE = /^[●•·▼▸►◦‣□○]/;
                // Numbered list item: starts with "N. text" — requires space+non-space after dot
                // to avoid false matches on decimals ("1.5") or mid-sentence refs ("Figure 1.")
                const LIST_NUMBERED_RE = /^\d+\.\s+\S/;

                if (LIST_BULLET_RE.test(trimmed)) {
                    // Split in case multiple bullet items were merged into one block
                    const parts = trimmed.split(/\s+(?=[●•·▼▸►◦‣□○])/);
                    parts.forEach(part => {
                        const content = part.replace(/^[●•·▼▸►◦‣□○]\s*/, '').trim();
                        if (content) markdown += '\n- ' + content + '\n';
                    });
                } else if (LIST_NUMBERED_RE.test(trimmed)) {
                    // Split in case multiple numbered items were merged into one block
                    const parts = trimmed.split(/\s+(?=\d+\.\s)/);
                    if (parts.length > 1) {
                        parts.forEach(part => { if (part.trim()) markdown += '\n' + part.trim() + '\n'; });
                    } else {
                        markdown += '\n' + trimmed + '\n';
                    }
                } else {
                    markdown += text + ' ';
                    if (!next || next.type !== 'text' || Math.abs(next.y - el.y) > 24) {
                        markdown += '\n\n';
                    }
                }
            }
        } else if (el.type === 'table') {
            markdown += '\n\n' + formatTableToMarkdown(el.tableData) + '\n\n';
        } else if (el.type === 'image' && !el.isVector) {
            markdown += `\n\n![Image extracted from page ${pageNum}](images/image_${pageNum}_${el.imageIndex}.png)\n\n`;
        }
    }

    return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

// Merge continuation rows caused by PDF cell-wrapping.
// A row is a continuation when most cells are empty (≤30% filled) AND at least
// one non-empty cell lines up with a non-empty cell in the row above.
function mergeWrappedRows(grid, colCount) {
    if (colCount === 0) return grid;
    const merged = [];
    for (const row of grid) {
        const nonEmpty = row.filter(c => c !== '').length;
        const isSparse  = nonEmpty > 0 && nonEmpty / colCount <= 0.3;
        if (merged.length > 0 && isSparse) {
            const prev = merged[merged.length - 1];
            const continuesFromPrev = row.some((c, i) => c !== '' && prev[i] !== '');
            if (continuesFromPrev) {
                row.forEach((c, i) => { if (c !== '') prev[i] = prev[i] + ' ' + c; });
                continue;
            }
        }
        merged.push([...row]);
    }
    return merged;
}

function formatTableToMarkdown(table) {
    const rows = table.rows;
    if (rows.length === 0) return '';

    const xCoords = [];
    rows.forEach(row => row.forEach(cell => xCoords.push(cell.x)));
    xCoords.sort((a, b) => a - b);

    const colLefts = [];
    if (xCoords.length > 0) {
        let currentLeft = xCoords[0];
        colLefts.push(currentLeft);
        for (let i = 1; i < xCoords.length; i++) {
            if (xCoords[i] - currentLeft > 25) { currentLeft = xCoords[i]; colLefts.push(currentLeft); }
        }
    }

    const colCount = colLefts.length;
    if (colCount === 0) return '';

    const rawGrid = rows.map(row => {
        const gridRow = new Array(colCount).fill('');
        row.forEach(cell => {
            let best = 0, minDiff = Infinity;
            for (let c = 0; c < colCount; c++) {
                const d = Math.abs(cell.x - colLefts[c]);
                if (d < minDiff) { minDiff = d; best = c; }
            }
            gridRow[best] = cell.str.trim();
        });
        return gridRow;
    });

    const grid = mergeWrappedRows(rawGrid, colCount);

    let md = '';
    md += '| ' + grid[0].join(' | ') + ' |\n';
    md += '| ' + new Array(colCount).fill('---').join(' | ') + ' |\n';
    for (let r = 1; r < grid.length; r++) {
        if (grid[r].some(c => c !== '')) md += '| ' + grid[r].join(' | ') + ' |\n';
    }
    return md;
}

// --- Header / Footer Detection ---

// Returns a Set of text strings that appear repeatedly in the top/bottom margins
// across enough pages to be considered structural chrome (headers/footers).
// Matches bare page numbers in footer/header zones: "3", "Page 3", "3 of 10", "- 3 -", "3 / 10"
const PAGE_NUMBER_RE = /^(-\s*)?\d+(\s*[-\/]\s*\d+)?(\s*-)?$|^[Pp]age\s+\d+(\s+of\s+\d+)?$|^\d+\s+of\s+\d+$/;

function detectHeaderFooterTexts() {
    if (totalPages < 2) return new Set();

    const textCount = {};
    const pageNumKeys = new Set();

    for (let p = 1; p <= totalPages; p++) {
        const cached = parsedPagesCache[p];
        if (!cached) continue;

        const textEls = cached.elements.filter(e => e.type === 'text');
        if (!textEls.length) continue;

        const minY     = Math.min(...textEls.map(e => e.y));
        const maxY     = Math.max(...textEls.map(e => e.bottom));
        const span     = maxY - minY;
        if (span <= 0) continue;

        const headerLimit = minY + span * 0.07;
        const footerLimit = maxY - span * 0.07;

        const seenThisPage = new Set();
        textEls.forEach(el => {
            const inMargin = el.bottom <= headerLimit || el.y >= footerLimit;
            if (!inMargin) return;
            const key = el.str.trim();
            if (!key) return;
            // Page-number patterns: unique per page but still chrome — collect separately
            if (PAGE_NUMBER_RE.test(key)) {
                pageNumKeys.add(key);
                return;
            }
            if (key.length < 4 || seenThisPage.has(key)) return;
            seenThisPage.add(key);
            textCount[key] = (textCount[key] || 0) + 1;
        });
    }

    // Threshold: appears on at least 40% of pages (min 2)
    const threshold = Math.max(2, Math.ceil(totalPages * 0.4));
    const frequencyMatches = Object.entries(textCount)
        .filter(([, n]) => n >= threshold)
        .map(([text]) => text);

    return new Set([...frequencyMatches, ...pageNumKeys]);
}

// --- Export ---

async function exportMarkdownPackage() {
    if (!pdfDoc) return;
    showToast('Compiling export package…', 'info');

    try {
        currentZip = new JSZip();

        // Parse all pages first so header/footer detection has full data
        for (let p = 1; p <= totalPages; p++) {
            if (!parsedPagesCache[p]) await parseAndRenderPage(p);
        }

        const headerFooterTexts = detectHeaderFooterTexts();
        const mdPages = [];

        for (let p = 1; p <= totalPages; p++) {
            const cached = parsedPagesCache[p];

            // Re-generate markdown with header/footer text filtered out
            const filteredElements = cached.elements.filter(el =>
                el.type !== 'text' || !headerFooterTexts.has(el.str.trim())
            );
            let pageMarkdown = generatePageMarkdown(filteredElements, [], p);

            // Optionally prepend a page number line
            if (includePageNumbers) {
                pageMarkdown = `*Page ${p}*\n\n` + pageMarkdown;
            }

            mdPages.push(pageMarkdown);

            // Add image files to zip
            cached.images.forEach(img => {
                if (img.dataUrl) {
                    const b64 = img.dataUrl.split(',')[1];
                    currentZip.file(`images/image_${p}_${img.index}.png`, b64, { base64: true });
                }
            });
        }

        const fullMarkdown =
            `# ${pdfFileName}\n\n` +
            `*Converted on ${new Date().toLocaleDateString()} with emdee v${APP_VERSION}*\n\n---\n\n` +
            mdPages.join('\n\n---\n\n');

        currentZip.file('document.md', fullMarkdown);

        const zipBlob = await currentZip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = `${pdfFileName}_markdown_package.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast('Export complete! Zip downloaded.', 'success');
    } catch (err) {
        console.error('ZIP error:', err);
        showToast('Failed to create export package.', 'error');
    }
}

// --- Utilities ---

function updatePageStats(elements, images) {
    statColumnsEl.textContent = elements.some(e => e.column === 1 || e.column === 2) ? 2 : 1;
    statTablesEl.textContent  = elements.filter(e => e.type === 'table').length;
    statImagesEl.textContent  = images.length;
}

function showToast(message, type = 'info') {
    const toast  = document.getElementById('toast');
    const msgEl  = document.getElementById('toast-message');
    msgEl.textContent = message;
    toast.className = 'toast';

    if      (type === 'error')   toast.style.borderLeftColor = 'var(--color-image)';
    else if (type === 'success') toast.style.borderLeftColor = 'var(--color-col-1)';
    else                         toast.style.borderLeftColor = 'var(--primary-color)';

    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}
