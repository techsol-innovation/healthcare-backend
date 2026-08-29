/**
 * setup-tables.js
 * 
 * Checks whether all required database tables exist.
 * If a table is missing, it creates it with the exact columns used
 * across the models, controllers, and mobile app screens.
 * 
 * Tables covered:
 *   Users, ParentChildLink, Medicines, MedicineTracking,
 *   Heartbeats, BatteryLogs, BatteryAlerts, Alerts, SOSEvents, FCMTokens
 * 
 * Usage:  node setup-tables.js
 */

const { getConnection, closeConnection, mssql } = require('./config/database');

// ─── Table definitions ───────────────────────────────────────────────────────
// Each entry has:
//   name  – exact table name used in queries throughout the project
//   sql   – CREATE TABLE statement (only runs when the table is missing)

const tables = [
  {
    name: 'Users',
    sql: `
      CREATE TABLE Users (
        UserId       INT           IDENTITY(1,1) PRIMARY KEY,
        Name         NVARCHAR(255) NOT NULL,
        Email        VARCHAR(255)  NOT NULL UNIQUE,
        PasswordHash VARCHAR(255)  NOT NULL,
        Role         VARCHAR(50)   NOT NULL,           -- 'parent' | 'child'
        PhoneNumber  VARCHAR(20)   NULL,
        PushToken    VARCHAR(255)  NULL,
        IsActivated  BIT           NOT NULL DEFAULT 1,
        CreatedAt    DATETIME      NOT NULL DEFAULT GETDATE()
      );
    `,
  },

  {
    name: 'ParentChildLink',
    sql: `
      CREATE TABLE ParentChildLink (
        LinkId    INT      IDENTITY(1,1) PRIMARY KEY,
        ParentId  INT      NOT NULL REFERENCES Users(UserId),
        ChildId   INT      NOT NULL REFERENCES Users(UserId),
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
      );
    `,
  },

  {
    name: 'Medicines',
    sql: `
      CREATE TABLE Medicines (
        MedicineId INT           IDENTITY(1,1) PRIMARY KEY,
        Name       NVARCHAR(255) NOT NULL,
        Dosage     NVARCHAR(255) NOT NULL,
        Frequency  NVARCHAR(50)  NOT NULL,   -- 'daily' | 'twice-daily' | 'as-needed'
        Time       VARCHAR(100)  NOT NULL,
        ParentId   INT           NOT NULL REFERENCES Users(UserId),
        ChildId    INT           NOT NULL REFERENCES Users(UserId),
        StartDate  DATE          NOT NULL,
        EndDate    DATE          NULL,
        Notes      NVARCHAR(MAX) NULL,
        IsActive   BIT           NOT NULL DEFAULT 1,
        CreatedAt  DATETIME      NOT NULL DEFAULT GETDATE()
      );
    `,
  },

  {
    name: 'MedicineTracking',
    sql: `
      CREATE TABLE MedicineTracking (
        TrackingId    INT           IDENTITY(1,1) PRIMARY KEY,
        MedicineId    INT           NOT NULL REFERENCES Medicines(MedicineId),
        ScheduledDate DATE          NOT NULL,
        ScheduledTime VARCHAR(100)  NOT NULL,
        Status        VARCHAR(50)   NOT NULL DEFAULT 'pending',  -- 'pending' | 'taken' | 'missed'
        TakenAt       DATETIME      NULL,
        Notes         NVARCHAR(MAX) NULL,
        CreatedAt     DATETIME      NOT NULL DEFAULT GETDATE()
      );
    `,
  },

  {
    name: 'Heartbeats',
    sql: `
      CREATE TABLE Heartbeats (
        HeartbeatId INT           IDENTITY(1,1) PRIMARY KEY,
        ChildId     INT           NOT NULL REFERENCES Users(UserId),
        DeviceInfo  NVARCHAR(MAX) NOT NULL,   -- JSON: model, OS version, app version
        BatteryLevel INT          NULL,
        LastSeenAt  DATETIME      NOT NULL DEFAULT GETDATE(),
        CreatedAt   DATETIME      NOT NULL DEFAULT GETDATE()
      );
    `,
  },

  {
    name: 'BatteryLogs',
    sql: `
      CREATE TABLE BatteryLogs (
        LogId             INT         IDENTITY(1,1) PRIMARY KEY,
        ParentUserId      INT         NOT NULL REFERENCES Users(UserId),
        BatteryPercentage INT         NOT NULL,           -- 0 – 100
        BatteryState      VARCHAR(20) NOT NULL,           -- 'charging' | 'unplugged' | 'full' | 'unknown'
        IsCharging        BIT         NOT NULL DEFAULT 0,
        LoggedAt          DATETIME    NOT NULL DEFAULT GETDATE()
      );
    `,
  },

  {
    name: 'BatteryAlerts',
    sql: `
      CREATE TABLE BatteryAlerts (
        AlertId           INT           IDENTITY(1,1) PRIMARY KEY,
        ParentUserId      INT           NOT NULL REFERENCES Users(UserId),
        CaretakerId       INT           NOT NULL REFERENCES Users(UserId),
        BatteryPercentage INT           NOT NULL,           -- 0 – 100
        BatteryState      VARCHAR(20)   NOT NULL,           -- 'charging' | 'unplugged' | 'full' | 'unknown'
        AlertStatus       VARCHAR(50)   NOT NULL DEFAULT 'sent',  -- 'sent' | 'pending'
        DeviceInfo        NVARCHAR(500) NULL,
        AlertSentAt       DATETIME      NOT NULL DEFAULT GETDATE(),
        IsAcknowledged    BIT           NULL DEFAULT 0,
        AcknowledgedAt    DATETIME      NULL
      );
    `,
  },

  {
    name: 'Alerts',
    sql: `
      CREATE TABLE Alerts (
        AlertId           INT           IDENTITY(1,1) PRIMARY KEY,
        ParentId          INT           NOT NULL REFERENCES Users(UserId),
        ChildId           INT           NULL     REFERENCES Users(UserId),
        AlertType         VARCHAR(50)   NOT NULL,   -- 'sos' | 'offline' | 'missed_medicine' | 'low_battery'
        Title             NVARCHAR(255) NOT NULL,
        Message           NVARCHAR(MAX) NULL,
        Severity          VARCHAR(50)   NOT NULL DEFAULT 'medium',  -- 'low' | 'medium' | 'high' | 'critical'
        IsRead            BIT           NOT NULL DEFAULT 0,
        RelatedEntityId   INT           NULL,
        RelatedEntityType VARCHAR(50)   NULL,
        CreatedAt         DATETIME      NOT NULL DEFAULT GETDATE(),
        ReadAt            DATETIME      NULL
      );
    `,
  },

  {
    name: 'SOSEvents',
    sql: `
      CREATE TABLE SOSEvents (
        SOSId          INT           IDENTITY(1,1) PRIMARY KEY,
        ParentId       INT           NOT NULL REFERENCES Users(UserId),
        ChildId        INT           NOT NULL REFERENCES Users(UserId),
        Message        NVARCHAR(MAX) NOT NULL DEFAULT 'Emergency SOS triggered',
        Location       NVARCHAR(MAX) NULL,
        Status         VARCHAR(50)   NOT NULL DEFAULT 'active',  -- 'active' | 'acknowledged' | 'resolved'
        CreatedAt      DATETIME      NOT NULL DEFAULT GETDATE(),
        AcknowledgedAt DATETIME      NULL,
        ResolvedAt     DATETIME      NULL
      );
    `,
  },

  {
    name: 'FCMTokens',
    sql: `
      CREATE TABLE FCMTokens (
        TokenId      INT            IDENTITY(1,1) PRIMARY KEY,
        UserId       INT            NOT NULL REFERENCES Users(UserId),
        FCMToken     NVARCHAR(500)  NOT NULL,
        DeviceInfo   NVARCHAR(MAX)  NULL,
        RegisteredAt DATETIME       NOT NULL DEFAULT GETDATE(),
        LastUsedAt   DATETIME       NOT NULL DEFAULT GETDATE(),
        IsActive     BIT            NOT NULL DEFAULT 1
      );
    `,
  },
  {
    name: 'CheckIns',
    sql: `
      CREATE TABLE CheckIns (
        CheckInId  INT IDENTITY(1,1) PRIMARY KEY,
        ParentId   INT NOT NULL REFERENCES Users(UserId),
        CheckInTime DATETIME NOT NULL DEFAULT GETDATE()
      );
    `,
  },
];

// ─── Column migrations ────────────────────────────────────────────────────────
// For tables that already existed before the full schema was defined, we add
// any missing columns so the models keep working without dropping/recreating.
//
// Each entry:
//   table  – table name
//   column – column name to add if absent
//   def    – column definition used in ALTER TABLE … ADD
const columnMigrations = [
  // BatteryLogs: legacy BatteryLog.log() method still writes/reads ChildId,
  // BatteryLevel and IsCharging; getLowBatteryChildren() also selects them.
  { table: 'BatteryLogs', column: 'ChildId',      def: 'INT NULL' },
  { table: 'BatteryLogs', column: 'BatteryLevel', def: 'INT NULL' },
  { table: 'BatteryLogs', column: 'IsCharging',   def: 'BIT NOT NULL DEFAULT 0' },

  // Heartbeats: BatteryLevel is queried in heartbeatMonitor / heartbeatController
  { table: 'Heartbeats',  column: 'BatteryLevel', def: 'INT NULL' },

  // FCMTokens: LastUsedAt is used for tracking token activity
  { table: 'FCMTokens',   column: 'LastUsedAt',   def: 'DATETIME NOT NULL DEFAULT GETDATE()' },
];

// ─── Helper: check if a table exists ─────────────────────────────────────────
async function tableExists(pool, tableName) {
  const result = await pool
    .request()
    .input('tableName', mssql.VarChar, tableName)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME = @tableName
    `);
  return result.recordset[0].cnt > 0;
}

// ─── Helper: check if a column exists ────────────────────────────────────────
async function columnExists(pool, tableName, columnName) {
  const result = await pool
    .request()
    .input('tableName',  mssql.VarChar, tableName)
    .input('columnName', mssql.VarChar, columnName)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME  = @tableName
        AND COLUMN_NAME = @columnName
    `);
  return result.recordset[0].cnt > 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('  HealthTakeCare – Database Table Setup');
  console.log('='.repeat(60));

  let pool;
  try {
    pool = await getConnection();
  } catch (err) {
    console.error('❌  Could not connect to the database:', err.message);
    process.exit(1);
  }

  let created = 0;
  let alreadyExisted = 0;

  for (const table of tables) {
    try {
      const exists = await tableExists(pool, table.name);

      if (exists) {
        console.log(`✅  [EXISTS]  ${table.name}`);
        alreadyExisted++;
      } else {
        console.log(`🔧  [CREATING] ${table.name} ...`);
        await pool.request().query(table.sql);
        console.log(`✅  [CREATED]  ${table.name}`);
        created++;
      }
    } catch (err) {
      console.error(`❌  [ERROR]   ${table.name} – ${err.message}`);
    }
  }

  // ── Column migrations ──────────────────────────────────────────────────────
  console.log('');
  console.log('  Checking for missing columns...');

  let colsAdded = 0;
  let colsExisted = 0;

  for (const { table, column, def } of columnMigrations) {
    try {
      const exists = await columnExists(pool, table, column);
      if (exists) {
        console.log(`✅  [COL EXISTS]  ${table}.${column}`);
        colsExisted++;
      } else {
        console.log(`🔧  [ADDING COL]  ${table}.${column} (${def}) ...`);
        await pool.request().query(`ALTER TABLE ${table} ADD ${column} ${def}`);
        console.log(`✅  [COL ADDED]   ${table}.${column}`);
        colsAdded++;
      }
    } catch (err) {
      console.error(`❌  [COL ERROR]   ${table}.${column} – ${err.message}`);
    }
  }

  console.log('');
  console.log('─'.repeat(60));
  console.log(`  Tables  : ${alreadyExisted} already existed, ${created} created`);
  console.log(`  Columns : ${colsExisted} already existed, ${colsAdded} added`);
  console.log('─'.repeat(60));

  await closeConnection();
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
