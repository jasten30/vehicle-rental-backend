// backend/generateSignature.js

const crypto = require('crypto');

const WEBHOOK_SECRET = 'whsk_A8WXTWVQJH9fM5otRzZKkdKt'; // <--- VERIFY THIS IS YOUR ACTUAL, CORRECT WEBHOOK SECRET

/*
 * This is the raw JSON payload with LF (\n) newlines.
 * This is the version you will paste directly into your editor.
 * Its length is 1590 characters.
 */
const PAYLOAD_JSON_LF_ONLY = `{
"data": {
"id": "event_xxxxxxxxxxxxxxxxx",
"type": "event",
"attributes": {
"livemode": false,
"type": "payment.paid",
"data": {
"id": "pi_WCvDSo7iNZYx9RqFr17U6jw8",
"type": "payment_intent",
"attributes": {
"amount": 540000,
"balance_transactions": [],
"billing": null,
"client_key": "pi_xxxxxxxxxxxxxxxxx_client_xxxxxxxxxxxxxxxxx",
"currency": "PHP",
"description": "RentCycle Booking for Vehicle Toyota Vios (ID: 8)",
"disputes": [],
"last_payment_error": null,
"livemode": false,
"metadata": {
"booking_id": "26",
"user_id": "1"
},
"next_action": null,
"payments": [
{
"id": "pay_xxxxxxxxxxxxxxxxx",
"type": "payment",
"attributes": {
"amount": 540000,
"balance_transaction_id": null,
"billing": null,
"card_brand": null,
"card_last4": null,
"currency": "PHP",
"description": null,
"disputed": false,
"external_reference_id": null,
"fee": 0,
"livemode": false,
"net_amount": 540000,
"payout": null,
"payout_release_at": null,
"paid_at": 1749873404,
"payment_intent_id": "pi_WCvDSo7iNZYx9RqFr17U6jw8",
"payment_method_id": "pm_xxxxxxxxxxxxxxxxx",
"source_id": null,
"statement_descriptor": "RentCycle Booking",
"status": "paid",
"tax_amount": null,
"receipt": null,
"refunds": [],
"application_fees": [],
"setup_future_usage": null,
"created_at": 1749873404,
"updated_at": 1749873404
}
}
],
"payment_method_allowed": [
"gcash"
],
"payment_method_options": null,
"payment_method_id": "pm_xxxxxxxxxxxxxxxxx",
"setup_future_usage": null,
"status": "succeeded",
"usage": null,
"created_at": 1749873404,
"updated_at": 1749873404
}
},
"created_at": 1749873404,
"updated_at": 1749873404
}
}
}`;

// Programmatically convert all LF (\n) newlines to CRLF (\r\n)
const PAYLOAD_JSON_CRLF = PAYLOAD_JSON_LF_ONLY.replace(/\n/g, '\r\n');

// Get current timestamp in seconds
const timestamp = Math.floor(Date.now() / 1000);

// Combine timestamp and payload
const signedPayload = `${timestamp}.${PAYLOAD_JSON_CRLF}`;

// DEBUG LOGS
console.log('Local Signed Payload:', signedPayload);
console.log('Local Signed Payload Length:', signedPayload.length); // Expecting 1677
console.log('Local Signed Payload Char Codes (first 20):', signedPayload.slice(0, 20).split('').map(char => char.charCodeAt(0)));
console.log('Local Signed Payload Char Codes (last 20):', signedPayload.slice(-20).split('').map(char => char.charCodeAt(0)));

// Compute HMAC SHA256 signature
const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
hmac.update(signedPayload);
const signature = hmac.digest('hex');

console.log('Generated Paymongo-Signature: t=' + timestamp + ',v1=' + signature);