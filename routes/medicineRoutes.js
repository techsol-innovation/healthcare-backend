const express = require('express');
const router = express.Router();
const {
  createMedicine,
  getMedicinesByParent,
  getMedicineTracking,
  getMyMedicines,
  confirmMedicine,
  getTodaySchedule,
  updateMedicine,
  deleteMedicine,
  updateMedicineStatus,
  getMedicineHistory,
} = require('../controllers/medicineController');
const { verifyToken, isChild, isParent } = require('../middleware/auth');
const { validateMedicine } = require('../middleware/validation');

// ── Parent routes (specific strings FIRST, before :param routes) ──
router.get('/today', verifyToken, isParent, getTodaySchedule);
router.get('/my-medicines', verifyToken, isParent, getMyMedicines);

// ── Child/Caregiver routes ────────────────────────────────────────
router.post('/', verifyToken, isChild, validateMedicine, createMedicine);
router.get('/parent/:parentId', verifyToken, isChild, getMedicinesByParent);
router.get('/tracking/:parentId', verifyToken, isChild, getMedicineTracking);
router.get('/history/:parentId', verifyToken, isChild, getMedicineHistory);
router.put('/:id', verifyToken, isChild, updateMedicine);
router.delete('/:id', verifyToken, isChild, deleteMedicine);

// ── Parent routes with :param ─────────────────────────────────────
router.post('/:id/confirm', verifyToken, isParent, confirmMedicine);
router.put('/:id/status', verifyToken, isParent, updateMedicineStatus);

module.exports = router;
