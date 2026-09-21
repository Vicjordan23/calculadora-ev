# Calculadora EV vs Diesel

Compara el gasto de tu coche diesel actual con el de un Tesla Model Y Standard cargado en casa con tarifa regulada (PVPC), usando precios reales obtenidos automáticamente:

- **Diesel**: API pública del Ministerio para la Transición Ecológica, filtrada a estaciones Ballenoil de Guadalajara y Alcalá de Henares.
- **Electricidad (PVPC)**: API pública de Red Eléctrica de España (REE), precio por horas. El precio de mañana se publica sobre las 20:30.

## Arrancar

```bash
npm install
npm start
```

Abre `http://localhost:3000`.

## Usarla desde casa y desde el móvil (no solo en este PC)

Ver [DEPLOY.md](DEPLOY.md) para la guía paso a paso: desplegar gratis en Render + Turso y acceder desde cualquier sitio.

## Qué hace ahora mismo

- Compara coste diario/mensual/anual diesel vs eléctrico con precios de hoy.
- Gráfico de precios PVPC por horas (hoy y mañana en cuanto se publican).
- Recomienda la franja horaria más barata para cargar, según las horas que necesites.
- Registro de cargas reales: indicas fecha, hora de inicio, duración y batería antes/después (o kWh directos), y calcula el coste real usando el precio de cada hora concreta.
- Registro de repostajes reales de diésel (mientras no tengas el eléctrico): litros, precio/L o coste total, y km del cuentakilómetros opcionales. Calcula gasto real acumulado del mes/año y el consumo real L/100km a partir de los km entre repostajes, para contrastarlo con la estimación teórica de los ajustes.
- Ajustes editables: consumos, km/día y capacidad de batería.
- Refresco automático programado: diesel a las 07:00 y 14:00, PVPC de mañana a las 20:35 y 21:00 (por si la publicación se retrasa). Además cada endpoint refresca solo si el dato en caché tiene más de 1h.

Los datos se guardan en SQLite vía [libSQL](https://turso.tech/libsql): en local usa automáticamente un fichero en `data/app.db` (cero configuración); en producción usa una base de datos Turso gratuita a través de las variables de entorno `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` (ver `.env.example` y [DEPLOY.md](DEPLOY.md)).

## Ideas para ampliar

**Seguimiento y análisis**
- Gráfico de evolución del gasto real mes a mes (diésel ya se registra; falta lo mismo para el eléctrico cuando llegue el coche).
- Comparar gasto real vs. estimación teórica para afinar los ajustes (consumo, km/día).
- Exportar a Excel/CSV el historial de repostajes/cargas.

**Notificaciones**
- Aviso (push, email o Telegram) cada noche a las 20:35 con la franja más barata para cargar al día siguiente.
- Alerta si el precio del diésel o el PVPC se sale mucho de lo habitual.
- Recordatorio si llevas varios días sin registrar un repostaje/carga.

**Multi-vehículo / multi-tarifa**
- Soportar más de un coche.
- Comparar también con otra tarifa eléctrica (mercado libre a precio fijo) además de PVPC.
- Comparar con gasolina 95/98 además de diésel.
- Comparar con carga rápida fuera de casa (Supercharger u otros) para los días que no cargues en casa.

**Integraciones**
- Detección automática de sesión de carga conectando con la API de Tesla (Tessie, TeslaMate, etc.) en vez de introducirla a mano.
- Importar la factura PDF de la luz para contrastar el coste real facturado vs. el PVPC teórico.

**Visión financiera más amplia**
- **Coste total de propiedad (TCO)**: sumar seguro, mantenimiento e impuesto de circulación, no solo combustible/electricidad.
- Simulador de "punto de equilibrio": cuánto se tarda en amortizar el sobrecoste del Tesla frente a un diésel equivalente, dado el ahorro real mensual.
- Modo "coste por viaje": calcular un trayecto puntual (ej. viaje largo) con el precio real esperado, en vez de solo la media diaria.

**UX**
- PWA de verdad (funciona offline, arranca más rápido) en vez de solo "añadir a inicio".
- Formulario simplificado de un solo toque para registrar un repostaje/carga desde el móvil.
