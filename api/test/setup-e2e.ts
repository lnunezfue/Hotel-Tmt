import 'dotenv/config';

// La API corre con la zona de Perú mientras MySQL guarda UTC: si algo desplazara las fechas
// por la zona del proceso, las pruebas de renovación lo detectarían (spec §12, Review Focus 3).
process.env.TZ = 'America/Lima';
process.env.NODE_ENV = 'test';
process.env.LIMITE_AUTH_POR_MIN ??= '1000';
