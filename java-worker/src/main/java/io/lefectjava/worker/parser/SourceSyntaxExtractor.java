package io.lefectjava.worker.parser;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.Range;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.AnnotationDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.EnumConstantDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.nodeTypes.NodeWithExtends;
import com.github.javaparser.ast.nodeTypes.NodeWithImplements;
import com.github.javaparser.ast.nodeTypes.NodeWithTypeParameters;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.LocalClassDeclarationStmt;
import com.github.javaparser.ast.stmt.LocalRecordDeclarationStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.SwitchEntry;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ClassLoaderTypeSolver;
import io.lefectjava.worker.model.SourceLocation;

import java.io.IOException;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.stream.Collectors;

public final class SourceSyntaxExtractor {
  public record ImportUse(String name, boolean wildcard, boolean isStatic, SourceLocation location) {}
  public record Declaration(String className, String access, SourceLocation location, List<String> superTypes) {}
  public record TypeUse(String expression, boolean shadowed, String resolvedName, SourceLocation location, String role,
                        List<String> enclosingTypes, boolean inheritanceUncertain) {}
  public record Diagnostic(String code, String message, SourceLocation location) {}
  public record Syntax(String packageName, List<ImportUse> imports, List<Declaration> declarations,
                       List<TypeUse> types, List<Diagnostic> diagnostics) {}
  private record InheritanceScope(List<String> enclosingTypes, boolean uncertain) {}
  private record PlatformClass(Module module, String packageName, String binaryName) {}

  private final JavaParser parser = new JavaParser(new ParserConfiguration()
      .setLanguageLevel(ParserConfiguration.LanguageLevel.BLEEDING_EDGE)
      .setTabSize(1)
      .setSymbolResolver(new AnalysisSymbolResolver(new ClassLoaderTypeSolver(ClassLoader.getPlatformClassLoader()))));

  private final Map<String, Module> platformPackages = ModuleLayer.boot().modules().stream()
      .filter(module -> module.getClassLoader() == null || module.getClassLoader() == ClassLoader.getPlatformClassLoader())
      .flatMap(module -> module.getPackages().stream().map(name -> Map.entry(name, module)))
      .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));

  public Syntax extract(String source) {
    var parsed = parser.parse(source);
    var diagnostics = parsed.getProblems().stream().map(problem -> new Diagnostic("SOURCE_JAVA_SYNTAX",
        problem.getMessage(), problem.getLocation().flatMap(tokens -> tokens.getBegin().getRange())
            .map(SourceSyntaxExtractor::location).orElse(null))).toList();
    CompilationUnit unit = parsed.getResult().orElse(null);
    if (unit == null) return new Syntax("", List.of(), List.of(), List.of(), diagnostics);

    String packageName = unit.getPackageDeclaration().map(value -> value.getNameAsString()).orElse("");
    var imports = unit.getImports().stream().map(value -> new ImportUse(value.getNameAsString(),
        value.isAsterisk(), value.isStatic(), location(value.getName()))).toList();
    var declarations = new ArrayList<Declaration>();
    var declarationNames = new IdentityHashMap<TypeDeclaration<?>, String>();
    for (TypeDeclaration<?> declaration : unit.getTypes()) {
      collectDeclarations(declaration, packageName, "public", declarations, declarationNames);
    }
    var declaredNames = Set.copyOf(declarationNames.values());

    var types = new ArrayList<TypeUse>();
    for (ClassOrInterfaceType type : unit.findAll(ClassOrInterfaceType.class)) {
      if (type.getParentNode().orElse(null) instanceof ClassOrInterfaceType enclosing
          && enclosing.getScope().orElse(null) == type) continue;
      String name = type.getNameWithScope();
      String resolvedName = null;
      if (diagnostics.isEmpty()) {
        try {
          var resolved = type.resolve();
          if (resolved.isReferenceType()) resolvedName = resolved.asReferenceType().getQualifiedName();
        } catch (RuntimeException | LinkageError ignored) {
          // Lookup still has the actual syntactic use and its import context.
        }
      }
      if (type.getRange().isPresent() && type.getName().getRange().isPresent()) {
        ClassOrInterfaceType first = type;
        while (first.getScope().isPresent()) first = first.getScope().orElseThrow();
        var spelling = new Range(first.getName().getBegin().orElseThrow(), type.getName().getEnd().orElseThrow());
        boolean shadowed = isShadowed(name, type, unit) || (resolvedName != null && declaredNames.contains(resolvedName));
        types.add(typeUse(name, shadowed, resolvedName, location(spelling), "type", type, declarationNames));
      }
    }
    for (AnnotationExpr annotation : unit.findAll(AnnotationExpr.class)) {
      String name = annotation.getNameAsString();
      String resolvedName = null;
      if (diagnostics.isEmpty()) {
        try {
          resolvedName = annotation.resolve().getQualifiedName();
        } catch (RuntimeException | LinkageError ignored) {
          // Lookup can inspect the annotation name as a type use.
        }
      }
      if (annotation.getName().getRange().isPresent()) {
        boolean shadowed = isShadowed(name, annotation, unit) || (resolvedName != null && declaredNames.contains(resolvedName));
        types.add(typeUse(name, shadowed, resolvedName, location(annotation.getName()), "type", annotation, declarationNames));
      }
    }
    if (diagnostics.isEmpty()) collectQualifiers(unit, declarationNames, types);
    types.sort(Comparator.comparing((TypeUse use) -> use.location.line).thenComparing(use -> use.location.column));
    return new Syntax(packageName, imports, declarations, types, diagnostics);
  }

  private static void collectQualifiers(CompilationUnit unit, Map<TypeDeclaration<?>, String> declarationNames,
                                        List<TypeUse> result) {
    var seen = new HashSet<Range>();
    for (MethodCallExpr call : unit.findAll(MethodCallExpr.class)) {
      call.getScope().ifPresent(scope ->
          collectQualifier(scope, () -> call.resolve().isStatic(), unit, declarationNames, seen, result));
    }
    for (FieldAccessExpr access : unit.findAll(FieldAccessExpr.class)) {
      collectQualifier(access.getScope(), () -> {
        var resolved = access.resolve();
        return resolved.isEnumConstant() || resolved.isField() && resolved.asField().isStatic();
      }, unit, declarationNames, seen, result);
    }
  }

  private static void collectQualifier(Expression scope, BooleanSupplier isStatic, CompilationUnit unit,
                                       Map<TypeDeclaration<?>, String> declarationNames,
                                       Set<Range> seen, List<TypeUse> result) {
    var parts = new ArrayList<String>();
    Expression root = scope;
    while (root instanceof FieldAccessExpr field) {
      parts.add(0, field.getNameAsString());
      root = field.getScope();
    }
    if (!(root instanceof NameExpr nameExpr) || scope.getRange().isEmpty()) return;
    parts.add(0, nameExpr.getNameAsString());
    String name = String.join(".", parts);
    var range = scope.getRange().orElseThrow();
    if (!seen.add(range) || resolvesToValue(scope) || (root != scope && resolvesToValue(root))) return;
    boolean shadowed = isShadowed(name, scope, unit);
    try {
      if (!isStatic.getAsBoolean()) return;
      var resolved = scope.calculateResolvedType();
      if (!resolved.isReferenceType()) return;
      result.add(typeUse(name, shadowed, resolved.asReferenceType().getQualifiedName(),
          location(range), "qualifier", scope, declarationNames));
    } catch (RuntimeException | LinkageError ignored) {
      // Retain a dotted expression for an exact declaration probe. It is not a verified type use.
      if (parts.size() > 1 && !shadowed) {
        result.add(typeUse(name, false, null, location(range), "qualifier", scope, declarationNames));
      }
    }
  }

  private static boolean resolvesToValue(Expression scope) {
    try {
      if (scope instanceof NameExpr name) name.resolve();
      else scope.asFieldAccessExpr().resolve();
      return true;
    } catch (RuntimeException | LinkageError ignored) {
      return false;
    }
  }

  public boolean isPlatformType(String qualifiedName) {
    return !platformTypeAccess(qualifiedName).equals("missing");
  }

  /** Reads platform class metadata without initializing classes or loading workspace code. */
  public String platformTypeAccess(String qualifiedName) {
    PlatformClass platform = platformClass(qualifiedName);
    if (platform == null) return "missing";
    try (var input = platform.module().getResourceAsStream(platform.binaryName().replace('.', '/') + ".class")) {
      if (input == null) return "missing";
    } catch (IOException ignored) {
      return "missing";
    }
    if (!platform.module().isExported(platform.packageName())) return "nonpublic";
    try {
      Class<?> type = Class.forName(platform.module(), platform.binaryName());
      if (type == null || !Modifier.isPublic(type.getModifiers())) return "nonpublic";
      for (Class<?> owner = type.getDeclaringClass(); owner != null; owner = owner.getDeclaringClass()) {
        if (!Modifier.isPublic(owner.getModifiers())) return "nonpublic";
      }
      return "public";
    } catch (LinkageError | SecurityException ignored) {
      return "nonpublic";
    }
  }

  /** Null means that platform metadata could not rule out a matching inherited member. */
  public List<String> platformMemberTypes(String ownerName, String memberName) {
    PlatformClass platform = platformClass(ownerName);
    if (platform == null || !platform.module().isExported(platform.packageName())) return null;
    try {
      Class<?> owner = Class.forName(platform.module(), platform.binaryName());
      var matches = new HashSet<String>();
      if (owner == null || !collectPlatformMemberTypes(owner, memberName, new HashSet<>(), matches)) return null;
      return matches.stream().sorted().toList();
    } catch (LinkageError | SecurityException ignored) {
      return null;
    }
  }

  private static boolean collectPlatformMemberTypes(Class<?> owner, String memberName,
                                                     Set<Class<?>> seen, Set<String> matches) {
    if (owner == null || !seen.add(owner)) return true;
    for (Class<?> member : owner.getDeclaredClasses()) {
      if (!member.getSimpleName().equals(memberName)) continue;
      int access = member.getModifiers();
      // A declaration of this name hides ancestors even when it cannot be inherited.
      if (Modifier.isPrivate(access)) return true;
      if (!Modifier.isPublic(access) && !Modifier.isProtected(access)) return false;
      String name = member.getCanonicalName();
      if (name == null || !member.getModule().isExported(member.getPackageName())) return false;
      matches.add(name);
      return true;
    }
    if (!collectPlatformMemberTypes(owner.getSuperclass(), memberName, seen, matches)) return false;
    for (Class<?> parent : owner.getInterfaces()) {
      if (!collectPlatformMemberTypes(parent, memberName, seen, matches)) return false;
    }
    return true;
  }

  private PlatformClass platformClass(String qualifiedName) {
    for (int dot = qualifiedName.lastIndexOf('.'); dot >= 0; dot = qualifiedName.lastIndexOf('.', dot - 1)) {
      String packageName = qualifiedName.substring(0, dot);
      Module module = platformPackages.get(packageName);
      if (module == null) continue;
      String binaryName = packageName + "." + qualifiedName.substring(dot + 1).replace('.', '$');
      return new PlatformClass(module, packageName, binaryName);
    }
    return null;
  }

  private static void collectDeclarations(TypeDeclaration<?> declaration, String scope, String enclosingAccess,
                                          List<Declaration> result, Map<TypeDeclaration<?>, String> declarationNames) {
    String simpleName = declaration.getNameAsString();
    String name = scope.isEmpty() ? simpleName : scope + "." + simpleName;
    String access = declaration.getAccessSpecifier().asString();
    if (access.isEmpty()) {
      Node parent = declaration.getParentNode().orElse(null);
      access = parent instanceof ClassOrInterfaceDeclaration owner && owner.isInterface()
          || parent instanceof AnnotationDeclaration ? "public" : "package";
    }
    access = intersectAccess(access, enclosingAccess);
    declarationNames.put(declaration, name);
    var superTypes = writtenSupertypes(declaration).stream().map(ClassOrInterfaceType::getNameWithScope).toList();
    result.add(new Declaration(name, access, location(declaration.getName()), superTypes));
    for (var member : declaration.getMembers()) {
      if (member instanceof TypeDeclaration<?> nested) collectDeclarations(nested, name, access, result, declarationNames);
    }
  }

  private static String intersectAccess(String access, String enclosingAccess) {
    for (String restriction : List.of("private", "package", "protected")) {
      if (restriction.equals(access) || restriction.equals(enclosingAccess)) return restriction;
    }
    return "public";
  }

  private static List<ClassOrInterfaceType> writtenSupertypes(TypeDeclaration<?> declaration) {
    var supertypes = new ArrayList<ClassOrInterfaceType>();
    if (declaration instanceof NodeWithExtends<?> extending) supertypes.addAll(extending.getExtendedTypes());
    if (declaration instanceof NodeWithImplements<?> implementing) supertypes.addAll(implementing.getImplementedTypes());
    return supertypes;
  }

  private static boolean isSupertypeNode(List<ClassOrInterfaceType> supertypes, Node child) {
    return supertypes.stream().anyMatch(type -> type == child);
  }

  private static TypeUse typeUse(String name, boolean shadowed, String resolvedName, SourceLocation location, String role,
                                 Node use, Map<TypeDeclaration<?>, String> declarationNames) {
    var scope = inheritanceScope(use, declarationNames);
    return new TypeUse(name, shadowed, resolvedName, location, role, scope.enclosingTypes(), scope.uncertain());
  }

  private static InheritanceScope inheritanceScope(Node use, Map<TypeDeclaration<?>, String> declarationNames) {
    var enclosing = new ArrayList<String>();
    boolean uncertain = false;
    for (Node child = use, parent = child.getParentNode().orElse(null); parent != null;
         child = parent, parent = parent.getParentNode().orElse(null)) {
      if (parent instanceof TypeDeclaration<?> owner) {
        var supertypes = writtenSupertypes(owner);
        if (isSupertypeNode(supertypes, child)) continue;
        String name = declarationNames.get(owner);
        if (name != null) enclosing.add(name);
        else if (!supertypes.isEmpty()) uncertain = true;
      } else if (parent instanceof ObjectCreationExpr creation && creation.getAnonymousClassBody().isPresent()) {
        for (var member : creation.getAnonymousClassBody().orElseThrow()) {
          if (member == child) uncertain = true;
        }
      } else if (parent instanceof EnumConstantDeclaration constant) {
        for (var member : constant.getClassBody()) {
          if (member == child) uncertain = true;
        }
      }
    }
    return new InheritanceScope(enclosing, uncertain);
  }

  private static boolean isShadowed(String name, Node use, CompilationUnit unit) {
    String first = name.split("\\.", 2)[0];
    if (unit.getTypes().stream().anyMatch(type -> type.getNameAsString().equals(first))) return true;
    for (Node child = null, parent = use; parent != null; child = parent, parent = parent.getParentNode().orElse(null)) {
      if (parent instanceof NodeWithTypeParameters<?> generic
          && generic.getTypeParameters().stream().anyMatch(type -> type.getNameAsString().equals(first))) return true;
      if (parent instanceof TypeDeclaration<?> owner && (owner.getNameAsString().equals(first)
          || !isSupertypeNode(writtenSupertypes(owner), child)
              && owner.getMembers().stream().anyMatch(member -> member instanceof TypeDeclaration<?> type
              && type.getNameAsString().equals(first)))) return true;
      if (parent instanceof BlockStmt block && hasEarlierLocalType(block.getStatements(), first, use)) return true;
      if (parent instanceof SwitchEntry entry && hasEarlierLocalType(entry.getStatements(), first, use)) return true;
    }
    return false;
  }

  private static boolean hasEarlierLocalType(List<Statement> statements, String name, Node use) {
    if (use.getBegin().isEmpty()) return false;
    for (Statement statement : statements) {
      if (statement.getBegin().isEmpty() || statement.getBegin().get().isAfter(use.getBegin().get())) break;
      if (statement instanceof LocalClassDeclarationStmt local && local.getClassDeclaration().getNameAsString().equals(name)
          || statement instanceof LocalRecordDeclarationStmt record && record.getRecordDeclaration().getNameAsString().equals(name)) return true;
    }
    return false;
  }

  private static SourceLocation location(Node node) {
    return node.getRange().map(SourceSyntaxExtractor::location).orElse(null);
  }

  private static SourceLocation location(Range range) {
    return new SourceLocation(range.begin.line, range.begin.column, range.end.line, range.end.column);
  }
}
