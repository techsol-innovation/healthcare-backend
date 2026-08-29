// Export all models from a single file
const User = require('./User');
const ParentChildLink = require('./ParentChildLink');
const Medicine = require('./Medicine');
const MedicineTracking = require('./MedicineTracking');

module.exports = {
  User,
  ParentChildLink,
  Medicine,
  MedicineTracking,
};
