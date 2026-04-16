const { ipcRenderer } = require('electron');
const fs = require('fs');

let recentFiles = [];

let doc = null;
let ModuleRef = null;
let currentPolyline = [];
let mousePos = null;

let gMoveActive = false;
let gNodes = [];   // array of nodes being moved
let gOrigin = null; // reference position (mouse at start)
let gMoveDelta = { dx: 0, dy: 0 };

let gRotateActive = false;
let gRotateAngle = null;

let PPU = 96;

const canvas = document.getElementById('cadCanvas');
const ctx = canvas.getContext('2d');
canvas.width = 8.5 * PPU;
canvas.height = 11 * PPU;

let snapEnabled = false;      // toggle snaPPUng on/off
let snapToGrid = false;       // snap to grid
let snapToNodes = false;      // snap to existing nodes
let snapToGuides = false;     // snap to guides
let ghostSnap = null; // position of ghost node
const snapRadius = 10;       // max distance for snaPPUng (pixels)
let spacing = getGridSpacing();
let multiSelect = false;
let activeNode = null;
let filletRadius = 0;
let filletCancelled = false;
let visibleDynamicInput = false;

let currentWorkspace = "pattern";

const UNDO_LIMIT = 25;
let undoStack = [];
let redoStack = [];

let clipboard = [];

const unitsSelect = document.getElementById('unitsSelect');
const pageType = document.getElementById('pageType');
const pageWidth = document.getElementById('pageWidth');
const pageHeight = document.getElementById('pageHeight');
const customSize = document.getElementById('customSize');

let selectedGuideIndex = null;
let guideDragActive = false;
const guideSelectRadius = 6; // pixels

const dynamicInput = document.getElementById("dynamicInput");
const dynamicLabel = document.getElementById("dynamicLabel");
const dynamicDiv = document.getElementById("dynamicNumberInput");

let currentContext = null; // "node", "hGuide", "vGuide"
let activeObject = null;   // reference to node or guide being edited

let toolingCanvas = document.getElementById("toolingCanvas");
let toolingCtx = toolingCanvas.getContext("2d");
let isDrawing = false;
let currentStroke = [];
let simplify = true;

// fit window better
function resizeWindow() {
    // optional: shrink canvas slightly to fit window
    const margin = 20;
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    document.body.style.height = `${canvas.height + margin}px`;
    document.body.style.overflow = 'hidden'; // prevent scrollbar
}
resizeWindow();
window.addEventListener('resize', resizeWindow);

const inputX = document.getElementById('inputX');
const inputY = document.getElementById('inputY');
const coordContainer = document.getElementById('coordinateInput');

// --------------------- IPC -----------------------
// Dark Mode Toggle
ipcRenderer.on('toggle-dark', () => {
    const isDark = document.body.classList.toggle('dark-mode');

    ipcRenderer.send('set-setting', 'darkMode', isDark);
});

// Update Settings
ipcRenderer.on('setting-updated', (event, key, value) => {
    if (key === 'darkMode') {
        document.body.classList.toggle('dark-mode', value);
    }

    if (key === 'page' || key === 'units') {
        ipcRenderer.invoke('get-settings').then(applyDocumentSettings);
    }

    if (key === 'theme') {

    }
});


// Workspace
ipcRenderer.on('set-workspace', (event, mode) => {
    console.log('Switching workspace to:', mode);
    currentWorkspace = mode;
    if (currentWorkspace === 'tooling') showToolingWorkspace();
    if (currentWorkspace === 'pattern') showPatternWorkspace();
    // update UI accordingly
});

// Tool selection
ipcRenderer.on('set-tool', (event, tool) => {
    currentTool = tool;
    updateToolIndicator();
});

// Print
ipcRenderer.on('print', async () => {
    if (!doc) return;

    // Get current page settings
    const settings = await ipcRenderer.invoke('get-settings');

    // Page dimensions in pixels
    let pageWidthPx = 8.5 * PPU;   // default letter
    let pageHeightPx = 11 * PPU;

    if (settings.page.type === 'a4') {
        pageWidthPx = 210 * PPU;
        pageHeightPx = 297 * PPU;
    } else if (settings.page.type === 'custom') {
        pageWidthPx = settings.page.width * PPU;
        pageHeightPx = settings.page.height * PPU;
    }

    // Create canvas matching page size
    const printCanvas = document.createElement('canvas');
    printCanvas.width = pageWidthPx;
    printCanvas.height = pageHeightPx;
    const printCtx = printCanvas.getContext('2d');

    // Fill white background
    printCtx.fillStyle = '#fff';
    printCtx.fillRect(0, 0, printCanvas.width, printCanvas.height);

    // Draw entities exactly in document coordinates (no scaling)
    drawEntitiesOnCtx(printCtx);
    drawOverlayOnCtx(printCtx);

    // Open print window
    const dataUrl = printCanvas.toDataURL();
    const printWindow = window.open('', '_blank');

    printWindow.document.open();
    printWindow.document.write(`
        <html>
        <head>
            <title>Print</title>
            <style>
                @page { size: ${settings.page.type === 'a4' ? 'A4' : 'letter'}; margin: 0; }
                body { margin: 0; padding: 0; }
                img {
                    display: block;
                    width: auto;
                    height: auto;
                }
            </style>
        </head>
        <body>
            <img src="${dataUrl}" onload="window.focus(); window.print();">
        </body>
        </html>
    `);
    printWindow.document.close();
});

function drawEntitiesOnCtx(ctxRef) {
    if (!doc) return;

    ctxRef.strokeStyle = '#2ee6a6';
    ctxRef.lineWidth = 2.5;

    for (let i = 0; i < doc.entityCount(); i++) {
        const poly = doc.getPolyline(i);
        if (poly.size() < 2) continue;

        ctxRef.beginPath();
        const first = poly.get(0);
        ctxRef.moveTo(first.x, first.y);
        for (let j = 1; j < poly.size(); j++) {
            const node = poly.get(j);
            ctxRef.lineTo(node.x, node.y);
        }
        ctxRef.stroke();
    }
}

function drawOverlayOnCtx(ctxRef) {
    // Active polyline
    if (currentPolyline.length > 1) {
        ctxRef.strokeStyle = '#00f';
        ctxRef.beginPath();
        ctxRef.moveTo(currentPolyline[0].x, currentPolyline[0].y);
        for (let p of currentPolyline.slice(1)) ctxRef.lineTo(p.x, p.y);
        ctxRef.stroke();
    }

    // Selected nodes
    ctxRef.fillStyle = '#f00';
    selection.nodes.forEach(key => {
        const [p, n] = key.split(':').map(Number);
        const node = doc.getPolyline(p).get(n);
        ctxRef.beginPath();
        ctxRef.arc(node.x, node.y, 4, 0, Math.PI * 2);
        ctxRef.fill();
    });

    // Ghost snapping node
    if (ghostSnap && snapEnabled && snapToNodes) {
        ctxRef.fillStyle = '#0ff';
        ctxRef.beginPath();
        ctxRef.arc(ghostSnap.x, ghostSnap.y, 6, 0, Math.PI * 2);
        ctxRef.fill();
    }
}

// File operations (stubs for now)
ipcRenderer.on('file-new', () => {
    if (!ModuleRef) return;
    doc = new ModuleRef.Document();
    if (!doc.guides) doc.guides = [];
    clearSelection();
    cancelPolyline();
    drawAll();
});

ipcRenderer.on('open-pattern', (event, filePath) => {
    try {
        const text = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(text);

        // Reset doc
        doc = new ModuleRef.Document();
        if (!doc.guides) doc.guides = [];
        clearSelection();
        cancelPolyline();

        // Load entities
        json.entities.forEach(ent => {
            if (ent.type === 'polyline') {
                const id = doc.createPolyline();
                ent.nodes.forEach(n => doc.addNodeToPolyline(id, n.x, n.y));
            }
            else if (ent.type === 'rectangle') {
                const id = doc.createPolyline();
                const { start, end } = ent;

                doc.addNodeToPolyline(id, start.x, start.y);
                doc.addNodeToPolyline(id, end.x, start.y);
                doc.addNodeToPolyline(id, end.x, end.y);
                doc.addNodeToPolyline(id, start.x, end.y);
                doc.addNodeToPolyline(id, start.x, start.y);
            }
            else if (ent.type === 'circle') {
                const id = doc.createPolyline();
                const pts = generateCirclePoints(ent.center.x, ent.center.y, ent.radius, 32);
                pts.forEach(p => doc.addNodeToPolyline(id, p.x, p.y));
            }
        });
        saveState();
        drawAll();

        console.log('Opened:', filePath);

    } catch (err) {
        console.error('Failed to open pattern:', err);
        alert('Failed to open file.');
    }
});

ipcRenderer.on('save-pattern-as', (event, filePath) => {
    ipcRenderer.send('add-recent-file', filePath);
    try {
        const data = exportPattern();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log('Saved to', filePath);
    } catch (err) {
        console.error('Save failed:', err);
    }
});

// Document / grid setup
ipcRenderer.on('doc-setup', () => {
    console.log('Document setup stub');
});

ipcRenderer.on('grid-options', () => {
    console.log('Grid options stub');
});

// About dialog
ipcRenderer.on('about', () => {
    alert('CAD App v1.0 - Electron');
});

const prefsModal = document.getElementById('preferencesModal');
const darkToggle = document.getElementById('darkModeToggle');
const themeSelect = document.getElementById('themeSelect');

ipcRenderer.on('open-preferences', async () => {
    prefsModal.classList.remove('hidden');

    const settings = await ipcRenderer.invoke('get-settings');

    // Dark mode
    darkToggle.checked = settings.darkMode;

    // Units
    unitsSelect.value = settings.units;

    // Page
    pageType.value = settings.page.type;
    pageWidth.value = settings.page.width;
    pageHeight.value = settings.page.height;

    // Theme
    themeSelect.value = settings.theme;

    updateCustomVisibility();
});


unitsSelect.onchange = () => {
    ipcRenderer.send('set-setting', 'units', unitsSelect.value);
};

function updateCustomVisibility() {
    customSize.style.display = (pageType.value === 'custom') ? 'block' : 'none';
}

pageType.onchange = () => {
    updateCustomVisibility();

    let page = {};

    if (pageType.value === 'letter') {
        page = { type: 'letter', width: 8.5, height: 11 };
    } else if (pageType.value === 'a4') {
        page = { type: 'a4', width: 210, height: 297 };
    } else {
        page = {
            type: 'custom',
            width: parseFloat(pageWidth.value),
            height: parseFloat(pageHeight.value)
        };
    }

    ipcRenderer.send('set-setting', 'page', page);
};

pageWidth.onchange = pageHeight.onchange = () => {
    if (pageType.value === 'custom') {
        ipcRenderer.send('set-setting', 'page', {
            type: 'custom',
            width: parseFloat(pageWidth.value),
            height: parseFloat(pageHeight.value)
        });
    }
};

document.getElementById('closePrefs').onclick = () => {
    prefsModal.classList.add('hidden');
};

darkToggle.addEventListener('change', () => {
    ipcRenderer.send('set-setting', 'darkMode', darkToggle.checked);
});

themeSelect.addEventListener("change", (e) => {
    setTheme(e.target.value);
    ipcRenderer.send('set-setting', 'theme', e.target.value);
});

// ---------------------- UI -----------------------

document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
    };
});

let currentTool = 'line'; // default tool
const toolIcons = {
    line: '../assets/icons/line.svg',
    rectangle: '../assets/icons/rectangle.svg',
    circle: '../assets/icons/circle.svg',
    select: '../assets/icons/select.svg',
    node: '../assets/icons/node.svg'
};

const toolIndicator = document.getElementById('toolIndicator');

function updateToolIndicator() {
    if (!toolIndicator) return;
    const iconPath = toolIcons[currentTool];
    if (iconPath) {
        toolIndicator.innerHTML = `<img src="${iconPath}" alt="${currentTool}" style="width:24px;height:24px;">`;
    } else {
        toolIndicator.textContent = '?';
    }
}

// ---------------- Selection State ----------------
let selection = {
    nodes: new Set(),
    polylines: new Set()
};

let isBoxSelecting = false;
let boxStart = null;
let boxEnd = null;

let lastClickTime = 0;

// ---------------- Helpers ----------------
function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
}

function showToolingWorkspace() {
    document.getElementById("patternWorkspace").classList.add("hidden");
    document.getElementById("toolingWorkspace").classList.remove("hidden");
    resizeToolingCanvas();
}

function showPatternWorkspace() {
    document.getElementById("toolingWorkspace").classList.add("hidden");
    document.getElementById("patternWorkspace").classList.remove("hidden");
}

function updateGhostSnap(mousePos) {
    ghostSnap = null;
    if (snapEnabled && doc) {
        let closestNode = null;
        let minDist = snapRadius + 1;
        for (let i = 0; i < doc.entityCount(); i++) {
            const poly = doc.getPolyline(i);
            for (let j = 0; j < poly.size(); j++) {
                const node = poly.get(j);
                const dist = Math.hypot(node.x - mousePos.x, node.y - mousePos.y);
                if (dist <= snapRadius && dist < minDist) {
                    closestNode = node;
                    minDist = dist;
                }
            }
        }
        if (closestNode) ghostSnap = { x: closestNode.x, y: closestNode.y };
    }
}

function copySelection() {
    if (!doc) return;

    const data = [];

    selection.polylines.forEach(i => {
        const poly = doc.getPolyline(i);
        const nodes = [];

        for (let j = 0; j < poly.size(); j++) {
            const n = poly.get(j);
            nodes.push({ x: n.x, y: n.y });
        }

        data.push({ type: 'polyline', nodes });
    });

    clipboard = data;
}

function pasteSelection() {
    if (!clipboard || clipboard.length === 0 || !doc) return;

    saveState();
    clearSelection();

    const newNodes = [];

    clipboard.forEach(ent => {
        if (ent.type === 'polyline') {
            const id = doc.createPolyline();

            selection.polylines.add(id);

            ent.nodes.forEach((n, idx) => {
                doc.addNodeToPolyline(id, n.x, n.y);

                const key = `${id}:${idx}`;
                selection.nodes.add(key);   // ✅ ADD THIS

                newNodes.push({
                    polyIndex: id,
                    nodeIndex: idx,
                    startX: n.x,
                    startY: n.y
                });
            });
        }
    });

    // 🔥 Activate move mode immediately
    gNodes = newNodes;
    gMoveActive = true;

    // Use current mouse position as origin
    if (mousePos) {
        gOrigin = { ...mousePos };
    } else {
        gOrigin = { x: 0, y: 0 };
    }

    // Reset movement delta
    gMoveDelta = { dx: 0, dy: 0 };

    drawAll();
}

function updateDynamicLabel() {
    if (!currentContext) return;

    if (currentContext === 'node') {
        dynamicLabel.textContent = 'Radius';
    } else if (currentContext === 'hGuide') {
        dynamicLabel.textContent = 'Y Position';
    } else if (currentContext === 'vGuide') {
        dynamicLabel.textContent = 'X Position';
    } else if (currentContext === "Rotate") {
        dynamicLabel.textContent = 'Angle (°)';
    }
}

function getDynamicValue() {
    if (!activeObject) return '';
    if (currentContext === 'node') return activeObject.radius || 0;
    if (currentContext === 'hGuide') return activeObject.pos;
    if (currentContext === 'vGuide') return activeObject.pos;
}

function getGridSpacing(units) {
    switch (units) {
        case 'in': return PPU / 4;  // quarter inch
        case 'mm': return PPU;       // 1 mm per grid line
        case 'cm': return PPU / 10;  // 1 cm per grid line
        default: return PPU / 4;
    }
}

function applyDocumentSettings(settings) {
    const units = settings.units || 'in';
    PPU = getPPU(units);  // update global PPU

    // Convert page dimensions to inches for canvas size
    let widthInches = convertToInches(settings.page.width, units);
    let heightInches = convertToInches(settings.page.height, units);

    // Handle standard pages
    if (settings.page.type === 'letter') {
        widthInches = 8.5; heightInches = 11;
    } else if (settings.page.type === 'a4') {
        widthInches = 210 / 25.4;
        heightInches = 297 / 25.4;
    }

    canvas.width = widthInches * 96;
    canvas.height = heightInches * 96;

    resizeWindow();
    drawAll();
}

function getPPU(units) {
    switch (units) {
        case 'in': return 96;           // 96 px per inch
        case 'mm': return 96 / 25.4;    // 96 px per inch ÷ 25.4 mm per inch
        case 'cm': return 96 / 2.54;    // 96 px per inch ÷ 2.54 cm per inch
        default: return 96;
    }
}

function convertToInches(value, units) {
    if (typeof value !== 'number' || isNaN(value)) return 0;

    switch (units) {
        case 'in': return value;
        case 'mm': return value / 25.4;
        case 'cm': return value / 2.54;
        default: return value;
    }
}

async function applySettings() {
    const settings = await ipcRenderer.invoke('get-settings');

    document.body.classList.toggle('dark-mode', settings.darkMode);

    setTheme(settings.theme);

    applyDocumentSettings(settings);
}

async function loadRecentFiles() {
    const files = await ipcRenderer.invoke('get-recent-files');
    const list = document.getElementById('recentList');

    list.innerHTML = '';

    files.forEach(path => {
        const li = document.createElement('li');
        li.textContent = path;

        li.onclick = () => {
            ipcRenderer.send('open-pattern', path);
            closeSplash();
        };

        list.appendChild(li);
    });
}

function closeSplash() {
    document.getElementById('splashOverlay').style.display = 'none';
}

function getGuideIntersections() {
    const intersections = [];
    for (let i = 0; i < doc.guideCount(); i++) {
        const g1 = doc.getGuide(i);
        for (let j = i + 1; j < doc.guideCount(); j++) {
            const g2 = doc.getGuide(j);
            if (g1.vertical && !g2.vertical) {
                intersections.push({ x: g1.pos, y: g2.pos });
            } else if (!g1.vertical && g2.vertical) {
                intersections.push({ x: g2.pos, y: g1.pos });
            }
        }
    }
    return intersections;
}

function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect(); // canvas position in viewport
    return {
        x: (evt.clientX - rect.left),
        y: (evt.clientY - rect.top)
    };
}

function checkGuideSelect(mousePos) {
    selectedGuideIndex = null;
    guideDragActive = false;

    for (let i = 0; i < doc.guideCount(); i++) {
        const g = doc.getGuide(i);
        if (g.vertical && Math.abs(mousePos.x - g.pos) < guideSelectRadius) {
            selectedGuideIndex = i;
            guideDragActive = true;
            return true;
        }
        if (!g.vertical && Math.abs(mousePos.y - g.pos) < guideSelectRadius) {
            selectedGuideIndex = i;
            guideDragActive = true;
            return true;
        }
    }
    return false;
}

// Call this on mousemove
function updateGuideDrag(mousePos) {
    if (selectedGuideIndex === null) return;

    const g = doc.getGuide(selectedGuideIndex);

    if (g.vertical) {
        doc.moveGuide(selectedGuideIndex, mousePos.x);
        canvas.style.cursor = 'ew-resize';
    } else {
        doc.moveGuide(selectedGuideIndex, mousePos.y);
        canvas.style.cursor = 'ns-resize';
    }
}

function updateGuideHover(mousePos) {
    let hovering = false;
    if (!doc || doc.guideCount() === 0) return;
    for (let i = 0; i < doc.guideCount(); i++) {
        const g = doc.getGuide(i);
        if (g.vertical && Math.abs(mousePos.x - g.pos) < guideSelectRadius) {
            canvas.style.cursor = 'ew-resize';
            hovering = true;
            break;
        }
        if (!g.vertical && Math.abs(mousePos.y - g.pos) < guideSelectRadius) {
            canvas.style.cursor = 'ns-resize';
            hovering = true;
            break;
        }
    }

    if (!hovering) canvas.style.cursor = 'default';
}

function endGuideDrag() {
    guideDragActive = false;
    selectedGuideIndex = null;
}

function saveState() {
    if (!doc) return;

    const snapshot = JSON.stringify(exportPattern());

    undoStack.push(snapshot);

    if (undoStack.length > UNDO_LIMIT) {
        undoStack.shift(); // remove oldest
    }

    // once you do a new action, redo history is invalid
    redoStack = [];
}

function loadState(snapshot) {
    const json = JSON.parse(snapshot);

    doc = new ModuleRef.Document();
    if (!doc.guides) doc.guides = [];
    json.entities.forEach(ent => {
        if (ent.type === 'polyline') {
            const id = doc.createPolyline();
            ent.nodes.forEach(n => doc.addNodeToPolyline(id, n.x, n.y));
        }
    });

    drawAll();
}

function undo() {
    if (undoStack.length === 0) return;

    const current = JSON.stringify(exportPattern());
    redoStack.push(current);

    const prev = undoStack.pop();
    loadState(prev);
}

function redo() {
    if (redoStack.length === 0) return;

    const current = JSON.stringify(exportPattern());
    undoStack.push(current);

    const next = redoStack.pop();
    loadState(next);
}

function computeFillet(A, B, C, radius, segments = 8) {
    // Direction vectors (normalized)
    const BA = { x: A.x - B.x, y: A.y - B.y };
    const BC = { x: C.x - B.x, y: C.y - B.y };

    const lenBA = Math.hypot(BA.x, BA.y);
    const lenBC = Math.hypot(BC.x, BC.y);

    const uBA = { x: BA.x / lenBA, y: BA.y / lenBA };
    const uBC = { x: BC.x / lenBC, y: BC.y / lenBC };

    // Angle between vectors
    const dot = uBA.x * uBC.x + uBA.y * uBC.y;
    const angle = Math.acos(dot);

    // दूरी along edges
    const d = radius / Math.tan(angle / 2);

    // Tangent points
    const P1 = {
        x: B.x + uBA.x * d,
        y: B.y + uBA.y * d
    };

    const P2 = {
        x: B.x + uBC.x * d,
        y: B.y + uBC.y * d
    };

    // Angle bisector
    const bisector = {
        x: uBA.x + uBC.x,
        y: uBA.y + uBC.y
    };

    const bisLen = Math.hypot(bisector.x, bisector.y);
    const uBis = { x: bisector.x / bisLen, y: bisector.y / bisLen };

    // Distance from B to center
    const centerDist = radius / Math.sin(angle / 2);

    const center = {
        x: B.x + uBis.x * centerDist,
        y: B.y + uBis.y * centerDist
    };

    // Angles for arc
    const startAngle = Math.atan2(P1.y - center.y, P1.x - center.x);
    const endAngle = Math.atan2(P2.y - center.y, P2.x - center.x);

    // Determine direction (CW vs CCW)
    let delta = endAngle - startAngle;
    if (delta <= -Math.PI) delta += 2 * Math.PI;
    if (delta > Math.PI) delta -= 2 * Math.PI;

    // Generate arc points
    const points = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const theta = startAngle + t * delta;

        points.push({
            x: center.x + radius * Math.cos(theta),
            y: center.y + radius * Math.sin(theta)
        });
    }

    return points;
}

function exportPattern() {
    if (!doc) return {};

    const data = {
        docSetup: {
            units: 'inches',
            pageWidth: 8.5,
            pageHeight: 11,
            PPU: PPU
        },
        entities: [],
        guides: []
    };


    for (let i = 0; i < doc.entityCount(); i++) {
        const poly = doc.getPolyline(i);

        const nodes = [];
        for (let j = 0; j < poly.size(); j++) {
            const n = poly.get(j);
            nodes.push({ x: n.x, y: n.y });
        }

        data.entities.push({
            type: 'polyline',
            nodes
        });
    }

    for (let i = 0; i < doc.guideCount(); i++) {
        const g = doc.getGuide(i);
        data.guides.push({
            vertical: g.vertical,
            pos: g.pos
        });
    }

    return data;
}

function nodeKey(p, n) {
    return `${p}:${n}`;
}

// Ensure global GeometryInstance is used
function addPolylineFromPoints(points) {
    if (!doc || points.length < 2) return;

    const id = doc.createPolyline();
    for (let p of points) {
        doc.addNodeToPolyline(id, p.x, p.y);
    }
}

function snapPoint(x, y) {
    let minDist = snapRadius + 1;
    let closestNode = null;

    // Grid snapping
    if (snapEnabled && snapToGrid) {
        const gx = Math.round(x / spacing) * spacing;
        const gy = Math.round(y / spacing) * spacing;
        const gridDist = Math.hypot(gx - x, gy - y);
        if (gridDist <= snapRadius && gridDist < minDist) {
            closestNode = { x: gx, y: gy };
            minDist = gridDist;
        }
    }

    // Guide intersections snaPPUng
    if (snapEnabled && snapToGuides) {
        const intersections = getGuideIntersections();
        intersections.forEach(pt => {
            const dist = Math.hypot(pt.x - x, pt.y - y);
            if (dist < 2 * minDist && dist <= 2 * snapRadius) {
                closestNode = { x: pt.x, y: pt.y };
                minDist = dist;
            }
        });

        // Then snap to single guides if no intersection is closer
        for (let i = 0; i < doc.guideCount(); i++) {
            const g = doc.getGuide(i);
            if (g.vertical) {
                const dist = Math.abs(g.pos - x);
                if (dist < minDist && dist <= snapRadius) {
                    closestNode = { x: g.pos, y };
                    minDist = dist;
                }
            } else {
                const dist = Math.abs(g.pos - y);
                if (dist < minDist && dist <= snapRadius) {
                    closestNode = { x, y: g.pos };
                    minDist = dist;
                }
            }
        }
    }

    // Existing polylines
    if (snapEnabled && snapToNodes && doc) {
        for (let i = 0; i < doc.entityCount(); i++) {
            const poly = doc.getPolyline(i);
            for (let j = 0; j < poly.size(); j++) {
                const node = poly.get(j);
                const dist = Math.hypot(node.x - x, node.y - y);
                if (dist <= snapRadius && dist < minDist) {
                    closestNode = { x: node.x, y: node.y };
                    minDist = dist;
                }
            }
        }
    }

    // Self-snapping to the last node of current polyline
    if (snapEnabled && currentPolyline.length > 0) {
        const last = currentPolyline[currentPolyline.length - 1];
        const dist = Math.hypot(last.x - x, last.y - y);
        if (dist <= snapRadius && dist < minDist) {
            closestNode = { x: last.x, y: last.y };
            minDist = dist;
        }
    }

    if (closestNode) {
        ghostSnap = closestNode;
        return closestNode;
    } else {
        ghostSnap = null;
        return { x, y };
    }
}

// generate a circle as a polyline approximation
function generateCirclePoints(cx, cy, r, segments) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * 2 * Math.PI;
        pts.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
    }
    return pts;
}

function clearSelection() {
    if (!selection) return; // safety check
    if (!selection.nodes) selection.nodes = new Set();
    if (!selection.polylines) selection.polylines = new Set();

    selection.nodes.clear();
    selection.polylines.clear();
}

function selectAll() {
    if (!doc) return;

    if (!selection.nodes) selection.nodes = new Set();
    if (!selection.polylines) selection.polylines = new Set();

    selection.nodes.clear();
    selection.polylines.clear();

    for (let i = 0; i < doc.entityCount(); i++) {
        const poly = doc.getPolyline(i);
        selection.polylines.add(i);

        for (let j = 0; j < poly.size(); j++) {
            selection.nodes.add(`${i}:${j}`);
        }
    }
}

// ---------------- Grid ----------------
function drawGrid() {
    let majorEvery;

    if (unitsSelect.value === 'in') {
        minorStep = 0.25;   // 1/4 inch
        majorEvery = 4;     // 1 inch
    } else if (unitsSelect.value === 'mm') {
        minorStep = 1;      // 1 mm
        majorEvery = 10;    // 10 mm (1 cm)
    } else if (unitsSelect.value === 'cm') {
        minorStep = 0.1;    // 1 mm
        majorEvery = 10;    // 1 cm
    }

    const units = unitsSelect?.value || 'in'; // safe fallback
    spacing = getGridSpacing(units);

    const rootStyles = getComputedStyle(document.documentElement);

    for (let x = 0, i = 0; x <= canvas.width; x += spacing, i++) {
        ctx.lineWidth = (i % majorEvery === 0) ? 1 : 0.5;
        ctx.strokeStyle = (i % majorEvery === 0) ? rootStyles.getPropertyValue('--grid-dark') : rootStyles.getPropertyValue('--grid-light');

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    for (let y = 0, i = 0; y <= canvas.height; y += spacing, i++) {
        ctx.lineWidth = (i % majorEvery === 0) ? 1 : 0.5;
        ctx.strokeStyle = (i % majorEvery === 0) ? '#7e7e7e' : '#b6b6b6';

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}


// ---------------- Drawing ----------------
function drawGuides() {
    if (!doc) return;

    ctx.strokeStyle = '#2c18e0';
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 5]);

    for (let i = 0; i < doc.guideCount(); i++) {
        const g = doc.getGuide(i);

        ctx.beginPath();

        if (g.vertical) {
            ctx.moveTo(g.pos, 0);
            ctx.lineTo(g.pos, canvas.height);
        } else {
            ctx.moveTo(0, g.pos);
            ctx.lineTo(canvas.width, g.pos);
        }

        ctx.stroke();
    }

    ctx.setLineDash([]);
}

function drawEntities() {
    if (!doc) return;

    ctx.strokeStyle = '#2ee6a6';
    ctx.lineWidth = 2.5;

    const entityCount = doc.entityCount();

    for (let i = 0; i < entityCount; i++) {
        const poly = doc.getPolyline(i);
        const nodeCount = poly.size();
        if (nodeCount < 2) continue;

        ctx.beginPath();

        // Always grab fresh Node objects from C++
        const first = poly.get(0);
        ctx.moveTo(first.x, first.y);

        for (let j = 1; j < nodeCount; j++) {
            const node = poly.get(j);
            ctx.lineTo(node.x, node.y);
        }

        ctx.stroke();
    }
}

// ---------------- Overlay ----------------
function drawOverlay() {
    // active polyline
    if (currentPolyline.length > 1) {
        ctx.strokeStyle = '#00f';
        ctx.beginPath();
        ctx.moveTo(currentPolyline[0].x, currentPolyline[0].y);
        for (let p of currentPolyline.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
    }

    // ghost for polyline
    if (currentPolyline.length > 0 && mousePos) {
        const last = currentPolyline[currentPolyline.length - 1];
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y); // <-- move to last node
        let ghost = mousePos;
        if (snapEnabled) {
            ghost = snapPoint(mousePos.x, mousePos.y);
        }
        ctx.lineTo(ghost.x, ghost.y);
        ctx.stroke();
    }

    // ghost for rectangle / circle
    if (shapeStart && mousePos && (currentTool === 'rectangle' || currentTool === 'circle')) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2.5;
        if (currentTool === 'rectangle') {
            const w = mousePos.x - shapeStart.x;
            const h = mousePos.y - shapeStart.y;
            ctx.strokeRect(shapeStart.x, shapeStart.y, w, h);
        } else if (currentTool === 'circle') {
            const r = Math.hypot(mousePos.x - shapeStart.x, mousePos.y - shapeStart.y);
            ctx.beginPath();
            ctx.arc(shapeStart.x, shapeStart.y, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // box select
    if (isBoxSelecting && boxStart && boxEnd) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#888';
        const x = Math.min(boxStart.x, boxEnd.x);
        const y = Math.min(boxStart.y, boxEnd.y);
        const w = Math.abs(boxEnd.x - boxStart.x);
        const h = Math.abs(boxEnd.y - boxStart.y);

        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }

    // selected nodes
    ctx.fillStyle = '#f00';
    if (!selection || !selection.nodes) return;
    selection.nodes.forEach(key => {
        const [p, n] = key.split(':').map(Number);
        const node = doc.getPolyline(p).get(n);
        ctx.beginPath();
        ctx.arc(node.x, node.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw ghost snaPPUng node
    if (ghostSnap && snapEnabled && snapToNodes) {
        ctx.fillStyle = '#0ff';
        ctx.beginPath();
        ctx.arc(ghostSnap.x, ghostSnap.y, 6, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---------------- Move ghost ----------------
    if (gMoveActive && gNodes.length > 0) {
        ctx.strokeStyle = '#00f';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        gNodes.forEach(n => {
            const p = n.polyIndex;
            const i = n.nodeIndex;
            const poly = doc.getPolyline(p);

            // Current (moved)
            const currX = n.startX + gMoveDelta.dx;
            const currY = n.startY + gMoveDelta.dy;

            // -------- PREV --------
            let prevX = null;
            let prevY = null;

            if (i > 0) {
                const prevKey = `${p}:${i - 1}`;

                if (selection.nodes.has(prevKey)) {
                    // neighbor is ALSO moving → use moved position
                    const prevNode = gNodes.find(nn =>
                        nn.polyIndex === p && nn.nodeIndex === i - 1
                    );
                    prevX = prevNode.startX + gMoveDelta.dx;
                    prevY = prevNode.startY + gMoveDelta.dy;
                } else {
                    // normal case → use real position
                    const prev = poly.get(i - 1);
                    prevX = prev.x;
                    prevY = prev.y;
                }
            }

            // -------- NEXT --------
            let nextX = null;
            let nextY = null;

            if (i < poly.size() - 1) {
                const nextKey = `${p}:${i + 1}`;

                if (selection.nodes.has(nextKey)) {
                    const nextNode = gNodes.find(nn =>
                        nn.polyIndex === p && nn.nodeIndex === i + 1
                    );
                    nextX = nextNode.startX + gMoveDelta.dx;
                    nextY = nextNode.startY + gMoveDelta.dy;
                } else {
                    const next = poly.get(i + 1);
                    nextX = next.x;
                    nextY = next.y;
                }
            }

            // -------- DRAW --------
            ctx.beginPath();

            if (prevX !== null) {
                ctx.moveTo(prevX, prevY);
                ctx.lineTo(currX, currY);
            }

            if (nextX !== null) {
                ctx.moveTo(currX, currY);
                ctx.lineTo(nextX, nextY);
            }

            ctx.stroke();

            // ghost node
            ctx.fillStyle = '#00f';
            ctx.beginPath();
            ctx.arc(currX, currY, 5, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.setLineDash([]);
    }

    // Rotate ghost
    if (gRotateActive && gNodes.length > 0) {
        ctx.strokeStyle = '#00f';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        gNodes.forEach(n => {
            const p = n.polyIndex;
            const i = n.nodeIndex;
            const poly = doc.getPolyline(p);

            // Current (moved)
            const currX = (n.startX - gOrigin.x) * Math.cos(gRotateAngle) - (n.startY - gOrigin.y) * Math.sin(gRotateAngle) + gOrigin.x;
            const currY = (n.startX - gOrigin.x) * Math.sin(gRotateAngle) + (n.startY - gOrigin.y) * Math.cos(gRotateAngle) + gOrigin.y;

            // -------- PREV --------
            let prevX = null;
            let prevY = null;

            if (i > 0) {
                const prevKey = `${p}:${i - 1}`;

                if (selection.nodes.has(prevKey)) {
                    // neighbor is ALSO moving → use moved position
                    const prevNode = gNodes.find(nn =>
                        nn.polyIndex === p && nn.nodeIndex === i - 1
                    );
                    prevX = (prevNode.startX - gOrigin.x) * Math.cos(gRotateAngle) - (prevNode.startY - gOrigin.y) * Math.sin(gRotateAngle) + gOrigin.x;
                    prevY = (prevNode.startX - gOrigin.x) * Math.sin(gRotateAngle) + (prevNode.StartY - gOrigin.y) * Math.cos(gRotateAngle) + gOrigin.y;
                } else {
                    // normal case → use real position
                    const prev = poly.get(i - 1);
                    prevX = prev.x;
                    prevY = prev.y;
                }
            }

            // -------- NEXT --------
            let nextX = null;
            let nextY = null;

            if (i < poly.size() - 1) {
                const nextKey = `${p}:${i + 1}`;

                if (selection.nodes.has(nextKey)) {
                    const nextNode = gNodes.find(nn =>
                        nn.polyIndex === p && nn.nodeIndex === i + 1
                    );
                    nextX = (nextNode.startX - gOrigin.x) * Math.cos(gRotateAngle) - (nextNode.StartY - gOrigin.y) * Math.sin(gRotateAngle) + gOrigin.x;
                    nextY = (nextNode.startX - gOrigin.x) * Math.sin(gRotateAngle) + (nextNode.StartY - gOrigin.y) * Math.cos(gRotateAngle) + gOrigin.y;
                } else {
                    const next = poly.get(i + 1);
                    nextX = next.x;
                    nextY = next.y;
                }
            }

            // -------- DRAW --------
            ctx.beginPath();

            if (prevX !== null) {
                ctx.moveTo(prevX, prevY);
                ctx.lineTo(currX, currY);
            }

            if (nextX !== null) {
                ctx.moveTo(currX, currY);
                ctx.lineTo(nextX, nextY);
            }

            ctx.stroke();

            // ghost node
            ctx.fillStyle = '#00f';
            ctx.beginPath();
            ctx.arc(currX, currY, 5, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.setLineDash([]);
    }


    // Fillet preview
    if (activeNode && filletRadius > 0) {
        const { polyIndex, nodeIndex } = activeNode;
        const poly = doc.getPolyline(polyIndex);

        if (nodeIndex > 0 && nodeIndex < poly.size() - 1) {
            const prev = poly.get(nodeIndex - 1);
            const curr = poly.get(nodeIndex);
            const next = poly.get(nodeIndex + 1);

            const arcPoints = computeFillet(prev, curr, next, filletRadius, 16);
            ctx.strokeStyle = '#0ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(arcPoints[0].x, arcPoints[0].y);
            for (let p of arcPoints.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.stroke();
        }
    }
}

// ---------------- Coordinate Input ----------------
function addPointFromInput() {
    const xRaw = inputX.value.trim();
    const yRaw = inputY.value.trim();
    if (xRaw === '' || yRaw === '') finalizePolyline();

    const rawX = parseFloat(xRaw) * PPU;
    const rawY = parseFloat(yRaw) * PPU;

    const offsetX = shapeStart.x + rawX;
    const offsetY = shapeStart.y + rawY;

    let { x, y } = snapPoint(rawX, rawY);;
    if (shapeStart) {
        x = offsetX;
        y = offsetY;
    }

    if (currentTool === 'line') {
        if (currentPolyline.length === 0) startPolyline(x, y);
        else addPoint(x, y);
    } else if (currentTool === 'rectangle' || currentTool === 'circle') {
        if (!shapeStart) {
            shapeStart = { x, y };
            isDrawingShape = true;
        } else {
            saveState();
            finalizeShape(x, y);
        }
    }


    inputX.value = '';
    inputY.value = '';
    inputX.focus();
    drawAll();
}

// ---------------- Main Draw ----------------
function drawAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawGuides();
    drawEntities();
    drawOverlay();

    // Ghost rectangle / circle
    if (isDrawingShape && shapeStart && mousePos) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2.5;
        if (currentTool === 'rectangle') {
            const w = mousePos.x - shapeStart.x;
            const h = mousePos.y - shapeStart.y;
            ctx.strokeRect(shapeStart.x, shapeStart.y, w, h);
        }
        if (currentTool === 'circle') {
            const r = Math.hypot(mousePos.x - shapeStart.x, mousePos.y - shapeStart.y);
            ctx.beginPath();
            ctx.arc(shapeStart.x, shapeStart.y, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

// ---------------- Geometry ----------------
function startPolyline(x, y) {
    currentPolyline = [{ x, y }];
    showInput(x, y);
}

function addPoint(x, y) {
    currentPolyline.push({ x, y });
}

function finalizePolyline() {
    if (currentPolyline.length < 2) {
        cancelPolyline();
        return;
    }

    const id = doc.createPolyline();
    for (let p of currentPolyline) {
        doc.addNodeToPolyline(id, p.x, p.y);
    }
    cancelPolyline();
    saveState();
}

function finalizeShape(x2, y2) {
    if (!shapeStart) return;

    if (currentTool === 'rectangle') {
        const rectPoints = [
            { x: shapeStart.x, y: shapeStart.y },
            { x: x2, y: shapeStart.y },
            { x: x2, y: y2 },
            { x: shapeStart.x, y: y2 },
            { x: shapeStart.x, y: shapeStart.y }
        ];
        addPolylineFromPoints(rectPoints);
    } else if (currentTool === 'circle') {
        const r = Math.hypot(x2 - shapeStart.x, y2 - shapeStart.y);
        const circlePoints = generateCirclePoints(shapeStart.x, shapeStart.y, r, 32);
        addPolylineFromPoints(circlePoints);
    }

    shapeStart = null;
    isDrawingShape = false;
    drawAll();
}


function cancelPolyline() {
    currentPolyline = [];
    shapeStart = null;
    mousePos = null;
    coordContainer.style.display = 'none';
    inputX.value = '';
    inputY.value = '';
    ghostSnap = null;
}

// ---------------- Input ----------------
function showInput(x = null, y = null) {
    coordContainer.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = node.textContent.replace(/\([^)]+\)/g, `(${unitsSelect.value})`);
        }
    })
    coordContainer.style.display = 'block';
    inputX.focus();

    if (x !== null) {
        inputX.value = (x / PPU).toFixed(2);
        inputY.value = (y / PPU).toFixed(2);
    } else {
        inputX.value = '';
        inputY.value = '';
    }
}

// Show/hide dynamic input
function showDynamicInput(context, object) {
    currentContext = context;
    activeObject = object;
    visibleDynamicInput = true;
    updateDynamicLabel();
    if (dynamicInput.value === getDynamicValue() && currentContext != "Rotate") dynamicInput.value = (getDynamicValue() / PPU).toFixed(2);
    dynamicDiv.style.display = 'block';
    dynamicInput.focus();
}

// Hide dynamic input
function hideDynamicInput() {
    currentContext = null;
    activeObject = null;
    visibleDynamicInput = false;
    dynamicDiv.style.display = 'none';
}

// Press Enter to finalize
dynamicInput.addEventListener('keydown', (e) => {
    if (!activeObject) return;
    if (e.key === 'Enter') {

        const val = parseFloat(dynamicInput.value);
        if (isNaN(val)) return;

        if (currentContext === 'node') {
            activeObject.radius = val;
            const { polyIndex, nodeIndex } = activeNode;
            const poly = doc.getPolyline(polyIndex);

            // Safety check
            if (nodeIndex === 0 || nodeIndex === poly.size() - 1) {
                activeNode = null;
                filletRadius = 0;
                return;
            }

            const prev = poly.get(nodeIndex - 1);
            const curr = poly.get(nodeIndex);
            const next = poly.get(nodeIndex + 1);

            const arcPoints = computeFillet(prev, curr, next, activeObject.radius, 8);

            // Remove the original node
            doc.removeNodeFromPolyline(polyIndex, nodeIndex);

            // Insert arc points
            arcPoints.forEach((p, i) => {
                doc.insertNodeInPolyline(polyIndex, nodeIndex + i, p.x, p.y);
            });

            activeNode = null;
            filletRadius = 0;
            saveState();
            filletCancelled = true;
            drawAll();
        } else if (currentContext === 'hGuide' && guideDragActive) {
            // Update horizontal guide Y position
            doc.moveGuide(selectedGuideIndex, val)
            endGuideDrag();
            drawAll();
        } else if (currentContext === 'vGuide' && guideDragActive) {
            // Update vertical guide X position
            doc.moveGuide(selectedGuideIndex, val)
            endGuideDrag();
            drawAll();
        } else if (currentContext === 'Rotate' && gRotateActive) {
            gRotateAngle = val * Math.PI / 180;
            gNodes.forEach(n => {
                doc.moveNode(
                    n.polyIndex,
                    n.nodeIndex,
                    (n.startX - gOrigin.x) * Math.cos(gRotateAngle) - (n.startY - gOrigin.y) * Math.sin(gRotateAngle) + gOrigin.x,
                    (n.startX - gOrigin.x) * Math.sin(gRotateAngle) + (n.startY - gOrigin.y) * Math.cos(gRotateAngle) + gOrigin.y
                )
            });

            gRotateActive = false;
            gNodes = [];
            gRotateAngle = 0;
            ghostSnap = null;

            saveState();
            drawAll();
        }
        hideDynamicInput();
    }
});

// ---------------- Hit Detection ----------------
function findNodeAt(x, y, r = 8) {
    for (let i = 0; i < doc.entityCount(); i++) {
        const poly = doc.getPolyline(i);

        for (let j = 0; j < poly.size(); j++) {
            const n = poly.get(j);
            const dx = n.x - x;
            const dy = n.y - y;

            if (dx * dx + dy * dy < r * r) {
                return { polyIndex: i, nodeIndex: j };
            }
        }
    }
    return null;
}

// ---------------- Mouse ----------------
let isDrawingShape = false; // for drag
let shapeStart = null;      // first corner / center

canvas.addEventListener('mousedown', e => {
    const rawX = e.offsetX;
    const rawY = e.offsetY;
    const { x, y } = snapPoint(rawX, rawY);

    const now = Date.now();
    const dbl = now - lastClickTime < 250;
    lastClickTime = now;

    mousePos = getMousePos(e);

    if (checkGuideSelect(mousePos) && currentTool === 'select') {
        const guide = doc.getGuide(selectedGuideIndex);
        showDynamicInput(guide.vertical ? 'vGuide' : 'hGuide', guide);
        return
    };

    // ------ move mode -------
    if (gMoveActive && gNodes.length > 0) {

        gNodes.forEach(n => {
            doc.moveNode(
                n.polyIndex,
                n.nodeIndex,
                n.startX + gMoveDelta.dx,
                n.startY + gMoveDelta.dy
            );
        });

        gMoveActive = false;
        gNodes = [];
        gMoveDelta = { dx: 0, dy: 0 };
        ghostSnap = null;

        saveState();
        drawAll();
        return;
    }

    // rotate mode
    if (gRotateActive && gNodes.length > 0) {
        gNodes.forEach(n => {
            doc.moveNode(
                n.polyIndex,
                n.nodeIndex,
                (n.startX - gOrigin.x) * Math.cos(gRotateAngle) - (n.startY - gOrigin.y) * Math.sin(gRotateAngle) + gOrigin.x,
                (n.startX - gOrigin.x) * Math.sin(gRotateAngle) + (n.startY - gOrigin.y) * Math.cos(gRotateAngle) + gOrigin.y
            )
        });

        gRotateActive = false;
        gNodes = [];
        gRotateAngle = 0;
        ghostSnap = null;

        saveState();
        drawAll();
        return;
    }

    if (currentTool === 'node') {
        filletCancelled = false;
        const hit = findNodeAt(e.offsetX, e.offsetY); if (hit) {
            activeNode = hit; // { polyIndex, nodeIndex }
        } else { activeNode = null; }
    }

    // ----- Selection Mode -----
    if (currentTool === 'select') {
        const hit = findNodeAt(x, y);
        if (dbl && hit) {
            // double click selects entire polyline
            clearSelection();
            selection.polylines.add(hit.polyIndex);
        } else if (hit) {
            if (!multiSelect) clearSelection();
            selection.nodes.add(nodeKey(hit.polyIndex, hit.nodeIndex));
        } else {
            if (!multiSelect) clearSelection();
            // start box select
            isBoxSelecting = true;
            boxStart = { x, y };
            boxEnd = { x, y };
        }
        drawAll();
    }

    // ----- Line Tool -----
    if (currentTool === 'line') {
        if (currentPolyline.length === 0) startPolyline(x, y);
        else addPoint(x, y);
        drawAll();
    }

    // ----- Rectangle / Circle Tool -----
    if (currentTool === 'rectangle' || currentTool === 'circle') {
        if (!shapeStart) {
            shapeStart = { x, y }; // first click
        } else {
            saveState();
            finalizeShape(x, y);    // second click
        }
    }
});

window.addEventListener('mousemove', e => {
    mousePos = {
        x: e.clientX - canvas.getBoundingClientRect().left,
        y: e.clientY - canvas.getBoundingClientRect().top
    }
    if (isBoxSelecting && boxStart) {
        boxEnd = { ...mousePos };
        drawAll();
    }
});

window.addEventListener('mouseup', e => {
    // Complete box select
    if (isBoxSelecting) {
        const minX = Math.min(boxStart.x, boxEnd.x);
        const maxX = Math.max(boxStart.x, boxEnd.x);
        const minY = Math.min(boxStart.y, boxEnd.y);
        const maxY = Math.max(boxStart.y, boxEnd.y);

        for (let i = 0; i < doc.entityCount(); i++) {
            const poly = doc.getPolyline(i);
            for (let j = 0; j < poly.size(); j++) {
                const n = poly.get(j);
                if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) {
                    selection.nodes.add(`${i}:${j}`);
                }
            }
        }
        isBoxSelecting = false;
        drawAll();
    }
})

canvas.addEventListener('mousemove', e => {
    // Update current mouse position
    mousePos = { x: e.offsetX, y: e.offsetY };

    // update cursor
    updateGuideHover(mousePos);

    updateGhostSnap(mousePos);

    // move
    if (gMoveActive && gOrigin) {
        const snap = snapPoint(mousePos.x, mousePos.y);

        const dx = snap.x - gOrigin.x;
        const dy = snap.y - gOrigin.y;

        ghostSnap = snap;

        // store delta for rendering
        gMoveDelta = { dx, dy };
        drawAll();
        return;
    }

    // rotate
    if (gRotateActive && gOrigin) {
        const snap = snapPoint(mousePos.x, mousePos.y);
        gRotateAngle = Math.atan2(snap.y - gOrigin.y, snap.x - gOrigin.x);
    }

    // drag guide
    if (guideDragActive && selectedGuideIndex !== null) {
        updateGuideDrag(mousePos);
        dynamicInput.focus();
        drawAll();
    }

    // -------------- Node Tool ---------------
    if (activeNode && currentTool === 'node' && e.buttons === 1) {
        if (filletCancelled) return;
        const poly = doc.getPolyline(activeNode.polyIndex);
        const node = poly.get(activeNode.nodeIndex);
        filletRadius = Math.hypot(e.offsetX - node.x, e.offsetY - node.y);
        if (!visibleDynamicInput) showDynamicInput("node", node);
        dynamicInput.focus();
        drawAll();
    }

    drawAll();
});

canvas.addEventListener('mouseup', e => {
    const x = e.offsetX;
    const y = e.offsetY;

    endGuideDrag();

    // Complete drag-based rectangle/circle
    if (isDrawingShape && shapeStart) {
        saveState();
        finalizeShape(x, y);
    }

    // finish fillet
    if (activeNode && filletRadius > 0 && currentTool === 'node') {
        const { polyIndex, nodeIndex } = activeNode;
        const poly = doc.getPolyline(polyIndex);

        // Safety check
        if (nodeIndex === 0 || nodeIndex === poly.size() - 1) {
            activeNode = null;
            filletRadius = 0;
            return;
        }

        const prev = poly.get(nodeIndex - 1);
        const curr = poly.get(nodeIndex);
        const next = poly.get(nodeIndex + 1);

        const arcPoints = computeFillet(prev, curr, next, filletRadius, 8);

        // Remove the original node
        doc.removeNodeFromPolyline(polyIndex, nodeIndex);

        // Insert arc points
        arcPoints.forEach((p, i) => {
            doc.insertNodeInPolyline(polyIndex, nodeIndex + i, p.x, p.y);
        });

        activeNode = null;
        filletRadius = 0;
        saveState();
        drawAll();
    }
});


// ---------------- Keyboard ----------------
document.addEventListener('keydown', e => {
    if (e.key === 'Shift') {
        snapEnabled = true;
        multiSelect = true;
    }
});
document.addEventListener('keyup', e => {
    if (e.key === 'Shift') {
        snapEnabled = false;
        multiSelect = false;
    }

});

document.addEventListener('keydown', e => {
    const active = document.activeElement;
    const typing =
        active === inputX ||
        active === inputY ||
        active === dynamicInput ||
        active.closest('#coordinateInput') !== null ||
        active.closest('#dynamicNumberInput') !== null;

    if (currentWorkspace === 'tooling') return;

    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        copySelection();
        e.preventDefault();
        return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        pasteSelection();
        e.preventDefault();
        return;
    }

    // Horizontal guide
    if (!typing && e.key.toLowerCase() === 'h') {
        if (!mousePos) return;
        saveState();
        doc.addGuide(false, mousePos.y);
        drawAll();
    }

    // Vertical guide
    if (!typing && e.key.toLowerCase() === 'v') {
        if (!mousePos) return;
        saveState();
        doc.addGuide(true, mousePos.x);
        drawAll();
    }

    // undo / redo
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') {
        redo();
        e.preventDefault();
        return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        undo();
        e.preventDefault();
        return;
    }

    // ----- 'a' to select all -----
    if (!typing && e.key.toLowerCase() === 'a') {
        selectAll();
        drawAll();
        e.preventDefault();
        return;
    }

    // ------- 'g' to move ----------
    if (!typing && e.key.toLowerCase() === 'g') {
        if (!mousePos) return;

        let closest = null;
        let minDist = Infinity;

        // ---- PASS 1: find closest node ----
        selection.nodes.forEach(key => {
            const [p, n] = key.split(':').map(Number);
            const node = doc.getPolyline(p).get(n);

            const dx = node.x - mousePos.x;
            const dy = node.y - mousePos.y;
            const dist = dx * dx + dy * dy;

            if (dist < minDist) {
                minDist = dist;
                closest = node;
            }
        });

        if (!closest) return;

        const nodes = [];

        // ---- PASS 2: compute start positions ----
        selection.nodes.forEach(key => {
            const [p, n] = key.split(':').map(Number);
            const node = doc.getPolyline(p).get(n);

            nodes.push({
                polyIndex: p,
                nodeIndex: n,

                startX: node.x,
                startY: node.y
            });
        });

        gNodes = nodes;
        gMoveActive = true;

        gOrigin = mousePos;
    }

    if (e.key === 'x') gMoveDelta.dy = 0;
    if (e.key === 'y') gMoveDelta.dx = 0;

    // 'r' to rotate
    if (!typing && e.key.toLowerCase() === 'r') {
        if (!mousePos) return;
        const nodes = [];
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        let avgX = 0;
        let avgY = 0;

        selection.nodes.forEach(key => {
            const [p, n] = key.split(':').map(Number);
            const node = doc.getPolyline(p).get(n);

            nodes.push({
                polyIndex: p,
                nodeIndex: n,

                startX: node.x,
                startY: node.y
            });
            sumX += node.x;
            sumY += node.y;
            count++;
        });
        if (count === 0) return;
        gNodes = nodes;
        gRotateActive = true;

        avgX = sumX / count;
        avgY = sumY / count;

        gOrigin = { x: avgX, y: avgY };
        showDynamicInput("Rotate", selection);

    }


    // ----- Space for selection tool -----
    if (e.code === 'Space') {
        currentTool = 'select';
        updateToolIndicator();
        e.preventDefault(); // prevent page from scrolling
        return;
    }


    // ----- Clear canvas -----
    if (!typing && e.altKey && e.key.toLowerCase() === 'c') {
        doc = new ModuleRef.Document();
        if (!doc.guides) doc.guides = [];
        clearSelection();
        cancelPolyline();
        saveState();
        drawAll();
        return;
    }

    // ----- Delete selection -----
    if (!typing && ['Delete', 'Backspace'].includes(e.key)) {
        deleteSelection();
        saveState();
        drawAll();
        return;
    }

    // escape tools
    if (e.key === 'Escape') {

        // Cancel move
        if (gMoveActive) {
            gMoveActive = false;
            gNodes = [];
            gMoveDelta = { dx: 0, dy: 0 };
            gOrigin = null;
            ghostSnap = null;
            drawAll();
            return;
        }

        // Cancel rotate
        if (gRotateActive) {
            gRotateActive = false;
            gNodes = [];
            gRotateAngle = null;
            gOrigin = null;
            ghostSnap = null;
            drawAll();
            return;
        }

        // Cancel guide drag
        if (guideDragActive) {
            endGuideDrag();
            drawAll();
            return;
        }

        // Cancel node tool
        if (currentTool === 'Node') {
            filletCancelled = true;
            filletRadius = 0;
        }

        // Cancel box select
        if (isBoxSelecting) {
            isBoxSelecting = false;
            drawAll();
            return;
        }

        // Clear selection
        if (selection.nodes.size || selection.polylines.size) {
            clearSelection();
            drawAll();
            return;
        }

        // Cancel drawing
        cancelPolyline();
        drawAll();
        hideDynamicInput();
    }

    // ----- Finalize polyline -----
    if (!typing && e.key === 'Enter') {
        saveState();
        finalizePolyline();
        drawAll();
        return;
    }

    // ----- Tool hotkeys -----
    if (!typing) {
        switch (e.key.toLowerCase()) {
            case 'l': currentTool = 'line'; break;
            case 't': currentTool = 'rectangle'; break;
            case 'c': currentTool = 'circle'; break;
            case ' ': currentTool = 'select'; break;
            case 'n': currentTool = 'node'; break;
        }
        updateToolIndicator();
    }

    const isNumberKey =
        (e.key >= '0' && e.key <= '9') || e.key === '.' || e.key === '-';

    if (!typing && isNumberKey && visibleDynamicInput) {
        return;
    }

    if (!typing && coordContainer.style.display === 'none' && isNumberKey) {
        showInput();
        inputX.value = e.key;
        inputX.focus();
        e.preventDefault();
    }
});

// ---------------- Input fields ----------------
inputX.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        addPointFromInput();
        drawAll();
        e.stopPropagation();
        inputX.blur();
    } else if (e.key === 'Tab') {
        e.preventDefault();
        inputY.focus();
    }
});

inputY.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        addPointFromInput();
        drawAll();
        e.stopPropagation();
        inputY.blur();
    } else if (e.key === 'Tab') {
        e.preventDefault();
        inputX.focus();
    }
});


// ---------------- Buttons ---------------
const gridSnapButton = document.getElementById('gridSnap');
const nodesSnapButton = document.getElementById('nodesSnap');
const guideSnapButton = document.getElementById('guideSnap');
gridSnapButton.addEventListener("click", () => {
    snapToGuides = false;
    snapToGrid = true;
    snapToNodes = false;
    guideSnapButton.classList.remove('active');
    gridSnapButton.classList.add('active');
    nodesSnapButton.classList.remove('active');
});

nodesSnapButton.addEventListener("click", () => {
    snapToGuides = false;
    snapToNodes = true;
    snapToGrid = false;
    guideSnapButton.classList.remove('active');
    nodesSnapButton.classList.add('active');
    gridSnapButton.classList.remove('active');
});

guideSnapButton.addEventListener("click", () => {
    snapToGuides = true;
    snapToNodes = false;
    snapToGrid = false;
    guideSnapButton.classList.add('active');
    nodesSnapButton.classList.remove('active');
    gridSnapButton.classList.remove('active');
});

document.getElementById('newFileBtn').onclick = () => {
    ipcRenderer.send('file-new');
    closeSplash();
};

document.getElementById('openFileBtn').onclick = () => {
    ipcRenderer.invoke('open-pattern-dialog');
    closeSplash();
};

// ---------------- Delete ----------------
function deleteSelection() {
    if (!doc || !ModuleRef) return;

    const newDoc = new ModuleRef.Document();

    for (let i = 0; i < doc.entityCount(); i++) {
        const poly = doc.getPolyline(i);

        // Check which nodes are selected
        const nodesToKeep = [];
        for (let j = 0; j < poly.size(); j++) {
            const key = `${i}:${j}`;
            if (!selection.nodes.has(key)) {
                nodesToKeep.push(poly.get(j));
            }
        }

        // Only keep polyline if >=2 nodes remain
        if (nodesToKeep.length >= 2) {
            const id = newDoc.createPolyline();
            for (let n of nodesToKeep) {
                newDoc.addNodeToPolyline(id, n.x, n.y);
            }
        }
    }

    // Clear selection
    clearSelection();

    // Replace doc
    doc = newDoc;
    if (!doc.guides) doc.guides = [];

    drawAll();
}

// -------------- File Ops --------------
// Load a .pattern file
function loadPattern(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const json = JSON.parse(e.target.result);

            // Reset doc
            doc = new ModuleRef.Document();
            clearSelection();
            cancelPolyline();
            if (!doc.guides) doc.guides = [];

            // Load entities
            json.entities.forEach(ent => {
                if (ent.type === 'polyline') {
                    const id = doc.createPolyline();
                    ent.nodes.forEach(n => doc.addNodeToPolyline(id, n.x, n.y));
                } else if (ent.type === 'rectangle') {
                    const id = doc.createPolyline();
                    const { start, end } = ent;
                    doc.addNodeToPolyline(id, start.x, start.y);
                    doc.addNodeToPolyline(id, end.x, start.y);
                    doc.addNodeToPolyline(id, end.x, end.y);
                    doc.addNodeToPolyline(id, start.x, end.y);
                    doc.addNodeToPolyline(id, start.x, start.y);
                } else if (ent.type === 'circle') {
                    const id = doc.createPolyline();
                    const pts = generateCirclePoints(ent.center.x, ent.center.y, ent.radius, 32);
                    pts.forEach(p => doc.addNodeToPolyline(id, p.x, p.y));
                }
            });
            // Load guides
            if (json.guides) {
                json.guides.forEach(g => {
                    doc.addGuide(g.vertical, g.pos);
                });
            }

            drawAll();
        } catch (err) {
            console.error('Error loading pattern:', err);
            alert('Failed to load pattern file.');
        }
    };
    reader.readAsText(file);
}

// ---------------- TOOLING ----------------

function resizeToolingCanvas() {
    const canvas = document.getElementById("toolingCanvas");
    const rect = canvas.getBoundingClientRect();

    // Set actual pixel width & height
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;

    // Scale the context so drawing stays correct
    const ctx = canvas.getContext("2d");
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

// Call once on load
window.addEventListener("load", resizeToolingCanvas);
window.addEventListener("resize", resizeToolingCanvas);

let ToolingRef = null;
let ToolingReady = false;

ToolingModule().then((Module) => {
    ToolingRef = Module;
    ToolingReady = true;
});

// ---------------- POINTER EVENTS ----------------

toolingCanvas.addEventListener("pointerdown", (e) => {
    if (!ToolingReady) return;
    isDrawing = true;
    currentStroke = [{ x: e.offsetX, y: e.offsetY }];
});

toolingCanvas.addEventListener("pointermove", (e) => {
    if (!isDrawing) return;
    const point = { x: e.offsetX, y: e.offsetY };
    currentStroke.push(point);

    const prev = currentStroke[currentStroke.length - 2];
    toolingCtx.strokeStyle = "#ffd166";
    toolingCtx.lineWidth = 2;
    toolingCtx.beginPath();
    toolingCtx.moveTo(prev.x, prev.y);
    toolingCtx.lineTo(point.x, point.y);
    toolingCtx.stroke();
});

toolingCanvas.addEventListener("pointerup", () => {
    if (!isDrawing) return;
    isDrawing = false;
    if (!ToolingReady) return;
    if (currentStroke.length < 2) return;

    // Push stroke for undo
    pushStroke(currentStroke);

    // Prepare data for WASM
    let pts = new Float64Array(currentStroke.length * 2);
    currentStroke.forEach((p, i) => {
        pts[i * 2] = p.x;
        pts[i * 2 + 1] = p.y;
    });

    // Allocate memory
    let ptr = ToolingRef._malloc(pts.length * pts.BYTES_PER_ELEMENT);
    ToolingRef.HEAPF64.set(pts, ptr / 8);

    // Call WASM to process stroke into points/lines
    ToolingRef.ccall("process_stroke", "void", ["number", "number"], [ptr, pts.length]);

    // Clear current stroke after processing
    currentStroke = [];

    // Redraw from WASM lines
    redrawToolingCanvas();
});

// ---------------- CLEAR / SIMPLIFY ----------------

document.getElementById("clearCanvasBtn").addEventListener("click", () => {
    if (!ToolingReady) return;

    // Push current state to undo stack
    const buffer = ToolingRef.ccall("get_lines_buffer", "number");
    const lineCount = ToolingRef.ccall("get_line_count", "number");
    const linesCopy = new Float64Array(ToolingRef.HEAPF64.buffer, buffer, lineCount * 4);
    const snapshot = Array.from(linesCopy);
    toolingUndoStack.push({ type: "clear", lines: snapshot });
    toolingRedoStack.length = 0;

    ToolingRef.ccall("clear_scene");
    toolingCtx.clearRect(0, 0, toolingCanvas.width, toolingCanvas.height);
});

document.getElementById("enableSimplify").addEventListener("change", (e) => {
    simplify = e.target.checked;
});

// ---------------- DRAWING ----------------

function redrawToolingCanvas() {
    if (!ToolingReady) return;

    toolingCtx.clearRect(0, 0, toolingCanvas.width, toolingCanvas.height);

    const lineCount = ToolingRef.ccall("get_line_count", "number");
    if (lineCount === 0) return;

    const ptr = ToolingRef.ccall("get_lines_buffer", "number");
    const lines = new Float64Array(ToolingRef.HEAPF64.buffer, ptr, lineCount * 4);

    toolingCtx.strokeStyle = "#06d6a0";
    toolingCtx.lineWidth = 2;

    for (let i = 0; i < lineCount; i++) {
        toolingCtx.beginPath();
        toolingCtx.moveTo(lines[i * 4 + 0], lines[i * 4 + 1]);
        toolingCtx.lineTo(lines[i * 4 + 2], lines[i * 4 + 3]);
        toolingCtx.stroke();
    }

    // Optional: free buffer in C++
    ToolingRef.ccall("free_lines_buffer");
}

// ---------------- Print ----------------
document.getElementById("toolingPrint").addEventListener("click", () => {
    if (!ToolingReady) return;

    const lineCount = ToolingRef.ccall("get_line_count", "number");
    if (lineCount === 0) return;

    // Get lines from WASM
    const bufferPtr = ToolingRef.ccall("get_lines_buffer", "number");
    const lines = new Float64Array(ToolingRef.HEAPF64.buffer, bufferPtr, lineCount * 4);

    // Compute bounding rectangle
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < lineCount; i++) {
        const x1 = lines[i * 4], y1 = lines[i * 4 + 1];
        const x2 = lines[i * 4 + 2], y2 = lines[i * 4 + 3];
        minX = Math.min(minX, x1, x2);
        minY = Math.min(minY, y1, y2);
        maxX = Math.max(maxX, x1, x2);
        maxY = Math.max(maxY, y1, y2);
    }
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    // Page size in pixels (assuming 96dpi)
    const pageSizes = {
        Letter: { width: 816, height: 1056 }, // 8.5"x11" * 96dpi
        A4: { width: 794, height: 1123 }      // 210mm x 297mm ~ 96dpi
    };
    const pageType = "Letter"; // or read from user selection
    const page = pageSizes[pageType];

    // Determine scale based on major/minor dimension input
    const dimInput = document.getElementById("dimInput");
    const dimUnit = document.getElementById("dimUnit"); // e.g., "px", "mm", "in"
    let scale = 1;
    if (dimInput && dimUnit) {
        const value = parseFloat(dimInput.value);
        if (!isNaN(value)) {
            if (dimUnit.value === "width") {
                scale = value / contentWidth;
            } else {
                scale = value / contentHeight;
            }
        }
    }

    // Create offscreen canvas for printing
    const printCanvas = document.createElement("canvas");
    printCanvas.width = page.width;
    printCanvas.height = page.height;
    const ctx = printCanvas.getContext("2d");

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, printCanvas.width, printCanvas.height);

    // Center content
    const offsetX = (page.width - contentWidth * scale) / 2 - minX * scale;
    const offsetY = (page.height - contentHeight * scale) / 2 - minY * scale;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    for (let i = 0; i < lineCount; i++) {
        const x1 = lines[i * 4] * scale + offsetX;
        const y1 = lines[i * 4 + 1] * scale + offsetY;
        const x2 = lines[i * 4 + 2] * scale + offsetX;
        const y2 = lines[i * 4 + 3] * scale + offsetY;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // Open new window and append canvas as image
    const dataUrl = printCanvas.toDataURL();
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const img = printWindow.document.createElement("img");
    img.src = dataUrl;
    img.style.width = "100%";
    img.style.height = "auto";
    printWindow.document.body.style.margin = "0";
    printWindow.document.body.appendChild(img);

    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 100);
});

// ---------------- UNDO / REDO ----------------

let toolingUndoStack = [];
let toolingRedoStack = [];

function pushStroke(stroke) {
    toolingUndoStack.push(stroke);
    toolingRedoStack.length = 0; // clear redo on new action

    // Add to WASM
    addStrokeToWASM(stroke);
}

function addStrokeToWASM(stroke) {
    if (!ToolingReady) return;
    let pts = new Float64Array(stroke.length * 2);
    stroke.forEach((p, i) => {
        pts[i * 2] = p.x;
        pts[i * 2 + 1] = p.y;
    });

    let ptr = ToolingRef._malloc(pts.length * pts.BYTES_PER_ELEMENT);
    ToolingRef.HEAPF64.set(pts, ptr / 8);
    ToolingRef.ccall("process_stroke", "void", ["number", "number"], [ptr, pts.length]);
    // no _free needed
}

function toolingUndo() {
    if (!toolingUndoStack.length) return;
    const stroke = toolingUndoStack.pop();
    toolingRedoStack.push(stroke);

    if (stroke.type === "clear") {
        // restore previous lines in WASM
        ToolingRef.ccall("clear_scene");
        const linesArray = stroke.lines;
        for (let i = 0; i < linesArray.length; i += 4) {
            const p1 = ToolingRef.ccall("create_point", "number", ["number", "number"], [linesArray[i], linesArray[i + 1]]);
            const p2 = ToolingRef.ccall("create_point", "number", ["number", "number"], [linesArray[i + 2], linesArray[i + 3]]);
            ToolingRef.ccall("create_line", "number", ["number", "number"], [p1, p2]);
        }
    }

    redrawToolingCanvas();
}

function toolingRedo() {
    if (!toolingRedoStack.length) return;
    const stroke = toolingRedoStack.pop();
    toolingUndoStack.push(stroke);

    // Clear WASM scene
    ToolingRef.ccall("clear_scene");

    // Re-add all strokes
    toolingUndoStack.forEach(addStrokeToWASM);
    redrawToolingCanvas();
}

// ---------------- Init ----------------
GeometryModule().then(async Module => {
    ModuleRef = Module;
    doc = new ModuleRef.Document();
    if (!doc.guides) doc.guides = [];

    await applySettings();
    drawAll();
});

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('splashOverlay').style.display = 'flex';
    loadRecentFiles();
});

updateToolIndicator();