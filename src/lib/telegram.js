// Notificaciones por Telegram. Si no hay TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID
// configurados, no hace nada (la app funciona igual sin notificaciones).
async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { enviado: false, motivo: "Telegram no configurado (faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)" };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Error de Telegram: ${data.description || res.status}`);
  }
  return { enviado: true, mensajeId: data.result.message_id };
}

function telegramConfigurado() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

module.exports = { sendTelegramMessage, telegramConfigurado };
