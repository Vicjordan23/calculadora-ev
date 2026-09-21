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
- Recomienda las horas más baratas para cargar respetando tu ventana real disponible en casa (entre semana solo fuera de tu horario de trabajo; el fin de semana entero) — configurable en Ajustes.
- Simulación retroactiva ("💡 Lo que habría costado cargar el Tesla en casa"): día a día, con los precios PVPC reales ya guardados, calcula cuánto habría costado cargar la energía de ese día respetando tu ventana real, y lo compara con tu gasto real de diésel en el mismo periodo. Útil mientras aún no tienes el coche eléctrico.
- Registro de cargas reales: en casa (fecha, hora de inicio, duración y batería antes/después o kWh directos, coste calculado con el PVPC de cada hora) o fuera de casa (Supercharger u otra compañía, con precio manual).
- Registro de repostajes reales de diésel (mientras no tengas el eléctrico): litros, precio/L o coste total, y km del cuentakilómetros opcionales. Calcula gasto real acumulado del mes/año y el consumo real L/100km a partir de los km entre repostajes, para contrastarlo con la estimación teórica de los ajustes.
- Gráfico de evolución mensual: gasto real (repostajes/cargas) frente al coste teórico de cada mes, calculado con el precio medio real de ese mes.
- Exportar a CSV el historial de repostajes y de cargas.
- Notificación nocturna por Telegram (opcional): franja más barata para cargar mañana, aviso si el diésel se mueve fuera de lo normal, y recordatorio si llevas días sin registrar un repostaje. Sin configurar, la app funciona igual, simplemente no avisa.
- Formularios rápidos: los campos opcionales (fecha, km, kWh directos...) están plegados en "Más detalles" para que lo habitual (litros+precio, o duración+batería) se rellene en dos toques.
- PWA instalable: manifest + iconos + service worker con cache del "cascarón" de la app (nunca de los precios), para que abra rápido y puedas añadirla a la pantalla de inicio del móvil.
- Ajustes editables: consumos, km/día, capacidad de batería, hora de llegada a casa / salida al trabajo, potencia de carga en casa y umbrales de notificación.
- Refresco automático programado: diesel a las 07:00 y 14:00, PVPC de mañana a las 20:35 y 21:00 (por si la publicación se retrasa), aviso nocturno a las 20:40. Además cada endpoint refresca solo si el dato en caché tiene más de 1h.

Los datos se guardan en SQLite vía [libSQL](https://turso.tech/libsql): en local usa automáticamente un fichero en `data/app.db` (cero configuración); en producción usa una base de datos Turso gratuita a través de las variables de entorno `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` (ver `.env.example` y [DEPLOY.md](DEPLOY.md)).

## Ideas para ampliar (pendientes, a propósito fuera de alcance por ahora)

- **Multi-vehículo / multi-tarifa**: soportar más de un coche, otra tarifa eléctrica (mercado libre) o comparar con gasolina 95/98.
- **Integración con la API de Tesla** (Tessie, TeslaMate...) para registrar cargas solas en vez de a mano — con sentido en cuanto llegue el coche.
- **Visión financiera más amplia**: coste total de propiedad (TCO) con seguro/mantenimiento/impuestos, simulador de punto de equilibrio, modo "coste por viaje".
- Importar la factura PDF de la luz para contrastar el coste real facturado vs. el PVPC teórico.
