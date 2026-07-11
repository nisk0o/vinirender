# Vinicus y Amigos — en la nube, gratis (Supabase + Render)

Versión pensada para que la app esté online sin depender de tu
ordenador ni gastar dinero, mientras seguís probando y cambiando
cosas. Los datos ya no se guardan en un archivo local: viven en una
base de datos Postgres gratuita en **Supabase**, y el servidor corre
en **Render** (también gratis).

No usa ningún paquete de npm — solo módulos nativos de Node
(`http`, `fs`, `crypto`) más `fetch`, que ya viene incluido desde
Node 18. Cero `npm install`.

---

## 1. Crear la base de datos en Supabase (5 minutos)

1. Entra en **[supabase.com](https://supabase.com)** y crea una cuenta gratis (no pide tarjeta).
2. Crea un proyecto nuevo (elige la región más cercana, p. ej. Europa).
   Guarda la contraseña de la base de datos que te pida, aunque no la
   vamos a necesitar directamente.
3. Cuando el proyecto esté listo, ve a **SQL Editor** (menú lateral) →
   **New query**.
4. Abre el archivo [`db/schema.sql`](./db/schema.sql) de este
   proyecto, copia todo su contenido, pégalo ahí y dale a **Run**.
   Esto crea las tablas (`users`, `board_notes`, `hall_images`,
   `wipe_signups`, `raid_list`).
5. Ve a **Project Settings → API**. Ahí verás dos cosas que necesitas:
   - **Project URL** → algo como `https://abcdefgh.supabase.co`
   - **service_role key** (dentro de "Project API keys") → una clave
     larga que empieza por `eyJ...`

   ⚠️ **Importante:** la `service_role key` es secreta, salta todos
   los permisos de la base de datos. Nunca la pongas en el frontend
   ni la subas a un repositorio público — solo va en las variables de
   entorno del servidor (paso 3).

---

## 2. Probarlo en tu ordenador (opcional, pero recomendable antes de subirlo)

```bash
cp .env.example .env
```

Edita `.env` y pon tu `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` del
paso anterior. Luego:

```bash
node server.js
```

Abre `http://localhost:3000`. La primera vez que arranque, si la
tabla `users` está vacía, crea automáticamente los 9 miembros
iniciales (mismos usuarios/contraseñas que ya conocéis, ver tabla más
abajo).

---

## 3. Subirlo a Render (gratis)

1. Sube esta carpeta a un repositorio de GitHub (puede ser privado).
2. Entra en **[render.com](https://render.com)**, crea cuenta gratis
   (no pide tarjeta) y pulsa **New → Web Service**.
3. Conecta tu repositorio de GitHub.
4. Configura:
   - **Runtime:** Node
   - **Build Command:** (déjalo vacío, no hay nada que compilar)
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
5. En la sección **Environment**, añade las variables:
   - `SUPABASE_URL` = tu Project URL de Supabase
   - `SUPABASE_SERVICE_KEY` = tu service_role key de Supabase
   - `GOOGLE_CLIENT_ID` = (opcional) el Client ID de Google si quieres
     activar el botón "Entrar con Google" — ver sección siguiente.
     Si no la pones, la app funciona igual, solo que sin ese botón.
6. Dale a **Create Web Service**. Render te dará una URL pública tipo
   `https://vinicus-y-amigos.onrender.com` — esa es la que compartes
   con la Zerg.

Cada vez que hagas `git push` con cambios, Render vuelve a desplegar
solo. Así que para "añadir funcionalidades" el flujo es: editar
código → subir a GitHub → Render lo actualiza en ~1 minuto.

---

## 3bis. Activar el login con Google (opcional)

El login normal (usuario + contraseña) sigue funcionando siempre.
Esto añade un botón "Entrar con Google" **además**, solo para quien
ya tenga una cuenta en la app y le haya vinculado su email.

1. Entra en **[Google Cloud Console](https://console.cloud.google.com/)**
   con tu cuenta de Google (no hace falta tarjeta ni pagar nada).
2. Crea un proyecto nuevo (arriba a la izquierda, "Nuevo proyecto"),
   ponle el nombre que quieras, p. ej. "Vinicus y Amigos".
3. Ve a **APIs y servicios → Pantalla de consentimiento OAuth**.
   - Tipo de usuario: **Externo**.
   - Rellena nombre de la app, tu email de soporte y el de contacto.
   - En "Público": déjalo en modo **Prueba** y añade como
     "Usuarios de prueba" los emails de Gmail de los 9 miembros —
     así Google no pide revisión y solo vosotros podéis usarlo.
4. Ve a **APIs y servicios → Credenciales → Crear credenciales →
   ID de cliente de OAuth**.
   - Tipo de aplicación: **Aplicación web**.
   - En "Orígenes de JavaScript autorizados" añade la URL de tu app,
     tal cual, sin barra al final: `https://vinicus-y-amigos.onrender.com`
     (y si pruebas en local: `http://localhost:3000`).
   - No hace falta rellenar "URI de redireccionamiento".
   - Dale a **Crear**. Te da un **Client ID** (termina en
     `.apps.googleusercontent.com`) — cópialo, es lo único que
     necesitas, no hay "secreto" que guardar.
5. En Render, añade la variable de entorno `GOOGLE_CLIENT_ID` con
   ese valor (o en tu `.env` local si pruebas en tu ordenador) y
   redespliega.
6. Ejecuta en el SQL Editor de Supabase la línea nueva de
   `db/schema.sql` (`alter table users add column if not exists
   email text;` y el índice único de debajo) si tu proyecto ya
   existía de antes — así no pierdes ningún dato.
7. Cada persona entra normal con usuario/contraseña, va a su
   **Taquilla → Acceso con Google** y pone ahí el email de la
   cuenta de Google con la que quiere entrar. A partir de ese
   momento le aparecerá el botón de Google en el login.

---

## Cosas a tener en cuenta con el plan gratis

- **Render (free):** el servicio se "duerme" tras 15 minutos sin
  visitas. La siguiente persona que entre espera unos 30-50 segundos
  mientras despierta. Los datos no se pierden (están en Supabase, no
  en Render), solo tarda en arrancar.
- **Supabase (free):** si el proyecto entero pasa **7 días sin
  ninguna consulta**, se pausa automáticamente (los datos se
  conservan, pero hay que entrar al panel de Supabase y darle a
  "Restore" para reactivarlo). Si jugáis con cierta regularidad no lo
  vais a notar nunca. Si teméis que la Zerg desaparezca una semana
  entera, lo más simple es crear un monitor gratuito en
  [UptimeRobot](https://uptimerobot.com) que haga ping a vuestra URL
  de Render cada pocos minutos — así, de paso, Render tampoco se
  duerme.
- Límites del plan gratis de Supabase: 500 MB de base de datos, lo
  cual es de sobra para texto (notas, apuntes, roles). Las fotos del
  Hall of Fame y los avatares se guardan como imagen incrustada en la
  base de datos (base64): si algún día subís muchísimas fotos en alta
  resolución podríais acercaros al límite. Si eso pasa, la solución
  es mover esas imágenes a **Supabase Storage** (1 GB gratis aparte,
  pensado justo para archivos) en vez de guardarlas dentro de la
  tabla — es un cambio pequeño y podemos hacerlo cuando haga falta.

---

## Usuarios de partida

Se crean solos la primera vez que el servidor encuentra la tabla
`users` vacía en Supabase:

| Usuario |   | Rango inicial |
|---------|   |---------------|
| julian  |   | Gru           |
| gonzalo |   | Minion menaje |
| luciano |   | Minion menaje |
| xavi    |   | Minion menaje |
| javi    |   | Minion menaje |
| adri    |   | Minion menaje |
| joseca  |   | Minion menaje |
| manu    |   | Minion menaje |
| alvaro  |   | Minion menaje |

Recomendable cambiar la contraseña desde **Taquilla** en cuanto
entréis.

---

## Estructura del proyecto

```
vinicus-y-amigos/
├── server.js         # Backend (API REST + servidor de estáticos)
├── supabase.js        # Cliente mínimo para hablar con Supabase (fetch)
├── load-env.js         # Carga .env en local (no hace nada en Render)
├── db/schema.sql        # SQL para crear las tablas en Supabase (paso 1)
├── .env.example
├── package.json
└── public/
    ├── index.html      # Mismo diseño/HTML/CSS de siempre
    └── app.js           # Lógica de la app, hablando con la API
```

## Seguridad

- Las contraseñas se guardan con hash (`scrypt` + salt), nunca en
  texto plano — ni en Supabase ni en ningún sitio.
- El navegador nunca habla directamente con Supabase: solo habla con
  tu servidor Node, que es el único que conoce la `service_role key`.
  Así esa clave nunca se expone.
- Row Level Security está activada en todas las tablas sin políticas
  públicas, así que aunque alguien consiguiera la clave "anon" de
  Supabase (la pública), no podría leer ni escribir nada sin pasar
  por tu servidor.
