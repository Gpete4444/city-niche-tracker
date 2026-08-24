import { lookupPopulation, normalizePlaceName } from './census.mjs';
import { placesIntersectingRadius } from './geo-neighbors.mjs';

export const V15_POPULATION_CONTEXT_PARAMETERS = Object.freeze({
  nearbyCityRadiusMiles: 40,
  nearbyCityMinPopulation: 5000,
});

const MAP_SETUP_MESSAGE =
  'Nearby population context unavailable. Run: npm run build-research-map';

function finitePopulation(value) {
  const population = Number(value);
  return Number.isFinite(population) && population >= 0 ? population : null;
}

export function populationPlaceKey(city, state) {
  return `${normalizePlaceName(city)}|${String(state || '').trim().toUpperCase()}`;
}

export function normalizePopulationContextParameters(parameters = {}) {
  const radius = Number(parameters.nearbyCityRadiusMiles);
  const minimum = Number(parameters.nearbyCityMinPopulation);
  return {
    nearbyCityRadiusMiles:
      Number.isFinite(radius) && radius >= 1 && radius <= 120
        ? radius
        : V15_POPULATION_CONTEXT_PARAMETERS.nearbyCityRadiusMiles,
    nearbyCityMinPopulation:
      Number.isFinite(minimum) && minimum >= 0
        ? minimum
        : V15_POPULATION_CONTEXT_PARAMETERS.nearbyCityMinPopulation,
  };
}

export function evaluatePopulationContext({
  city,
  state,
  cityPopulation,
  nearbyPlaces = [],
  nearbyStatus = 'available',
  selectedBandMin = 70000,
  selectedBandMax = 200000,
  nearbyCityRadiusMiles,
  nearbyCityMinPopulation,
  explicitlySelected = false,
  setupMessage = null,
} = {}) {
  const parameters = normalizePopulationContextParameters({
    nearbyCityRadiusMiles,
    nearbyCityMinPopulation,
  });
  const population = finitePopulation(cityPopulation);
  const bandMin = finitePopulation(selectedBandMin) ?? 70000;
  const bandMax = finitePopulation(selectedBandMax) ?? 200000;
  const targetKey = populationPlaceKey(city, state);
  const seen = new Set([targetKey]);
  const contributingPlaces = [];

  if (nearbyStatus === 'available') {
    for (const place of nearbyPlaces || []) {
      const key = populationPlaceKey(place?.name ?? place?.city, place?.state ?? state);
      const nearbyPlacePopulation = finitePopulation(place?.population);
      if (!key || seen.has(key) || nearbyPlacePopulation == null) continue;
      seen.add(key);
      if (nearbyPlacePopulation < parameters.nearbyCityMinPopulation) continue;
      contributingPlaces.push({
        name: String(place?.name ?? place?.city ?? '').trim(),
        state: String(place?.state ?? state ?? '').trim().toUpperCase(),
        population: nearbyPlacePopulation,
      });
    }
  }

  const nearbyPopulation =
    nearbyStatus === 'available' && population != null
      ? population + contributingPlaces.reduce((sum, place) => sum + place.population, 0)
      : null;
  const cityWithinBand = population != null && population >= bandMin && population <= bandMax;
  const qualifiesFromNearby =
    population != null
    && population < bandMin
    && nearbyPopulation != null
    && nearbyPopulation >= bandMin;
  const supportedByBoth = cityWithinBand && contributingPlaces.length > 0;
  const qualifiesBy = supportedByBoth
    ? 'both'
    : cityWithinBand
      ? 'city'
      : qualifiesFromNearby
        ? 'nearby_population'
        : 'outside_preference';

  return {
    version: 1,
    city: String(city || '').trim(),
    state: String(state || '').trim().toUpperCase(),
    cityPopulation: population,
    nearbyPopulation,
    nearbyPlaces: contributingPlaces,
    nearbyStatus,
    selectedBandMin: bandMin,
    selectedBandMax: bandMax,
    nearbyCityRadiusMiles: parameters.nearbyCityRadiusMiles,
    nearbyCityMinPopulation: parameters.nearbyCityMinPopulation,
    qualifiesBy,
    eligible: cityWithinBand || qualifiesFromNearby || Boolean(explicitlySelected),
    explicitlySelected: Boolean(explicitlySelected),
    approximate: true,
    setupMessage:
      nearbyStatus === 'available'
        ? null
        : setupMessage || MAP_SETUP_MESSAGE,
  };
}

export function buildPopulationContext(input = {}, dependencies = {}) {
  const lookupPopulationFn = dependencies.lookupPopulationFn || lookupPopulation;
  const placesIntersectingRadiusFn =
    dependencies.placesIntersectingRadiusFn || placesIntersectingRadius;
  const parameters = normalizePopulationContextParameters(input);
  let cityPopulation = finitePopulation(
    lookupPopulationFn(input.city, input.state),
  );

  try {
    const local = placesIntersectingRadiusFn(
      input.city,
      input.state,
      parameters.nearbyCityRadiusMiles,
      { minPop: parameters.nearbyCityMinPopulation },
    );
    if (cityPopulation == null) cityPopulation = finitePopulation(local?.primary?.population);
    return evaluatePopulationContext({
      ...input,
      ...parameters,
      cityPopulation,
      nearbyPlaces: local?.places || [],
      nearbyStatus: 'available',
    });
  } catch (error) {
    return evaluatePopulationContext({
      ...input,
      ...parameters,
      cityPopulation,
      nearbyPlaces: [],
      nearbyStatus: 'unavailable',
      setupMessage:
        error?.code === 'map_data_missing' || error?.code === 'map_neighbors_missing'
          ? MAP_SETUP_MESSAGE
          : `Nearby population context unavailable for ${input.city}, ${input.state}. Run: npm run build-research-map`,
    });
  }
}

export function buildPopulationContexts(candidates = [], settings = {}, dependencies = {}) {
  return (candidates || []).map((candidate) =>
    buildPopulationContext(
      {
        ...settings,
        city: candidate.city,
        state: candidate.state,
        explicitlySelected: candidate.explicitlySelected === true,
      },
      dependencies,
    ),
  );
}
