package io.lefectjava.worker.parser;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.Range;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.AnnotationDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.NameExpr;
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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.stream.Collectors;

public final class SourceSyntaxExtractor {
  public record ImportUse(String name, boolean wildcard, boolean isStatic, SourceLocation location) {}
  public record Declaration(String className, String access, SourceLocation location) {}
  public record TypeUse(String expression, boolean shadowed, String resolvedName, SourceLocation location, String role) {}
  public record Diagnostic(String code, String message, SourceLocation location) {}
  public record Syntax(String packageName, List<ImportUse> imports, List<Declaration> declarations,
                       List<TypeUse> types, List<Diagnostic> diagnostics) {}

  private final JavaParser parser = new JavaParser(new ParserConfiguration()
      .setLanguageLevel(ParserConfiguration.LanguageLevel.BLEEDING_EDGE)
      .setTabSize(1)
      .setSymbolResolver(new AnalysisSymbolResolver(new ClassLoaderTypeSolver(ClassLoader.getPlatformClassLoader()))));

  private final Map<String, Module> platformPackages = ModuleLayer.boot().modules().stream()
      .filter(module -> module.getClassLoader() == null || module.getClassLoader() == ClassLoader.getPlatformClassLoader())
      .flatMap(module -> module.getPackages().stream().filter(module::isExported).map(name -> Map.entry(name, module)))
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
    for (TypeDeclaration<?> declaration : unit.getTypes()) {
      collectDeclarations(declaration, packageName, "public", declarations);
    }
    var declaredNames = declarations.stream().map(Declaration::className).collect(Collectors.toSet());

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
        types.add(new TypeUse(name, shadowed, resolvedName, location(spelling), "type"));
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
        types.add(new TypeUse(name, shadowed, resolvedName, location(annotation.getName()), "type"));
      }
    }
    if (diagnostics.isEmpty()) collectQualifiers(unit, types);
    types.sort(Comparator.comparing((TypeUse use) -> use.location.line).thenComparing(use -> use.location.column));
    return new Syntax(packageName, imports, declarations, types, diagnostics);
  }

  private static void collectQualifiers(CompilationUnit unit, List<TypeUse> result) {
    var seen = new HashSet<Range>();
    for (MethodCallExpr call : unit.findAll(MethodCallExpr.class)) {
      call.getScope().ifPresent(scope -> collectQualifier(scope, () -> call.resolve().isStatic(), unit, seen, result));
    }
    for (FieldAccessExpr access : unit.findAll(FieldAccessExpr.class)) {
      collectQualifier(access.getScope(), () -> {
        var resolved = access.resolve();
        return resolved.isEnumConstant() || resolved.isField() && resolved.asField().isStatic();
      }, unit, seen, result);
    }
  }

  private static void collectQualifier(Expression scope, BooleanSupplier isStatic, CompilationUnit unit,
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
      result.add(new TypeUse(name, shadowed, resolved.asReferenceType().getQualifiedName(),
          location(range), "qualifier"));
    } catch (RuntimeException | LinkageError ignored) {
      // Retain a dotted expression for an exact declaration probe. It is not a verified type use.
      if (parts.size() > 1 && !shadowed) result.add(new TypeUse(name, false, null, location(range), "qualifier"));
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

  /** Tests only exported platform .class resources, without initializing any class. */
  public boolean isPlatformType(String qualifiedName) {
    for (int dot = qualifiedName.lastIndexOf('.'); dot >= 0; dot = qualifiedName.lastIndexOf('.', dot - 1)) {
      String packageName = qualifiedName.substring(0, dot);
      Module module = platformPackages.get(packageName);
      if (module == null) continue;
      String resource = packageName.replace('.', '/') + '/' + qualifiedName.substring(dot + 1).replace('.', '$') + ".class";
      try (var input = module.getResourceAsStream(resource)) {
        return input != null;
      } catch (IOException ignored) {
        return false;
      }
    }
    return false;
  }

  private static void collectDeclarations(TypeDeclaration<?> declaration, String scope, String enclosingAccess,
                                          List<Declaration> result) {
    String simpleName = declaration.getNameAsString();
    String name = scope.isEmpty() ? simpleName : scope + "." + simpleName;
    String access = declaration.getAccessSpecifier().asString();
    if (access.isEmpty()) {
      Node parent = declaration.getParentNode().orElse(null);
      access = parent instanceof ClassOrInterfaceDeclaration owner && owner.isInterface()
          || parent instanceof AnnotationDeclaration ? "public" : "package";
    }
    if (access.equals("public")) access = enclosingAccess;
    result.add(new Declaration(name, access, location(declaration.getName())));
    for (var member : declaration.getMembers()) {
      if (member instanceof TypeDeclaration<?> nested) collectDeclarations(nested, name, access, result);
    }
  }

  private static boolean isShadowed(String name, Node use, CompilationUnit unit) {
    String first = name.split("\\.", 2)[0];
    if (unit.getTypes().stream().anyMatch(type -> type.getNameAsString().equals(first))) return true;
    for (Node parent = use; parent != null; parent = parent.getParentNode().orElse(null)) {
      if (parent instanceof NodeWithTypeParameters<?> generic
          && generic.getTypeParameters().stream().anyMatch(type -> type.getNameAsString().equals(first))) return true;
      if (parent instanceof TypeDeclaration<?> owner && (owner.getNameAsString().equals(first)
          || owner.getMembers().stream().anyMatch(member -> member instanceof TypeDeclaration<?> type
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
