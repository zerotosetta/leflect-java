package io.lefectjava.worker.parser;

import com.github.javaparser.Position;
import com.github.javaparser.Range;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.ImportDeclaration;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.NodeList;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.AssignExpr;
import com.github.javaparser.ast.expr.ConditionalExpr;
import com.github.javaparser.ast.expr.EnclosedExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.LambdaExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.MethodReferenceExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.expr.VariableDeclarationExpr;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.IfStmt;
import com.github.javaparser.ast.stmt.ReturnStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.SwitchEntry;
import com.github.javaparser.ast.stmt.SwitchStmt;
import com.github.javaparser.ast.stmt.ThrowStmt;
import com.github.javaparser.ast.stmt.TryStmt;
import com.github.javaparser.ast.stmt.WhileStmt;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.Type;
import com.github.javaparser.resolution.MethodUsage;
import com.github.javaparser.resolution.declarations.ResolvedMethodDeclaration;
import com.github.javaparser.resolution.declarations.ResolvedReferenceTypeDeclaration;
import com.github.javaparser.resolution.declarations.ResolvedTypeParameterDeclaration;
import com.github.javaparser.resolution.types.ResolvedReferenceType;
import com.github.javaparser.resolution.types.ResolvedType;
import com.github.javaparser.utils.Pair;
import io.lefectjava.worker.model.AstFileResult;
import io.lefectjava.worker.model.JavaClassReference;
import io.lefectjava.worker.model.JavaClassSummary;
import io.lefectjava.worker.model.JavaFieldSummary;
import io.lefectjava.worker.model.JavaMethodCallSite;
import io.lefectjava.worker.model.JavaMethodSummary;
import io.lefectjava.worker.model.LineRange;
import io.lefectjava.worker.model.OrderedExecutionStep;
import io.lefectjava.worker.model.OrderedStepCall;
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

    if (type instanceof ClassOrInterfaceDeclaration) {
      ClassOrInterfaceDeclaration declaration = (ClassOrInterfaceDeclaration) type;
      kind = declaration.isInterface() ? "interface" : "class";
      declaration.getExtendedTypes()
          .forEach(classOrInterfaceType -> extendsTypes.add(classOrInterfaceType.asString()));
      declaration.getImplementedTypes()
          .forEach(classOrInterfaceType -> implementsTypes.add(classOrInterfaceType.asString()));
    } else if (type instanceof EnumDeclaration) {
      kind = "enum";
    }

    List<JavaMethodSummary> methods = new ArrayList<>();
    List<JavaFieldSummary> fields = new ArrayList<>();
    for (FieldDeclaration field : type.getFields()) {
      for (VariableDeclarator variable : field.getVariables()) {
        fields.add(toFieldSummary(packageName, type.getNameAsString(), field, variable));
      }
    }
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
        fields,
        methods,
        toSourceLocation(type),
        toLineRange(type)
    );
  }

  private JavaFieldSummary toFieldSummary(
      String packageName,
      String typeName,
      FieldDeclaration field,
      VariableDeclarator variable
  ) {
    String typeFqn = buildTypeFqn(packageName, typeName);

    return new JavaFieldSummary(
        typeFqn + "#" + variable.getNameAsString(),
        variable.getNameAsString(),
        variable.getType().asString(),
        variable.getType().asString(),
        field.getModifiers().stream()
            .map(modifier -> modifier.getKeyword().asString())
            .collect(Collectors.toList()),
        field.isStatic() ? "class" : "instance",
        variable.getInitializer().map(Node::toString).orElse(null),
        toSourceLocation(variable),
        toLineRange(variable)
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
    String returnType = callable instanceof MethodDeclaration
        ? ((MethodDeclaration) callable).getType().asString()
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
        toSourceLocation(callable),
        toLineRange(callable),
        collectOrderedSteps(methodId, callable)
    );
  }

  private List<JavaClassReference> collectClassReferences(CompilationUnit unit) {
    Map<String, JavaClassReference> references = new LinkedHashMap<>();

    for (ImportDeclaration importDeclaration : unit.findAll(ImportDeclaration.class)) {
      JavaClassReference reference = new JavaClassReference(
          importDeclaration.getNameAsString(),
          extractSimpleTypeName(importDeclaration.getNameAsString()),
          importDeclaration.getNameAsString(),
          importDeclaration.getNameAsString(),
          importDeclaration.isAsterisk() ? "import-wildcard" : "import",
          importDeclaration.toString().trim(),
          toSourceLocation(importDeclaration),
          toLineRange(importDeclaration)
      );
      references.put(referenceKey(reference), reference);
    }

    for (ClassOrInterfaceType type : unit.findAll(ClassOrInterfaceType.class)) {
      String qualifiedName = resolveTypeName(type);
      JavaClassReference reference = new JavaClassReference(
          type.getNameAsString(),
          type.getNameAsString(),
          qualifiedName,
          resolveTypeClassId(type, qualifiedName),
          resolveTypeKind(type),
          type.toString(),
          toSourceLocation(type),
          toLineRange(type)
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
    String targetClassId = resolution.classPath != null ? resolution.classPath : extractClassId(resolution.target);
    String targetMethodId = resolution.target.contains("#") ? resolution.target : null;

    return new JavaMethodCallSite(
        callerMethodId,
        callerClassId,
        resolution.target,
        toCallTargetText(call),
        targetClassId,
        targetClassId,
        targetMethodId,
        targetMethodId,
        resolution.methodName,
        resolution.classPath,
        resolution.parameterTypes,
        resolution.argumentExpressions,
        resolution.responseType,
        call.toString(),
        toSourceLocation(call),
        toLineRange(call)
    );
  }

  private List<OrderedExecutionStep> collectOrderedSteps(String methodId, CallableDeclaration<?> callable) {
    Optional<BlockStmt> body = getCallableBody(callable);
    if (body.isEmpty()) {
      return List.of();
    }

    OrderedStepCollector collector = new OrderedStepCollector(methodId);
    appendStatements(collector, body.get().getStatements(), List.of());
    return collector.steps;
  }

  private Optional<BlockStmt> getCallableBody(CallableDeclaration<?> callable) {
    if (callable instanceof MethodDeclaration) {
      return ((MethodDeclaration) callable).getBody();
    }
    if (callable instanceof ConstructorDeclaration) {
      return Optional.of(((ConstructorDeclaration) callable).getBody());
    }
    return Optional.empty();
  }

  private void appendStatements(
      OrderedStepCollector collector,
      NodeList<Statement> statements,
      List<String> branchPath
  ) {
    for (Statement statement : statements) {
      appendStatement(collector, statement, branchPath);
    }
  }

  private void appendStatement(
      OrderedStepCollector collector,
      Statement statement,
      List<String> branchPath
  ) {
    if (statement == null) {
      return;
    }

    if (statement.isBlockStmt()) {
      appendStatements(collector, statement.asBlockStmt().getStatements(), branchPath);
      return;
    }

    if (statement instanceof IfStmt) {
      IfStmt ifStmt = (IfStmt) statement;
      appendExpression(collector, ifStmt.getCondition(), branchPath);
      collector.addStep("branch", ifStmt, branchPath, null);
      appendStatement(collector, ifStmt.getThenStmt(), appendBranchPath(branchPath, "if:true"));
      ifStmt.getElseStmt()
          .ifPresent(elseStmt -> appendStatement(collector, elseStmt, appendBranchPath(branchPath, "if:false")));
      return;
    }

    if (statement instanceof SwitchStmt) {
      SwitchStmt switchStmt = (SwitchStmt) statement;
      appendExpression(collector, switchStmt.getSelector(), branchPath);
      collector.addStep("branch", switchStmt, branchPath, null);
      for (SwitchEntry entry : switchStmt.getEntries()) {
        appendStatements(collector, entry.getStatements(), appendBranchPath(branchPath, toSwitchBranch(entry)));
      }
      return;
    }

    if (statement instanceof ForStmt) {
      ForStmt forStmt = (ForStmt) statement;
      for (Expression expression : forStmt.getInitialization()) {
        appendExpression(collector, expression, branchPath);
      }
      forStmt.getCompare().ifPresent(expression -> appendExpression(collector, expression, branchPath));
      collector.addStep("loop", forStmt, branchPath, null);
      appendStatement(collector, forStmt.getBody(), appendBranchPath(branchPath, "for:body"));
      for (Expression expression : forStmt.getUpdate()) {
        appendExpression(collector, expression, appendBranchPath(branchPath, "for:update"));
      }
      return;
    }

    if (statement instanceof ForEachStmt) {
      ForEachStmt forEachStmt = (ForEachStmt) statement;
      appendExpression(collector, forEachStmt.getIterable(), branchPath);
      collector.addStep("loop", forEachStmt, branchPath, null);
      appendStatement(collector, forEachStmt.getBody(), appendBranchPath(branchPath, "for-each:body"));
      return;
    }

    if (statement instanceof WhileStmt) {
      WhileStmt whileStmt = (WhileStmt) statement;
      appendExpression(collector, whileStmt.getCondition(), branchPath);
      collector.addStep("loop", whileStmt, branchPath, null);
      appendStatement(collector, whileStmt.getBody(), appendBranchPath(branchPath, "while:body"));
      return;
    }

    if (statement instanceof DoStmt) {
      DoStmt doStmt = (DoStmt) statement;
      collector.addStep("loop", doStmt, branchPath, null);
      appendStatement(collector, doStmt.getBody(), appendBranchPath(branchPath, "do:body"));
      appendExpression(collector, doStmt.getCondition(), appendBranchPath(branchPath, "do:condition"));
      return;
    }

    if (statement instanceof TryStmt) {
      TryStmt tryStmt = (TryStmt) statement;
      for (Expression resource : tryStmt.getResources()) {
        appendExpression(collector, resource, branchPath);
      }
      collector.addStep("branch", tryStmt, branchPath, null);
      appendStatement(collector, tryStmt.getTryBlock(), appendBranchPath(branchPath, "try:body"));
      tryStmt.getCatchClauses().forEach(catchClause -> appendStatement(
          collector,
          catchClause.getBody(),
          appendBranchPath(branchPath, "catch:" + catchClause.getParameter().getType().asString())
      ));
      tryStmt.getFinallyBlock()
          .ifPresent(finallyBlock -> appendStatement(collector, finallyBlock, appendBranchPath(branchPath, "finally")));
      return;
    }

    if (statement instanceof ReturnStmt) {
      ReturnStmt returnStmt = (ReturnStmt) statement;
      returnStmt.getExpression().ifPresent(expression -> appendExpression(collector, expression, branchPath));
      collector.addStep("return", returnStmt, branchPath, null);
      return;
    }

    if (statement instanceof ThrowStmt) {
      ThrowStmt throwStmt = (ThrowStmt) statement;
      appendExpression(collector, throwStmt.getExpression(), branchPath);
      collector.addStep("throw", throwStmt, branchPath, null);
      return;
    }

    if (statement instanceof ExpressionStmt) {
      appendExpression(collector, ((ExpressionStmt) statement).getExpression(), branchPath);
    }
  }

  private void appendExpression(
      OrderedStepCollector collector,
      Expression expression,
      List<String> branchPath
  ) {
    if (expression == null || expression instanceof LambdaExpr || expression instanceof MethodReferenceExpr) {
      return;
    }

    if (expression instanceof EnclosedExpr) {
      appendExpression(collector, ((EnclosedExpr) expression).getInner(), branchPath);
      return;
    }

    if (expression instanceof VariableDeclarationExpr) {
      VariableDeclarationExpr declarationExpr = (VariableDeclarationExpr) expression;
      for (VariableDeclarator variable : declarationExpr.getVariables()) {
        variable.getInitializer().ifPresent(initializer -> appendExpression(collector, initializer, branchPath));
        collector.addStep("assignment", variable, branchPath, null);
      }
      return;
    }

    if (expression instanceof AssignExpr) {
      AssignExpr assignExpr = (AssignExpr) expression;
      appendExpression(collector, assignExpr.getValue(), branchPath);
      String kind = isEnclosingFieldReference(assignExpr.getTarget())
          ? "field-write"
          : "assignment";
      collector.addStep(kind, assignExpr, branchPath, null);
      return;
    }

    if (expression instanceof ConditionalExpr) {
      ConditionalExpr conditionalExpr = (ConditionalExpr) expression;
      appendExpression(collector, conditionalExpr.getCondition(), branchPath);
      collector.addStep("branch", conditionalExpr, branchPath, null);
      appendExpression(collector, conditionalExpr.getThenExpr(), appendBranchPath(branchPath, "ternary:true"));
      appendExpression(collector, conditionalExpr.getElseExpr(), appendBranchPath(branchPath, "ternary:false"));
      return;
    }

    if (expression instanceof MethodCallExpr) {
      MethodCallExpr callExpr = (MethodCallExpr) expression;
      callExpr.getScope().ifPresent(scope -> appendExpression(collector, scope, branchPath));
      for (Expression argument : callExpr.getArguments()) {
        appendExpression(collector, argument, branchPath);
      }
      MethodCallResolution resolution = resolveMethodCall(callExpr);
      String resolvedClassId = resolution.classPath != null ? resolution.classPath : extractClassId(resolution.target);
      String resolvedMethodId = resolution.target.contains("#") ? resolution.target : null;
      collector.addStep(
          "call",
          callExpr,
          branchPath,
          new OrderedStepCall(
              toCallTargetText(callExpr),
              resolvedMethodId,
              resolvedClassId,
              resolution.methodName
          )
      );
      return;
    }

    if (expression instanceof ObjectCreationExpr) {
      ObjectCreationExpr creationExpr = (ObjectCreationExpr) expression;
      creationExpr.getScope().ifPresent(scope -> appendExpression(collector, scope, branchPath));
      for (Expression argument : creationExpr.getArguments()) {
        appendExpression(collector, argument, branchPath);
      }
      collector.addStep("instantiate", creationExpr, branchPath, null);
      return;
    }

    if (expression instanceof NameExpr) {
      if (isEnclosingFieldReference(expression)) {
        collector.addStep("field-read", expression, branchPath, null);
      }
      return;
    }

    if (expression instanceof FieldAccessExpr) {
      FieldAccessExpr fieldAccessExpr = (FieldAccessExpr) expression;
      appendExpression(collector, fieldAccessExpr.getScope(), branchPath);
      if (fieldAccessExpr.getScope().isThisExpr()) {
        collector.addStep("field-read", expression, branchPath, null);
      }
      return;
    }

    for (Node child : expression.getChildNodes()) {
      if (child instanceof Expression) {
        appendExpression(collector, (Expression) child, branchPath);
      }
    }
  }

  private String toSwitchBranch(SwitchEntry entry) {
    if (entry.getLabels().isEmpty()) {
      return "switch:default";
    }
    return "switch:" + entry.getLabels().stream()
        .map(Node::toString)
        .collect(Collectors.joining("|"));
  }

  private List<String> appendBranchPath(List<String> branchPath, String segment) {
    List<String> next = new ArrayList<>(branchPath);
    next.add(segment);
    return next;
  }

  private boolean isEnclosingFieldReference(Node node) {
    if (node instanceof NameExpr) {
      return isEnclosingFieldReference(node, ((NameExpr) node).getNameAsString());
    }
    if (node instanceof FieldAccessExpr) {
      FieldAccessExpr fieldAccessExpr = (FieldAccessExpr) node;
      return fieldAccessExpr.getScope().isThisExpr() &&
          isEnclosingFieldReference(node, fieldAccessExpr.getNameAsString());
    }
    return false;
  }

  private boolean isEnclosingFieldReference(Node node, String name) {
    if (isLocalValue(node, name)) {
      return false;
    }

    Optional<TypeDeclaration<?>> type = node.findAncestor(TypeDeclaration.class)
        .map(value -> (TypeDeclaration<?>) value);
    if (type.isEmpty()) {
      return false;
    }

    for (FieldDeclaration field : type.get().getFields()) {
      for (VariableDeclarator variable : field.getVariables()) {
        if (name.equals(variable.getNameAsString())) {
          return true;
        }
      }
    }

    return false;
  }

  private boolean isLocalValue(Node node, String name) {
    Optional<CallableDeclaration<?>> callable = node.findAncestor(CallableDeclaration.class)
        .map(value -> (CallableDeclaration<?>) value);
    if (callable.isEmpty()) {
      return false;
    }

    for (Parameter parameter : callable.get().getParameters()) {
      if (name.equals(parameter.getNameAsString())) {
        return true;
      }
    }

    List<VariableDeclarator> candidates = callable.get().findAll(VariableDeclarator.class).stream()
        .filter(variable -> name.equals(variable.getNameAsString()) && isDeclaredBefore(variable, node))
        .collect(Collectors.toList());
    return !candidates.isEmpty();
  }

  private String toCallTargetText(MethodCallExpr call) {
    return call.getScope()
        .map(scope -> scope + "." + call.getNameAsString())
        .orElse(call.getNameAsString());
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
      return resolveMethodCallWithSymbolSolver(call, argumentExpressions);
    } catch (RuntimeException ex) {
      return resolveMethodCallFallback(call, argumentExpressions)
          .orElseGet(() -> unresolvedMethodCall(call, argumentExpressions));
    }
  }

  private MethodCallResolution resolveMethodCallWithSymbolSolver(
      MethodCallExpr call,
      List<String> argumentExpressions
  ) {
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
  }

  private Optional<MethodCallResolution> resolveMethodCallFallback(
      MethodCallExpr call,
      List<String> argumentExpressions
  ) {
    Optional<MethodUsage> scopedUsage = resolveMethodUsageFromScope(call);
    if (scopedUsage.isPresent()) {
      return Optional.of(toMethodCallResolution(scopedUsage.get(), argumentExpressions));
    }

    Optional<MethodUsage> astScopedUsage = resolveMethodUsageFromAstScope(call);
    if (astScopedUsage.isPresent()) {
      return Optional.of(toMethodCallResolution(astScopedUsage.get(), argumentExpressions));
    }

    Optional<String> scopedClassPath = resolveScopeClassPath(call);
    if (scopedClassPath.isPresent()) {
      return Optional.of(new MethodCallResolution(
          call.getNameAsString(),
          call.getNameAsString(),
          scopedClassPath.get(),
          List.of(),
          argumentExpressions,
          null
      ));
    }

    Optional<String> astScopedClassPath = resolveAstScopeClassPath(call);
    if (astScopedClassPath.isPresent()) {
      return Optional.of(new MethodCallResolution(
          call.getNameAsString(),
          call.getNameAsString(),
          astScopedClassPath.get(),
          List.of(),
          argumentExpressions,
          null
      ));
    }

    Optional<MethodUsage> localUsage = resolveMethodUsageFromEnclosingType(call);
    return localUsage.map(methodUsage -> toMethodCallResolution(methodUsage, argumentExpressions));
  }

  private MethodCallResolution toMethodCallResolution(
      MethodUsage usage,
      List<String> argumentExpressions
  ) {
    String classPath = safeQualifiedName(usage.declaringType());
    List<String> parameterTypes = usage.getParamTypes().stream()
        .map(this::safeDescribe)
        .collect(Collectors.toList());
    String target = classPath == null
        ? usage.getName()
        : classPath + "#" + usage.getName() + "(" + String.join(",", parameterTypes) + ")";

    return new MethodCallResolution(
        target,
        usage.getName(),
        classPath,
        parameterTypes,
        argumentExpressions,
        safeDescribe(usage.returnType())
    );
  }

  private Optional<MethodUsage> resolveMethodUsageFromScope(MethodCallExpr call) {
    if (call.getScope().isEmpty()) {
      return Optional.empty();
    }

    try {
      ResolvedType scopeType = call.getScope().get().calculateResolvedType();
      if (!scopeType.isReferenceType()) {
        return Optional.empty();
      }
      String preferredClassPath = safeQualifiedName(scopeType.asReferenceType());
      return selectMethodUsage(
          collectMethodUsages(scopeType.asReferenceType()),
          call.getNameAsString(),
          call.getArguments().size(),
          preferredClassPath
      );
    } catch (RuntimeException ex) {
      return Optional.empty();
    }
  }

  private Optional<String> resolveScopeClassPath(MethodCallExpr call) {
    if (call.getScope().isEmpty()) {
      return Optional.empty();
    }

    try {
      ResolvedType scopeType = call.getScope().get().calculateResolvedType();
      if (!scopeType.isReferenceType()) {
        return Optional.empty();
      }
      return Optional.ofNullable(scopeType.asReferenceType().getQualifiedName());
    } catch (RuntimeException ex) {
      return Optional.empty();
    }
  }

  private Optional<MethodUsage> resolveMethodUsageFromAstScope(MethodCallExpr call) {
    try {
      Optional<ResolvedType> scopeType = resolveScopeTypeFromAst(call);
      if (scopeType.isEmpty() || !scopeType.get().isReferenceType()) {
        return Optional.empty();
      }

      ResolvedReferenceType referenceType = scopeType.get().asReferenceType();
      String preferredClassPath = safeQualifiedName(referenceType);
      return selectMethodUsage(
          collectMethodUsages(referenceType),
          call.getNameAsString(),
          call.getArguments().size(),
          preferredClassPath
      );
    } catch (RuntimeException ex) {
      return Optional.empty();
    }
  }

  private Optional<String> resolveAstScopeClassPath(MethodCallExpr call) {
    Optional<ResolvedType> scopeType = resolveScopeTypeFromAst(call);
    if (scopeType.isEmpty() || !scopeType.get().isReferenceType()) {
      return Optional.empty();
    }
    return Optional.ofNullable(safeQualifiedName(scopeType.get().asReferenceType()));
  }

  private Optional<MethodUsage> resolveMethodUsageFromEnclosingType(MethodCallExpr call) {
    if (call.getScope().isPresent()) {
      return Optional.empty();
    }

    try {
      Optional<ResolvedReferenceTypeDeclaration> type = resolveEnclosingTypeDeclaration(call);
      if (type.isEmpty()) {
        return Optional.empty();
      }

      String preferredClassPath = safeQualifiedName(type.get());
      return selectMethodUsage(
          type.get().getAllMethods(),
          call.getNameAsString(),
          call.getArguments().size(),
          preferredClassPath
      );
    } catch (RuntimeException ex) {
      return Optional.empty();
    }
  }

  private List<MethodUsage> collectMethodUsages(ResolvedReferenceType referenceType) {
    Map<String, MethodUsage> methods = new LinkedHashMap<>();

    for (MethodUsage usage : referenceType.getDeclaredMethods()) {
      MethodUsage substituted = applyTypeParameters(referenceType, usage);
      methods.putIfAbsent(methodUsageKey(substituted), substituted);
    }
    for (ResolvedReferenceType ancestor : referenceType.getAllAncestors()) {
      for (MethodUsage usage : ancestor.getDeclaredMethods()) {
        MethodUsage substituted = applyTypeParameters(ancestor, usage);
        methods.putIfAbsent(methodUsageKey(substituted), substituted);
      }
    }

    return new ArrayList<>(methods.values());
  }

  private Optional<MethodUsage> selectMethodUsage(
      Iterable<MethodUsage> candidates,
      String methodName,
      int argumentCount,
      String preferredClassPath
  ) {
    List<MethodUsage> namedMatches = new ArrayList<>();
    for (MethodUsage usage : candidates) {
      if (methodName.equals(usage.getName())) {
        namedMatches.add(usage);
      }
    }

    if (namedMatches.isEmpty()) {
      return Optional.empty();
    }

    List<MethodUsage> arityMatches = namedMatches.stream()
        .filter(usage -> usage.getNoParams() == argumentCount)
        .collect(Collectors.toList());
    if (arityMatches.size() == 1) {
      return Optional.of(arityMatches.get(0));
    }
    if (arityMatches.size() > 1 && preferredClassPath != null) {
      List<MethodUsage> preferredMatches = arityMatches.stream()
          .filter(usage -> preferredClassPath.equals(safeQualifiedName(usage.declaringType())))
          .collect(Collectors.toList());
      if (preferredMatches.size() == 1) {
        return Optional.of(preferredMatches.get(0));
      }
    }
    if (namedMatches.size() == 1) {
      return Optional.of(namedMatches.get(0));
    }

    return Optional.empty();
  }

  private Optional<ResolvedType> resolveScopeTypeFromAst(MethodCallExpr call) {
    if (call.getScope().isEmpty()) {
      return Optional.empty();
    }

    Node scope = call.getScope().get();
    if (scope instanceof FieldAccessExpr) {
      FieldAccessExpr fieldAccess = (FieldAccessExpr) scope;
      if (fieldAccess.getScope().isThisExpr()) {
        return resolveFieldTypeFromEnclosingType(call, fieldAccess.getNameAsString());
      }
    }
    if (scope instanceof NameExpr) {
      NameExpr nameExpr = (NameExpr) scope;
      Optional<ResolvedType> localType = resolveLocalValueType(call, nameExpr.getNameAsString());
      if (localType.isPresent()) {
        return localType;
      }
      return resolveFieldTypeFromEnclosingType(call, nameExpr.getNameAsString());
    }

    return Optional.empty();
  }

  private Optional<ResolvedType> resolveLocalValueType(Node node, String name) {
    Optional<CallableDeclaration<?>> callable = node.findAncestor(CallableDeclaration.class)
        .map(value -> (CallableDeclaration<?>) value);
    if (callable.isEmpty()) {
      return Optional.empty();
    }

    for (Parameter parameter : callable.get().getParameters()) {
      if (name.equals(parameter.getNameAsString())) {
        return resolveTypeNode(parameter.getType());
      }
    }

    List<VariableDeclarator> candidates = callable.get().findAll(VariableDeclarator.class).stream()
        .filter(variable -> name.equals(variable.getNameAsString()) && isDeclaredBefore(variable, node))
        .collect(Collectors.toList());
    if (candidates.isEmpty()) {
      return Optional.empty();
    }

    return resolveTypeNode(candidates.get(candidates.size() - 1).getType());
  }

  private Optional<ResolvedType> resolveFieldTypeFromEnclosingType(Node node, String fieldName) {
    Optional<TypeDeclaration<?>> type = node.findAncestor(TypeDeclaration.class)
        .map(value -> (TypeDeclaration<?>) value);
    if (type.isEmpty()) {
      return Optional.empty();
    }

    for (FieldDeclaration field : type.get().getFields()) {
      for (VariableDeclarator variable : field.getVariables()) {
        if (fieldName.equals(variable.getNameAsString())) {
          return resolveTypeNode(variable.getType());
        }
      }
    }

    return Optional.empty();
  }

  private Optional<ResolvedType> resolveTypeNode(Type type) {
    try {
      return Optional.of(type.resolve());
    } catch (RuntimeException ex) {
      return Optional.empty();
    }
  }

  private Optional<ResolvedReferenceTypeDeclaration> resolveEnclosingTypeDeclaration(MethodCallExpr call) {
    try {
      return call.findAncestor(TypeDeclaration.class)
          .map(value -> (TypeDeclaration<?>) value)
          .map(TypeDeclaration::resolve)
          .map(ResolvedReferenceTypeDeclaration.class::cast);
    } catch (RuntimeException ex) {
      return Optional.empty();
    }
  }

  private boolean isDeclaredBefore(Node declaration, Node usage) {
    Optional<Range> declarationRange = declaration.getRange();
    Optional<Range> usageRange = usage.getRange();
    if (declarationRange.isEmpty() || usageRange.isEmpty()) {
      return true;
    }

    Range declarationValue = declarationRange.get();
    Range usageValue = usageRange.get();
    if (declarationValue.begin.line != usageValue.begin.line) {
      return declarationValue.begin.line < usageValue.begin.line;
    }
    return declarationValue.begin.column <= usageValue.begin.column;
  }

  private String methodUsageKey(MethodUsage usage) {
    String classPath = safeQualifiedName(usage.declaringType());
    return (classPath != null ? classPath : "") + "#" + usage.getName() + ":" + usage.getNoParams();
  }

  private MethodUsage applyTypeParameters(ResolvedReferenceType referenceType, MethodUsage usage) {
    MethodUsage substituted = usage;
    for (Pair<ResolvedTypeParameterDeclaration, ResolvedType> entry : referenceType.getTypeParametersMap()) {
      substituted = substituted.replaceTypeParameter(entry.a, entry.b);
    }
    return substituted;
  }

  private String safeQualifiedName(ResolvedReferenceTypeDeclaration typeDeclaration) {
    try {
      return typeDeclaration.getQualifiedName();
    } catch (RuntimeException ex) {
      return null;
    }
  }

  private String safeQualifiedName(ResolvedReferenceType referenceType) {
    try {
      return referenceType.getQualifiedName();
    } catch (RuntimeException ex) {
      return null;
    }
  }

  private String safeDescribe(ResolvedType type) {
    try {
      return type.describe();
    } catch (RuntimeException ex) {
      return type.toString();
    }
  }

  private MethodCallResolution unresolvedMethodCall(
      MethodCallExpr call,
      List<String> argumentExpressions
  ) {
    return new MethodCallResolution(
        call.getNameAsString(),
        call.getNameAsString(),
        null,
        List.of(),
        argumentExpressions,
        null
    );
  }

  private String resolveTypeName(ClassOrInterfaceType type) {
    try {
      return type.resolve().describe();
    } catch (RuntimeException ex) {
      return type.asString();
    }
  }

  private String resolveTypeClassId(ClassOrInterfaceType type, String fallback) {
    try {
      ResolvedType resolvedType = type.resolve();
      if (resolvedType.isReferenceType()) {
        return safeQualifiedName(resolvedType.asReferenceType());
      }
      return resolvedType.describe();
    } catch (RuntimeException ex) {
      if (fallback == null) {
        return null;
      }
      int genericIndex = fallback.indexOf('<');
      return genericIndex >= 0 ? fallback.substring(0, genericIndex) : fallback;
    }
  }

  private String resolveTypeKind(ClassOrInterfaceType type) {
    Node parent = type.getParentNode().orElse(null);
    if (parent instanceof ClassOrInterfaceDeclaration) {
      ClassOrInterfaceDeclaration declaration = (ClassOrInterfaceDeclaration) parent;
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

  private LineRange toLineRange(Node node) {
    return node.getRange()
        .map(this::toLineRange)
        .orElse(null);
  }

  private SourceLocation toSourceLocation(Range range) {
    Position begin = range.begin;
    Position end = range.end;
    return new SourceLocation(begin.line, begin.column, end.line, end.column);
  }

  private LineRange toLineRange(Range range) {
    Position begin = range.begin;
    Position end = range.end;
    return new LineRange(begin.line, begin.column, end.line, end.column);
  }

  private String extractSimpleTypeName(String value) {
    if (value == null || value.isEmpty()) {
      return value;
    }
    String normalized = value.endsWith(".*") ? value.substring(0, value.length() - 2) : value;
    int separator = normalized.lastIndexOf('.');
    return separator >= 0 ? normalized.substring(separator + 1) : normalized;
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

  private static final class OrderedStepCollector {
    private final String methodId;
    private final List<OrderedExecutionStep> steps;
    private int nextIndex;

    private OrderedStepCollector(String methodId) {
      this.methodId = methodId;
      this.steps = new ArrayList<>();
      this.nextIndex = 0;
    }

    private void addStep(
        String kind,
        Node node,
        List<String> branchPath,
        OrderedStepCall call
    ) {
      this.nextIndex += 1;
      this.steps.add(new OrderedExecutionStep(
          methodId + ":step:" + nextIndex,
          kind,
          node.toString(),
          new ArrayList<>(branchPath),
          toStaticLineRange(node),
          call
      ));
    }

    private LineRange toStaticLineRange(Node node) {
      Optional<Range> range = node.getRange();
      if (range.isEmpty()) {
        return null;
      }

      Position begin = range.get().begin;
      Position end = range.get().end;
      return new LineRange(begin.line, begin.column, end.line, end.column);
    }
  }
}
