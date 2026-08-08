const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const messaging = admin.messaging();

async function sendToUid(uid, title, body) {
  const tokenDoc = await db.collection("fcmTokens").doc(uid).get();
  const token = tokenDoc.exists ? tokenDoc.data().token : null;
  if (!token) {
    console.log(`No FCM token for uid ${uid}, skipping.`);
    return;
  }
  try {
    await messaging.send({ token, notification: { title, body } });
    console.log(`Notified ${uid}: ${title}`);
  } catch (err) {
    console.error(`Failed to notify ${uid}:`, err.message);
  }
}

async function notifyEmployeesOfNewBookings() {
  const snapshot = await db.collection("bookings")
    .where("employeeNotified", "==", false)
    .get();

  for (const doc of snapshot.docs) {
    const booking = doc.data();

    if (booking.employee) {
      const staffQuery = await db.collection("users")
        .where("name", "==", booking.employee)
        .where("role", "==", "employee")
        .limit(1)
        .get();

      if (!staffQuery.empty) {
        const employeeUid = staffQuery.docs[0].id;
        await sendToUid(
          employeeUid,
          "New booking request",
          `${booking.name} ${booking.surname} requested ${booking.service || "a service"} on ${booking.dateFormatted || booking.date}.`
        );
      } else {
        console.log(`No employee account matches name "${booking.employee}".`);
      }
    }

    await doc.ref.update({ employeeNotified: true });
  }
}

async function notifyCustomersOfStatusChanges() {
  const snapshot = await db.collection("bookings")
    .where("customerNotified", "==", false)
    .where("status", "in", ["upcoming", "cancelled"])
    .get();

  for (const doc of snapshot.docs) {
    const booking = doc.data();

    if (booking.status === "upcoming") {
      await sendToUid(
        booking.uid,
        "Booking accepted",
        `Your ${booking.service || "appointment"} on ${booking.dateFormatted || booking.date} has been accepted.`
      );
    } else {
      await sendToUid(
        booking.uid,
        "Booking declined",
        `Your ${booking.service || "appointment"} on ${booking.dateFormatted || booking.date} could not be accepted. Please choose another time.`
      );
    }

    await doc.ref.update({ customerNotified: true });
  }
}

async function main() {
  await notifyEmployeesOfNewBookings();
  await notifyCustomersOfStatusChanges();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Notification run failed:", err);
    process.exit(1);
  });