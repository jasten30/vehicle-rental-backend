// src/services/paymentService.js

const PaymongoClient = require('paymongo');
const paymongo = new PaymongoClient(process.env.PAYMONGO_SECRET_KEY);

exports.createPaymentIntent = async (amount, currency, description, paymentMethodType, returnUrls, metadata) => {
    try {
        console.log(`--- Inside paymentService.createPaymentIntent for debugging ---`);
        console.log(`Parameters received:`);
        console.log(`  Amount (original): ${amount}`);
        console.log(`  Amount (Paymongo format - cents): ${Math.round(amount * 100)}`);
        console.log(`  Currency: '${currency}'`);
        console.log(`  Description: '${description}'`);
        console.log(`  Payment Method Type: '${paymentMethodType}'`);
        console.log(`  Return URLs (type: ${typeof returnUrls}): `, returnUrls);
        console.log(`  Metadata (type: ${typeof metadata}): `, metadata);

        // Construct the attributes object first
        const attributesPayload = {
            amount: Math.round(amount * 100),
            currency: currency,
            payment_method_allowed: [paymentMethodType],
            description: description,
            statement_descriptor: 'RentCycle Booking',
            return_url: returnUrls,
            // --- MODIFIED HERE: Convert metadata values to strings ---
            metadata: {
                booking_id: String(metadata.booking_id), // Ensure booking_id is a string
                user_id: String(metadata.user_id)       // Ensure user_id is a string
            }
            // --- END MODIFIED ---
        };

        console.log('Debug: Attributes payload constructed:', JSON.stringify(attributesPayload, null, 2));

        const requestPayloadForSDK = {
            data: {
                attributes: attributesPayload
            }
        };

        console.log('Debug: Final object passed to paymongo.paymentIntents.create():', JSON.stringify(requestPayloadForSDK, null, 2));

        const paymentIntent = await paymongo.paymentIntents.create(requestPayloadForSDK);

        console.log("Paymongo Payment Intent created:", paymentIntent);
        return paymentIntent;
    } catch (error) {
        console.error('Error creating Paymongo Payment Intent:', error.response ? error.response.data : error.message);
        throw new Error(`Paymongo Payment Intent creation failed: ${error.response ? error.response.data.errors[0].detail : error.message}`);
    }
};

exports.retrievePaymentIntent = async (paymentIntentId) => {
    try {
        const paymentIntent = await paymongo.paymentIntents.retrieve(paymentIntentId);
        return paymentIntent;
    } catch (error) {
        console.error('Error retrieving Paymongo Payment Intent:', error.response ? error.response.data : error.message);
        throw new Error(`Paymongo Payment Intent retrieval failed: ${error.response ? error.response.data.errors[0].detail : error.message}`);
    }
};