const express = require("express");
const store = require("../lib/store");
const { fetchDieselPrice } = require("../fetchers/diesel");
const { fetchElectricityPrices, toDateParam } = require("../fetchers/electricity");
const calc = require("../lib/calculations");
const { sendTelegramMessage, telegramConfigurado } = require("../lib/telegram");

const router = express.Router();

const UNA_HORA_MS = 60 * 60 * 1000;

function fechaISO(offsetDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return toDateParam(d);
}

// "Enchufa de 19:00 a 20:00 y de 22:00 a 00:00" en vez de una lista suelta
// de horas: asi es como se usa un cargador de verdad.
function formatoBloques(horasUsadas) {
  const bloques = calc.agrupaBloques(horasUsadas);
  if (bloques.length === 0) return "sin horas disponibles";
  const hoy = fechaISO(0);
  let fechaAnterior = null;
  return bloques
    .map((b) => {
      const cambiaDia = b.fecha && b.fecha !== fechaAnterior;
      fechaAnterior = b.fecha;
      const dia = cambiaDia ? (b.fecha === hoy ? "hoy " : "mañana ") : "";
      const ini = String(b.horaInicio).padStart(2, "0");
      const fin = String(b.horaFin % 24).padStart(2, "0");
      return `${dia}de ${ini}:00 a ${fin}:00`;
    })
    .join(" y ");
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

    // Coste real "de verdad": no la media plana de las 24h, sino lo que
    // costaria cargar la energia de un dia usando SOLO las horas en las que
    // realmente puedes cargar en casa, repartida a la potencia real del
    // cargador (nunca se carga todo en una hora).
    const kwhDiaMedio = (settings.electrico.kmDiaMedio / 100) * settings.electrico.consumoKwh100km;
    let resumenElectrico = null;
    if (electricidadHoy) {
      const ventana = { horaSalidaTrabajo: settings.electrico.horaSalidaTrabajo, horaLlegadaCasa: settings.electrico.horaLlegadaCasa };
      const permitidasHoy = new Set(calc.horasPermitidasEnDia(electricidadHoy.fecha, ventana));
      const disponiblesHoy = electricidadHoy.horas.filter((h) => permitidasHoy.has(h.hora));
      const cargaHoy = calc.seleccionaHorasMasBaratas(disponiblesHoy, kwhDiaMedio, settings.electrico.potenciaCargaKw);
      if (cargaHoy.energiaCubiertaKwh > 0) {
        resumenElectrico = {
          kwhDia: Number(kwhDiaMedio.toFixed(2)),
          costeDia: cargaHoy.costeTotal,
          costeMes: Number((cargaHoy.costeTotal * 30).toFixed(2)),
          costeAnio: Number((cargaHoy.costeTotal * 365).toFixed(2)),
          costePorKm: Number((cargaHoy.costeTotal / settings.electrico.kmDiaMedio).toFixed(4)),
          precioMedioEurKwh: cargaHoy.precioMedioEurKwh,
          horasNecesarias: cargaHoy.horasNecesarias,
        };
      }
    }

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
        ? { fecha: electricidadHoy.fecha, precioMedioEurKwh: resumenElectrico?.precioMedioEurKwh ?? null, horas: electricidadHoy.horas }
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
    const {
      fecha,
      horaInicio,
      duracionHoras,
      bateriaAntesPct,
      bateriaDespuesPct,
      kwhCargados,
      tipo,
      proveedor,
      precioMedioEurKwh,
      costeTotal,
    } = req.body;
    const settings = await store.getSettings();

    if (!fecha) {
      return res.status(400).json({ error: "Falta el campo fecha" });
    }

    const kwh =
      kwhCargados != null
        ? Number(kwhCargados)
        : ((Number(bateriaDespuesPct) - Number(bateriaAntesPct)) / 100) * settings.electrico.capacidadBateriaKwh;

    if (!(kwh > 0)) {
      return res.status(400).json({ error: "La energia cargada debe ser mayor que 0 (revisa % de bateria o kWh)." });
    }

    if (tipo === "fuera") {
      // Carga fuera de casa (Supercharger u otra compañia): precio manual,
      // no se calcula con el PVPC de casa.
      let precio = precioMedioEurKwh != null ? Number(precioMedioEurKwh) : null;
      let total = costeTotal != null ? Number(costeTotal) : null;
      if (precio == null && total != null) precio = total / kwh;
      else if (total == null && precio != null) total = precio * kwh;

      if (!(precio > 0) || !(total > 0)) {
        return res.status(400).json({ error: "Indica el precio por kWh o el coste total de la carga fuera de casa" });
      }

      const registro = await store.addCharge({
        fecha,
        bateriaAntesPct: bateriaAntesPct != null ? Number(bateriaAntesPct) : null,
        bateriaDespuesPct: bateriaDespuesPct != null ? Number(bateriaDespuesPct) : null,
        kwhCargados: Number(kwh.toFixed(2)),
        costeTotal: Number(total.toFixed(2)),
        precioMedioEurKwh: Number(precio.toFixed(5)),
        coberturaDatos: 100,
        detalle: [],
        tipo: "fuera",
        proveedor: proveedor || null,
      });

      return res.status(201).json(registro);
    }

    if (horaInicio == null || !duracionHoras) {
      return res.status(400).json({ error: "Faltan campos: horaInicio, duracionHoras" });
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
      tipo: "casa",
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

// ---------- Evolucion mensual (real vs teorico) ----------

router.get("/diesel/evolution", async (req, res) => {
  try {
    const [fills, history, settings] = await Promise.all([store.getDieselFills(), store.getDieselHistory(), store.getSettings()]);
    const evolucion = calc.evolucionMensual({
      registros: fills.map((f) => ({ fecha: f.fecha, costeTotal: f.costeTotal })),
      historicoPrecios: history.map((h) => ({ fecha: h.fecha, precio: h.precioPorLitro })),
      kmDiaMedio: settings.diesel.kmDiaMedio,
      consumoPor100km: settings.diesel.consumoL100km,
    });
    res.json(evolucion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/electricity/evolution", async (req, res) => {
  try {
    const [charges, history, settings] = await Promise.all([store.getCharges(), store.getElectricityHistory(), store.getSettings()]);
    const evolucion = calc.evolucionMensual({
      registros: charges.map((c) => ({ fecha: c.fecha, costeTotal: c.costeTotal })),
      historicoPrecios: history.map((h) => ({ fecha: h.fecha, precio: h.precioMedioEurKwh })),
      kmDiaMedio: settings.electrico.kmDiaMedio,
      consumoPor100km: settings.electrico.consumoKwh100km,
    });
    res.json(evolucion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Plan de carga: cuanto y cuando cargar ----------
// Respeta la ventana real en la que se puede cargar en casa (ajustes:
// horaSalidaTrabajo / horaLlegadaCasa entre semana, fin de semana libre) y
// la potencia real del cargador (nunca se carga toda la energia en una
// sola hora: a 3kW, 9kWh son 3 horas, no una). Compara dos estrategias con
// los precios reales de hoy y manana, que son los unicos que conocemos:
//   A) "opcionSoloNecesario": cargar justo la energia de un dia de conduccion.
//   B) "opcionCargaCompleta": aprovechar ahora (hoy+manana) las horas mas
//      baratas para cargar hasta el 100% de la bateria (partiendo de tu %
//      actual), si eso sale mas barato por kWh y cubre varios dias -- la
//      logica de "cargar el fin de semana para toda la semana".

async function calculaHorasCandidatas({ ventana, potenciaCargaKw }) {
  const hoy = fechaISO(0);
  const manana = fechaISO(1);
  const horaActual = new Date().getHours();

  const [precioHoy, precioManana] = await Promise.all([
    obtenerPreciosDia(hoy).catch(() => null),
    obtenerPreciosDia(manana).catch(() => null),
  ]);

  const disponiblesHoy = precioHoy
    ? (() => {
        const permitidas = new Set(calc.horasPermitidasEnDia(hoy, ventana));
        return precioHoy.horas
          .filter((h) => permitidas.has(h.hora) && h.hora > horaActual)
          .map((h) => ({ fecha: hoy, hora: h.hora, precioEurKwh: h.precioEurKwh }));
      })()
    : [];

  const disponiblesManana = precioManana
    ? (() => {
        const permitidas = new Set(calc.horasPermitidasEnDia(manana, ventana));
        return precioManana.horas.filter((h) => permitidas.has(h.hora)).map((h) => ({ fecha: manana, hora: h.hora, precioEurKwh: h.precioEurKwh }));
      })()
    : [];

  return { mananaDisponible: !!precioManana, disponiblesHoy, disponiblesManana };
}

router.get("/recommend", async (req, res) => {
  try {
    const settings = await store.getSettings();
    const ventana = { horaSalidaTrabajo: settings.electrico.horaSalidaTrabajo, horaLlegadaCasa: settings.electrico.horaLlegadaCasa };
    const potenciaCargaKw = settings.electrico.potenciaCargaKw;
    const capacidadBateriaKwh = settings.electrico.capacidadBateriaKwh;
    const kwhDiaMedio = (settings.electrico.kmDiaMedio / 100) * settings.electrico.consumoKwh100km;

    const bateriaActualPct = req.query.bateriaActualPct != null && req.query.bateriaActualPct !== "" ? Number(req.query.bateriaActualPct) : 30;

    const { mananaDisponible, disponiblesHoy, disponiblesManana } = await calculaHorasCandidatas({ ventana, potenciaCargaKw });

    // A) Solo lo necesario para el dia siguiente: usa precios de manana en
    // cuanto se publican (~20:30); mientras tanto, las horas que quedan hoy.
    const poolNecesario = disponiblesManana.length > 0 ? disponiblesManana : disponiblesHoy;
    const opcionSoloNecesario = calc.seleccionaHorasMasBaratas(poolNecesario, kwhDiaMedio, potenciaCargaKw);
    opcionSoloNecesario.bloques = calc.agrupaBloques(opcionSoloNecesario.horasUsadas);

    // B) Cargar hasta el 100% ahora aprovechando lo mas barato de hoy+manana.
    const bateriaActualKwh = (bateriaActualPct / 100) * capacidadBateriaKwh;
    const margenKwh = Math.max(0, capacidadBateriaKwh - bateriaActualKwh);
    const poolCompleto = [...disponiblesHoy, ...disponiblesManana];
    const opcionCargaCompleta = calc.seleccionaHorasMasBaratas(poolCompleto, margenKwh, potenciaCargaKw);
    opcionCargaCompleta.bloques = calc.agrupaBloques(opcionCargaCompleta.horasUsadas);
    const diasQueCubre = kwhDiaMedio > 0 && opcionCargaCompleta.energiaCubiertaKwh > 0 ? Number((opcionCargaCompleta.energiaCubiertaKwh / kwhDiaMedio).toFixed(1)) : 0;

    let recomendacion = null;
    if (
      opcionCargaCompleta.energiaCubiertaKwh > 0 &&
      opcionSoloNecesario.precioMedioEurKwh != null &&
      opcionCargaCompleta.precioMedioEurKwh != null
    ) {
      // Solo merece la pena cargar de mas si sale claramente mas barato por
      // kWh (>=3%) Y cubre de verdad varios dias (si no, es la misma carga
      // de siempre con otro nombre).
      const compensa = opcionCargaCompleta.precioMedioEurKwh < opcionSoloNecesario.precioMedioEurKwh * 0.97 && diasQueCubre >= 1.5;
      recomendacion = compensa ? "completa" : "solo-necesario";
    }

    res.json({
      kwhDiaMedio: Number(kwhDiaMedio.toFixed(2)),
      potenciaCargaKw,
      ventana,
      bateriaActualPct,
      capacidadBateriaKwh,
      mananaDisponible,
      avisoManana: mananaDisponible ? null : "Los precios de mañana se publican sobre las 20:30. Hasta entonces se usan las horas que quedan hoy.",
      opcionSoloNecesario,
      opcionCargaCompleta,
      diasQueCubre,
      recomendacion,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Simulacion retroactiva de carga en casa ----------
// "Si hubiera tenido el electrico, cuanto me habria costado cargar cada dia
// respetando la ventana real disponible", usando los precios PVPC reales
// que ya tenemos guardados dia a dia. Se compara con el gasto real de
// diesel en ese mismo rango de fechas.

router.get("/electricity/simulation", async (req, res) => {
  try {
    const [cacheAll, settings, fills] = await Promise.all([
      store.getElectricityCacheAll(),
      store.getSettings(),
      store.getDieselFills(),
    ]);

    const dias = calc.simulacionCargaRestringida({
      dias: cacheAll,
      kmDiaMedio: settings.electrico.kmDiaMedio,
      consumoKwh100km: settings.electrico.consumoKwh100km,
      potenciaCargaKw: settings.electrico.potenciaCargaKw,
      horaSalidaTrabajo: settings.electrico.horaSalidaTrabajo,
      horaLlegadaCasa: settings.electrico.horaLlegadaCasa,
    });
    dias.forEach((d) => {
      d.bloques = calc.agrupaBloques(d.horasUsadas);
    });

    const totalCoste = dias.reduce((a, d) => a + d.costeTotal, 0);
    const totalDias = dias.length;

    let gastoDieselMismoPeriodo = null;
    if (totalDias > 0) {
      const desde = dias[0].fecha;
      const hasta = dias[dias.length - 1].fecha;
      gastoDieselMismoPeriodo = fills.filter((f) => f.fecha >= desde && f.fecha <= hasta).reduce((a, f) => a + f.costeTotal, 0);
    }

    res.json({
      dias,
      totalCoste: Number(totalCoste.toFixed(2)),
      totalDias,
      costeMedioDia: totalDias ? Number((totalCoste / totalDias).toFixed(2)) : null,
      gastoDieselMismoPeriodo: gastoDieselMismoPeriodo != null ? Number(gastoDieselMismoPeriodo.toFixed(2)) : null,
      ventana: {
        horaSalidaTrabajo: settings.electrico.horaSalidaTrabajo,
        horaLlegadaCasa: settings.electrico.horaLlegadaCasa,
        potenciaCargaKw: settings.electrico.potenciaCargaKw,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Notificaciones (Telegram) ----------

router.get("/notify/status", (req, res) => {
  res.json({ configurado: telegramConfigurado() });
});

router.post("/notify/test", async (req, res) => {
  try {
    const resultado = await sendTelegramMessage("🔧 Prueba de notificacion desde la calculadora EV vs Diesel. Si ves esto, Telegram esta bien configurado.");
    res.json(resultado);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Aviso nocturno: se pensó para lanzarse ~20:40 (tras publicarse el PVPC de
// mañana). Junta la franja mas barata para cargar, un aviso si el diesel se
// sale de lo normal, y un recordatorio si llevas dias sin registrar un
// repostaje. Pensado para cron-job.org (Render duerme) o el cron interno
// de server.js si esto corre en una maquina siempre encendida.
router.post("/notify/nightly", async (req, res) => {
  try {
    const settings = await store.getSettings();
    const ventana = { horaSalidaTrabajo: settings.electrico.horaSalidaTrabajo, horaLlegadaCasa: settings.electrico.horaLlegadaCasa };
    const potenciaCargaKw = settings.electrico.potenciaCargaKw;
    const kwhDiaMedio = (settings.electrico.kmDiaMedio / 100) * settings.electrico.consumoKwh100km;

    const lineas = [];

    const { mananaDisponible, disponiblesHoy, disponiblesManana } = await calculaHorasCandidatas({ ventana, potenciaCargaKw });
    const poolNecesario = disponiblesManana.length > 0 ? disponiblesManana : disponiblesHoy;
    const rec = calc.seleccionaHorasMasBaratas(poolNecesario, kwhDiaMedio, potenciaCargaKw);

    if (rec.horasUsadas.length > 0) {
      lineas.push(
        `🔌 Enchufa el coche <b>${formatoBloques(rec.horasUsadas)}</b> (${kwhDiaMedio.toFixed(1)} kWh, ~${rec.horasNecesarias}h a ${potenciaCargaKw}kW) · ${rec.precioMedioEurKwh.toFixed(4)} €/kWh de media · ${rec.costeTotal.toFixed(2)} €`
      );
    } else if (!mananaDisponible) {
      lineas.push("🔌 Los precios de mañana aún no están publicados (normalmente sobre las 20:30).");
    }

    const historial = await store.getDieselHistory();
    const dieselActual = await store.getDieselCache();
    const umbral = settings.notificaciones.umbralAnomaliaPct;
    if (dieselActual && historial.length >= 5) {
      const ultimos = historial.slice(0, 30).map((h) => h.precioPorLitro);
      const media = ultimos.reduce((a, b) => a + b, 0) / ultimos.length;
      const deltaPct = ((dieselActual.precioPorLitro - media) / media) * 100;
      if (Math.abs(deltaPct) >= umbral) {
        const flecha = deltaPct > 0 ? "📈 subiendo" : "📉 bajando";
        lineas.push(
          `⛽ El diésel está ${flecha}: ${dieselActual.precioPorLitro.toFixed(3)} €/L (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}% vs. media de los últimos ${ultimos.length} días)`
        );
      }
    }

    const fills = await store.getDieselFills();
    const diasAviso = settings.notificaciones.avisoStaleDias;
    if (fills.length > 0) {
      const ultimo = fills[fills.length - 1];
      const diasDesde = Math.floor((Date.now() - new Date(ultimo.fecha + "T00:00:00").getTime()) / 86400000);
      if (diasDesde >= diasAviso) {
        lineas.push(`📝 Llevas ${diasDesde} días sin registrar un repostaje de diésel.`);
      }
    }

    if (lineas.length === 0) {
      lineas.push("Sin novedades por hoy.");
    }

    const mensaje = `<b>Resumen EV vs Diesel</b>\n\n${lineas.join("\n")}`;
    const resultadoTelegram = await sendTelegramMessage(mensaje);
    res.json({ mensaje, telegram: resultadoTelegram });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
