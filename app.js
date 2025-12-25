import { collection, addDoc } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

  (function () {
  'use strict';

  // DOM refs
  const svg = document.getElementById('svgCanvas');
  const trackGroup = document.getElementById('trackGroup');
  const rulerGroup = document.getElementById('rulerGroup');
  const compsGroup = document.getElementById('componentsGroup');
  const notesGroup = document.getElementById('notesGroup');
  const itemsList = document.getElementById('itemsList');

  const totalFeetInput = document.getElementById('totalFeet');
  const applyTotalBtn = document.getElementById('applyTotal');

  const diffLenInput = document.getElementById('diffLen');
  const addDiffBtn = document.getElementById('addDiff');

  const addSpotBtn = document.getElementById('addSpot');

  const addLeniaBtn = document.getElementById('addLenia');
  const leniaHeadsSel = document.getElementById('leniaHeads');

  const addNoteBtn = document.getElementById('addNote');
  const noteTextInput = document.getElementById('noteText');

  const exportPngBtn = document.getElementById('exportPng');

  const profileTypeSel = document.getElementById('profileType');
const bendOptions = document.getElementById('bendOptions');
const lshapeOptions = document.getElementById('lshapeOptions');
const bendPointInput = document.getElementById('bendPoint');
const bendAngleInput = document.getElementById('bendAngle');
const legAInput = document.getElementById('legA');
const legBInput = document.getElementById('legB');

profileTypeSel.onchange = () => {
  profileMode = profileTypeSel.value;
  bendOptions.style.display = profileMode === 'bend' ? 'block' : 'none';
  lshapeOptions.style.display = profileMode === 'lshape' ? 'block' : 'none';
};

  // Layout & state
  
  let totalFeet = parseFloat(totalFeetInput.value) || 9;
  let profileMode = 'straight';
  let bendPointFt = 5;
  let bendAngleDeg = 45;
  let legAFt = 5;
  let legBFt = 4;
  const viewW = 1200;
  const viewH = 240;
  const leftPad = 60;
  const rightPad = 60;
  const trackY = 120;
  const trackH = 48;
  let components = []; // {id,type,leftFt,lengthFt,spotInches,heads,spacingIn}
  let dragState = null;
  let notes = [];      // {id,text,leftFt,offsetY,attachTo?}
  let dims = [];       // {id,x1,y1,x2,y2,label,orient}

  const uid = (p = 'c') => p + Math.random().toString(36).slice(2, 8);

  function createSvgPath(d) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', '#000');
  p.setAttribute('stroke-width', trackH);
  p.setAttribute('stroke-linecap', 'butt');
  p.setAttribute('stroke-linejoin', 'miter');
  p.setAttribute('stroke-miterlimit', '10');
  return p;
}
let trackPathEl = null;    // SVG path of the profile
let trackPathLenPx = 0;   // cached total length of the path

  function pxPerFt() {
    return (viewW - leftPad - rightPad) / totalFeet;
  }

  function feetInches(decimalFeet) {
    const df = Math.max(0, Number(decimalFeet) || 0);
    let ft = Math.floor(df);
    let inches = Math.round((df - ft) * 12);
    if (inches === 12) { ft++; inches = 0; }
    return `${ft}' ${inches}"`;
  }

  // ---------- SVG coordinate helpers ----------
 
  function clientToSvgPoint(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const inv = ctm.inverse();
    const sp = pt.matrixTransform(inv);
    return { x: sp.x, y: sp.y };
  }

  function clampToSvgBounds(pt) {
  let maxY = viewH;

  if (profileMode === 'lshape') {
    const ppf = pxPerFt();
    maxY = trackY + legBFt * ppf + trackH / 2 + 20;
  }

  return {
    x: Math.max(0, Math.min(viewW, pt.x)),
    y: Math.max(0, Math.min(maxY, pt.y))
  };
}

function getClosestPathLength(x, y) {
  if (!trackPathEl) return 0;

  let best = 0;
  let bestD = Infinity;
  const samples = 160;

  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * trackPathLenPx;
    const p = trackPathEl.getPointAtLength(t);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
function getTrackBottomY() {
  if (profileMode !== 'lshape') return viewH;

  const ppf = pxPerFt();
  return trackY + legBFt * ppf + trackH / 2;
}

  // ---------- dimension logic ----------
  let dimMode = false;
  let dimTemp = null; // {x1,y1}

  // create small UI block in left panel
  (function createDimButtonUI() {
    try {
      const panel = document.querySelector('.panel');
      if (!panel) return;
      const block = document.createElement('div');
      block.className = 'panel-block';
      block.innerHTML = `
        <label class="label">Dimensions</label>
        <div class="row">
          <button id="addDimBtn" class="btn ghost">Add Dimension</button>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">Click SVG to place start and end. Double-click text to edit. Use × to delete.</div>
      `;
      panel.appendChild(block);

      const btn = block.querySelector('#addDimBtn');
      btn.addEventListener('click', () => {
        dimMode = !dimMode;
        btn.textContent = dimMode ? 'Cancel Dimension' : 'Add Dimension';
        if (!dimMode) {
          dimTemp = null;
          const t = svg.querySelector('#dimTempGroup'); if (t) t.remove();
        }
      });
    } catch (e) { /* ignore */ }
  })();

  function renderDimensionLines() {
    const old = svg.querySelector('#dimensionsGroup');
    if (old) old.remove();

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'dimensionsGroup';

    dims.forEach(d => {

  if (d.type === 'arc') {
    renderArcDimension(d, g);
    return;
  }

      const dg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      dg.classList.add('dim-item');
      dg.dataset.id = d.id;

      // main straight line
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', d.x1); ln.setAttribute('y1', d.y1);
      ln.setAttribute('x2', d.x2); ln.setAttribute('y2', d.y2);
      ln.setAttribute('stroke', '#111'); ln.setAttribute('stroke-width', 0.9);
      ln.setAttribute('pointer-events', 'none');
      dg.appendChild(ln);

      // ticks
      const drawTick = (xA, yA, xB, yB) => {
        const dx = xB - xA, dy = yB - yA;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return null;
        const ux = dx / len, uy = dy / len;
        const px = -uy, py = ux;
        const half = 6;
        const tx1 = xA + px * half, ty1 = yA + py * half;
        const tx2 = xA - px * half, ty2 = yA - py * half;
        const tline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tline.setAttribute('x1', tx1); tline.setAttribute('y1', ty1);
        tline.setAttribute('x2', tx2); tline.setAttribute('y2', ty2);
        tline.setAttribute('stroke', '#000'); tline.setAttribute('stroke-width', 0.8);
        tline.setAttribute('pointer-events', 'none');
        return tline;
      };

      const t1 = drawTick(d.x1, d.y1, d.x2, d.y2);
      const t2 = drawTick(d.x2, d.y2, d.x1, d.y1);
      if (t1) dg.appendChild(t1);
      if (t2) dg.appendChild(t2);

      // label: increased offset
      const mx = (d.x1 + d.x2) / 2;
      const my = (d.y1 + d.y2) / 2;
      const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const px = -uy, py = ux;
      const offset = 22; // increased offset
      const tx = mx + px * offset;
      const ty = my + py * offset;

      const T = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      T.setAttribute('x', tx); T.setAttribute('y', ty);
      T.setAttribute('font-size', '14'); T.setAttribute('fill', '#000');
      T.setAttribute('text-anchor', 'middle'); T.setAttribute('font-weight', '600');
      T.setAttribute('class', 'dim-text');
      T.textContent = d.label || '';
      T.style.cursor = 'text';
      T.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const v = prompt('Edit dimension text', d.label || '');
        if (v !== null) {
          d.label = v;
          renderAll();
        }
      });
      dg.appendChild(T);

      // delete button (editor-only)
      const delOffset = 2;
      const dx2 = mx + px * (offset + delOffset);
      const dy2 = my + py * (offset + delOffset);

      const delBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      delBtn.setAttribute('class', 'dim-delete-btn'); // hidden in export clone
      delBtn.setAttribute('transform', `translate(${dx2}, ${dy2})`);
      delBtn.style.cursor = 'pointer';

      const delCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      delCircle.setAttribute('r', 9);
      delCircle.setAttribute('fill', '#fff');
      delCircle.setAttribute('stroke', '#d33');
      delCircle.setAttribute('stroke-width', 0.9);
      delBtn.appendChild(delCircle);
      const delX = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      delX.setAttribute('x', 0); delX.setAttribute('y', 4);
      delX.setAttribute('font-size', 12);
      delX.setAttribute('text-anchor', 'middle');
      delX.setAttribute('fill', '#d33');
      delX.textContent = '×';
      delBtn.appendChild(delX);

      delBtn.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        dims = dims.filter(item => item.id !== d.id);
        renderAll();
      });

      dg.appendChild(delBtn);

      // end handles (draggable). two small circles at ends
      const handleA = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      handleA.setAttribute('cx', d.x1); handleA.setAttribute('cy', d.y1);
      handleA.setAttribute('r', 6); handleA.setAttribute('fill', '#fff');
      handleA.setAttribute('stroke', '#111'); handleA.setAttribute('stroke-width', 0.9);
      handleA.setAttribute('class', 'dim-handle');
      handleA.style.cursor = d.orient === 'h' ? 'ew-resize' : 'ns-resize';
      dg.appendChild(handleA);

      const handleB = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      handleB.setAttribute('cx', d.x2); handleB.setAttribute('cy', d.y2);
      handleB.setAttribute('r', 6); handleB.setAttribute('fill', '#fff');
      handleB.setAttribute('stroke', '#111'); handleB.setAttribute('stroke-width', 0.9);
      handleB.setAttribute('class', 'dim-handle');
      handleB.style.cursor = d.orient === 'h' ? 'ew-resize' : 'ns-resize';
      dg.appendChild(handleB);

      // handle dragging
      makeHandleDraggable(handleA, d, 'a');
      makeHandleDraggable(handleB, d, 'b');

      // group dragging (parallel to orientation)
      makeDimDraggable(dg, d);

      g.appendChild(dg);
    });

    svg.appendChild(g);
  }
function renderArcDimension(d, parentGroup) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.classList.add('dim-item');
    g.dataset.id = d.id;
  const TICK = 8;

  /* ---------- ARC PATH ---------- */
  const steps = 64;
  let pathD = '';

  for (let i = 0; i <= steps; i++) {
    const t = d.startLen + (i / steps) * (d.endLen - d.startLen);
    const p = trackPathEl.getPointAtLength(t);

    const delta = 1;
    const p1 = trackPathEl.getPointAtLength(Math.max(0, t - delta));
    const p2 = trackPathEl.getPointAtLength(Math.min(trackPathLenPx, t + delta));

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;

    const nx = -dy / len;
    const ny = dx / len;

    const x = p.x + nx * d.offset;
    const y = p.y + ny * d.offset;

    pathD += (i === 0 ? 'M ' : ' L ') + x + ' ' + y;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#000');
  path.setAttribute('stroke-width', 1.2);
  path.setAttribute('pointer-events', 'none');
  g.appendChild(path);

  /* ---------- END TICKS ---------- */
  function drawTickAt(lenOnPath) {
    const p = trackPathEl.getPointAtLength(lenOnPath);

    const delta = 1;
    const p1 = trackPathEl.getPointAtLength(Math.max(0, lenOnPath - delta));
    const p2 = trackPathEl.getPointAtLength(Math.min(trackPathLenPx, lenOnPath + delta));

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const mag = Math.hypot(dx, dy) || 1;

    const tx = dx / mag;
    const ty = dy / mag;

    // normal (same direction as arc offset)
    const nx = -ty;
    const ny = tx;

    const cx = p.x + nx * d.offset;
    const cy = p.y + ny * d.offset;

// draw tick PERPENDICULAR to arc (along normal)
const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
tick.setAttribute('x1', cx - nx * TICK);
tick.setAttribute('y1', cy - ny * TICK);
tick.setAttribute('x2', cx + nx * TICK);
tick.setAttribute('y2', cy + ny * TICK);
tick.setAttribute('stroke', '#000');
tick.setAttribute('stroke-width', 1.1);
tick.setAttribute('pointer-events', 'none');


    g.appendChild(tick);
  }

  drawTickAt(d.startLen);
  drawTickAt(d.endLen);

  /* ---------- LABEL ---------- */
  const mid = (d.startLen + d.endLen) / 2;
  const mp = trackPathEl.getPointAtLength(mid);

  const delta = 1;
  const p1 = trackPathEl.getPointAtLength(Math.max(0, mid - delta));
  const p2 = trackPathEl.getPointAtLength(Math.min(trackPathLenPx, mid + delta));

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;

  const nx = -dy / len;
  const ny = dx / len;

  const TEXT_GAP = 26;

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('pointer-events', 'none');
  text.setAttribute('x', mp.x + nx * (d.offset + TEXT_GAP));
  text.setAttribute('y', mp.y + ny * (d.offset + TEXT_GAP));
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', 14);
  text.setAttribute('font-weight', 600);
  text.textContent = d.label || '';

  g.appendChild(text);

/* ---------- DELETE BUTTON ---------- */
const DEL_GAP = 30;

const delX = mp.x + nx * (d.offset + TEXT_GAP + DEL_GAP);
const delY = mp.y + ny * (d.offset + TEXT_GAP + DEL_GAP);

const delBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
delBtn.setAttribute('class', 'dim-delete-btn');
delBtn.setAttribute('transform', `translate(${delX}, ${delY})`);
delBtn.style.cursor = 'pointer';
delBtn.setAttribute('pointer-events', 'all');

const delCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
delCircle.setAttribute('r', 9);
delCircle.setAttribute('fill', '#fff');
delCircle.setAttribute('stroke', '#d33');
delCircle.setAttribute('stroke-width', 0.9);
delCircle.setAttribute('pointer-events', 'all');

const delXtxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
delXtxt.setAttribute('x', 0);
delXtxt.setAttribute('y', 4);
delXtxt.setAttribute('text-anchor', 'middle');
delXtxt.setAttribute('font-size', 12);
delXtxt.setAttribute('fill', '#d33');
delXtxt.textContent = '×';
delXtxt.setAttribute('pointer-events', 'all');

delBtn.appendChild(delCircle);
delBtn.appendChild(delXtxt);

delBtn.addEventListener('pointerdown', (ev) => {
  ev.stopPropagation();
  dims = dims.filter(item => item.id !== d.id);
  renderAll();
});

g.appendChild(delBtn);
const oldArc = svg.querySelector(`.dim-item[data-id="${d.id}"]`);
if (oldArc) oldArc.remove();

parentGroup.appendChild(g);
}


  function makeHandleDraggable(handleElem, dimObj, whichEnd) {
    let dragging = false;
    let startPt = null;

    handleElem.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      dragging = true;
      startPt = clientToSvgPoint(e.clientX, e.clientY);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    function onMove(e) {
      if (!dragging) return;
      const pt = clientToSvgPoint(e.clientX, e.clientY);
      if (dimObj.orient === 'h') {
        // change x for the selected end, keep y constant (snap to same y)
        const newX = Math.max(0, Math.min(viewW, pt.x));
        if (whichEnd === 'a') {
          // ensure it doesn't cross the other end (keep at least 2px gap)
          if (newX <= dimObj.x2 - 2) dimObj.x1 = newX;
        } else {
          if (newX >= dimObj.x1 + 2) dimObj.x2 = newX;
        }
      } else if (dimObj.orient === 'v') {
        const maxY = getTrackBottomY();
const newY = Math.max(0, Math.min(maxY, pt.y));

        if (whichEnd === 'a') {
          if (newY <= dimObj.y2 - 2) dimObj.y1 = newY;
        } else {
          if (newY >= dimObj.y1 + 2) dimObj.y2 = newY;
        }
      }
      renderAll();
    }

    function onUp() {
      dragging = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
  }

  function makeDimDraggable(g, dimObj) {
    let dragging = false, sx = 0, sy = 0;
    g.style.cursor = 'move';
    g.addEventListener('pointerdown', (e) => {
      // avoid interfering with handles/delete/text interactions
      if (e.target.closest && (e.target.closest('.dim-delete-btn') || e.target.classList.contains('dim-handle'))) return;
      if (e.target.classList && e.target.classList.contains('dim-text')) return;
      e.stopPropagation();
      dragging = true;
      const sp = clientToSvgPoint(e.clientX, e.clientY);
      sx = sp.x; sy = sp.y;
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });

    function move(e) {
      if (!dragging) return;
      const pt = clientToSvgPoint(e.clientX, e.clientY);
      const dx = pt.x - sx, dy = pt.y - sy;

      if (dimObj.orient === 'h') {
        dimObj.x1 = Math.max(0, Math.min(viewW, dimObj.x1 + dx));
        dimObj.x2 = Math.max(0, Math.min(viewW, dimObj.x2 + dx));
      } else if (dimObj.orient === 'v') {
        dimObj.y1 = Math.max(0, Math.min(viewH, dimObj.y1 + dy));
        dimObj.y2 = Math.max(0, Math.min(viewH, dimObj.y2 + dy));
      } else {
        dimObj.x1 = Math.max(0, Math.min(viewW, dimObj.x1 + dx));
        dimObj.y1 = Math.max(0, Math.min(viewH, dimObj.y1 + dy));
        dimObj.x2 = Math.max(0, Math.min(viewW, dimObj.x2 + dx));
        dimObj.y2 = Math.max(0, Math.min(viewH, dimObj.y2 + dy));
      }

      sx = pt.x; sy = pt.y;
      renderAll();
    }

    function up() {
      dragging = false;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    }
  }

function renderDimensionLine() {
  const old = svg.querySelector('#dimensionGroup');
  if (old) old.remove();
  if (!trackPathEl) return;

  const dimG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  dimG.id = 'dimensionGroup';

  const CLEAR = trackH / 2 + 20;
  const LABEL_GAP = 16;
  const TICK = 7;

  const add = el => dimG.appendChild(el);

  function tick(x, y, nx, ny) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x - nx * TICK);
    l.setAttribute('y1', y - ny * TICK);
    l.setAttribute('x2', x + nx * TICK);
    l.setAttribute('y2', y + ny * TICK);
    l.setAttribute('stroke', '#000');
    l.setAttribute('stroke-width', 1.1);
    add(l);
  }

  function label(x, y, text, anchor = 'middle') {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('font-size', 14);
    t.setAttribute('font-weight', 600);
    t.textContent = text;
    add(t);
  }

  /* =========================
     STRAIGHT PROFILE
  ========================= */
  if (profileMode === 'straight') {
    const p1 = trackPathEl.getPointAtLength(0);
    const p2 = trackPathEl.getPointAtLength(trackPathLenPx);
    const y = p1.y - CLEAR;

    const x1 = p1.x + TICK;
    const x2 = p2.x - TICK;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#000');
    line.setAttribute('stroke-width', 1.2);
    add(line);

    tick(p1.x + trackH / 6.9, y, 0, 1);
    tick(p2.x - trackH / 6.9, y, 0, 1);
    label((x1 + x2) / 2, y - LABEL_GAP, feetInches(totalFeet));
  }

  /* =========================
     BENDABLE PROFILE (TRUE ARC)
  ========================= */
  if (profileMode === 'bend') {
    const ppf = pxPerFt();
    const straightPx = bendPointFt * ppf;
    const arcLenPx = (totalFeet - bendPointFt) * ppf;
    const ang = bendAngleDeg * Math.PI / 180;
    const r = arcLenPx / ang + CLEAR;

    const sx = leftPad;
    const sy = trackY - CLEAR;
    const bx = sx + straightPx;

    const ex = bx + r * Math.sin(ang);
    const ey = sy + r * (1 - Math.cos(ang));

    const d = `
      M ${sx} ${sy}
      L ${bx} ${sy}
      A ${r} ${r} 0 0 1 ${ex} ${ey}
    `;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#000');
    path.setAttribute('stroke-width', 1.2);
    path.setAttribute('stroke-linecap', 'square');
    add(path);

    tick(sx, sy, 0, 1);
    // tangent at arc end
const tx = Math.cos(ang);
const ty = Math.sin(ang);

// normal = perpendicular to tangent
tick(ex, ey, -ty, tx);


    label(bx, sy - LABEL_GAP, feetInches(totalFeet));
  }

/* =========================
   L SHAPE PROFILE — TRUE OUTER EDGES
========================= */
if (profileMode === 'lshape') {
  
  const ppf = pxPerFt();
  const half = trackH / 2;

  // CENTERLINE geometry (accurate architectural dimensioning)
const ox = leftPad;
const oy = trackY;

const w = legAFt * ppf;
const h = legBFt * ppf;


  /* ---------- Horizontal leg ---------- */
  const y = oy - CLEAR;
  const hx1 = ox ;
const hx2 = ox + w + half;


  const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  hLine.setAttribute('x1', hx1);
  hLine.setAttribute('y1', y);
  hLine.setAttribute('x2', hx2);
  hLine.setAttribute('y2', y);
  hLine.setAttribute('stroke', '#000');
  hLine.setAttribute('stroke-width', 1.2);
  dimG.appendChild(hLine);

tick(hx1, y + trackH / 50, 0, 1);
tick(hx2, y + trackH / 50, 0, 1);

  label((hx1 + hx2) / 2, y - LABEL_GAP, feetInches(legAFt));

  /* ---------- Vertical leg ---------- */
  const x = ox + w + CLEAR;

  const vy1 = oy - half;
const vy2 = oy + h ;


  const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  vLine.setAttribute('x1', x);
  vLine.setAttribute('y1', vy1);
  vLine.setAttribute('x2', x);
  vLine.setAttribute('y2', vy2);
  vLine.setAttribute('stroke', '#000');
  vLine.setAttribute('stroke-width', 1.2);
  dimG.appendChild(vLine);

tick(x - trackH / 45, vy1, 1, 0);
tick(x - trackH / 45, vy2, 1, 0);

  label(
    x + LABEL_GAP,
    (vy1 + vy2) / 2,
    feetInches(legBFt),
    'start'
  );
}

  svg.appendChild(dimG);
}

  function drawTrack() {
  trackGroup.innerHTML = '';
  rulerGroup.innerHTML = '';

  const ppf = pxPerFt();

  let maxY = trackY;
  let d = '';

  /* ---------------- STRAIGHT ---------------- */
  if (profileMode === 'straight') {
    const w = totalFeet * ppf;
    d = `M ${leftPad} ${trackY} L ${leftPad + w} ${trackY}`;
    maxY = trackY + trackH;
  }

  /* ---------------- BENDABLE (TRUE ARC) ---------------- */
  if (profileMode === 'bend') {
    const straightPx = bendPointFt * ppf;
    const arcLenPx = (totalFeet - bendPointFt) * ppf;
    const angleRad = bendAngleDeg * Math.PI / 180;
    const r = arcLenPx / angleRad;

    const sx = leftPad;
    const sy = trackY;

    const bx = sx + straightPx;
    const by = sy;

    const ex = bx + r * Math.sin(angleRad);
    const ey = by + r * (1 - Math.cos(angleRad));

    d = `
      M ${sx} ${sy}
      L ${bx} ${by}
      A ${r} ${r} 0 0 1 ${ex} ${ey}
    `;

    maxY = ey + trackH;
  }

  /* ---------------- L SHAPE ---------------- */
  if (profileMode === 'lshape') {
    const w1 = legAFt * ppf;
    const h2 = legBFt * ppf;

    const sx = leftPad;
    const sy = trackY;

    const cx = sx + w1;
    const cy = sy;

    const ex = cx;
    const ey = cy + h2;

    d = `
      M ${sx} ${sy}
      L ${cx} ${cy}
      L ${ex} ${ey}
    `;

    maxY = ey + trackH;
  }

  /* ---------------- CREATE PATH ---------------- */
  trackPathEl = createSvgPath(d);
  trackGroup.appendChild(trackPathEl);

  /* ---------------- CACHE PATH LENGTH ---------------- */
  trackPathLenPx = trackPathEl.getTotalLength();

  /* ---------------- AUTO SVG HEIGHT ---------------- */
  const newH = Math.max(240, maxY + 80);
  svg.setAttribute('viewBox', `0 0 ${viewW} ${newH}`);

  // --- FORCE SVG ELEMENT HEIGHT TO MATCH VIEWBOX ---
const vb = svg.viewBox.baseVal;
svg.style.height = vb.height + 'px';

}



  // ---------- components ----------
  function renderComponents() {
    compsGroup.innerHTML = '';
    const ppf = pxPerFt();

    components.forEach(comp => {
        if (comp.type === 'diffuser') {
  const startFt = comp.leftFt || 0;
  const lenFt = comp.lengthFt || 0.5;

  const startPx = (startFt / totalFeet) * trackPathLenPx;
  const endPx = ((startFt + lenFt) / totalFeet) * trackPathLenPx;

  const steps = Math.max(16, Math.floor(lenFt * 16));
  let d = '';

  for (let i = 0; i <= steps; i++) {
    const t = startPx + (i / steps) * (endPx - startPx);
    const p = trackPathEl.getPointAtLength(t);
    d += (i === 0 ? 'M ' : ' L ') + p.x + ' ' + p.y;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#ffd85a');
  path.setAttribute('stroke-width', 36);
  path.setAttribute('stroke-linecap', 'butt');
  path.setAttribute('stroke-linejoin', 'miter');

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.dataset.id = comp.id;

  attachComponentHandlers(g, comp);

  g.appendChild(path);
  compsGroup.appendChild(g);
  return;
}


      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.dataset.id = comp.id;
      const pt = getPointAtFt(comp.leftFt || 0);
      const angle = getAngleAtFt(comp.leftFt || 0);
      const x = pt.x;
      const y = pt.y;

      g.setAttribute(
        'transform',
        `translate(${pt.x}, ${pt.y}) rotate(${angle})`
      );

      if (comp.type === 'lenia') {
  const fixedInches = (comp.heads === 6) ? 5.0 : 5.5;
  comp.lengthFt = fixedInches / 12;

  const startFt = comp.leftFt || 0;
  const endFt = startFt + comp.lengthFt;

  const startPx = (startFt / totalFeet) * trackPathLenPx;
  const endPx = (endFt / totalFeet) * trackPathLenPx;

  const steps = Math.max(12, Math.floor(comp.lengthFt * 24));
  let d = '';

  for (let i = 0; i <= steps; i++) {
    const t = startPx + (i / steps) * (endPx - startPx);
    const p = trackPathEl.getPointAtLength(t);
    d += (i === 0 ? 'M ' : ' L ') + p.x + ' ' + p.y;
  }

  // Black Lenia body following the curve
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  body.setAttribute('d', d);
  body.setAttribute('fill', 'none');
  body.setAttribute('stroke', '#0b0b0b');
  body.setAttribute('stroke-width', 40);
  body.setAttribute('stroke-linecap', 'butt');
  body.setAttribute('stroke-linejoin', 'miter');

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.dataset.id = comp.id;
  attachComponentHandlers(g, comp);

  g.appendChild(body);

  // Lenia heads (dots)
  const heads = comp.heads || 5;
  for (let i = 0; i < heads; i++) {
    const ratio = heads === 1 ? 0.5 : i / (heads - 1);
    const t = startPx + ratio * (endPx - startPx);
    const p = trackPathEl.getPointAtLength(t);

    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y);
    c.setAttribute('r', 4);
    c.setAttribute('fill', '#ffd76b');
    c.setAttribute('stroke', '#000');
    c.setAttribute('stroke-width', 0.4);

    g.appendChild(c);
  }

  compsGroup.appendChild(g);
  return;
}


      if (comp.type === 'spot') {
        // revert to previous behavior: do NOT force spotInches to 6"
        // if spotInches is not set, default to 3" as before
        const defaultInches = comp.spotInches || 3;
        comp.spotInches = defaultInches;
        const rpx = Math.max(8, ((comp.spotInches || defaultInches) / 12) * ppf * 0.5);
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', 0);
        c.setAttribute('cy', 0);
        c.setAttribute('r', rpx);
        c.setAttribute('fill', '#f04b4b');
        c.setAttribute('stroke', '#f04b4b');
        c.setAttribute('stroke-width', 1.2);
        g.appendChild(c);
      }

      attachComponentHandlers(g, comp);
      compsGroup.appendChild(g);
    });

    renderItemsList();
  }

  // ---------- notes/labels (with delete button) ----------
  function renderNotes() {
    notesGroup.innerHTML = '';
    const ppf = pxPerFt();

    function nearestComponentX(leftFt) {
      if (components.length === 0) return leftPad + leftFt * ppf;
      let best = null, bestD = Infinity;
      components.forEach(c => {
        const cLeft = c.leftFt || 0;
        const cLen = (c.lengthFt !== undefined) ? c.lengthFt : 0.2;
        const center = (c.type === 'spot') ? cLeft : (cLeft + cLen / 2);
        const d = Math.abs(center - leftFt);
        if (d < bestD) { bestD = d; best = center; }
      });
      return leftPad + best * ppf;
    }

    notes.forEach(n => {
      const noteX = leftPad + (n.leftFt || 0) * ppf;
      const noteY = trackY - 74 + (n.offsetY || 0);
      const padding = 8;
      const startY = (noteY < trackY) ? (noteY + padding) : (noteY - padding);

      const targetX = (n.attachTo === 'track') ? (leftPad + ((viewW - leftPad - rightPad) / 2)) : nearestComponentX(n.leftFt);
      const targetY = trackY;

      const over = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      over.setAttribute('x1', noteX); over.setAttribute('y1', startY);
      over.setAttribute('x2', targetX); over.setAttribute('y2', targetY);
      over.setAttribute('stroke', '#ffffff'); over.setAttribute('stroke-width', 2.0);
      over.setAttribute('stroke-linecap', 'round'); over.setAttribute('pointer-events', 'none');
      notesGroup.appendChild(over);

      const dark = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      dark.setAttribute('x1', noteX); dark.setAttribute('y1', startY);
      dark.setAttribute('x2', targetX); dark.setAttribute('y2', targetY);
      dark.setAttribute('stroke', '#2b2b2b'); dark.setAttribute('stroke-width', 0.8);
      dark.setAttribute('stroke-linecap', 'round'); dark.setAttribute('pointer-events', 'none');
      notesGroup.appendChild(dark);

      const T = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      T.setAttribute('x', noteX); T.setAttribute('y', noteY);
      T.setAttribute('font-size', '16'); T.setAttribute('fill', '#000');
      T.setAttribute('text-anchor', 'middle'); T.setAttribute('font-weight', '600');
      T.setAttribute('font-family', 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial');
      T.textContent = n.text;

      const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      wrap.dataset.id = n.id;
      notesGroup.appendChild(wrap);
      wrap.appendChild(T);

      try {
        const bbox = T.getBBox();
        const padX = 8, padY = 4;
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', bbox.x - padX);
        bgRect.setAttribute('y', bbox.y - padY);
        bgRect.setAttribute('width', bbox.width + padX * 2);
        bgRect.setAttribute('height', bbox.height + padY * 2);
        bgRect.setAttribute('rx', 6);
        bgRect.setAttribute('fill', '#ffffff');
        bgRect.setAttribute('stroke', 'none');
        wrap.insertBefore(bgRect, T);

        // note delete button (editor-only)
        const nx = bbox.x + bbox.width + padX + 12;
        const ny = bbox.y + bbox.height / 2;
        const nDel = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nDel.setAttribute('class', 'note-delete-btn'); // hidden in export
        nDel.setAttribute('transform', `translate(${nx}, ${ny})`);
        nDel.style.cursor = 'pointer';

        const nCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        nCircle.setAttribute('r', 9);
        nCircle.setAttribute('fill', '#fff');
        nCircle.setAttribute('stroke', '#d33');
        nCircle.setAttribute('stroke-width', 0.9);
        nDel.appendChild(nCircle);
        const nX = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        nX.setAttribute('x', 0); nX.setAttribute('y', 4);
        nX.setAttribute('font-size', 12);
        nX.setAttribute('text-anchor', 'middle');
        nX.setAttribute('fill', '#d33');
        nX.textContent = '×';
        nDel.appendChild(nX);
        nDel.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          notes = notes.filter(item => item.id !== n.id);
          renderAll();
        });
        wrap.appendChild(nDel);

      } catch (err) {
        // ignore bbox errors
      }

      makeNoteDraggable(wrap, n);

      wrap.addEventListener('dblclick', () => {
        const v = prompt('Edit label text', n.text);
        if (v !== null) { n.text = v; renderAll(); }
      });
    });
  }

  // ---------- fixed notes row (bottom table) ----------
  function renderFixedNotesRow() {
    const old = svg.querySelector('#fixedNotesRow');
    if (old) old.remove();

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'fixedNotesRow';

    const entries = [
      { label: '5-Head Lenia (5.5")', type: 'lenia5' },
      { label: '6-Head Lenia (5")', type: 'lenia6' },
      { label: 'Diffuser', type: 'diffuser' },
      // show Spot with (6") in the bottom table as requested (this is a label only)
      { label: 'Spot (6")', type: 'spot' }
    ];

    const vb = svg.viewBox.baseVal;
const baseY = vb.height - 40;

    const startX = leftPad;
    const gapX = 200;
    const thumbW = 44;
    const thumbH = 18;

    entries.forEach((ent, idx) => {
      const ex = startX + idx * gapX;
      const ey = baseY;

      const thumbG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      thumbG.setAttribute('transform', `translate(${ex}, ${ey - 8})`);

      if (ent.type === 'diffuser') {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', 0); r.setAttribute('y', 0);
        r.setAttribute('width', thumbW); r.setAttribute('height', thumbH - 4);
        r.setAttribute('rx', 3);
        r.setAttribute('fill', '#ffd85a'); r.setAttribute('stroke', '#e6b94a'); r.setAttribute('stroke-width', 0.4);
        thumbG.appendChild(r);
      } else if (ent.type === 'lenia5') {
        const base = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        base.setAttribute('x', 0); base.setAttribute('y', 0);
        base.setAttribute('width', thumbW); base.setAttribute('height', thumbH - 4);
        base.setAttribute('fill', '#111'); base.setAttribute('stroke', '#555'); base.setAttribute('stroke-width', 0.3);
        thumbG.appendChild(base);

        const heads = 5;
        const spacing = (thumbW - 14) / (heads - 1);
        for (let i = 0; i < heads; i++) {
          const cx = 7 + i * spacing;
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', cx); c.setAttribute('cy', 6); c.setAttribute('r', 2.2);
          c.setAttribute('fill', '#ffd76b'); c.setAttribute('stroke', '#000'); c.setAttribute('stroke-width', 0.12);
          thumbG.appendChild(c);
        }
      } else if (ent.type === 'lenia6') {
        const base = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        base.setAttribute('x', 0); base.setAttribute('y', 0);
        base.setAttribute('width', thumbW); base.setAttribute('height', thumbH - 4);
        base.setAttribute('fill', '#111'); base.setAttribute('stroke', '#555'); base.setAttribute('stroke-width', 0.3);
        thumbG.appendChild(base);

        const heads = 6;
        const spacing = (thumbW - 14) / (heads - 1);
        for (let i = 0; i < heads; i++) {
          const cx = 7 + i * spacing;
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', cx); c.setAttribute('cy', 6); c.setAttribute('r', 2.0);
          c.setAttribute('fill', '#ffd76b'); c.setAttribute('stroke', '#000'); c.setAttribute('stroke-width', 0.12);
          thumbG.appendChild(c);
        }
      } else if (ent.type === 'spot') {
        const cx = thumbW / 2;
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', thumbH / 2); c.setAttribute('r', 8);
        c.setAttribute('fill', '#f04b4b'); c.setAttribute('stroke', '#f04b4b'); c.setAttribute('stroke-width', 0.4);
        thumbG.appendChild(c);
      }

      g.appendChild(thumbG);

      const lab = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lab.setAttribute('x', ex + thumbW + 8);
      lab.setAttribute('y', ey + 4);
      lab.setAttribute('font-size', 12);
      lab.setAttribute('fill', '#111');
      lab.setAttribute('font-weight', 500);
      lab.setAttribute('font-family', 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial');
      lab.textContent = ent.label;
      g.appendChild(lab);
    });

    svg.appendChild(g);
  }

  // ---------- interaction helpers (components unchanged) ----------
function getPointAtFt(ft) {
  if (!trackPathEl) return { x: 0, y: 0 };

  const ratio = Math.max(0, Math.min(1, ft / totalFeet));
  const px = ratio * trackPathLenPx;

  return trackPathEl.getPointAtLength(px);
}

function getAngleAtFt(ft) {
  if (!trackPathEl) return 0;

  const ratio = Math.max(0, Math.min(1, ft / totalFeet));
  const px = ratio * trackPathLenPx;
  const delta = 1;

  const p1 = trackPathEl.getPointAtLength(Math.max(0, px - delta));
  const p2 = trackPathEl.getPointAtLength(Math.min(trackPathLenPx, px + delta));

  return Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
}

function attachComponentHandlers(g, comp) {
    let dragging = false, resizingRight = false;
    let startX = 0, startLeft = 0, startLen = 0;

    g.addEventListener('pointerdown', e => {
      e.stopPropagation();
      const target = e.target;

      if (target.classList && target.classList.contains('resize-handle')) {
        resizingRight = true;
        startX = e.clientX; startLen = comp.lengthFt || 0.5;
        document.addEventListener('pointermove', onResizeRight);
        document.addEventListener('pointerup', endResizeRight);
        return;
      }

      dragging = true;
      startX = e.clientX; startLeft = comp.leftFt || 0;
      document.addEventListener('pointermove', onDrag);
      document.addEventListener('pointerup', onDragEnd);
    });

    function onDrag(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const df = (dx / trackPathLenPx) * totalFeet;


      if (comp.type === 'spot') {
        comp.leftFt = Math.max(0, Math.min(totalFeet, startLeft + df));
      } else {
        const maxLeft = Math.max(0, totalFeet - (comp.lengthFt || 0.0001));
        comp.leftFt = Math.max(0, Math.min(maxLeft, startLeft + df));
      }
      renderAll();
    }

    function onDragEnd() {
      dragging = false;
      document.removeEventListener('pointermove', onDrag);
      document.removeEventListener('pointerup', onDragEnd);
    }

    function onResizeRight(e) {
      if (!resizingRight) return;
      const dx = e.clientX - startX; const df = dx / pxPerFt();
      let newL = Math.max(0.05, startLen + df);
      if (newL + (comp.leftFt || 0) > totalFeet) newL = totalFeet - (comp.leftFt || 0);
      comp.lengthFt = newL;
      renderAll();
    }

    function endResizeRight() {
      resizingRight = false;
      document.removeEventListener('pointermove', onResizeRight);
      document.removeEventListener('pointerup', endResizeRight);
    }

    g.addEventListener('dblclick', ev => {
      ev.stopPropagation();
      if (comp.type === 'diffuser') {
        const v = prompt('Enter length (ft):', comp.lengthFt || 1);
        if (v === null) return;
        const val = parseFloat(v);
        if (!isNaN(val)) {
          comp.lengthFt = Math.min(Math.max(0.05, val), totalFeet - (comp.leftFt || 0));
          renderAll();
        }
      }
    });
  }

  function makeNoteDraggable(g, note) {
    let dragging = false, sx = 0, sy = 0;
    g.addEventListener('pointerdown', e => {
      dragging = true; sx = e.clientX; sy = e.clientY;
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
    function move(e) {
      if (!dragging) return;
      const dx = e.clientX - sx; const dy = e.clientY - sy;
      note.leftFt = Math.max(0, Math.min(totalFeet, note.leftFt + dx / pxPerFt()));
      note.offsetY = (note.offsetY || 0) + dy;
      sx = e.clientX; sy = e.clientY; renderAll();
    }
    function up() {
      dragging = false;
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    }
  }

  // ---------- UI list ----------
  function renderItemsList() {
    itemsList.innerHTML = '';
    components.forEach(c => {
      const row = document.createElement('div'); row.className = 'item-row';
      let txt = '';
      if (c.type === 'diffuser') txt = `Diffuser — ${ (c.lengthFt || 0).toFixed(2) } ft`;
      if (c.type === 'lenia') txt = `${c.heads}-head Lenia — ${ (c.lengthFt || 0).toFixed(3) } ft`;
      if (c.type === 'spot') txt = `Spot — ${c.spotInches || 3} in`;
      row.innerHTML = `<div>${txt}</div><button class="btn ghost">Remove</button>`;
      row.querySelector('button').onclick = () => { components = components.filter(x => x.id !== c.id); renderAll(); };
      itemsList.appendChild(row);
    });
  }

  applyTotalBtn.onclick = () => {
  if (profileMode === 'straight') {
    totalFeet = parseFloat(totalFeetInput.value);
  }

  if (profileMode === 'bend') {
    totalFeet = parseFloat(totalFeetInput.value);
    bendPointFt = parseFloat(bendPointInput.value);
    bendAngleDeg = parseFloat(bendAngleInput.value);
  }

  if (profileMode === 'lshape') {
    legAFt = parseFloat(legAInput.value);
    legBFt = parseFloat(legBInput.value);
    totalFeet = legAFt + legBFt;
  }

  renderAll();
};


  addDiffBtn.onclick = () => {
    const len = Math.max(0.1, parseFloat(diffLenInput.value) || 1);
    const safeLen = Math.min(len, totalFeet);
    components.push({ id: uid('d'), type: 'diffuser', leftFt: 0, lengthFt: safeLen });
    renderAll();
  };

  addSpotBtn.onclick = () => {
    // revert to previous behavior: let spot have its own spotInches (default 3")
    const defaultInches = 3;
    components.push({ id: uid('s'), type: 'spot', leftFt: 0, spotInches: defaultInches });
    renderAll();
  };

  addLeniaBtn.onclick = () => {
    const heads = parseInt(leniaHeadsSel.value, 10) || 5;
    const fixedInches = (heads === 6) ? 5.0 : 5.5;
    const fixedFt = fixedInches / 12;
    components.push({
      id: uid('l'),
      type: 'lenia',
      heads,
      leftFt: 0,
      lengthFt: fixedFt
    });
    renderAll();
  };

  addNoteBtn.onclick = () => {
    const txt = noteTextInput.value.trim();
    if (!txt) return;
    notes.push({ id: uid('n'), text: txt, leftFt: totalFeet * 0.5, offsetY: -10 });
    noteTextInput.value = '';
    renderAll();
  };

  // ---------- export PNG (hide editor-only controls before export) ----------
  exportPngBtn.onclick = () => {
    const rect = svg.getBoundingClientRect();
    const realW = rect.width;
    const realH = rect.height;

    const clone = svg.cloneNode(true);

    // hide editor-delete controls and handles in the clone so they won't appear in PNG
    const hideSelectors = ['.dim-delete-btn', '.note-delete-btn', '.dim-handle'];
    hideSelectors.forEach(sel => {
      const nodes = clone.querySelectorAll(sel);
      nodes.forEach(n => {
        n.setAttribute('display', 'none');
        n.setAttribute('pointer-events', 'none');
      });
    });

    let bg = clone.querySelector('#exportBgRect');
    if (!bg) {
      bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('id', 'exportBgRect');
      bg.setAttribute('x', 0); bg.setAttribute('y', 0);
      bg.setAttribute('width', viewW); bg.setAttribute('height', viewH);
      bg.setAttribute('fill', '#ffffff');
      clone.insertBefore(bg, clone.firstChild);
    }

    clone.setAttribute('width', realW);
    clone.setAttribute('height', realH);

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(clone);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(realW * scale);
    canvas.height = Math.round(realH * scale);
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async function () {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
const record = {
  customerName: document.getElementById('custName').value,
  mobile: document.getElementById('custMobile').value,
  address: document.getElementById('custAddress').value,
  date: document.getElementById('custDate').value,
  description: document.getElementById('descriptionText').value,
  image: canvas.toDataURL('image/png'),
  createdAt: new Date()
};

try {
  await addDoc(collection(db, "drawings"), record);
  console.log("Saved to Firestore");
} catch (err) {
  console.error("Firestore save failed", err);
}

      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'export.png';
      a.click();
    };
    img.onerror = function (err) {
      console.error('Image load error', err);
      URL.revokeObjectURL(url);
      alert('Export failed (could not rasterize SVG). Try again.');
    };
    img.src = url;
  };

  // ---------- svg click handling for dimension creation ----------
  svg.addEventListener('pointerdown', (e) => {
    if (!dimMode) return;

    // compute svg coords
    const pt = clientToSvgPoint(e.clientX, e.clientY);
    const cpt = clampToSvgBounds(pt);

    if (!dimTemp) {
  dimTemp = {
    x1: cpt.x,
    y1: cpt.y,
    startLen: null,
    endLen: null
  };
  showTempDim(dimTemp);
  return;
}


    // second click: set end and create straight (horizontal/vertical) dimension
    dimTemp.x2 = cpt.x; dimTemp.y2 = cpt.y;

    // snap to horizontal or vertical depending on larger delta
    const dx = dimTemp.x2 - dimTemp.x1;
    const dy = dimTemp.y2 - dimTemp.y1;
    let orient = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    if (orient === 'h') {
      dimTemp.y2 = dimTemp.y1; // horizontal
    } else {
      dimTemp.x2 = dimTemp.x1; // vertical
    }

    // prompt for label text
    const label = prompt('Dimension label (text shown with the line):', '') || '';

    if (profileMode === 'bend') {

 const startLen = dimTemp.startLen;
const endLen   = dimTemp.endLen;
      
  dims.push({
    id: uid('dim'),
    type: 'arc',
    startLen: Math.min(startLen, endLen),
    endLen: Math.max(startLen, endLen),
    offset: 40,
    label
  });

} else {

  dims.push({
    id: uid('dim'),
    type: 'line',
    x1: dimTemp.x1,
    y1: dimTemp.y1,
    x2: dimTemp.x2,
    y2: dimTemp.y2,
    label,
    orient
  });
}


    dimTemp = null;
    const temp = svg.querySelector('#dimTempGroup'); if (temp) temp.remove();

    // automatically cancel the Add Dimension mode after creation
    dimMode = false;
    const btn = document.getElementById('addDimBtn'); if (btn) btn.textContent = 'Add Dimension';

    renderAll();
  });

  function showTempDim(temp) {
  const old = svg.querySelector('#dimTempGroup');
  if (old) old.remove();

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'dimTempGroup';

  // STRAIGHT + L-SHAPE → keep straight preview
  if (profileMode !== 'bend') {
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', temp.x1);
    ln.setAttribute('y1', temp.y1);
    ln.setAttribute('x2', temp.x1);
    ln.setAttribute('y2', temp.y1);
    ln.setAttribute('stroke', '#0b5');
    ln.setAttribute('stroke-width', 1);
    ln.setAttribute('stroke-dasharray', '6,4');
    g.appendChild(ln);
    svg.appendChild(g);

    document.addEventListener('pointermove', function onMove(e) {
      if (!dimTemp) {
        document.removeEventListener('pointermove', onMove);
        return;
      }
      const pt = clientToSvgPoint(e.clientX, e.clientY);
      ln.setAttribute('x2', pt.x);
      ln.setAttribute('y2', pt.y);
    });

    return;
  }

  // BENDABLE PROFILE → CURVED PREVIEW
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#0b5');
  path.setAttribute('stroke-width', 1);
  path.setAttribute('stroke-dasharray', '6,4');
  g.appendChild(path);
  svg.appendChild(g);

  document.addEventListener('pointermove', function onMove(e) {
    if (!dimTemp) {
      document.removeEventListener('pointermove', onMove);
      return;
    }

    const pt = clientToSvgPoint(e.clientX, e.clientY);
    temp.startLen = getClosestPathLength(temp.x1, temp.y1);
temp.endLen   = getClosestPathLength(pt.x, pt.y);

const startLen = temp.startLen;
const endLen   = temp.endLen;


    const a = Math.min(startLen, endLen);
    const b = Math.max(startLen, endLen);

    const steps = 40;
    let d = '';

    for (let i = 0; i <= steps; i++) {
      const t = a + (i / steps) * (b - a);
      const p = trackPathEl.getPointAtLength(t);

      const delta = 1;
      const p1 = trackPathEl.getPointAtLength(Math.max(0, t - delta));
      const p2 = trackPathEl.getPointAtLength(Math.min(trackPathLenPx, t + delta));
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;

      const nx = -dy / len;
      const ny = dx / len;

    const PREVIEW_OFFSET = 44;

const x = p.x + nx * PREVIEW_OFFSET;
const y = p.y + ny * PREVIEW_OFFSET;

      d += (i === 0 ? 'M ' : ' L ') + x + ' ' + y;
    }

    path.setAttribute('d', d);
  });
}


  // ---------- master render ----------
  function renderAll() {
    drawTrack();
    renderDimensionLine();
    renderComponents();
    renderNotes();
    renderDimensionLines();
    renderFixedNotesRow();
    renderItemsList();
  }

  // initial render
  renderAll();

  // responsive re-render
  window.addEventListener('resize', renderAll);
const dateInput = document.getElementById('custDate');
if (dateInput) {
  dateInput.valueAsDate = new Date();
}
const loginBtn = document.getElementById("loginBtn");

if (loginBtn) {
  loginBtn.onclick = () => {
    const pwd = prompt("Enter staff password");
    if (pwd === "1234") { // change later
      sessionStorage.setItem("staffLoggedIn", "true");
      window.location.href = "staff.html";
    } else {
      alert("Incorrect password");
    }
  };
}

const toggleBtn = document.getElementById("toggleControls");
const panel = document.querySelector("aside.panel");

if (toggleBtn && panel) {
  toggleBtn.onclick = () => {
    panel.classList.toggle("active");
  };
}


})();
