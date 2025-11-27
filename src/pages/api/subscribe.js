import dotenv from "dotenv";
import FormData from "form-data";
import Mailgun from "mailgun.js";

dotenv.config();

export async function POST({ request }) {
  try {
    const { email, name } = await request.json();

    if (!email) {
      return new Response(JSON.stringify({ success: false, message: "Email is required" }), { status: 400 });
    }

    const mailgun = new Mailgun(FormData);
    const mg = mailgun.client({
      username: "api",
      key: process.env.MAILGUN_API_KEY,
    });

    // Mailing list address
    const listAddress = "updates@mg.orble-tea.com";

    await mg.lists.members.createMember(listAddress, {
      address: email,
      name: name || "",
      subscribed: true,
    });

    return new Response(JSON.stringify({ success: true, message: "Subscribed!" }), { status: 200 });
  } catch (error) {
    console.error("Mailgun subscription error:", error);
    return new Response(JSON.stringify({ success: false, message: "Failed to subscribe" }), { status: 500 });
  }
}
