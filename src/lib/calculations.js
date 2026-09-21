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

module.exports = {
  costeDiesel,
  costeElectrico,
  mediaPrecios,
  segmentosSesion,
  costeSesionCarga,
  sumaDiasISO,
};
