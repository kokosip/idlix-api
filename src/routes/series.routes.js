'use strict';

const { Router }       = require('express');
const seriesController  = require('../controllers/series.controller');
const { validatePage, validateMediaSlug, validateSeasonParam, validateEpisodeParams } = require('../middleware/validate');

const router = Router();

/** GET /api/series */
router.get('/', seriesController.browse);

/** GET /api/series/trending */
router.get('/trending', seriesController.trending);

/** GET /api/series/:slug/season/:season/episode/:episode/stream */
router.get(
  '/:slug/season/:season/episode/:episode/stream',
  validateMediaSlug,
  validateEpisodeParams,
  seriesController.episodeStream
);

/** GET /api/series/:slug/season/:season — season details with episode list */
router.get(
  '/:slug/season/:season',
  validateMediaSlug,
  validateSeasonParam,
  seriesController.seasonDetail
);

/** GET /api/series/:slug/stream — stream URL for first episode (backward-compat) */
router.get('/:slug/stream', validateMediaSlug, seriesController.stream);

/** GET /api/series/:slug — detail page with rich metadata and populated season episodes */
router.get('/:slug', validateMediaSlug, seriesController.detail);

module.exports = router;
