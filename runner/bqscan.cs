// The ban check's facts for C#: every method, field and type the student's compiled code refers to outside
// itself, read from the assembly's metadata (its MemberRef and TypeRef tables). Built into the runner image;
// run in the sandbox on a library compiled from the student's files alone, before any of their code runs.
//
//   bqscan.dll SCAN.dll
//
// Prints "M Namespace.Type::Member" and "T Namespace.Type" lines (generic types keep their `1 arity), and
// "pinvoke" when the code declares a native function of its own (DllImport).
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

static class BQScan {
    static MetadataReader md = null!;

    static string? TypeName(EntityHandle h) {
        switch (h.Kind) {
            case HandleKind.TypeReference: {
                var tr = md.GetTypeReference((TypeReferenceHandle)h);
                var name = md.GetString(tr.Name);
                if (tr.ResolutionScope.Kind == HandleKind.TypeReference) return TypeName((EntityHandle)tr.ResolutionScope) + "+" + name;
                var ns = md.GetString(tr.Namespace);
                return ns.Length > 0 ? ns + "." + name : name;
            }
            case HandleKind.TypeSpecification: {
                // List<int> and the like: the generic type it instantiates
                var blob = md.GetBlobReader(md.GetTypeSpecification((TypeSpecificationHandle)h).Signature);
                var code = blob.ReadSignatureTypeCode();
                if (code == SignatureTypeCode.GenericTypeInstance) {
                    blob.ReadSignatureTypeCode();
                    return TypeName(blob.ReadTypeHandle());
                }
                return null;
            }
            default:
                return null; // the student's own types
        }
    }

    static int Main(string[] args) {
        using var fs = File.OpenRead(args[0]);
        using var pe = new PEReader(fs);
        md = pe.GetMetadataReader();
        var output = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var h in md.MemberReferences) {
            var mr = md.GetMemberReference(h);
            string? owner = null;
            if (mr.Parent.Kind == HandleKind.MethodDefinition) continue; // varargs call to their own method
            owner = TypeName(mr.Parent);
            if (owner != null) output.Add("M " + owner + "::" + md.GetString(mr.Name));
        }
        foreach (var h in md.TypeReferences) {
            var name = TypeName(h);
            if (name != null) output.Add("T " + name);
        }
        if (md.GetTableRowCount(TableIndex.ModuleRef) > 0) output.Add("pinvoke");
        foreach (var h in md.MethodDefinitions)
            if ((md.GetMethodDefinition(h).Attributes & MethodAttributes.PinvokeImpl) != 0) output.Add("pinvoke");
        foreach (var line in output) Console.WriteLine(line);
        return 0;
    }
}
