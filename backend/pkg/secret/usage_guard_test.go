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
		t.Errorf("%s: secreto comparado con ==/!=, usar secret.Equal", h)
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

func isSecret(e ast.Expr) bool {
	switch v := e.(type) {
	case *ast.CallExpr:
		if sel, ok := v.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "GetHeader" {
			return true
		}
	case *ast.SelectorExpr:
		return v.Sel.Name == "CodeHash" || strings.EqualFold(v.Sel.Name, "token")
	case *ast.Ident:
		return strings.EqualFold(v.Name, "token")
	}
	return false
}
