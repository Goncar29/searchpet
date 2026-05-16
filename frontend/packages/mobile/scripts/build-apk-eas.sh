#!/bin/bash
# Genera APK usando Expo EAS en la nube.
# Requiere: cuenta gratuita en expo.dev (30 builds/mes gratis)

set -e
echo "Generando APK con EAS Build..."

cd "$(dirname "$0")/.."

# Instalar EAS CLI si no está
command -v eas >/dev/null 2>&1 || npm install -g eas-cli

# Login
echo "Iniciando sesión en Expo (abre el browser)..."
eas login

# Configurar proyecto (solo primera vez — linkea con expo.dev)
eas build:configure

# Generar APK con perfil preview
echo "Iniciando build en la nube..."
eas build \
  --platform android \
  --profile preview \
  --non-interactive

echo ""
echo "Build iniciado. Recibirás email cuando esté listo."
echo "También en: https://expo.dev/accounts/[tu-usuario]/projects"
