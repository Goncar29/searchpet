package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// PostgresReportRepository es la implementación concreta que habla con PostgreSQL.
type PostgresReportRepository struct {
	db *gorm.DB
}

// reportSightingTimeExpr is when a report's sighting happened: occurred_at when
// the user entered it, otherwise when the report was filed. occurred_at is
// optional and usually NULL, so filtering on the bare column silently drops
// most reports. The map (FindNearby) and the search (PetRepository.Search) date
// ranges both use this one expression so they cannot drift apart again.
const reportSightingTimeExpr = "COALESCE(reports.occurred_at, reports.created_at)"

// NewReportRepository es el constructor.
func NewReportRepository(db *gorm.DB) ReportRepository {
	return &PostgresReportRepository{db: db}
}

// Create inserta un nuevo reporte en la BD.
func (r *PostgresReportRepository) Create(report *domain.Report) error {
	return r.db.Create(report).Error
}

// FindByID busca un reporte por su UUID y carga la mascota y el reporter.
func (r *PostgresReportRepository) FindByID(id string) (*domain.Report, error) {
	var report domain.Report
	err := r.db.Preload("Pet").Preload("Pet.Photos").Preload("Reporter").Where("id = ?", id).First(&report).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrReportNotFound
		}
		return nil, err
	}
	return &report, nil
}

// FindByPetID devuelve todos los reportes de una mascota, del más reciente al más viejo.
// Usa COALESCE(occurred_at, created_at) para que las fechas reales de avistamiento
// tengan prioridad sobre la fecha de creación del reporte.
func (r *PostgresReportRepository) FindByPetID(petID string) ([]domain.Report, error) {
	var reports []domain.Report
	err := r.db.Preload("Pet").Preload("Pet.Photos").Preload("Reporter").
		Where("pet_id = ?", petID).
		Order("COALESCE(occurred_at, created_at) DESC").
		Find(&reports).Error
	return reports, err
}

// UpdateVerified marca un reporte como verificado (admin action).
// Persiste verified = true, verified_by = verifiedBy, verified_at = now.
func (r *PostgresReportRepository) UpdateVerified(ctx context.Context, id uuid.UUID, verifiedBy uuid.UUID) error {
	now := time.Now()
	result := r.db.WithContext(ctx).
		Model(&domain.Report{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"is_verified": true,
			"verified_by": verifiedBy,
			"verified_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrReportNotFound
	}
	return nil
}

// Delete elimina un reporte por id (acción de moderación admin).
// Hard delete: el report es una fila casi-hoja (las fotos cuelgan del Pet y
// Message.ReportID es un puntero nullable sin FK que bloquee).
func (r *PostgresReportRepository) Delete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).Where("id = ?", id).Delete(&domain.Report{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrReportNotFound
	}
	return nil
}

// SetEpisodeID stamps an existing report with its search episode ID.
func (r *PostgresReportRepository) SetEpisodeID(reportID string, episodeID uuid.UUID) error {
	return r.db.Model(&domain.Report{}).Where("id = ?", reportID).
		Update("episode_id", episodeID).Error
}

// FindNearby busca reportes dentro de un radio usando PostGIS.
// ST_DWithin verifica si dos puntos están dentro del radio en metros.
// ST_Distance calcula la distancia exacta para ordenar los resultados del más cercano al más lejano.
func (r *PostgresReportRepository) FindNearby(c domain.NearbyReportCriteria) ([]domain.Report, error) {
	var reports []domain.Report

	// ORDER BY uses fmt.Sprintf to embed float64 values directly — gorm.Expr with ?
	// params can silently drop ordering for PostGIS expressions in some GORM versions.
	// Embedding float64 is safe: no injection risk since the type is not user-controlled text.
	orderExpr := fmt.Sprintf(
		"ST_Distance(ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(%g, %g), 4326)::geography) ASC",
		c.Lng, c.Lat,
	)

	// JOIN pets and filter on the pet's CURRENT status (MapVisibleStatuses:
	// lost, stray, found). A report belongs to the nearby feed only while its
	// pet is an active search OR was just recovered (found) — without this,
	// stale reports of re-registered/archived pets would keep surfacing,
	// leaking closed cases and others' now-private pets. The JOIN assumes the
	// pets table has no soft-delete scope (it currently doesn't); if Pet ever
	// gains gorm.DeletedAt, this needs an explicit deleted_at IS NULL guard.
	//
	// The episode scope ensures that when a pet is re-lost, only the NEW
	// episode's pins appear on the map. Reports with a NULL episode_id (or
	// whose episode_id differs from pets.current_episode_id) are excluded.
	// CloseCurrent intentionally leaves current_episode_id intact so that a
	// just-found pet's "recovered here" marker remains visible.
	//
	// Todo lo de este bloque es INCONDICIONAL: la allowlist de visibilidad y el
	// alcance del episodio no dependen de ningún criterio del usuario.
	// `Pet.Photos` va SIN Limit a propósito. GORM aplica el Limit de un Preload a
	// la consulta ENTERA, no por padre: un `Limit(1)` acá devolvería una sola foto
	// para TODAS las mascotas de la página, no una por mascota. La poda a una foto
	// la hace el DTO, que sí sabe de a qué mascota pertenece cada una.
	// Sigue siendo una consulta extra (IN de todos los pet_id), no un N+1.
	q := r.db.Preload("Pet").Preload("Pet.Photos").Preload("Reporter").
		Joins("JOIN pets ON pets.id = reports.pet_id").
		Where("pets.status IN (?)", domain.MapVisibleStatuses).
		Where("reports.episode_id = pets.current_episode_id").
		Where(`
			ST_DWithin(
				ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
				?
			)
		`, c.Lng, c.Lat, c.RadiusMeters)

	// Los filtros del usuario se SUMAN a lo de arriba, nunca lo reemplazan.
	// Por eso van como Where encadenados y no como parte de esa expresión:
	// acotan dentro de la allowlist y no pueden alcanzar un reporte que ella
	// ya excluyó. Lo protege TestReportRepository_FindNearby_ElFiltroNoEnsanchaLaAllowlist.
	// La caducidad se levanta con una cota INFERIOR de fechas, exactamente igual
	// que en Search — misma condición, no dos criterios que se desincronicen. El
	// mapa tiene su propio From y ÉSE es el cruce histórico acá: alguien pide
	// "qué se vio cerca de mi casa desde la semana que se me escapó", y todo lo
	// que busca está vencido por definición.
	//
	// La primera versión lo aplicaba incondicional, y ese filtro de fechas
	// devolvía vacío: se leía como "nadie vio nada" en vez de "lo escondimos",
	// una mentira peor que el pin viejo que se quería sacar. La segunda lo ató a
	// "vino algún rango", y ahí `to` sin `from` —una ventana sin piso— resucitaba
	// el histórico vencido entero. Ver el comentario largo en Search.
	//
	// Sin cota inferior, el mapa demota igual que el feed: el dato viejo es viejo
	// en todas las superficies.
	if c.From == nil {
		expiryClause, expiryArgs := straySightingNotExpired()
		q = q.Where(expiryClause, expiryArgs...)
	}

	if len(c.ReportStatuses) > 0 {
		q = q.Where("reports.status IN (?)", c.ReportStatuses)
	}

	if c.PetType != "" {
		q = q.Where("pets.type = ?", c.PetType)
	}

	if c.From != nil {
		q = q.Where(reportSightingTimeExpr+" >= ?", *c.From)
	}
	if c.To != nil {
		q = q.Where(reportSightingTimeExpr+" <= ?", *c.To)
	}

	err := q.Order(orderExpr).Find(&reports).Error

	return reports, err
}

// CountByReporter — ver el contrato en repository/interfaces.go.
//
// Excluye el reporte de cierre. MarkAsFound lo crea automáticamente con
// status 'found' y como reporter a quien administra la mascota (dueño, o quien
// reportó el callejero). El único marcador textual es la descripción
// "Closure report", pero esa columna la escribe el usuario en un reporte
// común, así que no sirve de discriminante. El predicado estructural es:
// un reporte 'found' cuyo autor es el dueño o el reportante de la mascota. Es
// el mismo acto que ya cuenta en found_count (el dueño cierra la búsqueda), y
// excluir también el "found" manual de un dueño sobre su propia mascota evita
// contarlo dos veces. Un reporte 'found' de OTRA persona (quien la encontró)
// sí cuenta, igual que 'lost' y 'sighting', y el reporte inicial de un
// callejero ('sighting') también.
//
// IS DISTINCT FROM y no `<>`/IN: owner_id es NULL en los callejeros, y con NULL
// el NOT(...) daría NULL y la fila se perdería en silencio.
func (r *PostgresReportRepository) CountByReporter(ctx context.Context, reporterID uuid.UUID) (int64, error) {
	var total int64
	err := r.db.WithContext(ctx).
		Table("reports").
		Joins("JOIN pets ON pets.id = reports.pet_id").
		Where("reports.reporter_id = ?", reporterID).
		Where("(reports.status <> 'found' OR (reports.reporter_id IS DISTINCT FROM pets.owner_id AND reports.reporter_id IS DISTINCT FROM pets.reporter_id))").
		Count(&total).Error
	return total, err
}
