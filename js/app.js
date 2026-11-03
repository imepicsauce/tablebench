/* TableBench — board & card visualizer: application logic (requires three.js r128, loaded in index.html) */
(() => {
  "use strict";

  /* =====================================================================
     Helpers & constants
     ===================================================================== */
  const $ = id => document.getElementById(id);
  const SCALE = 0.02;                              // scene units per mm
  const round = (v, d = 2) => { const m = 10 ** d; return Math.round(v * m) / m; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const setVal = (el, v) => { if (document.activeElement !== el) el.value = v; };  // never rewrite a field being typed in

  let unit = "mm";
  const mmToUnit = mm => unit === "mm" ? mm : mm / 25.4;
  const unitToMm = v => unit === "mm" ? v : v * 25.4;
  const fmtLen = (mm, d = 2) => unit === "mm" ? round(mm, d) : round(mm / 25.4, 3);

  const DEFAULT_EDGE = new THREE.Color(0xe7e2d6);
  const BOARD_EDGE   = new THREE.Color(0xcfc9ba);

  /* =====================================================================
     State
     ===================================================================== */
  const newArt   = () => ({ img: null, flip: false, zoom: 1, px: 0, py: 0 });
  const cloneArt = a => ({ img: a.img, flip: a.flip, zoom: a.zoom, px: a.px, py: a.py });
  const cloneSpec = s => ({ w: s.w, h: s.h, t: s.t, r: s.r, front: cloneArt(s.front), back: cloneArt(s.back), mat: { kind: s.mat.kind, k: s.mat.k } });

  const board = { w: 300, h: 300, t: 6, r: 8, art: newArt(), tex: null, texInfo: null, mat: { kind: "matte", k: 0.55 } };
  const template = { w: 63.5, h: 88.9, t: 0.30, r: 3.18, front: newArt(), back: newArt(), mat: { kind: "glossy", k: 0.55 } };
  const cards = [];
  let nextId = 1, selectedId = null;

  const BOARD_PRESETS = [
    { name: "Square 300",    w: 300, h: 300, t: 6,  r: 8 },
    { name: "Rect 400×300",  w: 400, h: 300, t: 8,  r: 10 },
    { name: "Large 600×450", w: 600, h: 450, t: 10, r: 12 },
  ];
  const CARD_PRESETS = [
    { name: "Poker", w: 63.5, h: 88.9, t: 0.30, r: 3.18 },
    { name: "Tarot", w: 70,   h: 120,  t: 0.32, r: 4.0 },
    { name: "Mini",  w: 44,   h: 67,   t: 0.28, r: 2.5 },
  ];

  const selectedRec = () => cards.find(c => c.id === selectedId) || null;
  const targetSpec  = () => { const r = selectedRec(); return r ? r.spec : template; };

  /* =====================================================================
     Images — downscaled to canvases so many cards stay light on memory
     ===================================================================== */
  let imgCounter = 0;
  function loadImageInfo(file, maxDim) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = e => {
        const im = new Image();
        im.onerror = reject;
        im.onload = () => {
          const k = Math.min(1, maxDim / Math.max(im.naturalWidth, im.naturalHeight));
          const w = Math.max(1, Math.round(im.naturalWidth * k));
          const h = Math.max(1, Math.round(im.naturalHeight * k));
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(im, 0, 0, w, h);
          const tk = 96 / Math.max(w, h);
          const tc = document.createElement("canvas");
          tc.width = Math.max(1, Math.round(w * tk)); tc.height = Math.max(1, Math.round(h * tk));
          tc.getContext("2d").drawImage(c, 0, 0, tc.width, tc.height);
          resolve({ id: ++imgCounter, canvas: c, w, h, name: file.name, thumb: tc.toDataURL(), edge: null });
        };
        im.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function edgeColor(info) {
    if (info.edge) return info.edge;
    const s = 48, c = document.createElement("canvas"); c.width = c.height = s;
    const ctx = c.getContext("2d"); ctx.drawImage(info.canvas, 0, 0, s, s);
    let r = 0, g = 0, b = 0, n = 0;
    try {
      const d = ctx.getImageData(0, 0, s, s).data;
      for (let i = 0; i < s; i++) {
        for (const [x, y] of [[i, 0], [i, s - 1], [0, i], [s - 1, i]]) {
          const k = (y * s + x) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
        }
      }
      r /= n; g /= n; b /= n;
    } catch (e) { r = 231; g = 226; b = 214; }
    const lift = ch => Math.min(255, ch * 0.55 + 255 * 0.35) / 255;
    info.edge = new THREE.Color(lift(r), lift(g), lift(b));
    return info.edge;
  }

  /* =====================================================================
     Three.js scene
     ===================================================================== */
  const viewportEl = $("viewport");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.02, 200);
  camera.rotation.order = "YXZ";
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  viewportEl.appendChild(renderer.domElement);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  scene.add(new THREE.AmbientLight(0x404550, 1.15));
  const keyLight = new THREE.DirectionalLight(0xfff2df, 1.3);
  keyLight.position.set(6, 10, 7);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  Object.assign(keyLight.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
  keyLight.shadow.radius = 5; keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.01;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xd4a24e, 0.55); rimLight.position.set(-7, 3, -6); scene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0x6f8fb0, 0.32); fillLight.position.set(-4, -2, 6); scene.add(fillLight);

  const tablecloth = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({
      map: (() => {
        const c = document.createElement("canvas"); c.width = c.height = 512;
        const g = c.getContext("2d"), gr = g.createRadialGradient(256, 256, 20, 256, 256, 300);
        gr.addColorStop(0, "rgba(212,162,78,0.10)"); gr.addColorStop(0.6, "rgba(255,255,255,0.03)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
        return new THREE.CanvasTexture(c);
      })(),
      transparent: true, roughness: 1, metalness: 0
    })
  );
  tablecloth.rotation.x = -Math.PI / 2;
  tablecloth.receiveShadow = true;
  scene.add(tablecloth);

  const cardsGroup = new THREE.Group();
  scene.add(cardsGroup);

  /* ---------- Rounded-rect slab geometry (shared by board & cards) ---------- */
  function buildRoundedGeometry(w, h, t, r, segs) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2 - 0.0001));
    const hw = w / 2, hh = h / 2;
    const outline = [];
    if (r < 1e-4) {
      outline.push([hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]);
    } else {
      [
        { cx: hw - r,  cy: hh - r,  base: 0 },
        { cx: -hw + r, cy: hh - r,  base: Math.PI / 2 },
        { cx: -hw + r, cy: -hh + r, base: Math.PI },
        { cx: hw - r,  cy: -hh + r, base: 1.5 * Math.PI },
      ].forEach(c => {
        for (let j = 0; j < segs; j++) {
          const a = c.base + (Math.PI / 2) * (j / segs);
          outline.push([c.cx + r * Math.cos(a), c.cy + r * Math.sin(a)]);
        }
      });
    }
    const n = outline.length, z0 = -t / 2, z1 = t / 2;
    const pos = [], uv = [], idx = [];

    for (let k = 0; k < n; k++) {                      // side wall
      pos.push(outline[k][0], outline[k][1], z0); uv.push(0, 0);
      pos.push(outline[k][0], outline[k][1], z1); uv.push(0, 1);
    }
    for (let k = 0; k < n; k++) {
      const b = 2 * k, nb = 2 * ((k + 1) % n);
      idx.push(b, nb, nb + 1, b, nb + 1, b + 1);
    }
    const sideCount = idx.length;

    const fBase = pos.length / 3;                      // front cap (+z)
    pos.push(0, 0, z1); uv.push(0.5, 0.5);
    for (let k = 0; k < n; k++) { pos.push(outline[k][0], outline[k][1], z1); uv.push((outline[k][0] + hw) / w, (outline[k][1] + hh) / h); }
    const fStart = idx.length;
    for (let k = 0; k < n; k++) idx.push(fBase, fBase + 1 + k, fBase + 1 + (k + 1) % n);
    const fCount = idx.length - fStart;

    const bBase = pos.length / 3;                      // back cap (−z) — u mirrored so art reads correctly from behind
    pos.push(0, 0, z0); uv.push(0.5, 0.5);
    for (let k = 0; k < n; k++) { pos.push(outline[k][0], outline[k][1], z0); uv.push(1 - (outline[k][0] + hw) / w, (outline[k][1] + hh) / h); }
    const bStart = idx.length;
    for (let k = 0; k < n; k++) idx.push(bBase, bBase + 1 + (k + 1) % n, bBase + 1 + k);
    const bCount = idx.length - bStart;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.addGroup(0, sideCount, 0);
    geo.addGroup(fStart, fCount, 1);
    geo.addGroup(bStart, bCount, 2);
    geo.computeVertexNormals();
    geo.userData.outline = outline;
    return geo;
  }

  /* ---------- Textures ---------- */
  function makeTex(info) {
    const t = new THREE.Texture(info.canvas);
    t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    return t;
  }

  // "cover" fit + zoom + shift (like CSS object-fit:cover / object-position) via texture repeat/offset.
  // px/py are −100..100: positive moves the image right / down. Image always fully covers the face.
  function applyArtTransform(tex, art, w, h) {
    const ia = art.img.w / art.img.h, ta = w / h;
    let vx = 1, vy = 1;
    if (ia > ta) vx = ta / ia; else vy = ia / ta;
    vx /= art.zoom; vy /= art.zoom;
    const sgn = art.flip ? -1 : 1;
    const px = art.px / 100, py = art.py / 100;
    tex.repeat.set(vx * sgn, vy);
    tex.offset.set(0.5 - 0.5 * vx * sgn - px * ((1 - vx) / 2) * sgn,
                   0.5 - 0.5 * vy + py * ((1 - vy) / 2));
  }

  const phCache = new Map();
  function placeholderTex(kind, w, h) {
    const aspect = Math.max(0.25, Math.min(4, w / h));
    const key = kind + "|" + round(aspect, 1);
    if (phCache.has(key)) return phCache.get(key);
    if (phCache.size > 14) { const k0 = phCache.keys().next().value; phCache.get(k0).dispose(); phCache.delete(k0); }

    const long = kind === "board" ? 1024 : 512;
    const cw = aspect >= 1 ? long : Math.round(long * aspect);
    const ch = aspect >= 1 ? Math.round(long / aspect) : long;
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const g = c.getContext("2d");
    const pal = { front: ["#3a3f52", "#1e212b"], back: ["#4a3826", "#211a14"], board: ["#33413a", "#1c2622"], under: ["#2b2b2b", "#161616"] }[kind];
    const gr = g.createLinearGradient(0, 0, cw, ch); gr.addColorStop(0, pal[0]); gr.addColorStop(1, pal[1]);
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    const m = Math.round(Math.min(cw, ch) * 0.05);
    if (kind === "board") {
      g.strokeStyle = "rgba(255,255,255,0.09)"; g.lineWidth = 2;
      const step = long / 12;
      for (let x = 0; x <= cw; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, ch); g.stroke(); }
      for (let y = 0; y <= ch; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); }
      g.strokeStyle = "rgba(212,162,78,0.5)"; g.lineWidth = 4;
    } else {
      g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = Math.max(2, m * 0.12);
    }
    if (kind !== "under") {
      g.strokeRect(m, m, cw - 2 * m, ch - 2 * m);
      const fs = Math.round(Math.min(cw, ch) * (kind === "board" ? 0.07 : 0.1));
      g.fillStyle = "rgba(255,255,255,0.75)"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = `600 ${fs}px "Barlow Condensed", sans-serif`;
      g.fillText(kind === "board" ? "BOARD SURFACE" : kind.toUpperCase(), cw / 2, ch / 2 - fs * 0.35);
      g.font = `400 ${Math.round(fs * 0.36)}px "JetBrains Mono", monospace`;
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.fillText("upload artwork to replace", cw / 2, ch / 2 + fs * 0.55);
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = maxAniso;
    phCache.set(key, t);
    return t;
  }

  /* =====================================================================
     Surface materials: matte · glossy · textured · holographic
     ===================================================================== */
  const lerp = (a, b, k) => a + (b - a) * k;

  // Procedural studio reflection map (softboxes on a dark gradient) so glossy / foil surfaces have something to reflect.
  const envTex = (() => {
    try {
      const sc = new THREE.Scene();
      const cv = document.createElement("canvas"); cv.width = 8; cv.height = 256;
      const g = cv.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, "#667289"); gr.addColorStop(0.5, "#2c3240"); gr.addColorStop(1, "#101216");
      g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
      const skyTex = new THREE.CanvasTexture(cv); skyTex.encoding = THREE.sRGBEncoding;
      sc.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })));
      const box = (w, h, x, y, z, r, gg, b) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(r, gg, b), side: THREE.DoubleSide }));
        m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m);
      };
      box(40, 22, 0, 48, 0, 0.9, 0.9, 1.0);          // overhead fill
      box(16, 9, -26, 30, -32, 2.4, 2.3, 2.1);       // key (behind-left of the default view)
      box(6, 26, 38, 16, 30, 1.3, 1.4, 1.7);         // cool strip
      box(7, 22, -42, 12, 20, 1.5, 1.2, 0.9);        // warm strip
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromScene(sc, 0.03); pm.dispose();
      return rt.texture;
    } catch (e) { console.warn("env map unavailable", e); return null; }
  })();

  // Fine linen weave height map, tiled in physical units (not tied to artwork zoom/shift)
  const grainTex = (() => {
    const N = 128, c = document.createElement("canvas"); c.width = c.height = N;
    const g = c.getContext("2d"), img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const cell = 8, over = (((x / cell) | 0) + ((y / cell) | 0)) & 1;
      const fx = (x % cell) / cell, fy = (y % cell) / cell;
      const v = clamp(0.22 + 0.58 * (over ? Math.sin(Math.PI * fx) : Math.sin(Math.PI * fy)) + (Math.random() - 0.5) * 0.12, 0, 1) * 255;
      const k = (y * N + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    return t;
  })();

  const HOLO_GLSL = `
    if (uHolo > 0.5) {
      vec3 Vv = normalize(vViewPosition);
      float ndv = clamp(dot(normalize(normal), Vv), 0.0, 1.0);
      float ph = (1.0 - ndv) * 2.4 + vRawUv.x * 0.7 + vRawUv.y * 0.5;
      vec3 rb = 0.5 + 0.5 * cos(6.28318 * (ph + vec3(0.0, 0.33, 0.67)));
      float band = 0.5 + 0.5 * sin(ph * 14.0 + vRawUv.x * 9.0);
      vec2 cell = floor(vRawUv * uTile);
      float rnd = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      float dotMask = smoothstep(0.5, 0.12, length(fract(vRawUv * uTile) - 0.5));
      float spark = smoothstep(0.9, 1.0, fract(rnd + ph * 1.7)) * dotMask;
      float st = uHoloStrength;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.55 + 0.9 * rb), 0.55 * st);
      totalEmissiveRadiance += rb * (0.10 + 0.22 * band) * st * (0.4 + 0.6 * (1.0 - ndv));
      totalEmissiveRadiance += vec3(1.0) * spark * 0.45 * st;
    }`;

  // Physical material with a small shader hook: raw-UV varying, tiled bump in physical units, holographic foil.
  function makeSurfaceMat(params) {
    const mat = new THREE.MeshPhysicalMaterial(params);
    const U = mat.userData.surf = { uHolo: { value: 0 }, uHoloStrength: { value: 0.6 }, uTile: { value: new THREE.Vector2(10, 10) } };
    mat.envMap = envTex;
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vRawUv;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRawUv = uv;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vRawUv;\nuniform float uHolo;\nuniform float uHoloStrength;\nuniform vec2 uTile;")
        .replace("#include <bumpmap_pars_fragment>", THREE.ShaderChunk.bumpmap_pars_fragment.replace(/vUv/g, "(vRawUv * uTile)"))
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + HOLO_GLSL);
    };
    return mat;
  }

  const HOLO_CELL_MM = 0.9;
  function applySurface(mat, m, wmm, hmm, tileMM) {
    const U = mat.userData.surf, k = clamp(m.k, 0, 1), hadBump = !!mat.bumpMap;
    mat.metalness = 0.02; mat.clearcoat = 0; mat.clearcoatRoughness = 0.1; mat.bumpMap = null; U.uHolo.value = 0;
    switch (m.kind) {
      case "glossy":
        mat.roughness = lerp(0.40, 0.05, k); mat.clearcoat = 1; mat.clearcoatRoughness = lerp(0.30, 0.02, k);
        mat.envMapIntensity = lerp(0.35, 1.0, k); break;
      case "textured":
        mat.roughness = 0.8; mat.envMapIntensity = 0.2;
        mat.bumpMap = grainTex; mat.bumpScale = lerp(0.004, 0.03, k); U.uTile.value.set(wmm / tileMM, hmm / tileMM); break;
      case "holo":
        mat.roughness = lerp(0.40, 0.20, k); mat.metalness = lerp(0.15, 0.50, k);
        mat.clearcoat = 0.5; mat.clearcoatRoughness = 0.1; mat.envMapIntensity = lerp(0.5, 1.1, k);
        U.uHolo.value = 1; U.uHoloStrength.value = lerp(0.25, 1.2, k); U.uTile.value.set(wmm / HOLO_CELL_MM, hmm / HOLO_CELL_MM); break;
      default:  // matte
        mat.roughness = 0.93; mat.envMapIntensity = 0.12;
    }
    if (hadBump !== !!mat.bumpMap) mat.needsUpdate = true;
  }

  /* =====================================================================
     Board
     ===================================================================== */
  const boardGroup = new THREE.Group();
  boardGroup.rotation.x = -Math.PI / 2;
  scene.add(boardGroup);
  const boardEdgeMat   = new THREE.MeshStandardMaterial({ color: BOARD_EDGE, roughness: 0.7, metalness: 0.03 });
  const boardTopMat    = makeSurfaceMat({ roughness: 0.75, metalness: 0.02 });
  const boardBottomMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.02 });
  let boardMesh = null, boardTopY = 0.06, cameraTargetY = 0.06;

  function refreshBoardArt() {
    const a = board.art;
    if (a.img) {
      if (!board.tex || board.texInfo !== a.img) {
        if (board.tex) board.tex.dispose();
        board.tex = makeTex(a.img); board.texInfo = a.img;
      }
      applyArtTransform(board.tex, a, board.w, board.h);
      boardTopMat.map = board.tex;
      boardEdgeMat.color.copy(edgeColor(a.img));
    } else {
      if (board.tex) { board.tex.dispose(); board.tex = null; board.texInfo = null; }
      boardTopMat.map = placeholderTex("board", board.w, board.h);
      boardEdgeMat.color.copy(BOARD_EDGE);
    }
    boardBottomMat.map = placeholderTex("under", board.w, board.h);
    applySurface(boardTopMat, board.mat, board.w, board.h, 12);
    boardTopMat.needsUpdate = boardBottomMat.needsUpdate = boardEdgeMat.needsUpdate = true;
  }

  function rebuildBoard() {
    const w = board.w * SCALE, h = board.h * SCALE, t = Math.max(board.t * SCALE, 0.02), r = board.r * SCALE;
    if (boardMesh) { boardGroup.remove(boardMesh); boardMesh.geometry.dispose(); }
    boardMesh = new THREE.Mesh(buildRoundedGeometry(w, h, t, r, 16), [boardEdgeMat, boardTopMat, boardBottomMat]);
    boardMesh.castShadow = true; boardMesh.receiveShadow = true;
    boardGroup.add(boardMesh);
    refreshBoardArt();

    boardTopY = cameraTargetY = t / 2;
    tablecloth.position.y = -t / 2 - 0.01;
    cards.forEach(placeCard);
    updateStacking();
    updateCornerMarks();
    updateSpecChips();
  }

  function updateCornerMarks() {
    const frac = Math.min(board.w, board.h) > 0 ? board.r / (Math.min(board.w, board.h) / 2) : 0;
    const px = Math.round(2 + clamp(frac, 0, 1) * 14);
    const map = { tl: "top-left", tr: "top-right", bl: "bottom-left", br: "bottom-right" };
    Object.keys(map).forEach(k => document.querySelector(".corner-mark." + k).style.setProperty("border-" + map[k] + "-radius", px + "px"));
  }

  /* =====================================================================
     Cards
     ===================================================================== */
  const ringMat = new THREE.LineBasicMaterial({ color: 0xd4a24e });

  function makeRing(outline, z) {
    const a = new Float32Array(outline.length * 3);
    outline.forEach((p, i) => { a[i * 3] = p[0]; a[i * 3 + 1] = p[1]; a[i * 3 + 2] = 0; });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    const ring = new THREE.LineLoop(g, ringMat);
    ring.position.z = z;
    return ring;
  }

  function buildCard(spec, x, z, rot, faceDown) {
    const rec = { id: nextId++, spec: cloneSpec(spec), x, z, rot, faceDown, texF: null, texB: null, infoF: null, infoB: null, ring: null };
    rec.edgeMat  = new THREE.MeshStandardMaterial({ color: DEFAULT_EDGE.clone(), roughness: 0.55, metalness: 0.05 });
    rec.frontMat = makeSurfaceMat({ roughness: 0.35, metalness: 0.06 });
    rec.backMat  = makeSurfaceMat({ roughness: 0.35, metalness: 0.06 });
    rec.pivot = new THREE.Group();
    rec.lay = new THREE.Group(); rec.lay.rotation.x = -Math.PI / 2;
    rec.flip = new THREE.Group();
    rec.mesh = new THREE.Mesh(new THREE.BufferGeometry(), [rec.edgeMat, rec.frontMat, rec.backMat]);
    rec.mesh.castShadow = true;
    rec.mesh.userData.cardId = rec.id;
    rec.pivot.add(rec.lay); rec.lay.add(rec.flip); rec.flip.add(rec.mesh);
    cardsGroup.add(rec.pivot);
    rebuildCardGeometry(rec);
    placeCard(rec);
    return rec;
  }

  function rebuildCardGeometry(rec) {
    const s = rec.spec, w = s.w * SCALE, h = s.h * SCALE, t = Math.max(s.t * SCALE, 0.0015), r = s.r * SCALE;
    rec.mesh.geometry.dispose();
    rec.mesh.geometry = buildRoundedGeometry(w, h, t, r, 10);
    if (rec.ring) { rec.lay.remove(rec.ring); rec.ring.geometry.dispose(); }
    rec.ring = makeRing(rec.mesh.geometry.userData.outline, t / 2 + 0.004);
    rec.ring.visible = rec.id === selectedId;
    rec.lay.add(rec.ring);
    rec.footprint = Math.max(w, h) / 2;
    refreshCardArt(rec);
  }

  function refreshCardArt(rec) {
    for (const side of ["front", "back"]) {
      const art = rec.spec[side], k = side === "front" ? "F" : "B", mat = side === "front" ? rec.frontMat : rec.backMat;
      if (art.img) {
        if (!rec["tex" + k] || rec["info" + k] !== art.img) {
          if (rec["tex" + k]) rec["tex" + k].dispose();
          rec["tex" + k] = makeTex(art.img); rec["info" + k] = art.img;
        }
        applyArtTransform(rec["tex" + k], art, rec.spec.w, rec.spec.h);
        mat.map = rec["tex" + k];
      } else {
        if (rec["tex" + k]) { rec["tex" + k].dispose(); rec["tex" + k] = null; rec["info" + k] = null; }
        mat.map = placeholderTex(side, rec.spec.w, rec.spec.h);
      }
      mat.needsUpdate = true;
    }
    rec.edgeMat.color.copy(rec.spec.front.img ? edgeColor(rec.spec.front.img) : DEFAULT_EDGE);
    applyCardSurface(rec);
  }
  function applyCardSurface(rec) {
    const sp = rec.spec;
    applySurface(rec.frontMat, sp.mat, sp.w, sp.h, 6);
    applySurface(rec.backMat, sp.mat, sp.w, sp.h, 6);
  }

  function placeCard(rec) {
    rec.pivot.position.x = rec.x * SCALE;
    rec.pivot.position.z = rec.z * SCALE;
    rec.pivot.rotation.y = -rec.rot * Math.PI / 180;       // rot is clockwise degrees seen from above
    rec.flip.rotation.y = rec.faceDown ? Math.PI : 0;
  }

  function updateStacking() {
    for (let i = 0; i < cards.length; i++) {
      const ci = cards[i];
      let lift = boardTopY + 0.01 + (ci.spec.t * SCALE) / 2;
      for (let j = 0; j < i; j++) {
        const cj = cards[j];
        const dist = Math.hypot(ci.x - cj.x, ci.z - cj.z) * SCALE;
        if (dist < (ci.footprint + cj.footprint) * 0.55) lift += cj.spec.t * SCALE + 0.004;
      }
      ci.pivot.position.y = lift;
    }
  }

  function addCard() {
    const n = cards.length, ang = n * 0.9, rad = Math.min(n * 4, Math.max(template.w, template.h) * 0.35);
    const rec = buildCard(template, Math.cos(ang) * rad, Math.sin(ang) * rad, 0, false);
    cards.push(rec);
    updateStacking();
    selectCard(rec.id);
    updateSpecChips();
  }

  function disposeCard(rec) {
    cardsGroup.remove(rec.pivot);
    rec.mesh.geometry.dispose();
    if (rec.ring) rec.ring.geometry.dispose();
    [rec.edgeMat, rec.frontMat, rec.backMat].forEach(m => m.dispose());
    if (rec.texF) rec.texF.dispose();
    if (rec.texB) rec.texB.dispose();
  }
  function removeCard(id) {
    const i = cards.findIndex(c => c.id === id); if (i < 0) return;
    disposeCard(cards[i]); cards.splice(i, 1);
    if (selectedId === id) selectedId = null;
    updateStacking(); syncEditor(); renderCardList(); updateSpecChips();
  }
  function duplicateCard(id) {
    const src = cards.find(c => c.id === id); if (!src) return;
    const rec = buildCard(src.spec, src.x + 12, src.z + 12, src.rot, src.faceDown);
    cards.push(rec); updateStacking(); selectCard(rec.id); updateSpecChips();
  }
  function rotateCard(id) {
    const rec = cards.find(c => c.id === id); if (!rec) return;
    rec.rot = (rec.rot + 90) % 360; placeCard(rec); renderCardList();
  }
  function flipCard(id) {
    const rec = cards.find(c => c.id === id); if (!rec) return;
    rec.faceDown = !rec.faceDown; placeCard(rec); renderCardList();
  }
  function moveCard(rec, x, z) {
    const lim = Math.max(board.w, board.h) * 0.9 + 200;
    rec.x = clamp(x, -lim, lim); rec.z = clamp(z, -lim, lim);
    placeCard(rec); updateStacking();
  }

  function selectCard(id) {
    selectedId = id;
    cards.forEach(c => { if (c.ring) c.ring.visible = c.id === id; });
    syncEditor(); renderCardList();
  }

  /* =====================================================================
     UI: art controls (upload + position/zoom)
     ===================================================================== */
  function buildArtControl(mount, { label, maxDim, getArt, onChange }) {
    mount.classList.add("art");
    mount.innerHTML = `
      <div class="drop" tabindex="0" role="button" aria-label="Upload ${label} image">
        <div class="thumb">＋</div>
        <div class="meta"><div class="name"></div><div class="sub">Click or drop an image</div></div>
        <div class="drop-actions">
          <button class="icon-btn flip" type="button" title="Mirror horizontally">⇋</button>
          <button class="icon-btn clear" type="button" title="Remove image">✕</button>
        </div>
        <input type="file" accept="image/*" hidden>
      </div>
      <details class="adjust">
        <summary>Position &amp; zoom</summary>
        <div class="adj-body">
          <div class="adj-row"><span>Zoom</span><input type="range" class="zoom" min="1" max="5" step="0.01" value="1"><output>1.00×</output></div>
          <div class="adj-row"><span>Shift X</span><input type="range" class="px" min="-100" max="100" step="1" value="0"><output>0</output></div>
          <div class="adj-row"><span>Shift Y</span><input type="range" class="py" min="-100" max="100" step="1" value="0"><output>0</output></div>
          <button class="mini-btn reset" type="button">Reset position</button>
        </div>
      </details>`;
    const q = s => mount.querySelector(s);
    const drop = q(".drop"), thumb = q(".thumb"), nameEl = q(".name"), subEl = q(".sub"), file = q("input[type=file]");
    const flipBtn = q(".flip"), clearBtn = q(".clear"), adjust = q(".adjust");
    const zoom = q(".zoom"), px = q(".px"), py = q(".py"), resetBtn = q(".reset");
    const outs = { zoom: zoom.nextElementSibling, px: px.nextElementSibling, py: py.nextElementSibling };

    function refresh() {
      const a = getArt(), has = !!a.img;
      thumb.style.backgroundImage = has ? `url(${a.img.thumb})` : "";
      thumb.textContent = has ? "" : "＋";
      nameEl.textContent = has ? a.img.name : label;
      subEl.textContent = has ? `${a.img.w}×${a.img.h}px` : "Click or drop an image";
      flipBtn.classList.toggle("on", a.flip);
      flipBtn.disabled = clearBtn.disabled = !has;
      adjust.classList.toggle("disabled", !has);
      setVal(zoom, a.zoom); setVal(px, a.px); setVal(py, a.py);
      outs.zoom.textContent = a.zoom.toFixed(2) + "×";
      outs.px.textContent = (a.px > 0 ? "+" : "") + Math.round(a.px);
      outs.py.textContent = (a.py > 0 ? "+" : "") + Math.round(a.py);
    }

    async function handle(f) {
      if (!f || f.type.indexOf("image") !== 0) return;
      try {
        const info = await loadImageInfo(f, maxDim);
        const a = getArt(); a.img = info; a.zoom = 1; a.px = 0; a.py = 0;
        onChange(); refresh();
        adjust.open = true;
      } catch (e) { nameEl.textContent = "Couldn't read that image"; }
    }

    drop.addEventListener("click", e => { if (!e.target.closest(".drop-actions")) file.click(); });
    drop.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === drop) { e.preventDefault(); file.click(); } });
    file.addEventListener("change", () => { handle(file.files[0]); file.value = ""; });
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("dragover"); }));
    drop.addEventListener("drop", e => handle(e.dataTransfer.files && e.dataTransfer.files[0]));

    flipBtn.addEventListener("click", e => { e.stopPropagation(); const a = getArt(); a.flip = !a.flip; onChange(); refresh(); });
    clearBtn.addEventListener("click", e => { e.stopPropagation(); const a = getArt(); a.img = null; a.zoom = 1; a.px = 0; a.py = 0; a.flip = false; onChange(); refresh(); });
    [[zoom, "zoom"], [px, "px"], [py, "py"]].forEach(([el, key]) => el.addEventListener("input", () => {
      getArt()[key] = parseFloat(el.value); onChange(); refresh();
    }));
    resetBtn.addEventListener("click", () => { const a = getArt(); a.zoom = 1; a.px = 0; a.py = 0; onChange(); refresh(); });

    return { refresh };
  }

  const boardArtCtl = buildArtControl($("boardArt"), {
    label: "Board surface", maxDim: 2048,
    getArt: () => board.art,
    onChange: () => { refreshBoardArt(); }
  });
  const frontArtCtl = buildArtControl($("cardFrontArt"), {
    label: "Front face", maxDim: 1024,
    getArt: () => targetSpec().front,
    onChange: () => commitEdit("front")
  });
  const backArtCtl = buildArtControl($("cardBackArt"), {
    label: "Back face", maxDim: 1024,
    getArt: () => targetSpec().back,
    onChange: () => commitEdit("back")
  });

  const MATERIALS = [
    { id: "matte",    name: "Matte",       knob: null,             desc: "Flat finish with soft, diffuse light and no glare." },
    { id: "glossy",   name: "Glossy",      knob: "Gloss",          desc: "Clear-coated surface with sharp reflections." },
    { id: "textured", name: "Textured",    knob: "Texture depth",  desc: "Linen-style embossing that catches raking light." },
    { id: "holo",     name: "Holographic", knob: "Foil intensity", desc: "Rainbow foil that shifts as you tilt or orbit." },
  ];
  function buildMaterialControl(mount, { label, getMat, onChange }) {
    mount.classList.add("mat");
    mount.innerHTML = `
      <div class="field"><label>${label}</label></div>
      <div class="presets"></div>
      <p class="foot-note mat-desc"></p>
      <div class="field">
        <label><span class="knob">Strength</span> <span class="cap val"></span></label>
        <input type="range" min="0" max="100" step="1" value="55">
      </div>`;
    const grid = mount.querySelector(".presets"), desc = mount.querySelector(".mat-desc");
    const knob = mount.querySelector(".knob"), val = mount.querySelector(".val"), range = mount.querySelector("input[type=range]");
    MATERIALS.forEach(m => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "preset-btn"; b.textContent = m.name; b.dataset.id = m.id;
      b.addEventListener("click", () => { getMat().kind = m.id; onChange(); refresh(); });
      grid.appendChild(b);
    });
    range.addEventListener("input", () => { getMat().k = parseFloat(range.value) / 100; onChange(); refresh(); });
    function refresh() {
      const m = getMat(), def = MATERIALS.find(x => x.id === m.kind);
      Array.from(grid.children).forEach(b => b.classList.toggle("active", b.dataset.id === m.kind));
      desc.textContent = def.desc;
      knob.textContent = def.knob || "Strength";
      range.disabled = !def.knob;
      setVal(range, Math.round(m.k * 100));
      val.textContent = def.knob ? Math.round(m.k * 100) : "—";
    }
    refresh();
    return { refresh };
  }
  const boardMatCtl = buildMaterialControl($("boardMat"), { label: "Board material", getMat: () => board.mat, onChange: () => refreshBoardArt() });
  const cardMatCtl  = buildMaterialControl($("cardMat"),  { label: "Card material",  getMat: () => targetSpec().mat, onChange: () => commitEdit("mat") });

  /* =====================================================================
     UI: dimensions, presets, editor sync
     ===================================================================== */
  function buildPresets(mount, presets, apply) {
    [...presets, { name: "Custom", custom: true }].forEach(p => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "preset-btn"; b.textContent = p.name;
      b.dataset.name = p.name;
      b.addEventListener("click", () => { if (!p.custom) apply(p); });
      mount.appendChild(b);
    });
  }
  function highlightPreset(mount, presets, s) {
    const hit = presets.find(p => Math.abs(p.w - s.w) < 0.01 && Math.abs(p.h - s.h) < 0.01 && Math.abs(p.t - s.t) < 0.005 && Math.abs(p.r - s.r) < 0.01);
    Array.from(mount.children).forEach(b => b.classList.toggle("active", b.dataset.name === (hit ? hit.name : "Custom")));
  }

  // Board inputs
  const bW = $("boardW"), bH = $("boardH"), bT = $("boardT"), bRS = $("boardRSlider"), bRI = $("boardRInput");
  const boardMaxR = () => Math.max(0, Math.min(board.w, board.h) / 2 - 0.5);

  function syncBoardUI() {
    setVal(bW, fmtLen(board.w, 1)); setVal(bH, fmtLen(board.h, 1)); setVal(bT, fmtLen(board.t, 2));
    const mx = mmToUnit(boardMaxR());
    bRS.max = round(mx, 3); bRS.step = mx > 3 ? 0.5 : 0.01;
    setVal(bRI, fmtLen(board.r, 2)); setVal(bRS, round(mmToUnit(board.r), 3));
    $("boardRMax").textContent = "max " + round(mx, 1) + " " + unit;
    [bW, bH, bT, bRI].forEach(el => el.step = unit === "mm" ? "any" : "any");
    highlightPreset($("boardPresets"), BOARD_PRESETS, board);
  }
  function boardChanged() { board.r = Math.min(board.r, boardMaxR()); syncBoardUI(); rebuildBoard(); }
  [[bW, "w", 30], [bH, "h", 30], [bT, "t", 1]].forEach(([el, key, min]) => el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    if (!isNaN(v) && v > 0) { board[key] = Math.max(min, unitToMm(v)); boardChanged(); }
  }));
  [[bW, 30], [bH, 30], [bT, 1]].forEach(([el]) => el.addEventListener("change", syncBoardUI));
  const setBoardR = v => { if (!isNaN(v)) { board.r = clamp(unitToMm(v), 0, boardMaxR()); syncBoardUI(); rebuildBoard(); } };
  bRI.addEventListener("input", () => setBoardR(parseFloat(bRI.value)));
  bRI.addEventListener("change", syncBoardUI);
  bRS.addEventListener("input", () => setBoardR(parseFloat(bRS.value)));
  buildPresets($("boardPresets"), BOARD_PRESETS, p => { Object.assign(board, { w: p.w, h: p.h, t: p.t, r: p.r }); syncBoardUI(); rebuildBoard(); });

  // Card inputs (edit the selected card, or the template when nothing is selected)
  const cW = $("cardW"), cH = $("cardH"), cT = $("cardT"), cRS = $("cardRSlider"), cRI = $("cardRInput");
  const cardMaxR = s => Math.max(0, Math.min(s.w, s.h) / 2 - 0.05);

  function syncEditor() {
    const s = targetSpec(), rec = selectedRec();
    setVal(cW, fmtLen(s.w, 2)); setVal(cH, fmtLen(s.h, 2)); setVal(cT, fmtLen(s.t, 2));
    const mx = mmToUnit(cardMaxR(s));
    cRS.max = round(mx, 3); cRS.step = mx > 2 ? 0.05 : 0.01;
    setVal(cRI, fmtLen(s.r, 2)); setVal(cRS, round(mmToUnit(s.r), 3));
    $("cardRMax").textContent = "max " + round(mx, 2) + " " + unit;
    highlightPreset($("cardPresets"), CARD_PRESETS, s);
    frontArtCtl.refresh(); backArtCtl.refresh(); cardMatCtl.refresh();
    $("editBadge").textContent = rec ? "Card " + (cards.indexOf(rec) + 1) : "Template";
    $("deselectBtn").hidden = !rec;
    $("editNote").textContent = rec
      ? "Editing this card live. New cards start from these settings."
      : "Nothing selected — edits set up the template used by “Add card”.";
  }

  function commitEdit(kind) {                       // kind: "dims" | "front" | "back"
    const rec = selectedRec(), s = targetSpec();
    if (rec) {
      if (kind === "dims") rebuildCardGeometry(rec); else if (kind === "mat") applyCardSurface(rec); else refreshCardArt(rec);
      template.w = s.w; template.h = s.h; template.t = s.t; template.r = s.r;
      template.mat = { kind: s.mat.kind, k: s.mat.k };
      if (kind === "mat") { /* template already updated above */ }
      else if (kind !== "dims") template[kind] = cloneArt(s[kind]);
      else { template.front = cloneArt(s.front); template.back = cloneArt(s.back); }
      updateStacking(); renderCardList();
    }
    syncEditor(); updateSpecChips();
  }

  [[cW, "w", 10], [cH, "h", 10], [cT, "t", 0.05]].forEach(([el, key, min]) => {
    el.addEventListener("input", () => {
      const v = parseFloat(el.value), s = targetSpec();
      if (!isNaN(v) && v > 0) { s[key] = Math.max(min, unitToMm(v)); s.r = Math.min(s.r, cardMaxR(s)); commitEdit("dims"); }
    });
    el.addEventListener("change", syncEditor);
  });
  const setCardR = v => { if (!isNaN(v)) { const s = targetSpec(); s.r = clamp(unitToMm(v), 0, cardMaxR(s)); commitEdit("dims"); } };
  cRI.addEventListener("input", () => setCardR(parseFloat(cRI.value)));
  cRI.addEventListener("change", syncEditor);
  cRS.addEventListener("input", () => setCardR(parseFloat(cRS.value)));
  buildPresets($("cardPresets"), CARD_PRESETS, p => { const s = targetSpec(); Object.assign(s, { w: p.w, h: p.h, t: p.t, r: p.r }); commitEdit("dims"); });

  $("unitToggle").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || b.dataset.unit === unit) return;
    unit = b.dataset.unit;
    Array.from($("unitToggle").children).forEach(c => c.classList.toggle("active", c === b));
    syncBoardUI(); syncEditor();
  });

  $("deselectBtn").addEventListener("click", () => selectCard(null));
  $("addCardBtn").addEventListener("click", addCard);
  $("clearCardsBtn").addEventListener("click", () => { cards.slice().forEach(c => removeCard(c.id)); });

  /* ---------- Card list ---------- */
  const cardListEl = $("cardList");
  function renderCardList() {
    cardListEl.textContent = "";
    if (!cards.length) {
      const d = document.createElement("div");
      d.className = "empty-hint"; d.textContent = "No cards on the table yet. Add one above, then drag it around the board.";
      cardListEl.appendChild(d); return;
    }
    cards.forEach((rec, i) => {
      const row = document.createElement("div");
      row.className = "card-row" + (rec.id === selectedId ? " selected" : "");
      row.dataset.id = rec.id;
      const th = document.createElement("div"); th.className = "row-thumb";
      const art = rec.faceDown ? rec.spec.back : rec.spec.front;
      if (art.img) th.style.backgroundImage = `url(${art.img.thumb})`;
      const meta = document.createElement("div"); meta.className = "row-meta";
      const nm = document.createElement("div"); nm.className = "row-name"; nm.textContent = "Card " + (i + 1);
      const sb = document.createElement("div"); sb.className = "row-sub";
      sb.textContent = `${round(rec.spec.w, 1)}×${round(rec.spec.h, 1)} · ${rec.faceDown ? "down" : "up"} · ${rec.rot}°`;
      sb.title = sb.textContent;
      meta.append(nm, sb);
      const act = document.createElement("div"); act.className = "row-actions";
      [["rotate", "⟳", "Rotate 90°"], ["flip", "⇅", "Flip face up/down"], ["dup", "⧉", "Duplicate"], ["del", "✕", "Remove"]].forEach(([a, ch, title]) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "icon-btn"; b.dataset.action = a; b.title = title; b.textContent = ch; act.appendChild(b);
      });
      row.append(th, meta, act);
      cardListEl.appendChild(row);
    });
  }
  cardListEl.addEventListener("click", e => {
    const row = e.target.closest(".card-row"); if (!row) return;
    const id = parseInt(row.dataset.id, 10), btn = e.target.closest("[data-action]");
    if (btn) {
      ({ rotate: rotateCard, flip: flipCard, dup: duplicateCard, del: removeCard })[btn.dataset.action](id);
    } else selectCard(id);
  });

  function updateSpecChips() {
    const chips = $("specChips"); chips.textContent = "";
    [["W", round(board.w) + "mm"], ["H", round(board.h) + "mm"], ["T", round(board.t, 1) + "mm"], ["R", round(board.r, 1) + "mm"], ["CARDS", String(cards.length)]].forEach(([k, v]) => {
      const el = document.createElement("div"); el.className = "spec-chip";
      const b = document.createElement("b"); b.textContent = k; el.append(b, " " + v); chips.appendChild(el);
    });
  }

  /* =====================================================================
     Camera: orbit + freecam
     ===================================================================== */
  let yaw = 0.6, pitch = 0.85, dist = 16, targetYaw = yaw, targetPitch = pitch, targetDist = dist, velYaw = 0;
  let autoRotate = false, topView = false;

  const defaultDistance = () => Math.hypot(board.w * SCALE, board.h * SCALE) * 1.35 + 3;
  function applyCamera() {
    camera.position.set(dist * Math.sin(yaw) * Math.cos(pitch), cameraTargetY + dist * Math.sin(pitch), dist * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(0, cameraTargetY, 0);
  }

  // --- freecam state ---
  const ORBIT_FOV = 32;
  let freeMode = false, fSpeed = 6, keys = {};
  let fYaw = 0, fPitch = 0, tYaw = 0, tPitch = 0, fRoll = 0, fFov = ORBIT_FOV, tFov = ORBIT_FOV;   // f* = actual, t* = target
  const fPos = new THREE.Vector3(), vel = new THREE.Vector3();
  const cine = { smooth: true, amount: 0.6, sway: false, bars: false, loop: false, dur: 10 };
  let shot = null;
  const PITCH_LIM = Math.PI / 2 - 0.01;
  const freeForward = () => new THREE.Vector3(-Math.sin(fYaw) * Math.cos(fPitch), Math.sin(fPitch), -Math.cos(fYaw) * Math.cos(fPitch));
  const clampFree = () => { const m = boardTopY + 0.03; if (fPos.y < m) { fPos.y = m; if (vel.y < 0) vel.y = 0; } };
  const moveTau = () => 0.08 + cine.amount * 0.70;     // seconds to ease into / out of motion
  const lookTau = () => 0.04 + cine.amount * 0.30;     // seconds to ease the view toward where you point
  const easeSine  = u => 0.5 - 0.5 * Math.cos(Math.PI * u);
  const easeCubic = u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const easeOut   = u => 1 - Math.pow(1 - u, 3);
  const angDiff   = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  function dollyFree(amount) {
    stopShot();
    if (cine.smooth) {                                   // scroll becomes an impulse that glides to a stop
      vel.addScaledVector(freeForward(), amount / moveTau());
      const cap = fSpeed * 6; if (vel.length() > cap) vel.setLength(cap);
    } else { fPos.addScaledVector(freeForward(), amount); clampFree(); }
  }

  function syncFreeFromOrbit() {
    applyCamera();
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    fPos.copy(camera.position);
    fYaw = tYaw = Math.atan2(-d.x, -d.z); fPitch = tPitch = Math.asin(clamp(d.y, -1, 1));
    fRoll = 0; vel.set(0, 0, 0); fFov = tFov = camera.fov;
  }
  function syncOrbitFromFree() {
    const rel = fPos.clone().sub(new THREE.Vector3(0, cameraTargetY, 0)), len = Math.max(rel.length(), 0.0001);
    yaw = targetYaw = Math.atan2(rel.x, rel.z);
    pitch = targetPitch = clamp(Math.asin(clamp(rel.y / len, -1, 1)), 0.12, 1.5);
    dist = targetDist = clamp(len, 1, 60);
  }

  // glide: eased move to a pose (used by Reset view / Look straight down)
  function glideTo(pos, yawEnd, pitchEnd) {
    if (!cine.smooth) { fPos.copy(pos); fYaw = tYaw = yawEnd; fPitch = tPitch = pitchEnd; return; }
    stopShot(); vel.set(0, 0, 0);
    shot = { kind: "glide", silent: true, t: 0, dur: 1.8, p0: fPos.clone(), p1: pos.clone(), y0: fYaw, y1: yawEnd, e0: fPitch, e1: pitchEnd };
  }
  function resetFree() {
    const d = defaultDistance(), y0 = 0.6, p0 = 0.85;
    const pos = new THREE.Vector3(d * Math.sin(y0) * Math.cos(p0), cameraTargetY + d * Math.sin(p0), d * Math.cos(y0) * Math.cos(p0));
    const dir = new THREE.Vector3(0, cameraTargetY, 0).sub(pos).normalize();
    glideTo(pos, Math.atan2(-dir.x, -dir.z), Math.asin(dir.y));
  }
  function topDownFree() {
    glideTo(new THREE.Vector3(0, cameraTargetY + defaultDistance() * 0.95, 0.001), fYaw, -PITCH_LIM);
  }

  /* ---------- Camera moves ---------- */
  const SHOT_ORDER = ["orbit", "push", "crane", "slide", "reveal"];
  const SHOT_EASE = { orbit: easeSine, push: easeCubic, crane: easeSine, slide: easeSine, reveal: easeOut };

  function focusPoint() {
    const r = selectedRec();
    return r ? new THREE.Vector3(r.x * SCALE, boardTopY + 0.02, r.z * SCALE) : new THREE.Vector3(0, boardTopY, 0);
  }
  function shotPose(s, e, u) {
    const F = s.F, R = s.R, sx = Math.sin(s.az), cz = Math.cos(s.az), rx = cz, rz = -sx;
    const at = (d, y, side) => new THREE.Vector3(F.x + sx * d + rx * (side || 0), F.y + y, F.z + cz * d + rz * (side || 0));
    switch (s.kind) {
      case "orbit": { const a = s.az + Math.PI * 2 * (cine.loop ? u : e); return new THREE.Vector3(F.x + Math.sin(a) * s.horiz, F.y + s.h0, F.z + Math.cos(a) * s.horiz); }
      case "push":   return s.start.clone().lerp(at(Math.max(R * 0.2, 0.9), Math.max(R * 0.08, 0.35)), e);
      case "crane":  return at(R * 0.7 - R * 0.4 * e, 0.2 + R * 0.95 * e);
      case "slide":  return at(R * 0.55, 0.45 + Math.sin(Math.PI * e) * R * 0.12, -R * 0.7 + R * 1.4 * e);
      case "reveal": return at(Math.max(R * 0.18, 0.8) + R * e, 0.35 + R * 0.75 * e);
    }
    return s.start.clone();
  }
  function startShot(kind) {
    if (!freeMode) return;
    stopShot(); keys = {}; vel.set(0, 0, 0);
    const F = focusPoint(), R = Math.max(1.5, Math.hypot(board.w, board.h) * SCALE);
    const off = fPos.clone().sub(F); off.y = 0;
    const s = { kind, t: 0, dur: cine.dur, F, R, start: fPos.clone(), y0: fYaw, e0: fPitch,
      az: off.lengthSq() > 1e-6 ? Math.atan2(off.x, off.z) : 0.6,
      horiz: Math.max(off.length(), R * 0.35), h0: Math.max(fPos.y - F.y, 0.3) };
    s.p0 = shotPose(s, 0, 0);
    s.approach = s.p0.distanceTo(fPos) > 0.05 ? 1.3 : 0.7;      // glide into the opening frame first
    const d0 = F.clone().sub(s.p0);
    s.lookY = Math.atan2(-d0.x, -d0.z); s.lookP = Math.asin(clamp(d0.y / Math.max(d0.length(), 1e-4), -1, 1));
    shot = s; syncShotUI();
  }
  function runShot(dt) {
    const s = shot; s.t += dt;
    if (s.kind === "glide") {
      const u = Math.min(1, s.t / s.dur), e = easeSine(u);
      fPos.lerpVectors(s.p0, s.p1, e);
      fYaw = tYaw = s.y0 + angDiff(s.y1, s.y0) * e;
      fPitch = tPitch = s.e0 + (s.e1 - s.e0) * e;
      if (u >= 1) endShot();
      return;
    }
    let pos, yawT, pitchT;
    if (s.t < s.approach) {
      const e = easeSine(s.t / s.approach);
      pos = new THREE.Vector3().lerpVectors(s.start, s.p0, e);
      yawT = s.y0 + angDiff(s.lookY, s.y0) * e;
      pitchT = s.e0 + (s.lookP - s.e0) * e;
      shotProg(0);
    } else {
      const raw = (s.t - s.approach) / s.dur;
      let u;
      if (cine.loop) { if (s.kind === "orbit") u = raw % 1; else { const m = raw % 2; u = m < 1 ? m : 2 - m; } }
      else u = Math.min(1, raw);
      pos = shotPose(s, SHOT_EASE[s.kind](u), u);
      const d = s.F.clone().sub(pos), len = Math.max(d.length(), 1e-4);
      yawT = Math.atan2(-d.x, -d.z); pitchT = Math.asin(clamp(d.y / len, -1, 1));
      shotProg(cine.loop ? raw % 1 : u);
      if (!cine.loop && raw >= 1) { fPos.copy(pos); fYaw = tYaw = yawT; fPitch = tPitch = pitchT; endShot(); return; }
    }
    fPos.copy(pos); clampFree();
    fYaw = tYaw = yawT; fPitch = tPitch = pitchT;
  }
  function endShot() {
    if (!shot) return;
    shot = null; vel.set(0, 0, 0); tYaw = fYaw; tPitch = fPitch; fRoll = 0;
    syncShotUI();
  }
  function stopShot() { endShot(); }
  function shotProg(f) { $("shotProg").style.width = (f * 100).toFixed(1) + "%"; }
  function syncShotUI() {
    document.querySelectorAll("[data-shot]").forEach(b => b.classList.toggle("running", !!shot && !shot.silent && shot.kind === b.dataset.shot));
    $("stopShotBtn").disabled = !(shot && !shot.silent);
    if (!shot) shotProg(0);
  }

  /* ---------- Cinematic UI state ---------- */
  function applyCineUI() {
    $("cineSmoothBtn").classList.toggle("on", cine.smooth);
    $("cineSwayBtn").classList.toggle("on", cine.sway);
    $("cineBarsBtn").classList.toggle("on", cine.bars);
    $("loopBtn").classList.toggle("on", cine.loop);
    $("cineAmt").disabled = !cine.smooth;
    $("stage").classList.toggle("letterbox", freeMode && cine.bars);
    $("stageMode").textContent = !freeMode ? "live render" : (cine.smooth ? "freecam · cinematic" : "freecam");
  }
  function toggleSmooth() {
    cine.smooth = !cine.smooth;
    if (!cine.smooth) { vel.set(0, 0, 0); fYaw = tYaw; fPitch = tPitch; fRoll = 0; fFov = tFov; }
    applyCineUI();
  }

  function updateHint() {
    $("hintText").textContent = freeMode
      ? "FREECAM · drag to look · WASD move · Q/E down/up · Shift boost · C smooth · 1–5 camera moves · Esc exit"
      : "drag empty space to orbit · drag a card to move it · scroll to zoom";
  }
  function setFreeMode(on) {
    if (on === freeMode) return;
    if (on) {
      syncFreeFromOrbit();
      $("fov").value = Math.round(fFov); $("fovVal").textContent = Math.round(fFov) + "°";
    } else {
      stopShot(); keys = {}; vel.set(0, 0, 0);
      syncOrbitFromFree();
      camera.fov = ORBIT_FOV; camera.updateProjectionMatrix(); fFov = tFov = ORBIT_FOV;
    }
    freeMode = on;
    $("freeCamBtn").classList.toggle("on", on);
    $("freePanel").classList.toggle("show", on);
    $("autoRotateBtn").classList.toggle("dim", on);
    $("crosshair").classList.toggle("show", on);
    viewportEl.classList.toggle("free", on);
    $("topViewBtn").classList.toggle("on", !on && topView);
    applyCineUI(); updateHint();
  }

  function updateFree(dt) {
    if (shot) {
      runShot(dt);
    } else {
      const spd = fSpeed * (keys.shift ? 3 : 1);
      const fwd = freeForward(), right = new THREE.Vector3(Math.cos(fYaw), 0, -Math.sin(fYaw));
      const want = new THREE.Vector3();
      if (keys.w || keys.arrowup)    want.add(fwd);
      if (keys.s || keys.arrowdown)  want.sub(fwd);
      if (keys.d || keys.arrowright) want.add(right);
      if (keys.a || keys.arrowleft)  want.sub(right);
      if (keys.e) want.y += 1;
      if (keys.q) want.y -= 1;
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(spd);
      if (cine.smooth) {
        vel.lerp(want, 1 - Math.exp(-dt / moveTau()));                 // inertia: ramp up, then coast to a stop
        const ka = 1 - Math.exp(-dt / lookTau());
        fYaw += (tYaw - fYaw) * ka; fPitch += (tPitch - fPitch) * ka;  // view trails the mouse
      } else { vel.copy(want); fYaw = tYaw; fPitch = tPitch; }
      if (vel.lengthSq() < 1e-7) vel.set(0, 0, 0);
      fPos.addScaledVector(vel, dt);
      clampFree();
    }
    // lens
    fFov = cine.smooth ? fFov + (tFov - fFov) * (1 - Math.exp(-dt / (0.08 + cine.amount * 0.35))) : tFov;
    if (Math.abs(camera.fov - fFov) > 0.005) { camera.fov = fFov; camera.updateProjectionMatrix(); }
    // bank gently into turns
    const rollT = cine.smooth && !shot ? clamp((tYaw - fYaw) * 0.6, -0.08, 0.08) : 0;
    fRoll += (rollT - fRoll) * (1 - Math.exp(-dt / 0.22));
    // handheld drift (render-only offsets; never accumulates into the pose)
    let rp = 0, ry = 0, rr = 0, ox = 0, oy = 0;
    if (cine.sway) {
      const t = performance.now() / 1000;
      rp = (Math.sin(t * 0.9 + 0.5) + 0.5 * Math.sin(t * 2.3)) * 0.0035;
      ry = (Math.sin(t * 0.7) + 0.5 * Math.sin(t * 1.9 + 1.3)) * 0.004;
      rr = Math.sin(t * 0.6 + 2) * 0.006;
      ox = Math.sin(t * 0.8 + 1) * 0.006; oy = Math.sin(t * 1.1) * 0.005;
    }
    camera.position.set(fPos.x + ox, fPos.y + oy, fPos.z);
    camera.rotation.set(fPitch + rp, fYaw + ry, fRoll + rr, "YXZ");
  }

  $("freeCamBtn").addEventListener("click", function () { setFreeMode(!freeMode); this.blur(); });
  $("flySpeed").addEventListener("input", function () { fSpeed = parseFloat(this.value); $("flySpeedVal").textContent = fSpeed; });
  $("fov").addEventListener("input", function () { tFov = parseFloat(this.value); $("fovVal").textContent = tFov + "°"; });
  $("cineAmt").addEventListener("input", function () { cine.amount = parseFloat(this.value) / 100; $("cineAmtVal").textContent = this.value; });
  $("shotDur").addEventListener("input", function () { cine.dur = parseFloat(this.value); $("shotDurVal").textContent = cine.dur + " s"; });
  $("cineSmoothBtn").addEventListener("click", function () { toggleSmooth(); this.blur(); });
  $("cineSwayBtn").addEventListener("click", function () { cine.sway = !cine.sway; applyCineUI(); this.blur(); });
  $("cineBarsBtn").addEventListener("click", function () { cine.bars = !cine.bars; applyCineUI(); this.blur(); });
  $("loopBtn").addEventListener("click", function () { cine.loop = !cine.loop; applyCineUI(); this.blur(); });
  $("stopShotBtn").addEventListener("click", function () { stopShot(); this.blur(); });
  document.querySelectorAll("[data-shot]").forEach(b => b.addEventListener("click", () => { startShot(b.dataset.shot); b.blur(); }));
  $("autoRotateBtn").addEventListener("click", function () { if (freeMode) return; autoRotate = !autoRotate; this.classList.toggle("on", autoRotate); });
  $("topViewBtn").addEventListener("click", function () {
    if (freeMode) { topDownFree(); return; }
    topView = !topView; this.classList.toggle("on", topView); targetPitch = topView ? 1.48 : 0.85;
  });
  $("resetViewBtn").addEventListener("click", () => {
    if (freeMode) { resetFree(); return; }
    targetYaw = 0.6; targetPitch = topView ? 1.48 : 0.85; targetDist = defaultDistance();
  });

  const MOVE_KEYS = ["w", "a", "s", "d", "q", "e", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  const isTyping = e => { const t = e.target; return t && (t.tagName === "TEXTAREA" || t.isContentEditable || (t.tagName === "INPUT" && t.type !== "range" && t.type !== "checkbox")); };
  window.addEventListener("keydown", e => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "f" && !e.repeat) { setFreeMode(!freeMode); return; }
    if (!freeMode) return;
    if (k === "escape") { setFreeMode(false); return; }
    if (k === "c") { if (!e.repeat) toggleSmooth(); return; }
    if (k.length === 1 && k >= "1" && k <= "5") { if (!e.repeat) startShot(SHOT_ORDER[+k - 1]); return; }
    if (MOVE_KEYS.indexOf(k) < 0) return;
    if (k.startsWith("arrow") && e.target.tagName === "INPUT") return;   // let sliders use arrows
    if (k !== "shift") stopShot();                                       // taking the controls cancels a camera move
    keys[k] = true; e.preventDefault();
  });
  window.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener("blur", () => { keys = {}; });

  /* ---------- Pointer interaction ---------- */
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let mode = null, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false, dragRec = null, grab = { x: 0, z: 0 };

  function setNdc(e) {
    const r = viewportEl.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function pickCard(e) {
    setNdc(e);
    const hits = raycaster.intersectObjects(cards.map(c => c.mesh), false);
    return hits.length ? hits[0].object.userData.cardId : null;
  }
  function groundPoint(e) {
    setNdc(e); dragPlane.constant = -boardTopY;
    return raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
  }

  viewportEl.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    scene.updateMatrixWorld(true);
    downX = lastX = e.clientX; downY = lastY = e.clientY; moved = false; velYaw = 0;
    const id = pickCard(e);
    if (id != null) {
      dragRec = cards.find(c => c.id === id);
      const pt = groundPoint(e);
      grab = pt ? { x: dragRec.x - pt.x / SCALE, z: dragRec.z - pt.z / SCALE } : { x: 0, z: 0 };
      if (selectedId !== id) selectCard(id);
      mode = "card"; viewportEl.classList.add("dragging-card");
    } else {
      mode = "look"; if (freeMode) stopShot(); viewportEl.classList.add("dragging");
    }
    viewportEl.setPointerCapture(e.pointerId);
  });
  viewportEl.addEventListener("pointermove", e => {
    if (!mode) return;
    if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) moved = true;
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    if (mode === "card") {
      const pt = groundPoint(e);
      if (pt) moveCard(dragRec, pt.x / SCALE + grab.x, pt.z / SCALE + grab.z);
    } else if (freeMode) {
      tYaw -= dx * 0.004; tPitch = clamp(tPitch - dy * 0.004, -PITCH_LIM, PITCH_LIM);
    } else {
      targetYaw -= dx * 0.008; targetPitch = clamp(targetPitch + dy * 0.008, 0.12, 1.5); velYaw = -dx * 0.008;
    }
  });
  function endPointer() {
    if (mode === "look" && !moved && selectedId != null) selectCard(null);
    if (mode === "card") renderCardList();
    mode = null; dragRec = null;
    viewportEl.classList.remove("dragging", "dragging-card");
  }
  viewportEl.addEventListener("pointerup", endPointer);
  viewportEl.addEventListener("pointercancel", endPointer);

  viewportEl.addEventListener("wheel", e => {
    e.preventDefault();
    if (freeMode) dollyFree(-e.deltaY * 0.01 * (fSpeed / 6));
    else targetDist = clamp(targetDist + e.deltaY * 0.02, 1, 60);
  }, { passive: false });

  let pinch = null;
  viewportEl.addEventListener("touchstart", e => { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
  viewportEl.addEventListener("touchmove", e => {
    if (e.touches.length !== 2 || pinch == null) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (freeMode) dollyFree((d - pinch) * 0.03); else targetDist = clamp(targetDist - (d - pinch) * 0.04, 1, 60);
    pinch = d;
  }, { passive: true });
  viewportEl.addEventListener("touchend", () => { pinch = null; }, { passive: true });

  /* =====================================================================
     Loop / resize / init
     ===================================================================== */
  function resize() {
    const w = viewportEl.clientWidth, h = viewportEl.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    $("stage").style.setProperty("--bar", Math.max(0, (h - w / 2.39) / 2) + "px");   // 2.39:1 frame
  }
  new ResizeObserver(resize).observe(viewportEl);

  let last = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (freeMode) {
      updateFree(dt);
    } else {
      if (autoRotate && mode == null) targetYaw += 0.005;
      else if (mode == null && Math.abs(velYaw) > 0.0001) { targetYaw += velYaw; velYaw *= 0.94; }
      yaw += (targetYaw - yaw) * 0.12; pitch += (targetPitch - pitch) * 0.12; dist += (targetDist - dist) * 0.12;
      applyCamera();
    }
    renderer.render(scene, camera);
  }

  // boot
  rebuildBoard();
  dist = targetDist = defaultDistance();
  syncBoardUI();
  addCard();                       // start with one card on the board so adjustments are visible immediately
  cards[0].x = 0; cards[0].z = 0; placeCard(cards[0]); updateStacking();
  applyCineUI(); updateHint(); updateSpecChips();
  resize(); applyCamera();
  requestAnimationFrame(animate);
})();
