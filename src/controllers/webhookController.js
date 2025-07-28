// backend/src/controllers/webhookController.js

const crypto = require('crypto');
const { db, admin } = require('../utils/firebase');

const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;

const handlePaymongoWebhook = async (req, res) => {
    console.log('--- Webhook Received ---');

    const rawBody = req.rawBody;
    const signatureHeader = req.headers['paymongo-signature'];

    if (!signatureHeader) {
        console.error('Webhook error: Missing Paymongo-Signature header');
        return res.status(400).send('Missing Paymongo-Signature header');
    }

    if (!PAYMONGO_WEBHOOK_SECRET || typeof PAYMONGO_WEBHOOK_SECRET !== 'string' || PAYMONGO_WEBHOOK_SECRET.length === 0) {
        console.error('Webhook Error: PAYMONGO_WEBHOOK_SECRET is not set or is invalid at runtime.');
        return res.status(500).send('Webhook secret not configured');
    }
    console.log('RUNTIME WEBHOOK SECRET: SET');

    let parsedBody;
    try {
        parsedBody = JSON.parse(rawBody);
    } catch (parseError) {
        console.error('Webhook Error: Failed to parse raw body as JSON:', parseError.message);
        return res.status(400).send('Invalid JSON Payload');
    }

    try {
        const [timestampPart, signaturePart] = signatureHeader.split(',');
        const timestamp = timestampPart.split('=')[1];
        const receivedSignature = signaturePart.split('=')[1];

        const signedPayload = `${timestamp}.${rawBody}`;

        const hmac = crypto.createHmac('sha256', PAYMONGO_WEBHOOK_SECRET);
        hmac.update(signedPayload);
        const computedSignature = hmac.digest('hex');

        console.log('Received Signature (from header):', receivedSignature);
        console.log('Computed Signature (on server):', computedSignature);

        if (computedSignature !== receivedSignature) {
            console.error('Webhook Error: Invalid Paymongo-Signature');
            return res.status(401).send('Invalid Paymongo-Signature');
        }

        console.log('Paymongo Webhook Signature Verified: OK');

        const eventType = parsedBody.data.attributes.type;
        const paymentIntendId = parsedBody.data.attributes.data.id;
        const paymentStatus = parsedBody.data.attributes.data.attributes.status;
        const bookingId = parsedBody.data.attributes.data.attributes.metadata?.booking_id;
        const userId = parsedBody.data.attributes.data.attributes.metadata?.user_id;

        console.log(`Event Type: ${eventType}`);
        console.log(`Payment Intent ID: ${paymentIntendId}`);
        console.log(`Payment Status: ${paymentStatus}`);
        console.log(`Associated Bookind ID: ${bookingId}`);
        console.log(`Associated User ID: ${userId}`);

        if (eventType === 'payment.paid' && bookingId && userId && paymentStatus === 'succeeded') {
            console.log('__app_id value:', process.env.__app_id);

            const appId = process.env.__app_id || 'default-app-id-for-local';
            const bookingRef = db.collection('artifacts').doc(appId).collection('users').doc(userId).collection('bookings').doc(bookingId);

            console.log('Attempting to update Firestore document at path:', bookingRef.path);

            try {
                await bookingRef.set({
                    status: 'paid',
                    paymentIntentId: paymentIntentId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });

                console.log(`Successfully updated/created booking ${bookingId} to status 'paid' for user ${userId}`);
                res.status(200).send('Webhook received, signature verified, and booking updated.');

            } catch (dbError) {
                console.error(`Firestore Operation Error for booking ${bookingId} (user ${userId}):`, dbError.message);
                console.error(dbError.stack);
                return res.status(200).send('Webhook received, signature verified, but internal database update failed.');
            }
        } else {
            console.log(`Webhook received but not processed: Event type is '${eventType}' or status is not 'succeeded', or missing booking/user ID.`);
            res.status(200).send('Webhook received, signature verified, but not processed (not a relevant event or missing data).');
        }
    } catch (error) {
        console.error('Error during webhook processing or verification:', error.message);
        console.error(error.stack);
        return res.status(500).send('Internal Server during webhook processing');
    }
};

module.exports = {
    handlePaymongoWebhook
};




