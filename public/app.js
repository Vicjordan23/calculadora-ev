const fmtEur = (n) => (n == null ? "—" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const fmtEur3 = (n) => (n == null ? "—" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €`);

let chartHoy, chartManana, chartEvolucionDiesel, chartEvolucionElectrico;
let ultimoPrecioDiesel = null;

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error de API");
  return data;
}

function pintaGraficoHoras(canvasId, chartRef, horas, colorHex) {
  const ctx = document.getElementById(canvasId);
  const labels = horas.map((h) => `${String(h.hora).padStart(2, "0")}h`);
  const valores = horas.map((h) => h.precioEurKwh);

  if (chartRef) chartRef.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "€/kWh", data: valores, backgroundColor: colorHex, borderRadius: 4 }],
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

async function cargaResumen() {
  const data = await api("/summary");

  if (data.diesel) {
    document.getElementById("diesel-precio").textContent = fmtEur3(data.diesel.precioPorLitro);
    document.getElementById("diesel-meta").textContent = `Publicado: ${data.diesel.fechaPublicacion} · ${data.diesel.estaciones.length} estaciones`;
    ultimoPrecioDiesel = data.diesel.precioPorLitro;
    const repPrecio = document.getElementById("rep-precio");
    if (repPrecio && !repPrecio.value) repPrecio.value = ultimoPrecioDiesel;
  }
  if (data.resumenDiesel) {
    document.getElementById("diesel-litros").textContent = `${data.resumenDiesel.litrosDia} L`;
    document.getElementById("diesel-dia").textContent = fmtEur(data.resumenDiesel.costeDia);
    document.getElementById("diesel-mes").textContent = fmtEur(data.resumenDiesel.costeMes);
    document.getElementById("diesel-anio").textContent = fmtEur(data.resumenDiesel.costeAnio);
  }

  if (data.electricidadHoy) {
    document.getElementById("elec-precio").textContent = fmtEur3(data.electricidadHoy.precioMedioEurKwh);
    document.getElementById("elec-meta").textContent = `PVPC ${data.electricidadHoy.fecha}`;
    chartHoy = pintaGraficoHoras("chart-hoy", chartHoy, data.electricidadHoy.horas, "#4ac0e0");
  }
  if (data.resumenElectrico) {
    document.getElementById("elec-kwh").textContent = `${data.resumenElectrico.kwhDia} kWh`;
    document.getElementById("elec-dia").textContent = fmtEur(data.resumenElectrico.costeDia);
    document.getElementById("elec-mes").textContent = fmtEur(data.resumenElectrico.costeMes);
    document.getElementById("elec-anio").textContent = fmtEur(data.resumenElectrico.costeAnio);
  }

  if (data.ahorro) {
    document.getElementById("ahorro-anio").textContent = fmtEur(data.ahorro.anioEur);
    document.getElementById("ahorro-dia").textContent = fmtEur(data.ahorro.diaEur);
    document.getElementById("ahorro-mes").textContent = fmtEur(data.ahorro.mesEur);
  }

  // Ajustes: precarga los valores actuales
  const s = data.settings;
  document.getElementById("set-diesel-consumo").value = s.diesel.consumoL100km;
  document.getElementById("set-diesel-km").value = s.diesel.kmDiaMedio;
  document.getElementById("set-elec-consumo").value = s.electrico.consumoKwh100km;
  document.getElementById("set-elec-capacidad").value = s.electrico.capacidadBateriaKwh;
  document.getElementById("set-elec-km").value = s.electrico.kmDiaMedio;
  document.getElementById("set-elec-horas").value = s.electrico.horasCargaHabitual;
  document.getElementById("set-notif-dias").value = s.notificaciones.avisoStaleDias;
  document.getElementById("set-notif-umbral").value = s.notificaciones.umbralAnomaliaPct;
  const recDuracion = document.getElementById("rec-duracion");
  if (!recDuracion.dataset.tocado) recDuracion.value = s.electrico.horasCargaHabitual;
}

async function cargaGraficoManana() {
  try {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const fecha = manana.toISOString().slice(0, 10);
    const data = await api(`/electricity/prices?fecha=${fecha}`);
    document.getElementById("panel-manana").style.display = "block";
    chartManana = pintaGraficoHoras("chart-manana", chartManana, data.horas, "#6d8dff");
  } catch (err) {
    document.getElementById("panel-manana").style.display = "none";
  }
}

function formatoVentana(v) {
  if (!v) return "";
  const inicio = `${String(v.inicio.hora).padStart(2, "0")}:00 (${v.inicio.fecha})`;
  const fin = `${String((v.fin.hora + 1) % 24).padStart(2, "0")}:00`;
  return `de ${inicio} a ${fin} · precio medio ${fmtEur3(v.precioMedioEurKwh)}/kWh`;
}

async function recomendar(duracionHoras) {
  const resultado = document.getElementById("recomendacion-resultado");
  resultado.innerHTML = "Calculando...";
  try {
    const data = await api(`/recommend?duracionHoras=${duracionHoras}`);
    let html = "";
    if (data.recomendacionConManana) {
      html += `<div class="ok">✅ Mejor franja disponible: ${formatoVentana(data.recomendacionConManana)}</div>`;
    }
    if (!data.mananaDisponible) {
      html += `<div class="warn">ℹ️ ${data.avisoManana}</div>`;
      if (data.recomendacionHoy) {
        html += `<div>Dentro de las horas que quedan hoy: ${formatoVentana(data.recomendacionHoy)}</div>`;
      }
    }
    if (!data.recomendacionConManana) {
      html = `<div class="err">No hay suficientes horas de datos para una ventana de ${duracionHoras}h todavía.</div>`;
    }
    resultado.innerHTML = html;
  } catch (err) {
    resultado.innerHTML = `<div class="err">${err.message}</div>`;
  }
}

async function cargaTablaCargas() {
  const charges = await api("/charges");
  const tbody = document.querySelector("#tabla-cargas tbody");
  tbody.innerHTML = "";
  charges
    .slice()
    .reverse()
    .forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.fecha}</td>
        <td>${String(c.horaInicio).padStart(2, "0")}:00</td>
        <td>${c.duracionHoras} h</td>
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

  const tbody = document.querySelector("#tabla-repostajes tbody");
  tbody.innerHTML = "";
  fillsAsc
    .slice()
    .reverse()
    .forEach((f) => {
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
    const duracion = document.getElementById("rec-duracion").value;
    recomendar(duracion);
  });

  document.getElementById("form-carga").addEventListener("submit", async (e) => {
    e.preventDefault();
    const resultado = document.getElementById("carga-resultado");
    const body = {
      fecha: document.getElementById("carga-fecha").value,
      horaInicio: Number(document.getElementById("carga-hora").value),
      duracionHoras: Number(document.getElementById("carga-duracion").value),
      bateriaAntesPct: document.getElementById("carga-bat-antes").value || null,
      bateriaDespuesPct: document.getElementById("carga-bat-despues").value || null,
      kwhCargados: document.getElementById("carga-kwh").value || null,
    };
    try {
      const registro = await api("/charges", { method: "POST", body: JSON.stringify(body) });
      resultado.innerHTML = `<div class="ok">Guardado: ${registro.kwhCargados} kWh · coste ${fmtEur(registro.costeTotal)} (cobertura de datos: ${registro.coberturaDatos}%)</div>`;
      e.target.reset();
      document.getElementById("carga-fecha").value = new Date().toISOString().slice(0, 10);
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
    } catch (err) {
      resultado.innerHTML = `<div class="err">${err.message}</div>`;
    }
  });

  document.getElementById("rec-duracion").addEventListener("input", (e) => {
    e.target.dataset.tocado = "1";
  });

  document.getElementById("form-ajustes").addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/settings", {
      method: "POST",
      body: JSON.stringify({
        diesel: {
          consumoL100km: Number(document.getElementById("set-diesel-consumo").value),
          kmDiaMedio: Number(document.getElementById("set-diesel-km").value),
        },
        electrico: {
          consumoKwh100km: Number(document.getElementById("set-elec-consumo").value),
          capacidadBateriaKwh: Number(document.getElementById("set-elec-capacidad").value),
          kmDiaMedio: Number(document.getElementById("set-elec-km").value),
          horasCargaHabitual: Number(document.getElementById("set-elec-horas").value),
        },
        notificaciones: {
          avisoStaleDias: Number(document.getElementById("set-notif-dias").value),
          umbralAnomaliaPct: Number(document.getElementById("set-notif-umbral").value),
        },
      }),
    });
    cargaResumen();
  });

  document.getElementById("btn-notify-test").addEventListener("click", async (e) => {
    e.preventDefault();
    const resultado = document.getElementById("notify-resultado");
    resultado.innerHTML = "Enviando...";
    try {
      const data = await api("/notify/test", { method: "POST" });
      resultado.innerHTML = data.enviado
        ? `<div class="ok">✅ Enviado a Telegram.</div>`
        : `<div class="warn">${data.motivo}</div>`;
    } catch (err) {
      resultado.innerHTML = `<div class="err">${err.message}</div>`;
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
      ["fecha", "horaInicio", "duracionHoras", "kwhCargados", "costeTotal", "precioMedioEurKwh"],
      ["Fecha", "Hora inicio", "Duración (h)", "kWh", "Coste total", "€/kWh medio"]
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

async function cargaEstadoNotificaciones() {
  const el = document.getElementById("notify-status");
  try {
    const data = await api("/notify/status");
    el.textContent = data.configurado
      ? "✅ Telegram configurado."
      : "⚠️ Telegram no configurado todavía (variables TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no definidas). El resto de la app funciona igual sin esto.";
  } catch (err) {
    el.textContent = "";
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

initFormularios();
cargaResumen();
cargaGraficoManana();
cargaTablaCargas();
cargaTablaRepostajes();
cargaEvolucion();
cargaEstadoNotificaciones();
