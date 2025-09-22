const { admin, db } = require('../utils/firebase');

/**
 * Fetches all pending drive applications and enriches them with user details.
 */
const getDriveApplications = async (req, res) => {
  try {
    const applicationsSnapshot = await db.collection('driveApplications').where('status', '==', 'pending').get();

    if (applicationsSnapshot.empty) {
      return res.status(200).json([]);
    }

    // Use Promise.all to efficiently fetch user data for all applications
    const enrichedApplications = await Promise.all(
      applicationsSnapshot.docs.map(async (doc) => {
        const appData = { id: doc.id, ...doc.data() };
        
        // Fetch the corresponding user document
        const userDoc = await db.collection('users').doc(appData.userId).get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          // Add user details to the application object
          return {
            ...appData,
            userName: userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
            userEmail: userData.email,
            userRole: userData.role || 'renter',
          };
        }
        
        // Fallback if user is not found
        return {
          ...appData,
          userName: 'Unknown User',
          userEmail: 'N/A',
          userRole: 'N/A',
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

        await db.runTransaction(async (transaction) => {
            transaction.update(appRef, { status: 'approved' });
            transaction.update(userRef, { isApprovedToDrive: true });
        });
        
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
    const { applicationId } = req.body;
     if (!applicationId) {
        return res.status(400).json({ message: 'Application ID is required.' });
    }
    try {
        await db.collection('driveApplications').doc(applicationId).update({ status: 'declined' });
        res.status(200).json({ message: 'Application declined successfully.' });
    } catch (error) {
         console.error(`Error declining application ${applicationId}:`, error);
        res.status(500).json({ message: 'Failed to decline application.' });
    }
};


module.exports = {
  getDriveApplications,
  approveDriveApplication,
  declineDriveApplication,
};

