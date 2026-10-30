# Sistema de Automatización y Gestión de Horarios Académicos

Aplicación web para apoyar la planificación de horarios, la gestión académica y la administración de ambientes.

## Generación local y segura de horarios

Ejecuta el flujo estricto desde la raíz del proyecto:

```powershell
python generar_horario.py
```

Las entradas `python solver_engine.py` y `python motor_horarios.py` también
delegan a este flujo validado.

El proceso lee los insumos enumerados en `json/` excepto
`horario_generado.json` y `horario_optimizado.json`. No abre ni toma en cuenta
`horario_base_consolidado.json` y nunca escribe sobre los JSON originales.
Prepara copias normalizadas en `horarios_generados/insumos/`; ahí quedan también
las reglas endurecidas y los datos que se pasan al optimizador. El resultado
validado se exporta como `horarios_generados/horario_generado.json`, y
`horarios_generados/ajustes_preprocesamiento.json` registra los cambios
aplicados a las copias. Para hacer factible H2 sin modificar la disponibilidad
original, la copia de `disponibilidad_docentes.json` otorga a cada docente
asignado la franja operativa completa de lunes a sábado.

El inventario adaptado de salones agrega recursos auxiliares identificados
como `AUXILIAR` y conserva el área de cada sala para cumplir H4/H5/H6. Estos
recursos de trabajo deben confirmarse contra la disponibilidad física real
antes de usar el horario institucionalmente.

El validador rechaza cualquier violación dura, incluida disponibilidad docente,
transiciones mínimas y Formación Práctica en Empresa (EMP) de 08:00 a 14:00 en
días consecutivos sin TEC/TAL en esos días. Los candidatos rechazados se
descartan y se reintenta con otra semilla. El proceso hace hasta 20 intentos
por defecto; `HORARIOS_MAX_INTENTOS` permite aumentar ese límite. Si no se
obtiene un horario válido, termina con error y no publica un horario final.

El generador requiere Python y OR-Tools (`ortools`) disponibles en el entorno
activo.

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
