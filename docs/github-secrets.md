# GitHub Secrets para CI/CD — APK Build

Configurar en: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Descripción |
|--------|-------------|
| `API_URL` | URL del backend en Render (ej: `https://searchpet.onrender.com`) |
| `ANDROID_KEYSTORE_BASE64` | Keystore en base64 (ver paso de generación abajo) |
| `ANDROID_KEYSTORE_PASSWORD` | Contraseña del keystore |
| `ANDROID_KEY_ALIAS` | Alias de la signing key |
| `ANDROID_KEY_PASSWORD` | Contraseña de la key (puede ser igual al keystore) |

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

Hasta v1.0.6 inclusive, `build-apk.yml` recibía estos secrets pero ningún paso
los consumía: los APKs salían firmados con la **debug key pública del template
de React Native** (la que genera `expo prebuild` por defecto). Desde el fix de
firma, el workflow decodifica el keystore real e inyecta el `signingConfig`
release, y un guard hace fallar el build si el APK queda debug-signed.

Consecuencia one-off: la primera actualización con la firma nueva NO instala
sobre una versión debug-signed — hay que desinstalar y reinstalar la app.
