/**
 * Battery Routes
 * Handles battery monitoring and alert routes
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const batteryController = require('../controllers/batteryController');
const { verifyToken } = require('../middleware/auth');

// Validation error handler middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  next();
};

/**
 * POST /api/battery/report
 * Report battery status (Parent only)
 */
router.post(
  '/report',
  verifyToken,
  body('batteryPercentage')
    .isInt({ min: 0, max: 100 })
    .withMessage('Battery percentage must be between 0 and 100'),
  body('batteryState')
    .isIn(['charging', 'unplugged', 'full', 'unknown'])
    .withMessage('Invalid battery state'),
  body('deviceInfo')
    .optional()
    .isObject()
    .withMessage('Device info must be an object'),
  handleValidationErrors,
  batteryController.reportBatteryStatus
);

/**
 * GET /api/battery/status/:parentUserId
 * Get current battery status
 */
router.get(
  '/status/:parentUserId',
  verifyToken,
  param('parentUserId')
    .isInt()
    .withMessage('Parent user ID must be an integer'),
  handleValidationErrors,
  batteryController.getBatteryStatus
);

/**
 * GET /api/battery/history/:parentUserId
 * Get battery history
 */
router.get(
  '/history/:parentUserId',
  verifyToken,
  param('parentUserId')
    .isInt()
    .withMessage('Parent user ID must be an integer'),
  query('hours')
    .optional()
    .isInt({ min: 1, max: 168 })
    .withMessage('Hours must be between 1 and 168 (7 days)'),
  handleValidationErrors,
  batteryController.getBatteryHistory
);

/**
 * GET /api/battery/alerts
 * Get battery alert history
 */
router.get(
  '/alerts',
  verifyToken,
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors,
  batteryController.getAlertHistory
);

/**
 * POST /api/battery/alerts/:alertId/acknowledge
 * Acknowledge battery alert (Caretaker only)
 */
router.post(
  '/alerts/:alertId/acknowledge',
  verifyToken,
  param('alertId')
    .isInt()
    .withMessage('Alert ID must be an integer'),
  handleValidationErrors,
  batteryController.acknowledgeAlert
);

/**
 * POST /api/battery/fcm/register
 * Register FCM token
 */
router.post(
  '/fcm/register',
  verifyToken,
  body('fcmToken')
    .notEmpty()
    .isString()
    .withMessage('FCM token is required and must be a string'),
  body('deviceInfo')
    .optional()
    .isObject()
    .withMessage('Device info must be an object'),
  handleValidationErrors,
  batteryController.registerFCMToken
);

/**
 * POST /api/battery/fcm/deactivate
 * Deactivate FCM token
 */
router.post(
  '/fcm/deactivate',
  verifyToken,
  body('fcmToken')
    .optional()
    .isString()
    .withMessage('FCM token must be a string'),
  handleValidationErrors,
  batteryController.deactivateFCMToken
);

/**
 * POST /api/battery/fcm/test
 * Test FCM notification
 */
router.post(
  '/fcm/test',
  verifyToken,
  batteryController.testFCMNotification
);

module.exports = router;
