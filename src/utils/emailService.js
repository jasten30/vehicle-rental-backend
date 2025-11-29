const { Resend } = require('resend');

// --- DEBUGGING START ---
// This will print to your Railway logs so we know the new code loaded.
console.log("--------------------------------------------------");
console.log("[EmailService] Loading module...");
console.log("[EmailService] Attempting to initialize Resend with HARDCODED key.");
// --- DEBUGGING END ---

// --- HARDCODED KEY (Bypassing Railway Variables) ---
const API_KEY = 're_E12Gcuit_Ls9n6My2oj1spTJ6g51BEUPT';

// Initialize Resend
const resend = new Resend(API_KEY);

console.log("[EmailService] Resend initialized successfully.");
console.log("--------------------------------------------------");

// Use your verified domain email
const FROM_EMAIL = 'RentCycle <admin@rentcycle.site>';

/**
 * Sends a verification email to a user.
 */
const sendVerificationEmail = async (userEmail, verificationCode) => {
  console.log(`[EmailService] Attempting to send verification code to: ${userEmail}`);
  try {
    const data = await resend.emails.send({
      from: FROM_EMAIL,
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
    console.log(`[EmailService] SUCCESS! Email sent to ${userEmail}. ID: ${data.id}`);
  } catch (error) {
    console.error(`[EmailService] FATAL ERROR sending verification email:`, error);
    // Don't throw to avoid crashing the whole request
  }
};

/**
 * Sends a password reset link to a user.
 */
const sendPasswordResetEmail = async (to, link) => {
  console.log(`[EmailService] Attempting to send reset link to: ${to}`);
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
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
    console.log(`[EmailService] SUCCESS! Reset link sent.`);
  } catch (error) {
    console.error(`[EmailService] FATAL ERROR sending reset email:`, error);
  }
};

/**
 * Sends a contact form submission to the admin.
 */
const sendContactFormEmail = async (formData) => {
  const { name, email, subject, message } = formData;
  const ADMIN_EMAIL = 'rentcycleplatform@gmail.com';

  console.log(`[EmailService] Forwarding contact form from ${email} to admin.`);
  try {
    await resend.emails.send({
      from: `RentCycle Contact <${FROM_EMAIL}>`, // Note: Using the verified domain as sender
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
    console.log(`[EmailService] Contact email forwarded successfully.`);
  } catch (error) {
    console.error(`[EmailService] FATAL ERROR sending contact email:`, error);
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendContactFormEmail,
};