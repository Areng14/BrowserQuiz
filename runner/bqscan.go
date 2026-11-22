// The ban check's facts for Go: what the student's code uses from other packages, as Go's own type checker
// sees it (so aliases, dot imports and methods on library types are all named for what they are). Built into
// the runner image; run in the sandbox on the program's files, before any of their code runs.
//
//	bqscan -importcfg FILE -own solution.go solution.go bqmain.go ...
//
// Every file is type-checked; only the -own files' (the student's) uses are reported, one line each:
// "import PATH", "linkname", "builtin NAME", "use PKG.NAME", "use PKG.TYPE.METHOD", and "local FILE NAME" for
// their use of something another file of the program declares. "fail ..." when the files don't check.
package main

import (
	"bufio"
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

func main() {
	args := os.Args[1:]
	cfg := map[string]string{}
	own := map[string]bool{}
	for len(args) >= 2 && strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "-importcfg":
			f, err := os.Open(args[1])
			if err == nil {
				sc := bufio.NewScanner(f)
				for sc.Scan() {
					line := strings.TrimSpace(sc.Text())
					if rest, ok := strings.CutPrefix(line, "packagefile "); ok {
						if k, v, ok := strings.Cut(rest, "="); ok {
							cfg[k] = v
						}
					}
				}
				f.Close()
			}
		case "-own":
			for _, n := range strings.Split(args[1], ",") {
				own[n] = true
			}
		}
		args = args[2:]
	}
	fset := token.NewFileSet()
	var files []*ast.File
	for _, name := range args {
		f, err := parser.ParseFile(fset, name, nil, parser.ParseComments|parser.SkipObjectResolution)
		if err != nil {
			fmt.Println("fail parse")
			return
		}
		files = append(files, f)
	}
	// The file a position is really in: //line directives don't count.
	fileOf := func(p token.Pos) string { return filepath.Base(fset.PositionFor(p, false).Filename) }
	out := map[string]bool{}
	for _, f := range files {
		if !own[fileOf(f.Pos())] {
			continue
		}
		for _, im := range f.Imports {
			if p, err := strconv.Unquote(im.Path.Value); err == nil {
				out["import "+p] = true
			}
		}
		for _, cg := range f.Comments {
			for _, c := range cg.List {
				if strings.HasPrefix(c.Text, "//go:linkname") {
					out["linkname"] = true
				}
			}
		}
	}
	imp := importer.ForCompiler(fset, "gc", func(path string) (io.ReadCloser, error) {
		p, ok := cfg[path]
		if !ok {
			return nil, fmt.Errorf("no package %s", path)
		}
		return os.Open(p)
	})
	failed := false
	conf := types.Config{Importer: imp, Error: func(error) { failed = true }}
	info := &types.Info{Uses: map[*ast.Ident]types.Object{}}
	conf.Check("main", fset, files, info)
	if failed {
		fmt.Println("fail check")
		return
	}
	for id, obj := range info.Uses {
		if obj == nil || !own[fileOf(id.Pos())] {
			continue
		}
		if obj.Pkg() == nil {
			if _, ok := obj.(*types.Builtin); ok {
				out["builtin "+obj.Name()] = true
			}
			continue
		}
		pkg := obj.Pkg().Path()
		if pkg == "main" {
			// the student's own, or what the rest of the program declares (given classes, support code, the tests)
			if f := fileOf(obj.Pos()); !own[f] && obj.Pos().IsValid() {
				out["local "+f+" "+obj.Name()] = true
			}
			continue
		}
		switch o := obj.(type) {
		case *types.Func:
			if sig, ok := o.Type().(*types.Signature); ok && sig.Recv() != nil {
				t := sig.Recv().Type()
				if p, ok := t.(*types.Pointer); ok {
					t = p.Elem()
				}
				name := "?"
				if n, ok := t.(*types.Named); ok {
					name = n.Obj().Name()
				} else if n, ok := t.(*types.Alias); ok {
					name = n.Obj().Name()
				}
				out["use "+pkg+"."+name+"."+o.Name()] = true
			} else {
				out["use "+pkg+"."+o.Name()] = true
			}
		case *types.Var:
			if !o.IsField() {
				out["use "+pkg+"."+o.Name()] = true
			}
		default:
			out["use "+pkg+"."+obj.Name()] = true
		}
	}
	lines := make([]string, 0, len(out))
	for k := range out {
		lines = append(lines, k)
	}
	sort.Strings(lines)
	for _, l := range lines {
		fmt.Println(l)
	}
}
