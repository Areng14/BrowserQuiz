# Harness helper: facts about the student's code for the ban check (server/src/bans.js), worked out
# before any of it runs. Python's own parser and symbol table do the reading, so comments, strings,
# f-strings, line breaks and look-alike letters (identifiers are NFKC-normalized) are already dealt with.
#
#   names    the names it uses that aren't its own, so they're Python's builtins (sorted, max, eval, ...)
#   attrs    the attributes it reads (nums.sort, math.sqrt), except its own on self
#   imports  what it imports: "math", "math.sqrt", "math.*"
#   stores   attributes it sets on modules it imported (sys.stdout = ..., time.perf_counter = ...)
import ast
import symtable

SAFE_DECORATORS = {"staticmethod", "classmethod", "property"}
TYPE_NAMES = {"list", "dict", "set", "tuple", "frozenset", "type", "List", "Dict", "Set", "Tuple", "Optional", "Union", "Any"}
FUNCTION_SCOPES = {"function", "annotation", "type alias", "type parameters", "TypeVar bound"}


def scan(path):
    try:
        with open(path, encoding="utf-8") as f:
            src = f.read()
        tree = ast.parse(src, path)
        table = symtable.symtable(src, path, "exec")
        return _facts(tree, table)
    except SyntaxError:
        return {"syntax": True}
    except Exception:  # too deep or too odd to read: the server treats it as not checkable
        return {"fail": True}


def _facts(tree, table):
    deleted = {t.id for n in ast.walk(tree) if isinstance(n, ast.Delete) for t in n.targets if isinstance(t, ast.Name)}
    modules = set()  # names bound to imported modules
    imports = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                parts = a.name.split(".")
                for k in range(1, len(parts) + 1):
                    imports.add(".".join(parts[:k]))
                modules.add(a.asname or parts[0])
        elif isinstance(n, ast.ImportFrom):
            mod = "." * n.level + (n.module or "")
            parts = mod.split(".") if not n.level else [mod]
            for k in range(1, len(parts) + 1):
                imports.add(".".join(parts[:k]))
            for a in n.names:
                imports.add(mod + "." + a.name)
                if a.name != "*":
                    modules.add(a.asname or a.name)  # could be a module (from os import path): treat it as one
    # Module-level aliases of a module (m = math) count as the module too.
    for n in tree.body:
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.Name) and n.value.id in modules:
            modules.update(t.id for t in n.targets if isinstance(t, ast.Name))

    # What the student's classes define: methods, class attributes and self.x = ... fields.
    own, selfs = set(), set()
    for c in ast.walk(tree):
        if not isinstance(c, ast.ClassDef):
            continue
        for s in c.body:
            if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)):
                own.add(s.name)
                static = any(isinstance(d, ast.Name) and d.id == "staticmethod" for d in s.decorator_list)
                args = s.args.posonlyargs + s.args.args
                if args and not static:
                    selfs.add(args[0].arg)
            elif isinstance(s, ast.Assign):
                own.update(t.id for t in s.targets if isinstance(t, ast.Name))
            elif isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name):
                own.add(s.target.id)
    for n in ast.walk(tree):
        if isinstance(n, ast.Attribute) and isinstance(n.ctx, ast.Store) and isinstance(n.value, ast.Name) and n.value.id in selfs:
            own.add(n.attr)

    attrs, stores = set(), set()
    for n in ast.walk(tree):
        if not isinstance(n, ast.Attribute):
            continue
        root = n.value
        while isinstance(root, (ast.Attribute, ast.Subscript, ast.Call)):
            root = root.value if not isinstance(root, ast.Call) else root.func
        if isinstance(n.ctx, ast.Load):
            if isinstance(n.value, ast.Name) and n.value.id in selfs and n.attr in own:
                continue  # self.count, self.helper(): their own
            attrs.add(n.attr)
        elif isinstance(root, ast.Name) and root.id in modules:
            stores.add(root.id + "." + n.attr)

    # Names that reach Python's builtins: used in a function or at module level and bound nowhere the
    # code can count on. A function's own locals always shadow (Python's rules). A module-level def or
    # assignment only counts when nothing before it runs code that could grab the builtin first.
    names = set()

    def walk(t):
        kind = str(t.get_type())
        for s in t.get_symbols():
            if not s.is_referenced():
                continue
            name = s.get_name()
            if kind in FUNCTION_SCOPES and (s.is_local() or s.is_free()):
                continue
            if kind == "class" and s.is_local():
                names.add(name)  # a class body reads a name before or after binding it: count it
                continue
            if not _own_global(tree, name, deleted):
                names.add(name)
        for c in t.get_children():
            walk(c)

    walk(table)
    return {"names": sorted(names), "attrs": sorted(attrs), "imports": sorted(imports), "stores": sorted(stores)}


_cache = {}


def _own_global(tree, name, deleted):
    if name in _cache:
        return _cache[name]
    ok = False
    if name not in deleted:
        for s in tree.body:
            if _binds(s, name):
                ok = _inert(s, name)
                break
            if not _inert(s, name):
                break
    _cache[name] = ok
    return ok


def _binds(s, name):
    if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return s.name == name
    if isinstance(s, ast.Assign):
        return any(isinstance(t, ast.Name) and t.id == name for t in s.targets)
    if isinstance(s, ast.AnnAssign):
        return s.value is not None and isinstance(s.target, ast.Name) and s.target.id == name
    return False


def _inert(s, name):
    """True when running this statement at import can't call code or read `name`."""
    if isinstance(s, (ast.Import, ast.ImportFrom, ast.Pass)):
        return True
    if isinstance(s, ast.Expr):
        return isinstance(s.value, ast.Constant)
    if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)):
        a = s.args
        parts = a.defaults + [d for d in a.kw_defaults if d is not None]
        parts += [x.annotation for x in a.posonlyargs + a.args + a.kwonlyargs if x.annotation is not None]
        if s.returns is not None:
            parts.append(s.returns)
        decos = all(isinstance(d, ast.Name) and d.id in SAFE_DECORATORS for d in s.decorator_list)
        return decos and not getattr(s, "type_params", None) and all(_inert_expr(p, name) for p in parts)
    if isinstance(s, ast.ClassDef):
        return (not s.decorator_list and not s.keywords and not getattr(s, "type_params", None)
                and all(_inert_expr(b, name) for b in s.bases) and all(_inert(x, name) for x in s.body))
    if isinstance(s, ast.Assign):
        return all(isinstance(t, ast.Name) for t in s.targets) and _inert_expr(s.value, name)
    if isinstance(s, ast.AnnAssign):
        return isinstance(s.target, ast.Name) and (s.value is None or _inert_expr(s.value, name)) and _inert_expr(s.annotation, name)
    return False


def _inert_expr(e, name):
    for n in ast.walk(e):
        if isinstance(n, (ast.Call, ast.Lambda, ast.NamedExpr, ast.Await, ast.Yield, ast.YieldFrom,
                          ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            return False
        if isinstance(n, ast.Subscript) and not (isinstance(n.value, ast.Name) and n.value.id in TYPE_NAMES):
            return False
        if isinstance(n, ast.Name) and n.id == name:
            return False
    return True
