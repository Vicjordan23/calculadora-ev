require("dotenv").config();
// Fuerza la zona horaria de todo el proceso a la de España: sin esto, en
// un servidor en la nube (normalmente UTC) "que hora es ahora" y "que dia
// es hoy" salen mal por 1-2 horas, lo que descuadra que horas cuentan como
// "las que quedan hoy" y cuando cruza la medianoche real de España.
process.env.TZ = "Europe/Madrid";

const path = require("path");
const express = require("express");
const cron = require("node-cron");

const apiRouter = require("./src/routes/api");
const store = require("./src/lib/store");
const { fetchDieselPrice } = require("./src/fetchers/diesel");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use("/api", apiRouter);
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Calculadora EV vs Diesel escuchando en http://localhost:${PORT}`);
});

// ---------- Refresco automatico ----------
// Diesel: se actualiza una vez al dia por la manana en la fuente oficial;
// refrescamos a las 07:00 y otra vez a las 14:00 (franja horaria que pediste).
cron.schedule(
  "0 7,14 * * *",
  async () => {
    try {
      const precio = await fetchDieselPrice();
      await store.saveDieselCache(precio);
      console.log(`[cron] Precio diesel actualizado: ${precio.precioPorLitro} EUR/L`);
    } catch (err) {
      console.error("[cron] Error actualizando precio diesel:", err.message);
    }
  },
  { timezone: "Europe/Madrid" }
);

// Electricidad: el precio del dia siguiente se publica sobre las 20:15-20:30.
// Se intenta cada 10 min entre las 20:00 y las 23:50; el endpoint no vuelve
// a pedir nada en cuanto ya tiene los precios de manana guardados.
cron.schedule(
  "*/10 20-23 * * *",
  async () => {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/electricity/refresh-manana`, { method: "POST" });
      const data = await res.json();
      if (data.ok && !data.yaGuardado) console.log(`[cron] Precios PVPC de manana (${data.fecha}) guardados (${data.fuente}).`);
    } catch (err) {
      console.error("[cron] Error actualizando precios PVPC de manana:", err.message);
    }
  },
  { timezone: "Europe/Madrid" }
);

// Aviso nocturno por Telegram (recomendacion de carga + alertas). Solo tiene
// efecto si TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID estan configurados; si no,
// el endpoint no hace nada. Util cuando esto corre en una maquina siempre
// encendida (Raspberry Pi, PC de casa...); en Render gratis usa en su lugar
// un cron externo (cron-job.org) porque el servicio duerme y este cron
// interno no se ejecutaria (ver DEPLOY.md).
cron.schedule(
  "40 20 * * *",
  async () => {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/notify/nightly`, { method: "POST" });
      const data = await res.json();
      console.log("[cron] Aviso nocturno:", data.telegram?.enviado ? "enviado" : data.telegram?.motivo || data.error);
    } catch (err) {
      console.error("[cron] Error en aviso nocturno:", err.message);
    }
  },
  { timezone: "Europe/Madrid" }
);
