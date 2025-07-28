    const express = require('express');
    const router = express.Router();
    const webhookController = require('../controllers/webhookController'); // Assuming you'll have a webhookController

    // This will be your main webhook endpoint
    router.post('/paymongo', webhookController.handlePaymongoWebhook);

    module.exports = router;
    