import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluatePrimarySerpScreen, visibleRecommendationForScreen, V15_PACKAGE1_SCREEN_PARAMETERS } from '../ops/lib/v15-primary-serp-screen.mjs';
import { runPackage1Replay } from '../scripts/v15-package1-replay.mjs';
import { recommendDiscoveryRow } from '../ops/lib/discovery-recommend.mjs';
import {
  DISCOVERY_COLUMNS,
  DISCOVERY_RUNTIME_COLUMNS,
  PROMOTE_DECISIONS,
  parseCsv,
  rowsToDiscoveryPackCsv,
  rowsToDiscoveryRuntimeCsv,
} from '../ops/lib/discovery.mjs';
import { applySerpToRow } from '../ops/lib/discovery-serp-probe.mjs';

const domains=(count)=>Array.from({length:count},(_,index)=>`organic-${index}.example`);
const classified=({count=0,map=false,paid=0,lsa=false,homes=0,subs=0,nicheCount=0,directories=0}={})=>({uniqueOrganicDomains:domains(count),uniqueNicheOrganicDomains:domains(nicheCount),mapPackPresent:map,localPack:map?[{title:'Fixture Local'}]:[],paidAds:{count:paid,links:[]},features:{paid:paid>0,localServicesAds:lsa},organicHomePages:{count:homes},organicSubPages:{count:subs},directories:{count:directories}});
const screen=(options,rawItems=[])=>evaluatePrimarySerpScreen({classified:classified(options),rawItems});

test('Package-1 default replay parameters are B=7 and C=6', () => {
  assert.deepEqual(V15_PACKAGE1_SCREEN_PARAMETERS, {
    minDistinctOrganicDomainsForB: 7,
    minDistinctOrganicDomainsForC: 6,
  });
});

test('Discovery Pack schema does not expose Package-1 internal screen fields', () => {
  const csv = rowsToDiscoveryPackCsv([]);
  const header = csv.trimEnd().split(/\r?\n/)[0];

  for (const field of [
    'screenDecision',
    'screenRule',
    'screenReason',
    'screenUniqueOrganicDomainCount',
    'screenUniqueNicheOrganicDomainCount',
    'screenMapPackPresent',
    'screenPaidPresent',
    'screenPaidCount',
    'screenLsaPresent',
    'screenOrganicHomePageCount',
    'screenOrganicSubPageCount',
    'screenDirectoryCount',
    'screenParameters',
  ]) {
    assert.equal(header.includes(field), false, field);
    assert.equal(DISCOVERY_COLUMNS.includes(field), false, field);
  }
});

test('Discovery Pack writer strips populated runtime-only evidence', () => {
  const csv = rowsToDiscoveryPackCsv([
    {
      Niche: 'PACK_VISIBLE_NICHE',
      City: 'Draper',
      State: 'UT',

      screenDecision: 'SCREEN_DECISION_SENTINEL',
      screenRule: 'SCREEN_RULE_SENTINEL',
      screenReason: 'SCREEN_REASON_SENTINEL',
      screenUniqueOrganicDomainCount: '901',
      screenUniqueNicheOrganicDomainCount: '902',
      screenMapPackPresent: 'SCREEN_MAP_SENTINEL',
      screenPaidPresent: 'SCREEN_PAID_SENTINEL',
      screenPaidCount: '903',
      screenLsaPresent: 'SCREEN_LSA_SENTINEL',
      screenOrganicHomePageCount: '904',
      screenOrganicSubPageCount: '905',
      screenDirectoryCount: '906',
      screenParameters: 'SCREEN_PARAMETERS_SENTINEL',
      populationContext: 'POPULATION_CONTEXT_SENTINEL',
    },
  ]);

  for (const runtimeField of [
    'screenDecision',
    'screenRule',
    'screenReason',
    'screenUniqueOrganicDomainCount',
    'screenUniqueNicheOrganicDomainCount',
    'screenMapPackPresent',
    'screenPaidPresent',
    'screenPaidCount',
    'screenLsaPresent',
    'screenOrganicHomePageCount',
    'screenOrganicSubPageCount',
    'screenDirectoryCount',
    'screenParameters',
    'populationContext',
  ]) {
    assert.equal(csv.includes(runtimeField), false, runtimeField);
  }

  for (const sentinel of [
    'SCREEN_DECISION_SENTINEL',
    'SCREEN_RULE_SENTINEL',
    'SCREEN_REASON_SENTINEL',
    'SCREEN_MAP_SENTINEL',
    'SCREEN_PAID_SENTINEL',
    'SCREEN_LSA_SENTINEL',
    'SCREEN_PARAMETERS_SENTINEL',
    'POPULATION_CONTEXT_SENTINEL',
    '901',
    '902',
    '903',
    '904',
    '905',
    '906',
  ]) {
    assert.equal(csv.includes(sentinel), false, sentinel);
  }

  assert.match(csv, /PACK_VISIBLE_NICHE/);
  assert.match(csv, /Draper/);
  assert.match(csv, /UT/);
});

test('runtime Discovery schema contains Package-1 screen persistence fields', () => {
  for (const field of [
    'screenDecision',
    'screenRule',
    'screenReason',
    'screenUniqueOrganicDomainCount',
    'screenParameters',
  ]) {
    assert.equal(DISCOVERY_RUNTIME_COLUMNS.includes(field), true, field);
  }
});

test('runtime CSV round-trip preserves primary-SERP screen evidence', () => {
  const input = [{
    Niche: 'Artificial Turf Installation',
    City: 'Draper',
    State: 'UT',
    recommended_decision: 'review',
    screenDecision: 'SURVIVE',
    screenRule: 'NONE',
    screenReason: 'No Package-1 screen-out rule fired',
    screenUniqueOrganicDomainCount: '6',
    screenUniqueNicheOrganicDomainCount: '2',
    screenMapPackPresent: 'true',
    screenPaidPresent: 'false',
    screenPaidCount: '0',
    screenLsaPresent: 'false',
    screenOrganicHomePageCount: '2',
    screenOrganicSubPageCount: '4',
    screenDirectoryCount: '2',
    screenParameters: JSON.stringify({
      minDistinctOrganicDomainsForB: 7,
      minDistinctOrganicDomainsForC: 6,
    }),
  }];

  const csv = rowsToDiscoveryRuntimeCsv(input);
  const [saved] = parseCsv(csv);

  assert.equal(saved.screenDecision, 'SURVIVE');
  assert.equal(saved.screenRule, 'NONE');
  assert.equal(
    saved.screenReason,
    'No Package-1 screen-out rule fired',
  );
  assert.equal(saved.screenUniqueOrganicDomainCount, '6');

  const recommendation = recommendDiscoveryRow(saved);
  assert.equal(recommendation.recommended_decision, 'review');
});
test('Map Pack plus two homes and six domains without paid or LSA survives',()=>assert.deepEqual(screen({count:6,map:true,homes:2}).screenDecision,'SURVIVE'));
test('Map Pack alone survives',()=>assert.equal(screen({map:true}).screenDecision,'SURVIVE'));
test('one strong competitor survives',()=>assert.equal(screen({count:1,homes:1}).screenDecision,'SURVIVE'));
test('several subpages below seven domains survive',()=>assert.equal(screen({count:5,subs:8}).screenDecision,'SURVIVE'));
test('six domains without paid or LSA survive',()=>assert.equal(screen({count:6}).screenDecision,'SURVIVE'));
test('one paid ad alone cannot screen out',()=>assert.equal(screen({count:1,paid:1}).screenDecision,'SURVIVE'));
test('LSA alone cannot screen out',()=>assert.equal(screen({count:1,lsa:true}).screenDecision,'SURVIVE'));
test('six domains plus paid remain contextual under Rule C evidence',()=>{const result=screen({count:6,paid:1});assert.deepEqual([result.screenDecision,result.screenRule],['SURVIVE','NONE']);assert.match(result.screenReason,/paid\/LSA pressure is context only/i);})
test('six domains plus LSA remain contextual under Rule C evidence',()=>{const result=screen({count:6,lsa:true});assert.deepEqual([result.screenDecision,result.screenRule],['SURVIVE','NONE']);assert.match(result.screenReason,/paid\/LSA pressure is context only/i);})
test('seven domains without paid or LSA survive because domain count alone is context', () => {
  const result = screen({ count: 7 });

  assert.equal(result.screenDecision, 'SURVIVE');
  assert.equal(result.screenRule, 'NONE');
  assert.match(
    result.screenReason,
    /high organic-domain diversity is context only/i,
  );
});
test('eight or nine domains alone still cannot hard-stop', () => {
  for (const count of [8, 9]) {
    const result = screen({ count });

    assert.equal(result.screenDecision, 'SURVIVE');
    assert.equal(result.screenRule, 'NONE');
  }
});
test('Rule C evidence stays visible without hard-stopping high domain diversity', () => {
  const result = screen({ count: 7, paid: 1 });

  assert.equal(result.screenDecision, 'SURVIVE');
  assert.equal(result.screenRule, 'NONE');
  assert.match(result.screenReason, /review carefully/i);
});
test('clearly wrong-intent organic majority screens out under Rule A',()=>{const raw=[0,1,2,3,4].map((index)=>({type:'organic',title:index<3?`Plumber jobs and salary ${index}`:`Local contractor ${index}`,url:`https://example-${index}.com`}));const result=screen({count:2},raw);assert.deepEqual([result.screenDecision,result.screenRule],['SCREEN_OUT','A']);});
test('one informational result is insufficient for Rule A',()=>{const raw=[{type:'organic',title:'What is repair',url:'https://wikipedia.org/x'},...Array.from({length:4},(_,index)=>({type:'organic',title:`Local contractor ${index}`,url:`https://local-${index}.com`}))];assert.equal(screen({count:2},raw).screenDecision,'SURVIVE');});
test('directory-heavy raw results cannot inflate authoritative B/C count',()=>assert.equal(screen({count:2,directories:8}).screenDecision,'SURVIVE'));
test('raw organic recount cannot override classified uniqueOrganicDomains',()=>{const raw=domains(10).map((domain)=>({type:'organic',title:'Local contractor',url:`https://${domain}`}));assert.equal(screen({count:2},raw).screenDecision,'SURVIVE');});
test('uniqueNicheOrganicDomains cannot independently screen out',()=>assert.equal(screen({count:2,nicheCount:20}).screenDecision,'SURVIVE'));
test('visible mappings are SCREEN_OUT to deprioritize and SURVIVE to review, never pursue',()=>{assert.equal(visibleRecommendationForScreen('SCREEN_OUT'),'deprioritize');assert.equal(visibleRecommendationForScreen('SURVIVE'),'review');assert.notEqual(visibleRecommendationForScreen('SURVIVE'),'pursue');});
test('Discovery compatibility mapping uses screen state and retains its deterministic reason',()=>{const out=recommendDiscoveryRow({screenDecision:'SURVIVE',screenReason:'keep researching'});assert.deepEqual(out,{recommended_decision:'review',recommended_reason:'keep researching'});assert.equal(recommendDiscoveryRow({screenDecision:'SCREEN_OUT'}).recommended_decision,'deprioritize');});
test('legacy Map Pack plus homepage evidence is no longer an independent veto',()=>{const out=recommendDiscoveryRow({'Map Pack':'Yes','Organic Home Page':'5',confidence_serp:'high',serp_source:'dataforseo'});assert.equal(out.recommended_decision,'review');});
test('Process promotion list remains unchanged',()=>assert.deepEqual(PROMOTE_DECISIONS,['pursue','maybe','review','hold']));
test('Discovery SERP probe persists internal screen evidence for recommendation mapping',()=>{const saved=classified({count:6,map:true,homes:2});const row=applySerpToRow({Niche:'Artificial Turf Installation'},saved,'https://check.example',{items:[]});assert.equal(row.screenDecision,'SURVIVE');assert.equal(row.screenRule,'NONE');assert.equal(row.screenUniqueOrganicDomainCount,6);assert.deepEqual(JSON.parse(row.screenParameters),V15_PACKAGE1_SCREEN_PARAMETERS);assert.equal(recommendDiscoveryRow(row).recommended_decision,'review');});
test('Rule-B context threshold remains configurable without becoming a hard veto', () => {
  const result = evaluatePrimarySerpScreen(
    {
      classified: classified({ count: 5 }),
      rawItems: [],
    },
    {
      minDistinctOrganicDomainsForB: 5,
      minDistinctOrganicDomainsForC: 4,
    },
  );

  assert.equal(result.screenDecision, 'SURVIVE');
  assert.equal(result.screenRule, 'NONE');
  assert.match(
    result.screenReason,
    /high organic-domain diversity is context only/i,
  );
});
test('identical evidence and parameters produce identical output',()=>{const input={classified:classified({count:6,map:true,homes:2}),rawItems:[]};assert.deepEqual(evaluatePrimarySerpScreen(input),evaluatePrimarySerpScreen(input));});
test('tracked Package-1 fixture set contains exactly 27 saved SERPs', async () => {
  const fixtureRoot = path.resolve(
    'test',
    'fixtures',
    'v15-package1',
  );

  const candidatesPath = path.join(
    fixtureRoot,
    'candidates.csv',
  );

  const cacheDir = path.join(
    fixtureRoot,
    'serp-cache',
  );

  const candidateText = await fs.readFile(
    candidatesPath,
    'utf8',
  );

  assert.ok(candidateText.includes('Niche'));

  const names = (
    await fs.readdir(cacheDir)
  ).filter((name) => name.endsWith('.json'));

  assert.equal(names.length, 27);

  for (const name of names) {
    const saved = JSON.parse(
      await fs.readFile(
        path.join(cacheDir, name),
        'utf8',
      ),
    );

    assert.ok(Number.isInteger(saved.rowIndex));
    assert.ok(String(saved.rowKey || '').trim());
    assert.ok(Array.isArray(saved.items));
    assert.ok(saved.classified);
    assert.ok(
      Array.isArray(saved.classified.uniqueOrganicDomains),
    );
  }
});
test('controlled NC replay remains conservative at zero provider cost', async () => {
  const report = await runPackage1Replay();

  assert.equal(report.totalRows, 27);
  assert.equal(report.screenOutCount, 0);
  assert.equal(report.surviveCount, 27);

  assert.deepEqual(report.ruleHistogram, {
    A: 0,
    B: 0,
    C: 0,
    NONE: 27,
  });

  assert.equal(report.providerCalls, 0);
  assert.equal(report.fixtureReusePercent, 100);
});
test('Wilmington Artificial Turf survives generically',async()=>{const report=await runPackage1Replay();const row=report.rows.find((item)=>item.city==='Wilmington'&&item.niche==='Artificial Turf Installation');assert.equal(row.screenDecision,'SURVIVE');assert.equal(row.screenRule,'NONE');});
test('replay fails closed on a missing fixture',async()=>{const source=path.resolve('test','fixtures','v15-package1');const temp=await fs.mkdtemp(path.join(os.tmpdir(),'v15-package1-missing-'));await fs.mkdir(path.join(temp,'serp-cache'));await fs.copyFile(path.join(source,'candidates.csv'),path.join(temp,'candidates.csv'));const names=(await fs.readdir(path.join(source,'serp-cache'))).slice(0,26);for(const name of names)await fs.copyFile(path.join(source,'serp-cache',name),path.join(temp,'serp-cache',name));await assert.rejects(runPackage1Replay({fixtureDir:temp}),/fixture set incomplete/);});
test('Package-1 replay executes offline with provider credentials removed and fetch blocked', () => {
  const env = { ...process.env };

  for (const key of [
    'DATAFORSEO_LOGIN',
    'DATAFORSEO_PASSWORD',
    'DATAFORSEO_USERNAME',
    'DATAFORSEO_AUTH',
    'ANTHROPIC_API_KEY',
    'GOOGLE_MAPS_API_KEY',
    'APIFY_TOKEN',
  ]) {
    delete env[key];
  }

  const childSource = `
    globalThis.fetch = () => {
      throw new Error('NETWORK_CALL_FORBIDDEN');
    };

    const path = await import('node:path');
    const { runPackage1Replay } =
      await import('./scripts/v15-package1-replay.mjs');

    const report = await runPackage1Replay({
      fixtureDir: path.resolve(
        'test',
        'fixtures',
        'v15-package1'
      ),
    });

    if (report.totalRows !== 27) {
      throw new Error(
        'unexpected totalRows: ' + report.totalRows
      );
    }

    if (report.providerCalls !== 0) {
      throw new Error(
        'unexpected providerCalls: ' + report.providerCalls
      );
    }

    if (report.fixtureReusePercent !== 100) {
      throw new Error(
        'unexpected fixtureReusePercent: ' +
          report.fixtureReusePercent
      );
    }

    console.log(JSON.stringify({
      totalRows: report.totalRows,
      screenOutCount: report.screenOutCount,
      surviveCount: report.surviveCount,
      providerCalls: report.providerCalls,
      fixtureReusePercent: report.fixtureReusePercent,
    }));
  `;

  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', childSource],
    {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    },
  );

  assert.equal(
    child.status,
    0,
    child.stderr || child.stdout,
  );

  const lines = String(child.stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  const report = JSON.parse(lines[lines.length - 1]);

  assert.deepEqual(report, {
    totalRows: 27,
    screenOutCount: 0,
    surviveCount: 27,
    providerCalls: 0,
    fixtureReusePercent: 100,
  });
});
test('Package-1 replay CLI does not write artifacts unless output-dir is explicit', () => {
  const env = { ...process.env };

  for (const key of [
    'DATAFORSEO_LOGIN',
    'DATAFORSEO_PASSWORD',
    'DATAFORSEO_USERNAME',
    'DATAFORSEO_AUTH',
    'ANTHROPIC_API_KEY',
    'GOOGLE_MAPS_API_KEY',
    'APIFY_TOKEN',
  ]) {
    delete env[key];
  }

  const child = spawnSync(
    process.execPath,
    ['scripts/v15-package1-replay.mjs'],
    {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    },
  );

  assert.equal(
    child.status,
    0,
    child.stderr || child.stdout,
  );

  const report = JSON.parse(
    String(child.stdout || '').trim(),
  );

  assert.equal(report.outputDir, null);
  assert.equal(report.totalRows, 27);
  assert.equal(report.screenOutCount, 0);
  assert.equal(report.surviveCount, 27);
  assert.equal(report.providerCalls, 0);
  assert.equal(report.fixtureReusePercent, 100);
  assert.deepEqual(report.ruleHistogram, {
    A: 0,
    B: 0,
    C: 0,
    NONE: 27,
  });
});

test('Package-1 replay CLI writes artifacts only when output-dir is explicit', async () => {
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'v15-package1-cli-output-'),
  );

  const env = { ...process.env };

  for (const key of [
    'DATAFORSEO_LOGIN',
    'DATAFORSEO_PASSWORD',
    'DATAFORSEO_USERNAME',
    'DATAFORSEO_AUTH',
    'ANTHROPIC_API_KEY',
    'GOOGLE_MAPS_API_KEY',
    'APIFY_TOKEN',
  ]) {
    delete env[key];
  }

  try {
    const child = spawnSync(
      process.execPath,
      [
        'scripts/v15-package1-replay.mjs',
        '--output-dir',
        outputDir,
      ],
      {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      },
    );

    assert.equal(
      child.status,
      0,
      child.stderr || child.stdout,
    );

    const report = JSON.parse(
      String(child.stdout || '').trim(),
    );

    assert.equal(
      path.resolve(report.outputDir),
      path.resolve(outputDir),
    );

    assert.equal(report.totalRows, 27);
    assert.equal(report.screenOutCount, 0);
    assert.equal(report.surviveCount, 27);
    assert.equal(report.providerCalls, 0);
    assert.equal(report.fixtureReusePercent, 100);

    for (const filename of [
      'report.json',
      'report.md',
      'rows.json',
    ]) {
      const stat = await fs.stat(
        path.join(outputDir, filename),
      );

      assert.equal(stat.isFile(), true, filename);
    }
  } finally {
    await fs.rm(
      outputDir,
      {
        recursive: true,
        force: true,
      },
    );
  }
});
test('replay has no live/provider import or invocation path',async()=>{const source=await fs.readFile(new URL('../scripts/v15-package1-replay.mjs',import.meta.url),'utf8');for(const forbidden of ['fetchOrganicSerp','dataForSeoRequest','fetchMaps','fetchSearchVolumes','fetchRelatedKeywords','anthropic','fetch('])assert.equal(source.includes(forbidden),false,forbidden);});
