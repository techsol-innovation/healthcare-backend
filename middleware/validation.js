const { body, param, validationResult } = require('express-validator');

// Middleware to check validation results
const validate = (req, res, next) => {
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

// Registration validation
const validateRegister = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('role')
    .notEmpty()
    .withMessage('Role is required')
    .isIn(['parent', 'child'])
    .withMessage('Role must be either "parent" or "child"'),
  body('phoneNumber')
    .optional()
    .trim()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  validate,
];

// Login validation
const validateLogin = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
];

// Medicine validation
const validateMedicine = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Medicine name is required')
    .isLength({ min: 2, max: 200 })
    .withMessage('Medicine name must be between 2 and 200 characters'),
  body('dosage')
    .trim()
    .notEmpty()
    .withMessage('Dosage is required')
    .isLength({ max: 100 })
    .withMessage('Dosage must not exceed 100 characters'),
  body('frequency')
    .trim()
    .notEmpty()
    .withMessage('Frequency is required'),
  body('time')
    .notEmpty()
    .withMessage('Time is required')
    .matches(/^(([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?)(,\s*(([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?))*$/)
    .withMessage('Time must be one or more HH:MM times, separated by commas'),
  body('parentId')
    .notEmpty()
    .withMessage('Parent ID is required')
    .isInt({ min: 1 })
    .withMessage('Parent ID must be a valid positive integer'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),
  validate,
];

// Link parent validation
const validateLinkParent = [
  body('parentEmail')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('parentUserId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Parent user ID must be a valid positive integer'),
  // At least one must be provided
  body()
    .custom((value, { req }) => {
      if (!req.body.parentEmail && !req.body.parentUserId) {
        throw new Error('Either parent email or parent user ID is required');
      }
      return true;
    }),
  validate,
];

module.exports = {
  validateRegister,
  validateLogin,
  validateMedicine,
  validateLinkParent,
  handleValidationErrors: validate, // Alias for battery routes
};
