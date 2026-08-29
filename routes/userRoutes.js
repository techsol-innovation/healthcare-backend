const express = require('express');
const router = express.Router();
const {
  linkParent,
  getLinkedParents,
  getCaregiver,
  searchUserByEmail,
  inviteParent,
  updatePushToken,
} = require('../controllers/userController');
const { verifyToken, isChild, isParent } = require('../middleware/auth');
const { validateLinkParent } = require('../middleware/validation');

// Child routes
router.post('/invite-parent', verifyToken, isChild, inviteParent);
router.post('/link-parent', verifyToken, isChild, validateLinkParent, linkParent);
router.get('/parents', verifyToken, isChild, getLinkedParents);

// Parent routes
router.get('/caregiver', verifyToken, isParent, getCaregiver);

// Common routes
router.get('/search', verifyToken, searchUserByEmail);
router.put('/push-token', verifyToken, updatePushToken);

module.exports = router;
