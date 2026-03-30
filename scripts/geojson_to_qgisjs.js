#!/usr/bin/env node
// Convert GeoJSON files in data/ to qgis2web-style JS files: var json_<name> = <GeoJSON>;
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
if(!fs.existsSync(dataDir)){
  console.error('data/ directory not found:', dataDir);
  process.exit(1);
}

const files = fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.geojson'));
if(files.length === 0){
  console.log('No .geojson files found in data/. Place your exported GeoJSONs there and re-run this script.');
  process.exit(0);
}

for(const f of files){
  const base = path.basename(f, '.geojson');
  const inPath = path.join(dataDir, f);
  const outPath = path.join(dataDir, base + '.js');
  try{
    const raw = fs.readFileSync(inPath, 'utf8');
    // Validate JSON
    const obj = JSON.parse(raw);
    // qgis2web uses variable names like json_<layername>
    const varName = 'json_' + base.replace(/[^A-Za-z0-9_]/g, '_');
    const content = `var ${varName} = ${JSON.stringify(obj)};\n`;
    fs.writeFileSync(outPath, content, 'utf8');
    console.log('Wrote', outPath);
  }catch(err){
    console.error('Failed for', f, err.message);
  }
}

console.log('Done. Include the generated .js files in index.html (data/<name>.js).');
