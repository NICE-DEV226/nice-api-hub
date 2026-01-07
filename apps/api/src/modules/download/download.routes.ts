/**
 * Download API routes - All 18 platforms
 * Author: NICE-DEV
 */

import { Router } from 'express';

// Middleware
import { apiKeyAuth } from '../../middleware/apiKeyAuth.js';
import { rateLimiter } from '../../middleware/rateLimiter.js';
import { logApiRequest } from '../../middleware/requestLogger.js';

// Platform controllers
import * as tiktokController from './platforms/tiktok.controller.js';
import * as youtubeController from './platforms/youtube.controller.js';
import * as instagramController from './platforms/instagram.controller.js';
import * as twitterController from './platforms/twitter.controller.js';
import * as facebookController from './platforms/facebook.controller.js';
import * as pinterestController from './platforms/pinterest.controller.js';
import * as redditController from './platforms/reddit.controller.js';
import * as linkedinController from './platforms/linkedin.controller.js';
import * as snapchatController from './platforms/snapchat.controller.js';
import * as threadsController from './platforms/threads.controller.js';
import * as spotifyController from './platforms/spotify.controller.js';
import * as soundcloudController from './platforms/soundcloud.controller.js';
import * as dailymotionController from './platforms/dailymotion.controller.js';
import * as tumblrController from './platforms/tumblr.controller.js';
import * as blueskyController from './platforms/bluesky.controller.js';
import * as capcutController from './platforms/capcut.controller.js';
import * as douyinController from './platforms/douyin.controller.js';
import * as kuaishouController from './platforms/kuaishou.controller.js';
import * as teraboxController from './platforms/terabox.controller.js';

const router = Router();

// Apply middleware to all download routes
router.use(apiKeyAuth);
router.use(rateLimiter);
router.use(logApiRequest);

// TikTok
router.get('/tiktok/download', tiktokController.download);

// YouTube
router.get('/youtube/download', youtubeController.download);

// Meta (Instagram & Facebook)
router.get('/meta/download', instagramController.download);
router.get('/instagram/download', instagramController.download);
router.get('/facebook/download', facebookController.download);

// Twitter/X
router.get('/twitter/download', twitterController.download);

// Pinterest
router.get('/pinterest/download', pinterestController.download);

// Reddit
router.get('/reddit/download', redditController.download);

// LinkedIn
router.get('/linkedin/download', linkedinController.download);

// Snapchat
router.get('/snapchat/download', snapchatController.download);

// Threads
router.get('/threads/download', threadsController.download);

// Spotify
router.get('/spotify/download', spotifyController.download);

// SoundCloud
router.get('/soundcloud/download', soundcloudController.download);

// Dailymotion
router.get('/dailymotion/download', dailymotionController.download);

// Tumblr
router.get('/tumblr/download', tumblrController.download);

// Bluesky
router.get('/bluesky/download', blueskyController.download);

// CapCut
router.get('/capcut/download', capcutController.download);

// Douyin
router.get('/douyin/download', douyinController.download);

// Kuaishou
router.get('/kuaishou/download', kuaishouController.download);

// Terabox
router.get('/terabox/download', teraboxController.download);

// List all available platforms (public endpoint)
router.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      platforms: [
        { name: 'TikTok', endpoint: '/api/tiktok/download' },
        { name: 'YouTube', endpoint: '/api/youtube/download' },
        { name: 'Instagram', endpoint: '/api/instagram/download' },
        { name: 'Facebook', endpoint: '/api/facebook/download' },
        { name: 'Meta (IG/FB)', endpoint: '/api/meta/download' },
        { name: 'Twitter/X', endpoint: '/api/twitter/download' },
        { name: 'Pinterest', endpoint: '/api/pinterest/download' },
        { name: 'Reddit', endpoint: '/api/reddit/download' },
        { name: 'LinkedIn', endpoint: '/api/linkedin/download' },
        { name: 'Snapchat', endpoint: '/api/snapchat/download' },
        { name: 'Threads', endpoint: '/api/threads/download' },
        { name: 'Spotify', endpoint: '/api/spotify/download' },
        { name: 'SoundCloud', endpoint: '/api/soundcloud/download' },
        { name: 'Dailymotion', endpoint: '/api/dailymotion/download' },
        { name: 'Tumblr', endpoint: '/api/tumblr/download' },
        { name: 'Bluesky', endpoint: '/api/bluesky/download' },
        { name: 'CapCut', endpoint: '/api/capcut/download' },
        { name: 'Douyin', endpoint: '/api/douyin/download' },
        { name: 'Kuaishou', endpoint: '/api/kuaishou/download' },
        { name: 'Terabox', endpoint: '/api/terabox/download' },
      ],
    },
  });
});

export default router;
