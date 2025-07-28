// backend/src/__tests__/passwordUtil.test.js

// This is a hypothetical test file for a password hashing utility.
// You would replace 'path/to/your/passwordUtil' with the actual path if you create one.
// Example uses bcryptjs, which you would install: npm install bcryptjs
const bcrypt = require('bcryptjs'); // Assuming bcryptjs is used for hashing

// Hypothetical password utility functions
const passwordUtil = {
  hashPassword: async (password) => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  },
  comparePassword: async (password, hashedPassword) => {
    return bcrypt.compare(password, hashedPassword);
  },
};

describe('Password Utility', () => {
  it('should hash a password correctly', async () => {
    const password = 'mySecretPassword123';
    const hashedPassword = await passwordUtil.hashPassword(password);

    // Hashed password should be a string and different from the original
    expect(typeof hashedPassword).toBe('string');
    expect(hashedPassword).not.toBe(password);
    // Bcrypt hashes are usually long strings
    expect(hashedPassword.length).toBeGreaterThan(30);
  });

  it('should compare a correct password with its hash successfully', async () => {
    const password = 'mySecretPassword123';
    const hashedPassword = await passwordUtil.hashPassword(password);
    const isMatch = await passwordUtil.comparePassword(password, hashedPassword);
    expect(isMatch).toBe(true);
  });

  it('should fail to compare an incorrect password with its hash', async () => {
    const password = 'mySecretPassword123';
    const wrongPassword = 'wrongPassword';
    const hashedPassword = await passwordUtil.hashPassword(password);
    const isMatch = await passwordUtil.comparePassword(wrongPassword, hashedPassword);
    expect(isMatch).toBe(false);
  });

  it('should fail to compare with an invalid hash', async () => {
    const password = 'mySecretPassword123';
    const invalidHash = 'invalidhashstring'; // Not a valid bcrypt hash
    const isMatch = await passwordUtil.comparePassword(password, invalidHash);
    expect(isMatch).toBe(false); // bcrypt.compare returns false for invalid hash format
  });
});
