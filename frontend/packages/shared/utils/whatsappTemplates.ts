// ============================================================
// SearchPet — WhatsApp Templates
// Utilidades puras para construir mensajes de WhatsApp.
// Pure TypeScript: sin imports de DOM, React Native ni side-effects.
// Compatible con Web y React Native.
// ============================================================

import type { PetStatus } from '../types';

interface PetForMessage {
  name: string;
  type: string;
  breed?: string;
  color?: string;
  description?: string;
  status: PetStatus;
}

const MAX_MESSAGE_LENGTH = 500;

/**
 * Construye el mensaje de WhatsApp para una mascota perdida/encontrada.
 * El mensaje nunca supera los 500 caracteres.
 * Si la descripción no cabe, se trunca. Nunca se trunca el nombre ni la URL.
 *
 * @param pet     Datos básicos de la mascota
 * @param shareUrl URL de share (opcional). Si no se provee, no se incluye.
 * @returns       Mensaje de texto listo para encodeURIComponent
 */
export function buildWhatsAppMessage(
  pet: PetForMessage,
  shareUrl?: string,
): string {
  const statusText = pet.status === 'found' ? 'ENCONTRADA' : 'PERDIDA';

  // Líneas fijas — siempre presentes
  const header = `🚨 ¡MASCOTA ${statusText}! 🚨`;
  const nameLine = `Nombre: ${pet.name}`;
  const typeLine = `Tipo: ${pet.type}`;
  const breedLine = pet.breed ? `Raza: ${pet.breed}` : '';
  const colorLine = pet.color ? `Color: ${pet.color}` : '';
  const urlLine = shareUrl ? `Ver más: ${shareUrl}` : '';
  const footer = 'Por favor, compartí si podés. 🙏';

  // Construimos sin descripción primero para saber el presupuesto disponible
  const fixedParts = [header, nameLine, typeLine, breedLine, colorLine, urlLine, footer]
    .filter(Boolean)
    .join('\n');

  if (!pet.description || fixedParts.length >= MAX_MESSAGE_LENGTH) {
    // Sin descripción — retornamos tal cual (truncado si excede)
    return fixedParts.slice(0, MAX_MESSAGE_LENGTH);
  }

  // Calculamos cuánto espacio queda para la descripción
  // +1 por el \n antes de la descripción
  const budget = MAX_MESSAGE_LENGTH - fixedParts.length - 1;

  if (budget <= 3) {
    // No hay espacio suficiente ni para "..."
    return fixedParts.slice(0, MAX_MESSAGE_LENGTH);
  }

  const description =
    pet.description.length <= budget
      ? pet.description
      : pet.description.slice(0, budget - 3) + '...';

  const allParts = [header, nameLine, typeLine, breedLine, colorLine, description, urlLine, footer]
    .filter(Boolean)
    .join('\n');

  return allParts.slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Construye la URL completa de WhatsApp para contactar al dueño.
 * Formato: https://wa.me/{phone}?text={encoded_message}
 * El teléfono se normaliza (se eliminan espacios, guiones y el símbolo +).
 *
 * @param phone   Número de teléfono del dueño
 * @param pet     Datos de la mascota
 * @param shareUrl URL de share (opcional)
 * @returns       URL lista para usar en href / Linking.openURL
 */
export function buildWhatsAppContactURL(
  phone: string,
  pet: PetForMessage,
  shareUrl?: string,
): string {
  // Normalizamos el teléfono: eliminamos +, espacios y guiones
  const normalizedPhone = phone.replace(/[+\s\-]/g, '');
  const message = buildWhatsAppMessage(pet, shareUrl);
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}
