// Copied clean app.js as fallback to bypass cached remote duplication
// App: Supabase integration, routing, report UI, heatmap
(function(){
  // --- Configuration (replace values injected from server) ---
  const SUPABASE_URL = 'https://zjwxnbuitohuksljmwgo.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpqd3huYnVpdG9odWtzbGptd2dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTM3NTcsImV4cCI6MjA4OTgyOTc1N30.ip8ZtV9bjTc_Abx8z8AIPp6gBcdMdHQN63TJs5jlPSQ';
  const ISSUE_BUCKET = 'issue-photos';
  const ACTIVE_USERS_TABLE = 'active_users';
  const ISSUES_TABLE = 'issues';

  let supabase = null;

  async function loadSupabaseIfMissing(){
    if(supabase) return supabase;
    const cdn = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    try{
      if(!window.supabase){
        await new Promise((res, rej) => {
          const s = document.createElement('script'); s.src = cdn; s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
      }
      if(window.supabase && typeof window.supabase.createClient === 'function'){
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      } else if(window.supabase && window.supabase.supabase){
        supabase = window.supabase.supabase;
      } else if(window.supabase){
        supabase = window.supabase;
      }
      if(supabase){ window.MSUMapApp = Object.assign(window.MSUMapApp || {}, { supabase }); try{ setupRealtimeSubscriptions(); }catch(e){} }
      return supabase;
    }catch(e){ console.warn('Could not load supabase JS', e); return null; }
  }

  // Reporting UI and submit removed

  function getCurrentPosition(options){
    // Only allow programmatic geolocation when caller explicitly requests it via options.force
    options = options || {};
    if(!options.force && !window.MSU_ALLOW_GEO){ return Promise.reject(new Error('Geolocation not allowed outside user gesture')); }
    return new Promise((resolve, reject)=>{ if(!navigator.geolocation) return reject(new Error('Geolocation not supported')); navigator.geolocation.getCurrentPosition(resolve, reject, options); });
  }

  // Active users tracking, heatmap, search, fetchBuildingImages, side panel, etc.
  // Supabase-backed active user tracking: start/stop, periodic upsert, and heatmap refresh
  const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  let _activeTrackInterval = null;
  let _serverHeatLayer = null;

  async function upsertActiveUser(){
    try{
      const s = await loadSupabaseIfMissing();
      if(!s || !supabase) return;
      const pos = await getCurrentPosition({ enableHighAccuracy:false, timeout:10000 }).catch(()=>null);
      if(!pos) return;
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const payload = { session_id: sessionId, lat: lat, lon: lon, last_seen: new Date().toISOString() };
      // Use upsert so the session row is updated if present
      try{
        await supabase.from(ACTIVE_USERS_TABLE).upsert([payload], { onConflict: 'session_id' });
      }catch(e){ console.warn('supabase upsert active_users failed', e); }
    }catch(e){ console.warn('upsertActiveUser error', e); }
  }

  function startActiveTracking(){
    if(_activeTrackInterval) return;
    // fire immediately then every 3 minutes
    upsertActiveUser();
    _activeTrackInterval = setInterval(upsertActiveUser, 3 * 60 * 1000);
    return _activeTrackInterval;
  }

  function stopActiveTracking(){
    if(_activeTrackInterval) clearInterval(_activeTrackInterval);
    _activeTrackInterval = null;
  }

  async function refreshHeatmap(){
    try{
      const s = await loadSupabaseIfMissing();
      if(!s || !supabase) return;
      // fetch users seen in last 20 minutes
      const cutoff = new Date(Date.now() - (20 * 60 * 1000)).toISOString();
      const { data, error } = await supabase.from(ACTIVE_USERS_TABLE).select('lat,lon,last_seen').gt('last_seen', cutoff).limit(2000);
      if(error){ console.warn('refreshHeatmap query failed', error); return; }
      const points = (data||[]).filter(r=> r && r.lat && r.lon ).map(r=> [Number(r.lat), Number(r.lon), 0.6]);
      if(window && window.map){
        if(_serverHeatLayer){ try{ map.removeLayer(_serverHeatLayer); }catch(e){} _serverHeatLayer = null; }
        if(points.length) _serverHeatLayer = L.heatLayer(points, { radius: 25, blur: 15, maxZoom: 17 }).addTo(map);
      }
      return points.length;
    }catch(e){ console.warn('refreshHeatmap error', e); }
  }

  // Issues markers and realtime/fallback polling
  const issueMarkers = {};
  async function loadIssues(){
    try{
      const s = await loadSupabaseIfMissing();
      if(!s || !supabase) return;
      const { data, error } = await supabase.from(ISSUES_TABLE).select('*').order('created_at', { ascending: false }).limit(1000);
      if(error){ console.warn('loadIssues error', error); return; }
      if(!data) return;
      // clear existing
      for(const id in issueMarkers){ try{ map.removeLayer(issueMarkers[id]); }catch(e){} }
      Object.keys(issueMarkers).forEach(k=>delete issueMarkers[k]);
      for(const row of data){ try{ addOrUpdateIssueMarker(row); }catch(e){} }
      const statusEl = document.getElementById('report_status'); if(statusEl) statusEl.textContent = `${data.length} issues loaded`;
    }catch(e){ console.warn('loadIssues failed', e); }
  }

  function issueIconColor(status){ if(!status) return 'red'; const s = String(status).toLowerCase(); if(s.indexOf('new')!==-1) return 'red'; if(s.indexOf('progress')!==-1 || s.indexOf('in progress')!==-1) return 'yellow'; if(s.indexOf('resolved')!==-1) return 'green'; return 'gray'; }
  function addOrUpdateIssueMarker(row){ if(!row || !row.id) return; try{ const lat = Number(row.lat), lon = Number(row.lon); if(!isFinite(lat) || !isFinite(lon)) return; const col = issueIconColor(row.status); const marker = L.circleMarker([lat, lon], { radius:8, fillColor: col, color:'#222', weight:1, fillOpacity:0.9 }).addTo(map); const popup = `<div style="min-width:160px"><strong>${row.status || 'New'}</strong><div style="font-size:13px;margin-top:6px">${row.description || ''}</div>${row.image_url?'<div style="margin-top:6px"><img src="'+row.image_url+'" style="width:100%;height:auto;border-radius:4px"/></div>':''}<div style="margin-top:6px;font-size:11px;color:#666">${row.created_at||''}</div></div>`; marker.bindPopup(popup); issueMarkers[row.id] = marker; }catch(e){ console.warn('addOrUpdateIssueMarker failed', e); } }

  async function setupRealtimeSubscriptions(){
    try{
      const s = await loadSupabaseIfMissing(); if(!s || !supabase) return;
      // Try realtime subscription for issues (v2 API)
      try{
        const channel = supabase.channel('public:issues');
        channel.on('postgres_changes', { event: '*', schema: 'public', table: ISSUES_TABLE }, (payload)=>{
          const ev = payload.eventType || payload.type || (payload.event && payload.event.type) || 'unknown';
          const record = payload.new || payload.record || payload;
          if(ev === 'INSERT' || payload.eventType === 'INSERT') addOrUpdateIssueMarker(record);
          if(ev === 'UPDATE' || payload.eventType === 'UPDATE') addOrUpdateIssueMarker(record);
          if(ev === 'DELETE' || payload.eventType === 'DELETE'){
            const old = payload.old || payload.record || payload.old_record || null;
            if(old && old.id && issueMarkers[old.id]){ try{ map.removeLayer(issueMarkers[old.id]); delete issueMarkers[old.id]; }catch(e){} }
          }
        });
        await channel.subscribe();
      }catch(e){ console.warn('realtime subscribe failed', e); }
      // Also do polling fallback
      setInterval(loadIssues, 30 * 1000);
      // initial load
      loadIssues();
    }catch(e){ console.warn('setupRealtimeSubscriptions failed', e); }
  }

  // Submit an issue from UI: description, optional photo, and lat/lon
  let _reportChooseMode = null; // 'map' when picking point
  function showReportStatus(msg){ const s = document.getElementById('report_status'); if(s) s.textContent = msg; }
  async function submitIssueFromUI(){
    try{
      const desc = (document.getElementById('report_desc')||{}).value || '';
      const photoEl = document.getElementById('report_photo');
      let lat = null, lon = null;
      if(_reportChooseMode === 'map' && window._lastPickedIssueLatLng){ lat = window._lastPickedIssueLatLng.lat; lon = window._lastPickedIssueLatLng.lng; }
      else{
        try{ const pos = await getCurrentPosition({ enableHighAccuracy:false, timeout:10000, force:true }); lat = pos.coords.latitude; lon = pos.coords.longitude; }catch(e){}
      }
      if(!lat || !lon){ showReportStatus('Could not determine location. Use choose on map or allow location.'); return; }
      showReportStatus('Uploading photo (if any) and saving...');
      let image_url = null;
      if(photoEl && photoEl.files && photoEl.files.length){ const file = photoEl.files[0]; const filename = `issue_${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'')}`; try{ const up = await supabase.storage.from(ISSUE_BUCKET).upload(filename, file, { upsert: false }); if(up.error){ console.warn('upload error', up.error); } else { const pu = supabase.storage.from(ISSUE_BUCKET).getPublicUrl(up.data.path); image_url = pu?.data?.publicUrl || null; } }catch(e){ console.warn('photo upload failed', e); }}
      // insert into issues table
      try{
        const payload = { description: desc, lat: lat, lon: lon, status: 'New', image_url: image_url, created_at: new Date().toISOString() };
        const { data, error } = await supabase.from(ISSUES_TABLE).insert([payload]);
        if(error){ console.warn('issue insert error', error); showReportStatus('Save failed. Offline saved locally.'); // fallback local
          const list = JSON.parse(localStorage.getItem('pending_issues')||'[]'); list.push(payload); localStorage.setItem('pending_issues', JSON.stringify(list)); return; }
        showReportStatus('Issue reported. Thank you.');
        // clear form
        (document.getElementById('report_desc')||{}).value = '';
        if(photoEl) photoEl.value = null;
      }catch(e){ console.warn('submitIssue failed', e); showReportStatus('Submit failed.'); }
    }catch(e){ console.warn('submitIssueFromUI error', e); showReportStatus('Error: '+(e.message||e)); }
  }

  // UI bindings for report section
  (function wireReportUI(){
    try{
      function attach(){
        const useBtn = document.getElementById('report_use_loc'); if(useBtn) useBtn.addEventListener('click', async ()=>{ try{ const pos = await getCurrentPosition({enableHighAccuracy:false, timeout:10000, force:true}); window._lastPickedIssueLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude }; showReportStatus(`Location set: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`); }catch(e){ showReportStatus('Location failed: '+(e.message||e)); } });
        const pickBtn = document.getElementById('report_from_map'); if(pickBtn) pickBtn.addEventListener('click', ()=>{ _reportChooseMode = 'map'; showReportStatus('Click on the map to choose issue location'); });
        const submitBtn = document.getElementById('report_submit'); if(submitBtn) submitBtn.addEventListener('click', submitIssueFromUI);
        // Map click handler for picking issue location
        if(typeof map !== 'undefined' && map && map.on){ map.on('click', function(e){ if(_reportChooseMode === 'map'){ window._lastPickedIssueLatLng = e.latlng; _reportChooseMode = null; showReportStatus(`Location chosen: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`); } }); }
      }
      if(document.readyState === 'complete' || document.readyState === 'interactive') attach(); else document.addEventListener('DOMContentLoaded', attach);
    }catch(e){ console.warn('wireReportUI failed', e); }
  })();

  // Expose to global surface for other scripts / UI wiring
  window.MSUMapApp = Object.assign(window.MSUMapApp || {}, { sessionId, startActiveTracking, stopActiveTracking, refreshHeatmap });

  // Attempt to wire heat toggle to start/stop server tracking when UI exists
  (function wireHeatToggle(){
    try{
      function attach(){
        const el = document.getElementById('heatToggle');
        if(el){
          el.addEventListener('change', async function(e){
            if(e.target.checked){
              // Prompt for geolocation permission immediately (must be in user gesture)
              try{
                // If Permissions API available, check before requesting
                if(navigator.permissions && navigator.permissions.query){
                  try{ const p = await navigator.permissions.query({ name: 'geolocation' }); if(p.state === 'denied'){ alert('Location permission is denied for this site. Please enable location permissions in your browser.'); e.target.checked = false; return; } }catch(err){}
                }
                // Directly request current position to trigger browser prompt (explicit force)
                await getCurrentPosition({ enableHighAccuracy:false, timeout:10000, force:true });
              }catch(err){ alert('Could not get location permission: ' + (err.message || err)); e.target.checked = false; return; }
              await loadSupabaseIfMissing();
              startActiveTracking();
              refreshHeatmap();
            } else {
              stopActiveTracking();
              if(_serverHeatLayer) try{ map.removeLayer(_serverHeatLayer); }catch(e){} _serverHeatLayer = null;
            }
          });
        }

        // Fallback: ensure Actions button toggles panel if app.js listener missed attaching
        try{
          const actionsBtn = document.getElementById('actionsBtn');
          if(actionsBtn){
            actionsBtn.addEventListener('click', function(ev){
              ev.preventDefault();
              const p = document.getElementById('msuActionsPanel');
              if(p) p.classList.toggle('open');
              // After toggle, if panel remains hidden (backgrounded), apply floating fallback
              setTimeout(()=>{
                try{
                  const pnl = document.getElementById('msuActionsPanel');
                  if(!pnl) return;
                  const style = window.getComputedStyle(pnl);
                  const visible = style && style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
                  if(!visible){ pnl.classList.add('floating'); pnl.classList.add('open'); }
                }catch(e){}
              }, 150);
            });
          }
        }catch(e){}
      }
      if(document.readyState === 'complete' || document.readyState === 'interactive') attach(); else document.addEventListener('DOMContentLoaded', attach);
    }catch(e){ /* ignore */ }
  })();

})();
