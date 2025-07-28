   // backend/src/__tests__/bookingController.test.js

   // --- Mock Firestore and its chained methods ---
   const mockAdd = jest.fn();
   const mockUpdate = jest.fn();
   const mockDelete = jest.fn();

   // Mock functions for doc and collection .get()
   const mockDocGet = jest.fn(); // For db.collection('X').doc('Y').get()
   const mockCollectionGet = jest.fn(); // For db.collection('X').where(...).get() or db.collection('X').get()

   // Mock for a document reference (e.g., db.collection().doc('id'))
   const mockDocRef = {
     get: mockDocGet, // .get() on a doc ref uses this specific mock
     update: mockUpdate, // .update() on a doc ref uses this mock
     delete: mockDelete, // .delete() on a doc ref uses this mock
   };

   // Mock for a collection query (e.g., db.collection('name').where().orderBy())
   const mockQueryRef = {
     get: mockCollectionGet, // .get() on a query ref uses this specific mock
     where: jest.fn().mockReturnThis(), // .where() on a query ref returns itself for chaining
     orderBy: jest.fn().mockReturnThis(), // .orderBy() on a query ref returns itself for chaining
   };

   // Mock for a collection reference (e.g., db.collection('name'))
   const mockCollectionRef = {
     doc: jest.fn(() => mockDocRef), // .doc('id') on a collection ref returns a mock doc ref
     where: jest.fn(() => mockQueryRef), // .where() on a collection ref returns a mock query ref
     orderBy: jest.fn(() => mockQueryRef), // .orderBy() on a collection ref returns a mock query ref
     get: mockCollectionGet, // Direct .get() on a collection ref uses this specific mock (less common but handled)
     add: mockAdd, // .add() on a collection ref uses this mock
   };

   // The main Firestore mock object (db)
   const mockFirestore = {
     collection: jest.fn(() => mockCollectionRef), // db.collection('name') returns a mock collection ref
     doc: jest.fn(() => mockDocRef), // db.doc('path/to/doc') (less common, but good to have)
   };

   const mockFirebaseAdmin = {
     firestore: () => mockFirestore, // Ensure firestore() returns the mockFirestore instance
     firestore: { // This structure is necessary because firebase uses firestore.FieldValue
       FieldValue: {
         serverTimestamp: jest.fn(() => ({ // Mocking serverTimestamp for consistent date values in tests
           toDate: () => new Date('2025-06-22T10:00:00Z'), // Consistent mock date
           toMillis: () => new Date('2025-06-22T10:00:00Z').getTime()
         })),
       },
     },
   };

   // Mock axios for Paymongo calls
   const mockAxios = {
     post: jest.fn(),
   };

   // Mock luxon for date handling - make sure it returns consistent and comparable objects
   const mockDateTime = {
     // Helper to create a consistent mock DateTime instance
     _createMockDateTimeInstance: (date) => {
       const dt = date instanceof Date ? date : new Date(date);
       return {
         isValid: !isNaN(dt.getTime()),
         toISODate: () => dt.toISOString().split('T')[0],
         valueOf: () => dt.getTime(),
         startOf: jest.fn(() => ({ valueOf: () => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() })),
         diff: jest.fn((otherDt, unit) => {
           const otherDateVal = typeof otherDt === 'object' && otherDt !== null && typeof otherDt.valueOf === 'function'
               ? otherDt.valueOf()
               : (otherDt && typeof otherDt.toDate === 'function' ? otherDt.toDate().getTime() : new Date(otherDt).getTime()); // Added to handle Firestore Timestamps
           const diffMs = dt.getTime() - otherDateVal;
           if (unit === 'days') {
             return { days: diffMs / (1000 * 60 * 60 * 24) };
           }
           if (unit === 'hours') {
               return { hours: diffMs / (1000 * 60 * 60) };
           }
           return { hours: 0 };
         }),
         plus: jest.fn((duration) => {
           const newDt = new Date(dt.getTime());
           if (duration.days) newDt.setDate(newDt.getDate() + duration.days);
           if (duration.hours) newDt.setHours(newDt.getHours() + duration.hours);
           // Important: return a new mock instance with the plus-ed date
           return mockDateTime._createMockDateTimeInstance(newDt);
         }),
       };
     },

     fromISO: jest.fn((dateString) => {
       // Attempt to parse with T12:00:00Z for consistency, or just the date string if that's what Luxon would do
       const dateToParse = dateString.includes('T') ? dateString : dateString + 'T12:00:00Z';
       return mockDateTime._createMockDateTimeInstance(dateToParse);
     }),
     now: jest.fn(() => {
       const now = new Date('2025-06-22T10:00:00Z'); // Consistent mock "now"
       return mockDateTime._createMockDateTimeInstance(now);
     }),
   };

   // Helper function to create a mock user document snapshot
   const createMockUserDoc = (user) => ({
       exists: true,
       data: () => ({
           uid: user.uid,
           email: user.email,
           displayName: user.displayName,
           role: user.role,
       }),
   });


   // Explicitly mock the modules that your application code imports
   jest.mock('../utils/firebase', () => ({
     db: mockFirestore,
     admin: mockFirebaseAdmin,
     storage: { // Mock storage as well, though not used in these specific tests
       bucket: jest.fn().mockReturnThis(),
       file: jest.fn().mockReturnThis(),
       createWriteStream: jest.fn(() => ({
         on: jest.fn((event, callback) => {
           if (event === 'finish') callback();
         }),
         end: jest.fn(),
       })),
     },
   }));
   jest.mock('axios', () => ({
     post: mockAxios.post,
   }));
   jest.mock('luxon', () => ({
     DateTime: mockDateTime, // Use the mockDateTime object as DateTime
   }));

   // Set environment variables before requiring the controller
   process.env.PAYMONGO_SECRET_KEY = 'sk_test_mockkey_for_tests';
   process.env.FRONTEND_URL = 'http://localhost:3000_for_tests';

   // Import the controller AFTER mocks and env vars are set up
   const {
     checkVehicleAvailability,
     createBooking,
     getUserBookings,
     getBookingById,
     cancelBooking,
     getOwnerVehicleBookings,
   } = require('../controllers/bookingController');

   // Helper to create mock Express req and res objects
   const mockRequest = (params = {}, query = {}, body = {}, customUser = {}) => ({
     params,
     query,
     body,
     customUser, // Ensure customUser is present
     headers: {
       authorization: 'Bearer mock_token', // Needed for authMiddleware tests if used here
     },
   });

   const mockResponse = () => {
     const res = {};
     res.status = jest.fn().mockReturnValue(res);
     res.json = jest.fn().mockReturnValue(res);
     res.send = jest.fn().mockReturnValue(res);
     return res;
   };

   describe('Booking Controller', () => {
     beforeEach(() => {
       // Reset all mocks on each test
       jest.clearAllMocks();

       // Reset mocks for each individual function call or sub-mock that needs it
       mockAdd.mockReset();
       mockUpdate.mockReset();
       mockDelete.mockReset();
       mockDocGet.mockReset();
       mockCollectionGet.mockReset();

       // Re-establish chaining behavior for collection and doc references
       mockFirestore.collection.mockClear().mockImplementation(() => mockCollectionRef);
       mockCollectionRef.doc.mockClear().mockImplementation(() => mockDocRef);
       mockCollectionRef.where.mockClear().mockImplementation(() => mockQueryRef);
       mockCollectionRef.orderBy.mockClear().mockImplementation(() => mockQueryRef);
       mockQueryRef.where.mockClear().mockReturnThis(); // For when .where() is chained after another .where()
       mockQueryRef.orderBy.mockClear().mockReturnThis(); // For when .orderBy() is chained after .where()
       mockFirestore.doc.mockClear().mockImplementation(() => mockDocRef); // For direct db.doc()

       mockAxios.post.mockReset();

       // The `mockDateTime` itself is reset by `jest.clearAllMocks()`
       // but its internal `_createMockDateTimeInstance` ensures consistent behavior.
     });

     describe('checkVehicleAvailability', () => {
       it('should return 400 if vehicleId, startDate, or endDate are missing', async () => {
         const req = mockRequest({ vehicleId: 'someId' }, { startDate: '2025-01-01' });
         const res = mockResponse();
         await checkVehicleAvailability(req, res);
         expect(res.status).toHaveBeenCalledWith(400);
         expect(res.json).toHaveBeenCalledWith({ message: 'Vehicle ID, startDate, and endDate are required.' });
       });

       it('should return 400 if date range is invalid (endDate before startDate)', async () => {
           const req = mockRequest(
               { vehicleId: 'testVehicle123' },
               { startDate: '2025-07-05', endDate: '2025-07-01' }
           );
           const res = mockResponse();

           // Ensure now is before the test dates for proper validation flow
           mockDateTime.now.mockImplementationOnce(() => mockDateTime._createMockDateTimeInstance('2025-06-30T10:00:00Z'));

           await checkVehicleAvailability(req, res);
           expect(res.status).toHaveBeenCalledWith(400);
           // Updated message to match controller's potential new message
           expect(res.json).toHaveBeenCalledWith({ message: 'Invalid date range provided (end date before start date).' });
       });

       it('should return 400 if start date is in the past', async () => {
         // Mock DateTime.now to be AFTER the test's startDate
         mockDateTime.now.mockReturnValueOnce(mockDateTime._createMockDateTimeInstance('2025-01-02T10:00:00Z')); // Today is Jan 2
         const req = mockRequest(
           { vehicleId: 'testVehicle123' },
           { startDate: '2025-01-01', endDate: '2025-01-03' }
         );
         const res = mockResponse();
         await checkVehicleAvailability(req, res);
         expect(res.status).toHaveBeenCalledWith(400);
         expect(res.json).toHaveBeenCalledWith({ message: 'Start date cannot be in the past.' });
       });

       it('should return 404 if vehicle not found', async () => {
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: false }); // db.collection('vehicles').doc(vehicleId).get()

         const req = mockRequest(
           { vehicleId: 'nonExistentVehicle' },
           { startDate: '2025-07-01', endDate: '2025-07-05' }
         );
         const res = mockResponse();

         await checkVehicleAvailability(req, res);

         // These assertions should now pass because initial date validation should not fail here.
         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles');
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('nonExistentVehicle');
         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 get for vehicle
         expect(res.status).toHaveBeenCalledWith(404);
         expect(res.json).toHaveBeenCalledWith({ message: 'Vehicle not found.' });
       });

       it('should return isAvailable: true if no overlapping bookings', async () => {
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ rentalPricePerDay: 100 }) }); // db.collection('vehicles').doc(vehicleId).get()
         mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] }); // db.collection('bookings').where(...).get()

         const req = mockRequest(
           { vehicleId: 'testVehicle123' },
           { startDate: '2025-07-01', endDate: '2025-07-05' }
         );
         const res = mockResponse();

         await checkVehicleAvailability(req, res);

         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles'); // For the vehicle doc
         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings'); // For the bookings query
         expect(mockCollectionRef.where).toHaveBeenCalledWith('vehicleId', '==', 'testVehicle123'); // First where on collectionRef
         expect(mockQueryRef.where).toHaveBeenCalledWith('status', 'in', ['pending', 'confirmed', 'paid']); // Chained where on queryRef
         expect(mockQueryRef.where).toHaveBeenCalledWith('endDate', '>=', '2025-07-01'); // Chained where on queryRef
         expect(mockQueryRef.where).toHaveBeenCalledWith('startDate', '<=', '2025-07-05'); // Chained where on queryRef
         expect(mockCollectionGet).toHaveBeenCalledTimes(1); // This is the get call for bookings query
         expect(res.status).toHaveBeenCalledWith(200);
         expect(res.json).toHaveBeenCalledWith({
           vehicleId: 'testVehicle123',
           startDate: '2025-07-01',
           endDate: '2025-07-05',
           isAvailable: true,
           message: 'Vehicle is available for the selected dates.',
         });
       });

       it('should return isAvailable: false if overlapping bookings exist', async () => {
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ rentalPricePerDay: 100 }) }); // db.collection('vehicles').doc(vehicleId).get()
         mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: [{ id: 'booking1' }] }); // db.collection('bookings').where(...).get()

         const req = mockRequest(
           { vehicleId: 'testVehicle123' },
           { startDate: '2025-07-01', endDate: '2025-07-05' }
         );
         const res = mockResponse();

         await checkVehicleAvailability(req, res);

         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles');
         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings');
         expect(res.status).toHaveBeenCalledWith(200);
         expect(res.json).toHaveBeenCalledWith({
           vehicleId: 'testVehicle123',
           startDate: '2025-07-01',
           endDate: '2025-07-05',
           isAvailable: false,
           message: 'Vehicle is not available for the selected dates due to existing bookings.',
         });
       });

       it('should handle server errors gracefully', async () => {
         // Mocks for this test only:
         mockDocGet.mockRejectedValueOnce(new Error('Firestore read error')); // Simulate error on vehicleDoc.get()

         const req = mockRequest(
           { vehicleId: 'testVehicle123' },
           { startDate: '2025-07-01', endDate: '2025-07-05' }
         );
         const res = mockResponse();

         await checkVehicleAvailability(req, res);

         expect(res.status).toHaveBeenCalledWith(500); // Now expecting 500
         expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
           message: 'Server error checking vehicle availability.',
         }));
       });
     });

     describe('createBooking', () => {
       it('should return 400 if required fields are missing', async () => {
         const req = mockRequest({}, {}, {}); // Missing all fields
         const res = mockResponse();
         await createBooking(req, res);
         expect(res.status).toHaveBeenCalledWith(400);
         expect(res.json).toHaveBeenCalledWith({ message: 'Vehicle ID, start date, end date, and payment method type are required.' });
       });

       it('should return 400 if date range is invalid (endDate before startDate)', async () => {
           const req = mockRequest(
               {},
               {},
               { vehicleId: 'v1', startDate: '2025-01-05', endDate: '2025-01-01', paymentMethodType: 'card' },
               { uid: 'u1' }
           );
           const res = mockResponse();
           mockDateTime.now.mockImplementationOnce(() => mockDateTime._createMockDateTimeInstance('2025-06-30T10:00:00Z')); // Ensure now is before test dates
           await createBooking(req, res);
           expect(res.status).toHaveBeenCalledWith(400);
           // Updated message to match controller's potential new message
           expect(res.json).toHaveBeenCalledWith({ message: 'Invalid date range provided (end date before start date).' });
       });

       it('should return 400 if start date is in the past', async () => {
           // Mock DateTime.now to be AFTER the test's startDate
           mockDateTime.now.mockReturnValueOnce(mockDateTime._createMockDateTimeInstance('2025-01-02T10:00:00Z')); // Today is Jan 2
           const req = mockRequest(
               {},
               {},
               { vehicleId: 'v1', startDate: '2025-01-01', endDate: '2025-01-03', paymentMethodType: 'card' },
               { uid: 'u1' }
           );
           const res = mockResponse();
           await createBooking(req, res);
           expect(res.status).toHaveBeenCalledWith(400);
           expect(res.json).toHaveBeenCalledWith({ message: 'Start date cannot be in the past.' });
       });

       it('should return 404 if vehicle not found', async () => {
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: false }); // For db.collection('vehicles').doc(vehicleId).get()

         const req = mockRequest(
           {},
           {},
           { vehicleId: 'nonExistent', startDate: '2025-07-01', endDate: '2025-07-05', paymentMethodType: 'card' },
           { uid: 'testUser123' } // customUser is pre-populated, no users collection call expected
         );
         const res = mockResponse();

         await createBooking(req, res);

         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles'); // For the vehicle check
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('nonExistent');
         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for vehicle
         expect(res.status).toHaveBeenCalledWith(404);
         expect(res.json).toHaveBeenCalledWith({ message: 'Vehicle not found.' });
       });

       it('should return 400 if vehicle has no rental rate', async () => {
           // Mocks for this test only:
           mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ make: 'Car', model: 'Model' }) }); // For db.collection('vehicles').doc(vehicleId).get()

           const req = mockRequest(
               {},
               {},
               { vehicleId: 'noRateVehicle', startDate: '2025-07-01', endDate: '2025-07-05', paymentMethodType: 'card' },
               { uid: 'testUser123' } // customUser is pre-populated
           );
           const res = mockResponse();

           await createBooking(req, res);

           expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles'); // For vehicle check
           expect(mockCollectionRef.doc).toHaveBeenCalledWith('noRateVehicle');
           expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for vehicle
           expect(res.status).toHaveBeenCalledWith(400);
           expect(res.json).toHaveBeenCalledWith({ message: 'Vehicle must have a positive daily rental rate defined.' });
       });

       it('should return 409 if vehicle is no longer available (overlapping booking found)', async () => {
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ rentalPricePerDay: 50, make: 'MockMake', model: 'MockModel' }) }); // For db.collection('vehicles').doc(vehicleId).get()
         mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: [{ id: 'booking1' }] }); // For db.collection('bookings').where(...).get()

         const req = mockRequest(
           {},
           {},
           { vehicleId: 'occupiedVehicle', startDate: '2025-07-01', endDate: '2025-07-05', paymentMethodType: 'card' },
           { uid: 'testUser123' } // customUser is pre-populated
         );
         const res = mockResponse();

         await createBooking(req, res);

         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles'); // First collection call for vehicle details
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('occupiedVehicle');
         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for vehicle
         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings'); // Second collection call for availability check
         expect(mockCollectionRef.where).toHaveBeenCalledWith('vehicleId', '==', 'occupiedVehicle');
         expect(mockQueryRef.get).toHaveBeenCalledTimes(1); // For bookings query
         expect(res.status).toHaveBeenCalledWith(409);
         expect(res.json).toHaveBeenCalledWith({ message: 'Vehicle is no longer available for the selected dates.' });
       });

       it('should successfully create a booking and return Paymongo redirect URL', async () => {
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ // For db.collection('vehicles').doc(vehicleId).get()
             exists: true,
             data: () => ({ rentalPricePerDay: 50, ownerId: 'owner1', make: 'MockMake', model: 'MockModel' })
           });
         mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] }); // For db.collection('bookings').where(...).get()

         // Mock Paymongo API call success
         mockAxios.post.mockResolvedValueOnce({
           data: {
             data: {
               id: 'cs_mockSessionId',
               attributes: {
                 checkout_url: 'https://paymongo.com/checkout/mock',
               },
             },
           },
         });
         // Mock Firestore add for the new booking document
         mockAdd.mockResolvedValue({ id: 'mockBookingId' });


         const req = mockRequest(
           {},
           {},
           { vehicleId: 'newBookingVehicle', startDate: '2025-07-01', endDate: '2025-07-03', paymentMethodType: 'card' },
           { uid: 'testUser123', email: 'test@example.com', displayName: 'Test User' } // customUser is pre-populated
         );
         const res = mockResponse();

         await createBooking(req, res);

         const expectedAttributes = {
           billing: {
             email: 'test@example.com',
             name: 'Test User',
             phone: 'N/A', // Make sure this matches your controller's logic exactly
           },
           send_email_receipt: true,
           show_description: true,
           show_total_amount: true,
           description: `Rental for MockMake MockModel (2025-07-01 to 2025-07-03)`,
           line_items: [
             {
               name: 'Rental: MockMake MockModel',
               quantity: 1,
               amount: 15000,
               currency: 'PHP',
             },
           ],
           payment_method_types: ['card'],
           success_url: `${process.env.FRONTEND_URL}/success?bookingId={CHECKOUT_SESSION_ID}`,
           cancel_url: `${process.env.FRONTEND_URL}/cancel?bookingId={CHECKOUT_SESSION_ID}`,
         };

         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles'); // First call for vehicle details
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('newBookingVehicle');
         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for vehicle
         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings'); // Second call for availability check / booking creation
         expect(mockCollectionRef.where).toHaveBeenCalledWith('vehicleId', '==', 'newBookingVehicle');
         expect(mockQueryRef.get).toHaveBeenCalledTimes(1); // For bookings query
         expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ // Check mockAdd directly
           userId: 'testUser123',
           vehicleId: 'newBookingVehicle',
           startDate: '2025-07-01',
           endDate: '2025-07-03',
           totalCost: 150, // 50/day * 3 days
           paymentMethodType: 'card',
           paymongoCheckoutSessionId: 'cs_mockSessionId',
           status: 'pending',
         }));
         expect(mockAxios.post).toHaveBeenCalledWith(
           'https://api.paymongo.com/v1/checkout_sessions',
           {
             data: {
               attributes: expectedAttributes,
             },
           },
           expect.anything() // Keep this for headers
         );
         expect(res.status).toHaveBeenCalledWith(201);
         expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
           message: 'Booking initiated successfully! Redirecting for payment.',
           bookingId: 'mockBookingId',
           totalCost: 150,
           paymongoCheckoutSessionId: 'cs_mockSessionId',
           paymentRedirectUrl: 'https://paymongo.com/checkout/mock',
         }));
       });

       it('should handle Paymongo API errors', async () => {
           // Mocks for this test only:
           mockDocGet.mockResolvedValueOnce({ // For db.collection('vehicles').doc(vehicleId).get()
               exists: true,
               data: () => ({ rentalPricePerDay: 50, make: 'MockMake', model: 'MockModel' })
           });
           mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] }); // For db.collection('bookings').where(...).get()

           // Mock Paymongo API call failure - simulate AxiosError structure
           mockAxios.post.mockRejectedValueOnce({
               isAxiosError: true, // Indicate it's an Axios error
               response: {
                   status: 401,
                   data: { errors: [{ code: 'authentication_failed', detail: 'Invalid API key' }] }
               },
               message: 'Request failed with status code 401' // Add a message property
           });

           const req = mockRequest(
               {},
               {},
               { vehicleId: 'paymongoErrorVehicle', startDate: '2025-07-01', endDate: '2025-07-03', paymentMethodType: 'card' },
               { uid: 'testUser123', email: 'test@example.com' } // customUser is pre-populated
           );
           const res = mockResponse();

           await createBooking(req, res);

           expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles');
           expect(mockCollectionRef.doc).toHaveBeenCalledWith('paymongoErrorVehicle');
           expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for vehicle
           expect(mockFirestore.collection).toHaveBeenCalledWith('bookings');
           expect(mockCollectionRef.where).toHaveBeenCalledWith('vehicleId', '==', 'paymongoErrorVehicle');
           expect(mockQueryRef.get).toHaveBeenCalledTimes(1);
           expect(res.status).toHaveBeenCalledWith(401); // Now expects 401 correctly
           expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
               message: 'Payment gateway error.',
               details: [{ code: 'authentication_failed', detail: 'Invalid API key' }]
           }));
       });
     });

     describe('getUserBookings', () => {
       it('should return bookings for the authenticated user', async () => {
         const mockBookings = [
           { id: 'b1', exists: true, data: () => ({ userId: 'u1', vehicleId: 'v1', createdAt: mockFirebaseAdmin.firestore.FieldValue.serverTimestamp() }) },
           { id: 'b2', exists: true, data: () => ({ userId: 'u1', vehicleId: 'v2', createdAt: mockFirebaseAdmin.firestore.FieldValue.serverTimestamp() }) },
         ];

         // Mocks for this test only:
         mockCollectionGet.mockResolvedValueOnce({ docs: mockBookings, empty: false }); // 1. For bookings query result
         mockDocGet
           .mockResolvedValueOnce({ exists: true, data: () => ({ make: 'Mock Car A' }) }) // 1. For vehicle v1 details
           .mockResolvedValueOnce({ exists: true, data: () => ({ make: 'Mock Car B' }) }); // 2. For vehicle v2 details


         const req = mockRequest({}, {}, {}, { uid: 'u1' }); // customUser is pre-populated
         const res = mockResponse();

         await getUserBookings(req, res); // Use imported function directly

         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings'); // For bookings query
         expect(mockCollectionRef.where).toHaveBeenCalledWith('userId', '==', 'u1');
         expect(mockQueryRef.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
         expect(mockQueryRef.get).toHaveBeenCalledTimes(1); // One get for the bookings query
         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles'); // For vehicle details (called within the map)
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('v1'); // For vehicle details
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('v2'); // For vehicle details
         expect(mockDocGet).toHaveBeenCalledTimes(2); // Only 2 for vehicles
         expect(res.status).toHaveBeenCalledWith(200);
         expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
           message: 'User bookings retrieved successfully.',
           bookings: expect.arrayContaining([
             // The controller should correctly add the 'id' to the booking object it returns
             expect.objectContaining({ id: 'b1', vehicleDetails: { make: 'Mock Car A' } }),
             expect.objectContaining({ id: 'b2', vehicleDetails: { make: 'Mock Car B' } }),
           ]),
         }));
       });

       it('should return empty array if no bookings found', async () => {
         // Mocks for this test only:
         mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true }); // For bookings query

         const req = mockRequest({}, {}, {}, { uid: 'u1' }); // customUser is pre-populated
         const res = mockResponse();

         await getUserBookings(req, res);

         expect(mockCollectionGet).toHaveBeenCalledTimes(1); // Only 1 for bookings query
         expect(res.status).toHaveBeenCalledWith(200);
         expect(res.json).toHaveBeenCalledWith({
           message: 'User bookings retrieved successfully.',
           bookings: [],
         });
       });

       it('should handle server errors gracefully', async () => {
         // Mocks for this test only:
         mockCollectionGet.mockRejectedValueOnce(new Error('Firestore read error')); // For bookings query

         const req = mockRequest({}, {}, {}, { uid: 'u1' }); // customUser is pre-populated
         const res = mockResponse();

         await getUserBookings(req, res);

         expect(mockCollectionGet).toHaveBeenCalledTimes(1);
         expect(res.status).toHaveBeenCalledWith(500);
         expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
           message: 'Server error retrieving user bookings.',
         }));
       });
     });

     describe('getBookingById', () => {
       it('should return a single booking if found and authorized', async () => {
         const mockBookingData = { userId: 'u1', vehicleId: 'v1' };
         // Mocks for this test only:
         mockDocGet
           .mockResolvedValueOnce({ exists: true, data: () => mockBookingData, id: 'b1' }) // 1. For booking document
           .mockResolvedValueOnce({ exists: true, data: () => ({ make: 'Vehicle A' }) }); // 2. For vehicle details

         const req = mockRequest({ bookingId: 'b1' }, {}, {}, { uid: 'u1' }); // customUser is pre-populated
         const res = mockResponse();

         await getBookingById(req, res);

         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings');
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('b1');
         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles');
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('v1');
         expect(mockDocGet).toHaveBeenCalledTimes(2); // 1 for booking, 1 for vehicle
         expect(res.status).toHaveBeenCalledWith(200);
         expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
           message: 'Booking retrieved successfully.',
           booking: expect.objectContaining({ id: 'b1', ...mockBookingData, vehicleDetails: { make: 'Vehicle A' } }),
         }));
       });

       it('should return 404 if booking not found', async () => {
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: false }); // For booking document

         const req = mockRequest({ bookingId: 'nonExistent' }, {}, {}, { uid: 'u1' }); // customUser is pre-populated
         const res = mockResponse();

         await getBookingById(req, res);

         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for booking
         expect(res.status).toHaveBeenCalledWith(404);
         expect(res.json).toHaveBeenCalledWith({ message: 'Booking not found.' });
       });

       it('should return 403 if user is not authorized to view booking', async () => {
         const mockBookingData = { userId: 'u2' }; // Booking owned by another user
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({...mockBookingData, userId: 'u2'}), id: 'b1' }); // For booking document, explicitly set userId

         const req = mockRequest({ bookingId: 'b1' }, {}, {}, { uid: 'u1', role: 'renter' }); // customUser is pre-populated
         const res = mockResponse();

         await getBookingById(req, res);

         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for booking
         expect(res.status).toHaveBeenCalledWith(403);
         expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden: You are not authorized to view this booking.' });
       });
     });

     describe('cancelBooking', () => {
       it('should successfully cancel a booking', async () => {
         const futureStartDate = mockDateTime.now().plus({ days: 2 }).toISODate();
         const mockBookingData = {
           userId: 'u1',
           startDate: futureStartDate,
           status: 'confirmed',
         };
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => mockBookingData, id: 'b1' }); // For booking document
         // Mock update success for db.collection('bookings').doc('b1').update()
         mockUpdate.mockResolvedValueOnce();

         const req = mockRequest({ bookingId: 'b1' }, {}, {}, { uid: 'u1', role: 'renter' }); // customUser is pre-populated
         const res = mockResponse();

         await cancelBooking(req, res);

         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings');
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('b1');
         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for booking
         expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
           status: 'cancelled',
           updatedAt: expect.any(Object), // Expect serverTimestamp
         }));
         expect(res.status).toHaveBeenCalledWith(200);
         expect(res.json).toHaveBeenCalledWith({
           message: 'Booking cancelled successfully!',
           bookingId: 'b1',
           newStatus: 'cancelled',
         });
       });

       it('should return 404 if booking not found', async () => {
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: false }); // For booking document

         const req = mockRequest({ bookingId: 'nonExistent' }, {}, {}, { uid: 'u1', role: 'renter' }); // customUser is pre-populated
         const res = mockResponse();

         await cancelBooking(req, res);

         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for booking
         expect(res.status).toHaveBeenCalledWith(404);
         expect(res.json).toHaveBeenCalledWith({ message: 'Booking not found.' });
       });

       it('should return 403 if user is not authorized to cancel booking', async () => {
         const mockBookingData = { userId: 'u2' };
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({...mockBookingData, userId: 'u2'}), id: 'b1' }); // For booking document, explicitly set userId

         const req = mockRequest({ bookingId: 'b1' }, {}, {}, { uid: 'u1', role: 'renter' }); // customUser is pre-populated
         const res = mockResponse();

         await cancelBooking(req, res);

         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for booking
         expect(res.status).toHaveBeenCalledWith(403);
         expect(res.json).toHaveBeenCalledWith({ message: 'You are not authorized to cancel this booking.' });
       });

       it('should return 400 if booking cannot be cancelled within 24 hours', async () => {
         // Set startDate to be less than 24 hours from mockDateTime.now()
         const within24HoursStartDate = mockDateTime.now().plus({ hours: 12 }).toISODate(); // +12 hours from 2025-06-22T10:00:00Z -> 2025-06-22T22:00:00Z
         const mockBookingData = {
           userId: 'u1',
           startDate: within24HoursStartDate,
           status: 'confirmed',
         };
         // Mocks for this test only:
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => mockBookingData, id: 'b1' }); // For booking document

         const req = mockRequest({ bookingId: 'b1' }, {}, {}, { uid: 'u1', role: 'renter' }); // customUser is pre-populated
         const res = mockResponse();

         await cancelBooking(req, res);

         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for booking
         expect(res.status).toHaveBeenCalledWith(400);
         expect(res.json).toHaveBeenCalledWith({ message: 'Booking cannot be cancelled within 24 hours of the start date.' });
       });
     });

     describe('getOwnerVehicleBookings', () => {
       it('should return owner vehicle bookings if authorized (owner)', async () => {
         const mockBookings = [
           { id: 'b3', exists: true, data: () => ({ userId: 'renter1', ownerId: 'owner1', vehicleId: 'v3', createdAt: mockFirebaseAdmin.firestore.FieldValue.serverTimestamp() }) }, // Using ownerId here
         ];
         // Mocks for this test only:
         mockCollectionGet.mockResolvedValueOnce({ docs: mockBookings, empty: false }); // 1. For bookings query
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ make: 'Owner Car' }) }); // 1. For vehicle v3 details

         const req = mockRequest({ ownerId: 'owner1' }, {}, {}, { uid: 'owner1', role: 'owner' }); // customUser is pre-populated
         const res = mockResponse();

         await getOwnerVehicleBookings(req, res);

         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings');
         expect(mockCollectionRef.where).toHaveBeenCalledWith('ownerId', '==', 'owner1'); // Now expecting 'ownerId'
         expect(mockQueryRef.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
         expect(mockQueryRef.get).toHaveBeenCalledTimes(1); // One get for the bookings query
         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles');
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('v3');
         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for vehicle
         expect(res.status).toHaveBeenCalledWith(200);
         expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
           message: 'Owner vehicle bookings retrieved successfully.',
           bookings: expect.arrayContaining([
             expect.objectContaining({ id: 'b3', vehicleDetails: { make: 'Owner Car' } }),
           ]),
         }));
       });

       it('should return owner vehicle bookings if authorized (admin)', async () => {
         const mockBookings = [
           { id: 'b4', exists: true, data: () => ({ userId: 'renter2', ownerId: 'ownerFromAdmin', vehicleId: 'v4', createdAt: mockFirebaseAdmin.firestore.FieldValue.serverTimestamp() }) }, // Using ownerId here
         ];
         // Mocks for this test only:
         mockCollectionGet.mockResolvedValueOnce({ docs: mockBookings, empty: false }); // 1. For bookings query
         mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ make: 'Admin Car' }) }); // 1. For vehicle v4 details

         const req = mockRequest({ ownerId: 'ownerFromAdmin' }, {}, {}, { uid: 'adminUser', role: 'admin' }); // customUser is pre-populated
         const res = mockResponse();

         await getOwnerVehicleBookings(req, res);

         expect(mockFirestore.collection).toHaveBeenCalledWith('bookings');
         expect(mockCollectionRef.where).toHaveBeenCalledWith('ownerId', '==', 'ownerFromAdmin'); // Now expecting 'ownerId'
         expect(mockQueryRef.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
         expect(mockQueryRef.get).toHaveBeenCalledTimes(1);
         expect(mockFirestore.collection).toHaveBeenCalledWith('vehicles');
         expect(mockCollectionRef.doc).toHaveBeenCalledWith('v4');
         expect(mockDocGet).toHaveBeenCalledTimes(1); // Only 1 for vehicle
         expect(res.status).toHaveBeenCalledWith(200);
         expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
           message: 'Owner vehicle bookings retrieved successfully.',
           bookings: expect.arrayContaining([
             expect.objectContaining({ id: 'b4', vehicleDetails: { make: 'Admin Car' } }),
           ]),
         }));
       });

       it('should return 403 if user is not authorized (renter trying to view another owner\'s bookings)', async () => {
         // No Firestore mocks needed here as the check is purely based on req.customUser.role and params.ownerId
         const req = mockRequest({ ownerId: 'owner1' }, {}, {}, { uid: 'u1', role: 'renter' }); // customUser is pre-populated
         const res = mockResponse();

         await getOwnerVehicleBookings(req, res);

         // No Firestore calls related to users or bookings should happen if authorization fails early
         expect(mockDocGet).toHaveBeenCalledTimes(0); // No doc gets expected
         expect(mockCollectionGet).toHaveBeenCalledTimes(0); // No collection gets expected
         expect(res.status).toHaveBeenCalledWith(403);
         expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden: You do not have the necessary role (renter).' });
       });

       it('should return 403 if ownerId in params does not match authenticated ownerId', async () => {
         // No Firestore mocks needed here as the check is purely based on req.customUser.role and params.ownerId
         const req = mockRequest({ ownerId: 'owner2' }, {}, {}, { uid: 'actualOwner1', role: 'owner' }); // Requesting owner2's bookings as actualOwner1
         const res = mockResponse();

         await getOwnerVehicleBookings(req, res);

         // No Firestore calls related to users or bookings should happen if authorization fails early
         expect(mockDocGet).toHaveBeenCalledTimes(0); // No doc gets expected
         expect(mockCollectionGet).toHaveBeenCalledTimes(0); // No collection gets expected
         expect(res.status).toHaveBeenCalledWith(403);
         expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden: You are not authorized to view these bookings.' });
       });
     });
   });
   