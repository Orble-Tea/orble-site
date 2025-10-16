import dotenv from "dotenv";
import FormData from "form-data";
import Mailgun from "mailgun.js";

dotenv.config();

export async function POST({ request }) {
  try {
    console.log("SENDING EMAIL")
    console.log(request)
    const { name, email, message } = await request.json();

    // Validation
    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "All fields are required" 
        }), 
        { status: 400 }
      );
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Invalid email format" 
        }), 
        { status: 400 }
      );
    }

    const mailgun = new Mailgun(FormData);
    const mg = mailgun.client({
      username: "api",
      key: process.env.MAILGUN_API_KEY,
    });

    const messageData = {
      from: "Orble Tea Contact Form <postmaster@mg.orble-tea.com>",
      to: "info@orble-tea.com", // Your receiving email
      subject: `New Contact Form Submission from ${name}`,
      text: `
Name: ${name}
Email: ${email}

Message:
${message}
      `,
      html: `
<h2>New Contact Form Submission</h2>
<p><strong>Name:</strong> ${name}</p>
<p><strong>Email:</strong> ${email}</p>
<p><strong>Message:</strong></p>
<p>${message.replace(/\n/g, '<br>')}</p>
      `,
      "h:Reply-To": email,
    };

    await mg.messages.create("mg.orble-tea.com", messageData);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Email sent successfully" 
      }), 
      { status: 200 }
    );
  } catch (error) {
    console.error("Mailgun error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: "Failed to send email", 
        error: error.message 
      }),
      { status: 500 }
    );
  }
}