const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection, mssql } = require('../config/database');
const SyncToken = require('../models/SyncToken');
const ParentChildLink = require('../models/ParentChildLink');

// Register new user
const register = async (req, res) => {
  try {
    const { name, email, password, role, phoneNumber } = req.body;
    console.log('Registering user:', { name, email, role, phoneNumber });
    const pool = await getConnection();

    // Check if user already exists
    const checkUser = await pool
      .request()
      .input('email', mssql.VarChar, email)
      .query('SELECT UserId, PasswordHash, IsActivated FROM Users WHERE Email = @email');

    let userId;

    if (checkUser.recordset.length > 0) {
      const existingUser = checkUser.recordset[0];
      
      // Check if this is a pending invitation (placeholder account)
      if (existingUser.PasswordHash === 'PENDING' && role === 'parent') {
        // Update the pending account with actual credentials
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool
          .request()
          .input('userId', mssql.Int, existingUser.UserId)
          .input('name', mssql.NVarChar, name)
          .input('passwordHash', mssql.VarChar, hashedPassword)
          .input('phoneNumber', mssql.VarChar, phoneNumber || null)
          .query(`
            UPDATE Users 
            SET Name = @name, PasswordHash = @passwordHash, PhoneNumber = @phoneNumber
            WHERE UserId = @userId
          `);
        
        userId = existingUser.UserId;
      } else {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists',
        });
      }
    } else {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // For new parent accounts, set IsActivated = 0 (will be activated when child invites)
      const isActivated = role === 'child' ? 1 : 0;

      // Insert new user
      const result = await pool
        .request()
        .input('name', mssql.NVarChar, name)
        .input('email', mssql.VarChar, email)
        .input('passwordHash', mssql.VarChar, hashedPassword)
        .input('role', mssql.VarChar, role)
        .input('phoneNumber', mssql.VarChar, phoneNumber || null)
        .input('isActivated', mssql.Bit, isActivated)
        .query(`
          INSERT INTO Users (Name, Email, PasswordHash, Role, PhoneNumber, IsActivated, CreatedAt)
          OUTPUT INSERTED.UserId
          VALUES (@name, @email, @passwordHash, @role, @phoneNumber, @isActivated, GETDATE());
        `);

      if (result.recordset && result.recordset.length > 0) {
        userId = result.recordset[0].UserId;
      } else {
        throw new Error('Failed to retrieve UserId after insertion.');
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId, email, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        userId,
        name,
        email,
        role,
        token,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message,
    });
  }
};

// Login user
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('🔵 Login attempt for:', email);

    const pool = await getConnection();

    // Get user by email
    const result = await pool
      .request()
      .input('email', mssql.VarChar, email)
      .query(`
        SELECT UserId, Name, Email, PasswordHash, Role, PhoneNumber, IsActivated
        FROM Users
        WHERE Email = @email
      `);

    if (result.recordset.length === 0) {
      console.log('❌ User not found:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const user = result.recordset[0];
    console.log('✅ User found:', { userId: user.UserId, email: user.Email, role: user.Role, isActivated: user.IsActivated });

    // Check for pending invitation (PENDING password means not yet registered)
    if (user.PasswordHash === 'PENDING') {
      console.log('⚠️ Password is PENDING for:', email);
      return res.status(403).json({
        success: false,
        message: 'Your account is not yet activated. Please complete registration first.',
      });
    }

    // Verify password
    console.log('🔐 Verifying password...');
    const isPasswordValid = await bcrypt.compare(password, user.PasswordHash);
    console.log('Password valid:', isPasswordValid);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Auto-activate parent accounts on successful login (for existing accounts)
    if (user.Role === 'parent' && !user.IsActivated) {
      await pool
        .request()
        .input('userId', mssql.Int, user.UserId)
        .query('UPDATE Users SET IsActivated = 1 WHERE UserId = @userId');
      
      console.log(`Auto-activated parent account: ${user.Email}`);
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.UserId, email: user.Email, role: user.Role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        userId: user.UserId,
        name: user.Name,
        email: user.Email,
        role: user.Role,
        phoneNumber: user.PhoneNumber,
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message,
    });
  }
};

// Get user profile
const getProfile = async (req, res) => {
  try {
    const { userId } = req.user;

    const pool = await getConnection();

    const result = await pool
      .request()
      .input('userId', mssql.Int, userId)
      .query(`
        SELECT 
          u.UserId, u.Name, u.Email, u.Role, u.PhoneNumber, u.CreatedAt,
          c.UserId as CaregiverId, c.Name as CaregiverName, c.Email as CaregiverEmail, c.PhoneNumber as CaregiverPhone
        FROM Users u
        LEFT JOIN ParentChildLink pcl ON u.UserId = pcl.ParentId
        LEFT JOIN Users c ON pcl.ChildId = c.UserId
        WHERE u.UserId = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const row = result.recordset[0];
    const userData = {
      UserId: row.UserId,
      Name: row.Name,
      Email: row.Email,
      Role: row.Role,
      PhoneNumber: row.PhoneNumber,
      CreatedAt: row.CreatedAt,
      id: row.UserId,
      name: row.Name,
      email: row.Email,
      role: row.Role,
      phoneNumber: row.PhoneNumber,
      caregiverId: row.CaregiverId ? {
        id: row.CaregiverId,
        name: row.CaregiverName,
        email: row.CaregiverEmail,
      } : null,
      caregiver: row.CaregiverId ? {
        UserId: row.CaregiverId,
        Name: row.CaregiverName,
        Email: row.CaregiverEmail,
        PhoneNumber: row.CaregiverPhone,
        name: row.CaregiverName,
        email: row.CaregiverEmail,
        phoneNumber: row.CaregiverPhone,  // lowercase for frontend consistency
      } : null
    };

    res.status(200).json({
      success: true,
      data: userData,
    });
    
    console.log("DB RECORD:", JSON.stringify(userData, null, 2));
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error: error.message,
    });
  }
};

// Generate Sync Token
const generateSyncToken = async (req, res) => {
  try {
    const caregiverId = req.user.userId;
    const { existingParentId, parentName } = req.body;
    
    if (req.user.role !== 'child') {
      return res.status(403).json({ success: false, message: 'Only caregivers can generate sync tokens' });
    }

    const tokenCode = await SyncToken.create(caregiverId, existingParentId, parentName || 'Parent');
    
    res.json({
      success: true,
      data: { tokenCode }
    });
  } catch (error) {
    console.error('Generate token error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate token' });
  }
};

// Verify Sync Token
const verifySyncToken = async (req, res) => {
  try {
    const { tokenCode } = req.body;
    
    if (!tokenCode) {
      return res.status(400).json({ success: false, message: 'Token code is required' });
    }

    const result = await SyncToken.verify(tokenCode.trim().toUpperCase());
    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.reason });
    }

    const { CaregiverId, ParentId, ParentName } = result.token;
    const pool = await getConnection();
    
    let targetParentId = ParentId;
    let targetParentName = ParentName || 'Parent';
    let targetEmail = null;

    if (targetParentId) {
      // Re-linking existing parent
      const checkUser = await pool.request()
        .input('userId', mssql.Int, targetParentId)
        .query('SELECT Name, Email FROM Users WHERE UserId = @userId');
      
      if (checkUser.recordset.length > 0) {
        targetParentName = checkUser.recordset[0].Name;
        targetEmail = checkUser.recordset[0].Email;
      }
      
      await pool.request()
        .input('userId', mssql.Int, targetParentId)
        .query('UPDATE Users SET IsActivated = 1 WHERE UserId = @userId');
    } else {
      // Creating a new anonymous parent
      targetEmail = `parent_${Date.now()}@sync.local`;
      const dummyPassword = await bcrypt.hash(tokenCode, 10);
      
      const insertResult = await pool.request()
        .input('name', mssql.NVarChar, targetParentName)
        .input('email', mssql.VarChar, targetEmail)
        .input('passwordHash', mssql.VarChar, dummyPassword)
        .input('role', mssql.VarChar, 'parent')
        .input('isActivated', mssql.Bit, 1)
        .query(`
          INSERT INTO Users (Name, Email, PasswordHash, Role, IsActivated, CreatedAt)
          OUTPUT INSERTED.UserId
          VALUES (@name, @email, @passwordHash, @role, @isActivated, GETDATE());
        `);
      
      targetParentId = insertResult.recordset[0].UserId;
    }
    
    // Create ParentChildLink
    await ParentChildLink.create(Number(targetParentId), Number(CaregiverId));

    // Generate JWT
    const token = jwt.sign(
      { userId: targetParentId, email: targetEmail, role: 'parent' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({
      success: true,
      message: 'Sync successful',
      data: {
        userId: targetParentId,
        name: targetParentName,
        email: targetEmail,
        role: 'parent',
        token,
      }
    });

  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify token' });
  }
};

// Logout user - marks them offline in the DB
const logoutUser = async (req, res) => {
  try {
    const { userId } = req.user;
    const pool = await getConnection();

    // Set IsActivated = 0 to signal "offline/logged out" state
    await pool
      .request()
      .input('userId', mssql.Int, userId)
      .query('UPDATE Users SET IsActivated = 0 WHERE UserId = @userId');

    console.log(`🔓 User ${userId} logged out — marked offline.`);

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    // Still respond with success so the client clears its token
    res.json({ success: true, message: 'Logged out' });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  generateSyncToken,
  verifySyncToken,
  logoutUser,
};
