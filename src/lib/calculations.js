/**
 * Coste diario/mensual/anual de circular con el coche diesel. costeMes/
 * costeAnio se escalan por diasConduccionSemana/7 para no asumir que se
 * conduce los 7 dias de la semana cuando en realidad solo se conduce, por
 * ejemplo, de lunes a viernes (valor por defecto 7 mantiene el comportamiento
 * antiguo si no se indica).
 */
function costeDiesel({ kmDiaMedio, consumoL100km, precioPorLitro, diasConduccionSemana = 7 }) {
  const litrosDia = (kmDiaMedio / 100) * consumoL100km;
  const costeDia = litrosDia * precioPorLitro;
  const factorSemana = diasConduccionSemana / 7;
  return {
    litrosDia: Number(litrosDia.toFixed(2)),
    costeDia: Number(costeDia.toFixed(2)),
    costeSemana: Number((costeDia * diasConduccionSemana).toFixed(2)),
    costeMes: Number((costeDia * 30 * factorSemana).toFixed(2)),
    costeAnio: Number((costeDia * 365 * factorSemana).toFixed(2)),
    costePorKm: Number((costeDia / kmDiaMedio).toFixed(4)),
  };
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
 * @param {number} diasConduccionSemana dias/semana que se conduce de verdad (por defecto 7)
 */
function evolucionMensual({ registros, historicoPrecios, kmDiaMedio, consumoPor100km, diasConduccionSemana = 7 }) {
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
    // Dias "efectivos" de conduccion en el mes, no todos los dias del mes
    // (evita asumir que se conduce tambien los fines de semana si no es asi).
    const diasEfectivos = diasDelMes * (diasConduccionSemana / 7);
    const teorico = precioMedio != null ? Number(((kmDiaMedio / 100) * consumoPor100km * precioMedio * diasEfectivos).toFixed(2)) : null;

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
 * Cuenta los dias laborables (lunes a viernes) entre `desdeExclusiva`
 * (sin contar ese dia) y `hastaInclusive` (contando ese dia). Sirve para
 * estimar cuanta bateria se ha gastado desde la ultima carga completa del
 * domingo hasta hoy, contando solo dias de conduccion real.
 */
function diasLaborablesEntre(desdeExclusiva, hastaInclusive) {
  let cursor = sumaDiasISO(desdeExclusiva, 1);
  let count = 0;
  while (cursor <= hastaInclusive) {
    const dow = diaSemanaUTC(cursor);
    if (dow !== 0 && dow !== 6) count++;
    cursor = sumaDiasISO(cursor, 1);
  }
  return count;
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
 * Dada una lista de horas disponibles (cada una con su precio, y
 * opcionalmente su fecha si se combinan horas de varios dias), elige las
 * mas baratas hasta cubrir la energia necesaria, repartiendo como maximo
 * `potenciaCargaKw` por hora (limite fisico real del cargador de casa: el
 * coche NUNCA se carga entero en una sola hora, siempre se reparte).
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
    usadas.push({ ...h, energiaKwh: Number(energia.toFixed(2)) });
    restante -= energia;
  }

  usadas.sort((a, b) => {
    if (a.fecha && b.fecha && a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    return a.hora - b.hora;
  });

  return {
    horasUsadas: usadas,
    horasNecesarias: Number((energiaNecesariaKwh / potenciaCargaKw).toFixed(1)),
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

/**
 * Precio medio historico de un dia de la semana concreto (0=domingo,
 * 6=sabado), usando las ultimas `n` muestras de ese dia de la semana que
 * tengamos guardadas. Sirve para estimar "cuanto suele costar el sabado"
 * aunque todavia no tengamos el precio real de ese sabado en concreto.
 * @param {Array<{fecha, precio}>} historicoPrecios precio medio diario
 */
function precioHistoricoPorDiaSemana(historicoPrecios, diaSemana, n = 4) {
  const delDia = historicoPrecios
    .filter((h) => diaSemanaUTC(h.fecha) === diaSemana)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .slice(0, n);
  if (delDia.length === 0) return null;
  const media = delDia.reduce((a, h) => a + h.precio, 0) / delDia.length;
  return { precioMedioEurKwh: Number(media.toFixed(5)), muestras: delDia.length };
}

/**
 * Agrupa una lista de horas sueltas (ya ordenadas cronologicamente, como
 * devuelve seleccionaHorasMasBaratas) en bloques continuos de "enchufa
 * desde las X hasta las Y", que es como se usa un cargador de verdad (una
 * vez, no encendiendo y apagando cada hora suelta). Si hay huecos entre
 * horas (p.ej. 19h y 22h porque 20h/21h eran mas caras), salen como
 * bloques separados.
 */
function agrupaBloques(horasUsadas) {
  const bloques = [];
  for (const h of horasUsadas || []) {
    const ultimo = bloques[bloques.length - 1];
    const contiguo = ultimo && ultimo.fecha === h.fecha && ultimo.horaFin === h.hora;
    if (contiguo) {
      ultimo.horaFin = h.hora + 1;
      ultimo.energiaKwh = Number((ultimo.energiaKwh + h.energiaKwh).toFixed(2));
    } else {
      bloques.push({ fecha: h.fecha, horaInicio: h.hora, horaFin: h.hora + 1, energiaKwh: h.energiaKwh });
    }
  }
  return bloques;
}

/**
 * Estrategia "cargar el fin de semana para toda la semana": en vez de pagar
 * el precio (mas caro y mas restringido por el horario de trabajo) de cada
 * noche entre semana, se carga la bateria a tope el sabado/domingo -- cuando
 * el PVPC suele tener muchas horas baratas o gratis y no hay restriccion
 * horaria -- y se va gastando bateria el resto de la semana sin volver a
 * enchufar. Para cada sabado del que tengamos precios guardados (emparejado
 * con el domingo siguiente si tambien lo tenemos), calcula cuanto costaria
 * cargar `energiaNecesariaSemanaKwh` usando solo esas horas del finde,
 * priorizando siempre las mas baratas primero (igual que
 * seleccionaHorasMasBaratas, del que reutiliza la logica).
 * @param {Array<{fecha, horas:[{hora,precioEurKwh}]}>} dias
 */
function simulacionCargaFinesSemana({ dias, energiaNecesariaSemanaKwh, potenciaCargaKw }) {
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  const resultado = [];

  for (const d of dias) {
    if (diaSemanaUTC(d.fecha) !== 6) continue; // arranca en cada sabado
    const domingoFecha = sumaDiasISO(d.fecha, 1);
    const domingo = porFecha.get(domingoFecha);

    const horas = [
      ...d.horas.map((h) => ({ fecha: d.fecha, hora: h.hora, precioEurKwh: h.precioEurKwh })),
      ...(domingo ? domingo.horas.map((h) => ({ fecha: domingoFecha, hora: h.hora, precioEurKwh: h.precioEurKwh })) : []),
    ];
    if (horas.length === 0) continue;

    const seleccion = seleccionaHorasMasBaratas(horas, energiaNecesariaSemanaKwh, potenciaCargaKw);
    resultado.push({ sabado: d.fecha, domingo: domingo ? domingoFecha : null, ...seleccion });
  }

  return resultado;
}

/**
 * Agrupa por mes los resultados de simulacionCargaFinesSemana (un registro
 * por fin de semana con datos), sumando el coste de cada finde al mes de su
 * sabado. Sirve para el grafico "gasto electrico real por mes" una vez
 * rellenado el historico de precios de fin de semana.
 * @param {Array<{sabado, costeTotal, precioMedioEurKwh}>} findes
 */
function agrupaFindesPorMes(findes) {
  const porMes = {};
  for (const f of findes) {
    if (f.precioMedioEurKwh == null) continue;
    const mes = f.sabado.slice(0, 7);
    porMes[mes] = porMes[mes] || { total: 0, findes: 0 };
    porMes[mes].total += f.costeTotal;
    porMes[mes].findes += 1;
  }
  return Object.entries(porMes)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([mes, v]) => ({ mes, real: Number(v.total.toFixed(2)), findes: v.findes }));
}

module.exports = {
  costeDiesel,
  segmentosSesion,
  costeSesionCarga,
  sumaDiasISO,
  evolucionMensual,
  diaSemanaUTC,
  diasLaborablesEntre,
  horasPermitidasEnDia,
  precioHistoricoPorDiaSemana,
  agrupaBloques,
  seleccionaHorasMasBaratas,
  simulacionCargaRestringida,
  simulacionCargaFinesSemana,
  agrupaFindesPorMes,
};
