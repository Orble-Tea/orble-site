import type { APIRoute } from "astro";

/**
 * API endpoint for sending emails via SendGrid
 * Accepts POST requests with email data and forwards to SendGrid API
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const emailData = await request.json();

    // Get SendGrid API key from environment variables
    const SENDGRID_API_KEY = import.meta.env.SENDGRID_API_KEY;

    if (!SENDGRID_API_KEY) {
      console.error("SendGrid API key not configured");
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Email service not configured" 
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Send POST request to SendGrid API
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("SendGrid API error:", errorText);
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Failed to send email" 
        }),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Email sent successfully" 
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in send-email API:", error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: "Internal server error" 
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
};