const { admin, db } = require('../utils/firebase');
const { DateTime } = require('luxon');
const { createNotification } = require('../utils/notificationHelper');

// --- HELPERS ---

const convertTimestamp = (timestamp) => {
    if (timestamp && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toISOString();
    }
    if (typeof timestamp !== 'object' || timestamp === null) {
        return timestamp;
    }
    if (timestamp._seconds !== undefined && timestamp._nanoseconds !== undefined) {
         try {
             const jsDate = new Date(timestamp._seconds * 1000 + timestamp._nanoseconds / 1000000);
             return jsDate.toISOString();
         } catch(e) { return timestamp; }
    }
    return timestamp;
}

const generateChatId = (userId1, userId2) => {
    return [userId1, userId2].sort().join('_');
};

// ==================================================================
// 1. HOST APPLICATION MANAGEMENT
// ==================================================================

const HOST_APP_COLLECTION = 'hostApplications';

const approveHostApplication = async (req, res) => {
  try {
    const { applicationId, userId } = req.body;

    if (!applicationId || !userId) {
      return res.status(400).json({ message: 'Missing applicationId or userId' });
    }

    console.log(`[AdminController] Attempting approve for App ID: ${applicationId}`);

    // 1. Get Reference
    const appRef = db.collection(HOST_APP_COLLECTION).doc(applicationId);

    // 2. SAFETY CHECK: Does it exist?
    const appDoc = await appRef.get();
    if (!appDoc.exists) {
        console.error(`[AdminController] Error: Document ${applicationId} not found in collection '${HOST_APP_COLLECTION}'.`);
        console.error(`[AdminController] TIP: Check your Firestore Database. Is the collection named 'host_applications' or 'hostApplications'?`);
        return res.status(404).json({ message: 'Application document not found.' });
    }

    // 3. Update Status
    await appRef.update({
      status: 'approved',
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: req.customUser.uid
    });

    // 4. Upgrade User Role
    await db.collection('users').doc(userId).update({
      role: 'owner',
      isHostApproved: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 5. Notify
    try {
        await createNotification(
            userId,
            "Congratulations! Your host application has been approved. You can now list your vehicles.",
            "/dashboard/owner/vehicles"
        );
    } catch (notifError) {
        console.warn('[AdminController] Notification failed:', notifError.message);
    }

    res.status(200).json({ message: 'Host application approved successfully.' });

  } catch (error) {
    console.error('[AdminController] CRITICAL ERROR approving host application:', error);
    res.status(500).json({ message: 'Server error approving application.', error: error.message });
  }
};

const declineHostApplication = async (req, res) => {
  try {
    const { applicationId } = req.body;

    if (!applicationId) {
        return res.status(400).json({ message: 'Missing applicationId' });
    }

    console.log(`[AdminController] Attempting decline for App ID: ${applicationId}`);

    const appRef = db.collection(HOST_APP_COLLECTION).doc(applicationId);
    const appDoc = await appRef.get();

    if (!appDoc.exists) {
        return res.status(404).json({ message: 'Application document not found.' });
    }

    const userId = appDoc.data().userId;

    await appRef.update({
      status: 'declined',
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: req.customUser.uid
    });

    if (userId) {
        try {
            await createNotification(
                userId,
                "Your host application was declined. Please ensure you meet all requirements and try again.",
                "/dashboard/profile"
            );
        } catch (notifError) {
            console.warn('Notification failed');
        }
    }

    res.status(200).json({ message: 'Host application declined.' });

  } catch (error) {
    console.error('[AdminController] Error declining host application:', error);
    res.status(500).json({ message: 'Server error declining application.' });
  }
};

// ==================================================================
// 2. FINANCIAL FUNCTIONALITY
// ==================================================================

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

        const ownerId = feeDoc.data().ownerId;
        if (ownerId) {
             await createNotification(
                ownerId,
                `Your platform fee payment has been verified by the admin. Thank you!`,
                `/dashboard/owner/billing`
            );
        }

        console.log(`[AdminController] Admin ${adminUserId} verified platform fee ${feeId}.`);
        res.status(200).json({ message: 'Fee verified successfully.', status: 'verified' });

    } catch (error) {
        console.error(`[AdminController] Error verifying fee ${feeId}:`, error);
        res.status(500).json({ message: 'Failed to verify payment.' });
    }
};

const getAllPlatformFees = async (req, res) => {
    try {
        console.log("[AdminController] Fetching all reported platform fee records...");
        const feesSnapshot = await db.collection('platform_fees')
            .orderBy('createdAt', 'desc')
            .get();

        const fees = await Promise.all(feesSnapshot.docs.map(async (doc) => {
            const feeData = { id: doc.id, ...doc.data() };
            const hostId = feeData.ownerId || feeData.hostId;

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

const getAllHostMonthlyStatements = async (req, res) => {
    try {
        console.log("[AdminController] Fetching all host monthly statements...");
        const statementsSnapshot = await db.collection('hostMonthlyStatements')
            .orderBy('year', 'desc')
            .orderBy('monthIndex', 'desc')
            .get();

        if (statementsSnapshot.empty) {
            return res.status(200).json([]);
        }

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

                return {
                    id: statementData.id,
                    hostName: hostName,
                    hostEmail: hostEmail,
                    ownerId: hostId,
                    month: statementData.monthName || statementData.month,
                    year: statementData.year,
                    amount: statementData.balanceDue || statementData.totalFeeOwed,
                    referenceNumber: statementData.referenceNumber || 'N/A - Statement',
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

// ==================================================================
// 3. DRIVE APPLICATIONS
// ==================================================================

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

const approveDriveApplication = async (req, res) => {
    const { applicationId, userId } = req.body;
    if (!applicationId || !userId) {
        return res.status(400).json({ message: 'Application ID and User ID are required.' });
    }
    try {
        const appRef = db.collection('driveApplications').doc(applicationId);
        const userRef = db.collection('users').doc(userId);

        const appDoc = await appRef.get();
        if (!appDoc.exists || appDoc.data().userId !== userId) {
             return res.status(404).json({ message: 'Drive application not found or does not belong to the specified user.' });
        }

        await db.runTransaction(async (transaction) => {
            transaction.update(appRef, { status: 'approved', reviewedAt: admin.firestore.FieldValue.serverTimestamp() });
            transaction.update(userRef, { isApprovedToDrive: true });
        });

        await createNotification(userId, "Your driver application has been approved! You can now rent vehicles.", "/dashboard/profile");

        console.log(`Admin ${req.customUser.uid} approved drive application ${applicationId} for user ${userId}.`);
        res.status(200).json({ message: 'Application approved successfully.' });
    } catch (error) {
        console.error(`Error approving application ${applicationId}:`, error);
        res.status(500).json({ message: 'Failed to approve application.' });
    }
};

const declineDriveApplication = async (req, res) => {
    const { applicationId, userId } = req.body;
     if (!applicationId || !userId) {
        return res.status(400).json({ message: 'Application ID and User ID are required.' });
    }
    try {
         const appRef = db.collection('driveApplications').doc(applicationId);
         const appDoc = await appRef.get();
         if (!appDoc.exists || appDoc.data().userId !== userId) {
             return res.status(404).json({ message: 'Drive application not found or does not belong to the specified user.' });
        }

        await appRef.update({ status: 'declined', reviewedAt: admin.firestore.FieldValue.serverTimestamp() });

        await createNotification(userId, "Your driver application has been declined.", "/dashboard/profile");

        console.log(`Admin ${req.customUser.uid} declined drive application ${applicationId} for user ${userId}.`);
        res.status(200).json({ message: 'Application declined successfully.' });
    } catch (error) {
         console.error(`Error declining application ${applicationId}:`, error);
        res.status(500).json({ message: 'Failed to decline application.' });
    }
};

// ==================================================================
// 4. REPORTS
// ==================================================================

const getBookingReports = async (req, res) => {
    try {
        console.log("[AdminController] Fetching booking reports...");
        const reportsRef = db.collection('reports').orderBy('reportedAt', 'desc');
        const snapshot = await reportsRef.get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }

        const reportPromises = snapshot.docs.map(async (doc) => {
            const reportId = doc.id;
            const report = doc.data();

            let reporterEmail = 'N/A';
            let vehicleMake = 'Unknown';
            let vehicleModel = 'Vehicle';
            let reportedPartyName = 'N/A';
            let reportedPartyId = null;

            if (report.reporterId) {
                try {
                    const userDoc = await db.collection('users').doc(report.reporterId).get();
                    if (userDoc.exists) reporterEmail = userDoc.data().email || 'N/A';
                } catch (userError) {}
            }

            if (report.vehicleId) {
                 try {
                    const vehicleDoc = await db.collection('vehicles').doc(report.vehicleId).get();
                     if (vehicleDoc.exists) {
                        vehicleMake = vehicleDoc.data().make || 'Unknown';
                        vehicleModel = vehicleDoc.data().model || 'Vehicle';
                    }
                 } catch (vehicleError) {}
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
                    }
                } catch (userError) {}
            }

            return {
                id: reportId,
                ...report,
                reportedAt: convertTimestamp(report.reportedAt),
                resolvedAt: convertTimestamp(report.resolvedAt),
                reporterEmail,
                vehicleMake,
                vehicleModel,
                reportedPartyName,
                reportedPartyId,
                reporterId: report.reporterId,
                subject: report.reason,
                reason: report.details,
                status: report.status || 'unknown'
            };
        });

        const reports = await Promise.all(reportPromises);
        res.status(200).json(reports);
    } catch (error) {
        console.error('[AdminController] Error fetching booking reports:', error);
        res.status(500).json({ message: 'Server error fetching reports.' });
    }
};

const resolveBookingReport = async (req, res) => {
    try {
        const { reportId } = req.params;
        const adminUserId = req.customUser.uid;

        const reportRef = db.collection('reports').doc(reportId);
        const reportDoc = await reportRef.get();

        if (!reportDoc.exists) {
             return res.status(404).json({ message: 'Report not found.' });
        }

        if(reportDoc.data().status === 'resolved') {
             return res.status(200).json({ message: 'Report is already resolved.' });
        }

        await reportRef.update({
            status: 'resolved',
            resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
            resolvedBy: adminUserId
        });

        const reporterId = reportDoc.data().reporterId;
        if(reporterId) {
             await createNotification(reporterId, "Your issue report has been resolved by the admin.", "/dashboard");
        }

        res.status(200).json({ message: 'Report marked as resolved.' });

    } catch (error) {
        console.error(`[AdminController] Error resolving report ${reportId}:`, error);
        res.status(500).json({ message: 'Server error resolving report.' });
    }
};

// ==================================================================
// 5. CHATS
// ==================================================================

const findOrCreateAdminUserChat = async (req, res) => {
    try {
        const adminUserId = req.customUser.uid;
        const { targetUserId } = req.body;

        if (!targetUserId) {
            return res.status(400).json({ message: 'Target User ID is required.' });
        }
        if (adminUserId === targetUserId) {
             return res.status(400).json({ message: 'Cannot initiate chat with yourself.' });
        }

        const chatId = generateChatId(adminUserId, targetUserId);
        const chatRef = db.collection('chats').doc(chatId);
        const chatDoc = await chatRef.get();

        if (chatDoc.exists) {
            return res.status(200).json({ chatId: chatDoc.id });
        } else {
            let adminName = 'Admin';
            let targetName = 'User';
            try {
                const [adminDoc, targetDoc] = await Promise.all([
                    db.collection('users').doc(adminUserId).get(),
                    db.collection('users').doc(targetUserId).get()
                ]);
                if (adminDoc.exists) adminName = adminDoc.data().firstName || 'Admin';
                if (targetDoc.exists) targetName = `${targetDoc.data().firstName || ''} ${targetDoc.data().lastName || ''}`.trim() || 'User';
            } catch (nameError){}

            const newChatData = {
                participants: [adminUserId, targetUserId],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                type: 'admin_direct',
                lastMessage: {
                    text: `${adminName} started a conversation with ${targetName}.`,
                    senderId: 'system',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    readBy: [adminUserId],
                }
            };
            await chatRef.set(newChatData);
            return res.status(201).json({ chatId: chatRef.id });
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
  approveHostApplication,
  declineHostApplication
};