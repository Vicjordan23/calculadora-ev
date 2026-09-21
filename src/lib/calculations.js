/**
 * Coste diario/mensual/anual de circular con el coche diesel.
 */
function costeDiesel({ kmDiaMedio, consumoL100km, precioPorLitro }) {
  const litrosDia = (kmDiaMedio / 100) * consumoL100km;
  const costeDia = litrosDia * precioPorLitro;
  return {
    litrosDia: Number(litrosDia.toFixed(2)),
    costeDia: Number(costeDia.toFixed(2)),
    costeMes: Number((costeDia * 30).toFixed(2)),
    costeAnio: Number((costeDia * 365).toFixed(2)),
    costePorKm: Number((costeDia / kmDiaMedio).toFixed(4)),
  };
}

/**
 * Coste diario/mensual/anual estimado del electrico usando un precio medio EUR/kWh
 * (p.ej. la media de las 24h del PVPC del dia, o el precio medio real de las cargas registradas).
 */
function costeElectrico({ kmDiaMedio, consumoKwh100km, precioMedioEurKwh }) {
  const kwhDia = (kmDiaMedio / 100) * consumoKwh100km;
  const costeDia = kwhDia * precioMedioEurKwh;
  return {
    kwhDia: Number(kwhDia.toFixed(2)),
    costeDia: Number(costeDia.toFixed(2)),
    costeMes: Number((costeDia * 30).toFixed(2)),
    costeAnio: Number((costeDia * 365).toFixed(2)),
    costePorKm: Number((costeDia / kmDiaMedio).toFixed(4)),
  };
}

function mediaPrecios(horas) {
  if (!horas || horas.length === 0) return null;
  const suma = horas.reduce((acc, h) => acc + h.precioEurKwh, 0);
  return suma / horas.length;
}

/**
 * Suma `dias` (puede ser negativo) a una fecha "YYYY-MM-DD" usando aritmetica
 * en UTC, para no depender de la zona horaria local del proceso (evita que
 * "2026-09-21" + 0 dias se convierta en "2026-09-20" al pasar por
 * toISOString si el proceso corre en una zona con offset positivo).
 */
function sumaDiasISO(fechaISO, dias) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

/**
 * Genera la lista de "segmentos horarios" que cubre una sesion de carga,
 * repartiendo la energia cargada a ritmo constante entre las horas que toca.
 * horaInicio: 0-23 (hora local del dia `fecha`)
 * duracionHoras: puede ser decimal (p.ej. 3.5)
 */
function segmentosSesion({ fecha, horaInicio, duracionHoras }) {
  const segmentos = [];
  let restante = duracionHoras;
  let horaActual = horaInicio;
  let diaOffset = 0;

  while (restante > 1e-6) {
    const fraccion = Math.min(1, restante);
    const horaMod = ((horaActual % 24) + 24) % 24;
    segmentos.push({ diaOffset, hora: horaMod, fraccion: Number(fraccion.toFixed(4)) });
    restante -= fraccion;
    horaActual += 1;
    if (horaMod === 23) diaOffset += 1;
  }
  return segmentos;
}

/**
 * Calcula el coste real de una sesion de carga usando los precios PVPC reales de cada hora.
 * getPreciosDia(fechaISO) debe devolver el array `horas` (o null si no hay datos) para ese dia.
 */
function costeSesionCarga({ fecha, horaInicio, duracionHoras, kwhCargados, getPreciosDia }) {
  const segmentos = segmentosSesion({ fecha, horaInicio, duracionHoras });
  const energiaPorHora = kwhCargados / duracionHoras;

  let costeTotal = 0;
  let energiaConPrecio = 0;
  const detalle = [];

  for (const seg of segmentos) {
    const fechaSegISO = sumaDiasISO(fecha, seg.diaOffset);

    const horasDia = getPreciosDia(fechaSegISO);
    const precioHora = horasDia ? horasDia.find((h) => h.hora === seg.hora)?.precioEurKwh : null;
    const energia = energiaPorHora * seg.fraccion;

    if (precioHora != null) {
      costeTotal += energia * precioHora;
      energiaConPrecio += energia;
    }

    detalle.push({
      fecha: fechaSegISO,
      hora: seg.hora,
      energiaKwh: Number(energia.toFixed(3)),
      precioEurKwh: precioHora,
      coste: precioHora != null ? Number((energia * precioHora).toFixed(4)) : null,
    });
  }

  const cobertura = kwhCargados > 0 ? energiaConPrecio / kwhCargados : 0;

  return {
    kwhCargados: Number(kwhCargados.toFixed(2)),
    costeTotal: Number(costeTotal.toFixed(2)),
    precioMedioEurKwh: energiaConPrecio > 0 ? Number((costeTotal / energiaConPrecio).toFixed(5)) : null,
    coberturaDatos: Number((cobertura * 100).toFixed(0)), // % de la energia con precio real conocido
    detalle,
  };
}

/**
 * Agrupa registros reales (repostajes o cargas) por mes y los compara con un
 * coste teorico calculado a partir del precio medio real de ese mes (segun
 * el historico de precios) y los km/consumo configurados en ajustes.
 * Sirve tanto para diesel (litros/L100km) como electrico (kWh/kWh100km).
 *
 * @param {Array<{fecha, costeTotal}>} registros gastos reales (repostajes o cargas)
 * @param {Array<{fecha, precio}>} historicoPrecios precio medio diario historico
 * @param {number} kmDiaMedio
 * @param {number} consumoPor100km L o kWh por 100km
 */
function evolucionMensual({ registros, historicoPrecios, kmDiaMedio, consumoPor100km }) {
  const real = {};
  for (const r of registros) {
    const mes = r.fecha.slice(0, 7);
    real[mes] = real[mes] || { total: 0, registros: 0 };
    real[mes].total += r.costeTotal;
    real[mes].registros += 1;
  }

  const preciosPorMes = {};
  for (const h of historicoPrecios) {
    const mes = h.fecha.slice(0, 7);
    preciosPorMes[mes] = preciosPorMes[mes] || [];
    preciosPorMes[mes].push(h.precio);
  }

  const meses = new Set([...Object.keys(real), ...Object.keys(preciosPorMes)]);

  return [...meses].sort().map((mes) => {
    const preciosDelMes = preciosPorMes[mes];
    const precioMedio = preciosDelMes && preciosDelMes.length ? preciosDelMes.reduce((a, b) => a + b, 0) / preciosDelMes.length : null;

    const [y, m] = mes.split("-").map(Number);
    const diasDelMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const teorico = precioMedio != null ? Number(((kmDiaMedio / 100) * consumoPor100km * precioMedio * diasDelMes).toFixed(2)) : null;

    return {
      mes,
      real: Number((real[mes]?.total || 0).toFixed(2)),
      registros: real[mes]?.registros || 0,
      teorico,
    };
  });
}

/**
 * Dia de la semana (0=domingo ... 6=sabado) de una fecha "YYYY-MM-DD",
 * calculado en UTC para que no dependa de la zona horaria del proceso.
 */
function diaSemanaUTC(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Horas (0-23) en las que se puede cargar en casa ese dia concreto, dada
 * la ventana real disponible: entre semana solo fuera del horario de
 * trabajo (desde que llegas a casa hasta que sales al dia siguiente); los
 * fines de semana no hay restriccion. Al evaluarse por dia individual (no
 * por "sesion" que cruza la medianoche) no hace falta tratar el cruce de
 * medianoche como caso especial: cada hora se compara solo con el dia al
 * que pertenece.
 */
function horasPermitidasEnDia(fechaISO, { horaSalidaTrabajo, horaLlegadaCasa }) {
  const esFinde = [0, 6].includes(diaSemanaUTC(fechaISO));
  const horas = [];
  for (let h = 0; h < 24; h++) {
    const permitida = esFinde || h < horaSalidaTrabajo || h >= horaLlegadaCasa;
    if (permitida) horas.push(h);
  }
  return horas;
}

/**
 * Dada una lista de horas disponibles (cada una con su precio), elige las
 * mas baratas hasta cubrir la energia necesaria, repartiendo como maximo
 * `potenciaCargaKw` por hora (limite fisico del cargador de casa).
 */
function seleccionaHorasMasBaratas(horasDisponibles, energiaNecesariaKwh, potenciaCargaKw) {
  const ordenadas = [...horasDisponibles].sort((a, b) => a.precioEurKwh - b.precioEurKwh);
  let restante = energiaNecesariaKwh;
  let coste = 0;
  let energiaCubierta = 0;
  const usadas = [];

  for (const h of ordenadas) {
    if (restante <= 1e-9) break;
    const energia = Math.min(restante, potenciaCargaKw);
    coste += energia * h.precioEurKwh;
    energiaCubierta += energia;
    usadas.push({ hora: h.hora, precioEurKwh: h.precioEurKwh, energiaKwh: Number(energia.toFixed(2)) });
    restante -= energia;
  }

  usadas.sort((a, b) => a.hora - b.hora);

  return {
    horasUsadas: usadas,
    costeTotal: Number(coste.toFixed(2)),
    energiaCubiertaKwh: Number(energiaCubierta.toFixed(2)),
    energiaNecesariaKwh: Number(energiaNecesariaKwh.toFixed(2)),
    coberturaPct: energiaNecesariaKwh > 0 ? Number(((energiaCubierta / energiaNecesariaKwh) * 100).toFixed(0)) : 100,
    precioMedioEurKwh: energiaCubierta > 0 ? Number((coste / energiaCubierta).toFixed(5)) : null,
  };
}

/**
 * Simulacion retroactiva: para cada dia con precios PVPC guardados, cuanto
 * habria costado cargar la energia de un dia de conduccion (kmDiaMedio /
 * consumoKwh100km) usando solo las horas realmente disponibles ese dia.
 * @param {Array<{fecha, horas:[{hora,precioEurKwh}]}>} dias
 */
function simulacionCargaRestringida({ dias, kmDiaMedio, consumoKwh100km, potenciaCargaKw, horaSalidaTrabajo, horaLlegadaCasa }) {
  const energiaNecesaria = (kmDiaMedio / 100) * consumoKwh100km;

  return dias.map((dia) => {
    const permitidas = new Set(horasPermitidasEnDia(dia.fecha, { horaSalidaTrabajo, horaLlegadaCasa }));
    const disponibles = dia.horas.filter((h) => permitidas.has(h.hora));
    const resultado = seleccionaHorasMasBaratas(disponibles, energiaNecesaria, potenciaCargaKw);
    const esFinde = [0, 6].includes(diaSemanaUTC(dia.fecha));

    return {
      fecha: dia.fecha,
      esFinde,
      ...resultado,
    };
  });
}

module.exports = {
  costeDiesel,
  costeElectrico,
  mediaPrecios,
  segmentosSesion,
  costeSesionCarga,
  sumaDiasISO,
  evolucionMensual,
  diaSemanaUTC,
  horasPermitidasEnDia,
  seleccionaHorasMasBaratas,
  simulacionCargaRestringida,
};
