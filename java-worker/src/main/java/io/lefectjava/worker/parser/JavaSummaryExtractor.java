package io.lefectjava.worker.parser;

import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.resolution.declarations.ResolvedMethodDeclaration;
import io.lefectjava.worker.model.AstFileResult;
import io.lefectjava.worker.model.JavaClassSummary;
import io.lefectjava.worker.model.JavaMethodSummary;

import java.util.ArrayList;
import java.util.List;
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

    return new AstFileResult(sourcePath, sourceKind, packageName, imports, types);
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

    String fqn = packageName == null || packageName.isEmpty()
        ? type.getNameAsString()
        : packageName + "." + type.getNameAsString();

    return new JavaClassSummary(
        type.getNameAsString(),
        fqn,
        kind,
        extendsTypes,
        implementsTypes,
        methods
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
        .distinct()
        .collect(Collectors.toList());

    return new JavaMethodSummary(
        methodId,
        callable.getNameAsString(),
        returnType,
        parameters,
        calls
    );
  }

  private String buildMethodId(
      String packageName,
      String typeName,
      String methodName,
      List<String> parameters
  ) {
    String typeFqn = packageName == null || packageName.isEmpty()
        ? typeName
        : packageName + "." + typeName;
    return typeFqn + "#" + methodName + "(" + String.join(",", parameters) + ")";
  }

  private String resolveMethodCall(MethodCallExpr call) {
    try {
      ResolvedMethodDeclaration declaration = call.resolve();
      String qualified = declaration.getQualifiedSignature();
      int openParen = qualified.indexOf('(');
      int separator = openParen >= 0 ? qualified.lastIndexOf('.', openParen) : qualified.lastIndexOf('.');
      if (separator < 0) {
        return qualified;
      }
      return qualified.substring(0, separator) + "#" + qualified.substring(separator + 1);
    } catch (RuntimeException ex) {
      return call.getNameAsString();
    }
  }
}
