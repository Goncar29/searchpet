// ============================================================
// SearchPet — PdfFlyerButton (Mobile)
// Genera un PDF flyer con datos de la mascota + QR code.
// Usa expo-print (HTML → PDF via WebView) + expo-sharing.
// El QR se genera localmente con el paquete qrcode (data URI base64),
// sin dependencias de servicios externos.
// ============================================================

import { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import QRCode from 'qrcode';
import { useGenerateShareLink } from '../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';
import type { Pet, Report } from '../../shared/types';
import { posterFraming } from '../utils/adoptionFraming';

interface PdfFlyerButtonProps {
  pet: Pet;
  reports?: Report[];
}

const MAX_DESCRIPTION_CHARS = 300;

export function PdfFlyerButton({ pet, reports = [] }: PdfFlyerButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const generateLink = useGenerateShareLink();

  const primaryPhoto = pet.photos?.find((p) => p.is_primary) || pet.photos?.[0];

  const latestReport = reports[0];
  const lastSeenDate = latestReport
    ? new Date(latestReport.occurred_at ?? latestReport.created_at).toLocaleDateString('es', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const description =
    pet.description && pet.description.length > MAX_DESCRIPTION_CHARS
      ? pet.description.slice(0, MAX_DESCRIPTION_CHARS) + '...'
      : pet.description || null;

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);

    try {
      // 1. Generar share link para el QR y la URL en el flyer
      const shareLink = await generateLink.mutateAsync({ petID: pet.id });
      const shareUrl = shareLink.share_url;

      // 2. QR generado localmente como data URI — sin dependencia de red
      const qrDataUri = await QRCode.toDataURL(shareUrl, { width: 150, margin: 1 });

      const { color: statusColor, header: statusText } = posterFraming(pet.status);

      const detailRows = [
        pet.type ? `<tr><td class="lbl">Tipo:</td><td class="val">${pet.type}</td></tr>` : '',
        pet.breed ? `<tr><td class="lbl">Raza:</td><td class="val">${pet.breed}</td></tr>` : '',
        pet.color ? `<tr><td class="lbl">Color:</td><td class="val">${pet.color}</td></tr>` : '',
        pet.status === 'adoption' && pet.city ? `<tr><td class="lbl">Zona:</td><td class="val">${pet.city}</td></tr>` : '',
        lastSeenDate ? `<tr><td class="lbl">Visto:</td><td class="val">${lastSeenDate}</td></tr>` : '',
      ].filter(Boolean).join('');

      const photoHtml = primaryPhoto?.url
        ? `<img src="${primaryPhoto.url}" class="photo" />`
        : `<div class="photo-ph"><svg viewBox="6 38 122 72" width="150" fill="#C24E1A" xmlns="http://www.w3.org/2000/svg"><g transform="translate(4,20)"><circle cx="10" cy="82" r="4"/><circle cx="28" cy="72" r="5.5"/><circle cx="47" cy="61" r="7"/><g transform="translate(44.65,6.86) scale(0.85)"><ellipse cx="51" cy="64" rx="23" ry="19"/><circle cx="23" cy="43" r="9.5"/><circle cx="41" cy="28" r="10.5"/><circle cx="61" cy="28" r="10.5"/><circle cx="79" cy="43" r="9.5"/></g></g></svg></div>`;

      const descriptionHtml = description
        ? `<div class="desc">${description}</div>`
        : '';

      // 3. HTML del volante — A4-ish layout con estilos inline-friendly
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; padding: 32px; background: #fff; color: #111827; }
    .header { text-align: center; margin-bottom: 24px; }
    .badge {
      background: ${statusColor}; color: #fff;
      padding: 10px 28px; border-radius: 8px;
      font-size: 22px; font-weight: 800; letter-spacing: 2px;
      display: inline-block;
    }
    .main { display: flex; gap: 24px; margin-bottom: 20px; align-items: flex-start; }
    .photo { width: 200px; height: 200px; object-fit: cover; border-radius: 8px; border: 2px solid #e5e7eb; flex-shrink: 0; }
    .photo-ph { width: 200px; height: 200px; background: #f3f4f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 64px; flex-shrink: 0; }
    .info { flex: 1; }
    h1 { font-size: 26px; font-weight: 800; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .lbl { color: #6b7280; padding-bottom: 7px; padding-right: 10px; width: 80px; }
    .val { font-weight: 600; padding-bottom: 7px; }
    .desc { margin-bottom: 20px; padding: 14px; background: #f9fafb; border-radius: 8px; font-size: 13px; line-height: 1.6; color: #374151; }
    .footer { display: flex; align-items: center; gap: 20px; border-top: 2px solid #e5e7eb; padding-top: 18px; }
    .qr { width: 130px; height: 130px; flex-shrink: 0; }
    .ft-text { flex: 1; }
    .ft-label { font-size: 12px; color: #6b7280; margin-bottom: 5px; }
    .ft-url { font-size: 12px; color: #2563eb; font-weight: 600; margin-bottom: 10px; word-break: break-all; }
    .ft-brand { font-size: 11px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="header">
    <div class="badge">${statusText}</div>
  </div>

  <div class="main">
    ${photoHtml}
    <div class="info">
      <h1>${pet.name}</h1>
      <table><tbody>${detailRows}</tbody></table>
    </div>
  </div>

  ${descriptionHtml}

  <div class="footer">
    <img src="${qrDataUri}" class="qr" />
    <div class="ft-text">
      <p class="ft-label">Escaneá el QR para ver más info y compartir:</p>
      <p class="ft-url">${shareUrl}</p>
      <p class="ft-brand">SearchPet — Ayudamos a reunir mascotas con sus familias</p>
    </div>
  </div>
</body>
</html>`;

      // 4. Generar PDF (expo-print renderiza el HTML en un WebView)
      const { uri } = await Print.printToFileAsync({ html, base64: false });

      // 5. Compartir via native share sheet (imprimir, WhatsApp, Drive, etc.)
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('No disponible', 'El compartir archivos no está disponible en este dispositivo');
        return;
      }

      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Volante de ${pet.name}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo generar el volante');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, isGenerating && styles.disabled]}
      onPress={handleGenerate}
      disabled={isGenerating}
      activeOpacity={0.8}
    >
      {isGenerating ? (
        <ActivityIndicator size="small" color={COLORS.white} />
      ) : (
        <Text style={styles.label}>📄 Descargar volante PDF</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: COLORS.secondary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  disabled: { opacity: 0.6 },
  label: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
});
