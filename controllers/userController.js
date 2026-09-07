const { getConnection, mssql } = require('../config/database');

// Child links a parent to monitor
const linkParent = async (req, res) => {
  try {
    const { parentUserId, parentEmail } = req.body;
    const childUserId = req.user.userId;

    const pool = await getConnection();

    let actualParentUserId = parentUserId;

    // If email is provided instead of userId, look up the user
    if (parentEmail && !parentUserId) {
      const userLookup = await pool
        .request()
        .input('email', mssql.VarChar, parentEmail)
        .query(`
          SELECT UserId, Role FROM Users
          WHERE Email = @email
        `);

      if (userLookup.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No user found with this email address',
        });
      }

      const user = userLookup.recordset[0];
      
      if (user.Role !== 'parent') {
        return res.status(400).json({
          success: false,
          message: 'This user is not registered as a parent',
        });
      }

      actualParentUserId = user.UserId;
    }

    // Verify the parent user exists and has 'parent' role
    const parentCheck = await pool
      .request()
      .input('parentUserId', mssql.Int, actualParentUserId)
      .query(`
        SELECT UserId, Role FROM Users
        WHERE UserId = @parentUserId AND Role = 'parent'
      `);

    if (parentCheck.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Parent user not found',
      });
    }

    // Check if link already exists
    const linkCheck = await pool
      .request()
      .input('childUserId', mssql.Int, childUserId)
      .input('parentUserId', mssql.Int, actualParentUserId)
      .query(`
        SELECT * FROM ParentChildLink
        WHERE ChildId = @childUserId AND ParentId = @parentUserId
      `);

    if (linkCheck.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This parent is already linked to your account',
      });
    }

    // Create link
    await pool
      .request()
      .input('childUserId', mssql.Int, childUserId)
      .input('parentUserId', mssql.Int, actualParentUserId)
      .query(`
        INSERT INTO ParentChildLink (ChildId, ParentId, CreatedAt)
        VALUES (@childUserId, @parentUserId, GETDATE())
      `);

    res.status(201).json({
      success: true,
      message: 'Parent linked successfully',
    });
  } catch (error) {
    console.error('Link parent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to link parent',
      error: error.message,
    });
  }
};

// Child gets list of linked parents
const getLinkedParents = async (req, res) => {
  try {
    const childUserId = req.user.userId;

    const pool = await getConnection();

    const result = await pool
      .request()
      .input('childUserId', mssql.Int, childUserId)
      .query(`
        SELECT 
          u.UserId,
          u.Name,
          u.Email,
          u.PhoneNumber,
          CASE WHEN u.IsActivated = 1 THEN 'active' ELSE 'offline' END as status,
          pcl.CreatedAt
        FROM ParentChildLink pcl
        JOIN Users u ON pcl.ParentId = u.UserId
        WHERE pcl.ChildId = @childUserId
        ORDER BY pcl.CreatedAt DESC
      `);

    res.status(200).json({
      success: true,
      count: result.recordset.length,
      data: result.recordset,
    });
  } catch (error) {
    console.error('Get linked parents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get linked parents',
      error: error.message,
    });
  }
};

// Parent gets their caregiver info
const getCaregiver = async (req, res) => {
  try {
    const parentUserId = req.user.userId;

    const pool = await getConnection();

    const result = await pool
      .request()
      .input('parentUserId', mssql.Int, parentUserId)
      .query(`
        SELECT 
          u.UserId,
          u.Name,
          u.Email,
          u.PhoneNumber,
          pcl.CreatedAt
        FROM ParentChildLink pcl
        JOIN Users u ON pcl.ChildId = u.UserId
        WHERE pcl.ParentId = @parentUserId
        ORDER BY pcl.CreatedAt DESC
      `);

    res.status(200).json({
      success: true,
      count: result.recordset.length,
      data: result.recordset,
    });
  } catch (error) {
    console.error('Get caregiver error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get caregiver information',
      error: error.message,
    });
  }
};

// Get user by email (for linking purposes)
const searchUserByEmail = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const pool = await getConnection();

    const result = await pool
      .request()
      .input('email', mssql.VarChar, email)
      .query(`
        SELECT UserId, Name, Email, Role
        FROM Users
        WHERE Email = @email
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: result.recordset[0],
    });
  } catch (error) {
    console.error('Search user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search user',
      error: error.message,
    });
  }
};

// Child invites a parent by email (activates parent account for login)
const inviteParent = async (req, res) => {
  try {
    const { parentEmail } = req.body;
    const childUserId = req.user.userId;

    const pool = await getConnection();

    // Check if parent email already exists
    const userCheck = await pool
      .request()
      .input('email', mssql.VarChar, parentEmail)
      .query(`
        SELECT UserId, Role, IsActivated FROM Users
        WHERE Email = @email
      `);

    let parentUserId;

    if (userCheck.recordset.length > 0) {
      const existingUser = userCheck.recordset[0];
      
      // Check if already linked to another child
      const linkCheck = await pool
        .request()
        .input('parentUserId', mssql.Int, existingUser.UserId)
        .query(`
          SELECT * FROM ParentChildLink
          WHERE ParentId = @parentUserId
        `);

      if (linkCheck.recordset.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'This parent is already linked to another caregiver',
        });
      }

      // Activate existing parent account
      await pool
        .request()
        .input('userId', mssql.Int, existingUser.UserId)
        .query(`
          UPDATE Users SET IsActivated = 1 WHERE UserId = @userId
        `);

      parentUserId = existingUser.UserId;
    } else {
      // Parent doesn't exist yet - create a placeholder invitation
      // When parent registers with this email, they'll be auto-linked
      const insertResult = await pool
        .request()
        .input('email', mssql.VarChar, parentEmail)
        .input('name', mssql.NVarChar, 'Pending Registration')
        .input('passwordHash', mssql.VarChar, 'PENDING') // Temporary, will be set on registration
        .input('role', mssql.VarChar, 'parent')
        .input('isActivated', mssql.Bit, 1)
        .query(`
          INSERT INTO Users (Email, Name, PasswordHash, Role, IsActivated, CreatedAt)
          OUTPUT INSERTED.UserId
          VALUES (@email, @name, @passwordHash, @role, @isActivated, GETDATE())
        `);

      parentUserId = insertResult.recordset[0].UserId;
    }

    // Create link between child and parent
    await pool
      .request()
      .input('childUserId', mssql.Int, childUserId)
      .input('parentUserId', mssql.Int, parentUserId)
      .query(`
        INSERT INTO ParentChildLink (ChildId, ParentId, CreatedAt)
        VALUES (@childUserId, @parentUserId, GETDATE())
      `);

    res.status(201).json({
      success: true,
      message: 'Parent invitation sent. They can now register or login with this email.',
      data: {
        parentEmail,
        parentUserId,
      },
    });
  } catch (error) {
    console.error('Invite parent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to invite parent',
      error: error.message,
    });
  }
};

// Update user's push token
const updatePushToken = async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.userId;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Push token is required',
      });
    }

    const User = require('../models/User'); // Import dynamically if needed or it might already be imported
    await User.updatePushToken(userId, token);

    res.status(200).json({
      success: true,
      message: 'Push token updated successfully',
    });
  } catch (error) {
    console.error('Update push token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update push token',
      error: error.message,
    });
  }
};

// Delete account and all associated personal data (App Store & Play Store Compliance)
const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const pool = await getConnection();

    // 1. Clean up links, alerts, sync tokens, heartbeat
    try {
      await pool.request()
        .input('userId', mssql.Int, userId)
        .query(`
          DELETE FROM ParentChildLink WHERE ParentId = @userId OR ChildId = @userId;
          DELETE FROM Alerts WHERE ParentId = @userId OR ChildId = @userId;
          DELETE FROM SOS WHERE ParentId = @userId OR ChildId = @userId;
          DELETE FROM Heartbeat WHERE UserId = @userId;
        `);
    } catch (e1) {
      console.warn('Cleanup step 1 notice:', e1.message);
    }

    // 2. Clean up medicines & tracking
    try {
      await pool.request()
        .input('userId', mssql.Int, userId)
        .query(`
          DELETE FROM MedicineTracking WHERE MedicineId IN (SELECT MedicineId FROM Medicines WHERE ParentId = @userId OR ChildId = @userId);
          DELETE FROM Medicines WHERE ParentId = @userId OR ChildId = @userId;
        `);
    } catch (e2) {
      console.warn('Cleanup step 2 notice:', e2.message);
    }

    // 3. Delete or anonymize user row
    await pool.request()
      .input('userId', mssql.Int, userId)
      .query(`
        DELETE FROM Users WHERE UserId = @userId;
      `);

    console.log(`✅ User ${userId} account and data deleted successfully.`);

    res.status(200).json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
      error: error.message,
    });
  }
};

module.exports = {
  linkParent,
  getLinkedParents,
  getCaregiver,
  searchUserByEmail,
  inviteParent,
  updatePushToken,
  deleteAccount,
};
