import { poligonoDesdeCentro, type CatalogoTus } from './modelo.ts'

// Initial catalog. The SAME values are inserted by the migration 20261007100000_tus_catalogo
// (a test checks both stay equal). After that, the administration panel is the source of truth:
// this seed is only used by in-memory compositions (tests / local) and as the first snapshot
// before the database is read. Ids of the pre-existing trades are kept (profiles and requests
// already store them).

export const SEMILLA_CATALOGO: CatalogoTus = {
  categorias: [
    { id: 'hogar', nombre: 'Hogar y reparaciones', slug: 'hogar', descripcion: 'Arreglos e instalaciones de la casa.', activo: true, orden: 1 },
    { id: 'construccion', nombre: 'Construcción', slug: 'construccion', descripcion: 'Obra, paredes y terminaciones.', activo: true, orden: 2 },
    { id: 'climatizacion', nombre: 'Climatización', slug: 'climatizacion', descripcion: 'Aire acondicionado y calefacción.', activo: true, orden: 3 },
    { id: 'vehiculos', nombre: 'Vehículos', slug: 'vehiculos', descripcion: 'Autos y motos.', activo: true, orden: 4 },
    { id: 'otros', nombre: 'Otros', slug: 'otros', descripcion: 'Servicios que todavía no tienen categoría propia.', activo: true, orden: 99 },
  ],
  oficios: [
    {
      id: 'plomeria', categoriaId: 'hogar', nombre: 'Plomería', profesion: 'Plomero/a', slug: 'plomeria', descripcion: null, icono: 'plomeria', activo: true, orden: 1,
      sinonimos: ['plomero', 'plomera', 'plomeria', 'caneria', 'cano', 'canilla', 'agua', 'perdida', 'perdida de agua', 'gotea', 'pierde', 'bacha', 'sifon', 'inodoro', 'deposito', 'termotanque', 'calefon', 'destapacion', 'destapar', 'cloaca', 'desague', 'griferia', 'bomba'],
    },
    {
      id: 'electricidad', categoriaId: 'hogar', nombre: 'Electricidad', profesion: 'Electricista', slug: 'electricidad', descripcion: null, icono: 'electricidad', activo: true, orden: 2,
      sinonimos: ['electricista', 'electricidad', 'luz', 'enchufe', 'tomacorriente', 'termica', 'disyuntor', 'tablero', 'cable', 'cortocircuito', 'corto', 'lampara', 'instalacion', 'electrica', 'instalacion electrica', 'ventilador', 'techo', 'ventilador de techo'],
    },
    {
      id: 'aire', categoriaId: 'climatizacion', nombre: 'Aire acondicionado', profesion: 'Técnico/a de aire acondicionado', slug: 'aire', descripcion: null, icono: 'aire', activo: true, orden: 3,
      sinonimos: ['aire', 'aire acondicionado', 'split', 'frio', 'enfria', 'calor', 'calefaccion', 'refrigeracion', 'gas', 'carga', 'climatizacion', 'equipo', 'equipo de aire'],
    },
    {
      id: 'pintura', categoriaId: 'construccion', nombre: 'Pintura', profesion: 'Pintor/a', slug: 'pintura', descripcion: null, icono: 'pintura', activo: true, orden: 4,
      sinonimos: ['pintor', 'pintora', 'pintura', 'pintar', 'humedad', 'enduido', 'techo', 'fachada'],
    },
    {
      id: 'albanileria', categoriaId: 'construccion', nombre: 'Albañilería', profesion: 'Albañil', slug: 'albanileria', descripcion: null, icono: 'albanileria', activo: true, orden: 5,
      sinonimos: ['albanil', 'albanileria', 'pared', 'paredes', 'revoque', 'mamposteria', 'ladrillo', 'contrapiso', 'construccion', 'obra'],
    },
    {
      id: 'cerrajeria', categoriaId: 'hogar', nombre: 'Cerrajería', profesion: 'Cerrajero/a', slug: 'cerrajeria', descripcion: null, icono: 'cerrajeria', activo: true, orden: 6,
      sinonimos: ['cerrajero', 'cerrajera', 'cerrajeria', 'cerradura', 'llave', 'llaves', 'puerta trabada', 'me quede afuera'],
    },
    {
      id: 'mecanica', categoriaId: 'vehiculos', nombre: 'Mecánica', profesion: 'Mecánico/a', slug: 'mecanica', descripcion: null, icono: 'mecanica', activo: true, orden: 7,
      sinonimos: ['mecanico', 'mecanica', 'auto', 'moto', 'freno', 'frenos', 'motor', 'bateria', 'cubierta', 'aceite', 'embrague', 'arranca'],
    },
    {
      id: 'otros', categoriaId: 'otros', nombre: 'Otros oficios', profesion: 'Oficios varios', slug: 'otros', descripcion: null, icono: 'herramienta', activo: true, orden: 99,
      sinonimos: ['carpintero', 'carpinteria', 'mueble', 'placard', 'armado', 'jardin', 'jardinero', 'mudanza', 'tecnico', 'reparacion', 'porton'],
    },
  ],
  localidades: [{ id: 'corrientes-capital', nombre: 'Corrientes Capital', provincia: 'Corrientes', activo: true, orden: 1 }],
  // Zones are defined by the administration (none is assumed).
  zonas: [],
  barrios: [
    { nombre: 'Centro', lat: -27.4695, lng: -58.8295 },
    { nombre: 'Camba Cuá', lat: -27.4765, lng: -58.8215 },
    { nombre: 'La Rosada', lat: -27.4805, lng: -58.8345 },
    { nombre: 'Barrio Sur', lat: -27.4755, lng: -58.8415 },
    { nombre: 'San Gerónimo', lat: -27.4795, lng: -58.8155 },
    { nombre: '1000 Viviendas', lat: -27.4855, lng: -58.829 },
    { nombre: 'Libertad', lat: -27.4835, lng: -58.8005 },
    { nombre: 'San Benito', lat: -27.4905, lng: -58.8165 },
    { nombre: 'Laguna Seca', lat: -27.4945, lng: -58.7855 },
    { nombre: 'Pirayuí', lat: -27.5035, lng: -58.7735 },
    { nombre: 'Molina Punta', lat: -27.5135, lng: -58.7905 },
  ].map((barrio, index) => ({
    id: `barrio-${slug(barrio.nombre)}`,
    localidadId: 'corrientes-capital',
    zonaId: null,
    nombre: barrio.nombre,
    slug: slug(barrio.nombre),
    lat: barrio.lat,
    lng: barrio.lng,
    poligono: poligonoDesdeCentro(barrio.lat, barrio.lng),
    activo: true,
    orden: index + 1,
  })),
}

function slug(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
}
