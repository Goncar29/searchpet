package secret_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// TestNoSecretComparedWithEqualityOperators barre el codigo de produccion de
// internal/ y falla ante un `==` o `!=` sobre un secreto (hallazgo S8 de la
// auditoria 2026-09-23). La comparacion de strings de Go corta en el primer
// byte distinto, asi que el tiempo de respuesta filtra cuanto del secreto
// acerto el atacante; secret.Equal no.
//
// Que cuenta como secreto: el valor de un header de request (hoy los unicos
// headers comparados son tokens compartidos), un campo CodeHash (el hash del
// OTP) o un identificador llamado token. Comparar contra un literal o nil
// (`h.token == ""`) no cuenta: es la guarda de "no configurado", que tiene que
// seguir existiendo aparte (regla #18).
//
// Tambien falla ante bytes.Equal o strings.Compare con un secreto como
// argumento: son la misma comparacion con corte temprano, escrita de otra forma.
//
// LO QUE NO CUBRE, a conciencia: decide que es un secreto por su FORMA (header,
// CodeHash, token), no por su significado. Un secreto futuro guardado con otro
// nombre (apiKey, expected, un digest) y comparado con == pasa sin que este test
// lo vea. Es una red para los sitios que existen y para la forma en que
// reaparecen, no una prueba de que no haya ninguna comparacion insegura. Un
// secreto nuevo se compara con secret.Equal desde el primer dia.
//
// Es un barrido por AST y no por texto: un grep no distingue `h.token == ""`
// de `header != h.token`.
func TestNoSecretComparedWithEqualityOperators(t *testing.T) {
	root := filepath.Join("..", "..", "internal")
	fset := token.NewFileSet()
	scanned := 0
	var hits []string

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		scanned++
		ast.Inspect(file, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok && isEarlyExitCompare(call) {
				for _, arg := range call.Args {
					if isSecret(arg) {
						hits = append(hits, fset.Position(call.Pos()).String())
						break
					}
				}
				return true
			}
			bin, ok := n.(*ast.BinaryExpr)
			if !ok || (bin.Op != token.EQL && bin.Op != token.NEQ) {
				return true
			}
			if isLiteralOrNil(bin.X) || isLiteralOrNil(bin.Y) {
				return true
			}
			if isSecret(bin.X) || isSecret(bin.Y) {
				hits = append(hits, fset.Position(bin.Pos()).String())
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("recorriendo %s: %v", root, err)
	}
	// Sin esto, una ruta equivocada daria verde sin haber leido nada.
	if scanned < 50 {
		t.Fatalf("solo se leyeron %d archivos de %s: el barrido no esta mirando el codigo real", scanned, root)
	}
	for _, h := range hits {
		t.Errorf("%s: secreto comparado sin tiempo constante, usar secret.Equal", h)
	}
}

func isLiteralOrNil(e ast.Expr) bool {
	switch v := e.(type) {
	case *ast.BasicLit:
		return true
	case *ast.Ident:
		return v.Name == "nil"
	}
	return false
}

// isEarlyExitCompare reconoce bytes.Equal y strings.Compare por el nombre del
// paquete tal como se importa en este repo (sin alias).
func isEarlyExitCompare(call *ast.CallExpr) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok {
		return false
	}
	return (pkg.Name == "bytes" && sel.Sel.Name == "Equal") ||
		(pkg.Name == "strings" && sel.Sel.Name == "Compare")
}

func isSecret(e ast.Expr) bool {
	switch v := e.(type) {
	case *ast.CallExpr:
		if sel, ok := v.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "GetHeader" {
			return true
		}
		// []byte(token) y similares: la conversion no cambia que sea el secreto.
		if len(v.Args) == 1 {
			return isSecret(v.Args[0])
		}
	case *ast.SelectorExpr:
		return v.Sel.Name == "CodeHash" || strings.EqualFold(v.Sel.Name, "token")
	case *ast.Ident:
		return strings.EqualFold(v.Name, "token")
	}
	return false
}
