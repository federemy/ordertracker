import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { LAST_SUB } from "./save-subscription"; // MVP (comparten proceso si hay warm start)

const pub = process.env.VAPID_PUBLIC_KEY!;
const priv = process.env.VAPID_PRIVATE_KEY!;
const subject = process.env.VAPID_SUBJECT || "mailto:you@example.com";
webpush.setVapidDetails(subject, pub, priv);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  try {
    if (!LAST_SUB) return { statusCode: 400, body: "No subscription yet" };
    const { title = "Test", body = "Hola 👋" } = JSON.parse(event.body || "{}");
    await webpush.sendNotification(LAST_SUB, JSON.stringify({ title, body }));
    return { statusCode: 200, body: "Sent" };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Error" };
  }
};
