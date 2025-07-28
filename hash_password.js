// hash_password.js
const bcrypt = require('bcryptjs');

const plainPassword = 'password123'; // Your test user's password
const saltRounds = 10; // Must match saltRounds in passwordUtil.js

bcrypt.hash(plainPassword, saltRounds, (err, hash) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log('Hashed Password:', hash);
});