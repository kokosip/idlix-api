'use strict';

const { BASE_URL } = require('../config/env');

/**
 * Maps a native JSON API item from IDLIX into our standardized schema.
 * @param {Object} item - The raw JSON item from /api/movies or /api/homepage
 * @returns {Object} Standardized media item
 */
function mapApiItem(item) {
  if (!item) return null;

  // IDLIX API often wraps media items inside a nested property (movie, series, content, media, item, data)
  const target = item.movie || item.series || item.content || item.media || item.item || item.data || item;

  const contentType = item.contentType || item.content_type || item.type || target.contentType || target.content_type || target.type;
  const isSeries = contentType === 'series' ||
                   contentType === 'tv' ||
                   contentType === 'tv_series' ||
                   !!item.series ||
                   !!target.numberOfSeasons ||
                   !!target.number_of_seasons ||
                   !!target.firstAirDate ||
                   !!target.first_air_date ||
                   (Array.isArray(target.seasons) && target.seasons.length > 0);

  const slug = target.slug || item.slug;
  const endpoint = `${isSeries ? 'series' : 'movie'}/${slug || 'undefined'}`;

  let year = null;
  const dateStr = target.releaseDate || target.release_date || target.firstAirDate || target.first_air_date || target.year ||
                  item.releaseDate || item.release_date || item.firstAirDate || item.first_air_date || item.year;
  if (dateStr) {
    year = parseInt(String(dateStr).substring(0, 4), 10) || null;
  }

  const posterPath = target.posterPath || target.poster_path || target.poster || item.posterPath || item.poster_path || item.poster;
  let posterUrl = null;
  if (posterPath) {
    posterUrl = posterPath.startsWith('http') ? posterPath : `https://image.tmdb.org/t/p/w300${posterPath}`;
  }

  const voteAverage = target.voteAverage ?? target.vote_average ?? target.rating ?? item.voteAverage ?? item.vote_average ?? item.rating;
  const title = target.title || target.name || item.title || item.name || '';
  const originalTitle = target.originalTitle || target.original_title || item.originalTitle || item.original_title || title;

  return {
    title,
    originalTitle,
    year,
    type: isSeries ? 'series' : 'movie',
    quality: target.quality || target.videoQuality || item.quality || null,
    rating: voteAverage !== undefined && voteAverage !== null && !isNaN(parseFloat(voteAverage)) ? parseFloat(voteAverage) : null,
    season: target.season || item.season || null,
    poster: posterUrl,
    slug: slug || null,
    link: {
      endpoint,
      url: `${BASE_URL}/${endpoint}`,
      thumbnail: posterUrl
    }
  };
}

/**
 * Maps a native JSON API detail item from IDLIX into our standardized schema.
 * @param {Object} item - The raw JSON item from /api/movies/:slug or /api/series/:slug
 * @returns {Object} Standardized detail item
 */
function mapApiDetail(item) {
  if (!item) return {};

  const target = item.movie || item.series || item.content || item.media || item.detail || item.data || item;
  const contentType = item.contentType || item.content_type || item.type || target.contentType || target.content_type || target.type;
  const isSeries = contentType === 'series' ||
                   contentType === 'tv' ||
                   contentType === 'tv_series' ||
                   !!item.series ||
                   !!target.numberOfSeasons ||
                   !!target.number_of_seasons ||
                   !!target.firstAirDate ||
                   !!target.first_air_date ||
                   (Array.isArray(target.seasons) && target.seasons.length > 0);

  const slug = target.slug || item.slug;
  const endpoint = `${isSeries ? 'series' : 'movie'}/${slug || ''}`;

  let year = null;
  const dateStr = target.releaseDate || target.release_date || target.firstAirDate || target.first_air_date || target.year ||
                  item.releaseDate || item.release_date || item.firstAirDate || item.first_air_date || item.year;
  if (dateStr) {
    year = parseInt(String(dateStr).substring(0, 4), 10) || null;
  }

  const posterPath = target.posterPath || target.poster_path || target.poster || item.posterPath || item.poster_path || item.poster;
  let posterUrl = null;
  if (posterPath) {
    posterUrl = posterPath.startsWith('http') ? posterPath : `https://image.tmdb.org/t/p/w300${posterPath}`;
  }

  const backdropPath = target.backdropPath || target.backdrop_path || target.backdrop || item.backdropPath || item.backdrop_path || item.backdrop;
  let backdropUrl = null;
  if (backdropPath) {
    backdropUrl = backdropPath.startsWith('http') ? backdropPath : `https://image.tmdb.org/t/p/w1280${backdropPath}`;
  }

  let runtime = null;
  let runtimeMinutes = null;
  const runtimeVal = target.runtime || item.runtime;
  if (runtimeVal) {
    runtimeMinutes = parseInt(runtimeVal, 10);
    runtime = `PT${runtimeMinutes}M`;
  }

  const genres = target.genres || item.genres || [];
  const cast = target.cast || item.cast || [];
  const keywords = target.keywords || item.keywords || [];
  const seasons = target.seasons || item.seasons || [];

  return {
    title: target.title || target.name || item.title || item.name || '',
    year,
    type: isSeries ? 'series' : 'movie',
    runtime,
    runtimeMinutes,
    overview: target.overview || item.overview || null,
    poster: posterUrl,
    backdrop: backdropUrl,
    genres: genres.map(g => (typeof g === 'string' ? g : g.name)).filter(Boolean),
    country: target.country || item.country || null,
    countryCode: null,
    language: target.originalLanguage || target.original_language || item.originalLanguage || item.original_language || null,
    director: (target.director || item.director) ? (typeof (target.director || item.director) === 'string' ? { name: (target.director || item.director), url: null } : (target.director || item.director)) : null,
    cast: cast.map(c => ({
      name: c.name,
      character: c.character,
      image: (c.profilePath || c.profile_path)
        ? ((c.profilePath || c.profile_path).startsWith('http') ? (c.profilePath || c.profile_path) : `https://image.tmdb.org/t/p/w185${c.profilePath || c.profile_path}`)
        : null
    })),
    trailer: target.trailerUrl || target.trailer_url || item.trailerUrl || item.trailer_url || null,
    watchUrl: `${BASE_URL}/${endpoint}?play=1`,
    streamUrl: null, // Fetched separately
    keywords: keywords.map(k => (typeof k === 'string' ? k : k.name)).filter(Boolean),
    recommendations: [], // Can be populated if API provides it
    seasons: isSeries ? seasons.map(s => ({
      name: s.name,
      seasonNumber: s.seasonNumber || s.season_number,
      episodeCount: s.episodeCount || s.episode_count,
      episodes: (s.episodes || []).map(e => ({
        episodeNumber: e.episodeNumber || e.episode_number,
        title: e.name || e.title || `Episode ${e.episodeNumber || e.episode_number}`,
        overview: e.overview || null
      }))
    })) : null
  };
}

module.exports = {
  mapApiItem,
  mapApiDetail,
};