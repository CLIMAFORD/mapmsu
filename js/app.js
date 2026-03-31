// App: Supabase integration, routing, report UI, heatmap
(function(){
  // --- Configuration (replace values injected from server) ---
  const SUPABASE_URL = 'https://zjwxnbuitohuksljmwgo.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpqd3huYnVpdG9odWtzbGptd2dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTM3NTcsImV4cCI6MjA4OTgyOTc1N30.ip8ZtV9bjTc_Abx8z8AIPp6gBcdMdHQN63TJs5jlPSQ';
// Open the right-side panel and populate with photos
  const ISSUE_BUCKET = 'issue-photos';
  const ACTIVE_USERS_TABLE = 'active_users';
  const ISSUES_TABLE = 'issues';

  // Initialize Supabase client (deferred). We'll attempt to use any UMD `window.supabase` if present, otherwise lazy-load.
  let supabase = null;

  async function loadSupabaseIfMissing(){
    if(supabase) return supabase;
    // try to load CDN fallback
    const cdn = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    try{
      await new Promise((res, rej)=>{
        var s = document.createElement('script'); s.src = cdn; s.onload = res; s.onerror = rej; document.head.appendChild(s);
      if(reportEl) return;
      reportEl = document.createElement('div');
      // Use inline styles so the modal is visible even without Tailwind
      reportEl.style.position = 'fixed';
      reportEl.style.left = '0'; reportEl.style.top = '0'; reportEl.style.right = '0'; reportEl.style.bottom = '0';
      reportEl.style.background = 'rgba(0,0,0,0.5)';
      reportEl.style.display = 'flex'; reportEl.style.alignItems = 'center'; reportEl.style.justifyContent = 'center';
      reportEl.style.zIndex = '2000';
      reportEl.innerHTML = `
        <div style="width:100%;max-width:520px;background:#fff;border-radius:8px;padding:16px;box-shadow:0 6px 24px rgba(0,0,0,.2);">
          <h2 style="margin:0 0 8px 0;font-size:18px;font-weight:600">Report Issue</h2>
          <div style="margin-bottom:8px"><label style="display:block;font-weight:600;margin-bottom:4px">Description</label><textarea id="issueDesc" style="width:100%;height:90px;padding:8px;border:1px solid #ccc;border-radius:4px"></textarea></div>
          <div style="margin-bottom:8px"><label style="display:block;font-weight:600;margin-bottom:4px">Photo (optional)</label><input id="issuePhoto" type="file" accept="image/*" /></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button id="submitIssue" style="background:#0b84ff;color:#fff;padding:8px 12px;border-radius:6px;border:none">Submit</button><button id="closeIssue" style="padding:8px 12px;border-radius:6px;border:1px solid #ccc;background:#fff">Close</button></div>
          <div id="issueStatus" style="margin-top:10px;color:#333;font-size:13px"></div>
        </div>`;
      document.body.appendChild(reportEl);
      document.getElementById('closeIssue').addEventListener('click', ()=>{ location.hash = '#/'; });
      const submitBtn = document.getElementById('submitIssue');
      submitBtn.addEventListener('click', submitIssue);
      // Try to lazily load/configure Supabase when opening the dialog so reporting can work
      (async function(){
        const statusEl = document.getElementById('issueStatus');
        if(supabase){ if(statusEl) statusEl.textContent = ''; submitBtn.disabled = false; return; }
        if(statusEl) statusEl.textContent = 'Initializing reporting client...';
        const s = await loadSupabaseIfMissing();
        if(s){ supabase = s; window.MSUMapApp = Object.assign(window.MSUMapApp||{}, { supabase }); if(statusEl) statusEl.textContent = ''; submitBtn.disabled = false; }
        else { if(statusEl) statusEl.textContent = 'Reporting disabled: Supabase client not available. Add js/supabase.min.js or configure SUPABASE_* keys.'; submitBtn.disabled = true; }
      })();
  }

  // Report UI
  let reportEl = null;
  function showReport(){
    if(reportEl) return;
    reportEl = document.createElement('div');
    reportEl.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    reportEl.innerHTML = `
      <div class="w-full max-w-md bg-white rounded p-4">
        <h2 class="text-lg font-semibold mb-2">Report Issue</h2>
        <label class="block mb-2">Description<textarea id="issueDesc" class="w-full border p-2"></textarea></label>
        <label class="block mb-2">Photo (optional)<input id="issuePhoto" type="file" accept="image/*" capture="environment" /></label>
        <div class="flex justify-between items-center">
          <button id="submitIssue" class="bg-emerald-600 text-white px-4 py-2 rounded">Submit</button>
          <button id="closeIssue" class="px-4 py-2 rounded">Close</button>
        </div>
        <div id="issueStatus" class="mt-2 text-sm text-gray-600"></div>
      </div>`;
    document.body.appendChild(reportEl);
    document.getElementById('closeIssue').addEventListener('click', ()=>{ location.hash = '#/'; });
    const submitBtn = document.getElementById('submitIssue');
    submitBtn.addEventListener('click', submitIssue);
    // Try to lazily load/configure Supabase when opening the dialog so reporting can work
    (async function(){
      const statusEl = document.getElementById('issueStatus');
      if(supabase){ if(statusEl) statusEl.textContent = ''; submitBtn.disabled = false; return; }
      if(statusEl) statusEl.textContent = 'Initializing reporting client...';
      const s = await loadSupabaseIfMissing();
      if(s){ supabase = s; window.MSUMapApp = Object.assign(window.MSUMapApp||{}, { supabase }); if(statusEl) statusEl.textContent = ''; submitBtn.disabled = false; }
      else { if(statusEl) statusEl.textContent = 'Reporting disabled: Supabase client not available. Add js/supabase.min.js or configure SUPABASE_* keys.'; submitBtn.disabled = true; }
    })();
  }
  function hideReport(){ if(reportEl){ reportEl.remove(); reportEl = null; } }

  async function submitIssue(){
    const status = document.getElementById('issueStatus');
    if(!supabase){ if(status) status.textContent = 'Reporting unavailable: server client not configured.'; return; }
    status.textContent = 'Getting location...';
    try{
      const pos = await getCurrentPosition({enableHighAccuracy:true, timeout:10000});
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      status.textContent = 'Uploading photo (if any)...';
      const fileInput = document.getElementById('issuePhoto');
      let image_path = null, public_url = null;
      if(fileInput && fileInput.files && fileInput.files.length){
        const file = fileInput.files[0];
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'')}`;
        const { data: uploadData, error: uploadError } = await supabase.storage.from(ISSUE_BUCKET).upload(filename, file, { upsert: false });
        if(uploadError){ console.error(uploadError); status.textContent = 'Photo upload failed: ' + uploadError.message; }
        else { image_path = uploadData?.path; public_url = supabase.storage.from(ISSUE_BUCKET).getPublicUrl(image_path).data.publicUrl; }
      }
      status.textContent = 'Saving issue...';
      const description = document.getElementById('issueDesc').value || null;
      const insertObj = { description, image_path, image_url: public_url, lat, lon, session_id: sessionId };
      const { data, error } = await supabase.from(ISSUES_TABLE).insert([insertObj]);
      if(error){ console.error(error); status.textContent = 'Save failed: ' + error.message; }
      else { status.textContent = 'Issue reported. Thank you.'; setTimeout(()=>{ location.hash = '#/'; }, 1200); }
    }catch(err){ console.error(err); status.textContent = 'Error: ' + err.message; }
  }

  function getCurrentPosition(options){
    return new Promise((resolve, reject)=>{
      if(!navigator.geolocation) return reject(new Error('Geolocation not supported'));
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }

  // Active users tracking
  let activeTracking = false;
  let activeInterval = null;
  async function startActiveTracking(){
    if(activeTracking) return; activeTracking = true;
    // ensure supabase is available before attempting to upsert/fetch
    await loadSupabaseIfMissing();
    if(!supabase){ console.warn('Active-tracking disabled: Supabase client not available'); return; }
    await sendCurrentLocation();
    activeInterval = setInterval(sendCurrentLocation, 15000);
  }
  function stopActiveTracking(){ if(activeInterval) clearInterval(activeInterval); activeTracking = false; }

  async function sendCurrentLocation(){
    try{
      if(!supabase) return; // don't attempt DB ops when client isn't available
      const pos = await getCurrentPosition({enableHighAccuracy:false, timeout:10000});
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const obj = { session_id: sessionId, lat, lon, last_seen: new Date().toISOString() };
      await supabase.from(ACTIVE_USERS_TABLE).upsert([obj], { onConflict: 'session_id' });
    }catch(e){ /* ignore location errors */ }
  }

  // Heatmap layer
  let heatLayer = null;
  async function refreshHeatmap(){
    try{
      await loadSupabaseIfMissing();
      if(!supabase){ console.warn('Heatmap disabled: Supabase client not available'); return; }
      const { data, error } = await supabase.from(ACTIVE_USERS_TABLE).select('lat,lon').gte('last_seen', new Date(Date.now()-1000*60*10).toISOString());
      if(error){ console.error('heat fetch', error); return; }
      const points = (data || []).map(d => [d.lat, d.lon, 0.5]);
      if(heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }
      if(points.length){ heatLayer = L.heatLayer(points, {radius: 25, blur: 15, maxZoom: 17}).addTo(map); }
    }catch(e){ console.error(e); }
  }

  // Realtime subscription setup moved to function so it can be invoked after supabase is loaded
  function setupRealtimeSubscriptions(){
    try{
      if(!(supabase && supabase.channel)) return;
      // Listen for new issues
      supabase.channel('public:issues')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: ISSUES_TABLE }, (payload) => {
          console.log('Realtime: new issue', payload);
          const status = document.getElementById('issueStatus');
          if(status) status.textContent = 'New issue received (realtime)';
        })
        .subscribe();

      // Listen for active_users changes to refresh heatmap
      supabase.channel('public:active_users')
        .on('postgres_changes', { event: '*', schema: 'public', table: ACTIVE_USERS_TABLE }, (payload) => {
          if(window._msu_heat_timeout) clearTimeout(window._msu_heat_timeout);
          window._msu_heat_timeout = setTimeout(()=>{ refreshHeatmap(); }, 500);
        })
        .subscribe();
    }catch(e){ console.warn('Realtime subscription setup failed', e); }
  }
  // If supabase was already available at load time, set up subscriptions now
  try{ if(supabase) setupRealtimeSubscriptions(); }catch(e){}

  // Hook heat toggle
  const heatToggle = document.getElementById('heatToggle');
  if(heatToggle){ heatToggle.addEventListener('change', async (e)=>{
    if(e.target.checked){ await startActiveTracking(); await refreshHeatmap(); window.heatInterval = setInterval(refreshHeatmap, 10000); }
    else { stopActiveTracking(); if(window.heatInterval) clearInterval(window.heatInterval); if(heatLayer) { map.removeLayer(heatLayer); heatLayer = null; } }
  }); }

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
      return;
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
