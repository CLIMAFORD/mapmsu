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

  // Setup realtime subscriptions for issues table (listen for inserts)
  function setupRealtimeSubscriptions(){
    try{
      if(!supabase || !supabase.channel) return;
      // unsubscribe existing channel if any
      try{ if(window._msu_issues_channel) { supabase.removeChannel(window._msu_issues_channel); window._msu_issues_channel = null; } }catch(e){}
      const ch = supabase.channel('public:issues')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'issues' }, payload => {
          try{ const row = payload.new; if(row && row.lat && row.lon){ addIssueMarker(row); } }catch(e){}
        })
        .subscribe();
      window._msu_issues_channel = ch;
    }catch(e){ console.warn('setupRealtimeSubscriptions failed', e); }
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

  // Expose to global surface for other scripts / UI wiring
  window.MSUMapApp = Object.assign(window.MSUMapApp || {}, { sessionId, startActiveTracking, stopActiveTracking, refreshHeatmap });

  // Issue markers management
  let _issueMarkers = {};
  function addIssueMarker(row){
    try{
      const id = row.id || ('i_'+(row.created_at?Date.parse(row.created_at):Date.now()));
      if(!row.lat || !row.lon) return;
      const lat = Number(row.lat), lon = Number(row.lon);
      if(!isFinite(lat) || !isFinite(lon)) return;
      if(_issueMarkers[id]) return;
      const hasImage = row.image_url && String(row.image_url).startsWith('http');
      const html = `<div style="width:36px;height:36px;border-radius:18px;background:#ef4444;display:flex;align-items:center;justify-content:center;border:2px solid #fff;overflow:hidden"><img src="${hasImage?row.image_url:''}" style="width:36px;height:36px;object-fit:cover;display:${hasImage?'block':'none'}"/></div>`;
      const icon = L.divIcon({ html, className: 'msu-issue-marker', iconSize:[36,36], iconAnchor:[18,18] });
      const m = L.marker([lat, lon], { icon }).addTo(map);
      m.bindPopup(`<div style="max-width:200px"><strong>Status:</strong> ${row.status||'New'}<br/><div style="margin-top:6px">${row.description?String(row.description):''}</div>${hasImage?'<div style="margin-top:6px"><img src="'+row.image_url+'" style="width:100%;height:auto;"/></div>':''}</div>`);
      _issueMarkers[id] = m;
    }catch(e){ console.warn('addIssueMarker error', e); }
  }

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

  // Issue reporting UI wiring: form inside Actions panel
  (function wireIssueReporting(){
    function attach(){
      const submit = document.getElementById('tool_issue_submit');
      if(!submit) return;
      submit.addEventListener('click', async ()=>{
        const desc = (document.getElementById('tool_issue_desc')||{}).value || '';
        const photoEl = document.getElementById('tool_issue_photo');
        try{
          await loadSupabaseIfMissing();
          if(!supabase){ alert('Reporting not available: Supabase client could not be initialized'); return; }
          // get device location (force)
          const pos = await getCurrentPosition({ enableHighAccuracy:false, timeout:10000, force:true }).catch(()=>null);
          if(!pos){ alert('Could not get location for the issue. Please allow location.'); return; }
          const lat = pos.coords.latitude, lon = pos.coords.longitude;
          let image_url = null, path = null;
          if(photoEl && photoEl.files && photoEl.files.length){ const file = photoEl.files[0]; const filename = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'')}`; try{ const { data: uploadData, error: uploadError } = await supabase.storage.from(ISSUE_BUCKET).upload(filename, file); if(uploadError){ console.warn('upload error', uploadError); } else { path = uploadData.path; const pub = supabase.storage.from(ISSUE_BUCKET).getPublicUrl(path).data?.publicUrl; image_url = pub || null; } }catch(e){ console.warn('upload exception', e); }
          }
          const obj = { description: desc || null, lat, lon, image_url, status: 'New', created_at: new Date().toISOString() };
          try{
            const { data, error } = await supabase.from(ISSUES_TABLE).insert([obj]);
            if(error){ console.warn('issue insert error', error); // if table missing, save locally
              const pending = JSON.parse(localStorage.getItem('pending_issues')||'[]'); pending.push(obj); localStorage.setItem('pending_issues', JSON.stringify(pending)); alert('Issue saved locally. Reporting server table may not exist yet.'); return; }
            alert('Issue reported.');
          }catch(e){ console.warn('insert exception', e); const pending = JSON.parse(localStorage.getItem('pending_issues')||'[]'); pending.push(obj); localStorage.setItem('pending_issues', JSON.stringify(pending)); alert('Issue saved locally.'); }
        }catch(e){ console.warn('submit issue failed', e); alert('Could not submit issue: '+(e.message||e)); }
      });
    }
    if(document.readyState === 'complete' || document.readyState === 'interactive') attach(); else document.addEventListener('DOMContentLoaded', attach);
  })();

})();
