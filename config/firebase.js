/**
 * Firebase Admin SDK Configuration
 * Handles FCM push notifications
 */

const admin = require('firebase-admin');

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK
 * @param {Object} serviceAccount - Firebase service account credentials
 * @returns {Object} Firebase Admin instance
 */
function initializeFirebase(serviceAccount = null) {
  if (firebaseInitialized) {
    console.log('ℹ️ Firebase already initialized');
    return admin;
  }

  try {
    // Check if service account is provided
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // Try to load from environment variable (JSON string)
      const serviceAccountFromEnv = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountFromEnv)
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Try to load from file path in environment variable
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
    } else {
      console.warn('⚠️ No Firebase credentials found. FCM notifications will not work.');
      console.warn('Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS environment variable.');
      return null;
    }

    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK initialized successfully');
    return admin;
  } catch (error) {
    console.error('❌ Error initializing Firebase Admin SDK:', error);
    return null;
  }
}

/**
 * Get Firebase Admin instance
 * @returns {Object} Firebase Admin instance or null
 */
function getFirebaseAdmin() {
  if (!firebaseInitialized) {
    console.warn('⚠️ Firebase not initialized. Call initializeFirebase() first.');
    return null;
  }
  return admin;
}

/**
 * Check if Firebase is initialized
 * @returns {boolean}
 */
function isFirebaseInitialized() {
  return firebaseInitialized;
}

module.exports = {
  initializeFirebase,
  getFirebaseAdmin,
  isFirebaseInitialized
};
