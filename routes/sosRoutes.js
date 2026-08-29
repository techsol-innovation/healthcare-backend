const express = require('express');
const router = express.Router();
const { verifyToken, isParent, isChild } = require('../middleware/auth');
const {
  triggerSOS,
  getMySOS,
  getActiveSOS,
  getSOSForChild,
  acknowledgeSOS,
  resolveSOS,
  getSOSStats,
} = require('../controllers/sosController');

// Parent triggers SOS
router.post('/trigger', verifyToken, isParent, triggerSOS);

// Get SOS events (parent view)
router.get('/', verifyToken, isParent, getMySOS);

// Get active SOS events (parent view)
router.get('/active', verifyToken, isParent, getActiveSOS);

// Get SOS statistics
router.get('/stats', verifyToken, isParent, getSOSStats);

// Get SOS events for child
router.get('/child', verifyToken, isChild, getSOSForChild);

// Child acknowledges SOS
router.put('/:sosId/acknowledge', verifyToken, isChild, acknowledgeSOS);

// Child resolves SOS
router.put('/:sosId/resolve', verifyToken, isChild, resolveSOS);

module.exports = router;
