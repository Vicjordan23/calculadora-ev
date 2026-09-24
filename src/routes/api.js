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

// Precio medio "real" de cargar: NUNCA la media de las 24h del dia, siempre
// la media (entre los dias que tengamos guardados) de lo que costaria cada
// dia cargando solo en las horas mas baratas dentro de la ventana real
// disponible (ver simulacionCargaRestringida). Se reutiliza tanto para la
// comparativa principal como para la proyeccion mensual/anual del resumen,
// para que ningun numero de la app se base en una media plana.
async function precioMedioCargaReal(settings) {
  const cacheAll = await store.getElectricityCacheAll();
  if (cacheAll.length === 0) return null;

  const dias = calc.simulacionCargaRestringida({
    dias: cacheAll,
    kmDiaMedio: settings.electrico.kmDiaMedio,
    consumoKwh100km: settings.electrico.consumoKwh100km,
    potenciaCargaKw: settings.electrico.potenciaCargaKw,
    horaSalidaTrabajo: settings.electrico.horaSalidaTrabajo,
    horaLlegadaCasa: settings.electrico.horaLlegadaCasa,
  });

  const validos = dias.filter((d) => d.precioMedioEurKwh != null);
  if (validos.length === 0) return null;

  const media = validos.reduce((a, d) => a + d.precioMedioEurKwh, 0) / validos.length;
  return { precioMedioEurKwh: media, muestras: validos.length };
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
    const precio = await obtenerPrecioDieselFresco();
    // Respuesta minima a proposito: la usan crons externos (cron-job.org)
    // que a veces marcan como "fallido" una respuesta de varios KB.
    res.json({ ok: true, fechaPublicacion: precio.fechaPublicacion, precioPorLitro: precio.precioPorLitro });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get("/diesel/history", async (req, res) => {
  res.json(await store.getDieselHistory());
});

// ---------- Precios electricidad (PVPC) ----------

// Reintenta solo los fallos tecnicos (red, timeouts...). Un "todavia no esta
// publicado" (err.noPublicado) no se arregla reintentando al segundo.
async function conReintentos(fn, intentos = 3, esperaMs = 1500) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      if (err.noPublicado) break;
      if (i < intentos - 1) await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
  throw ultimoError;
}

// Para no machacar a REE cuando la pagina esta reintentando cada minuto:
// tras un "aun no publicado" no se vuelve a preguntar por esa fecha en 45 s.
const noPublicadoHasta = new Map();
const ESPERA_TRAS_NO_PUBLICADO_MS = 45000;

async function obtenerPreciosDia(fecha, { forzar = false } = {}) {
  const cache = await store.getElectricityForDate(fecha);
  // Si la cache tiene menos de 20 horas es que algo salio mal en un fetch
  // anterior (dato incompleto): mejor reintentar que quedarnos con eso.
  if (cache && Array.isArray(cache.horas) && cache.horas.length >= 20) return cache;

  if (!forzar && (noPublicadoHasta.get(fecha) || 0) > Date.now()) {
    const err = new Error(`Precios PVPC de ${fecha} aun no publicados`);
    err.noPublicado = true;
    throw err;
  }

  try {
    const precios = await conReintentos(() => fetchElectricityPrices(new Date(fecha + "T12:00:00")));
    noPublicadoHasta.delete(fecha);
    await store.registraIntentoPvpc({ fecha, ok: true, fuente: precios.fuente });
    return await store.saveElectricityPrices(precios);
  } catch (err) {
    if (err.noPublicado) noPublicadoHasta.set(fecha, Date.now() + ESPERA_TRAS_NO_PUBLICADO_MS);
    await store.registraIntentoPvpc({ fecha, ok: false, noPublicado: !!err.noPublicado, error: err.message }).catch(() => {});
    throw err;
  }
}

// Ligero, para pings de keep-alive.
router.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Ultimos intentos de descarga de precios PVPC (cuando y que respondio la
// fuente), para ver a que hora aparecen de verdad los precios de manana.
router.get("/electricity/diagnostico", async (req, res) => {
  res.json({ ahora: new Date().toISOString(), intentos: await store.getIntentosPvpc() });
});

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
    const guardado = await store.saveElectricityPrices(precios);
    // Respuesta minima: la usan crons externos que marcan como "fallido"
    // una respuesta de varios KB (esta llevaba las 24 horas completas).
    res.json({ ok: true, fecha: guardado.fecha, horas: guardado.horas.length });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, fecha });
  }
});

// Endpoint dedicado para el cron externo de las 20:35/21:00: SIEMPRE pide
// manana, pase lo que pase (no depende de un ?fecha= que un cron externo
// no puede calcular solo). El generico de arriba, sin parametros, refresca
// HOY -- por eso hacia falta este aparte.
//
// Pensado para ejecutarse VARIAS veces cada tarde (p.ej. cada 10 min entre
// las 20:00 y las 23:50): si ya tiene los precios guardados no vuelve a
// pedirlos, y si aun no estan publicados responde 200 con ok:false (no es un
// fallo del cronjob: cron-job.org desactiva los jobs con muchos fallos).
// Solo un error tecnico real (red, base de datos...) devuelve 5xx.
router.post("/electricity/refresh-manana", async (req, res) => {
  const fecha = fechaISO(1);
  try {
    const yaGuardado = await store.getElectricityForDate(fecha);
    if (yaGuardado && Array.isArray(yaGuardado.horas) && yaGuardado.horas.length >= 20) {
      return res.json({ ok: true, fecha, horas: yaGuardado.horas.length, yaGuardado: true });
    }
    const guardado = await obtenerPreciosDia(fecha, { forzar: true });
    res.json({ ok: true, fecha, horas: guardado.horas.length, fuente: guardado.fuente || null });
  } catch (err) {
    if (err.noPublicado) return res.json({ ok: false, fecha, motivo: "aun no publicado" });
    res.status(502).json({ ok: false, error: err.message, fecha });
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
        // Para mes/año usamos la media de varios dias reales cargando en las
        // horas mas baratas (mas estable que multiplicar solo el dia de hoy,
        // que puede ser puntualmente mas barato o mas caro de lo normal).
        const precioReal = await precioMedioCargaReal(settings);
        const precioParaProyeccion = precioReal?.precioMedioEurKwh ?? cargaHoy.precioMedioEurKwh;
        const costeDiaProyeccion = kwhDiaMedio * precioParaProyeccion;

        resumenElectrico = {
          kwhDia: Number(kwhDiaMedio.toFixed(2)),
          costeDia: cargaHoy.costeTotal,
          costeMes: Number((costeDiaProyeccion * 30).toFixed(2)),
          costeAnio: Number((costeDiaProyeccion * 365).toFixed(2)),
          costePorKm: Number((cargaHoy.costeTotal / settings.electrico.kmDiaMedio).toFixed(4)),
          precioMedioEurKwh: cargaHoy.precioMedioEurKwh,
          horasNecesarias: cargaHoy.horasNecesarias,
          muestrasProyeccion: precioReal?.muestras ?? 1,
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

// ---------- Comparativa principal: diesel real vs Tesla (mismos km) ----------
// La pregunta que de verdad importa: de los km que REALMENTE has recorrido
// (inferidos de los litros que has comprado, no de una media supuesta),
// cuanto habrian costado en el Tesla cargando en casa. El precio de la luz
// usado es la media de lo que costaria cada dia cargando SOLO en tus horas
// mas baratas dentro de la ventana real (nunca la media de las 24h).

router.get("/comparativa", async (req, res) => {
  try {
    const [fills, settings, dieselCache] = await Promise.all([store.getDieselFills(), store.getSettings(), store.getDieselCache()]);

    if (fills.length === 0) {
      return res.json({ hayDatos: false });
    }

    const totalLitros = fills.reduce((a, f) => a + f.litros, 0);
    const costeDieselReal = fills.reduce((a, f) => a + f.costeTotal, 0);
    const kmEstimados = (totalLitros / settings.diesel.consumoL100km) * 100;
    const kwhEquivalente = (kmEstimados / 100) * settings.electrico.consumoKwh100km;

    const precioReal = await precioMedioCargaReal(settings);
    const costeTeslaEstimado = precioReal != null ? kwhEquivalente * precioReal.precioMedioEurKwh : null;

    const fechas = fills.map((f) => f.fecha).sort();

    res.json({
      hayDatos: true,
      desde: fechas[0],
      hasta: fechas[fechas.length - 1],
      numRepostajes: fills.length,
      totalLitros: Number(totalLitros.toFixed(1)),
      kmEstimados: Number(kmEstimados.toFixed(0)),
      costeDieselReal: Number(costeDieselReal.toFixed(2)),
      kwhEquivalente: Number(kwhEquivalente.toFixed(1)),
      precioMedioEurKwh: precioReal != null ? Number(precioReal.precioMedioEurKwh.toFixed(5)) : null,
      muestrasPrecioElec: precioReal != null ? precioReal.muestras : 0,
      costeTeslaEstimado: costeTeslaEstimado != null ? Number(costeTeslaEstimado.toFixed(2)) : null,
      diferencia: costeTeslaEstimado != null ? Number((costeDieselReal - costeTeslaEstimado).toFixed(2)) : null,
      precioDieselActual: dieselCache?.precioPorLitro ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    // Bolsa de horas candidatas: SIEMPRE la union de lo que queda de hoy +
    // todo manana (cuando ya se conoce). No tiene sentido descartar una
    // hora barata que quede esta noche solo porque ya hay datos de manana
    // (antes se usaba una u otra en exclusiva, lo que podia ignorar una
    // hora de esta noche mas barata que cualquier hora de manana).
    const pool = [...disponiblesHoy, ...disponiblesManana];

    // A) Solo lo necesario para el dia siguiente.
    const opcionSoloNecesario = calc.seleccionaHorasMasBaratas(pool, kwhDiaMedio, potenciaCargaKw);
    opcionSoloNecesario.bloques = calc.agrupaBloques(opcionSoloNecesario.horasUsadas);

    // B) Cargar hasta el 100% ahora aprovechando lo mas barato de hoy+manana.
    const bateriaActualKwh = (bateriaActualPct / 100) * capacidadBateriaKwh;
    const margenKwh = Math.max(0, capacidadBateriaKwh - bateriaActualKwh);
    const opcionCargaCompleta = calc.seleccionaHorasMasBaratas(pool, margenKwh, potenciaCargaKw);
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

    // Consejo "espera al fin de semana": si con la bateria actual aguantas
    // sin cargar hasta el proximo sabado/domingo, y el histórico dice que
    // los findes suelen salir bastante mas baratos, avisa de que compensa
    // esperar en vez de cargar ahora entre semana.
    const tipEsperarFinde = await calculaTipEsperarFinde({ bateriaActualKwh, kwhDiaMedio, opcionSoloNecesario });

    res.json({
      kwhDiaMedio: Number(kwhDiaMedio.toFixed(2)),
      potenciaCargaKw,
      ventana,
      bateriaActualPct,
      capacidadBateriaKwh,
      mananaDisponible,
      avisoManana: mananaDisponible
        ? null
        : "Antes de las 20:30 esto es solo orientativo: todavía no se conocen los precios de mañana, así que solo se puede elegir entre las horas que quedan hoy (que suelen ser las más caras del día). Después de las 20:30 la recomendación ya compara hoy y mañana de verdad.",
      opcionSoloNecesario,
      opcionCargaCompleta,
      diasQueCubre,
      recomendacion,
      tipEsperarFinde,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function calculaTipEsperarFinde({ bateriaActualKwh, kwhDiaMedio, opcionSoloNecesario }) {
  const hoyFecha = fechaISO(0);
  const diaSemanaHoy = calc.diaSemanaUTC(hoyFecha);
  const esFindeHoy = diaSemanaHoy === 0 || diaSemanaHoy === 6;
  if (esFindeHoy || kwhDiaMedio <= 0 || opcionSoloNecesario.precioMedioEurKwh == null) return null;

  const diasHastaSabado = 6 - diaSemanaHoy; // diaSemanaHoy es 1-5 (lun-vie) aqui
  const historial = await store.getElectricityHistory();
  const historicoPrecios = historial.map((h) => ({ fecha: h.fecha, precio: h.precioMedioEurKwh }));

  const precioSabado = calc.precioHistoricoPorDiaSemana(historicoPrecios, 6, 4);
  const precioDomingo = calc.precioHistoricoPorDiaSemana(historicoPrecios, 0, 4);
  const muestras = [precioSabado, precioDomingo].filter(Boolean);
  if (muestras.length === 0) return null; // aun no hay suficiente historico de findes

  const precioEstimadoFinde = muestras.reduce((a, m) => a + m.precioMedioEurKwh, 0) / muestras.length;
  const totalMuestras = muestras.reduce((a, m) => a + m.muestras, 0);

  const diasAutonomia = Math.floor(bateriaActualKwh / kwhDiaMedio);
  const puedeEsperar = diasAutonomia >= diasHastaSabado;
  const compensaEsperar = precioEstimadoFinde < opcionSoloNecesario.precioMedioEurKwh * 0.85; // al menos 15% mas barato

  if (!puedeEsperar || !compensaEsperar) return null;

  return {
    diasHastaSabado,
    diasAutonomia,
    precioEstimadoFinde: Number(precioEstimadoFinde.toFixed(5)),
    precioActual: opcionSoloNecesario.precioMedioEurKwh,
    muestras: totalMuestras,
  };
}

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
    const pool = [...disponiblesHoy, ...disponiblesManana];
    const rec = calc.seleccionaHorasMasBaratas(pool, kwhDiaMedio, potenciaCargaKw);

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
