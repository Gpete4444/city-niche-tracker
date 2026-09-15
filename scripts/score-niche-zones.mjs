/**
 * Write zone columns onto the Rank & Rent sheets CSV from frozen lists in
 * data/niche-zone-lists.json (Rover ∪ Claude). Rebuild lists with:
 *
 *   python scripts/merge-claude-zones.py
 *   node scripts/score-niche-zones.mjs
 */
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineMiles } from '../ops/lib/geo-neighbors.mjs';
import { normalizePlaceName, STATE_NAME_TO_ABBR } from '../ops/lib/census.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACES_PATH = path.join(ROOT, 'data', 'census', 'map', 'places.geojson');
const SHEETS_PATH = path.join(ROOT, 'data', 'usa-rank-and-rent-niches-sheets.csv');
const MERGED_PATH = path.join(ROOT, 'data', 'usa-rank-and-rent-niches-merged.next.csv');

const MIN_MEMBER_POP = 15000;
const HUB_MIN = 60000;
const HUB_MAX = 200000;
const CLUSTER_MILES = 35;
const MIN_NEIGHBORS = 5;
const MAX_NEIGHBORS = 32;
const DEDUPE_MILES = 32;
const SPREAD_MILES = 90;
const SKIP_STATES = new Set(['AK', 'HI', 'PR']);

/** Mega-cores whose inner suburbs are too competitive for R&R hubs. */
const SKIP_NEAR_CORES = [
  { name: 'New York', state: 'NY', miles: 45 },
  { name: 'Los Angeles', state: 'CA', miles: 32 },
  { name: 'Chicago', state: 'IL', miles: 38 },
  { name: 'San Francisco', state: 'CA', miles: 32 },
  { name: 'San Jose', state: 'CA', miles: 28 },
  { name: 'Boston', state: 'MA', miles: 28 },
  { name: 'Washington', state: 'DC', miles: 28 },
  { name: 'Seattle', state: 'WA', miles: 28 },
  { name: 'Miami', state: 'FL', miles: 32 },
  { name: 'Philadelphia', state: 'PA', miles: 22 },
  { name: 'Baltimore', state: 'MD', miles: 18 },
  { name: 'Detroit', state: 'MI', miles: 18 },
  { name: 'Minneapolis', state: 'MN', miles: 18 },
  { name: 'San Diego', state: 'CA', miles: 18 },
  { name: 'Portland', state: 'OR', miles: 16 },
  { name: 'Phoenix', state: 'AZ', miles: 14 },
  { name: 'Fort Lauderdale', state: 'FL', miles: 16 },
];

const NORTHEAST = new Set(['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA']);
const MIDWEST = new Set(['OH', 'IN', 'IL', 'MI', 'WI', 'MN', 'IA', 'MO', 'ND', 'SD', 'NE', 'KS']);
const MID_ATLANTIC = new Set(['MD', 'DE', 'VA', 'WV', 'DC']);
const SOUTHEAST = new Set(['NC', 'SC', 'GA', 'FL', 'AL', 'MS', 'TN', 'KY', 'AR', 'LA']);
const SOUTH_CENTRAL = new Set(['OK', 'TX']);
const MOUNTAIN = new Set(['MT', 'ID', 'WY', 'CO', 'NM', 'AZ', 'UT', 'NV']);
const PACIFIC = new Set(['WA', 'OR', 'CA']);

const BASEMENT_STATES = new Set([
  ...NORTHEAST,
  ...MIDWEST,
  ...MID_ATLANTIC,
  'CO',
  'UT',
  'ID',
  'MT',
  'WY',
]);
const CRAWL_STATES = new Set([
  'NC',
  'SC',
  'GA',
  'AL',
  'MS',
  'TN',
  'KY',
  'AR',
  'VA',
  'OK',
  'MO',
  'IN',
  'IL',
  'OH',
  'WV',
]);
const SLAB_SUNBELT = new Set(['FL', 'AZ', 'NV', 'NM', 'CA']);
const HUMID_STATES = new Set([
  'AL',
  'MS',
  'LA',
  'GA',
  'FL',
  'SC',
  'NC',
  'TN',
  'AR',
  'TX',
  'VA',
  'KY',
  'IN',
  'MO',
  'OK',
]);
const TREE_STATES = new Set([
  ...NORTHEAST,
  ...MIDWEST,
  ...MID_ATLANTIC,
  'NC',
  'SC',
  'GA',
  'TN',
  'KY',
  'AL',
  'MS',
  'AR',
  'WA',
  'OR',
  'ID',
  'CO',
  'UT',
]);
const GENERATOR_STATES = new Set([
  'FL',
  'GA',
  'SC',
  'NC',
  'AL',
  'LA',
  'TX',
  'TN',
  'MS',
  'AR',
  'OH',
  'IN',
  'PA',
  'NY',
  'NJ',
  'CT',
  'MA',
  'VA',
  'MD',
  'MI',
  'MO',
  'KY',
]);
const TILE_TURF_STATES = new Set(['FL', 'TX', 'AZ', 'NV', 'CA', 'NM']);
const STUCCO_STATES = new Set(['AZ', 'CA', 'FL', 'NV', 'NM', 'TX']);
const TERMITE_STATES = new Set([
  'AL',
  'MS',
  'GA',
  'FL',
  'LA',
  'SC',
  'TX',
  'CA',
  'NC',
  'AZ',
  'TN',
  'OK',
  'AR',
  'VA',
]);
const RADON_STATES = new Set([
  ...NORTHEAST,
  ...MIDWEST,
  'CO',
  'UT',
  'ID',
  'MT',
  'WY',
  'MD',
  'VA',
  'PA',
]);
const SOLAR_STATES = new Set(['CA', 'AZ', 'NV', 'NM', 'TX', 'CO', 'FL', 'UT', 'NC', 'NV']);
const GATE_STATES = new Set(['AZ', 'NV', 'TX', 'FL', 'CA', 'GA', 'NC', 'SC', 'NV']);
const HOOD_BONUS = new Set([
  'greenville|SC',
  'asheville|NC',
  'charleston|SC',
  'savannah|GA',
  'madison|WI',
  'chattanooga|TN',
  'richmond|VA',
  'grand rapids|MI',
  'fort collins|CO',
  'wilmington|NC',
  'providence|RI',
  'worcester|MA',
  'spokane valley|WA',
  'spokane|WA',
  'meridian|ID',
  'nampa|ID',
  'knoxville|TN',
  'huntsville|AL',
  'ann arbor|MI',
  'lexington|KY',
  'fayetteville|AR',
  'bentonville|AR',
  'roanoke|VA',
  'columbia|SC',
  'columbia|MO',
]);

const ANCHORS = new Set([
  'dayton|OH',
  'greenville|SC',
  'orem|UT',
  'provo|UT',
  'concord|NC',
  'cary|NC',
  'georgetown|TX',
  'fishers|IN',
  'meridian|ID',
  'spokane valley|WA',
  'fayetteville|AR',
  'lakeland|FL',
  'fort myers|FL',
  'broken arrow|OK',
  'ankeny|IA',
  'franklin|TN',
  'ann arbor|MI',
  'salem|OR',
  'roanoke|VA',
  'charleston|SC',
  'savannah|GA',
  'allentown|PA',
  'manchester|NH',
  'loveland|CO',
  'surprise|AZ',
  'conroe|TX',
  'davenport|IA',
  'green bay|WI',
  'rockford|IL',
  'burlington|NC',
  'ocala|FL',
  'palm bay|FL',
  'birmingham|AL',
  'columbia|SC',
  'lansing|MI',
  'south bend|IN',
  'conway|AR',
  'temple|TX',
  'san marcos|TX',
  'castle rock|CO',
  'canton|OH',
  'hamilton|OH',
  'visalia|CA',
  'clovis|CA',
  'sparks|NV',
  'albany|NY',
  'portland|ME',
  'grand rapids|MI',
]);

const ZONE_LISTS_PATH = path.join(ROOT, 'data', 'niche-zone-lists.json');
const ZONE_COUNT = 20;
const CLIMATE_NICHE_COUNT = ZONE_COUNT;
const NATIONWIDE_COUNT = ZONE_COUNT;

const NICHE_META = {
  'Water Damage Restoration': {
    geoFit: 'Nationwide storm/flood/pipe-break demand',
    tags: ['nationwide', 'humid'],
    count: NATIONWIDE_COUNT,
  },
  'Foundation Repair': {
    geoFit: 'Nationwide; stronger on expansive clay and older housing',
    tags: ['nationwide', 'clay'],
    count: NATIONWIDE_COUNT,
  },
  'Trenchless Sewer / Sewer Line Replacement': {
    geoFit: 'Nationwide metros with sewer laterals',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Mold Remediation': {
    geoFit: 'Nationwide moisture; stronger in humid climates',
    tags: ['nationwide', 'humid'],
    count: NATIONWIDE_COUNT,
  },
  'Crawl Space Encapsulation': {
    geoFit: 'Humid South + Midwest crawl; skip slab CA/AZ',
    tags: ['crawl'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Basement Waterproofing': {
    geoFit: 'Basement belt; skip slab Sun Belt',
    tags: ['basement'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Roofing (asphalt replacement)': {
    geoFit: 'Nationwide asphalt markets; skip tile-roof belts',
    tags: ['nationwide', 'asphalt'],
    count: NATIONWIDE_COUNT,
  },
  'Commercial Roofing': {
    geoFit: 'Nationwide commercial building stock',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Fire Damage Restoration': {
    geoFit: 'Nationwide insurance-backed specialists',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'HVAC System Replacement': {
    geoFit: 'Nationwide year-round replacement, not tune-ups',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Concrete Flatwork (driveway/patio)': {
    geoFit: 'Nationwide residential hardscape',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Tree Service': {
    geoFit: 'Northern USA, Midwest, East Coast canopy; skip desert',
    tags: ['trees'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Whole-Home Generator Installation': {
    geoFit: 'Storm/outage Southeast, Midwest, Northeast, TX',
    tags: ['generators'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Custom Cabinets': {
    geoFit: 'Nationwide; denser in higher-income remodel metros',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Kitchen Remodeling': {
    geoFit: 'Nationwide high-ticket remodel',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Bathroom Remodeling': {
    geoFit: 'Nationwide remodel volume',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Electrical Panel Upgrade': {
    geoFit: 'Nationwide code and insurance upgrades',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Siding Installation': {
    geoFit: 'Nationwide; fiber-cement/Hardie over generic siding',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Window Replacement & Repair': {
    geoFit: 'Nationwide; repair is the lead magnet',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Heat Pump Installation': {
    geoFit: 'Nationwide electrification; less generic than AC repair',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Deck Construction': {
    geoFit: 'Seasonal yards; weaker in high-HOA / no-yard cores',
    tags: ['nationwide', 'yards'],
    count: NATIONWIDE_COUNT,
  },
  'Hardwood Floor Installation': {
    geoFit: 'Older housing Northeast and Midwest; skip slab Sun Belt',
    tags: ['hardwood'],
    count: CLIMATE_NICHE_COUNT,
  },
  'French Drain / Yard Drainage': {
    geoFit: 'Nationwide wet-yard and downspout problems',
    tags: ['nationwide', 'humid'],
    count: NATIONWIDE_COUNT,
  },
  'Retaining Walls': {
    geoFit: 'Nationwide grade and erosion work',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Fence Installation': {
    geoFit: 'Nationwide volume; privacy and pet triggers',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Metal Gates': {
    geoFit: 'Custom-home, security, and HOA driveway markets',
    tags: ['gates'],
    count: NATIONWIDE_COUNT,
  },
  'Decorative / Stamped Concrete': {
    geoFit: 'Nationwide decorative hardscape',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Tile Pavers': {
    geoFit: 'Year-round outdoor living South, Southwest, CA',
    tags: ['turf'],
    count: NATIONWIDE_COUNT,
  },
  'Spray Foam / Attic Insulation': {
    geoFit: 'Nationwide energy and comfort intent',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Metal Roofing': {
    geoFit: 'Nationwide premium vs asphalt; fewer specialists',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Tile Roofing': {
    geoFit: 'FL, Southwest, Southern CA; weak in snow/Northeast',
    tags: ['tile_roof'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Septic Repair / Drain Field Replacement': {
    geoFit: 'Exurban and rural; not dense-city cores',
    tags: ['exurban'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Basement Finishing': {
    geoFit: 'Basement belt; skip Sun Belt slab',
    tags: ['basement'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Whole-House Rewiring': {
    geoFit: 'Older housing stock; knob-and-tube and aluminum',
    tags: ['older'],
    count: NATIONWIDE_COUNT,
  },
  'Stair & Railing': {
    geoFit: 'Two-story housing; weak in slab-only tracts',
    tags: ['basement', 'nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Tankless Water Heater Conversion': {
    geoFit: 'Nationwide conversions',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Egress Window Installation': {
    geoFit: 'Basement / code markets; skip no-basement metros',
    tags: ['basement'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Epoxy Flooring (garage/commercial)': {
    geoFit: 'Nationwide garage and light-commercial floors',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Artificial Turf Installation': {
    geoFit: 'Warmer states: FL, TX, Southwest, Southern CA',
    tags: ['turf'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Asphalt Paving / Driveway': {
    geoFit: 'Nationwide residential driveways',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Interior/Exterior Painting (whole-house)': {
    geoFit: 'Nationwide; crowded generic SERPs',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  Drywall: {
    geoFit: 'Nationwide; generic competition and mid-low ticket',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Flooring Installation': {
    geoFit: 'Nationwide generic LVP/carpet/tile mix',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Cabinet Refacing': {
    geoFit: 'Nationwide cheaper alternative to custom cabinets',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Custom Countertops (granite / marble / quartz)': {
    geoFit: 'Nationwide fabricate-and-install',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Demolition Services': {
    geoFit: 'Nationwide interior and small-structure demo',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Well Drilling & Pump Service': {
    geoFit: 'Rural and exurban well markets',
    tags: ['exurban'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Masonry / Tuckpointing': {
    geoFit: 'Older brick and stone housing',
    tags: ['older'],
    count: NATIONWIDE_COUNT,
  },
  'Landscaping Installation': {
    geoFit: 'Nationwide; generic SERPs are crowded',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Stucco Repair': {
    geoFit: 'Southwest, CA, and FL',
    tags: ['stucco'],
    count: NATIONWIDE_COUNT,
  },
  'Chimney Repair / Relining': {
    geoFit: 'Chimney belt; skip much of the Sun Belt',
    tags: ['chimney'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Land Clearing / Forestry Mulching': {
    geoFit: 'Exurban lot-prep and overgrowth',
    tags: ['exurban'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Ductless Mini-Split Installation': {
    geoFit: 'Nationwide retrofits',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Concrete Lifting / Polyjacking': {
    geoFit: 'Nationwide sunken slab and driveway repair',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Gutter Installation': {
    geoFit: 'Nationwide',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
  'Termite Treatment': {
    geoFit: 'South and coastal',
    tags: ['termite'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Hardwood Floor Refinishing': {
    geoFit: 'Older hardwood housing; distinct from new install',
    tags: ['hardwood'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Radon Mitigation': {
    geoFit: 'Midwest, Northeast, Mountain; weak Southeast/Gulf',
    tags: ['radon'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Solar Panel Installation': {
    geoFit: 'Sun-rich weaker mid-markets; skip saturated cores',
    tags: ['solar'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Electric Gate Repair': {
    geoFit: 'HOA and Sun Belt driveway gates; repair not new install',
    tags: ['gates'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Commercial Hood Cleaning': {
    geoFit: 'Restaurant-dense mid-size metros; recurring NFPA 96',
    tags: ['hood'],
    count: CLIMATE_NICHE_COUNT,
  },
  'Mobile Windshield Repair': {
    geoFit: 'Nationwide; Safelite dominates Maps',
    tags: ['nationwide'],
    count: NATIONWIDE_COUNT,
  },
};

/** Frozen merged lists (Rover CSV ∪ Claude xlsx). Rebuilt by scripts/merge-claude-zones.py. */
const ZONE_OVERRIDES = JSON.parse(readFileSync(ZONE_LISTS_PATH, 'utf8'));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  }
  return rows;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function centroidOf(feature) {
  const b = feature.geometry?.bbox;
  if (Array.isArray(b) && b.length === 4) {
    return [(Number(b[0]) + Number(b[2])) / 2, (Number(b[1]) + Number(b[3])) / 2];
  }
  return null;
}

function keyOf(name, state) {
  return `${String(name || '').trim().toLowerCase()}|${String(state || '').trim().toUpperCase()}`;
}

function labelOf(hub) {
  return `${hub.state} - ${hub.name}`;
}

function parseZoneLabel(label) {
  const m = String(label || '').match(/^([A-Z]{2})\s+-\s+(.+)$/);
  if (!m) return null;
  return { state: m[1], name: m[2].trim() };
}

function hubFromLabel(label, hubs, places) {
  const parsed = parseZoneLabel(label);
  if (!parsed) return null;
  const k = keyOf(parsed.name, parsed.state);
  const fromHubs = hubs.find((h) => keyOf(h.name, h.state) === k);
  if (fromHubs) return { ...fromHubs };
  const fromPlaces = places.find((p) => keyOf(p.name, p.state) === k);
  if (fromPlaces) {
    return {
      ...fromPlaces,
      division: divisionOf(parsed.state),
      neighborCount: 0,
    };
  }
  return {
    name: parsed.name,
    state: parsed.state,
    lng: null,
    lat: null,
    division: divisionOf(parsed.state),
    neighborCount: 0,
  };
}

function divisionOf(state) {
  const st = String(state || '').toUpperCase();
  if (NORTHEAST.has(st)) return 'northeast';
  if (MIDWEST.has(st)) return 'midwest';
  if (MID_ATLANTIC.has(st)) return 'mid_atlantic';
  if (SOUTHEAST.has(st)) return 'southeast';
  if (st === 'TX') return 'texas';
  if (st === 'OK') return 'south_central';
  if (MOUNTAIN.has(st)) return 'mountain';
  if (PACIFIC.has(st)) return 'pacific';
  return 'other';
}

function loadIncorporatedKeys() {
  const text = readFileSync(path.join(ROOT, 'data', 'census', 'SUB-IP-EST2025-POP.csv'), 'utf8');
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(',') || /Geographic Area|Annual Estimates|table with/i.test(line)) continue;
    const m = line.match(/^"(.*)",\s*"?(.*?)"?\s*$/);
    const geo = m ? m[1].replace(/""/g, '"') : null;
    if (!geo) continue;
    const comma = geo.lastIndexOf(',');
    if (comma < 0) continue;
    const place = geo.slice(0, comma).trim();
    const stateName = geo.slice(comma + 1).trim().toLowerCase();
    const abbr = STATE_NAME_TO_ABBR[stateName];
    if (!abbr) continue;
    keys.add(`${normalizePlaceName(place)}|${abbr}`);
  }
  return keys;
}

function loadPlaces() {
  const raw = JSON.parse(readFileSync(PLACES_PATH, 'utf8'));
  const out = [];
  for (const f of raw.features || []) {
    const name = String(f.properties?.name || '').trim();
    const state = String(f.properties?.state || '').trim().toUpperCase();
    const population = Number(f.properties?.population) || 0;
    if (!name || !state || SKIP_STATES.has(state)) continue;
    if (population < MIN_MEMBER_POP) continue;
    const center = centroidOf(f);
    if (!center) continue;
    out.push({ name, state, population, lng: center[0], lat: center[1] });
  }
  return out;
}

function gridKey(lng, lat, size = 0.5) {
  return `${Math.floor(lng / size)},${Math.floor(lat / size)}`;
}

function buildGrid(places) {
  const grid = new Map();
  for (const p of places) {
    const k = gridKey(p.lng, p.lat);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  return grid;
}

function nearby(grid, place, miles) {
  const size = 0.5;
  const gx = Math.floor(place.lng / size);
  const gy = Math.floor(place.lat / size);
  const reach = Math.ceil(miles / 25) + 1;
  const out = [];
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      const bucket = grid.get(`${gx + dx},${gy + dy}`);
      if (!bucket) continue;
      for (const other of bucket) {
        if (other === place) continue;
        if (haversineMiles(place.lng, place.lat, other.lng, other.lat) <= miles) {
          out.push(other);
        }
      }
    }
  }
  return out;
}

function scoreHubs(places, incorporated, mega) {
  const grid = buildGrid(places);
  const candidates = places.filter((p) => p.population >= HUB_MIN && p.population <= HUB_MAX);
  const scored = [];
  for (const hub of candidates) {
    if (!incorporated.has(keyOf(hub.name, hub.state))) continue;
    if (nearMegaCore(hub, mega)) continue;
    const members = nearby(grid, hub, CLUSTER_MILES).filter((p) => p.population >= MIN_MEMBER_POP);
    if (members.length < MIN_NEIGHBORS) continue;
    if (members.length > MAX_NEIGHBORS) continue;
    scored.push({
      ...hub,
      neighborCount: members.length,
      division: divisionOf(hub.state),
      members,
    });
  }
  scored.sort((a, b) => b.neighborCount - a.neighborCount || b.population - a.population);
  return scored;
}

function dedupeHubs(scored) {
  const kept = [];
  for (const hub of scored) {
    if (kept.some((h) => haversineMiles(hub.lng, hub.lat, h.lng, h.lat) < DEDUPE_MILES)) continue;
    kept.push(hub);
  }
  return kept;
}

const RESTRICTIVE_TAGS = new Set([
  'crawl',
  'basement',
  'chimney',
  'hardwood',
  'radon',
  'trees',
  'generators',
  'tile_roof',
  'turf',
  'stucco',
  'termite',
  'gates',
  'solar',
  'hood',
  'asphalt',
  'exurban',
]);

function fitOne(hub, tag) {
  const st = hub.state;
  const key = keyOf(hub.name, hub.state);
  if (tag === 'crawl') return CRAWL_STATES.has(st) && !SLAB_SUNBELT.has(st);
  if (tag === 'basement') return BASEMENT_STATES.has(st) && !SLAB_SUNBELT.has(st) && st !== 'FL';
  if (tag === 'chimney') return BASEMENT_STATES.has(st) && !['FL', 'AZ', 'NV', 'TX', 'CA'].includes(st);
  if (tag === 'hardwood') return BASEMENT_STATES.has(st) && !SLAB_SUNBELT.has(st);
  if (tag === 'radon') return RADON_STATES.has(st) && !['FL', 'LA', 'MS', 'AL', 'GA', 'SC'].includes(st);
  if (tag === 'trees') return TREE_STATES.has(st) && !['AZ', 'NV', 'NM'].includes(st);
  if (tag === 'generators') return GENERATOR_STATES.has(st);
  if (tag === 'tile_roof') return TILE_TURF_STATES.has(st) && st !== 'NM' && !(st === 'CA' && hub.lat > 36.2);
  if (tag === 'turf') return TILE_TURF_STATES.has(st) && !(st === 'CA' && hub.lat > 36.2);
  if (tag === 'stucco') return STUCCO_STATES.has(st) && !(st === 'CA' && hub.lat > 36.2);
  if (tag === 'termite') return TERMITE_STATES.has(st);
  if (tag === 'gates') return GATE_STATES.has(st);
  if (tag === 'solar') {
    if (!SOLAR_STATES.has(st)) return false;
    if (st === 'CA' && hub.lat > 37.8) return false;
    return true;
  }
  if (tag === 'asphalt') return !['FL', 'AZ', 'NV'].includes(hub.state);
  if (tag === 'hood') return HOOD_BONUS.has(key) || ANCHORS.has(key);
  if (tag === 'exurban') {
    if (hub.neighborCount < 5 || hub.neighborCount > 10) return false;
    if (['AZ', 'NJ', 'CA'].includes(hub.state)) return false;
    if (['Norfolk', 'Hampton', 'Newport News'].includes(hub.name)) return false;
    return true;
  }
  return true;
}

function hubFits(hub, tags) {
  const restrictive = tags.filter((t) => RESTRICTIVE_TAGS.has(t));
  if (!restrictive.length) return true;
  return restrictive.every((t) => fitOne(hub, t));
}

function goldilocksDensity(n) {
  if (n >= 6 && n <= 22) return n + 8;
  if (n >= 5 && n <= 32) return n;
  return Math.max(4, 40 - n);
}

function nicheScore(hub, tags) {
  let score = goldilocksDensity(hub.neighborCount);
  const key = keyOf(hub.name, hub.state);
  const restrictiveExurban = tags.includes('exurban');
  if (ANCHORS.has(key) && !restrictiveExurban) score += 10;
  if (tags.includes('humid') && HUMID_STATES.has(hub.state)) score += 3;
  if (tags.includes('clay') && ['TX', 'OK', 'CO', 'UT', 'MO', 'KS', 'NE', 'AL'].includes(hub.state)) score += 4;
  if (tags.includes('solar')) score += Math.max(0, 16 - hub.neighborCount);
  if (tags.includes('hood') && HOOD_BONUS.has(key)) score += 12;
  if (tags.includes('exurban')) {
    score += Math.max(0, 14 - hub.neighborCount);
    if (['AR', 'SC', 'TN', 'AL', 'ID', 'VA', 'IA', 'OK', 'NC', 'KY', 'MO', 'WA', 'OR'].includes(hub.state)) {
      score += 6;
    }
  }
  if (tags.includes('older') && (NORTHEAST.has(hub.state) || MIDWEST.has(hub.state))) score += 2;
  if (tags.includes('yards') && hub.state === 'CA') score -= 4;
  if (hub.state === 'CA' && tags.includes('nationwide')) score -= 6;
  return score;
}

function pickSpread(hubs, count, seeded = []) {
  const usedKeys = new Set(seeded.map((p) => keyOf(p.name, p.state)));
  const remaining = hubs
    .filter((h) => !usedKeys.has(keyOf(h.name, h.state)))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return b.neighborCount - a.neighborCount;
    });
  const picked = [...seeded];
  const usedDiv = new Set(picked.map((p) => p.division).filter(Boolean));

  const tooClose = (hub, other) => {
    if (hub.lng == null || hub.lat == null || other.lng == null || other.lat == null) return false;
    return haversineMiles(hub.lng, hub.lat, other.lng, other.lat) < SPREAD_MILES;
  };

  const tryPick = (preferNewDiv) => {
    for (let i = 0; i < remaining.length; i++) {
      const hub = remaining[i];
      if (picked.some((p) => tooClose(hub, p))) continue;
      if (preferNewDiv && usedDiv.has(hub.division) && usedDiv.size < 5) continue;
      picked.push(hub);
      usedDiv.add(hub.division);
      remaining.splice(i, 1);
      return true;
    }
    return false;
  };

  while (picked.length < count && remaining.length) {
    if (!tryPick(true)) {
      if (!tryPick(false)) break;
    }
  }
  for (const hub of remaining) {
    if (picked.length >= count) break;
    picked.push(hub);
  }
  return picked;
}

function nearMegaCore(place, mega) {
  return mega.some((c) => haversineMiles(place.lng, place.lat, c.lng, c.lat) <= c.miles);
}

function relabelHub(hub, incorporated, mega) {
  if (ANCHORS.has(keyOf(hub.name, hub.state))) return hub;
  const pool = [hub, ...(hub.members || [])].filter((p) => {
    if (p.state !== hub.state) return false;
    if (!incorporated.has(keyOf(p.name, p.state))) return false;
    if (p.population < HUB_MIN || p.population > 250000) return false;
    if (p.lng == null || p.lat == null) return false;
    if (haversineMiles(hub.lng, hub.lat, p.lng, p.lat) > 16) return false;
    if (nearMegaCore(p, mega)) return false;
    return true;
  });
  pool.sort((a, b) => b.population - a.population);
  const better = pool[0];
  if (better && better.name !== hub.name) {
    return { ...hub, name: better.name, population: better.population, lng: better.lng, lat: better.lat };
  }
  return hub;
}

function collectMega(places) {
  const mega = [];
  for (const core of SKIP_NEAR_CORES) {
    const hit = places.find(
      (p) => p.state === core.state && p.name.toLowerCase() === core.name.toLowerCase(),
    );
    if (hit) mega.push({ ...core, lng: hit.lng, lat: hit.lat });
  }
  return mega;
}

function zonePool(hubs, meta, count) {
  const fitted = hubs
    .filter((h) => hubFits(h, meta.tags))
    .map((h) => ({ ...h, _score: nicheScore(h, meta.tags) }));
  const fallback = hubs.map((h) => ({ ...h, _score: nicheScore(h, meta.tags) * 0.25 }));
  return fitted.length >= count ? fitted : fallback;
}

function assignZones(hubs, meta) {
  const count = meta.count || ZONE_COUNT;
  return pickSpread(zonePool(hubs, meta, count), count);
}

function completeZones(prefixLabels, hubs, meta, places) {
  const prefix = (prefixLabels || []).map((l) => String(l).trim()).filter(Boolean);
  if (prefix.length) return prefix;
  const count = ZONE_COUNT;
  const tags = meta?.tags || ['nationwide'];
  const pool = zonePool(hubs, { tags }, count);
  return pickSpread(pool, count).map(labelOf);
}

function loadGbpByNiche() {
  const rows = parseCsv(readFileSync(MERGED_PATH, 'utf8'));
  const header = rows[0];
  const iNiche = header.indexOf('niche');
  const iGbp = header.indexOf('organic_with_gbp_avg_months');
  const map = new Map();
  for (const row of rows.slice(1)) {
    map.set(String(row[iNiche] || '').trim(), Number(row[iGbp]));
  }
  return map;
}

function main() {
  console.log('Loading Census places…');
  const places = loadPlaces();
  console.log(`Places ≥ ${MIN_MEMBER_POP.toLocaleString()}: ${places.length}`);
  const incorporated = loadIncorporatedKeys();
  const mega = collectMega(places);
  const scored = scoreHubs(places, incorporated, mega);
  const hubs = [];
  const seen = new Set();
  for (const raw of dedupeHubs(scored)) {
    const h = relabelHub(raw, incorporated, mega);
    if (nearMegaCore(h, mega)) continue;
    const k = keyOf(h.name, h.state);
    if (seen.has(k)) continue;
    seen.add(k);
    hubs.push(h);
  }
  console.log(`Hubs 60k–200k with ≥${MIN_NEIGHBORS} neighbors @ ${CLUSTER_MILES} mi: ${scored.length}`);
  console.log(`Deduped zones: ${hubs.length}`);
  for (const h of hubs) {
    console.log(
      `  ${labelOf(h).padEnd(28)} pop ${String(h.population).padStart(6)}  n=${String(h.neighborCount).padStart(2)}  ${h.division}`,
    );
  }

  const gbp = loadGbpByNiche();
  const sheets = parseCsv(readFileSync(SHEETS_PATH, 'utf8'));
  const header = sheets[0];
  const iNiche = header.indexOf('niche');
  const iJob = header.indexOf('job_cost_avg_usd');
  const iTat = header.indexOf('tat_avg_days');
  const iNoGbp = header.indexOf('organic_no_gbp_avg_months');

  const outHeader = [
    'rank',
    'niche',
    'job_cost_avg_usd',
    'tat_avg_days',
    'organic_no_gbp_avg_months',
    'organic_with_gbp_avg_months',
    'geo_fit',
    ...Array.from({ length: ZONE_COUNT }, (_, i) => `zone_${i + 1}`),
  ];

  const missing = [];
  const missingFrozen = [];
  const outRows = [outHeader];
  for (const row of sheets.slice(1)) {
    const niche = String(row[iNiche] || '').trim();
    const meta = NICHE_META[niche];
    if (!meta) missing.push(niche);
    if (!ZONE_OVERRIDES[niche]?.length) missingFrozen.push(niche);
    const zones = ZONE_OVERRIDES[niche]
      ? completeZones(ZONE_OVERRIDES[niche], hubs, meta, places)
      : meta
        ? assignZones(hubs, { ...meta, count: ZONE_COUNT }).map(labelOf)
        : [];
    const gbpVal = gbp.has(niche) && Number.isFinite(gbp.get(niche)) ? gbp.get(niche) : '';
    const cells = [
      row[0],
      niche,
      row[iJob],
      row[iTat],
      row[iNoGbp],
      gbpVal,
      meta?.geoFit || '',
      ...Array.from({ length: ZONE_COUNT }, (_, i) => zones[i] || ''),
    ];
    outRows.push(cells);
  }

  if (missing.length) {
    throw new Error(`No NICHE_META for: ${missing.join('; ')}`);
  }
  if (missingFrozen.length) {
    throw new Error(`No frozen zone list for: ${missingFrozen.join('; ')}`);
  }

  const csv = `${outRows.map((r) => r.map(csvEscape).join(',')).join('\n')}\n`;
  const tmpPath = `${SHEETS_PATH}.tmp`;
  writeFileSync(tmpPath, csv);
  try {
    copyFileSync(tmpPath, SHEETS_PATH);
    unlinkSync(tmpPath);
    console.log(`Wrote ${sheets.length - 1} niches → ${SHEETS_PATH}`);
  } catch (err) {
    if (err && err.code === 'EBUSY') {
      console.error(`Locked: ${SHEETS_PATH}`);
      console.error(`Wrote ${tmpPath} instead. Close Excel and re-run, or copy the .tmp over.`);
      return;
    }
    throw err;
  }
}

main();
