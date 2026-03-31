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

  // Attempt to wire heat toggle to start/stop server tracking when UI exists
  (function wireHeatToggle(){
    try{
      function attach(){
        const el = document.getElementById('heatToggle');
        if(!el) return;
        el.addEventListener('change', async function(e){
          if(e.target.checked){ await loadSupabaseIfMissing(); startActiveTracking(); refreshHeatmap(); } else { stopActiveTracking(); if(_serverHeatLayer) try{ map.removeLayer(_serverHeatLayer); }catch(e){} _serverHeatLayer = null; }
        });
      }
      if(document.readyState === 'complete' || document.readyState === 'interactive') attach(); else document.addEventListener('DOMContentLoaded', attach);
    }catch(e){ /* ignore */ }
  })();

})();
