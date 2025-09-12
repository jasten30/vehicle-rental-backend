const nodemailer = require('nodemailer');

// Configure the email transporter using your email service's credentials
// IMPORTANT: Use environment variables for these in a real application!
const transporter = nodemailer.createTransport({
  service: 'gmail', // Or another service like 'SendGrid'
  auth: {
    user: 'rentcycleplatform@gmail.com', // Your email address
    pass: 'wonu xqaa eyry ysxo',   // Your email's "App Password" (not your regular password)
  },
});

/**
 * Sends a verification email to a user.
 * @param {string} userEmail The recipient's email address.
 * @param {string} verificationCode The 6-digit code to send.
 */
const sendVerificationEmail = async (userEmail, verificationCode) => {
  const mailOptions = {
    from: '"RentCycle" <rentcycleplatform@gmail.com>',
    to: userEmail,
    subject: 'Your RentCycle Verification Code',
    html: `
      <div style="font-family: sans-serif; text-align: center; padding: 20px;">
        <h2>Welcome to RentCycle!</h2>
        <p>Your verification code is:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; background-color: #f0f0f0; padding: 10px; border-radius: 8px;">
          ${verificationCode}
        </p>
        <p>This code will expire in 15 minutes.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EmailService] Verification email sent to ${userEmail}`);
  } catch (error) {
    console.error(`[EmailService] Error sending email to ${userEmail}:`, error);
    // In a real app, you might want to handle this error more gracefully
    throw new Error('Failed to send verification email.');
  }
};

module.exports = {
  sendVerificationEmail,
};