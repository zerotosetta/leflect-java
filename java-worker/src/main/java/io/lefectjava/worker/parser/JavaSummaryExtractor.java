package io.lefectjava.worker.parser;

import com.github.javaparser.Position;
import com.github.javaparser.Range;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.ImportDeclaration;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.resolution.declarations.ResolvedMethodDeclaration;
import io.lefectjava.worker.model.AstFileResult;
import io.lefectjava.worker.model.JavaClassReference;
import io.lefectjava.worker.model.JavaClassSummary;
import io.lefectjava.worker.model.JavaMethodCallSite;
import io.lefectjava.worker.model.JavaMethodSummary;
import io.lefectjava.worker.model.SourceLocation;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

public class JavaSummaryExtractor {
  public AstFileResult extract(String sourcePath, CompilationUnit unit, String sourceKind) {
    String packageName = unit.getPackageDeclaration()
        .map(packageDeclaration -> packageDeclaration.getNameAsString())
        .orElse("");

    List<String> imports = unit.getImports().stream()
        .map(importDeclaration -> importDeclaration.getNameAsString())
        .collect(Collectors.toList());

    List<JavaClassSummary> types = new ArrayList<>();
    for (TypeDeclaration<?> type : unit.getTypes()) {
      types.add(toTypeSummary(packageName, type));
    }

    return new AstFileResult(
        sourcePath,
        sourceKind,
        packageName,
        imports,
        types,
        collectClassReferences(unit),
        collectMethodCalls(packageName, unit)
    );
  }

  private JavaClassSummary toTypeSummary(String packageName, TypeDeclaration<?> type) {
    List<String> extendsTypes = new ArrayList<>();
    List<String> implementsTypes = new ArrayList<>();
    String kind = "class";

    if (type instanceof ClassOrInterfaceDeclaration declaration) {
      kind = declaration.isInterface() ? "interface" : "class";
      declaration.getExtendedTypes()
          .forEach(classOrInterfaceType -> extendsTypes.add(classOrInterfaceType.asString()));
      declaration.getImplementedTypes()
          .forEach(classOrInterfaceType -> implementsTypes.add(classOrInterfaceType.asString()));
    } else if (type instanceof EnumDeclaration) {
      kind = "enum";
    }

    List<JavaMethodSummary> methods = new ArrayList<>();
    for (CallableDeclaration<?> callable : type.getMembers().stream()
        .filter(CallableDeclaration.class::isInstance)
        .map(CallableDeclaration.class::cast)
        .collect(Collectors.toList())) {
      methods.add(toMethodSummary(packageName, type.getNameAsString(), callable));
    }

    String fqn = buildTypeFqn(packageName, type.getNameAsString());

    return new JavaClassSummary(
        type.getNameAsString(),
        fqn,
        kind,
        extendsTypes,
        implementsTypes,
        methods,
        toSourceLocation(type)
    );
  }

  private JavaMethodSummary toMethodSummary(
      String packageName,
      String typeName,
      CallableDeclaration<?> callable
  ) {
    List<String> parameters = callable.getParameters().stream()
        .map(parameter -> parameter.getType().asString())
        .collect(Collectors.toList());

    String methodId = buildMethodId(packageName, typeName, callable.getNameAsString(), parameters);
    String returnType = callable instanceof MethodDeclaration methodDeclaration
        ? methodDeclaration.getType().asString()
        : "void";

    List<String> calls = callable.findAll(MethodCallExpr.class).stream()
        .map(this::resolveMethodCall)
        .map(resolution -> resolution.target)
        .distinct()
        .collect(Collectors.toList());

    return new JavaMethodSummary(
        methodId,
        callable.getNameAsString(),
        returnType,
        parameters,
        calls,
        toSourceLocation(callable)
    );
  }

  private List<JavaClassReference> collectClassReferences(CompilationUnit unit) {
    Map<String, JavaClassReference> references = new LinkedHashMap<>();

    for (ImportDeclaration importDeclaration : unit.findAll(ImportDeclaration.class)) {
      JavaClassReference reference = new JavaClassReference(
          importDeclaration.getNameAsString(),
          importDeclaration.getNameAsString(),
          importDeclaration.isAsterisk() ? "import-wildcard" : "import",
          importDeclaration.toString().trim(),
          toSourceLocation(importDeclaration)
      );
      references.put(referenceKey(reference), reference);
    }

    for (ClassOrInterfaceType type : unit.findAll(ClassOrInterfaceType.class)) {
      JavaClassReference reference = new JavaClassReference(
          type.getNameAsString(),
          resolveTypeName(type),
          resolveTypeKind(type),
          type.toString(),
          toSourceLocation(type)
      );
      references.put(referenceKey(reference), reference);
    }

    return new ArrayList<>(references.values());
  }

  private List<JavaMethodCallSite> collectMethodCalls(String packageName, CompilationUnit unit) {
    return unit.findAll(MethodCallExpr.class).stream()
        .map(call -> toMethodCallSite(packageName, call))
        .collect(Collectors.toList());
  }

  private JavaMethodCallSite toMethodCallSite(String packageName, MethodCallExpr call) {
    Optional<CallableDeclaration<?>> callable = call.findAncestor(CallableDeclaration.class)
        .map(value -> (CallableDeclaration<?>) value);
    Optional<TypeDeclaration<?>> type = call.findAncestor(TypeDeclaration.class)
        .map(value -> (TypeDeclaration<?>) value);

    String callerClassId = type
        .map(typeDeclaration -> buildTypeFqn(packageName, typeDeclaration.getNameAsString()))
        .orElse(null);
    String callerMethodId = callable
        .map(value -> buildMethodId(
            packageName,
            type.map(TypeDeclaration::getNameAsString).orElse("unknown"),
            value.getNameAsString(),
            value.getParameters().stream().map(parameter -> parameter.getType().asString()).collect(Collectors.toList())
        ))
        .orElse(null);

    MethodCallResolution resolution = resolveMethodCall(call);
    String targetClassId = extractClassId(resolution.target);
    String targetMethodId = resolution.target.contains("#") ? resolution.target : null;

    return new JavaMethodCallSite(
        callerMethodId,
        callerClassId,
        resolution.target,
        targetClassId,
        targetMethodId,
        resolution.methodName,
        resolution.classPath,
        resolution.parameterTypes,
        resolution.argumentExpressions,
        resolution.responseType,
        call.toString(),
        toSourceLocation(call)
    );
  }

  private String buildMethodId(
      String packageName,
      String typeName,
      String methodName,
      List<String> parameters
  ) {
    String typeFqn = buildTypeFqn(packageName, typeName);
    return typeFqn + "#" + methodName + "(" + String.join(",", parameters) + ")";
  }

  private String buildTypeFqn(String packageName, String typeName) {
    return packageName == null || packageName.isEmpty()
        ? typeName
        : packageName + "." + typeName;
  }

  private MethodCallResolution resolveMethodCall(MethodCallExpr call) {
    List<String> argumentExpressions = call.getArguments().stream()
        .map(Node::toString)
        .collect(Collectors.toList());
    try {
      ResolvedMethodDeclaration declaration = call.resolve();
      String qualified = declaration.getQualifiedSignature();
      int openParen = qualified.indexOf('(');
      int separator = openParen >= 0 ? qualified.lastIndexOf('.', openParen) : qualified.lastIndexOf('.');
      String target = separator < 0
          ? qualified
          : qualified.substring(0, separator) + "#" + qualified.substring(separator + 1);
      String classPath = separator < 0 ? null : qualified.substring(0, separator);
      List<String> parameterTypes = new ArrayList<>();
      for (int index = 0; index < declaration.getNumberOfParams(); index++) {
        parameterTypes.add(declaration.getParam(index).describeType());
      }

      return new MethodCallResolution(
          target,
          declaration.getName(),
          classPath,
          parameterTypes,
          argumentExpressions,
          declaration.getReturnType().describe()
      );
    } catch (RuntimeException ex) {
      return new MethodCallResolution(
          call.getNameAsString(),
          call.getNameAsString(),
          null,
          List.of(),
          argumentExpressions,
          null
      );
    }
  }

  private String resolveTypeName(ClassOrInterfaceType type) {
    try {
      return type.resolve().describe();
    } catch (RuntimeException ex) {
      return type.asString();
    }
  }

  private String resolveTypeKind(ClassOrInterfaceType type) {
    Node parent = type.getParentNode().orElse(null);
    if (parent instanceof ClassOrInterfaceDeclaration declaration) {
      if (declaration.getExtendedTypes().contains(type)) {
        return "extends";
      }
      if (declaration.getImplementedTypes().contains(type)) {
        return "implements";
      }
    }
    if (parent != null && parent.getClass().getSimpleName().contains("ObjectCreationExpr")) {
      return "new";
    }
    return "type";
  }

  private String extractClassId(String target) {
    int hashIndex = target.indexOf('#');
    if (hashIndex >= 0) {
      return target.substring(0, hashIndex);
    }
    return null;
  }

  private SourceLocation toSourceLocation(Node node) {
    return node.getRange()
        .map(this::toSourceLocation)
        .orElse(null);
  }

  private SourceLocation toSourceLocation(Range range) {
    Position begin = range.begin;
    Position end = range.end;
    return new SourceLocation(begin.line, begin.column, end.line, end.column);
  }

  private String referenceKey(JavaClassReference reference) {
    SourceLocation location = reference.location;
    return (reference.qualifiedName != null ? reference.qualifiedName : reference.symbol) + ":" +
        (reference.kind != null ? reference.kind : "") + ":" +
        (location != null ? location.line : "") + ":" +
        (location != null ? location.column : "");
  }

  private static final class MethodCallResolution {
    private final String target;
    private final String methodName;
    private final String classPath;
    private final List<String> parameterTypes;
    private final List<String> argumentExpressions;
    private final String responseType;

    private MethodCallResolution(
        String target,
        String methodName,
        String classPath,
        List<String> parameterTypes,
        List<String> argumentExpressions,
        String responseType
    ) {
      this.target = target;
      this.methodName = methodName;
      this.classPath = classPath;
      this.parameterTypes = parameterTypes;
      this.argumentExpressions = argumentExpressions;
      this.responseType = responseType;
    }
  }
}
