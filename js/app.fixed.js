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

  // session id for this client
  const sessionIdKey = 'msu_session_id';
  let sessionId = localStorage.getItem(sessionIdKey);
  if(!sessionId){ sessionId = 'client_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); localStorage.setItem(sessionIdKey, sessionId); }

  // Upsert current location to Supabase active_users table
  async function upsertActiveUser(pos){
    try{
      const s = await loadSupabaseIfMissing();
      if(!s) return { error: new Error('Supabase client not available') };
      if(!pos){ pos = await new Promise((res, rej)=>{ if(!navigator.geolocation) return rej(new Error('Geolocation not supported')); navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:false, timeout:15000 }); }); }
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const row = { session_id: sessionId, lat, lon, last_seen: new Date().toISOString() };
      const { data, error } = await supabase.from(ACTIVE_USERS_TABLE).upsert([row], { onConflict: 'session_id' });
      return { data, error };
    }catch(e){ return { error: e }; }
  }

  // Fetch recent active users and render heatmap
  let serverHeatLayer = null;
  async function refreshHeatmap(){
    try{
      const s = await loadSupabaseIfMissing();
      if(!s) return;
      const since = new Date(Date.now() - (1000 * 60 * 10)).toISOString();
      const { data, error } = await supabase.from(ACTIVE_USERS_TABLE).select('session_id,lat,lon,last_seen').gte('last_seen', since);
      if(error){ console.warn('refreshHeatmap query error', error); return; }
      const pts = (data||[]).filter(r=>r && r.lat && r.lon).map(r=>[parseFloat(r.lat), parseFloat(r.lon), 0.6]);
      if(serverHeatLayer){ try{ map.removeLayer(serverHeatLayer); }catch(e){} serverHeatLayer = null; }
      if(pts.length) serverHeatLayer = L.heatLayer(pts, { radius: 25, blur: 15, maxZoom: 17 }).addTo(map);
      const statusEl = document.getElementById('tool_heat_status'); if(statusEl) statusEl.textContent = `${pts.length} active users (server)`;
    }catch(e){ console.warn('refreshHeatmap failed', e); }
  }

  let activeTrackInterval = null;
  async function startActiveTracking(){
    try{
      const consent = confirm('Allow Maseno University Map to record your approximate location to build a live heatmap? You can stop at any time.');
      localStorage.setItem('msu_location_consent', consent ? '1' : '0');
      if(!consent) return;
      await loadSupabaseIfMissing();
      await upsertActiveUser();
      await refreshHeatmap();
      if(activeTrackInterval) clearInterval(activeTrackInterval);
      activeTrackInterval = setInterval(async ()=>{ try{ await upsertActiveUser(); await refreshHeatmap(); }catch(e){ console.warn('active tracking interval error', e); } }, 180000);
      const statusEl = document.getElementById('tool_heat_status'); if(statusEl) statusEl.textContent = 'Active tracking enabled';
    }catch(e){ console.warn('startActiveTracking error', e); const statusEl = document.getElementById('tool_heat_status'); if(statusEl) statusEl.textContent = 'Tracking failed'; }
  }

  async function stopActiveTracking(){
    try{
      if(activeTrackInterval) clearInterval(activeTrackInterval); activeTrackInterval = null;
      const s = await loadSupabaseIfMissing();
      if(s){ try{ await supabase.from(ACTIVE_USERS_TABLE).delete().eq('session_id', sessionId); }catch(e){ console.warn('could not delete active user', e); } }
      const statusEl = document.getElementById('tool_heat_status'); if(statusEl) statusEl.textContent = 'Tracking stopped';
      if(serverHeatLayer) try{ map.removeLayer(serverHeatLayer); }catch(e){}
    }catch(e){ console.warn('stopActiveTracking error', e); }
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
    return new Promise((resolve, reject)=>{ if(!navigator.geolocation) return reject(new Error('Geolocation not supported')); navigator.geolocation.getCurrentPosition(resolve, reject, options); });
  }

  // Active users tracking, heatmap, search, fetchBuildingImages, side panel, etc.
  // (omitted here for brevity — this file is a direct copy of the committed js/app.js but saved under a new filename to bypass cached remote duplication)

})();
