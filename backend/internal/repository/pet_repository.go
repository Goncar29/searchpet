package repository

import (
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// PostgresPetRepository es la IMPLEMENTACIÓN concreta que habla con PostgreSQL.
// El * en el receiver significa que trabajamos con la referencia real, no una copia.
type PostgresPetRepository struct {
	db *gorm.DB
}

// NewPetRepository es el constructor — recibe la conexión y devuelve el repository.
// Nota: devuelve la INTERFAZ, no el struct concreto. Esto es Dependency Injection.
func NewPetRepository(db *gorm.DB) PetRepository {
	return &PostgresPetRepository{db: db}
}

// orderedPhotos is a GORM preload scope that loads a pet's photos oldest-first.
// The first uploaded photo is the canonical/primary one shown everywhere (feed,
// detail, my pets, share landing, PDF), so the order must be deterministic and
// not depend on Postgres heap order. Backlog #17.
func orderedPhotos(db *gorm.DB) *gorm.DB {
	return db.Order("photos.created_at ASC, photos.id ASC")
}

// microchipUniqueIndex es el índice que crea el tag `uniqueIndex` de
// Pet.MicrochipID. Se compara por NOMBRE y no sólo por el SQLSTATE porque la
// tabla puede ganar otros índices únicos: mapear cualquier 23505 a
// "microchip_taken" le mentiría al usuario sobre qué campo corregir.
const microchipUniqueIndex = "idx_pets_microchip_id"

// pgUniqueViolation es el SQLSTATE 23505. Se declara acá en vez de traer
// github.com/jackc/pgerrcode: es UNA constante, y el valor lo fija el estándar
// SQL, no la librería. Sumar un módulo entero al grafo de dependencias por un
// string de cinco caracteres es superficie de supply chain a cambio de nada.
const pgUniqueViolation = "23505"

// translatePetWriteError convierte los errores del DRIVER en errores de
// dominio. Vive en el repositorio a propósito: es la única capa que puede
// conocer a Postgres, y ponerlo más arriba obligaría al servicio a importar
// pgconn — justo lo que las interfaces de repositorio existen para evitar.
//
// Y hay una razón práctica además de la arquitectónica: una callejera se crea
// dentro de uow.Execute y una registrada por el repo directo. Los dos caminos
// pasan por este Create (la UoW construye NewPetRepository(tx)), así que acá la
// traducción se aplica una vez y cubre a los dos. En el servicio habría que
// acordarse en cada rama, y olvidarse no da error: devuelve 500 en silencio.
//
// Lo que NO se traduce se devuelve tal cual: un error desconocido tiene que
// seguir saliendo como 500, que es la respuesta honesta ante algo que no
// entendemos.
func translatePetWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == microchipUniqueIndex {
		return domain.ErrMicrochipTaken
	}
	return err
}

// Create inserta una nueva mascota en la BD.
func (r *PostgresPetRepository) Create(pet *domain.Pet) error {
	return translatePetWriteError(r.db.Create(pet).Error)
}

// FindByID busca una mascota por su UUID y carga el owner.
// Preload("Owner") hace un segundo SELECT para traer los datos del usuario.
func (r *PostgresPetRepository) FindByID(id string) (*domain.Pet, error) {
	var pet domain.Pet
	err := r.db.Preload("Owner").Preload("Reporter").Preload("Photos", orderedPhotos).Where("id = ?", id).First(&pet).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrPetNotFound
		}
		return nil, err
	}
	return &pet, nil
}

// FindByOwnerID devuelve todas las mascotas de un usuario con el owner cargado.
func (r *PostgresPetRepository) FindByOwnerID(ownerID string) ([]domain.Pet, error) {
	var pets []domain.Pet
	err := r.db.Preload("Owner").Preload("Photos", orderedPhotos).Where("owner_id = ?", ownerID).Order("created_at DESC").Find(&pets).Error
	return pets, err
}

// FindByReporterID devuelve las mascotas callejeras (stray) que reportó un usuario.
func (r *PostgresPetRepository) FindByReporterID(reporterID string) ([]domain.Pet, error) {
	var pets []domain.Pet
	err := r.db.Preload("Photos", orderedPhotos).Where("reporter_id = ?", reporterID).Order("created_at DESC").Find(&pets).Error
	return pets, err
}

// FindStrayCandidates — ver el contrato completo en repository/interfaces.go.
//
// La única consulta de mascotas que NO pasa por straySightingNotExpired: el
// mapa, el feed y el perfil público existen para no mostrar avistamientos
// viejos, y ésta existe justo para lo contrario — mostrarle a quien va a
// publicar los avistamientos vencidos que las otras tres pantallas esconden,
// para que no termine duplicando un animal que la comunidad ya reportó.
func (r *PostgresPetRepository) FindStrayCandidates(c domain.StrayCandidateCriteria) ([]domain.StrayCandidate, error) {
	// c.Lat/c.Lng se embeben más abajo como literal numérico vía fmt.Sprintf
	// ("%g"), no como parámetro `?`. Eso no es una inyección — el tipo no es
	// texto controlado por el usuario — pero SÍ es un 500 alcanzable desde un
	// parámetro de query real: "%g" de NaN/+Inf/-Inf imprime literalmente
	// "NaN"/"+Inf"/"-Inf", y Postgres interpreta eso como un IDENTIFICADOR de
	// columna suelto, no como un número — devuelve
	// `column "nan" does not exist` (42703) en vez de un 400 legible.
	// Y strconv.ParseFloat("NaN", 64) TIENE ÉXITO: cada handler de lat/lng de
	// este repo parsea así, sin chequeo de finitud, así que el día que el
	// handler de este endpoint exista, `?lat=NaN` se cuela derecho hasta acá.
	// El invariante ("las coordenadas son finitas") vive en el mismo lugar
	// que arma el SQL a partir de ellas — no en cada llamador futuro, que es
	// exactamente el tipo de guardia que este repo trata como no-parámetro
	// (ver StrayCandidateRadiusMeters/StrayCandidateLimit): si dependiera de
	// que cada caller recuerde validar, un caller que se olvide lo rompe.
	if math.IsNaN(c.Lat) || math.IsNaN(c.Lng) || math.IsInf(c.Lat, 0) || math.IsInf(c.Lng, 0) {
		return nil, domain.ErrInvalidInput
	}

	var cands []domain.StrayCandidate

	// El SELECT y el ORDER BY usan fmt.Sprintf para embeber los float64
	// directo, igual que en FindNearby (report_repository.go): gorm.Expr con
	// `?` puede perder el ORDER BY en expresiones PostGIS en algunas versiones
	// de GORM. Sin riesgo de inyección — el tipo no es texto controlado por el
	// usuario. (La guarda de arriba es la que cubre el otro riesgo: un literal
	// no-finito colándose como identificador.)
	distExpr := fmt.Sprintf(
		"ST_Distance(ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(%g, %g), 4326)::geography)",
		c.Lng, c.Lat,
	)

	// photoSubquery elige la foto de la tarjeta: la primaria si existe,
	// si no la más vieja (mismo criterio que fotoDelMarcador en
	// dto/report_dto.go). Va en una subconsulta CORRELACIONADA aparte, no en
	// un LEFT JOIN como antes: con el GROUP BY de más abajo, un LEFT JOIN a
	// photos multiplicaría cada fila de reports por cada foto de la mascota y
	// arruinaría el MIN/MAX — agregación y selección de fila no se mezclan
	// bien en un solo JOIN, así que se resuelven por separado.
	//
	// Antes esto era `LEFT JOIN photos ON ... AND photos.is_primary = true`,
	// que da photo_url = '' apenas NINGUNA fila tiene el flag — y eso es
	// alcanzable: photo_service.go DeletePhoto borra una foto sin promover
	// reemplazo, así que una mascota puede tener fotos y ninguna primaria.
	photoSubquery := `COALESCE((
		SELECT photos.url FROM photos
		WHERE photos.pet_id = pets.id
		ORDER BY photos.is_primary DESC, photos.created_at ASC, photos.id ASC
		LIMIT 1
	), '') AS photo_url`

	// GROUP BY reemplaza al DISTINCT ON de antes, y no es un cambio cosmético
	// — es el fix del hallazgo #3. Con DISTINCT ON, last_seen_at salía de
	// COALESCE(pets.last_reported_at, pets.created_at): una columna que
	// TouchLastReported actualiza comparando SÓLO timestamps, sin geografía
	// (ver más abajo en este archivo), así que agrega TODOS los reportes de
	// la mascota sin importar dónde. distance_meters, en cambio, ya sólo veía
	// los reportes DENTRO del radio (por el WHERE ST_DWithin). Esa mezcla
	// podía mostrar "a 120 m · visto hace 2 horas" cuando el avistamiento de
	// hace 2 horas fue en realidad a 30 km — una combinación que nunca
	// ocurrió, y que un usuario lee como "está activo acá cerca".
	//
	// Agregando sobre el JOIN a reports (que YA está acotado por el mismo
	// WHERE ST_DWithin que acota distance_meters), MIN(dist) y
	// MAX(COALESCE(occurred_at, created_at)) leen exactamente el mismo
	// conjunto de reportes: los que están dentro del radio. El reloj y la
	// distancia vuelven a describir el mismo avistamiento.
	//
	// `GROUP BY pets.id` alcanza para poder seleccionar pets.name y pets.type
	// sin agregarlas: Postgres permite referenciar cualquier columna de una
	// tabla agrupada por su PRIMARY KEY (dependencia funcional, desde 9.1), y
	// pets.id lo es.
	//
	// Nota: esto es estrictamente MÁS ANGOSTO que antes — nunca va a mostrar
	// una fecha más reciente que la que ya mostraba, porque el máximo ahora
	// corre sobre un subconjunto de los reportes que antes entraban en el
	// COALESCE. No puede resucitar nada que la caducidad de 90 días escondiera
	// en otra pantalla: sigue siendo la misma consulta que ignora
	// straySightingNotExpired a propósito, sólo que el reloj que muestra ahora
	// es honesto sobre A QUÉ avistamiento pertenece.
	inner := r.db.Table("pets").
		Select(fmt.Sprintf(
			"pets.id AS pet_id, pets.name AS name, pets.type AS type, %s, MIN(%s) AS distance_meters, MAX(COALESCE(reports.occurred_at, reports.created_at)) AS last_seen_nearby_at",
			photoSubquery, distExpr,
		)).
		Joins("JOIN reports ON reports.pet_id = pets.id").
		Where("pets.status = ?", domain.PetStatusStray).
		Where(`
			ST_DWithin(
				ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
				?
			)
		`, c.Lng, c.Lat, domain.StrayCandidateRadiusMeters).
		Group("pets.id")

	if c.PetType != "" {
		inner = inner.Where("pets.type = ?", c.PetType)
	}

	// A propósito, tres cosas que esta consulta NO hace y las demás sí:
	//
	//   - Sin filtro de episodio (a diferencia de FindNearby). Ese filtro
	//     existe para que el mapa de una búsqueda activa no mezcle pines de
	//     episodios viejos; acá la pregunta es "¿este animal ya está
	//     registrado?" y un episodio cerrado no cambia la respuesta. Además
	//     current_episode_id es NULLABLE y compararlo contra NULL da NULL —
	//     eso excluiría en SILENCIO a todo callejero sin episodio abierto,
	//     justo lo contrario de lo que esta consulta necesita mostrar.
	//
	//   - Sin Preload de Owner ni Reporter. Esta lista se muestra para
	//     RECONOCER un animal, no para contactar a nadie, y PetResponse expone
	//     el teléfono del dueño sin condición (ver la lección del preload de
	//     Owner en el perfil público: "el dato ya es público en otro lado" no
	//     equivale a "este camino no agrega exposición").
	//
	//   - Sin straySightingNotExpired. Es la razón de ser de esta consulta —
	//     ver el contrato completo en interfaces.go.
	err := r.db.Table("(?) AS candidates", inner).
		Order("distance_meters ASC").
		Limit(domain.StrayCandidateLimit).
		Find(&cands).Error

	return cands, err
}

// publicProfilePetLimit acota la lista del perfil público.
//
// El riesgo no es un atacante, es un usuario EXITOSO: la lista no muestra "las
// mascotas que tenés ahora" sino todo lo publicado y no archivado, y
// `reporter_id` acumula cada callejero que esa persona reportó en su vida. Un
// refugio junta cientos de filas con el tiempo, y cada tarjeta pide una
// miniatura: el bandwidth de Cloudinary es el cuello del plan gratuito.
//
// El tope viaja SIEMPRE con su total (ver CountPublicByUserID): un LIMIT mudo
// mostraría 50 de 300 sin que nada lo diga, y cambiaría "es caro" por "es
// mentira".
const publicProfilePetLimit = 50

// publicProfileScope es la ÚNICA definición de "lo que un tercero ve en el
// perfil de esta persona". La comparten FindPublicByUserID y
// CountPublicByUserID a propósito: si cada una tuviera su copia del WHERE,
// divergirían en silencio y la pantalla diría "50 de N" contando N sobre
// otro conjunto — y ninguno de los dos números se vería mal por separado.
//
// Devuelve un *gorm.DB nuevo, clonado de r.db, en cada llamada — no hay
// estado que una invocación pueda dejarle a la siguiente.
// El vencimiento de avistamientos entra ACÁ y no en cada método por el mismo
// motivo que existe este scope: si lo aplicara sólo la lista, la pantalla diría
// "N de M" con un M que cuenta otro conjunto, y ninguno de los dos números se
// vería mal por separado. Entrando en el scope compartido, el acuerdo entre
// FindPublicByUserID y CountPublicByUserID se mantiene solo.
func (r *PostgresPetRepository) publicProfileScope(userID string) *gorm.DB {
	expiryClause, expiryArgs := straySightingNotExpired()
	return r.db.Model(&domain.Pet{}).
		Where("(pets.owner_id = ? OR pets.reporter_id = ?) AND pets.status IN ?", userID, userID, domain.PublicProfileVisibleStatuses).
		Where(expiryClause, expiryArgs...)
}

// FindPublicByUserID — ver el contrato en repository/interfaces.go.
//
// Sin Preload("Owner") a propósito: CreatePet setea owner XOR reporter, así
// que la única persona que este preload podría traer es la dueña del perfil
// que ya se está mirando — el cliente ya la tiene por GET /users/:id/profile.
// Preloadearla acá filtraría su teléfono (PetOwnerResponse lo expone
// incondicional) en un endpoint público y sin auth.
func (r *PostgresPetRepository) FindPublicByUserID(userID string) ([]domain.Pet, error) {
	var pets []domain.Pet
	err := r.publicProfileScope(userID).
		Preload("Photos", orderedPhotos).
		Order("created_at DESC").
		Limit(publicProfilePetLimit).
		Find(&pets).Error
	return pets, err
}

// CountPublicByUserID — ver el contrato en repository/interfaces.go. Mismo
// scope que FindPublicByUserID (publicProfileScope), sin Limit ni Order (un
// COUNT no necesita orden) y sin Preload (no trae filas, no hay nada que
// precargar).
func (r *PostgresPetRepository) CountPublicByUserID(userID string) (int64, error) {
	var total int64
	err := r.publicProfileScope(userID).Count(&total).Error
	return total, err
}

// TouchLastReported — ver el contrato en repository/interfaces.go.
//
// La monotonía vive en el WHERE y no en Go a propósito. Leer el valor, comparar
// en memoria y escribir sería un read-modify-write: dos reportes concurrentes de
// la misma mascota leerían el mismo valor viejo y el último en escribir ganaría,
// que es exactamente cómo se pierde el avistamiento más reciente. Acá la
// comparación y la escritura son la misma sentencia.
//
// RowsAffected == 0 NO es un error: significa que el valor guardado ya era más
// nuevo, que es el caso que esta guarda existe para producir. También cubre "la
// mascota no existe", pero eso es inalcanzable desde el único llamador: el
// reporte se inserta antes en la misma transacción y su FK a pets ya habría
// fallado.
func (r *PostgresPetRepository) TouchLastReported(id string, seen time.Time) error {
	return r.db.Model(&domain.Pet{}).
		Where("id = ?", id).
		Where("last_reported_at IS NULL OR last_reported_at < ?", seen).
		Update("last_reported_at", seen).Error
}

// RecomputeLastReported — ver el contrato en repository/interfaces.go.
//
// La subconsulta es LA MISMA que el backfill de la migración 000025:
// MAX(COALESCE(occurred_at, created_at)) sobre los reportes de esa mascota. No
// es duplicación por comodidad — es la condición para que borrar un reporte deje
// la columna en el mismo valor que tendría si la migración volviera a correr.
// Si alguna de las dos cambia, la otra tiene que cambiar igual.
//
// Sin WHERE de monotonía a propósito: éste es el único camino autorizado a bajar
// el reloj, y ponerle la guarda lo volvería un no-op justo en el caso para el
// que existe.
func (r *PostgresPetRepository) RecomputeLastReported(id string) error {
	return r.db.Model(&domain.Pet{}).
		Where("id = ?", id).
		Update("last_reported_at", r.db.
			Table("reports").
			Select("MAX(COALESCE(occurred_at, created_at))").
			Where("pet_id = ?", id),
		).Error
}

// Update guarda los cambios de una mascota existente.
//
// `Omit("last_reported_at")` no es una optimización: es lo que le da UN SOLO
// ESCRITOR a esa columna. `Save` escribe todas las columnas del struct, y el
// struct viene de un FindByID anterior a la mutación, así que sin el Omit un
// guardado cualquiera reescribe el reloj con el valor que leyó — rodeando por
// afuera la guarda de monotonía, que vive dentro del UPDATE de
// TouchLastReported y no puede protegerse de un Save que no pasa por ahí.
//
// El caso no necesita mala suerte: el dueño abre el formulario de edición,
// entra un avistamiento, y al guardar la descripción el reloj retrocede (o
// vuelve a NULL, si estaba en NULL al cargar). Lo protege
// TestPetRepository_Update_NoPisaElRelojDeUltimaVista.
//
// Corolario para cualquier columna que se agregue con su propio escritor: acá
// hay que sumarla al Omit, o Save se la lleva puesta en silencio.
func (r *PostgresPetRepository) Update(pet *domain.Pet) error {
	return r.db.Omit("last_reported_at").Save(pet).Error
}

// UpdateStatus actualiza solo la columna status de una mascota.
func (r *PostgresPetRepository) UpdateStatus(id string, status string) error {
	return r.db.Model(&domain.Pet{}).Where("id = ?", id).Update("status", status).Error
}

// Search aplica filtros opcionales y devuelve resultados paginados con el total.
// Implementa FR1.1 (filtros), FR1.2 (combinables), FR1.5 (date range por report).
// When Statuses is empty, defaults to FeedVisibleStatuses (lost, stray).
// When Statuses is non-empty, uses an IN clause with the provided values.
func (r *PostgresPetRepository) Search(filters domain.PetSearchCriteria) ([]domain.Pet, int64, error) {
	// Normalizamos paginación
	page := filters.Page
	if page < 1 {
		page = 1
	}
	limit := filters.Limit
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	// Determine the status filter — default to feed-visible statuses (lost, stray)
	statuses := filters.Statuses
	if len(statuses) == 0 {
		statuses = domain.FeedVisibleStatuses
	}

	// Construimos la query base con Preload
	q := r.db.Model(&domain.Pet{}).
		Preload("Owner").
		Preload("Photos", orderedPhotos).
		Where("pets.status IN (?)", statuses)

	// La caducidad se levanta cuando quien consulta pregunta por una VENTANA DEL
	// PASADO, y sólo entonces.
	//
	// La primera versión ató la escotilla a `len(filters.Statuses) == 0`,
	// afirmando que era "exactamente esa distinción y no un proxy". Era un proxy,
	// y de los malos: lo que medía es "vino un parámetro de estado", no "alguien
	// está buscando a propósito". HomePage ofrece `stray` en su desplegable de
	// filtros, así que un click desde la portada devolvía TODOS los vencidos
	// mezclados con los frescos, ordenados por fecha de alta y sin ningún cartel
	// — la queja del #218 servida en la superficie que este filtro protege.
	//
	// La cota INFERIOR sí expresa la intención. Alguien que perdió su perro el 1
	// de abril, entra en agosto y pide desde esa semana está haciendo el cruce
	// histórico, y TODO lo que busca está vencido por definición: si el rango no
	// se los devolviera, el plazo de 90 días no protegería nada. En cambio elegir
	// un estado sólo dice qué tipo de mascota querés ver, y se puede hacer sin
	// salir del feed.
	//
	// Mira `From` y NO "vino algún rango", y esa diferencia es el hallazgo
	// R3-asymmetric-range: las dos cotas no significan lo mismo. `to` sin `from`
	// no pone piso, así que la ventana llega hasta el origen de los tiempos —
	// levantar la caducidad ahí devuelve el histórico vencido ENTERO, que es
	// justo lo que este filtro existe para evitar. Y es alcanzable desde la
	// portada: HomePage manda las dos cotas por separado, con inputs
	// independientes, así que llenar sólo "Hasta" lo disparaba.
	//
	// Con `from` puesto no hace falta mirar nada más: si es reciente, los
	// reportes de un vencido quedan fuera por el propio filtro de fechas; si es
	// antiguo, es un cruce histórico legítimo. Correcto en los dos casos.
	//
	// Comparar `To` contra el corte cerraría también el caso "todo lo visto antes
	// del 15/4", pero ataría el predicado al PLAZO, que se dejó fuera de los
	// parámetros a propósito. Se prefiere la condición simple.
	//
	// La misma regla vale para el mapa (FindNearby), que tiene su propio From/To.
	// Una sola condición para las dos consultas, no dos criterios distintos.
	//
	// Va acá y no más arriba en el servicio ni en el cliente: una fila que no se
	// tiene que ver no tiene que salir de Postgres. Mismo criterio que la
	// allowlist del perfil público.
	if filters.From == nil {
		expiryClause, expiryArgs := straySightingNotExpired()
		q = q.Where(expiryClause, expiryArgs...)
	}

	// Filtros exactos / parciales
	if filters.Type != "" {
		q = q.Where("pets.type = ?", filters.Type)
	}
	if filters.Breed != "" {
		q = q.Where("pets.breed ILIKE ?", "%"+filters.Breed+"%")
	}
	if filters.Color != "" {
		q = q.Where("pets.color ILIKE ?", "%"+filters.Color+"%")
	}
	if filters.City != "" {
		q = q.Where("pets.city ILIKE ?", "%"+filters.City+"%")
	}

	// Filtros que requieren JOIN a reports: rango de fechas (FR1.5) y/o
	// distancia geográfica opcional. Una mascota matchea si tiene AL MENOS un
	// reporte que cumple todas las condiciones de reporte simultáneamente.
	hasGeo := filters.Lat != nil && filters.Lng != nil && filters.RadiusMeters != nil
	if filters.From != nil || filters.To != nil || hasGeo {
		q = q.Joins("JOIN reports ON reports.pet_id = pets.id")
		if filters.From != nil {
			q = q.Where("reports.occurred_at >= ?", filters.From)
		}
		if filters.To != nil {
			q = q.Where("reports.occurred_at <= ?", filters.To)
		}
		if hasGeo {
			q = q.Where(
				"ST_DWithin(ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)",
				*filters.Lng, *filters.Lat, *filters.RadiusMeters,
			)
		}

		// Count distinct pets using a fresh Session so the single-column Distinct
		// below does not bleed into the Find query. GORM emits
		// COUNT(DISTINCT(pets.id)) for a single-column Distinct; the multi-column
		// string variant (used for Find) falls back to count(*) on GORM v1.25.
		var total int64
		if err := q.Session(&gorm.Session{}).Distinct("pets.id").Count(&total).Error; err != nil {
			return nil, 0, err
		}

		// Evitamos duplicados si hay múltiples reports que matchean.
		//
		// `pets.*` y NO una lista de columnas escrita a mano. Esa lista existió
		// hasta hoy y ya había divergido en silencio: le faltaban birth_date,
		// birth_date_precision, current_episode_id y reporter_contact_public,
		// así que una búsqueda CON filtro geográfico devolvía esas cuatro en
		// cero mientras la misma búsqueda SIN geo las devolvía bien. No hay
		// error, no hay warning: el struct se llena igual, con el valor vacío
		// del tipo.
		//
		// Es la peor forma de falla para una columna nueva, porque la mitad de
		// los caminos la muestran correcta. Una lista que hay que acordarse de
		// actualizar es una invariante disfrazada de configuración: olvidarse
		// no da error, sólo pierde datos.
		//
		// Dedupe idéntico: `pets.id` es PK, así que DISTINCT sobre la fila
		// entera de `pets` colapsa exactamente los mismos duplicados que la
		// lista enumerada. Y el ORDER BY sigue siendo válido bajo DISTINCT
		// porque `pets.created_at` está dentro de `pets.*`.
		q = q.Distinct("pets.*")

		// Paginación
		var pets []domain.Pet
		offset := (page - 1) * limit
		err := q.Order("pets.created_at DESC").Offset(offset).Limit(limit).Find(&pets).Error
		if err != nil {
			return nil, 0, err
		}
		return pets, total, nil
	}

	// Count total ANTES de paginar (no JOIN path — no deduplication needed)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Paginación
	var pets []domain.Pet
	offset := (page - 1) * limit
	err := q.Order("pets.created_at DESC").Offset(offset).Limit(limit).Find(&pets).Error
	if err != nil {
		return nil, 0, err
	}

	return pets, total, nil
}

// Delete elimina una mascota y todas sus dependencias dentro de una transacción.
// El orden importa: primero las tablas hijas, después la pet.
func (r *PostgresPetRepository) Delete(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("pet_id = ?", id).Delete(&domain.SuccessStory{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.LocationAlert{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.ShareLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.Report{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pet_id = ?", id).Delete(&domain.Photo{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&domain.Pet{}).Error
	})
}
