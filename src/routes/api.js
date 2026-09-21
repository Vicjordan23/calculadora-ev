const express = require("express");
const store = require("../lib/store");
const { fetchDieselPrice } = require("../fetchers/diesel");
const { fetchElectricityPrices, toDateParam } = require("../fetchers/electricity");
const calc = require("../lib/calculations");
const { mejorVentana, construyeSerie } = require("../lib/recommend");

const router = express.Router();

const UNA_HORA_MS = 60 * 60 * 1000;

function fechaISO(offsetDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return toDateParam(d);
}

// ---------- Precio diesel ----------

async function obtenerPrecioDieselFresco() {
  const precio = await fetchDieselPrice();
  await store.saveDieselCache(precio);
  return precio;
}

router.get("/diesel/price", async (req, res) => {
  try {
    const cache = await store.getDieselCache();
    const fresco = !cache || Date.now() - new Date(cache.fetchedAt).getTime() > UNA_HORA_MS;
    const precio = fresco ? await obtenerPrecioDieselFresco() : cache;
    res.json(precio);
  } catch (err) {
    const cache = await store.getDieselCache();
    if (cache) {
      res.json({ ...cache, aviso: `No se pudo refrescar (${err.message}); mostrando ultimo precio conocido.` });
    } else {
      res.status(502).json({ error: err.message });
    }
  }
});

router.post("/diesel/refresh", async (req, res) => {
  try {
    res.json(await obtenerPrecioDieselFresco());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get("/diesel/history", async (req, res) => {
  res.json(await store.getDieselHistory());
});

// ---------- Precios electricidad (PVPC) ----------

async function obtenerPreciosDia(fecha) {
  const cache = await store.getElectricityForDate(fecha);
  if (cache) return cache;
  const precios = await fetchElectricityPrices(new Date(fecha + "T12:00:00"));
  return store.saveElectricityPrices(precios);
}

router.get("/electricity/prices", async (req, res) => {
  const fecha = req.query.fecha || fechaISO(0);
  try {
    res.json(await obtenerPreciosDia(fecha));
  } catch (err) {
    res.status(502).json({ error: err.message, fecha });
  }
});

router.post("/electricity/refresh", async (req, res) => {
  const fecha = req.query.fecha || fechaISO(0);
  try {
    const precios = await fetchElectricityPrices(new Date(fecha + "T12:00:00"));
    res.json(await store.saveElectricityPrices(precios));
  } catch (err) {
    res.status(502).json({ error: err.message, fecha });
  }
});

// ---------- Settings ----------

router.get("/settings", async (req, res) => {
  res.json(await store.getSettings());
});

router.post("/settings", async (req, res) => {
  res.json(await store.saveSettings(req.body || {}));
});

// ---------- Resumen / comparativa ----------

router.get("/summary", async (req, res) => {
  try {
    const settings = await store.getSettings();

    let diesel = await store.getDieselCache();
    if (!diesel || Date.now() - new Date(diesel.fetchedAt).getTime() > UNA_HORA_MS) {
      try {
        diesel = await obtenerPrecioDieselFresco();
      } catch (err) {
        diesel = diesel || null;
      }
    }

    let electricidadHoy = null;
    try {
      electricidadHoy = await obtenerPreciosDia(fechaISO(0));
    } catch (err) {
      electricidadHoy = null;
    }

    const resumenDiesel = diesel
      ? calc.costeDiesel({
          kmDiaMedio: settings.diesel.kmDiaMedio,
          consumoL100km: settings.diesel.consumoL100km,
          precioPorLitro: diesel.precioPorLitro,
        })
      : null;

    const precioMedioElectricidad = electricidadHoy ? calc.mediaPrecios(electricidadHoy.horas) : null;
    const resumenElectrico = precioMedioElectricidad
      ? calc.costeElectrico({
          kmDiaMedio: settings.electrico.kmDiaMedio,
          consumoKwh100km: settings.electrico.consumoKwh100km,
          precioMedioEurKwh: precioMedioElectricidad,
        })
      : null;

    const ahorro =
      resumenDiesel && resumenElectrico
        ? {
            diaEur: Number((resumenDiesel.costeDia - resumenElectrico.costeDia).toFixed(2)),
            mesEur: Number((resumenDiesel.costeMes - resumenElectrico.costeMes).toFixed(2)),
            anioEur: Number((resumenDiesel.costeAnio - resumenElectrico.costeAnio).toFixed(2)),
          }
        : null;

    res.json({
      settings,
      diesel,
      electricidadHoy: electricidadHoy
        ? { fecha: electricidadHoy.fecha, precioMedioEurKwh: Number(precioMedioElectricidad.toFixed(5)), horas: electricidadHoy.horas }
        : null,
      resumenDiesel,
      resumenElectrico,
      ahorro,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Cargas registradas ----------

router.get("/charges", async (req, res) => {
  res.json(await store.getCharges());
});

router.post("/charges", async (req, res) => {
  try {
    const { fecha, horaInicio, duracionHoras, bateriaAntesPct, bateriaDespuesPct, kwhCargados } = req.body;
    const settings = await store.getSettings();

    if (!fecha || horaInicio == null || !duracionHoras) {
      return res.status(400).json({ error: "Faltan campos: fecha, horaInicio, duracionHoras" });
    }

    const kwh =
      kwhCargados != null
        ? Number(kwhCargados)
        : ((Number(bateriaDespuesPct) - Number(bateriaAntesPct)) / 100) * settings.electrico.capacidadBateriaKwh;

    if (!(kwh > 0)) {
      return res.status(400).json({ error: "La energia cargada debe ser mayor que 0 (revisa % de bateria o kWh)." });
    }

    const fechasNecesarias = new Set();
    const segmentos = calc.segmentosSesion({ fecha, horaInicio: Number(horaInicio), duracionHoras: Number(duracionHoras) });
    for (const seg of segmentos) {
      fechasNecesarias.add(calc.sumaDiasISO(fecha, seg.diaOffset));
    }

    const preciosPorDia = {};
    for (const f of fechasNecesarias) {
      try {
        preciosPorDia[f] = await obtenerPreciosDia(f);
      } catch (err) {
        preciosPorDia[f] = null;
      }
    }

    const resultado = calc.costeSesionCarga({
      fecha,
      horaInicio: Number(horaInicio),
      duracionHoras: Number(duracionHoras),
      kwhCargados: kwh,
      getPreciosDia: (f) => (preciosPorDia[f] ? preciosPorDia[f].horas : null),
    });

    const registro = await store.addCharge({
      fecha,
      horaInicio: Number(horaInicio),
      duracionHoras: Number(duracionHoras),
      bateriaAntesPct: bateriaAntesPct != null ? Number(bateriaAntesPct) : null,
      bateriaDespuesPct: bateriaDespuesPct != null ? Number(bateriaDespuesPct) : null,
      kwhCargados: resultado.kwhCargados,
      costeTotal: resultado.costeTotal,
      precioMedioEurKwh: resultado.precioMedioEurKwh,
      coberturaDatos: resultado.coberturaDatos,
      detalle: resultado.detalle,
    });

    res.status(201).json(registro);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/charges/:id", async (req, res) => {
  res.json(await store.deleteCharge(req.params.id));
});

// ---------- Repostajes reales de diesel ----------
// Mientras no tengas el electrico (o para cuando quieras seguir comparando),
// aqui se registra el gasto real de cada repostaje, independiente del
// calculo teorico basado en consumo/km medio.

router.get("/diesel/fills", async (req, res) => {
  res.json(await store.getDieselFills());
});

router.post("/diesel/fills", async (req, res) => {
  try {
    const { fecha, litros, precioPorLitro, costeTotal, kmOdometro, estacion, notas } = req.body;

    if (!fecha || !litros) {
      return res.status(400).json({ error: "Faltan campos: fecha, litros" });
    }
    const litrosNum = Number(litros);
    if (!(litrosNum > 0)) {
      return res.status(400).json({ error: "Los litros deben ser mayores que 0" });
    }

    let precio = precioPorLitro != null ? Number(precioPorLitro) : null;
    let total = costeTotal != null ? Number(costeTotal) : null;

    if (precio == null && total != null) {
      precio = total / litrosNum;
    } else if (total == null && precio != null) {
      total = precio * litrosNum;
    }

    if (!(precio > 0) || !(total > 0)) {
      return res.status(400).json({ error: "Indica el precio por litro o el coste total del repostaje" });
    }

    const registro = await store.addDieselFill({
      fecha,
      litros: Number(litrosNum.toFixed(2)),
      precioPorLitro: Number(precio.toFixed(3)),
      costeTotal: Number(total.toFixed(2)),
      kmOdometro: kmOdometro != null && kmOdometro !== "" ? Number(kmOdometro) : null,
      estacion: estacion || null,
      notas: notas || null,
    });

    res.status(201).json(registro);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/diesel/fills/:id", async (req, res) => {
  res.json(await store.deleteDieselFill(req.params.id));
});

// ---------- Recomendacion de horario de carga ----------

router.get("/recommend", async (req, res) => {
  try {
    const duracionHoras = Number(req.query.duracionHoras);
    if (!(duracionHoras > 0)) {
      return res.status(400).json({ error: "Parametro duracionHoras invalido" });
    }

    const hoy = fechaISO(0);
    const manana = fechaISO(1);

    const [precioHoy, precioManana] = await Promise.all([
      obtenerPreciosDia(hoy).catch(() => null),
      obtenerPreciosDia(manana).catch(() => null),
    ]);

    const serieHoy = precioHoy ? construyeSerie([precioHoy]) : [];
    const serieCompleta = construyeSerie([precioHoy, precioManana].filter(Boolean));

    const recomendacionHoy = mejorVentana(serieHoy, duracionHoras);
    const recomendacionCompleta = mejorVentana(serieCompleta, duracionHoras);

    res.json({
      mananaDisponible: !!precioManana,
      avisoManana: precioManana
        ? null
        : "Los precios de manana se publican sobre las 20:30. Hasta entonces solo se puede recomendar dentro de las horas de hoy que queden.",
      recomendacionHoy,
      recomendacionConManana: recomendacionCompleta,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
