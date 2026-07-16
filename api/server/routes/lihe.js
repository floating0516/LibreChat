const express = require('express');
const { CacheKeys } = require('librechat-data-provider');
const { createLiheHandlers, setOAuthSession } = require('@librechat/api');
const { getUserKey, updateUserKey, deleteUserKey, getUserKeyExpiry } = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');
const { getFlowStateManager } = require('~/config');
const { getLogStores } = require('~/cache');

const router = express.Router();
const flowManager = getFlowStateManager(getLogStores(CacheKeys.FLOWS));
const handlers = createLiheHandlers({
  flowManager,
  getUserKey,
  updateUserKey,
  deleteUserKey,
  getUserKeyExpiry,
});

router.get('/status', requireJwtAuth, handlers.status);
router.post('/start', requireJwtAuth, setOAuthSession, handlers.start);
router.get('/callback', handlers.callback);
router.post('/disconnect', requireJwtAuth, handlers.disconnect);

module.exports = router;
