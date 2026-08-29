const Heartbeat = require('../models/Heartbeat');
const BatteryLog = require('../models/BatteryLog');
const { getConnection, mssql } = require('../config/database');

// Parent sends heartbeat
const sendHeartbeat = async (req, res) => {
  try {
    const { deviceInfo, batteryLevel, isCharging } = req.body;
    const parentUserId = req.user?.userId;

    console.log('📝 Heartbeat request:', {
      parentUserId,
      parentUserIdType: typeof parentUserId,
      role: req.user?.role,
      deviceInfo: typeof deviceInfo,
      batteryLevel,
      isCharging,
      userObject: req.user
    });

    if (!parentUserId) {
      console.error('❌ No userId in token');
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token - userId missing',
      });
    }

    // Verify user is a parent (patient)
    if (req.user.role !== 'parent') {
      return res.status(403).json({
        success: false,
        message: 'Only parent users can send heartbeats',
      });
    }

    // Ensure we have valid data
    const validDeviceInfo = deviceInfo || JSON.stringify({ device: 'unknown' });
    const validBatteryLevel = batteryLevel !== undefined && batteryLevel !== null ? parseInt(batteryLevel) : 100;
    const validParentId = parseInt(parentUserId);

    console.log('✅ Validated params:', {
      validParentId,
      validParentIdType: typeof validParentId,
      validDeviceInfo: typeof validDeviceInfo,
      validBatteryLevel
    });

    // Record heartbeat
    const heartbeatId = await Heartbeat.record({
      childId: validParentId, // Note: DB schema might still use 'ChildId' column name but it refers to the patient (Parent)
      deviceInfo: validDeviceInfo,
      batteryLevel: validBatteryLevel,
    });

    console.log('✅ Heartbeat recorded:', heartbeatId);

    // NOTE: We no longer log to BatteryLogs here because there is a dedicated batteryController for that.

    res.status(200).json({
      success: true,
      message: 'Heartbeat recorded successfully',
      data: {
        heartbeatId,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('❌ Send heartbeat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record heartbeat',
      error: error.message,
    });
  }
};

// Get child's heartbeat status (for child to check their own status)
const getMyHeartbeatStatus = async (req, res) => {
  try {
    const childUserId = req.user.userId;

    const lastHeartbeat = await Heartbeat.getLastHeartbeat(childUserId);
    const isOnline = await Heartbeat.isOnline(childUserId);

    res.status(200).json({
      success: true,
      data: {
        isOnline,
        lastHeartbeat,
      },
    });
  } catch (error) {
    console.error('Get heartbeat status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get heartbeat status',
      error: error.message,
    });
  }
};

// Get heartbeat history for a child (child can view their own, parent can view linked children)
const getHeartbeatHistory = async (req, res) => {
  try {
    const { childId } = req.params;
    const hours = req.query.hours ? parseInt(req.query.hours, 10) : 24;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const pool = await getConnection();

    // Authorization check
    if (userRole === 'child') {
      // Child can only view their own heartbeat
      if (parseInt(childId) !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
    } else if (userRole === 'parent') {
      // Parent can view linked children's heartbeat
      const linkCheck = await pool
        .request()
        .input('parentId', mssql.Int, userId)
        .input('childId', mssql.Int, childId)
        .query(`
          SELECT * FROM ParentChildLink
          WHERE ParentId = @parentId AND ChildId = @childId
        `);

      if (linkCheck.recordset.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Child not linked to your account.',
        });
      }
    }

    const history = await Heartbeat.getHistory(childId, hours);
    const isOnline = await Heartbeat.isOnline(childId);

    res.status(200).json({
      success: true,
      data: {
        isOnline,
        history,
      },
    });
  } catch (error) {
    console.error('Get heartbeat history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get heartbeat history',
      error: error.message,
    });
  }
};

// Get all children's online status (for parent)
const getChildrenOnlineStatus = async (req, res) => {
  try {
    const parentUserId = req.user.userId;

    const pool = await getConnection();

    // Get all linked children
    const children = await pool
      .request()
      .input('parentId', mssql.Int, parentUserId)
      .query(`
        SELECT 
          u.UserId as ChildId,
          u.Name as ChildName,
          u.Email as ChildEmail
        FROM Users u
        INNER JOIN ParentChildLink pcl ON u.UserId = pcl.ChildId
        WHERE pcl.ParentId = @parentId AND u.Role = 'child'
      `);

    // Get online status for each child
    const childrenStatus = await Promise.all(
      children.recordset.map(async (child) => {
        const lastHeartbeat = await Heartbeat.getLastHeartbeat(child.ChildId);
        const isOnline = await Heartbeat.isOnline(child.ChildId);
        
        let minutesOffline = null;
        if (lastHeartbeat) {
          minutesOffline = Math.floor(
            (new Date() - new Date(lastHeartbeat.LastSeenAt)) / 1000 / 60
          );
        }

        return {
          ...child,
          isOnline,
          lastHeartbeat: lastHeartbeat ? lastHeartbeat.LastSeenAt : null,
          minutesOffline,
          batteryLevel: lastHeartbeat ? lastHeartbeat.BatteryLevel : null,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: childrenStatus,
    });
  } catch (error) {
    console.error('Get children online status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get children online status',
      error: error.message,
    });
  }
};

module.exports = {
  sendHeartbeat,
  getMyHeartbeatStatus,
  getHeartbeatHistory,
  getChildrenOnlineStatus,
};
