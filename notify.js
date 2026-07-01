import { log } from "./logger.js";

export async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // notifications are optional

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    if (!res.ok) {
      log("notify_warn", `Telegram send failed: ${res.status}`);
    }
  } catch (e) {
    log("notify_warn", `Telegram send error: ${e.message}`);
  }
}
