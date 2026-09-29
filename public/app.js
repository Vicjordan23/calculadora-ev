const fmtEur = (n) => (n == null ? "—" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const fmtEur3 = (n) => (n == null ? "—" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €`);

let chartPrecios, chartEvolucionDiesel, chartEvolucionElectrico, chartComparativaMensual, chartAhorroAcumulado;
let ultimoPrecioDiesel = null;
let ultimoPlan = null;
let diaActual = "hoy";

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error de API");
  return data;
}

function horasRecomendadasParaFecha(fecha) {
  if (!ultimoPlan) return new Set();
  const opcion = ultimoPlan.recomendacion === "completa" ? ultimoPlan.opcionCargaCompleta : ultimoPlan.opcionSoloNecesario;
  if (!opcion) return new Set();
  return new Set(opcion.horasUsadas.filter((h) => (h.fecha || diaActualFecha("hoy")) === fecha).map((h) => h.hora));
}

function pintaGraficoHoras(canvasId, chartRef, horas, fecha) {
  const ctx = document.getElementById(canvasId);
  const labels = horas.map((h) => `${String(h.hora).padStart(2, "0")}h`);
  const valores = horas.map((h) => h.precioEurKwh);
  const recomendadas = horasRecomendadasParaFecha(fecha);
  const colores = horas.map((h) => (recomendadas.has(h.hora) ? "#4ae08c" : "#4ac0e0"));

  if (chartRef) chartRef.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "€/kWh", data: valores, backgroundColor: colores, borderRadius: 4 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" } },
        y: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" }, beginAtZero: true },
      },
    },
  });
}

function diaActualFecha(dia) {
  const d = new Date();
  if (dia === "ayer") d.setDate(d.getDate() - 1);
  if (dia === "manana") d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("sv-SE"); // formato YYYY-MM-DD en la zona horaria local del navegador
}

async function cargaGraficoDia(dia) {
  diaActual = dia;
  document.querySelectorAll(".dia-btn").forEach((btn) => btn.classList.toggle("activo", btn.dataset.dia === dia));

  const fecha = diaActualFecha(dia);
  const meta = document.getElementById("chart-precios-meta");
  try {
    const data = await api(`/electricity/prices?fecha=${fecha}`);
    chartPrecios = pintaGraficoHoras("chart-precios", chartPrecios, data.horas, fecha);
    meta.textContent = `PVPC ${fecha}`;
  } catch (err) {
    if (chartPrecios) {
      chartPrecios.destroy();
      chartPrecios = null;
    }
    const nombreDia = { ayer: "ayer", hoy: "hoy", manana: "mañana" }[dia] || dia;
    const razon = dia === "manana" ? "aún no se ha publicado (disponible sobre las 20:30)" : "no disponible";
    meta.textContent = `Precio de ${nombreDia} ${razon}.`;
  }
}

async function cargaResumen() {
  const data = await api("/summary");

  if (data.diesel) {
    document.getElementById("diesel-precio").textContent = fmtEur3(data.diesel.precioPorLitro);
    document.getElementById("diesel-meta").textContent = `Publicado: ${data.diesel.fechaPublicacion} · ${data.diesel.estaciones[0]?.direccion || "Ballenoil Guadalajara"}`;
    ultimoPrecioDiesel = data.diesel.precioPorLitro;
    const repPrecio = document.getElementById("rep-precio");
    if (repPrecio && !repPrecio.value) repPrecio.value = ultimoPrecioDiesel;
  }
  if (data.resumenDiesel) {
    document.getElementById("diesel-litros").textContent = `${data.resumenDiesel.litrosDia} L`;
    document.getElementById("diesel-dia").textContent = fmtEur(data.resumenDiesel.costeDia);
    document.getElementById("diesel-semana").textContent = fmtEur(data.resumenDiesel.costeSemana);
    document.getElementById("diesel-mes").textContent = fmtEur(data.resumenDiesel.costeMes);
    document.getElementById("diesel-anio").textContent = fmtEur(data.resumenDiesel.costeAnio);
  }

  if (data.resumenElectrico) {
    const r = data.resumenElectrico;
    document.getElementById("elec-precio").textContent = fmtEur3(r.precioMedioEurKwh);
    document.getElementById("elec-dia").textContent = fmtEur(r.costeDia);
    document.getElementById("elec-semana").textContent = fmtEur(r.costeSemana ?? r.costeDia * 7);
    document.getElementById("elec-mes").textContent = fmtEur(r.costeMes);
    document.getElementById("elec-anio").textContent = fmtEur(r.costeAnio);

    if (r.estrategia === "findes") {
      document.getElementById("elec-precio-label").textContent = "€/kWh medio cargando en tus fines de semana más baratos";
      document.getElementById("elec-kwh-label").textContent = "kWh/semana";
      document.getElementById("elec-kwh").textContent = `${r.kwhSemana} kWh`;
      document.getElementById("elec-extra-label").textContent = "Cubre la semana solo con el finde";
      document.getElementById("elec-extra").textContent = r.cubreSoloConFinde ? "✅ Sí" : `⚠️ Faltan ${r.remanenteKwh} kWh`;
      document.getElementById("elec-meta").textContent =
        `Carga concentrada el sáb/dom (batería del ${100 - r.bateriaMinPct}%→100% hasta el ${r.bateriaMinPct}%), ${r.diasConduccionSemana} días de conducción/semana` +
        (r.muestrasProyeccion > 0 ? ` · media de ${r.muestrasProyeccion} fin${r.muestrasProyeccion === 1 ? "" : "es"} de semana con datos` : " · aún sin datos de fines de semana");
      pintaSemanaCarga(r, data.settings.electrico);
    } else {
      document.getElementById("elec-precio-label").textContent = "€/kWh real cargando en las horas más baratas de hoy";
      document.getElementById("elec-kwh-label").textContent = "kWh/dia";
      document.getElementById("elec-kwh").textContent = `${r.kwhDia} kWh`;
      document.getElementById("elec-extra-label").textContent = "Horas de carga necesarias";
      document.getElementById("elec-extra").textContent = `~${r.horasNecesarias} h`;
      const m = r.muestrasProyeccion;
      document.getElementById("elec-meta").textContent =
        m > 1
          ? `€/día con el precio de hoy · mes/año con la media de tus mejores horas de ${m} días`
          : `PVPC ${data.electricidadHoy?.fecha || ""} · mes/año todavía con solo 1 día de histórico`;
      document.getElementById("panel-semana-carga").classList.add("oculto");
    }
  }

  if (data.ahorro) {
    document.getElementById("ahorro-anio").textContent = fmtEur(data.ahorro.anioEur);
    document.getElementById("ahorro-anio-tile").textContent = fmtEur(data.ahorro.anioEur);
    document.getElementById("ahorro-dia").textContent = fmtEur(data.ahorro.diaEur);
    document.getElementById("ahorro-mes").textContent = fmtEur(data.ahorro.mesEur);
    if (data.resumenDiesel && data.resumenElectrico) {
      const semanaEur = data.resumenDiesel.costeSemana - (data.resumenElectrico.costeSemana ?? data.resumenElectrico.costeDia * 7);
      document.getElementById("ahorro-semana").textContent = fmtEur(Number(semanaEur.toFixed(2)));
    }
  }

  // Ajustes: precarga los valores actuales
  const s = data.settings;
  document.getElementById("set-tiene-coche").checked = !!s.tieneCocheElectrico;
  aplicaVisibilidadTesla(!!s.tieneCocheElectrico);
  document.getElementById("set-dias-semana").value = s.diasConduccionSemana;
  document.getElementById("set-diesel-consumo").value = s.diesel.consumoL100km;
  document.getElementById("set-diesel-km").value = s.diesel.kmDiaMedio;
  document.getElementById("set-elec-consumo").value = s.electrico.consumoKwh100km;
  document.getElementById("set-elec-capacidad").value = s.electrico.capacidadBateriaKwh;
  document.getElementById("set-elec-km").value = s.electrico.kmDiaMedio;
  document.getElementById("set-elec-llegada").value = s.electrico.horaLlegadaCasa;
  document.getElementById("set-elec-salida").value = s.electrico.horaSalidaTrabajo;
  document.getElementById("set-elec-potencia").value = s.electrico.potenciaCargaKw;
  document.getElementById("set-elec-estrategia").value = s.electrico.estrategiaCarga;
  document.getElementById("set-elec-bateria-min").value = s.electrico.bateriaMinPct;
  document.getElementById("set-elec-carga-completa").checked = !!s.electrico.cargaCompletaFinde;
  document.getElementById("set-elec-cuota").value = s.electrico.cuotaMensual || "";
  document.getElementById("set-elec-cuota-desde").value = s.electrico.cuotaDesde || "";

  pintaAmortizacion(data.amortizacion, data.resumenDiesel);

  document.getElementById(
    "rec-hint"
  ).textContent = `Solo cuentan las horas en las que realmente podrías cargar en casa (de ${String(s.electrico.horaLlegadaCasa).padStart(2, "0")}:00 a ${String(s.electrico.horaSalidaTrabajo).padStart(2, "0")}:00 entre semana; el fin de semana entero), repartiendo la energía a ${s.electrico.potenciaCargaKw} kW — nunca se carga todo en una hora.`;
}

// Visualiza la semana tipo: bateria al 100% el lunes, bajando con cada dia
// de conduccion, y recarga completa el sabado/domingo con las horas reales
// del ultimo fin de semana con datos (no un ejemplo generico).
function pintaSemanaCarga(r, elecSettings) {
  const panel = document.getElementById("panel-semana-carga");
  if (!r.ultimoFinde) {
    panel.classList.add("oculto");
    return;
  }
  panel.classList.remove("oculto");

  const capacidad = elecSettings.capacidadBateriaKwh;
  const kwhDia = r.kwhDia;
  const diasConduccion = Math.min(r.diasConduccionSemana || 5, 5);
  const pctPorDia = capacidad > 0 ? (kwhDia / capacidad) * 100 : 0;

  const nombres = ["LUN", "MAR", "MIÉ", "JUE", "VIE"];
  let pct = 100;
  const dias = [];
  for (let i = 0; i < 5; i++) {
    dias.push({ nombre: nombres[i], pct: Math.max(0, Math.round(pct)), carga: false });
    if (i < diasConduccion) pct -= pctPorDia;
  }
  dias.push({ nombre: "SÁB ⚡", pct: 100, carga: true });
  dias.push({ nombre: "DOM ⚡", pct: 100, carga: true });

  // JS getDay(): 0=domingo..6=sabado -> indice en `dias` (0=lunes..6=domingo).
  const hoyIdx = [6, 0, 1, 2, 3, 4, 5][new Date().getDay()];
  if (hoyIdx < 5 && r.bateriaEstimadaPct != null) dias[hoyIdx].pct = r.bateriaEstimadaPct;

  const colorPara = (p, carga) => (carga ? "#4ae08c" : p <= 20 ? "#e0a24a" : p <= 50 ? "#4ac0e0" : "#4ae08c");

  document.getElementById("semana-tira").innerHTML = dias
    .map(
      (d, i) => `
    <div class="semana-dia${i === hoyIdx ? " hoy" : ""}">
      <div class="nombre">${d.nombre}${i === hoyIdx ? " · hoy" : ""}</div>
      <div class="semana-barra"><div class="relleno" style="height:${d.pct}%; background:${colorPara(d.pct, d.carga)};"></div></div>
      <div class="pct">${d.pct}%</div>
    </div>`
    )
    .join("");

  const bateriaHoyDiv = document.getElementById("bateria-hoy");
  if (r.bateriaEstimadaPct != null) {
    bateriaHoyDiv.innerHTML = `
      <span class="valor">🔋 ${r.bateriaEstimadaPct}%</span>
      <span class="detalle">estimada hoy · ${r.diasDesdeUltimaCarga} día${r.diasDesdeUltimaCarga === 1 ? "" : "s"} de conducción desde la última carga completa (no hay integración con el coche, es una estimación)</span>
    `;
  } else {
    bateriaHoyDiv.innerHTML = "";
  }

  // Aviso "toca cargar": solo tiene sentido viernes/sabado/domingo (que es
  // cuando de verdad se puede enchufar) y si la bateria estimada ya esta
  // baja -- entre semana no hay nada que hacer.
  const diaSemanaHoy = new Date().getDay(); // 0=dom, 5=vie, 6=sab
  const esFindeOVispera = diaSemanaHoy === 5 || diaSemanaHoy === 6 || diaSemanaHoy === 0;
  const avisoDiv = document.getElementById("aviso-carga");
  if (esFindeOVispera && r.bateriaEstimadaPct != null && r.bateriaEstimadaPct <= r.bateriaMinPct + 20) {
    avisoDiv.classList.remove("oculto");
    avisoDiv.innerHTML = `⚡ <strong>Te toca cargar este fin de semana.</strong> Batería estimada ~${r.bateriaEstimadaPct}%, previsión ~${fmtEur(r.costeSemana)} para llenarla al mejor precio.`;
  } else {
    avisoDiv.classList.add("oculto");
  }

  const f = r.ultimoFinde;
  document.getElementById("semana-resumen").innerHTML = `
    <div class="item"><span>Se carga</span><strong>${formatoBloques(f.bloques)}</strong></div>
    <div class="item"><span>Energía del último finde</span><strong>${f.kwh} kWh</strong></div>
    <div class="item"><span>Precio medio</span><strong>${fmtEur3(f.precioMedioEurKwh)}/kWh</strong></div>
    <div class="item"><span>Coste del finde</span><strong>${fmtEur(f.costeTotal)}</strong></div>
    <div class="item"><span>Previsión próximo finde</span><strong>${fmtEur(r.costeSemana)} <span style="font-weight:400;color:var(--text-dim);font-size:0.75em;">(media de ${r.muestrasProyeccion} finde${r.muestrasProyeccion === 1 ? "" : "s"})</span></strong></div>
  `;
}

// Coste real de TENER el electrico (cuota + luz) frente al ahorro "de
// combustible" de las tarjetas de arriba, que no tiene en cuenta la cuota.
function pintaAmortizacion(amortizacion, resumenDiesel) {
  const panel = document.getElementById("panel-amortizacion");
  if (!amortizacion) {
    panel.classList.add("oculto");
    return;
  }
  panel.classList.remove("oculto");

  const m = amortizacion.mensual;
  document.getElementById("amortizacion-mensual").innerHTML =
    m && resumenDiesel
      ? `
    <div class="comp-box diesel">
      <span>Diésel al mes (combustible)</span>
      <strong>${fmtEur(resumenDiesel.costeMes)}</strong>
    </div>
    <div class="comp-box electrico">
      <span>Cuota (${fmtEur(amortizacion.cuotaMensual)}) + luz al mes</span>
      <strong>${fmtEur(m.costeTotalMensualEv)}</strong>
    </div>
    <div class="comp-box ahorro">
      <span>Diferencia real al mes</span>
      <strong style="color:${m.diferenciaMensual >= 0 ? "var(--ahorro)" : "var(--danger)"}">${m.diferenciaMensual >= 0 ? "+" : ""}${fmtEur(m.diferenciaMensual)}</strong>
    </div>`
      : `<div class="fetch-meta">Aún sin datos suficientes para la proyección mensual.</div>`;

  const a = amortizacion.acumulado;
  if (a) {
    document.getElementById("amortizacion-meta").textContent = `Desde que pagas la cuota (${a.cuotaDesde}, ${a.diasTranscurridos} día${a.diasTranscurridos === 1 ? "" : "s"})`;
    document.getElementById("amortizacion-acumulado").innerHTML = `
      <div class="comp-box diesel"><span>Diésel real en ese periodo</span><strong>${fmtEur(a.dieselAcumulado)}</strong></div>
      <div class="comp-box electrico"><span>Cuota + luz real en ese periodo</span><strong>${fmtEur(a.costeTotalEvAcumulado)}</strong></div>
      <div class="comp-box ahorro"><span>Diferencia real acumulada</span><strong style="color:${a.diferenciaAcumulada >= 0 ? "var(--ahorro)" : "var(--danger)"}">${a.diferenciaAcumulada >= 0 ? "+" : ""}${fmtEur(a.diferenciaAcumulada)}</strong></div>
    `;
  } else {
    document.getElementById("amortizacion-meta").textContent = "Indica la fecha desde la que pagas la cuota en Ajustes para ver el acumulado real (de momento solo es la proyección mensual).";
    document.getElementById("amortizacion-acumulado").innerHTML = "";
  }
}

function aplicaVisibilidadTesla(tiene) {
  document.getElementById("seccion-cuando-tengas-tesla").classList.toggle("oculto", !tiene);
}

async function cargaComparativa() {
  const meta = document.getElementById("comp-meta");
  try {
    const data = await api("/comparativa");
    if (!data.hayDatos) {
      document.getElementById("comp-diesel").textContent = "—";
      document.getElementById("comp-tesla").textContent = "—";
      document.getElementById("comp-diferencia").textContent = "—";
      document.getElementById("comp-badge-pct").textContent = "—";
      meta.textContent = "Registra tu primer repostaje para empezar a ver la comparativa.";
      return;
    }

    document.getElementById("comp-diesel").textContent = fmtEur(data.costeDieselReal);
    document.getElementById("comp-tesla").textContent = data.costeTeslaEstimado != null ? fmtEur(data.costeTeslaEstimado) : "—";
    const diffEl = document.getElementById("comp-diferencia");
    if (data.diferencia != null) {
      diffEl.textContent = `${data.diferencia >= 0 ? "+" : ""}${fmtEur(data.diferencia)}`;
      diffEl.style.color = data.diferencia >= 0 ? "var(--ahorro)" : "var(--danger)";
    } else {
      diffEl.textContent = "—";
    }

    const pctBadge = document.getElementById("comp-badge-pct");
    if (data.costeTeslaEstimado != null && data.costeDieselReal > 0) {
      const pct = Math.round((1 - data.costeTeslaEstimado / data.costeDieselReal) * 100);
      pctBadge.textContent = `${pct}%`;
    } else {
      pctBadge.textContent = "—";
    }

    const esFindes = data.estrategiaCarga === "findes";
    const textoMuestras = esFindes
      ? `${data.muestrasPrecioElec} fin${data.muestrasPrecioElec === 1 ? "" : "es"} de semana`
      : `${data.muestrasPrecioElec} día${data.muestrasPrecioElec === 1 ? "" : "s"}`;
    const etiquetaReal = data.esCosteRealHistorico
      ? ` · <strong>coste real</strong> (no estimado): se ha sumado lo que costó cada fin de semana de verdad, ${data.coberturaFindesPct}% de findes con datos`
      : data.coberturaFindesPct != null
        ? ` · proyección (solo ${data.coberturaFindesPct}% de los findes de ese periodo tienen precio guardado)`
        : "";
    meta.innerHTML = `${data.numRepostajes} repostajes desde ${data.desde} hasta ${data.hasta} · ${data.totalLitros} L · ~${data.kmEstimados} km recorridos (estimado a partir de los litros comprados) · ${data.kwhEquivalente} kWh equivalentes${data.precioMedioEurKwh != null ? ` a ${fmtEur3(data.precioMedioEurKwh)}/kWh (media de cargar ${esFindes ? "concentrado en tus fines de semana más baratos" : "en tus horas más baratas"}${data.muestrasPrecioElec > 0 ? `, ${textoMuestras} de histórico` : ""})` : ""}${etiquetaReal}`;

    if (data.evolucionMensualElectricoReal && data.evolucionMensualElectricoReal.length > 0) {
      try {
        const dieselMensual = await api("/diesel/evolution");
        pintaGraficoComparativaMensual(dieselMensual, data.evolucionMensualElectricoReal);
        pintaGraficoAhorroAcumulado(dieselMensual, data.evolucionMensualElectricoReal);
      } catch (err) {
        /* silencioso: el hero ya tiene los totales */
      }
    }
  } catch (err) {
    meta.textContent = `No se pudo calcular: ${err.message}`;
  }
}

function pintaGraficoComparativaMensual(dieselMensual, electricoMensual) {
  const meses = [...new Set([...dieselMensual.map((d) => d.mes), ...electricoMensual.map((d) => d.mes)])].sort();
  const dieselPorMes = Object.fromEntries(dieselMensual.map((d) => [d.mes, d.real]));
  const electricoPorMes = Object.fromEntries(electricoMensual.map((d) => [d.mes, d.real]));

  const ctx = document.getElementById("chart-comparativa-mensual");
  if (chartComparativaMensual) chartComparativaMensual.destroy();
  chartComparativaMensual = new Chart(ctx, {
    type: "bar",
    data: {
      labels: meses,
      datasets: [
        { label: "Diésel real", data: meses.map((m) => dieselPorMes[m] ?? null), backgroundColor: "#e0a24a", borderRadius: 4 },
        { label: "Eléctrico real (findes)", data: meses.map((m) => electricoPorMes[m] ?? null), backgroundColor: "#4ac0e0", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, labels: { color: "#9aa1ac" } } },
      scales: {
        x: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" } },
        y: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" }, beginAtZero: true },
      },
    },
  });
}

function pintaGraficoAhorroAcumulado(dieselMensual, electricoMensual) {
  const meses = [...new Set([...dieselMensual.map((d) => d.mes), ...electricoMensual.map((d) => d.mes)])].sort();
  const dieselPorMes = Object.fromEntries(dieselMensual.map((d) => [d.mes, d.real]));
  const electricoPorMes = Object.fromEntries(electricoMensual.map((d) => [d.mes, d.real]));

  let acumulado = 0;
  const serie = meses.map((m) => {
    acumulado += (dieselPorMes[m] ?? 0) - (electricoPorMes[m] ?? 0);
    return Number(acumulado.toFixed(2));
  });

  const ctx = document.getElementById("chart-ahorro-acumulado");
  if (chartAhorroAcumulado) chartAhorroAcumulado.destroy();
  chartAhorroAcumulado = new Chart(ctx, {
    type: "line",
    data: {
      labels: meses,
      datasets: [
        {
          label: "Ahorro acumulado",
          data: serie,
          borderColor: "#4ae08c",
          backgroundColor: "rgba(74, 224, 140, 0.15)",
          fill: true,
          tension: 0.25,
          pointBackgroundColor: "#4ae08c",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" } },
        y: { ticks: { color: "#9aa1ac", callback: (v) => `${v} €` }, grid: { color: "#2a2f3a" } },
      },
    },
  });
}

const DIAS_SEMANA_CORTO_MIN = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

// Etiqueta cada bloque con "hoy"/"mañana" cuando aplica (planificador a corto
// plazo) o con el día+fecha real en cualquier otro caso (p.ej. un fin de
// semana ya pasado) -- antes cualquier fecha que no fuera hoy salía como
// "mañana", lo que confundía en bloques historicos.
function formatoBloques(bloques) {
  if (!bloques || bloques.length === 0) return "sin horas disponibles";
  const hoyStr = new Date().toISOString().slice(0, 10);
  const mananaStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let fechaAnterior = null;
  return bloques
    .map((b) => {
      const cambiaDia = b.fecha && b.fecha !== fechaAnterior;
      fechaAnterior = b.fecha;
      let dia = "";
      if (cambiaDia && b.fecha) {
        if (b.fecha === hoyStr) dia = "hoy ";
        else if (b.fecha === mananaStr) dia = "mañana ";
        else {
          const d = new Date(b.fecha + "T00:00:00");
          dia = `${DIAS_SEMANA_CORTO_MIN[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} `;
        }
      }
      const ini = String(b.horaInicio).padStart(2, "0");
      const fin = String(b.horaFin % 24).padStart(2, "0");
      return `${dia}de ${ini}:00 a ${fin}:00`;
    })
    .join(" y ");
}

function tarjetaOpcion({ titulo, opcion, recomendada, extra }) {
  if (!opcion || opcion.horasUsadas.length === 0) {
    return `<div class="plan-opcion"><h3>${titulo}</h3><div class="detalle-linea">Sin horas disponibles todavía dentro de tu ventana.</div></div>`;
  }
  const aviso = opcion.coberturaPct < 100 ? `<div class="detalle-linea">⚠️ Solo cubre el ${opcion.coberturaPct}% de la energía con las horas disponibles ahora mismo.</div>` : "";
  return `
    <div class="plan-opcion${recomendada ? " recomendada" : ""}">
      ${recomendada ? '<div class="badge">✅ Recomendado</div>' : ""}
      <h3>${titulo}</h3>
      <div class="precio-grande">${fmtEur3(opcion.precioMedioEurKwh)}/kWh</div>
      <div class="detalle-linea">${opcion.energiaCubiertaKwh} kWh · ~${opcion.horasNecesarias} h de carga · ${fmtEur(opcion.costeTotal)} total</div>
      ${extra || ""}
      ${aviso}
      <div class="horas-lista">🔌 Enchufa ${formatoBloques(opcion.bloques)}</div>
    </div>
  `;
}

let mananaPollTimer = null;
let mananaPollIntentos = 0;
const MANANA_POLL_INTERVALO_MS = 60000;
const MANANA_POLL_MAX_INTENTOS = 180; // hasta ~3 h, pero solo dentro de la ventana 20:00-23:59
const INICIO_PUBLICACION_MIN = 20 * 60; // REE publica los precios de mañana sobre las 20:15-20:45

// Minutos desde medianoche en hora de España (no la del navegador), para que
// la ventana de comprobacion sea correcta aunque el movil este en otra zona.
function minutosEnMadrid() {
  const partes = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(partes.find((p) => p.type === "hour").value) * 60 + Number(partes.find((p) => p.type === "minute").value);
}

async function recomendar(bateriaActualPct, esReintento = false) {
  if (mananaPollTimer) {
    clearTimeout(mananaPollTimer);
    mananaPollTimer = null;
  }
  if (!esReintento) mananaPollIntentos = 0;

  const resultado = document.getElementById("recomendacion-resultado");
  if (!esReintento) resultado.innerHTML = "Calculando...";
  try {
    const data = await api(`/recommend?bateriaActualPct=${bateriaActualPct}`);

    let html = "";
    if (!data.mananaDisponible) {
      html += `<div class="recomendacion"><div class="warn">⚠️ <strong>Provisional hasta las 20:30.</strong> ${data.avisoManana}</div></div>`;
      const ahora = minutosEnMadrid();
      if (ahora < INICIO_PUBLICACION_MIN) {
        // Antes de las 20:00 no hay nada que comprobar: REE aun no ha publicado.
        // Se programa una unica comprobacion para cuando empiece la ventana.
        html += `<div class="recomendacion"><div class="fetch-meta">⏳ Los precios de mañana se publican sobre las 20:30. Si dejas esta página abierta, empezará a comprobarlo sola a partir de las 20:00.</div></div>`;
        mananaPollTimer = setTimeout(() => recomendar(bateriaActualPct, true), (INICIO_PUBLICACION_MIN - ahora) * 60000 + 5000);
      } else if (mananaPollIntentos < MANANA_POLL_MAX_INTENTOS) {
        mananaPollIntentos++;
        html += `<div class="recomendacion"><div class="fetch-meta">🔄 Comprobando cada minuto si ya se han publicado los precios de mañana (intento ${mananaPollIntentos})… deja esta página abierta.</div></div>`;
        mananaPollTimer = setTimeout(() => recomendar(bateriaActualPct, true), MANANA_POLL_INTERVALO_MS);
      }
    }

    if (data.tipEsperarFinde) {
      const t = data.tipEsperarFinde;
      html += `<div class="recomendacion tip-finde">
        🗓️ <strong>Probablemente te compense esperar al fin de semana.</strong>
        Los últimos ${t.muestras} sábados/domingos han costado de media ${fmtEur3(t.precioEstimadoFinde)}/kWh,
        frente a ${fmtEur3(t.precioActual)}/kWh ahora. Con tu batería actual aguantas ~${t.diasAutonomia} día(s) sin cargar,
        y solo faltan ${t.diasHastaSabado} para el sábado — no haría falta cargar nada hasta entonces.
      </div>`;
    }

    html += `<div class="plan-opciones">
      ${tarjetaOpcion({
        titulo: "Solo lo justo para mañana",
        opcion: data.opcionSoloNecesario,
        recomendada: data.recomendacion === "solo-necesario",
      })}
      ${tarjetaOpcion({
        titulo: `Cargar al máximo ahora (hasta 100%)`,
        opcion: data.opcionCargaCompleta,
        recomendada: data.recomendacion === "completa",
        extra: data.diasQueCubre ? `<div class="detalle-linea">Cubriría ~${data.diasQueCubre} ${data.diasQueCubre === 1 ? "día" : "días"} de conducción</div>` : "",
      })}
    </div>`;

    resultado.innerHTML = html;
    ultimoPlan = data;
    cargaGraficoDia(diaActual); // repinta el grafico activo con las horas recomendadas resaltadas
  } catch (err) {
    resultado.innerHTML = `<div class="recomendacion"><div class="err">${err.message}</div></div>`;
  }
}

function calculaEstadisticasCargas(chargesAsc) {
  const ahora = new Date();
  const mesActual = ahora.getMonth();
  const anioActual = ahora.getFullYear();
  let totalMes = 0;
  let totalAnio = 0;
  chargesAsc.forEach((c) => {
    const d = new Date(c.fecha + "T00:00:00");
    if (d.getFullYear() === anioActual) {
      totalAnio += c.costeTotal;
      if (d.getMonth() === mesActual) totalMes += c.costeTotal;
    }
  });
  return { totalMes: Number(totalMes.toFixed(2)), totalAnio: Number(totalAnio.toFixed(2)) };
}

async function cargaTablaCargas() {
  const charges = await api("/charges");

  const stats = calculaEstadisticasCargas(charges);
  document.getElementById("elec-real-mes").textContent = fmtEur(stats.totalMes);
  document.getElementById("elec-real-anio").textContent = fmtEur(stats.totalAnio);

  const tbody = document.querySelector("#tabla-cargas tbody");
  tbody.innerHTML = "";
  charges
    .slice()
    .reverse()
    .forEach((c) => {
      const tipoTexto = c.tipo === "fuera" ? `Fuera${c.proveedor ? ` (${c.proveedor})` : ""}` : "Casa (PVPC)";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.fecha}</td>
        <td>${tipoTexto}</td>
        <td>${c.kwhCargados} kWh</td>
        <td>${fmtEur(c.costeTotal)}</td>
        <td>${c.precioMedioEurKwh != null ? fmtEur3(c.precioMedioEurKwh) : "—"}</td>
        <td><button data-id="${c.id}">✕</button></td>
      `;
      tbody.appendChild(tr);
    });

  tbody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/charges/${btn.dataset.id}`, { method: "DELETE" });
      cargaTablaCargas();
    });
  });
}

function calculaEstadisticasRepostajes(fillsAsc) {
  const ahora = new Date();
  const mesActual = ahora.getMonth();
  const anioActual = ahora.getFullYear();

  let totalMes = 0;
  let totalAnio = 0;
  let litrosParaConsumo = 0;
  let kmParaConsumo = 0;

  fillsAsc.forEach((f, i) => {
    const d = new Date(f.fecha + "T00:00:00");
    if (d.getFullYear() === anioActual) {
      totalAnio += f.costeTotal;
      if (d.getMonth() === mesActual) totalMes += f.costeTotal;
    }

    if (i > 0 && f.kmOdometro != null && fillsAsc[i - 1].kmOdometro != null) {
      const deltaKm = f.kmOdometro - fillsAsc[i - 1].kmOdometro;
      if (deltaKm > 0) {
        f.consumoRealL100km = Number(((f.litros / deltaKm) * 100).toFixed(2));
        litrosParaConsumo += f.litros;
        kmParaConsumo += deltaKm;
      }
    }
  });

  const consumoRealMedio = kmParaConsumo > 0 ? Number(((litrosParaConsumo / kmParaConsumo) * 100).toFixed(2)) : null;

  return {
    totalMes: Number(totalMes.toFixed(2)),
    totalAnio: Number(totalAnio.toFixed(2)),
    numRepostajes: fillsAsc.length,
    consumoRealMedio,
  };
}

let mostrarTodosRepostajes = false;

async function cargaTablaRepostajes() {
  const fillsAsc = await api("/diesel/fills"); // viene ordenado por fecha ascendente
  const stats = calculaEstadisticasRepostajes(fillsAsc);

  document.getElementById("diesel-real-mes").textContent = fmtEur(stats.totalMes);
  document.getElementById("diesel-real-anio").textContent = fmtEur(stats.totalAnio);

  document.getElementById("stats-repostajes").innerHTML = `
    <div class="stat-box"><span>Repostajes registrados</span><strong>${stats.numRepostajes}</strong></div>
    <div class="stat-box"><span>Gastado este mes</span><strong>${fmtEur(stats.totalMes)}</strong></div>
    <div class="stat-box"><span>Gastado este año</span><strong>${fmtEur(stats.totalAnio)}</strong></div>
    <div class="stat-box"><span>Consumo real medio</span><strong>${stats.consumoRealMedio != null ? stats.consumoRealMedio + " L/100km" : "— (falta km)"}</strong></div>
  `;

  const btnToggle = document.getElementById("btn-toggle-repostajes");
  const LIMITE = 5;
  btnToggle.style.display = fillsAsc.length > LIMITE ? "inline-block" : "none";
  btnToggle.textContent = mostrarTodosRepostajes ? "Ver menos" : `Ver todos (${fillsAsc.length})`;

  const tbody = document.querySelector("#tabla-repostajes tbody");
  tbody.innerHTML = "";
  const paraMostrar = fillsAsc.slice().reverse();
  (mostrarTodosRepostajes ? paraMostrar : paraMostrar.slice(0, LIMITE)).forEach((f) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${f.fecha}</td>
        <td>${f.litros} L</td>
        <td>${fmtEur3(f.precioPorLitro)}</td>
        <td>${fmtEur(f.costeTotal)}</td>
        <td>${f.kmOdometro ?? "—"}</td>
        <td>${f.consumoRealL100km != null ? f.consumoRealL100km + " L/100km" : "—"}</td>
        <td><button data-id="${f.id}">✕</button></td>
      `;
      tbody.appendChild(tr);
    });

  tbody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/diesel/fills/${btn.dataset.id}`, { method: "DELETE" });
      cargaTablaRepostajes();
      cargaComparativa();
    });
  });
}

function initFormularios() {
  document.getElementById("carga-fecha").value = new Date().toISOString().slice(0, 10);
  document.getElementById("rep-fecha").value = new Date().toISOString().slice(0, 10);
  if (ultimoPrecioDiesel) document.getElementById("rep-precio").value = ultimoPrecioDiesel;

  document.getElementById("btn-refresh-diesel").addEventListener("click", async (e) => {
    e.preventDefault();
    await api("/diesel/refresh", { method: "POST" });
    cargaResumen();
  });

  document.getElementById("btn-refresh-elec").addEventListener("click", async (e) => {
    e.preventDefault();
    await api("/electricity/refresh", { method: "POST" });
    cargaResumen();
  });

  document.getElementById("form-recomendar").addEventListener("submit", (e) => {
    e.preventDefault();
    recomendar(document.getElementById("rec-bateria").value);
  });

  document.querySelectorAll(".dia-btn").forEach((btn) => {
    btn.addEventListener("click", () => cargaGraficoDia(btn.dataset.dia));
  });

  document.getElementById("btn-toggle-repostajes").addEventListener("click", (e) => {
    e.preventDefault();
    mostrarTodosRepostajes = !mostrarTodosRepostajes;
    cargaTablaRepostajes();
  });

  document.getElementById("btn-toggle-simulacion").addEventListener("click", (e) => {
    e.preventDefault();
    mostrarTodosSimulacion = !mostrarTodosSimulacion;
    cargaSimulacion();
  });

  document.getElementById("set-tiene-coche").addEventListener("change", (e) => {
    aplicaVisibilidadTesla(e.target.checked);
  });

  document.querySelectorAll('input[name="carga-tipo"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const esFuera = document.querySelector('input[name="carga-tipo"]:checked').value === "fuera";
      document.getElementById("campos-carga-casa").style.display = esFuera ? "none" : "grid";
      document.getElementById("campos-carga-fuera").style.display = esFuera ? "grid" : "none";
    });
  });

  document.getElementById("form-carga").addEventListener("submit", async (e) => {
    e.preventDefault();
    const resultado = document.getElementById("carga-resultado");
    const tipo = document.querySelector('input[name="carga-tipo"]:checked').value;

    const body = {
      fecha: document.getElementById("carga-fecha").value,
      tipo,
      bateriaAntesPct: document.getElementById("carga-bat-antes").value || null,
      bateriaDespuesPct: document.getElementById("carga-bat-despues").value || null,
      kwhCargados: document.getElementById("carga-kwh").value || null,
    };

    if (tipo === "fuera") {
      body.proveedor = document.getElementById("carga-proveedor").value || null;
      body.precioMedioEurKwh = document.getElementById("carga-precio-manual").value || null;
      body.costeTotal = document.getElementById("carga-total-manual").value || null;
    } else {
      body.horaInicio = Number(document.getElementById("carga-hora").value);
      body.duracionHoras = Number(document.getElementById("carga-duracion").value);
    }

    try {
      const registro = await api("/charges", { method: "POST", body: JSON.stringify(body) });
      resultado.innerHTML = `<div class="ok">Guardado: ${registro.kwhCargados} kWh · coste ${fmtEur(registro.costeTotal)}${registro.coberturaDatos != null ? ` (cobertura de datos: ${registro.coberturaDatos}%)` : ""}</div>`;
      e.target.reset();
      document.getElementById("carga-fecha").value = new Date().toISOString().slice(0, 10);
      document.getElementById("campos-carga-casa").style.display = "grid";
      document.getElementById("campos-carga-fuera").style.display = "none";
      cargaTablaCargas();
    } catch (err) {
      resultado.innerHTML = `<div class="err">${err.message}</div>`;
    }
  });

  document.getElementById("form-repostaje").addEventListener("submit", async (e) => {
    e.preventDefault();
    const resultado = document.getElementById("repostaje-resultado");
    const body = {
      fecha: document.getElementById("rep-fecha").value,
      litros: Number(document.getElementById("rep-litros").value),
      precioPorLitro: document.getElementById("rep-precio").value || null,
      costeTotal: document.getElementById("rep-total").value || null,
      kmOdometro: document.getElementById("rep-km").value || null,
      estacion: document.getElementById("rep-estacion").value || null,
    };
    try {
      const registro = await api("/diesel/fills", { method: "POST", body: JSON.stringify(body) });
      resultado.innerHTML = `<div class="ok">Guardado: ${registro.litros} L a ${fmtEur3(registro.precioPorLitro)}/L · total ${fmtEur(registro.costeTotal)}</div>`;
      e.target.reset();
      document.getElementById("rep-fecha").value = new Date().toISOString().slice(0, 10);
      if (ultimoPrecioDiesel) document.getElementById("rep-precio").value = ultimoPrecioDiesel;
      cargaTablaRepostajes();
      cargaComparativa();
    } catch (err) {
      resultado.innerHTML = `<div class="err">${err.message}</div>`;
    }
  });

  document.getElementById("form-ajustes").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cuotaMensualVal = Number(document.getElementById("set-elec-cuota").value) || 0;
    const cuotaDesdeInput = document.getElementById("set-elec-cuota-desde").value;
    // Si activas la cuota sin fijar fecha, se asume que empieza hoy (para no
    // arrastrar meses anteriores en los que aun no se pagaba).
    const cuotaDesdeVal = cuotaMensualVal > 0 ? cuotaDesdeInput || new Date().toISOString().slice(0, 10) : null;
    await api("/settings", {
      method: "POST",
      body: JSON.stringify({
        tieneCocheElectrico: document.getElementById("set-tiene-coche").checked,
        diasConduccionSemana: Number(document.getElementById("set-dias-semana").value),
        diesel: {
          consumoL100km: Number(document.getElementById("set-diesel-consumo").value),
          kmDiaMedio: Number(document.getElementById("set-diesel-km").value),
        },
        electrico: {
          consumoKwh100km: Number(document.getElementById("set-elec-consumo").value),
          capacidadBateriaKwh: Number(document.getElementById("set-elec-capacidad").value),
          kmDiaMedio: Number(document.getElementById("set-elec-km").value),
          horaLlegadaCasa: Number(document.getElementById("set-elec-llegada").value),
          horaSalidaTrabajo: Number(document.getElementById("set-elec-salida").value),
          potenciaCargaKw: Number(document.getElementById("set-elec-potencia").value),
          estrategiaCarga: document.getElementById("set-elec-estrategia").value,
          bateriaMinPct: Number(document.getElementById("set-elec-bateria-min").value),
          cargaCompletaFinde: document.getElementById("set-elec-carga-completa").checked,
          cuotaMensual: cuotaMensualVal,
          cuotaDesde: cuotaDesdeVal,
        },
      }),
    });
    cargaResumen();
  });

  document.getElementById("btn-export-backup").addEventListener("click", async (e) => {
    e.preventDefault();
    const btn = e.target;
    const textoOriginal = btn.textContent;
    btn.textContent = "Generando…";
    btn.disabled = true;
    try {
      const data = await api("/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `calculadora-ev-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      btn.textContent = textoOriginal;
      btn.disabled = false;
    }
  });

  document.getElementById("btn-csv-repostajes").addEventListener("click", async (e) => {
    e.preventDefault();
    const fills = await api("/diesel/fills");
    descargaCSV(
      "repostajes-diesel.csv",
      fills,
      ["fecha", "litros", "precioPorLitro", "costeTotal", "kmOdometro", "estacion"],
      ["Fecha", "Litros", "Precio/L", "Coste total", "Km", "Gasolinera"]
    );
  });

  document.getElementById("btn-csv-cargas").addEventListener("click", async (e) => {
    e.preventDefault();
    const charges = await api("/charges");
    descargaCSV(
      "cargas-electrico.csv",
      charges,
      ["fecha", "tipo", "proveedor", "horaInicio", "duracionHoras", "kwhCargados", "costeTotal", "precioMedioEurKwh"],
      ["Fecha", "Tipo", "Proveedor", "Hora inicio", "Duración (h)", "kWh", "Coste total", "€/kWh medio"]
    );
  });
}

function descargaCSV(nombreArchivo, filas, campos, cabeceras) {
  const escapa = (v) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",;\n]/.test(s) ? `"${s}"` : s;
  };
  const lineas = [cabeceras.join(";"), ...filas.map((f) => campos.map((c) => escapa(f[c])).join(";"))];
  const blob = new Blob([lineas.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function coloresEvolucion() {
  return { real: "#e0a24a", teorico: "#4a5568" };
}

function pintaGraficoEvolucion(canvasId, chartRef, datos, colorReal) {
  const ctx = document.getElementById(canvasId);
  const labels = datos.map((d) => d.mes);
  const { teorico } = coloresEvolucion();

  if (chartRef) chartRef.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Real", data: datos.map((d) => d.real), backgroundColor: colorReal, borderRadius: 4 },
        { label: "Estimado (teórico)", data: datos.map((d) => d.teorico), backgroundColor: teorico, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, labels: { color: "#9aa1ac" } } },
      scales: {
        x: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" } },
        y: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" }, beginAtZero: true },
      },
    },
  });
}

async function cargaEvolucion() {
  try {
    const dataDiesel = await api("/diesel/evolution");
    chartEvolucionDiesel = pintaGraficoEvolucion("chart-evolucion-diesel", chartEvolucionDiesel, dataDiesel, "#e0a24a");
  } catch (err) {
    /* silencioso: sin datos suficientes */
  }
  try {
    const dataElectrico = await api("/electricity/evolution");
    chartEvolucionElectrico = pintaGraficoEvolucion("chart-evolucion-electrico", chartEvolucionElectrico, dataElectrico, "#4ac0e0");
  } catch (err) {
    /* silencioso */
  }
}

const DIAS_SEMANA_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

let mostrarTodosSimulacion = false;

async function cargaSimulacion() {
  try {
    const data = await api("/electricity/simulation");
    const esFindes = data.modo === "findes";

    document.getElementById("tabla-simulacion-titulo").textContent = esFindes
      ? "💡 Lo que habría costado cargar el Tesla cada fin de semana"
      : "💡 Lo que habría costado cargar el Tesla en casa";
    document.getElementById("tabla-simulacion-hint").textContent = esFindes
      ? "Un solo evento de carga por fin de semana (sábado+domingo juntos, no la media de un día suelto), hasta tu batería objetivo, con los precios PVPC reales de ese finde en concreto. Entre semana no se carga (si registras una carga manual entre semana, esa sí usa el precio real de ese día, pero esta tabla automática no se lo inventa)."
      : "Simulación día a día con los precios PVPC reales y tu ventana de carga real (no cuando quieras, sino cuando de verdad podrías enchufar el coche). Se va acumulando cada día que pasa.";

    document.getElementById("stats-simulacion").innerHTML = `
      <div class="stat-box"><span>${esFindes ? "Fines de semana simulados" : "Días simulados"}</span><strong>${data.totalDias}</strong></div>
      <div class="stat-box"><span>Coste simulado total</span><strong>${fmtEur(data.totalCoste)}</strong></div>
      <div class="stat-box"><span>${esFindes ? "Media por finde" : "Media por día"}</span><strong>${fmtEur(data.costeMedioDia)}</strong></div>
      <div class="stat-box"><span>Diésel real en el mismo periodo</span><strong>${data.gastoDieselMismoPeriodo != null ? fmtEur(data.gastoDieselMismoPeriodo) : "— (sin repostajes en ese rango)"}</strong></div>
    `;

    const theadFecha = document.getElementById("tabla-simulacion-th-fecha");
    const theadKwh = document.getElementById("tabla-simulacion-th-kwh");
    if (theadFecha) theadFecha.textContent = esFindes ? "Fin de semana" : "Fecha";
    if (theadKwh) theadKwh.textContent = esFindes ? "kWh cargados" : "kWh";

    const LIMITE = esFindes ? 4 : Infinity;
    const btnToggle = document.getElementById("btn-toggle-simulacion");
    btnToggle.style.display = data.dias.length > LIMITE ? "inline-block" : "none";
    btnToggle.textContent = mostrarTodosSimulacion ? "Ver menos" : `Ver todos (${data.dias.length})`;

    const tbody = document.querySelector("#tabla-simulacion tbody");
    tbody.innerHTML = "";
    const paraMostrar = data.dias.slice().reverse();
    (mostrarTodosSimulacion ? paraMostrar : paraMostrar.slice(0, LIMITE)).forEach((d) => {
        const tr = document.createElement("tr");
        if (esFindes) {
          const fmtDiaMes = (iso) => {
            const dt = new Date(iso + "T00:00:00Z");
            return `${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
          };
          tr.innerHTML = `
            <td>${fmtDiaMes(d.fecha)}–${fmtDiaMes(d.fechaFin)} 🏖️</td>
            <td>—</td>
            <td>${d.energiaCubiertaKwh} kWh</td>
            <td>${fmtEur(d.costeTotal)}</td>
            <td>${d.precioMedioEurKwh != null ? fmtEur3(d.precioMedioEurKwh) : "—"}</td>
            <td>${formatoBloques(d.bloques)}</td>
          `;
        } else {
          const diaSemana = DIAS_SEMANA_CORTO[new Date(d.fecha + "T00:00:00Z").getUTCDay()];
          tr.innerHTML = `
            <td>${d.fecha}</td>
            <td>${diaSemana}${d.esFinde ? " 🏖️" : ""}</td>
            <td>${d.energiaNecesariaKwh} kWh</td>
            <td>${fmtEur(d.costeTotal)}</td>
            <td>${d.precioMedioEurKwh != null ? fmtEur3(d.precioMedioEurKwh) : "—"}</td>
            <td>${formatoBloques(d.bloques)}</td>
          `;
        }
        tbody.appendChild(tr);
      });
  } catch (err) {
    document.getElementById("stats-simulacion").innerHTML = `<div class="stat-box"><span>Simulación</span><strong>Aún sin datos suficientes</strong></div>`;
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

initFormularios();
cargaResumen();
cargaComparativa();
cargaGraficoDia("hoy");
cargaTablaCargas();
cargaTablaRepostajes();
cargaEvolucion();
recomendar(document.getElementById("rec-bateria").value);
cargaSimulacion();
