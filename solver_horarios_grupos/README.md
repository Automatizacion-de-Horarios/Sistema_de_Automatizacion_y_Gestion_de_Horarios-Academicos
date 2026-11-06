# Generación de horarios por grupos

Este paquete añade un flujo separado para resolver varios semestres juntos sin
alterar `solver_horarios_db.py` ni el generador aislado del Semestre II.

## Comportamiento

- Solo carga como variables las ofertas de los semestres indicados.
- Lee `horarios_generados` del mismo periodo en estado `BORRADOR` o
  `CONFIRMADO`; las demás ofertas se agregan como ocupaciones fijas de docente
  y ambiente, incluyendo su día, hora y rango de semanas.
- Si una programación seleccionada ya tiene un horario `CONFIRMADO`, aborta.
- Sin `--guardar` ejecuta un dry-run y no cambia datos.
- Con `--guardar`, vuelve a consultar y bloquear los horarios existentes,
  audita conflictos y reemplaza únicamente los BORRADORES de las ofertas
  seleccionadas dentro de una transacción. No elimina borradores de otros
  grupos y no cambia horarios confirmados.
- Las restricciones horarias de cohorte entre semestres no se agregan: el
  alcance de las ocupaciones externas es docente y ambiente.
- Si CP-SAT devuelve `INFACTIBLE`, se ejecuta un diagnóstico detallado. Además
  de las cargas docentes/cohortes, aísla por búsqueda binaria la programación
  externa que, al retirarse, vuelve factible el grupo. El presupuesto se controla
  con `--tiempo-diagnostico` (120 s por defecto; `0` lo desactiva).

## Grupos del periodo 202620

- **Grupo 1:** `II,IV`.
- **Grupo 2:** `III,V,VI`. IV no forma parte del Grupo 2; se regenera con el
  Grupo 1.

## Ejemplos

Dry-run del Grupo 1 (II + IV):

```powershell
python -m solver_horarios_grupos --periodo 202620 --semestres II,IV
```

Dry-run del Grupo 2 (III + V + VI):

```powershell
python -m solver_horarios_grupos --periodo 202620 --semestres III,V,VI
```

Auditoría de choques entre los horarios que ya están guardados:

```powershell
python -m solver_horarios_grupos --periodo 202620 --auditar
```

La auditoría devuelve código de salida `1` si encuentra conflictos y `0` si no
detecta choques.

Persistir explícitamente el grupo después de revisar el dry-run:

```powershell
# Grupo 1 (II + IV)
python -m solver_horarios_grupos --periodo 202620 --semestres II,IV --guardar

# Grupo 2 (III + V + VI)
python -m solver_horarios_grupos --periodo 202620 --semestres III,V,VI --guardar
```

Los filtros `--carreras`, `--turnos` y `--sedes` son opcionales. El grupo
seleccionado debe incluir al menos un semestre. La configuración de MySQL se
lee desde `.env` o las mismas variables `MYSQL_*` del solver actual.

## Ejecución incremental

Empieza con un semestre piloto, luego prueba dos y aumenta el grupo cuando el
tiempo del dry-run sea aceptable. Al ejecutar un grupo posterior, sus
ocupaciones incluyen los borradores y confirmados que ya existen fuera de ese
grupo. No se recomienda guardar grupos simultáneamente.
