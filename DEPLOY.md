# Poner la calculadora accesible desde casa y desde el móvil

Vamos a usar 3 servicios gratuitos que **no piden tarjeta de crédito**:

| Servicio | Para qué | Coste |
|---|---|---|
| [Turso](https://turso.tech) | Base de datos (precios, historial de cargas) | Gratis |
| [Render](https://render.com) | Ejecutar la app en internet | Gratis |
| [cron-job.org](https://cron-job.org) | "Despertar" la app y refrescar precios a su hora | Gratis |

El plan gratuito de Render "duerme" la app tras 15 min sin uso (tarda ~30-50s en despertar la primera vez que la abres). Por eso los datos van en Turso (que no depende de si Render está dormido) y cron-job.org es quien la despierta a las horas clave para refrescar precios aunque tú no la estés usando.

No puedo crear estas cuentas por ti (necesitan tu email/verificación), pero aquí tienes cada paso.

---

## 1. Crear la base de datos en Turso

1. Entra en https://turso.tech y crea una cuenta gratis (puedes entrar con GitHub).
2. En el dashboard, crea una base de datos nueva (botón "Create Database"). Ponle un nombre, por ejemplo `calculadora-ev`.
3. Dentro de la base de datos, busca:
   - **Database URL** (empieza por `libsql://...`)
   - Crea un **token** (botón "Create Token" o similar) — es una clave larga.
4. Guarda esos dos valores, los necesitas en el paso 3.

## 2. Subir el proyecto a GitHub

El proyecto ya tiene un repositorio git local con el primer commit hecho. Solo falta subirlo:

1. Entra en https://github.com/new y crea un repositorio nuevo (puede ser privado), por ejemplo `calculadora-ev`. No añadas README ni .gitignore desde GitHub (ya los tenemos).
2. En tu terminal, dentro de la carpeta del proyecto:

```bash
git remote add origin https://github.com/TU_USUARIO/calculadora-ev.git
git branch -M main
git push -u origin main
```

(Sustituye `TU_USUARIO` por tu usuario de GitHub. Te pedirá iniciar sesión la primera vez.)

## 3. Desplegar en Render

1. Entra en https://render.com y crea una cuenta gratis (puedes entrar con GitHub, así se conecta solo).
2. Dashboard → **New** → **Web Service**.
3. Elige el repositorio `calculadora-ev` que acabas de subir.
4. Configura:
   - **Name**: `calculadora-ev` (o lo que quieras — será parte de tu URL)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Antes de darle a "Create", despliega la sección **Environment Variables** y añade:
   - `TURSO_DATABASE_URL` = la URL que copiaste de Turso
   - `TURSO_AUTH_TOKEN` = el token que copiaste de Turso
6. Dale a **Create Web Service**. Tardará 1-2 minutos en desplegar.
7. Cuando termine, te da una URL tipo `https://calculadora-ev.onrender.com`. Ábrela — es tu app, ya accesible desde cualquier sitio (casa, móvil con datos móviles, etc.), no solo desde este PC.

## 4. Programar los refrescos automáticos con cron-job.org

Como Render gratis se duerme, necesitamos que algo externo llame a la app a las horas clave:

1. Entra en https://cron-job.org y crea una cuenta gratis.
2. Crea un cron job:
   - **Título**: Refrescar diesel
   - **URL**: `https://calculadora-ev.onrender.com/api/diesel/refresh`
   - **Método**: POST
   - **Horario**: todos los días a las **07:05** y otra vez a las **14:05**  (puedes crear dos cron jobs o uno con ambas horas si el plan lo permite)
3. Crea otro cron job:
   - **Título**: Refrescar PVPC de mañana
   - **URL**: `https://calculadora-ev.onrender.com/api/electricity/refresh`
   - **Método**: POST
   - **Horario**: **20:35** y otra vez a las **21:00** (por si Red Eléctrica publica un poco tarde)

Con esto, aunque tú no abras la app, los precios se mantienen actualizados solos.

## 5. Usarla desde el móvil como si fuera una app

1. Abre `https://calculadora-ev.onrender.com` en el navegador del móvil (Chrome/Safari).
2. Menú del navegador → **"Añadir a pantalla de inicio"** (Android) o **"Compartir" → "Añadir a inicio"** (iPhone).
3. Te queda un icono como una app normal. Sigue siendo una web, pero se abre a pantalla completa.

---

## Actualizar la app en el futuro

Cada vez que quieras subir un cambio de código:

```bash
git add -A
git commit -m "descripción del cambio"
git push
```

Render vuelve a desplegar solo en cuanto detecta el push a GitHub (puede tardar 1-2 min).

## Cuando quieras dejar de depender de que Render "duerma"

Si más adelante te compras un Raspberry Pi o similar para tener casa, puedes mover la misma app allí sin tocar código: simplemente no defines `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (usará un fichero SQLite local) o los mantienes (sigue usando Turso) y ejecutas `npm start` directamente en el Pi, dejándolo siempre encendido. En ese caso los cron internos de `server.js` (que ya están programados a las mismas horas) hacen innecesario cron-job.org.
