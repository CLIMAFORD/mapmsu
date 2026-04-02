// App: routing and reporting functions have been removed for refactor
(function(){
  // Simplified image fetcher — use feature properties only (Supabase/reporting removed).
  async function fetchBuildingImages(feature){
    const result = { interior: null, exterior: null };
    if(!feature || !feature.properties) return result;
    const props = feature.properties || {};
    result.interior = props.interior_image || props.interior || props.Interior || props.Photo || props.photo || null;
    result.exterior = props.exterior_image || props.exterior || props.Exterior || props.Photo || props.photo || null;
    return result;
  }
  window.fetchBuildingImages = fetchBuildingImages;
  // Expose a minimal MSUMapApp surface now; routing/reporting will be reimplemented fresh later.
  window.MSUMapApp = { fetchBuildingImages };

  // --- Search wiring and implementation ---
  const searchBtn = document.getElementById('searchBtn');
  const searchInput = document.getElementById('mapSearch');
  const searchMode = document.getElementById('searchMode');
  if(searchBtn) searchBtn.addEventListener('click', doSearch);
  if(searchInput) searchInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') doSearch(); });

  // Search navigation state
  let _searchMatches = [];
  let _searchIndex = -1;

  // Next / Prev handlers
  const searchNextBtn = document.getElementById('searchNext');
  const searchPrevBtn = document.getElementById('searchPrev');
  const searchCountEl = document.getElementById('searchCount');
  if(searchNextBtn) searchNextBtn.addEventListener('click', ()=>{ if(_searchMatches.length) { _searchIndex = (_searchIndex + 1) % _searchMatches.length; focusResult(_searchIndex); updateSearchControls(); } });
  if(searchPrevBtn) searchPrevBtn.addEventListener('click', ()=>{ if(_searchMatches.length) { _searchIndex = (_searchIndex - 1 + _searchMatches.length) % _searchMatches.length; focusResult(_searchIndex); updateSearchControls(); } });

  function updateSearchControls(){
    if(!searchCountEl) return;
    if(!_searchMatches || !_searchMatches.length){ searchCountEl.textContent = '0 / 0'; return; }
    searchCountEl.textContent = (_searchIndex+1) + ' / ' + _searchMatches.length;
  }

  function focusResult(i){
    if(!_searchMatches || !_searchMatches.length) return;
    const item = _searchMatches[i];
    if(!item) return;
    try{
      // clear previous highlights, then highlight this one
      clearHighlights();
      if(item.setStyle) item.setStyle({ color: '#ff3333', weight: 3, fillOpacity: 0.7 });
      window._msu_highlights = [item];
      // fit to bounds of all matches when focusing first time
      try{
        const bounds = new L.LatLngBounds();
        _searchMatches.forEach(m => { try{ if(typeof m.getBounds === 'function') bounds.extend(m.getBounds()); else if(typeof m.getLatLng === 'function') bounds.extend(m.getLatLng()); }catch(e){} });
        if(bounds.isValid && bounds.isValid()) map.fitBounds(bounds.pad(0.25));
      }catch(e){}
      if(typeof item.openPopup === 'function') item.openPopup();
      // open side panel with images for this feature
      (async ()=>{ try{ const imgs = await fetchBuildingImages(item.feature || (item && item.feature)); openSidePanel({ title: (item.feature && (item.feature.properties.Name || item.feature.properties.name)) || 'Feature', interior: imgs.interior, exterior: imgs.exterior }); }catch(e){}})();
    }catch(e){ console.warn('focusResult error', e); }
  }

  function doSearch(){
    const q = (searchInput && searchInput.value) ? String(searchInput.value).trim() : '';
    if(!q) return;
    const mode = (searchMode && searchMode.value) ? searchMode.value : 'any';
    const group = (window.bounds_group && typeof window.bounds_group.getLayers === 'function') ? window.bounds_group : null;
    const statusEl = document.getElementById('searchStatus');
    console.debug('doSearch()', { q, mode, group });
    try{ if(group && typeof group.getLayers === 'function'){ console.debug('bounds_group has', group.getLayers().length, 'layers'); } }catch(e){ console.debug('bounds_group.getLayers error', e); }
    if(!group){ if(statusEl) statusEl.textContent = 'Search not available'; console.warn('No searchable layer group found'); return; }
    const matches = [];
    try{
      const gjLayers = group.getLayers();
      console.debug('search: iterating', gjLayers.length, 'geojson layers');
      gjLayers.forEach(gj => {
        try{ console.debug('layer', gj && (gj.layerName || gj.options && gj.options.layerName) ); }catch(e){}
        if(!gj || typeof gj.getLayers !== 'function') return;
        gj.getLayers().forEach(fl => {
          // Only consider layers that have a popup bound (visible features with popup)
          try{ if(typeof fl.getPopup === 'function' && !fl.getPopup()) return; }catch(e){}
          const props = (fl && fl.feature && fl.feature.properties) ? fl.feature.properties : {};
          const values = Object.values(props).filter(v=>v!==null&&v!==undefined).map(v=>String(v));
          if(mode === 'any'){
            if(values.some(v=> v.toLowerCase().includes(q.toLowerCase()))) matches.push(fl);
          } else {
            const terms = q.split(/\s+/).filter(Boolean);
            const hay = values.join(' ').toLowerCase();
            if(terms.every(t => hay.indexOf(t.toLowerCase()) !== -1)) matches.push(fl);
          }
        });
      });
    }catch(err){ console.error('Search error', err); }
    if(matches.length === 0){
      if(searchInput){ searchInput.classList.add('border-red-500'); setTimeout(()=>searchInput.classList.remove('border-red-500'),1200); }
      if(statusEl){ statusEl.textContent = 'Could not find facility'; setTimeout(()=>{ if(statusEl) statusEl.textContent = ''; }, 3000); }
      // Try fallback: scan global json_* variables for matching features and map them back to leaflet layers
      try{
        console.debug('doSearch: trying global json_* fallback');
        const qLower = q.toLowerCase();
        const candidateNames = new Set();
        for(const k in window){
          if(!k.startsWith('json_')) continue;
          const obj = window[k];
          if(obj && obj.features && Array.isArray(obj.features)){
            for(const f of obj.features){
              try{
                const props = f.properties || {};
                const name = (props.Name || props.name || props.NAME || '').toString();
                if(!name) continue;
                if(name.toLowerCase().includes(qLower)) candidateNames.add(name);
                else {
                  // also search all string properties
                  const all = Object.values(props).filter(v=>v!==null&&v!==undefined).map(v=>String(v).toLowerCase()).join(' ');
                  if(all.indexOf(qLower) !== -1) candidateNames.add(name);
                }
              }catch(e){}
            }
          }
        }
        if(candidateNames.size){
          const gjLayers = group.getLayers();
          gjLayers.forEach(gj => {
            if(!gj || typeof gj.getLayers !== 'function') return;
            gj.getLayers().forEach(fl => {
                try{
                  // Only include layers that have a popup bound
                  try{ if(typeof fl.getPopup === 'function' && !fl.getPopup()) return; }catch(e){}
                  const props = (fl && fl.feature && fl.feature.properties) ? fl.feature.properties : {};
                  const name = (props.Name || props.name || props.NAME || '').toString();
                  if(name && candidateNames.has(name)) matches.push(fl);
                }catch(e){}
              });
          });
        }
      }catch(e){ console.warn('fallback search error', e); }
      if(matches.length === 0) return;
    }
    // populate navigation state and focus on first match
    _searchMatches = matches;
    _searchIndex = 0;
    updateSearchControls();
    const first = matches[0];
    try{
      focusResult(0);
      if(statusEl) statusEl.textContent = '';
    }catch(e){ console.warn('Could not focus on search result', e); }
  }

  // Expose small diagnostics to console
  // Fetch images for a building/feature from Supabase `bld_images` table or feature properties
  async function fetchBuildingImages(feature){
    const result = { interior: null, exterior: null };
    if(!feature || !feature.properties) return result;
    const name = feature.properties['Name'] || feature.properties['name'] || feature.properties['NAME'] || null;
    const buildingId = feature.properties['new_bld_id'] || feature.properties['building_id'] || feature.properties['bld_id'] || null;

    // Ensure Supabase client (attempt load if missing)
    await loadSupabaseIfMissing();
    if(supabase){
      try{
        let q = supabase.from('bld_images').select('*');
        if(buildingId) q = q.eq('building_id', buildingId);
        else if(name) q = q.ilike('building_name', `%${name}%`).limit(50);
        const { data, error } = await q;
        if(error) console.warn('bld_images query error', error);
        if(data && data.length){
          for(const row of data){
            let url = null;
            if(row.image_url && String(row.image_url).startsWith('http')) url = row.image_url;
            if(!url && row.url && String(row.url).startsWith('http')) url = row.url;
            if(!url){
              const path = row.path || row.image_path || row.file_path || row.filename || null;
              const buckets = [row.bucket, 'bld-images', 'bld_images', 'building-photos', 'images', 'public', 'issue-photos'].filter(Boolean);
              if(path){
                for(const b of buckets){
                  try{
                    const pu = supabase.storage.from(b).getPublicUrl(path).data?.publicUrl;
                    if(pu){ url = pu; break; }
                  }catch(e){}
                }
              }
            }
            if(url){
              const t = (row.type || row.kind || row.image_type || '').toLowerCase();
              if(t.indexOf('interior') !== -1) result.interior = result.interior || url;
              else if(t.indexOf('exterior') !== -1) result.exterior = result.exterior || url;
              else if(!result.exterior) result.exterior = url;
              else if(!result.interior) result.interior = url;
            }
          }
        }
      }catch(e){ console.warn('fetchBuildingImages error', e); }
    }
    // Fallback to feature properties if still empty
    result.interior = result.interior || feature.properties['interior_image'] || feature.properties['interior'] || feature.properties['Interior'] || null;
    result.exterior = result.exterior || feature.properties['exterior_image'] || feature.properties['exterior'] || feature.properties['Exterior'] || null;
    if(!result.interior && feature.properties['Photo']) result.interior = feature.properties['Photo'];
    if(!result.exterior && feature.properties['Photo']) result.exterior = result.exterior || feature.properties['Photo'];
    return result;
  }
  window.fetchBuildingImages = fetchBuildingImages;

  // Do not reference a local `supabase` variable here; the client is loaded lazily in app.fixed.js
  // Merge safe exports into the global MSUMapApp without referencing potentially-undefined locals
  window.MSUMapApp = Object.assign(window.MSUMapApp || {}, { fetchBuildingImages });

  // Highlight helpers
  function clearHighlights(){
    try{
      if(window._msu_highlights && Array.isArray(window._msu_highlights)){
        window._msu_highlights.forEach(l => { try{ if(l.setStyle) l.setStyle({ color: '#222', weight: 1, fillOpacity: 1 }); }catch(e){} });
      }
    }catch(e){}
    window._msu_highlights = [];
  }

  // Side panel functions: create, open, close
  function openSidePanel(data){
    let panel = document.getElementById('msuSidePanel');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'msuSidePanel';
      panel.className = 'msu-side-panel';
      panel.innerHTML = '<div class="msu-close" id="msuSideClose">Close</div><div id="msuSideContent"></div>';
      document.body.appendChild(panel);
      document.getElementById('msuSideClose').addEventListener('click', closeSidePanel);
    }
    const content = document.getElementById('msuSideContent');
    content.innerHTML = '';
    if(data && data.title) content.innerHTML += '<h3 style="margin-top:0">' + String(data.title) + '</h3>';
    if(data && data.exterior) content.innerHTML += '<div><strong>Exterior</strong><img src="' + data.exterior + '" alt="exterior"></div>';
    if(data && data.interior) content.innerHTML += '<div><strong>Interior</strong><img src="' + data.interior + '" alt="interior"></div>';
    panel.classList.add('open');
  }

  function closeSidePanel(){
    const panel = document.getElementById('msuSidePanel');
    if(panel) panel.classList.remove('open');
    clearHighlights();
  }

  window.MSUMapApp = Object.assign(window.MSUMapApp || {}, { clearHighlights, openSidePanel, closeSidePanel });

  
  // --- Fresh Routing / Directions (OSRM) ---
  (function(){
    let routeLayer = null;
    let originMarker = null, destMarker = null;
    let routingSelectMode = null; // 'from' or 'to'

    function parseLatLng(v){
      if(!v) return null;
      const m = String(v).trim().match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
      if(!m) return null;
      const a = parseFloat(m[1]), b = parseFloat(m[2]);
      if(!isFinite(a) || !isFinite(b)) return null;
      // assume input is "lat, lng"
      return L.latLng(a, b);
    }

    function getCurrentPosition(options){
      options = options || {};
      if(!options.force && !window.MSU_ALLOW_GEO){ return Promise.reject(new Error('Geolocation not allowed outside user gesture')); }
      return new Promise((resolve, reject)=>{
        if(!navigator.geolocation) return reject(new Error('Geolocation not supported'));
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
      });
    }

    function clearRoute(){
      try{ if(routeLayer){ map.removeLayer(routeLayer); routeLayer = null; } }catch(e){}
      try{ if(originMarker){ map.removeLayer(originMarker); originMarker = null; } }catch(e){}
      try{ if(destMarker){ map.removeLayer(destMarker); destMarker = null; } }catch(e){}
      const s = document.getElementById('dirSummary'); if(s) s.innerHTML = '';
      const st = document.getElementById('dirSteps'); if(st) st.innerHTML = '';
    }

    function formatDistance(m){ if(typeof m !== 'number') return ''; if(m>=1000) return (m/1000).toFixed(2)+' km'; return Math.round(m)+' m'; }
    function formatDuration(s){ if(typeof s !== 'number') return ''; if(s>=3600) return Math.round(s/3600)+' h '+Math.round((s%3600)/60)+' m'; if(s>=60) return Math.round(s/60)+' m '+Math.round(s%60)+' s'; return Math.round(s)+' s'; }

    async function routeBetween(a, b){
      if(!a || !b) return;
      try{
        // Ensure values look valid
        if(!isFinite(a.lat) || !isFinite(a.lng) || !isFinite(b.lat) || !isFinite(b.lng)) throw new Error('Invalid coordinates');
        const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=true`;
        const resp = await fetch(url, {cache: 'no-store'});
        if(!resp.ok) throw new Error('Routing API error ' + resp.status);
        const data = await resp.json();
        if(!data || !data.routes || !data.routes.length) throw new Error('No route found');
        const r = data.routes[0];
        // remove old
        if(routeLayer) try{ map.removeLayer(routeLayer); }catch(e){}
        routeLayer = L.geoJSON(r.geometry || r, { style: { color: '#0b84ff', weight: 5, opacity: 0.9 } }).addTo(map);
        try{ if(routeLayer.getBounds && routeLayer.getBounds().isValid()) map.fitBounds(routeLayer.getBounds().pad(0.08)); }catch(e){}
        const summary = document.getElementById('dirSummary'); if(summary) summary.innerHTML = `<div><strong>Distance:</strong> ${formatDistance(r.distance)} — <strong>Duration:</strong> ${formatDuration(r.duration)}</div>`;
        const stepsEl = document.getElementById('dirSteps'); if(stepsEl){ stepsEl.innerHTML = ''; const legs = r.legs || []; legs.forEach(leg=>{ const ol = document.createElement('ol'); (leg.steps||[]).forEach(s=>{ const li = document.createElement('li'); li.style.marginBottom='6px'; const instr = (s.maneuver && (s.maneuver.instruction || s.maneuver.type)) || s.name || ''; li.innerText = `${formatDistance(s.distance)} — ${formatDuration(s.duration)} — ${instr}`; ol.appendChild(li); }); stepsEl.appendChild(ol); }); }
      }catch(err){ console.warn('routeBetween error', err); const summary = document.getElementById('dirSummary'); if(summary) summary.innerText = 'Routing error: ' + err.message; }
    }

    // map click selection
    try{ if(typeof map !== 'undefined' && map && map.on){ map.on('click', function(e){ if(!routingSelectMode) return; const latlng = e.latlng; if(!latlng) return; if(routingSelectMode === 'from'){ if(originMarker) try{ map.removeLayer(originMarker); }catch(e){} originMarker = L.marker(latlng).addTo(map); const o = document.getElementById('dirOrigin'); if(o) o.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`; } else if(routingSelectMode === 'to'){ if(destMarker) try{ map.removeLayer(destMarker); }catch(e){} destMarker = L.marker(latlng).addTo(map); const d = document.getElementById('dirDest'); if(d) d.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`; } routingSelectMode = null; }); } }catch(e){ console.warn('map click routing attach failed', e); }

    // Directions UI removed — no-op placeholder
    function attachDirUI(){ /* removed */ }

    // --- Tools panel: Issues/Search/Directions/Heatmap ---
    function openToolsPanel(tab){
      const panel = document.getElementById('msuToolsPanel'); if(!panel) return; panel.style.display = 'block';
      switchToolsTab(tab || 'search');
    }
    function closeToolsPanel(){ const panel = document.getElementById('msuToolsPanel'); if(panel) panel.style.display = 'none'; }

    function switchToolsTab(tab){
      const tabs = ['search','heat'];
      tabs.forEach(t=>{ const el = document.getElementById('tab'+capitalize(t)); if(el) el.classList.remove('active'); const pnl = document.getElementById('tab'+capitalize(t)+'Panel'); if(pnl) pnl.style.display = 'none'; });
      const activeBtn = document.getElementById('tab'+capitalize(tab)); if(activeBtn) activeBtn.classList.add('active'); const panel = document.getElementById('tab'+capitalize(tab)+'Panel'); if(panel) panel.style.display = 'block';
    }
    function capitalize(s){ return s && String(s).charAt(0).toUpperCase()+String(s).slice(1); }

    // Wire tools controls
    function attachToolsUI(){
      const toolsClose = document.getElementById('toolsClose'); if(toolsClose) toolsClose.addEventListener('click', closeToolsPanel);
      // Actions panel toggle button: use class toggle for CSS-driven show/hide
      const actionsBtn = document.getElementById('actionsBtn');
      if(actionsBtn) actionsBtn.addEventListener('click', (e)=>{ e.preventDefault(); const p = document.getElementById('msuActionsPanel'); if(p) p.classList.toggle('open'); });
      const actionsClose = document.getElementById('actionsClose'); if(actionsClose) actionsClose.addEventListener('click', ()=>{ const p = document.getElementById('msuActionsPanel'); if(p) p.classList.remove('open'); });
      const openReport = document.getElementById('openReport'); if(openReport) openReport.addEventListener('click', (e)=>{ e.preventDefault(); try{ if(typeof window.MSUMapApp !== 'undefined' && window.MSUMapApp.showIssueModal) window.MSUMapApp.showIssueModal(); else { const evt = new Event('openReportModal'); document.dispatchEvent(evt); } }catch(err){} });
      const ts = document.getElementById('tabSearch'); if(ts) ts.addEventListener('click', ()=>switchToolsTab('search'));
      const th = document.getElementById('tabHeat'); if(th) th.addEventListener('click', ()=>switchToolsTab('heat'));

      // Directions routing: OSRM
      let routeLayer = null; let originMarker = null, destMarker = null; let routingSelectMode = null;
      function parseLatLng(v){ if(!v) return null; const m = String(v).trim().match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/); if(!m) return null; const a = parseFloat(m[1]), b = parseFloat(m[2]); if(!isFinite(a)||!isFinite(b)) return null; return L.latLng(a,b); }
      // Resolve an input string to a LatLng
      async function resolvePlaceInput(input){
        if(!input) return null;
        input = String(input).trim();
        // 1) lat, lon
        const latlng = parseLatLng(input);
        if(latlng) return latlng;
        // 2) search declared leaflet layers first
        try{
          const names = getDeclaredLayers();
          const q = input.toLowerCase();
          for(const layer of names){
            try{
              if(layer && typeof layer.getLayers === 'function'){
                const kids = layer.getLayers();
                for(const f of kids){
                  const props = (f && f.feature && f.feature.properties) ? f.feature.properties : {};
                  const name = (props.Name || props.name || props.NAME || '').toString().toLowerCase();
                  if(name && name.indexOf(q) !== -1){
                    // use feature centroid or latlng
                    if(typeof f.getLatLng === 'function') return f.getLatLng();
                    if(typeof f.getBounds === 'function'){ const b = f.getBounds(); return b.getCenter(); }
                  }
                }
              }
            }catch(e){}
          }
          // 3) fallback: scan global json_* features
          for(const k in window){ if(!k.startsWith('json_')) continue; const obj = window[k]; if(obj && obj.features && Array.isArray(obj.features)){
            for(const feat of obj.features){ try{ const props = feat.properties || {}; const name = (props.Name||props.name||props.NAME||'').toString().toLowerCase(); if(name && name.indexOf(input.toLowerCase()) !== -1){ // return centroid
                  if(feat.geometry && feat.geometry.type === 'Point' && feat.geometry.coordinates){ return L.latLng(feat.geometry.coordinates[1], feat.geometry.coordinates[0]); }
                  if(feat.geometry && (feat.geometry.type === 'Polygon' || feat.geometry.type === 'MultiPolygon')){
                    // compute simple centroid
                    const coords = feat.geometry.coordinates[0] || feat.geometry.coordinates;
                    if(coords && coords.length){ const c = coords[0]; return L.latLng(c[1], c[0]); }
                  }
                } }catch(e){}
            }
          }
        }catch(e){}
        return null;
      }
      async function routeBetween(a,b){ try{ if(!a||!b) return; const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=true`; const resp = await fetch(url); if(!resp.ok) throw new Error('Routing API error '+resp.status); const data = await resp.json(); if(!data || !data.routes || !data.routes.length) throw new Error('No route'); const r = data.routes[0]; if(routeLayer) try{ map.removeLayer(routeLayer); }catch(e){} routeLayer = L.geoJSON(r.geometry, { style:{ color:'#0b84ff', weight:5, opacity:0.9 } }).addTo(map); try{ if(routeLayer.getBounds && routeLayer.getBounds().isValid()) map.fitBounds(routeLayer.getBounds().pad(0.08)); }catch(e){} const summary = document.getElementById('dirSummary'); if(summary) summary.innerHTML = `<div><strong>Distance:</strong> ${Math.round(r.distance)} m — <strong>Duration:</strong> ${Math.round(r.duration)} s</div>`; const stepsEl = document.getElementById('dirSteps'); if(stepsEl){ stepsEl.innerHTML=''; (r.legs||[]).forEach(leg=>{ const ol = document.createElement('ol'); (leg.steps||[]).forEach(s=>{ const li = document.createElement('li'); li.style.marginBottom='6px'; const instr = (s.maneuver && (s.maneuver.instruction || s.maneuver.type)) || s.name || ''; li.innerText = `${Math.round(s.distance)} m — ${Math.round(s.duration)} s — ${instr}`; ol.appendChild(li); }); stepsEl.appendChild(ol); }); }
      }catch(err){ console.warn('routeBetween error', err); const summary = document.getElementById('dirSummary'); if(summary) summary.innerText = 'Routing error: '+(err.message||err); }
      }
      // map click selection for routing
      if(typeof map !== 'undefined' && map && map.on){ map.on('click', function(e){ if(!routingSelectMode) return; const latlng = e.latlng; if(!latlng) return; if(routingSelectMode === 'from'){ if(originMarker) try{ map.removeLayer(originMarker); }catch(e){} originMarker = L.marker(latlng).addTo(map); const o = document.getElementById('dirOrigin'); if(o) o.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`; } else if(routingSelectMode === 'to'){ if(destMarker) try{ map.removeLayer(destMarker); }catch(e){} destMarker = L.marker(latlng).addTo(map); const d = document.getElementById('dirDest'); if(d) d.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`; } routingSelectMode = null; }); }

      // wire directions controls
      const fromMap = document.getElementById('dirFromMap'); if(fromMap) fromMap.addEventListener('click', ()=>{ routingSelectMode = 'from'; try{ alert('Click on the map to select origin'); }catch(e){} });
      const toMap = document.getElementById('dirToMap'); if(toMap) toMap.addEventListener('click', ()=>{ routingSelectMode = 'to'; try{ alert('Click on the map to select destination'); }catch(e){} });
      const useMy = document.getElementById('dirUseMyLocation'); if(useMy) useMy.addEventListener('click', async ()=>{ try{ const pos = await getCurrentPosition({enableHighAccuracy:true, timeout:10000, force:true}); const latlng = L.latLng(pos.coords.latitude,pos.coords.longitude); if(originMarker) try{ map.removeLayer(originMarker); }catch(e){} originMarker = L.marker(latlng).addTo(map); const o = document.getElementById('dirOrigin'); if(o) o.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`; try{ map.setView(latlng,17); }catch(e){} }catch(err){ alert('Could not get location: '+(err.message||err)); } });
      const routeBtn = document.getElementById('dirRoute'); if(routeBtn) routeBtn.addEventListener('click', async ()=>{
        const o = document.getElementById('dirOrigin'); const d = document.getElementById('dirDest'); if(!o||!d) return;
        // resolve both inputs (names, lat/lon or polygons)
        const a = await resolvePlaceInput(o.value) || null;
        const b = await resolvePlaceInput(d.value) || null;
        if(!a || !b){ alert('Please enter or select origin and destination (name, lat,lng, or click on map)'); return; }
        try{ if(originMarker) map.removeLayer(originMarker); }catch(e){}
        originMarker = L.marker(a).addTo(map);
        try{ if(destMarker) map.removeLayer(destMarker); }catch(e){}
        destMarker = L.marker(b).addTo(map);
        await routeBetween(a,b);
      });
      const clearBtn = document.getElementById('dirClear'); if(clearBtn) clearBtn.addEventListener('click', ()=>{ try{ if(routeLayer) map.removeLayer(routeLayer); if(originMarker) map.removeLayer(originMarker); if(destMarker) map.removeLayer(destMarker); document.getElementById('dirSummary').innerHTML=''; document.getElementById('dirSteps').innerHTML=''; }catch(e){} });

      // Issues/reporting removed

      // Search: reuse main search logic
      const toolSearchInput = document.getElementById('tool_search_input'); const toolSearchBtn = document.getElementById('tool_search_btn'); if(toolSearchBtn && toolSearchInput) toolSearchBtn.addEventListener('click', ()=>{ document.getElementById('mapSearch').value = toolSearchInput.value; if(typeof doSearch === 'function') doSearch(); document.getElementById('tool_search_status').textContent = 'Search executed'; });
      const toolPrev = document.getElementById('tool_search_prev'); if(toolPrev) toolPrev.addEventListener('click', ()=>{ const b = document.getElementById('searchPrev'); if(b) b.click(); });
      const toolNext = document.getElementById('tool_search_next'); if(toolNext) toolNext.addEventListener('click', ()=>{ const b = document.getElementById('searchNext'); if(b) b.click(); });

      // Heatmap: local storage of logged locations and rendering
      let localHeatLayer = null; let localTrackInterval = null;
      async function renderLocalHeat(){ try{ const entries = JSON.parse(localStorage.getItem('local_locations')||'[]'); const points = (entries||[]).map(e=>[e.lat, e.lon, 0.6]); if(localHeatLayer){ try{ map.removeLayer(localHeatLayer); }catch(e){} localHeatLayer = null; } if(points.length) localHeatLayer = L.heatLayer(points, {radius: 25, blur: 15, maxZoom: 17}).addTo(map); document.getElementById('tool_heat_status').textContent = `${points.length} local points`; }catch(e){ console.warn(e); } }
      async function logLocalLocation(){ try{ const pos = await getCurrentPosition({enableHighAccuracy:false, timeout:10000, force:true}); const entry = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: new Date().toISOString() }; const arr = JSON.parse(localStorage.getItem('local_locations')||'[]'); arr.push(entry); localStorage.setItem('local_locations', JSON.stringify(arr)); await renderLocalHeat(); document.getElementById('tool_heat_status').textContent = 'Location logged'; }catch(e){ document.getElementById('tool_heat_status').textContent = 'Log failed: '+(e.message||e); } }
      const elLog = document.getElementById('tool_log_location'); if(elLog) elLog.addEventListener('click', logLocalLocation);
      const elClear = document.getElementById('tool_clear_heat'); if(elClear) elClear.addEventListener('click', ()=>{ localStorage.removeItem('local_locations'); if(localHeatLayer) try{ map.removeLayer(localHeatLayer); }catch(e){} localHeatLayer = null; document.getElementById('tool_heat_status').textContent = 'Cleared'; });
      const elStart = document.getElementById('tool_start_tracking'); if(elStart) elStart.addEventListener('click', ()=>{ if(localTrackInterval) return; logLocalLocation(); localTrackInterval = setInterval(logLocalLocation, 15000); document.getElementById('tool_heat_status').textContent = 'Tracking started'; });
      const elStop = document.getElementById('tool_stop_tracking'); if(elStop) elStop.addEventListener('click', ()=>{ if(localTrackInterval) clearInterval(localTrackInterval); localTrackInterval = null; document.getElementById('tool_heat_status').textContent = 'Tracking stopped'; });

      // helper removed
    }

    if(document.readyState === 'complete' || document.readyState === 'interactive') attachToolsUI(); else document.addEventListener('DOMContentLoaded', attachToolsUI);
  })();

})();
