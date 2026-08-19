package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type postgresConversationHideRepository struct {
	db *gorm.DB
}

// NewConversationHideRepository construye un ConversationHideRepository respaldado por PostgreSQL.
func NewConversationHideRepository(db *gorm.DB) ConversationHideRepository {
	return &postgresConversationHideRepository{db: db}
}

// Upsert crea u actualiza el ocultamiento del par (userID, otherUserID).
// ON CONFLICT sobre la PK compuesta refresca hidden_at — re-ocultar siempre funciona.
//
// `hidden_at` SE ESTAMPA CON EL RELOJ DE LA APP, no con el `NOW()` de Postgres, y
// no es un detalle de estilo: es el único valor con el que se lo compara.
//
// La regla de visibilidad de "borrar conversación" es
// `hidden_at >= messages.created_at`, y `created_at` lo escribe GORM con
// `autoCreateTime`, o sea `time.Now()` del proceso Go. Con `NOW()` acá, esa
// comparación cruzaba DOS RELOJES DISTINTOS — y en producción son dos máquinas
// distintas, la API en Render y la base en Neon.
//
// Qué se rompía. Si el reloj de la base va adelantado δ respecto del de la app,
// `hidden_at` queda estampado δ en el futuro, y todo mensaje que la contraparte
// mande en esa ventana δ justo después del borrado cumple la condición y se
// traga. Antes eso lo escondía sólo de la lista y del badge; desde que la regla
// se aplica también al hilo, ese mensaje queda INALCANZABLE en las tres vistas,
// para siempre, y la conversación se queda muda hasta que llegue otro.
//
// Y hay un segundo motivo, independiente del desfase entre máquinas: `NOW()` en
// Postgres devuelve la hora de INICIO DE LA TRANSACCIÓN, no la del statement.
// Dentro de una transacción larga —este repo tiene unit of work— estampaba un
// pasado arbitrario. Ese es justamente el caso que el test puede reproducir, y
// por eso existe: el desfase entre máquinas NO se puede reproducir en local,
// donde el Postgres de Docker comparte el reloj del host.
func (r *postgresConversationHideRepository) Upsert(ctx context.Context, userID, otherUserID uuid.UUID) error {
	ahora := time.Now()
	return r.db.WithContext(ctx).Exec(
		`INSERT INTO conversation_hides (user_id, other_user_id, hidden_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT (user_id, other_user_id) DO UPDATE SET hidden_at = ?`,
		userID, otherUserID, ahora, ahora,
	).Error
}

// Verificación estática: postgresConversationHideRepository satisface ConversationHideRepository.
var _ ConversationHideRepository = (*postgresConversationHideRepository)(nil)
