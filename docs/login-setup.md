# Preparar el módulo de login

El login acepta DNI o correo institucional, compara la contraseña con su hash bcrypt y entrega un JWT con vencimiento de ocho horas.

El endpoint de inicio de sesión limita a 10 intentos de credenciales incorrectas por dirección IP en 15 minutos. Los accesos exitosos no cuentan para el límite. El contador usa memoria local del proceso; al reiniciar el backend se restablece, y si se ejecutan varias instancias se necesita un almacén compartido para aplicar el mismo límite entre todas. Si el backend está detrás de un proxy, configura Express para confiar solo en ese proxy y así obtener la IP real del visitante.

## Configurar variables

1. Copia `.env.example` a `.env` en la raíz del repositorio.
2. Configura `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB`, `MYSQL_PORT` y una clave aleatoria propia para `JWT_SECRET`.
3. Copia `frontend/.env.example` a `frontend/.env` y establece `VITE_API_URL`. En desarrollo suele ser `http://localhost:3000`.
4. Si frontend y backend usan dominios distintos, agrega el origen del frontend a `CORS_ORIGINS`.

No compartas ni subas los archivos `.env` ni la contraseña de los usuarios.

## Crear la tabla y una cuenta

En MySQL, selecciona la base indicada por `MYSQL_DB` y ejecuta `database/auth.sql`. Después, desde la raíz del proyecto, ejecuta:

```bash
node scripts/crear-usuario.js
```

El asistente solicita DNI, correo, nombres, apellidos, rol y contraseña. La contraseña se oculta en una terminal interactiva, se valida que tenga al menos ocho caracteres y se guarda con bcrypt. Solo deben registrarse cuentas autorizadas por el equipo.

Los roles disponibles son `ADMIN` y `COORDINADOR`. Ambos tienen los mismos permisos en esta versión; las rutas de datos requieren una sesión iniciada.

## Iniciar el sistema

Ejecuta `npm run dev` en la raíz para iniciar el backend y `npm run dev` dentro de `frontend/` para iniciar Vite. El backend verifica primero la conexión con MySQL y no abre el puerto si la base de datos no está disponible.
