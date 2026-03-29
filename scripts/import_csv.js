// Simple CSV importer to Supabase tables using service_role key.
// Usage:
//   set SUPABASE_URL="https://...supabase.co" (Windows PowerShell)
//   set SUPABASE_SERVICE_ROLE="<service_role_key>"
//   node scripts/import_csv.js

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if(!SUPABASE_URL || !SERVICE_ROLE){
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE env vars');
  process.exit(1);
}

async function postTable(table, rows){
  const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'apikey': SERVICE_ROLE,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(rows)
  });
  if(!res.ok){
    const text = await res.text();
    throw new Error(`Insert failed ${res.status}: ${text}`);
  }
  return res.json();
}

function parseCSV(filePath){
  const txt = fs.readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/).filter(l=>l.trim().length>0);
  const header = lines.shift().split(',').map(h=>h.trim());
  const rows = lines.map(line=>{
    // Basic split — assumes no embedded commas
    const cols = line.split(',');
    const obj = {};
    for(let i=0;i<header.length;i++) obj[header[i]] = cols[i] === undefined ? null : cols[i];
    return obj;
  });
  return rows;
}

async function main(){
  try{
    console.log('Parsing halls.csv...');
    const halls = parseCSV(path.join(__dirname,'..','halls.csv')).map(r=>({
      hall_id: r.hall_id ? Number(r.hall_id): null,
      name: r.name || null,
      lecture_capacity: r.lecture_capacity? Number(r.lecture_capacity): null,
      exam_capacity: r.exam_capacity? Number(r.exam_capacity): null,
      available_seats: r.available_seats? Number(r.available_seats): null,
      building_name: r.building_name || null,
      new_bld_id: r.new_bld_id || null
    }));
    if(halls.length) {
      console.log(`Inserting ${halls.length} halls...`);
      await postTable('halls', halls);
      console.log('Inserted halls');
    }

    console.log('Parsing bld_images.csv...');
    const imgs = parseCSV(path.join(__dirname,'..','bld_images.csv')).map(r=>({
      building_name: r.building_name || null,
      exterior_image_url: r.exterior_image_url || null,
      interior_image_url: r.interior_image_url || null,
      geopoint: r.geopoint || null,
      latitude: r.latitude? Number(r.latitude) : null,
      longitude: r.longitude? Number(r.longitude) : null,
      altitude: r.altitude? Number(r.altitude) : null,
      new_bld_id: r.new_bld_id || null,
      submission_uuid: r.submission_uuid || null,
      meta_root_uuid: r.meta_root_uuid || null
    }));
    if(imgs.length){
      console.log(`Inserting ${imgs.length} bld_images...`);
      await postTable('bld_images', imgs);
      console.log('Inserted bld_images');
    }

    console.log('Done.');
  }catch(err){
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
