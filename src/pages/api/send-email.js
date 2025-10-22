import dotenv from "dotenv";
import FormData from "form-data";
import Mailgun from "mailgun.js";
import { z } from "zod";

dotenv.config();

// Define validation schema
const contactFormSchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Name is required")
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters"),
  
  email: z.string()
    .trim()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(255, "Email must be less than 255 characters"),
  
  message: z.string()
    .trim()
    .min(1, "Message is required")
    .min(10, "Message must be at least 10 characters")
    .max(5000, "Message must be less than 5000 characters")
});

// Retry helper function with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries - 1) {
        throw lastError;
      }
      
      const delay = initialDelay * Math.pow(2, attempt);
      console.log(`Email send attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

export async function POST({ request }) {
  try {
    const body = await request.json();

    // Validate with Zod
    const validationResult = contactFormSchema.safeParse(body);
    
    if (!validationResult.success) {
      // Extract validation errors
      const errors = validationResult.error.flatten().fieldErrors;
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Validation failed",
          errors: errors // Send field-specific errors
        }), 
        { status: 400 }
      );
    }

    // Data is now validated and typed
    const { name, email, message } = validationResult.data;

    if (!process.env.MAILGUN_API_KEY) {
      throw new Error("Invalid mailgun API");
    }

    const mailgun = new Mailgun(FormData);
    const mg = mailgun.client({
      username: "api",
      key: process.env.MAILGUN_API_KEY,
    });

    const messageData = {
      from: "Orble Tea Contact Form <postmaster@mg.orble-tea.com>",
      to: "info@orble-tea.com",
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

    await retryWithBackoff(async () => {
      return await mg.messages.create("mg.orble-tea.com", messageData);
    }, 3, 1000);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Email sent successfully" 
      }), 
      { status: 200 }
    );
  } catch (error) {
    console.error("Mailgun error after retries:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: "Failed to send email", 
      }),
      { status: 500 }
    );
  }
}