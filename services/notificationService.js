const { Expo } = require('expo-server-sdk');
const User = require('../models/User');

// Create a new Expo SDK client
let expo = new Expo();

/**
 * Sends a push notification to a specific user.
 * 
 * @param {number} userId - The ID of the user to send the notification to.
 * @param {string} title - The title of the notification.
 * @param {string} body - The body message of the notification.
 * @param {object} [data] - Optional extra data payload.
 */
const sendPushNotification = async (userId, title, body, data = {}) => {
  try {
    // 1. Fetch the user's PushToken from the database
    const user = await User.findById(userId);

    if (!user || !user.PushToken) {
      console.log(`🔕 No PushToken found for user ${userId}. Skipping push notification.`);
      return; // Silently abort if the user doesn't have a token
    }

    const pushToken = user.PushToken;

    // 2. Validate the Expo push token
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`❌ Push token ${pushToken} is not a valid Expo push token`);
      return;
    }

    // 3. Construct the message
    const messages = [];
    messages.push({
      to: pushToken,
      sound: 'default',
      channelId: 'alerts',
      title: title,
      body: body,
      data: data,
    });

    // 4. Send the notification chunk
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('❌ Error sending push notification chunk:', error);
      }
    }

    console.log(`✅ Push notification sent to user ${userId}:`, title);

  } catch (error) {
    // We catch and log the error so the calling function (like Alert.create) doesn't fail
    console.error('❌ Error in sendPushNotification service:', error);
  }
};

module.exports = {
  sendPushNotification,
};
