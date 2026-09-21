require("dotenv").config();
const path = require("path");
const express = require("express");
const cron = require("node-cron");

const apiRouter = require("./src/routes/api");
const store = require("./src/lib/store");
const { fetchDieselPrice } = require("./src/fetchers/diesel");
const { fetchElectricityPrices, toDateParam } = require("./src/fetchers/electricity");

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
cron.schedule("0 7,14 * * *", async () => {
  try {
    const precio = await fetchDieselPrice();
    await store.saveDieselCache(precio);
    console.log(`[cron] Precio diesel actualizado: ${precio.precioPorLitro} EUR/L`);
  } catch (err) {
    console.error("[cron] Error actualizando precio diesel:", err.message);
  }
});

// Electricidad: el precio del dia siguiente se publica sobre las 20:30.
// Reintentamos a las 20:35 y, por si acaso, otra vez a las 21:00.
cron.schedule("35 20,21 * * *", async () => {
  try {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const precios = await fetchElectricityPrices(manana);
    await store.saveElectricityPrices(precios);
    console.log(`[cron] Precios PVPC de manana (${toDateParam(manana)}) guardados.`);
  } catch (err) {
    console.error("[cron] Error actualizando precios PVPC de manana:", err.message);
  }
});
