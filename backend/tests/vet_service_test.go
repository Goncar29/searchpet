package tests

import (
	"context"
	"fmt"
	"testing"

	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

// El tope de resultados del servicio recortaba DESPUES de ordenar por distancia,
// asi que en zona densa las mas lejanas desaparecian del mapa sin que nada
// avisara: ni un error, ni un contador, ni un log. Se veian 50 y el usuario
// concluia que las demas "no existen".
//
// Las 69 no son un numero inventado: es la cantidad real de amenity=veterinary
// que OpenStreetMap tiene dentro de 5 km del centro de Montevideo (medido contra
// la API de Overpass el 2026-08-12). Con el tope viejo de 50, diecinueve
// veterinarias reales quedaban afuera del radio que la propia pantalla pedia.
//
// QUE PRUEBA Y QUE NO, porque la diferencia importa: esto se pone rojo para
// cualquier tope por debajo de 69, o sea que fija el PISO del techo contra la
// unica densidad real que medimos. NO prueba "nunca recorta", y no podria: un
// techo recorta por encima de su valor, para eso existe. Si alguien lo baja a
// 100, este test sigue verde y una ciudad mas densa que Montevideo se recortaria
// igual. La defensa contra eso no es un test, es volver a medir — lo dice el
// comentario de vetResultLimit.
func TestVetService_FindNearby_NoTruncaLoQueEntraEnElRadio(t *testing.T) {
	db := testdb.SetupTestDB(t)
	svc := service.NewVetService(repository.NewVetRepository(db))

	const lat, lng = -34.9011, -56.1645
	const dentroDelRadio = 69

	// 0.0005 grados de latitud son ~55 m, asi que la numero 69 queda a ~3,8 km:
	// todas dentro de los 5 km que se consultan abajo.
	for i := 1; i <= dentroDelRadio; i++ {
		seedVet(t, repository.NewVetRepository(db), int64(9000+i),
			fmt.Sprintf("Veterinaria %02d", i), lat+0.0005*float64(i), lng)
	}

	results, err := svc.FindNearby(context.Background(), lat, lng, 5000)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}

	if len(results) != dentroDelRadio {
		t.Fatalf("el servicio trunco en silencio: esperaba las %d veterinarias que entran en 5 km, devolvio %d",
			dentroDelRadio, len(results))
	}
}
