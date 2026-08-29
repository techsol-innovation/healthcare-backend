const { getConnection } = require('./config/database');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const pool = await getConnection();
    
    console.log('🔍 Checking battery monitoring tables...\n');
    
    // Check BatteryLogs
    const batteryLogsCheck = await pool.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'BatteryLogs'
    `);
    
    if (batteryLogsCheck.recordset.length > 0) {
      console.log('✅ BatteryLogs exists - needs migration');
      
      // Check if new columns exist
      const columns = await pool.request().query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'BatteryLogs' 
        AND COLUMN_NAME IN ('ParentUserId', 'BatteryPercentage', 'BatteryState')
      `);
      
      if (columns.recordset.length < 3) {
        console.log('   ⚠️  Missing new columns - run MIGRATE_BATTERY_LOGS.sql');
      } else {
        console.log('   ✅ Has new columns');
      }
    } else {
      console.log('❌ BatteryLogs does NOT exist');
    }
    
    // Check BatteryAlerts
    const batteryAlertsCheck = await pool.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'BatteryAlerts'
    `);
    
    if (batteryAlertsCheck.recordset.length > 0) {
      console.log('✅ BatteryAlerts exists');
    } else {
      console.log('❌ BatteryAlerts does NOT exist - run CREATE_BATTERY_MONITORING_TABLES.sql');
    }
    
    // Check FCMTokens
    const fcmTokensCheck = await pool.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'FCMTokens'
    `);
    
    if (fcmTokensCheck.recordset.length > 0) {
      console.log('✅ FCMTokens exists');
    } else {
      console.log('❌ FCMTokens does NOT exist - run CREATE_BATTERY_MONITORING_TABLES.sql');
    }
    
    console.log('\n📋 Action Required:');
    console.log('==================');
    
    if (batteryLogsCheck.recordset.length > 0) {
      const columns = await pool.request().query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'BatteryLogs' 
        AND COLUMN_NAME IN ('ParentUserId', 'BatteryPercentage', 'BatteryState')
      `);
      
      if (columns.recordset.length < 3) {
        console.log('1. Run: database\\MIGRATE_BATTERY_LOGS.sql');
      }
    }
    
    if (batteryAlertsCheck.recordset.length === 0 || fcmTokensCheck.recordset.length === 0) {
      console.log('2. Run: database\\CREATE_BATTERY_MONITORING_TABLES.sql');
    }
    
    console.log('\nOr create a script to run both automatically!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
