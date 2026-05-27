/* ============================================================
   ARCH.AI — Core Script v2.0
   ============================================================
   Algorithms:
     A) CBLGA — Constraint-Based Layout Generation Algorithm
        - Greedy strip row-packing, no overlap, full coverage
        - Multi-floor independent room allocation
        - Dynamic proportional resize on modification
     B) GTA   — Graphical Transformation Algorithm (Three.js)
        - 2D CBLGA layout → 3D stacked box mesh per floor
        - Floors stacked Y-axis, Floor 1 at bottom
        - Mouse-drag orbit + scroll zoom interaction

   Features:
     - Multi-floor: independent rooms per floor
     - Structural elements: doors, windows, stairs
     - INSERT MODE: click room wall to place door/window
     - Drag to reposition placed elements
     - Modify mode: double-click room to resize, el to remove
     - Save/Load project via localStorage (Firebase-ready)
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   CONSTANTS
   ──────────────────────────────────────────────────────────── */
const ROOM_COLORS = [
  { bg: 'rgba(0,  150, 220, 0.72)', border: '#00aaff' },
  { bg: 'rgba(220, 90,  50,  0.72)', border: '#ff6633' },
  { bg: 'rgba(60,  180, 100, 0.72)', border: '#3dcc6e' },
  { bg: 'rgba(200, 60,  180, 0.72)', border: '#dd44cc' },
  { bg: 'rgba(240, 180, 30,  0.72)', border: '#f0b81e' },
  { bg: 'rgba(80,  200, 200, 0.72)', border: '#50cccc' },
  { bg: 'rgba(240, 80,  100, 0.72)', border: '#ff5066' },
  { bg: 'rgba(130, 90,  230, 0.72)', border: '#8855ee' },
  { bg: 'rgba(40,  200, 160, 0.72)', border: '#28c8a0' },
  { bg: 'rgba(230, 140, 30,  0.72)', border: '#e68c1e' },
  { bg: 'rgba(100, 160, 240, 0.72)', border: '#64a0f0' },
  { bg: 'rgba(220, 50,  50,  0.72)', border: '#dc3232' },
];

const ELEMENT_META = {
  door:   { icon: '🚪', color: '#f0c040', label: 'Door',   size: { w: 24, h: 10 } },
  window: { icon: '🪟', color: '#00aaff', label: 'Window', size: { w: 30, h: 8  } },
  stair:  { icon: '🪜', color: '#00e5a0', label: 'Stair',  size: { w: 28, h: 28 } },
};

/* ────────────────────────────────────────────────────────────
   DATA LAYER
   ──────────────────────────────────────────────────────────── */

function saveData(data) {
  localStorage.setItem('archai_data', JSON.stringify(data));
}

function loadData() {
  const raw = localStorage.getItem('archai_data');
  return raw ? JSON.parse(raw) : null;
}

/** Save named project snapshot */
function saveProject(name) {
  const data = loadData();
  if (!data) return false;
  const all = loadAllProjects();
  all[name] = { ...data, savedAt: new Date().toISOString() };
  localStorage.setItem('archai_projects', JSON.stringify(all));
  return true;
}

/** Load a named project snapshot */
function loadProject(name) {
  return loadAllProjects()[name] || null;
}

/** Return all saved projects */
function loadAllProjects() {
  const raw = localStorage.getItem('archai_projects');
  return raw ? JSON.parse(raw) : {};
}

/** Delete a named project */
function deleteProject(name) {
  const all = loadAllProjects();
  delete all[name];
  localStorage.setItem('archai_projects', JSON.stringify(all));
}

/* ────────────────────────────────────────────────────────────
   MULTI-FLOOR HELPERS
   ──────────────────────────────────────────────────────────── */

/** Ensure data.floors exists and has the right count */
function normaliseFloors(data) {
  const n = Math.max(1, data.numFloors || 1);
  if (!data.floors || !Array.isArray(data.floors) || data.floors.length === 0) {
    data.floors = Array.from({ length: n }, (_, i) => ({
      floorIndex: i,
      rooms:      i === 0
        ? (data.rooms || [])
        : generateDefaultRooms(data.rooms || []),
      elements:   [],
    }));
  }
  while (data.floors.length < n) {
    const i = data.floors.length;
    data.floors.push({
      floorIndex: i,
      rooms:      generateDefaultRooms(data.floors[0].rooms),
      elements:   [],
    });
  }
  data.numFloors = n;
  return data;
}

/** Clone a rooms array with fresh IDs */
function generateDefaultRooms(templateRooms) {
  return (templateRooms || []).map(r => ({
    ...r,
    id: `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  }));
}

/* ────────────────────────────────────────────────────────────
   CBLGA — Constraint-Based Layout Generation Algorithm
   ────────────────────────────────────────────────────────────
   Constraints enforced:
     1. No room overlap (strip isolation per row)
     2. Full canvas coverage (last-cell & last-row fill)
     3. Proportional cell sizes (user width/length ratios)
     4. Minimum cell: 40 × 40 px
   ──────────────────────────────────────────────────────────── */

/**
 * Build pixel layout for all rooms of one floor.
 * @param {Object[]} rooms   - [{ id, width, length }]
 * @param {number}   canvasW - px width
 * @param {number}   canvasH - px height
 * @param {number}   landW   - land width  (metres)
 * @param {number}   landL   - land length (metres)
 * @returns {Object[]} layout - [{ id, x, y, w, h, color, index }]
 */
function buildLayout(rooms, canvasW, canvasH, landW, landL) {
  const n = rooms.length;
  if (n === 0) return [];

  /* CBLGA Step 1: distribute rooms into balanced rows */
  const numRows        = Math.max(1, Math.round(Math.sqrt(n)));
  const rowAssignments = CBLGA_distributeRows(rooms, numRows);

  /* CBLGA Step 2: compute row heights proportionally */
  const totalUserH = rowAssignments.reduce(
    (s, row) => s + Math.max(...row.map(r => r.length)), 0
  );

  const layout  = [];
  let   yOffset = 0;

  rowAssignments.forEach((row, rowIdx) => {
    const isLastRow = rowIdx === rowAssignments.length - 1;
    const rowUserH  = Math.max(...row.map(r => r.length));
    /* Constraint: last row fills remaining canvas height exactly */
    const rowH = isLastRow
      ? Math.max(40, canvasH - yOffset)
      : Math.max(40, Math.round((rowUserH / totalUserH) * canvasH));

    /* CBLGA Step 3: split row width proportionally */
    const rowTotalW = row.reduce((s, r) => s + r.width, 0);
    let   xOffset   = 0;

    row.forEach((room, colIdx) => {
      const isLastCol = colIdx === row.length - 1;
      /* Constraint: last cell fills remaining row width exactly */
      const cellW = isLastCol
        ? Math.max(40, canvasW - xOffset)
        : Math.max(40, Math.round((room.width / rowTotalW) * canvasW));

      const roomIndex = rooms.findIndex(r => r.id === room.id);
      layout.push({
        id:    room.id,
        x:     xOffset,
        y:     yOffset,
        w:     cellW,
        h:     rowH,
        color: ROOM_COLORS[roomIndex % ROOM_COLORS.length],
        index: roomIndex,
      });

      xOffset += cellW;
    });

    yOffset += rowH;
  });

  return layout;
}

/**
 * CBLGA sub-routine: greedy balanced row assignment.
 * Each room goes to the row with smallest current area total.
 */
function CBLGA_distributeRows(rooms, numRows) {
  const rows     = Array.from({ length: numRows }, () => []);
  const rowAreas = new Array(numRows).fill(0);

  rooms.forEach(room => {
    const minIdx = rowAreas.indexOf(Math.min(...rowAreas));
    rows[minIdx].push(room);
    rowAreas[minIdx] += room.width * room.length;
  });

  return rows.filter(r => r.length > 0);
}

/**
 * CBLGA dynamic resize: when one room changes dimensions,
 * all others are scaled so Σ(room area) ≈ landW × landL.
 */
function proportionalResize(rooms, changedId, newWidth, newLength, landW, landL) {
  const totalArea = landW * landL;

  if (rooms.length === 1) {
    return [{ ...rooms[0], width: landW, length: landL }];
  }

  const maxArea  = totalArea * 0.9;
  const rawArea  = newWidth * newLength;
  const clampedL = rawArea > maxArea
    ? Math.max(1, Math.floor(maxArea / newWidth))
    : newLength;

  const usedArea      = newWidth * clampedL;
  const remainingArea = totalArea - usedArea;
  const others        = rooms.filter(r => r.id !== changedId);
  const othersArea    = others.reduce((s, r) => s + r.width * r.length, 0);
  const scale         = othersArea > 0 ? remainingArea / othersArea : 1;

  return rooms.map(r => {
    if (r.id === changedId) return { ...r, width: newWidth, length: clampedL };
    const newLen = Math.max(1, Math.round((r.width * r.length * scale) / r.width));
    return { ...r, length: newLen };
  });
}

/* ────────────────────────────────────────────────────────────
   DIAGRAM RENDERER  (2D)
   ──────────────────────────────────────────────────────────── */

/**
 * Render one floor's CBLGA layout + structural elements.
 * @param {HTMLElement}  container
 * @param {Object[]}     layout       - from buildLayout()
 * @param {Object[]}     rooms        - rooms for this floor
 * @param {Object[]}     elements     - doors/windows/stairs for this floor
 * @param {boolean}      modifyMode
 * @param {boolean}      insertMode
 * @param {string|null}  insertType   - 'door' | 'window'
 * @param {Function}     onDblClick   - (roomId)
 * @param {Function}     onInsert     - (type, x, y, roomId)
 * @param {Function}     onElDblClick - (elId)
 */
function renderDiagram(
  container, layout, rooms, elements,
  modifyMode, insertMode, insertType,
  onDblClick, onInsert, onElDblClick
) {
  container.innerHTML = '';

  /* ── Room cells ── */
  layout.forEach(cell => {
    const room = rooms[cell.index];
    const div  = document.createElement('div');

    let cls = 'room-cell';
    if (modifyMode) cls += ' modify-mode';
    if (insertMode) cls += ' insert-mode';
    div.className      = cls;
    div.dataset.roomId = cell.id;

    div.style.cssText = `
      left:${cell.x}px; top:${cell.y}px;
      width:${cell.w}px; height:${cell.h}px;
      background:${cell.color.bg};
      border-color:${cell.color.border};`;

    /* Labels */
    const label = document.createElement('div');
    label.className   = 'room-label';
    label.textContent = `ROOM ${cell.index + 1}`;

    const sizeLbl = document.createElement('div');
    sizeLbl.className   = 'room-size';
    sizeLbl.textContent = `${room.width}m × ${room.length}m`;

    const areaTick = document.createElement('div');
    areaTick.style.cssText = `
      position:absolute;bottom:6px;right:8px;
      font-family:'Share Tech Mono',monospace;
      font-size:clamp(7px,0.9vw,10px);
      color:rgba(255,255,255,0.3);pointer-events:none;`;
    areaTick.textContent = `${room.width * room.length}m²`;

    div.appendChild(label);
    div.appendChild(sizeLbl);
    div.appendChild(areaTick);

    /* Modify: double-click to resize */
    if (modifyMode && onDblClick) {
      div.title = 'Double-click to edit dimensions';
      div.addEventListener('dblclick', e => { e.stopPropagation(); onDblClick(cell.id); });
    }

    /* Insert: click to place element */
    if (insertMode && insertType && onInsert) {
      div.title = `Click to place ${insertType} on this room`;
      div.addEventListener('click', e => {
        e.stopPropagation();
        const cRect = container.getBoundingClientRect();
        onInsert(insertType, e.clientX - cRect.left, e.clientY - cRect.top, cell.id);
      });
    }

    container.appendChild(div);
  });

  /* ── Structural elements ── */
  if (Array.isArray(elements)) {
    elements.forEach(el => renderElement(container, el, modifyMode, onElDblClick));
  }
}

/* ────────────────────────────────────────────────────────────
   STRUCTURAL ELEMENT RENDERER
   ──────────────────────────────────────────────────────────── */
function renderElement(container, el, modifyMode, onElDblClick) {
  const meta = ELEMENT_META[el.type];
  if (!meta) return;

  const div = document.createElement('div');
  div.className      = 'struct-element';
  div.dataset.elId   = el.id;
  div.dataset.elType = el.type;
  div.style.left     = el.x + 'px';
  div.style.top      = el.y + 'px';
  div.style.width    = (el.w || meta.size.w) + 'px';
  div.style.height   = (el.h || meta.size.h) + 'px';
  div.style.borderColor = meta.color;
  div.style.boxShadow   = `0 0 8px ${meta.color}99`;
  div.title = meta.label + (modifyMode ? ' — double-click to remove' : ' — drag to move');

  const icon = document.createElement('span');
  icon.textContent   = meta.icon;
  icon.style.cssText = 'font-size:11px;line-height:1;pointer-events:none;';
  div.appendChild(icon);

  /* Make draggable */
  makeDraggable(div, container);

  /* Modify: double-click to remove */
  if (modifyMode && onElDblClick) {
    div.addEventListener('dblclick', e => { e.stopPropagation(); onElDblClick(el.id); });
  }

  container.appendChild(div);
}

/* ────────────────────────────────────────────────────────────
   DRAG HELPER
   ──────────────────────────────────────────────────────────── */
function makeDraggable(el, container) {
  let sX, sY, oL, oT;

  el.addEventListener('mousedown', e => {
    e.stopPropagation();
    sX = e.clientX; sY = e.clientY;
    oL = parseInt(el.style.left) || 0;
    oT = parseInt(el.style.top)  || 0;
    el.style.zIndex = 50;
    el.style.cursor = 'grabbing';

    const move = mv => {
      const cW = container.offsetWidth;
      const cH = container.offsetHeight;
      const eW = el.offsetWidth;
      const eH = el.offsetHeight;
      el.style.left = Math.min(cW - eW, Math.max(0, oL + mv.clientX - sX)) + 'px';
      el.style.top  = Math.min(cH - eH, Math.max(0, oT + mv.clientY - sY)) + 'px';
    };
    const up = () => {
      el.style.zIndex = 20;
      el.style.cursor = 'grab';
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

/* ────────────────────────────────────────────────────────────
   LEGEND BUILDER
   ──────────────────────────────────────────────────────────── */
function buildLegend(container, rooms) {
  container.innerHTML = '';

  rooms.forEach((room, idx) => {
    const color = ROOM_COLORS[idx % ROOM_COLORS.length];
    const item  = document.createElement('div');
    item.className = 'legend-item';

    const swatch = document.createElement('div');
    swatch.className     = 'legend-swatch';
    swatch.style.background = color.bg;
    swatch.style.border  = `1px solid ${color.border}`;

    const lbl = document.createElement('span');
    lbl.textContent = `R${idx + 1} — ${room.width}×${room.length}`;

    item.appendChild(swatch);
    item.appendChild(lbl);
    container.appendChild(item);
  });

  /* Element type legend */
  Object.entries(ELEMENT_META).forEach(([, meta]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span style="font-size:12px;">${meta.icon}</span><span>${meta.label}</span>`;
    container.appendChild(item);
  });
}

/* ────────────────────────────────────────────────────────────
   ELEMENT FACTORY
   ──────────────────────────────────────────────────────────── */
function createElement(type, x, y, roomId, floorIdx) {
  const meta = ELEMENT_META[type] || ELEMENT_META.door;
  return {
    id:       `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    x:        Math.round(x - meta.size.w / 2),
    y:        Math.round(y - meta.size.h / 2),
    w:        meta.size.w,
    h:        meta.size.h,
    roomId:   roomId || null,
    floorIdx: floorIdx || 0,
  };
}

/** Auto-place stair element centred on canvas */
function autoPlaceStair(canvasW, canvasH, floorIdx) {
  return createElement('stair', canvasW / 2, canvasH / 2, null, floorIdx);
}

/* ────────────────────────────────────────────────────────────
   GTA — Graphical Transformation Algorithm  (Three.js)
   ────────────────────────────────────────────────────────────
   Converts per-floor CBLGA 2D layouts into 3D stacked geometry.
     - Each room → BoxGeometry mesh
     - Floors stacked on Y-axis (Floor 1 at y=0)
     - Mouse-drag orbit + scroll-wheel zoom
   ──────────────────────────────────────────────────────────── */

/**
 * Launch 3D view in <canvas> element.
 * @param {HTMLCanvasElement} canvas
 * @param {Object[]}          floors   - [{ rooms[], elements[] }]
 * @param {number}            landW
 * @param {number}            landL
 * @returns {THREE.WebGLRenderer}
 */
function launch3DView(canvas, floors, landW, landL) {
  if (typeof THREE === 'undefined') {
    canvas.parentElement.innerHTML =
      '<p style="color:#ff4466;font-family:monospace;padding:30px;text-align:center;">' +
      '⚠ Three.js failed to load. Check internet connection.</p>';
    return null;
  }

  const W = canvas.clientWidth  || 800;
  const H = canvas.clientHeight || 480;

  /* Renderer */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

  /* Scene */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080d14);
  scene.fog        = new THREE.FogExp2(0x080d14, 0.018);

  /* Camera */
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 500);
  const TOTAL_H = floors.length * 3.5;
  camera.position.set(landW * 1.8, TOTAL_H + landL, landW * 1.8);
  camera.lookAt(0, TOTAL_H / 2, 0);

  /* Lights */
  scene.add(new THREE.AmbientLight(0x223344, 1.5));
  const dirLight = new THREE.DirectionalLight(0x6699ff, 1.2);
  dirLight.position.set(40, 80, 40);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  scene.add(dirLight);
  scene.add(new THREE.PointLight(0xf0c040, 0.8, 120));

  /* Ground grid */
  const grid = new THREE.GridHelper(
    Math.max(landW, landL) * 4, 24, 0x003355, 0x001e33
  );
  grid.position.y = -0.05;
  scene.add(grid);

  /* GTA: build geometry per floor */
  const FLOOR_H  = 3.5;
  const WALL_GAP = 0.1;
  const FW = landW * 10;
  const FH = landL * 10;

  floors.forEach((floor, fIdx) => {
    const yBase  = fIdx * FLOOR_H;
    const fRooms = Array.isArray(floor.rooms) ? floor.rooms : [];
    if (fRooms.length === 0) return;

    const layout2D = buildLayout(fRooms, FW, FH, landW, landL);

    layout2D.forEach(cell => {
      /* Convert pixel → world coords (centred on origin) */
      const wx = (cell.x / FW) * landW - landW / 2;
      const wz = (cell.y / FH) * landL - landL / 2;
      const ww = (cell.w / FW) * landW;
      const wh = (cell.h / FH) * landL;

      const geo = new THREE.BoxGeometry(
        Math.max(0.2, ww - WALL_GAP),
        FLOOR_H - 0.12,
        Math.max(0.2, wh - WALL_GAP)
      );

      const col = GTA_parseColor(cell.color.bg);
      const mat = new THREE.MeshLambertMaterial({
        color: col, transparent: true, opacity: 0.85,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx + ww / 2, yBase + FLOOR_H / 2, wz + wh / 2);
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      /* Wireframe edges */
      const edges   = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x0088cc, transparent: true, opacity: 0.55 });
      const wires   = new THREE.LineSegments(edges, lineMat);
      wires.position.copy(mesh.position);
      scene.add(wires);
    });

    /* Floor slab */
    const slabGeo = new THREE.BoxGeometry(landW, 0.18, landL);
    const slabMat = new THREE.MeshLambertMaterial({ color: 0x0d1f33, transparent: true, opacity: 0.95 });
    const slab    = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(0, yBase - 0.09, 0);
    slab.receiveShadow = true;
    scene.add(slab);

    /* Floor label sprite */
    GTA_addLabel(scene, `F${fIdx + 1}`, -landW / 2 - 1.5, yBase + FLOOR_H / 2, 0);
  });

  /* ── GTA Interaction: mouse-drag orbit + scroll zoom ── */
  let isDrag = false, lx = 0, ly = 0;
  let theta = Math.PI / 4, phi = Math.PI / 3.5;
  let radius = camera.position.length();

  canvas.addEventListener('mousedown', e => { isDrag = true; lx = e.clientX; ly = e.clientY; });
  canvas.addEventListener('mouseup',   () => { isDrag = false; });
  canvas.addEventListener('mouseleave',() => { isDrag = false; });
  canvas.addEventListener('mousemove', e => {
    if (!isDrag) return;
    theta -= (e.clientX - lx) * 0.012;
    phi    = Math.max(0.15, Math.min(Math.PI / 2.1, phi - (e.clientY - ly) * 0.012));
    lx = e.clientX; ly = e.clientY;
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(0, TOTAL_H / 2, 0);
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    radius = Math.max(5, Math.min(200, radius * (1 + e.deltaY * 0.001)));
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(0, TOTAL_H / 2, 0);
  }, { passive: false });

  /* Touch support */
  let lastTouchDist = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { isDrag = true; lx = e.touches[0].clientX; ly = e.touches[0].clientY; }
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.hypot(dx, dy);
    }
  });
  canvas.addEventListener('touchend',   () => { isDrag = false; lastTouchDist = null; });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && isDrag) {
      theta -= (e.touches[0].clientX - lx) * 0.012;
      phi    = Math.max(0.15, Math.min(Math.PI / 2.1, phi - (e.touches[0].clientY - ly) * 0.012));
      lx = e.touches[0].clientX; ly = e.touches[0].clientY;
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(0, TOTAL_H / 2, 0);
    }
    if (e.touches.length === 2 && lastTouchDist !== null) {
      const dx   = e.touches[0].clientX - e.touches[1].clientX;
      const dy   = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      radius = Math.max(5, Math.min(200, radius * (lastTouchDist / dist)));
      lastTouchDist = dist;
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(0, TOTAL_H / 2, 0);
    }
  }, { passive: false });

  /* Animation loop */
  let animId;
  const animate = () => {
    animId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  };
  animate();

  /* Resize observer */
  const obs = new ResizeObserver(() => {
    const nW = canvas.clientWidth;
    const nH = canvas.clientHeight;
    renderer.setSize(nW, nH);
    camera.aspect = nW / nH;
    camera.updateProjectionMatrix();
  });
  obs.observe(canvas);

  /* Expose cleanup */
  renderer._cleanup = () => {
    cancelAnimationFrame(animId);
    obs.disconnect();
    renderer.dispose();
  };

  return renderer;
}

/** Parse 'rgba(r,g,b,a)' → THREE.Color */
function GTA_parseColor(str) {
  const m = str.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!m) return new THREE.Color(0x224466);
  return new THREE.Color(+m[1] / 255, +m[2] / 255, +m[3] / 255);
}

/** Canvas-texture floor label sprite */
function GTA_addLabel(scene, text, x, y, z) {
  const cv  = document.createElement('canvas');
  cv.width  = 128; cv.height = 48;
  const ctx = cv.getContext('2d');
  ctx.fillStyle    = 'rgba(0,170,255,0.95)';
  ctx.font         = 'bold 30px monospace';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 24);

  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp  = new THREE.Sprite(mat);
  sp.position.set(x, y, z);
  sp.scale.set(3, 1.2, 1);
  scene.add(sp);
}
