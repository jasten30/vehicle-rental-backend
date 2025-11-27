const { admin, db } = require('../utils/firebase');
const { DateTime } = require('luxon'); // Import Luxon if needed for formatting

// Helper to convert Firestore Timestamps safely for JSON response
const convertTimestamp = (timestamp) => {
    if (timestamp && typeof timestamp.toDate === 'function') {
        // Convert to ISO string for consistency in API responses
        return timestamp.toDate().toISOString();
    }
    // Return primitive types or null/undefined as is
    if (typeof timestamp !== 'object' || timestamp === null) {
        return timestamp;
    }
    // If it's already serialized ({_seconds, _nanoseconds}), handle it (optional)
    if (timestamp._seconds !== undefined && timestamp._nanoseconds !== undefined) {
         try {
             const jsDate = new Date(timestamp._seconds * 1000 + timestamp._nanoseconds / 1000000);
             return jsDate.toISOString();
         } catch(e) { return timestamp; } // Fallback to original object on error
    }
    // Fallback if it's some other object type
    return timestamp;
}

/**
 * Generates a consistent chat ID based on two user IDs.
 * @param {string} userId1
 * @param {string} userId2
 * @returns {string} The generated chat ID.
 */
const generateChatId = (userId1, userId2) => {
    // Create a consistent ID regardless of user order
    return [userId1, userId2].sort().join('_');
};


// -----------------------------------------------------------------
// --- FINANCIAL FUNCTIONALITY ---
// -----------------------------------------------------------------

/**
 * Marks a reported platform fee payment as verified (Paid).
 * PUT /api/admin/platform-fees/:feeId/verify
 */
const verifyPlatformFee = async (req, res) => {
    const { feeId } = req.params;
    const adminUserId = req.customUser.uid;

    if (!feeId) {
        return res.status(400).json({ message: 'Fee ID is required for verification.' });
    }

    try {
        const feeRef = db.collection('platform_fees').doc(feeId);
        const feeDoc = await feeRef.get();

        if (!feeDoc.exists) {
            return res.status(404).json({ message: 'Platform fee record not found.' });
        }

        const currentStatus = feeDoc.data().status;
        if (currentStatus === 'verified') {
            return res.status(200).json({ message: 'Fee is already verified.' });
        }

        await feeRef.update({
            status: 'verified',
            verifiedBy: adminUserId,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[AdminController] Admin ${adminUserId} verified platform fee ${feeId}.`);
        res.status(200).json({ message: 'Fee verified successfully.', status: 'verified' });

    } catch (error) {
        console.error(`[AdminController] Error verifying fee ${feeId}:`, error);
        res.status(500).json({ message: 'Failed to verify payment.' });
    }
};

/**
 * Fetches all manually reported platform fee records.
 */
const getAllPlatformFees = async (req, res) => {
    try {
        console.log("[AdminController] Fetching all reported platform fee records...");

        // NOTE: The collection name is confirmed as 'platform_fees'
        const feesSnapshot = await db.collection('platform_fees')
            .orderBy('createdAt', 'desc')
            .get();

        const fees = await Promise.all(feesSnapshot.docs.map(async (doc) => {
            const feeData = { id: doc.id, ...doc.data() };
            const hostId = feeData.ownerId || feeData.hostId;
            
            let hostName = 'Unknown Host';
            let hostEmail = 'N/A';

            if (hostId) {
                // Fetch user details for display
                const userDoc = await db.collection('users').doc(hostId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    hostName = userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Host';
                    hostEmail = userData.email || 'N/A';
                }
            }
            
            // Format data for frontend consumption
            return {
                ...feeData,
                hostName,
                hostEmail,
                amount: Number(feeData.amount) || 0,
                status: feeData.status || 'pending', 
                createdAt: convertTimestamp(feeData.createdAt),
            };
        }));

        res.status(200).json(fees);
    } catch (error) {
        console.error('[AdminController] Error fetching platform fees:', error);
        res.status(500).json({ message: 'Failed to fetch platform fee records.' });
    }
};

/**
 * Fetches all pre-calculated, summarized host monthly statements (balances/fees owed).
 */
const getAllHostMonthlyStatements = async (req, res) => {
    try {
        console.log("[AdminController] Fetching all host monthly statements...");

        // NOTE: The collection name is hostMonthlyStatements (currently assumed missing)
        const statementsSnapshot = await db.collection('hostMonthlyStatements')
            .orderBy('year', 'desc')
            .orderBy('monthIndex', 'desc') 
            .get();

        if (statementsSnapshot.empty) {
            console.log("[AdminController] No host monthly statements found.");
            return res.status(200).json([]);
        }

        // 2. Map and enrich the statements (e.g., convert timestamps, resolve host names)
        const statements = await Promise.all(
            statementsSnapshot.docs.map(async (doc) => {
                const statementData = { id: doc.id, ...doc.data() };
                const hostId = statementData.ownerId || statementData.hostId;
                
                let hostName = 'Unknown Host';
                let hostEmail = 'N/A';

                if (hostId) {
                    const userDoc = await db.collection('users').doc(hostId).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        hostName = userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Host';
                        hostEmail = userData.email || 'N/A';
                    }
                }

                // Ensure the data structure matches what the frontend expects (AdminBookingsView)
                return {
                    id: statementData.id,
                    hostName: hostName, 
                    hostEmail: hostEmail,
                    ownerId: hostId,
                    month: statementData.monthName || statementData.month, 
                    year: statementData.year,
                    // Use the actual balance due field
                    amount: statementData.balanceDue || statementData.totalFeeOwed, 
                    referenceNumber: statementData.referenceNumber || 'N/A - Statement',
                    // Status: Use 'unpaid' if there's a balance due, otherwise use the status from data or 'verified'
                    status: statementData.status || (statementData.balanceDue > 0 ? 'unpaid' : 'verified'),
                };
            })
        );

        res.status(200).json(statements);
    } catch (error) {
        console.error('[AdminController] Error fetching host monthly statements:', error);
        res.status(500).json({ message: 'Server error fetching financial statements.' });
    }
};

// -----------------------------------------------------------------
// --- EXISTING FUNCTIONALITY ---
// -----------------------------------------------------------------


/**
 * Fetches all pending drive applications and enriches them with user details.
 */
const getDriveApplications = async (req, res) => {
  try {
    const applicationsSnapshot = await db.collection('driveApplications').where('status', '==', 'pending').get();

    if (applicationsSnapshot.empty) {
      return res.status(200).json([]);
    }

    const enrichedApplications = await Promise.all(
      applicationsSnapshot.docs.map(async (doc) => {
        const appData = { id: doc.id, ...doc.data() };
        let userName = 'Unknown User';
        let userEmail = 'N/A';
        let userRole = 'N/A';

        if (appData.userId) {
            const userDoc = await db.collection('users').doc(appData.userId).get();
            if (userDoc.exists) {
              const userData = userDoc.data();
              userName = userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'User';
              userEmail = userData.email || 'N/A';
              userRole = userData.role || 'renter';
            }
        }

        return {
          ...appData,
          // Ensure timestamps are converted if necessary
          submittedAt: convertTimestamp(appData.submittedAt),
          userName,
          userEmail,
          userRole,
        };
      })
    );

    res.status(200).json(enrichedApplications);
  } catch (error) {
    console.error('Error fetching drive applications:', error);
    res.status(500).json({ message: 'Failed to fetch drive applications.' });
  }
};

/**
 * Approves a drive application and updates the user's status.
 */
const approveDriveApplication = async (req, res) => {
    const { applicationId, userId } = req.body;
    if (!applicationId || !userId) {
        return res.status(400).json({ message: 'Application ID and User ID are required.' });
    }
    try {
        const appRef = db.collection('driveApplications').doc(applicationId);
        const userRef = db.collection('users').doc(userId);

        // Check if application exists and belongs to the user (optional but good)
        const appDoc = await appRef.get();
        if (!appDoc.exists || appDoc.data().userId !== userId) {
             return res.status(404).json({ message: 'Drive application not found or does not belong to the specified user.' });
        }

        await db.runTransaction(async (transaction) => {
            transaction.update(appRef, { status: 'approved', reviewedAt: admin.firestore.FieldValue.serverTimestamp() });
            transaction.update(userRef, { isApprovedToDrive: true });
        });

        // Optional: Send notification to the user
        // await createNotification(userId, "Your driver application has been approved!", "/dashboard/profile-settings");

        console.log(`Admin ${req.customUser.uid} approved drive application ${applicationId} for user ${userId}.`);
        res.status(200).json({ message: 'Application approved successfully.' });
    } catch (error) {
        console.error(`Error approving application ${applicationId}:`, error);
        res.status(500).json({ message: 'Failed to approve application.' });
    }
};

/**
 * Declines a drive application.
 */
const declineDriveApplication = async (req, res) => {
    const { applicationId, userId } = req.body; // Also get userId to notify
     if (!applicationId || !userId) { // Require both
        return res.status(400).json({ message: 'Application ID and User ID are required.' });
    }
    try {
         const appRef = db.collection('driveApplications').doc(applicationId);
         // Check if application exists and belongs to the user (optional but good)
         const appDoc = await appRef.get();
         if (!appDoc.exists || appDoc.data().userId !== userId) {
             return res.status(404).json({ message: 'Drive application not found or does not belong to the specified user.' });
        }

        await appRef.update({ status: 'declined', reviewedAt: admin.firestore.FieldValue.serverTimestamp() });

        // Optional: Send notification to the user
        // await createNotification(userId, "Your driver application has been declined.", "/dashboard/profile-settings");

        console.log(`Admin ${req.customUser.uid} declined drive application ${applicationId} for user ${userId}.`);
        res.status(200).json({ message: 'Application declined successfully.' });
    } catch (error) {
         console.error(`Error declining application ${applicationId}:`, error);
        res.status(500).json({ message: 'Failed to decline application.' });
    }
};

/**
 * Fetches booking reports and enriches them with user/vehicle details.
 */
const getBookingReports = async (req, res) => {
    try {
        console.log("[AdminController] Fetching booking reports...");
        const reportsRef = db.collection('reports').orderBy('reportedAt', 'desc');
        const snapshot = await reportsRef.get();

        if (snapshot.empty) {
            console.log("[AdminController] No reports found.");
            return res.status(200).json([]);
        }

        console.log(`[AdminController] Found ${snapshot.size} report documents.`);

        const reportPromises = snapshot.docs.map(async (doc) => {
            const reportId = doc.id;
            const report = doc.data();
            console.log(`[AdminController] Processing report ${reportId}. Raw Data:`, JSON.stringify(report));

            let reporterEmail = 'N/A';
            let vehicleMake = 'Unknown';
            let vehicleModel = 'Vehicle';
            let reportedPartyName = 'N/A';
            let reportedPartyId = null;

            if (report.reporterId) {
                try {
                    const userDoc = await db.collection('users').doc(report.reporterId).get();
                    if (userDoc.exists) {
                        reporterEmail = userDoc.data().email || 'N/A';
                        console.log(`[AdminController] Report ${reportId}: Found reporter email: ${reporterEmail}`);
                    } else {
                         console.warn(`[AdminController] Report ${reportId}: Reporter user document ${report.reporterId} not found.`);
                    }
                } catch (userError) {
                    console.error(`[AdminController] Report ${reportId}: Error fetching reporter ${report.reporterId}:`, userError.message);
                }
            } else {
                 console.warn(`[AdminController] Report ${reportId}: Missing reporterId.`);
            }

            if (report.vehicleId) {
                 try {
                    const vehicleDoc = await db.collection('vehicles').doc(report.vehicleId).get();
                     if (vehicleDoc.exists) {
                        vehicleMake = vehicleDoc.data().make || 'Unknown';
                        vehicleModel = vehicleDoc.data().model || 'Vehicle';
                        console.log(`[AdminController] Report ${reportId}: Found vehicle: ${vehicleMake} ${vehicleModel}`);
                    } else {
                         console.warn(`[AdminController] Report ${reportId}: Vehicle document ${report.vehicleId} not found.`);
                    }
                 } catch (vehicleError) {
                     console.error(`[AdminController] Report ${reportId}: Error fetching vehicle ${report.vehicleId}:`, vehicleError.message);
                 }
            } else {
                 console.warn(`[AdminController] Report ${reportId}: Missing vehicleId.`);
            }

            if (report.reporterRole === 'renter' && report.ownerId) {
                reportedPartyId = report.ownerId;
            } else if (report.reporterRole === 'owner' && report.renterId) {
                reportedPartyId = report.renterId;
            }

            if (reportedPartyId) {
                try {
                    const userDoc = await db.collection('users').doc(reportedPartyId).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        reportedPartyName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'User';
                        console.log(`[AdminController] Report ${reportId}: Found reported party: ${reportedPartyName}`);
                    } else {
                         console.warn(`[AdminController] Report ${reportId}: Reported party user document ${reportedPartyId} not found.`);
                    }
                } catch (userError) {
                    console.error(`[AdminController] Report ${reportId}: Error fetching reported party ${reportedPartyId}:`, userError.message);
                }
            } else {
                 console.warn(`[AdminController] Report ${reportId}: Could not determine reported party ID.`);
            }

            const enrichedReport = {
                id: reportId,
                ...report,
                reportedAt: convertTimestamp(report.reportedAt),
                resolvedAt: convertTimestamp(report.resolvedAt),
                reporterEmail,
                vehicleMake,
                vehicleModel,
                reportedPartyName,
                reportedPartyId, // Include ID for frontend logic
                reporterId: report.reporterId, // Ensure reporterId is passed
                subject: report.reason,
                reason: report.details,
                status: report.status || 'unknown'
            };
            console.log(`[AdminController] Report ${reportId}: Enriched Data Sent to Frontend:`, JSON.stringify(enrichedReport));
            return enrichedReport;
        });

        const reports = await Promise.all(reportPromises);
        res.status(200).json(reports);
    } catch (error) {
        console.error('[AdminController] Error fetching booking reports:', error);
        res.status(500).json({ message: 'Server error fetching reports.' });
    }
};

/**
 * Marks a specific booking report as resolved.
 */
const resolveBookingReport = async (req, res) => {
    try {
        const { reportId } = req.params;
        const adminUserId = req.customUser.uid;
        console.log(`[AdminController] Admin ${adminUserId} attempting to resolve report ${reportId}...`);

        const reportRef = db.collection('reports').doc(reportId);
        const reportDoc = await reportRef.get();

        if (!reportDoc.exists) {
             console.warn(`[AdminController] Resolve failed: Report ${reportId} not found.`);
             return res.status(404).json({ message: 'Report not found.' });
        }

        if(reportDoc.data().status === 'resolved') {
             console.log(`[AdminController] Report ${reportId} is already resolved.`);
             return res.status(200).json({ message: 'Report is already resolved.' });
        }

        await reportRef.update({
            status: 'resolved',
            resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
            resolvedBy: adminUserId
        });

        console.log(`[AdminController] Report ${reportId} marked as resolved by admin ${adminUserId}.`);
        res.status(200).json({ message: 'Report marked as resolved.' });

    } catch (error) {
        console.error(`[AdminController] Error resolving report ${reportId}:`, error);
        res.status(500).json({ message: 'Server error resolving report.' });
    }
};

/**
 * Finds an existing 1-on-1 chat between the admin and a target user,
 * or creates a new one if it doesn't exist.
 */
const findOrCreateAdminUserChat = async (req, res) => {
    try {
        const adminUserId = req.customUser.uid; // ID of the logged-in admin
        const { targetUserId } = req.body; // ID of the user the admin wants to chat with

        if (!targetUserId) {
            console.warn(`[AdminController] findOrCreateAdminUserChat failed: Missing targetUserId.`);
            return res.status(400).json({ message: 'Target User ID is required.' });
        }
        if (adminUserId === targetUserId) {
             console.warn(`[AdminController] findOrCreateAdminUserChat failed: Admin ${adminUserId} tried to chat with self.`);
             return res.status(400).json({ message: 'Cannot initiate chat with yourself.' });
        }

        console.log(`[AdminController] Admin ${adminUserId} finding/creating chat with user ${targetUserId}`);

        const chatId = generateChatId(adminUserId, targetUserId); // Generate predictable ID

        const chatRef = db.collection('chats').doc(chatId);
        const chatDoc = await chatRef.get();

        if (chatDoc.exists) {
            // Chat already exists
            console.log(`[AdminController] Found existing admin-user chat: ${chatId}`);
            return res.status(200).json({ chatId: chatDoc.id });
        } else {
            // Chat doesn't exist, create it
            console.log(`[AdminController] Creating new admin-user chat: ${chatId}`);
            // Fetch names for initial context (optional but nice)
            let adminName = 'Admin';
            let targetName = 'User';
            try {
                const [adminDoc, targetDoc] = await Promise.all([
                    db.collection('users').doc(adminUserId).get(),
                    db.collection('users').doc(targetUserId).get()
                ]);
                if (adminDoc.exists) adminName = adminDoc.data().firstName || 'Admin';
                if (targetDoc.exists) targetName = `${targetDoc.data().firstName || ''} ${targetDoc.data().lastName || ''}`.trim() || 'User';
            } catch (nameError){
                 console.warn(`[AdminController] Could not fetch names for new chat ${chatId}:`, nameError.message);
            }

            const newChatData = {
                participants: [adminUserId, targetUserId],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                type: 'admin_direct', // Differentiate from booking chats
                lastMessage: {
                    text: `${adminName} started a conversation with ${targetName}.`,
                    senderId: 'system', // Or adminUserId
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    readBy: [adminUserId],
                }
            };
            await chatRef.set(newChatData);
            console.log(`[AdminController] Created new admin-user chat: ${chatId}`);
            return res.status(201).json({ chatId: chatRef.id }); // Return the ID of the new chat
        }

    } catch (error) {
        console.error(`[AdminController] Error finding or creating admin-user chat:`, error);
        res.status(500).json({ message: 'Server error while finding or creating chat.' });
    }
};


module.exports = {
  getDriveApplications,
  approveDriveApplication,
  declineDriveApplication,
  getBookingReports,
  resolveBookingReport,
  findOrCreateAdminUserChat,
  getAllHostMonthlyStatements,
  getAllPlatformFees,
  verifyPlatformFee,
};