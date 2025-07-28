// backend/src/__tests__/authMiddleware.test.js

// Mock Firebase Admin SDK for auth and firestore
const mockAuth = {
  verifyIdToken: jest.fn(),
};
const mockFirestore = {
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockReturnThis(),
  get: jest.fn(),
};

// Mock the firebase utility module
jest.mock('../utils/firebase', () => ({
  auth: mockAuth,
  db: mockFirestore,
}));

// Import the middleware after mocks
const { authenticateUser, authorizeRoles } = require('../middleware/authMiddleware');

// Helper to create mock Express req, res, next objects
const mockRequest = (headers = {}, customUser = {}) => ({
  headers,
  customUser, // Ensure customUser is correctly passed and used
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

describe('Auth Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('authenticateUser', () => {
    it('should return 401 if no Authorization header', async () => {
      const req = mockRequest({}); // No headers
      const res = mockResponse();
      await authenticateUser(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith('Unauthorized: No token provided or malformed header.');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 if Authorization header is malformed', async () => {
      const req = mockRequest({ authorization: 'InvalidToken' }); // Malformed
      const res = mockResponse();
      await authenticateUser(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith('Unauthorized: No token provided or malformed header.');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 if ID token is invalid or expired', async () => {
      mockAuth.verifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));

      const req = mockRequest({ authorization: 'Bearer invalid_token' });
      const res = mockResponse();
      await authenticateUser(req, res, mockNext);
      expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('invalid_token');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Unauthorized: Invalid or expired token');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should attach user info and role to req.customUser and call next() for a valid token (existing user)', async () => {
      const mockDecodedToken = { uid: 'testUser123', email: 'test@example.com' };
      const mockUserDocData = { role: 'owner' };
      mockAuth.verifyIdToken.mockResolvedValueOnce(mockDecodedToken);
      mockFirestore.get.mockResolvedValueOnce({ exists: true, data: () => mockUserDocData });

      const req = mockRequest({ authorization: 'Bearer valid_token' });
      const res = mockResponse();
      await authenticateUser(req, res, mockNext);

      expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('valid_token');
      expect(mockFirestore.collection).toHaveBeenCalledWith('users');
      expect(mockFirestore.doc).toHaveBeenCalledWith('testUser123');
      expect(mockFirestore.get).toHaveBeenCalled();
      expect(req.customUser).toEqual({ ...mockDecodedToken, role: 'owner' }); // Check req.customUser
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled(); // Ensure no error response
    });

    it('should attach user info and default role (renter) if user document not found', async () => {
      const mockDecodedToken = { uid: 'newUser456', email: 'new@example.com' };
      mockAuth.verifyIdToken.mockResolvedValueOnce(mockDecodedToken);
      mockFirestore.get.mockResolvedValueOnce({ exists: false }); // User document not found

      const req = mockRequest({ authorization: 'Bearer valid_token_new_user' });
      const res = mockResponse();
      await authenticateUser(req, res, mockNext);

      expect(req.customUser).toEqual({ ...mockDecodedToken, role: 'renter' });
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('authorizeRoles', () => {
    it('should call next() if user has an allowed role', () => {
      const allowedRoles = ['owner', 'admin'];
      const req = mockRequest({}, { uid: 'user1', role: 'owner' }); // Set customUser
      const res = mockResponse();
      const middleware = authorizeRoles(allowedRoles);
      middleware(req, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 if user does not have an allowed role', () => {
      const allowedRoles = ['admin'];
      const req = mockRequest({}, { uid: 'user1', role: 'renter' }); // Set customUser
      const res = mockResponse();
      const middleware = authorizeRoles(allowedRoles);
      middleware(req, res, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Forbidden: Insufficient permissions.');
    });

    it('should return 403 if req.customUser is missing', () => {
      const allowedRoles = ['admin'];
      const req = mockRequest({}); // No customUser
      const res = mockResponse();
      const middleware = authorizeRoles(allowedRoles);
      middleware(req, res, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Forbidden: No user context for authorization');
    });

    it('should return 403 if req.customUser.role is missing', () => {
      const allowedRoles = ['admin'];
      const req = mockRequest({}, { uid: 'user1' }); // customUser exists, but no role
      const res = mockResponse();
      const middleware = authorizeRoles(allowedRoles);
      middleware(req, res, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Forbidden: No user context for authorization');
    });
  });
});
