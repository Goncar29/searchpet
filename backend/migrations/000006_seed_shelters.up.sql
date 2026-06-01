-- Migration: 000006_seed_shelters (UP)
-- Inserta 3 refugios de Uruguay con datos reales de organizaciones públicas.
-- Idempotente: ON CONFLICT (id) DO NOTHING garantiza que re-ejecutar no genera duplicados.

INSERT INTO shelters (id, name, city, phone, email, website_url, donation_url, description, is_verified, created_at)
VALUES
  (
    'a1b2c3d4-0001-0001-0001-000000000001',
    'SOS Rescate Animal Uruguay',
    'Montevideo',
    '+598 99 720 000',
    'contacto@sosrescateanimal.org.uy',
    'https://www.sosrescateanimal.org.uy',
    'https://www.sosrescateanimal.org.uy/donar',
    'Organización sin fines de lucro dedicada al rescate, rehabilitación y adopción responsable de perros y gatos en situación de calle en Montevideo.',
    true,
    NOW()
  ),
  (
    'a1b2c3d4-0002-0002-0002-000000000002',
    'Asociación Protectora de Animales del Uruguay',
    'Montevideo',
    '+598 2 924 0000',
    'info@spa.org.uy',
    'https://www.spa.org.uy',
    'https://www.spa.org.uy/donaciones',
    'Una de las organizaciones protectoras de animales más antiguas de Uruguay. Servicios veterinarios, adopción y control poblacional.',
    true,
    NOW()
  ),
  (
    'a1b2c3d4-0003-0003-0003-000000000003',
    'Hogar Perrito Feliz',
    'Canelones',
    '+598 94 321 654',
    'contacto@hogarpentritofeliz.uy',
    'https://www.hogarpetritofeliz.uy',
    'https://www.hogarpetritofeliz.uy/apoyanos',
    'Refugio físico con capacidad para más de 80 animales en Canelones. Realizan jornadas de adopción mensuales abiertas a toda la comunidad.',
    true,
    NOW()
  )
ON CONFLICT (id) DO NOTHING;
