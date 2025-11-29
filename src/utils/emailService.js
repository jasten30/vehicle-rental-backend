const { Resend } = require('resend');

// Initialize Resend with the key from Railway Variables
const resend = new Resend(process.env.RESEND_API_KEY);

// Use your verified domain email here.
// If your domain isn't verified on Resend yet, use 'onboarding@resend.dev' for testing.
const FROM_EMAIL = 'admin@rentcycle.site';

/**
 * Sends a verification email to a user.
 */
const sendVerificationEmail = async (userEmail, verificationCode) => {
  try {
    const data = await resend.emails.send({
      from: `RentCycle <${FROM_EMAIL}>`,
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
    });
    console.log(`[EmailService] Verification email sent to ${userEmail}`, data);
  } catch (error) {
    console.error(`[EmailService] Error sending verification email:`, error);
    throw new Error('Failed to send verification email.');
  }
};

/**
 * Sends a password reset link to a user.
 */
const sendPasswordResetEmail = async (to, link) => {
  try {
    await resend.emails.send({
      from: `RentCycle <${FROM_EMAIL}>`,
      to: to,
      subject: 'Reset Your RentCycle Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p style="font-size: 16px;">Click the button below to choose a new password.</p>
          <a href="${link}" style="display: inline-block; background-color: #6a0dad; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; margin: 20px 0;">
            Reset Password
          </a>
        </div>
      `,
    });
    console.log(`[EmailService] Password reset link sent to ${to}`);
  } catch (error) {
    console.error(`[EmailService] Error sending reset email:`, error);
    throw new Error('Failed to send password reset email.');
  }
};

/**
 * Sends a contact form submission to the admin.
 */
const sendContactFormEmail = async (formData) => {
  const { name, email, subject, message } = formData;

  // NOTE: You must send TO an email you own or control
  const ADMIN_EMAIL = 'rentcycleplatform@gmail.com';

  try {
    await resend.emails.send({
      from: `RentCycle Contact <${FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      reply_to: email,
      subject: `New Contact: ${subject}`,
      html: `
        <div>
          <h2>New Message from ${name}</h2>
          <p><strong>Email:</strong> ${email}</p>
          <hr>
          <p>${message.replace(/\n/g, '<br>')}</p>
        </div>
      `,
    });
    console.log(`[EmailService] Contact email forwarded.`);
  } catch (error) {
    console.error(`[EmailService] Error sending contact email:`, error);
    throw new Error('Failed to send contact form email.');
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendContactFormEmail,
};