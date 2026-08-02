# GitHub Secrets para CI/CD — APK Build

Configurar en: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Descripción |
|--------|-------------|
| `API_URL` | URL del backend en Render (ej: `https://searchpet.onrender.com`) |
| `ANDROID_KEYSTORE_BASE64` | Keystore en base64 (ver paso de generación abajo) |
| `ANDROID_KEYSTORE_PASSWORD` | Contraseña del keystore |
| `ANDROID_KEY_ALIAS` | Alias de la signing key |
| `ANDROID_KEY_PASSWORD` | Contraseña de la key (puede ser igual al keystore) |

El pipeline principal (`ci.yml`) usa además:

| Secret | Descripción |
|--------|-------------|
| `RENDER_DEPLOY_HOOK_URL` | Deploy hook de Render. Lo dispara `deploy-backend` en push a `main`, después de que pasen los cuatro jobs de test. El Auto-Deploy por commit del servicio está **apagado** a propósito: si estuviera prendido, cada push deployaría dos veces y el deploy automático no esperaría a los tests |

## Generar Keystore (solo se hace UNA vez)

```bash
keytool -genkey -v \
  -keystore searchpet.keystore \
  -alias searchpet \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=SearchPet, OU=Mobile, O=SearchPet, L=Montevideo, ST=Uruguay, C=UY"
```

## Convertir a base64 para el secret

```bash
# Linux/Mac:
base64 searchpet.keystore | tr -d '\n'

# Windows (PowerShell):
[Convert]::ToBase64String([IO.File]::ReadAllBytes("searchpet.keystore"))
```

Copiar el output → GitHub Secret `ANDROID_KEYSTORE_BASE64`.

## IMPORTANTE: Guardar el keystore

Guardar `searchpet.keystore` en lugar seguro fuera del repo.
Si se pierde, no se puede actualizar el APK con el mismo certificado.

## Historial de firma

Hasta **v1.0.5 inclusive**, `build-apk.yml` recibía estos secrets pero ningún paso
los consumía: los APKs salían firmados con la **debug key pública del template
de React Native** (la que genera `expo prebuild` por defecto). El fix (`fbbc375`,
PR #73) se mergeó el 2026-07-09, pero recién produjo un artefacto con el tag
**v1.0.6** (`7811cdf`, 2026-07-28) — o sea que **v1.0.6 es la primera release
firmada de verdad**. Desde el fix, el workflow decodifica el keystore real e
inyecta el `signingConfig` release, y un guard hace fallar el build si el APK
queda debug-signed.

Para leer el SHA-1 de un APK **no hace falta el keystore**:
`apksigner verify --print-certs <apk>`. Ojo que `keytool -printcert -jarfile` no
imprime nada acá, porque los APK están firmados con v2/v3 y sin firma JAR v1.

Consecuencia one-off: la primera actualización con la firma nueva NO instala
sobre una versión debug-signed — hay que desinstalar y reinstalar la app.
