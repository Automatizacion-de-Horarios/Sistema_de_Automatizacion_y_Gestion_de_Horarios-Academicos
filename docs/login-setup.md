# Preparar el módulo de login

El módulo sigue la especificación del proyecto: acceso con DNI o correo institucional, contraseña almacenada con bcrypt y JWT con vencimiento de ocho horas.

## 1. Crear la tabla

En el administrador de MySQL conectado a la misma base que usa el backend, abre y ejecuta `database/auth.sql`.

## 2. Crear una cuenta

Desde la carpeta raíz del proyecto, ejecuta `node scripts/crear-usuario.js`. El asistente pide DNI, correo, nombres, apellidos y rol. La contraseña se solicita de forma oculta y se almacena con bcrypt; no se escribe en el repositorio. La cuenta se crea como `ACTIVO`.

Usa solo una cuenta autorizada por el equipo. No publiques datos personales ni contraseñas.

## 3. Iniciar

La clave `JWT_SECRET` ya se agregó únicamente al `.env` local del backend y ese archivo está ignorado por Git. Mantén esa clave fuera del repositorio. El frontend usa `VITE_API_URL` del `frontend/.env` para llegar al backend.

El primer login se podrá completar después de crear la tabla y registrar una cuenta válida.
