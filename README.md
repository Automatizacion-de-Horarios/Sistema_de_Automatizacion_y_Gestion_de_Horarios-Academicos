# Sistema de Automatización y Gestión de Horarios Académicos

Aplicación web para apoyar la planificación de horarios, la gestión académica y la administración de ambientes.

## Requisitos

- Node.js y npm.
- MySQL con el esquema general del sistema. Este repositorio solo incluye el esquema adicional de autenticación en `database/auth.sql`.

## Preparar el entorno

1. En la carpeta raíz, copia `.env.example` a `.env` y configura la conexión MySQL y una clave `JWT_SECRET` propia.
2. En `frontend/`, copia `.env.example` a `.env`. Para desarrollo local, `VITE_API_URL` puede apuntar a `http://localhost:3000`.
3. En MySQL, selecciona la misma base configurada como `MYSQL_DB` y ejecuta `database/auth.sql`.
4. Instala y crea una cuenta autorizada:

   ```bash
   npm install
   node scripts/crear-usuario.js
   ```

5. Instala las dependencias del frontend:

   ```bash
   cd frontend
   npm install
   ```

## Iniciar en desarrollo

Abre dos terminales desde la raíz del repositorio. En una ejecuta `npm run dev`; en la otra ejecuta `cd frontend && npm run dev`. Vite mostrará la dirección local del frontend, normalmente `http://localhost:5173`.

El backend solo inicia si puede conectarse a MySQL. El login acepta DNI o correo institucional y una contraseña registrada para una cuenta activa.

## Comprobaciones del frontend

Desde `frontend/`, ejecuta `npm run lint` y `npm run build`.

## Seguridad

Los archivos `.env` son locales y no deben subirse al repositorio. `CORS_ORIGINS` acepta una lista separada por comas; al desplegar, configura ahí el origen del frontend.
