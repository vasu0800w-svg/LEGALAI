import emailjs from '@emailjs/browser';

// .env file se direct EmailJS keys utha rahe hain
const EMAILJS_SERVICE_ID = (import.meta as any).env.VITE_EMAILJS_SERVICE_ID || '';
const EMAILJS_PUBLIC_KEY = (import.meta as any).env.VITE_EMAILJS_PUBLIC_KEY || '';
const WELCOME_TEMPLATE_ID = (import.meta as any).env.VITE_EMAILJS_TEMPLATE_ID || '';
const PURCHASE_TEMPLATE_ID = (import.meta as any).env.VITE_EMAILJS_TEMPLATE_ID || '';
const EXPIRY_TEMPLATE_ID = (import.meta as any).env.VITE_EMAILJS_TEMPLATE_ID || '';

// 1. Welcome Email
export const sendWelcomeEmail = async (userEmail: string, userName: string) => {
  try {
    if (!EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY || !WELCOME_TEMPLATE_ID) {
      console.error("EmailJS configuration missing in .env file.");
      return;
    }

    await emailjs.send(
      EMAILJS_SERVICE_ID,
      WELCOME_TEMPLATE_ID,
      { to_email: userEmail, to_name: userName, message: "Welcome to casemate! Your account has been created successfully." },
      EMAILJS_PUBLIC_KEY
    );
    console.log("Welcome email sent!");
  } catch (error) {
    console.error("Error sending welcome email:", error);
  }
};

// 2. Plan Purchase Email
export const sendPurchaseEmail = async (userEmail: string, userName: string, planName: string) => {
  try {
    if (!EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY || !PURCHASE_TEMPLATE_ID) {
      console.error("EmailJS configuration missing in .env file.");
      return;
    }

    await emailjs.send(
      EMAILJS_SERVICE_ID,
      PURCHASE_TEMPLATE_ID,
      { to_email: userEmail, to_name: userName, message: `Thank you for purchasing the ${planName}! Your subscription is now active.` },
      EMAILJS_PUBLIC_KEY
    );
    console.log("Purchase email sent!");
  } catch (error) {
    console.error("Error sending purchase email:", error);
  }
};

// 3. Plan Expiry Alert Email
export const sendExpiryAlertEmail = async (userEmail: string, userName: string) => {
  try {
    if (!EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY || !EXPIRY_TEMPLATE_ID) {
      console.error("EmailJS configuration missing in .env file.");
      return;
    }

    await emailjs.send(
      EMAILJS_SERVICE_ID,
      EXPIRY_TEMPLATE_ID,
      { to_email: userEmail, to_name: userName, message: "Your casemate subscription plan is about to expire soon. Please renew to continue uninterrupted service." },
      EMAILJS_PUBLIC_KEY
    );
    console.log("Expiry alert email sent!");
  } catch (error) {
    console.error("Error sending expiry alert email:", error);
  }
};