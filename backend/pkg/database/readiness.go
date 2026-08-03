package database

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// readinessTimeout acota lo que puede tardar el chequeo.
//
// Una base colgada no rechaza la conexion: la acepta y no contesta nunca. Sin
// plazo, el request queda abierto hasta que el monitor corta a los 30s, y en el
// medio se come una goroutine por cada poll. Tiene que fallar rapido, no tarde.
const readinessTimeout = 2 * time.Second

// ReadinessChecker corre un SELECT 1 contra la base.
type ReadinessChecker struct {
	db *gorm.DB
}

func NewReadinessChecker(db *gorm.DB) *ReadinessChecker {
	return &ReadinessChecker{db: db}
}

// Check devuelve nil solo si la base contesto el valor esperado.
//
// Es SELECT 1 y no db.Ping() a proposito: Ping puede dar verde contra una conexion
// que ya estaba en el pool sin que el servidor del otro lado conteste nada, o sea
// una senal de exito que tambien se emite cuando el chequeo no ocurrio. Esa es la
// familia de bug que este endpoint viene a cerrar (reglas #34, #41, #46).
//
// Por el mismo motivo se exige el VALOR: un Scan sin filas devuelve error nil y
// deja uno en cero.
//
// La guarda `uno != 1` es inalcanzable con el SELECT 1 de aca abajo —Postgres
// siempre devuelve exactamente una fila con un uno, asi que ningun test la
// ejercita en esta rama—: es seguro contra el dia que la consulta o el driver
// cambien, no cobertura de la rama actual. No la borres por parecer muerta.
func (c *ReadinessChecker) Check(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, readinessTimeout)
	defer cancel()

	// Logger descartado a proposito. Connect arma GORM con logger.Info, que
	// loguea TODA query exitosa: sin esto, cada poll del monitor escribe un
	// SELECT 1 en los logs de Render. Y como el endpoint es publico y sin rate
	// limit, cualquiera puede inflar ese volumen justo en el unico lugar donde
	// vive el diagnostico de este endpoint. El error SI se sigue viendo: lo
	// loguea el handler, no GORM.
	var uno int
	quiet := c.db.Session(&gorm.Session{Logger: logger.Discard})
	if err := quiet.WithContext(ctx).Raw("SELECT 1").Scan(&uno).Error; err != nil {
		return err
	}
	if uno != 1 {
		return fmt.Errorf("readiness: la base no devolvio el valor esperado (%d)", uno)
	}
	return nil
}
