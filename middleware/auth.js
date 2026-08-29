const jwt = require('jsonwebtoken');

// Verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, email, role }
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
};

// Check if user is a Child/Caregiver (Admin)
const isChild = (req, res, next) => {
  if (req.user.role !== 'child') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only caregivers/children can perform this action.',
    });
  }
  next();
};

// Check if user is a Parent
const isParent = (req, res, next) => {
  if (req.user.role !== 'parent') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only parents can perform this action.',
    });
  }
  next();
};

module.exports = {
  verifyToken,
  isChild,
  isParent,
};
