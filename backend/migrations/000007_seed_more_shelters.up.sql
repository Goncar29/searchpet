-- Migration: 000007_seed_more_shelters (UP)
-- Agrega 4 refugios de Montevideo obtenidos de espacioanimal.uy.
-- Idempotente: ON CONFLICT (id) DO NOTHING garantiza que re-ejecutar no genera duplicados.

INSERT INTO shelters (id, name, city, phone, email, website_url, donation_url, description, is_verified, created_at)
VALUES
  (
    'b2c3d4e5-0004-0004-0004-000000000004',
    'APA El Refugio',
    'Montevideo',
    NULL,
    NULL,
    'https://www.apaelrefugio.org',
    'https://apaelrefugio.org/donaciones.html',
    'Organización sin fines de lucro fundada en 1999. Alberga más de 300 perros y 20 gatos rescatados de situaciones de abuso y abandono. Realizan campañas de castración, adopción responsable y educación sobre bienestar animal.',
    true,
    NOW()
  ),
  (
    'b2c3d4e5-0005-0005-0005-000000000005',
    'Bastet Rescate Felino',
    'Montevideo',
    NULL,
    'contacto@bastet.uy',
    'https://bastet.uy',
    'https://bastet.uy/colaboraciones/',
    'ONG fundada en 2016, registrada oficialmente en 2021. Rescatan gatos de situaciones de abuso y abandono, brindan atención veterinaria y facilitan adopciones responsables. Su chacra alberga más de 80 gatos rescatados.',
    true,
    NOW()
  ),
  (
    'b2c3d4e5-0006-0006-0006-000000000006',
    'Cafelino - Centro de Adopción de Gatos',
    'Montevideo',
    '+598 91 295 627',
    NULL,
    'https://cafelino.uy',
    'https://cafelino.uy/como-ayudar/',
    'Café y centro de adopción felina. Rescatan y cuidan gatos brindándoles apoyo físico, sanitario y emocional para mejorar sus chances de adopción. Se financian a través de su cafetería, tienda online y talleres de bienestar felino.',
    true,
    NOW()
  ),
  (
    'b2c3d4e5-0007-0007-0007-000000000007',
    'Liga Bichera Montevideo',
    'Montevideo',
    '+598 94 123 090',
    'contacto@ligabicheramontevideo.com.uy',
    'https://ligabichera.com.uy',
    'https://ligabichera.com.uy/quiero-ayudar/',
    'Organización sin fines de lucro dedicada a rescatar, curar, albergar y reubicar animales en situación de abandono. Trabajan a diario en operaciones de rescate y actividades comunitarias para ayudar a las mascotas más vulnerables.',
    true,
    NOW()
  )
ON CONFLICT (id) DO NOTHING;
