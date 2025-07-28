// vehicle-rental-backend/src/utils/passwordUtil.js
const bcrypt = require('bcryptjs'); // This line requires bcryptjs

const saltRounds = 10; // Standard number of salt rounds for bcrypt

/**
 * Hashes a plain text password.
 * @param {string} password - The plain text password.
 * @returns {Promise<string>} The hashed password.
 */
const hashPassword = async (password) => {
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  } catch (error) {
    console.error('Error hashing password:', error);
    throw new Error('Failed to hash password.');
  }
};

/**
 * Compares a plain text password with a hashed password.
 * @param {string} plainPassword - The plain text password.
 * @param {string} hashedPassword - The hashed password from the database.
 * @returns {Promise<boolean>} True if passwords match, false otherwise.
 */
const comparePasswords = async (plainPassword, hashedPassword) => {
  try {
    const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
    return isMatch;
  } catch (error) {
    console.error('Error comparing passwords:', error);
    throw new Error('Failed to compare passwords.');
  }
};

module.exports = {
  hashPassword,
  comparePasswords,
};
