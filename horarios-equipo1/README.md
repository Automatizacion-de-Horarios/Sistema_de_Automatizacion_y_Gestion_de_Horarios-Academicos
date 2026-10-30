# Sistema de Horarios SENATI — Módulo Equipo 1: Docentes y Disponibilidad

React + Parcel (frontend) · Supabase (base de datos ya creada) · Vercel (hosting).
La interfaz replica la **INTERFAZ COMPLETA REFERENCIAL** (mismo CSS, clases y textos).

## 1. Probarlo en 3 minutos

```bash
npm install
npm start          # abre http://localhost:1234
```

Sin configurar nada arranca en **MODO DEMO** (datos de ejemplo en memoria, aparece un aviso azul).
Sirve para ver la interfaz y ensayar la exposición.

## 2. Conectarlo a Supabase

1. Copia `.env.example` como `.env` en la raíz (misma carpeta que `package.json`).
2. Completa (Supabase → Project Settings → API):
   ```
   SUPABASE_URL=https://TU-PROYECTO.supabase.co
   SUPABASE_ANON_KEY=tu_clave_anon_publica
   ```
3. Reinicia `npm start` (Parcel solo lee el `.env` al arrancar). El aviso de modo demo desaparece.

> `JWT_SECRET` **no se usa** en este frontend y no debe ir en `src/`. Parcel incrusta en el navegador toda
> variable que se lea con `process.env`. Genera uno nuevo si el anterior se compartió por chat.

### Esquema esperado (se adapta en un solo archivo)

| Tabla | Columnas que usa el módulo |
|---|---|
| `docentes` | id, nombres, apellidos, dni, especialidad, horas_semanales_contrato, **estado** (A/I/V), **usuario_modificacion**, **fecha_modificacion** |
| `disponibilidad_docentes` | id, docente_id, dia_semana (1=Lun … 6=Sáb), hora_inicio, hora_fin |
| `docente_competencias` (opcional) | docente_id, curso_id |
| `cursos`, `ambientes`, `horarios_asignados` | solo lectura (Equipos 3, 2 y 4); si no existen, la pantalla no se rompe |

- Si tus tablas tienen **otros nombres**, cámbialos solo en `src/config/app.js` (`TABLAS`).
- Si te faltan **columnas** (`estado`, auditoría) o la tabla `docente_competencias`, ejecuta lo necesario de
  `supabase/ajustes_opcionales.sql` en el editor SQL de Supabase (o en Heidi).
- Si Supabase responde "row-level security", faltan políticas RLS: hay ejemplos de desarrollo en ese mismo SQL.
- La disponibilidad se guarda como **rangos contiguos** (ej. Lunes 08:00–11:00), no una fila por hora.

## 3. Qué incluye

- Registro, edición y búsqueda de instructores (DNI de 8 dígitos, horas de contrato).
- Estado operativo A/I/V con auditoría (usuario y fecha).
- **Cuadrícula de disponibilidad** Lun–Sáb × 07–21h: clic, arrastre, clic en día/hora, presets, contadores y aviso si hay menos horas que el contrato.
- Vista alternativa por rango horario (Inicio–Fin por día).
- Competencias: asignar cursos al docente con filtro por ciclo y búsqueda.
- Horario semanal del docente (solo lectura, viene del Equipo 4).

## 4. Entregable para el Equipo 4 (DRY)

```js
import { useDocentes } from './modules/docentes';

const { docentesActivos, esDocenteDisponible, getDisponibilidad } = useDocentes();

esDocenteDisponible(docenteId, 1, '08:00', '10:00'); // dia: 1=Lunes ... 6=Sábado -> true/false
getDisponibilidad(docenteId);                         // ["1-08:00", "1-09:00", ...]
```

Solo los docentes con estado `A` devuelven `true` en `esDocenteDisponible`.

## 5. Estructura

```
src/
  config/app.js                  nombres de tablas, días, horas, estados, usuario de auditoría
  lib/supabaseClient.js          cliente Supabase único (+ modo demo)
  modules/docentes/
    index.js                     API pública del módulo
    hooks/useDocentes.js         hook reutilizable
    services/                    acceso a datos (docentesApi.supabase.js / docentesApi.demo.js)
    utils/disponibilidad.js      conversión filas <-> cuadrícula
    components/                  pantalla y modales
  styles/global.css              CSS de la interfaz referencial
  styles/docentes.css            ajustes del módulo
```

## 6. Desplegar en Vercel

1. Sube el proyecto a GitHub (rama del Equipo 1, luego merge a main).
2. En Vercel: *Add New → Project* y elige el repositorio. `vercel.json` ya define build (`npm run build`) y salida (`dist`).
3. En *Settings → Environment Variables* agrega `SUPABASE_URL` y `SUPABASE_ANON_KEY`, y haz *Redeploy*.

## 7. Reparto sugerido para 3 personas

| Persona | Archivos |
|---|---|
| 1 | `DocentesPage`, `DocenteForm`, `DocentesTable`, `EstadoModal`, `CentroControlModal` |
| 2 | `DisponibilidadCuadriculaModal`, `DisponibilidadRangoModal`, `utils/disponibilidad.js` |
| 3 | `services/`, `hooks/useDocentes.js`, `CompetenciasModal`, `HorarioDocenteModal`, despliegue |

## 8. Pruebas manuales antes de entregar

1. Registrar un instructor con DNI de 8 dígitos; repetir el DNI debe mostrar error.
2. Editar sus datos desde ⚙️ → *Editar Datos del Instructor*.
3. Cambiar el estado a V e I; la insignia y la auditoría cambian.
4. Pintar la cuadrícula arrastrando, guardar, **recargar la página** y confirmar que persiste (con Supabase).
5. Guardar en vista de rango y volver a abrir la cuadrícula: las horas coinciden.
6. Asignar competencias (si ya hay cursos del Equipo 3) y recargar.
7. Abrir *Clases*: muestra el horario si el Equipo 4 ya cargó `horarios_asignados`, o "Sin clases asignadas".
