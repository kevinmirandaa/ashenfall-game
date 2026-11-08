# Política de seguridad

ASHENFALL es un proyecto académico (servidor de nivel producción en Azure para un juego por turnos). La versión evaluada es la etiqueta **v1.0.0**.

## Cómo reportar un problema de seguridad
Escribe a **kevinmirandaa04@gmail.com** con una descripción del problema y cómo reproducirlo. Por favor no abras un issue público con los detalles de una vulnerabilidad. No hay recompensas, pero se agradece el aviso y se responde lo antes posible.

## Qué hay en el repositorio
- **Ningún secreto:** el secreto de los JWT vive en Azure Key Vault y se lee con identidad administrada; el repositorio no tiene claves, contraseñas ni cadenas de conexión, y gitleaks revisa el historial completo en cada cambio.
- **Escaneos automáticos en CI:** Dependabot (dependencias), CodeQL (código), gitleaks (secretos) y Trivy (imagen del contenedor, que falla ante vulnerabilidades críticas).

## Cómo se protege el servidor
Resumen en el [README](README.md#seguridad); detalle con los valores exactos de configuración en [docs/seguridad.md](docs/seguridad.md) y el modelo de amenazas, con la defensa y la prueba de cada una, en [docs/threat-model.md](docs/threat-model.md).
