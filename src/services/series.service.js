'use strict';

const httpClient = require('../lib/httpClient');
const cache      = require('../lib/cacheService');
const { CACHE_TTL } = require('../config/env');
const { mapApiItem, mapApiDetail } = require('../lib/scraper');

/**
 * Fetch and parse the main TV series browse page.
 * @returns {Promise<Array>}
 */
async function getBrowse(page = 1) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const key = `series.browse.page.${p}`;
  if (cache.isHit(key, CACHE_TTL.page)) return cache.get(key);

  const data = await httpClient.getJson(`/api/series?page=${p}&limit=36&sort=createdAt`);
  const items = (data?.data || []).map(mapApiItem).filter(Boolean);
  
  cache.set(key, items);
  return items;
}

/**
 * Fetch and parse trending TV series from the homepage.
 * @returns {Promise<Array>}
 */
async function getTrending() {
  const key = 'trending.tv';
  if (cache.isHit(key, CACHE_TTL.trending)) return cache.get(key);

  const data = await httpClient.getJson('/api/homepage');
  if (!data || !data.above) return [];

  const section = data.above.find(s => s.title && s.title.toLowerCase().includes('trending')) || data.above[0];
  const items = (section?.data || []).map(mapApiItem).filter(i => i.type === 'series');
  
  cache.set(key, items);
  return items;
}

/**
 * Fetch a series detail page by slug and populate episodes for all seasons.
 *
 * @param {string} slug - e.g. "a-shop-for-killers-2024"
 * @returns {Promise<Object>}
 */
async function getDetail(slug) {
  const key = `series.detail.${slug}`;
  if (cache.isHit(key, CACHE_TTL.detail)) return cache.get(key);

  const data = await httpClient.getJson(`/api/series/${slug}`);
  const detail = mapApiDetail(data);

  if (!detail.title) {
    const err = new Error('Series not found');
    err.status = 404;
    throw err;
  }

  // Populate episode details for each season
  if (detail.seasons && detail.seasons.length > 0) {
    await Promise.all(
      detail.seasons.map(async (season) => {
        try {
          const seasonRes = await httpClient.getJson(`/api/series/${slug}/season/${season.seasonNumber}`);
          if (seasonRes && seasonRes.season && seasonRes.season.episodes) {
            season.episodes = seasonRes.season.episodes.map(e => ({
              episodeNumber: e.episodeNumber,
              title: e.name || e.title || `Episode ${e.episodeNumber}`,
              overview: e.overview || null,
              stillPath: e.stillPath ? `https://image.tmdb.org/t/p/w300${e.stillPath}` : null,
              airDate: e.airDate || null,
              runtime: e.runtime || null,
              rating: e.voteAverage ? parseFloat(e.voteAverage) : null
            }));
          }
        } catch (_) {}
      })
    );
  }

  cache.set(key, detail);
  return detail;
}

/**
 * Fetch specific season details (with episode list) for a series.
 *
 * @param {string} slug
 * @param {number|string} seasonNumber
 * @returns {Promise<Object>}
 */
async function getSeasonDetail(slug, seasonNumber) {
  const key = `series.season.${slug}.${seasonNumber}`;
  if (cache.isHit(key, CACHE_TTL.detail)) return cache.get(key);

  const data = await httpClient.getJson(`/api/series/${slug}/season/${seasonNumber}`);
  if (!data || !data.season) {
    const err = new Error('Season not found');
    err.status = 404;
    throw err;
  }

  const seasonData = {
    seasonNumber: data.season.seasonNumber,
    name: data.season.name,
    overview: data.season.overview || null,
    airDate: data.season.airDate || null,
    episodeCount: data.season.episodeCount || 0,
    episodes: (data.season.episodes || []).map(e => ({
      episodeNumber: e.episodeNumber,
      title: e.name || e.title || `Episode ${e.episodeNumber}`,
      overview: e.overview || null,
      stillPath: e.stillPath ? `https://image.tmdb.org/t/p/w300${e.stillPath}` : null,
      airDate: e.airDate || null,
      runtime: e.runtime || null,
      rating: e.voteAverage ? parseFloat(e.voteAverage) : null
    }))
  };

  cache.set(key, seasonData);
  return seasonData;
}

/**
 * Fetch the stream data for a series episode: URL, subtitles, and metadata.
 *
 * Delegates to httpClient.getStreamData which runs the full API chain.
 * Results are cached with a short TTL since stream URLs expire.
 *
 * @param {string} slug - e.g. "the-last-of-us-2023"
 * @returns {Promise<Object>}
 */
async function getStreamData(slug) {
  const key = `series.stream.${slug}`;
  if (cache.isHit(key, CACHE_TTL.stream)) return cache.get(key);

  const result = await httpClient.getStreamData(slug, 'series');
  if (result.streamUrl) cache.set(key, result);
  return result;
}

/**
 * Fetch stream data for a specific series episode.
 *
 * @param {string} slug    - e.g. "oasis-2026"
 * @param {number} season  - Season number (1-based)
 * @param {number} episode - Episode number (1-based)
 * @returns {Promise<Object>}
 */
async function getEpisodeStreamData(slug, season, episode) {
  const key = `series.stream.${slug}.s${season}e${episode}`;
  if (cache.isHit(key, CACHE_TTL.stream)) return cache.get(key);

  const result = await httpClient.getEpisodeStreamData(slug, Number(season), Number(episode));
  if (result.streamUrl) cache.set(key, result);
  return result;
}

module.exports = {
  getBrowse,
  getTrending,
  getDetail,
  getSeasonDetail,
  getStreamData,
  getEpisodeStreamData,
};