const BACKEND_URL = process.env.VITE_API_URL ?? 'https://searchpet.onrender.com';

const STATUS_LABEL = {
  lost: '🚨 PERDIDA',
  stray: '🐾 CALLEJERA',
  registered: 'REGISTRADA',
  found: '✅ ENCONTRADA',
  archived: 'ARCHIVADA',
};

const DEFAULT_OG_IMAGE = 'https://searchpet.vercel.app/og/og-cover.png';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Cloudinary photos come in their original aspect ratio. The OG card is 1200x630,
// so we inject a fill transform to crop/resize the photo to that frame (g_auto keeps
// the subject centered). Non-Cloudinary URLs are returned untouched.
function toOgCard(url) {
  if (typeof url !== 'string' || !url.includes('/image/upload/')) return url;
  return url.replace('/image/upload/', '/image/upload/c_fill,w_1200,h_630,g_auto,f_auto,q_auto/');
}

function buildHTML(token, pet) {
  const photo = pet.photos?.find((p) => p.is_primary) ?? pet.photos?.[0];
  const imageUrl = photo?.url ? toOgCard(photo.url) : DEFAULT_OG_IMAGE;
  const statusText = STATUS_LABEL[pet.status] ?? pet.status?.toUpperCase() ?? '';
  const title = `${esc(pet.name)} — ${statusText} | SearchPet`;

  const descParts = [pet.type];
  if (pet.breed) descParts.push(pet.breed);
  if (pet.color) descParts.push(pet.color);
  if (pet.description) descParts.push(pet.description);
  const description = esc(descParts.join(' · '));

  const shareUrl = `https://searchpet.vercel.app/share/${token}`;
  const spaUrl = `/pet/${token}`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="description" content="${description}" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="SearchPet" />
  <meta property="og:url" content="${esc(shareUrl)}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${esc(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${esc(imageUrl)}" />

  <meta http-equiv="refresh" content="0; url=${spaUrl}" />
  <script>window.location.replace('${spaUrl}');</script>
</head>
<body></body>
</html>`;
}

function fallbackHTML(token) {
  const spaUrl = `/pet/${token}`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>SearchPet - Encuentra mascotas perdidas</title>
  <meta property="og:title" content="SearchPet - Encuentra mascotas perdidas" />
  <meta property="og:description" content="Plataforma gratuita para ayudar a encontrar mascotas perdidas." />
  <meta property="og:image" content="${DEFAULT_OG_IMAGE}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${DEFAULT_OG_IMAGE}" />
  <meta http-equiv="refresh" content="0; url=${spaUrl}" />
  <script>window.location.replace('${spaUrl}');</script>
</head>
<body></body>
</html>`;
}

export default async function handler(req, res) {
  const token = req.query.token;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  try {
    const upstream = await fetch(`${BACKEND_URL}/api/share/pet/${token}`);
    if (!upstream.ok) {
      return res.end(fallbackHTML(token));
    }
    const data = await upstream.json();
    return res.end(buildHTML(token, data.pet));
  } catch {
    return res.end(fallbackHTML(token));
  }
}
