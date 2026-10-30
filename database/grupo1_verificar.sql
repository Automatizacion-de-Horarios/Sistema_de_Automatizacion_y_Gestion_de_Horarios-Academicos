-- Solo consulta: no agrega, modifica ni borra registros.
SHOW COLUMNS FROM docentes;
SHOW CREATE TABLE cursos_docentes;

SELECT COUNT(*) AS docentes_del_panel
FROM docentes
WHERE registrado_en_panel = 1;

SELECT p.descripcion AS periodo, COUNT(*) AS cursos_asignados
FROM cursos_docentes cd
JOIN periodos p ON p.id_periodo = cd.id_periodo
WHERE cd.estado = 'A'
GROUP BY p.id_periodo, p.descripcion;
