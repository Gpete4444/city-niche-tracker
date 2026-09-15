/**
 * Discovery pack multi-state regions (filters, brief, label, known-state list).
 * Run: node scripts/test-discovery-pack-regions.mjs
 */
import {
  autoLabel,
  buildFilterBrief,
  normalizeFilters,
} from '../ops/lib/discovery.mjs';
import { knownStateFilterList } from '../ops/lib/known-candidates.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

const nationwide = normalizeFilters({});
assertEqual(nationwide.regions.length, 0, 'nationwide regions');
assertEqual(nationwide.state, '', 'nationwide state');
assertEqual(nationwide.cities.length, 0, 'nationwide cities');
assert(buildFilterBrief({}).includes('ANY (nationwide'), 'nationwide brief state');
assert(buildFilterBrief({}).includes('OPEN nationwide'), 'nationwide brief cities');
assertEqual(autoLabel(nationwide), 'us-open-niches', 'nationwide label');

const one = normalizeFilters({ state: 'ky', cities: ['Louisville', 'Lexington'] });
assertEqual(one.state, 'KY', 'legacy state');
assertEqual(one.states.join(','), 'KY', 'legacy states');
assertEqual(one.cities.join(','), 'Louisville,Lexington', 'legacy cities');
assertEqual(one.regions.length, 1, 'legacy one region');
const oneBrief = buildFilterBrief({ state: 'KY', cities: ['Louisville', 'Lexington'] });
assert(oneBrief.includes('- **Markets:**'), 'single-state markets header');
assert(oneBrief.includes('KY: Louisville; Lexington'), 'single-state cities');
assert(!oneBrief.includes('- **State:** KY'), 'no lone State line when markets set');
assertEqual(autoLabel(one), 'ky-open-niches', 'single-state label');

const openState = buildFilterBrief({
  regions: [{ state: 'IN', cities: [] }],
});
assert(openState.includes('IN: OPEN within IN'), 'open within state');

const two = normalizeFilters({
  regions: [
    { state: 'KY', cities: ['Louisville', 'Lexington'] },
    { state: 'IN', cities: ['Indianapolis'] },
  ],
});
assertEqual(two.states.join(','), 'KY,IN', 'two states');
assertEqual(two.state, 'KY', 'compat first state');
assertEqual(two.cities.join(','), 'Louisville,Lexington,Indianapolis', 'flattened cities');
const twoBrief = buildFilterBrief({
  regions: [
    { state: 'KY', cities: ['Louisville', 'Lexington'] },
    { state: 'IN', cities: ['Indianapolis'] },
  ],
});
assert(twoBrief.includes('KY: Louisville; Lexington'), 'ky market line');
assert(twoBrief.includes('IN: Indianapolis'), 'in market line');
assertEqual(autoLabel(two), 'ky-in-open-niches', 'multi-state label');

const merged = normalizeFilters({
  regions: [
    { state: 'KY', cities: ['Louisville'] },
    { state: 'KY', cities: ['Lexington'] },
  ],
});
assertEqual(merged.regions.length, 1, 'duplicate states merged');
assertEqual(merged.cities.join(','), 'Louisville,Lexington', 'merged cities');

assertEqual(knownStateFilterList(null), null, 'known nationwide null');
assertEqual(knownStateFilterList(''), null, 'known nationwide empty');
assertEqual(knownStateFilterList('ky')?.join(','), 'KY', 'known string');
assertEqual(knownStateFilterList(['KY', 'in', 'KY'])?.join(','), 'KY,IN', 'known array unique');
assertEqual(knownStateFilterList(['Kentucky']), null, 'known rejects names');

console.log('test-discovery-pack-regions: ok');
