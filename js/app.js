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
      });
      if(window.supabase && window.supabase.createClient){
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.info('Loaded Supabase from CDN fallback');
        // after we have supabase, wire realtime subscriptions
        try{ setupRealtimeSubscriptions(); }catch(e){}
        return supabase;
      }
    }catch(e){ console.warn('Could not load Supabase CDN fallback', e); }
    console.error('Supabase client not available. Ensure js/supabase.min.js is loaded.');
    return null;
  }

  // Utility: generate session id
  let sessionId = localStorage.getItem('msu_session_id');
  if(!sessionId){ sessionId = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); localStorage.setItem('msu_session_id', sessionId); }

  // Routing
  function route(){
    const hash = location.hash || '#/';
    if(hash.startsWith('#/report')){ showReport(); }
    else { hideReport(); }
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', route);

  // If Supabase UMD already present on window, initialize now (avoid TDZ by not referencing `supabase` identifier in its own initializer)
  if(window.supabase && window.supabase.createClient){
    try{ supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); setupRealtimeSubscriptions(); }catch(e){ console.warn('Supabase init failed', e); }
  }

  // Report UI
  let reportEl = null;
  function showReport(){
    if(reportEl) return;
    reportEl = document.createElement('div');
    // Inline styles to ensure modal is visible even without Tailwind
    reportEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;';
    reportEl.innerHTML = `
      <div id="msu-report-dialog" style="background:#fff;color:#111;padding:16px;border-radius:8px;max-width:420px;width:100%;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
        <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;">Report Issue</h2>
        <label style="display:block;margin-bottom:8px;">Description<textarea id="issueDesc" style="width:100%;min-height:80px;padding:8px;border:1px solid #ddd;border-radius:4px;"></textarea></label>
        <label style="display:block;margin-bottom:8px;">Photo (optional)<input id="issuePhoto" type="file" accept="image/*" capture="environment" style="display:block;margin-top:6px;" /></label>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
          <button id="submitIssue" style="background:#059669;color:#fff;padding:8px 12px;border-radius:6px;border:none;">Submit</button>
          <button id="closeIssue" style="background:transparent;border:1px solid #ccc;padding:8px 12px;border-radius:6px;">Close</button>
        </div>
        <div id="issueStatus" style="margin-top:10px;font-size:13px;color:#444"></div>
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

  function doSearch(){
    const q = (searchInput && searchInput.value) ? String(searchInput.value).trim() : '';
    if(!q) return;
    const mode = (searchMode && searchMode.value) ? searchMode.value : 'any';
    const group = (window.bounds_group && typeof window.bounds_group.getLayers === 'function') ? window.bounds_group : null;
    const statusEl = document.getElementById('searchStatus');
    if(!group){ if(statusEl) statusEl.textContent = 'Search not available'; console.warn('No searchable layer group found'); return; }
    const matches = [];
    try{
      const gjLayers = group.getLayers();
      gjLayers.forEach(gj => {
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
    // Zoom to first match and open popup
    const first = matches[0];
    try{
      if(typeof first.getBounds === 'function'){ map.fitBounds(first.getBounds()); }
      else if(typeof first.getLatLng === 'function'){ map.setView(first.getLatLng(), 18); }
      if(typeof first.openPopup === 'function') first.openPopup();
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

})();
