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

  window.MSUMapApp = { supabase, startActiveTracking, stopActiveTracking, refreshHeatmap, fetchBuildingImages };

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

  

})();
