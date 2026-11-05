package io.lefectjava.worker.parser;

import com.github.javaparser.Range;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.*;
import com.github.javaparser.ast.type.UnionType;
import com.github.javaparser.resolution.declarations.ResolvedFieldDeclaration;
import com.github.javaparser.resolution.declarations.ResolvedMethodDeclaration;
import com.github.javaparser.resolution.types.ResolvedType;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Explicit-source, method-local execution model. This deliberately does not change the legacy
 * source summary. Conditions and pending finally completions are part of the graph, not strings
 * which a consumer must reparse. A canonical source operation is emitted only once.
 */
public final class JavaExecutionModelExtractor {
  public Map<String, Object> extract(CallableDeclaration<?> callable, String methodId) {
    return new Builder(callable, methodId).extract();
  }

  private static Map<String, Object> map(Object... entries) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (int i = 0; i < entries.length; i += 2) if (entries[i + 1] != null)
      result.put(String.valueOf(entries[i]), entries[i + 1]);
    return result;
  }

  private static Map<String, Object> range(Node node) {
    return node.getRange().map(r -> map("startLine", r.begin.line, "startColumn", r.begin.column,
        "endLine", r.end.line, "endColumn", r.end.column)).orElseGet(LinkedHashMap::new);
  }

  private static String position(Node node) {
    return node.getRange().map(r -> r.begin.line + ":" + r.begin.column + "-" + r.end.line + ":" + r.end.column)
        .orElse("synthetic");
  }

  private static boolean contains(Node owner, Node child) {
    for (Node cursor = child; cursor != null; cursor = cursor.getParentNode().orElse(null))
      if (cursor == owner) return true;
    return false;
  }

  private static Expression unwrap(Expression expression) {
    while (expression instanceof EnclosedExpr) expression = ((EnclosedExpr) expression).getInner();
    return expression;
  }

  private static Node declarationSource(VariableDeclarator variable) {
    Node parent=variable.getParentNode().orElse(variable);
    if(parent instanceof VariableDeclarationExpr){Node statement=parent.getParentNode().orElse(parent);return statement instanceof ExpressionStmt?statement:parent;}
    return variable;
  }

  private static final class Fragment {
    final String entry;
    final List<String> exits;
    Fragment(String entry, Collection<String> exits) { this.entry = entry; this.exits = new ArrayList<>(exits); }
  }

  private static final class Condition {
    final String entry;
    final List<String> yes;
    final List<String> no;
    Condition(String entry, Collection<String> yes, Collection<String> no) {
      this.entry = entry; this.yes = new ArrayList<>(yes); this.no = new ArrayList<>(no);
    }
  }

  private static final class Symbol {
    final String id, name, type, kind;
    final Node declaration, scope;
    final boolean primitive;
    final String binding;
    Symbol(String id, String name, String type, String kind, Node declaration, Node scope, boolean primitive, String binding) {
      this.id = id; this.name = name; this.type = type; this.kind = kind; this.declaration = declaration;
      this.scope = scope; this.primitive = primitive; this.binding = binding;
    }
    Map<String,Object> json() {
      return map("id", id, "name", name, "declaredType", type, "kind", kind,
          "lineRange", range(declaration), "scopeRange", range(scope), "binding", binding, "primitive", primitive);
    }
  }

  private record ValueState(String initialization, String nullability) {
    Map<String,Object> json() { return map("initialization", initialization, "nullability", nullability); }
  }

  private static final class Target {
    final Node owner;
    final String breakNode, continueNode, label;
    Target(Node owner, String breakNode, String continueNode, String label) {
      this.owner = owner; this.breakNode = breakNode; this.continueNode = continueNode; this.label = label;
    }
  }

  private record Handler(CatchClause clause, String node) {}
  private record Pending(String token, String target, List<FinallyRegion> remaining, String kind) {}

  private static final class FinallyRegion {
    final TryStmt owner;
    final BlockStmt body;
    final String frameId, entry;
    final List<Pending> pending = new ArrayList<>();
    FinallyRegion(TryStmt owner, BlockStmt body, String frameId, String entry) {
      this.owner = owner; this.body = body; this.frameId = frameId; this.entry = entry;
    }
  }

  private static final class Context {
    final List<Map<String,Object>> guards;
    final List<String> branches;
    final List<Target> targets;
    final List<Handler> handlers;
    final List<FinallyRegion> finalizers, activeFinalizers;
    Context() { this(List.of(), List.of(), List.of(), List.of(), List.of(), List.of()); }
    Context(List<Map<String,Object>> guards, List<String> branches, List<Target> targets, List<Handler> handlers,
            List<FinallyRegion> finalizers, List<FinallyRegion> activeFinalizers) {
      this.guards = guards; this.branches = branches; this.targets = targets; this.handlers = handlers;
      this.finalizers = finalizers; this.activeFinalizers = activeFinalizers;
    }
    Context guard(Map<String,Object> guard, String branch) {
      return new Context(append(guards, guard), append(branches, branch), targets, handlers, finalizers, activeFinalizers);
    }
    Context branch(String branch) { return new Context(guards, append(branches, branch), targets, handlers, finalizers, activeFinalizers); }
    Context target(Target target) { return new Context(guards, branches, prepend(targets, target), handlers, finalizers, activeFinalizers); }
    Context protect(List<Handler> catches, FinallyRegion region) {
      List<Handler> all = new ArrayList<>(catches); all.addAll(handlers);
      return new Context(guards, branches, targets, all, region == null ? finalizers : prepend(finalizers, region), activeFinalizers);
    }
    Context catchBody(FinallyRegion region) {
      return new Context(guards, branches, targets, handlers, region == null ? finalizers : prepend(finalizers, region), activeFinalizers);
    }
    Context finallyBody(FinallyRegion region) {
      return new Context(guards, append(branches, "finally:" + position(region.owner)), targets, handlers, finalizers,
          prepend(activeFinalizers, region));
    }
    private static <T> List<T> append(List<T> values, T value) { List<T> r = new ArrayList<>(values); r.add(value); return r; }
    private static <T> List<T> prepend(List<T> values, T value) { List<T> r = new ArrayList<>(); r.add(value); r.addAll(values); return r; }
  }

  private static final class Builder {
    private final CallableDeclaration<?> callable;
    private final String methodId;
    private final List<Map<String,Object>> steps = new ArrayList<>(), nodes = new ArrayList<>(), edges = new ArrayList<>(), unsupported = new ArrayList<>();
    private final Map<String,Map<String,Object>> nodeById = new LinkedHashMap<>(), stepByNode = new LinkedHashMap<>();
    private final IdentityHashMap<Node,Map<String,Map<String,Object>>> canonical = new IdentityHashMap<>();
    private final IdentityHashMap<Node,Symbol> declarationSymbols = new IdentityHashMap<>();
    private final Map<String,Symbol> symbols = new LinkedHashMap<>();
    private final Map<String,Expression> predicates = new LinkedHashMap<>(), assignedValues = new LinkedHashMap<>();
    private final Map<String,String> writes = new LinkedHashMap<>();
    private final Map<String,Boolean> initialBindings = new LinkedHashMap<>();
    private final Set<String> mutationNodes = new LinkedHashSet<>(), callNodes = new LinkedHashSet<>();
    private final String entry, normalExit, exceptionalExit;
    private int syntheticSequence, completionSequence;

    Builder(CallableDeclaration<?> callable, String methodId) {
      this.callable = callable; this.methodId = methodId;
      entry = control("entry", callable); normalExit = control("exit", callable); exceptionalExit = control("exception-exit", callable);
      collectSymbols();
    }

    Map<String,Object> extract() {
      BlockStmt body = callable instanceof MethodDeclaration ? ((MethodDeclaration) callable).getBody().orElse(null)
          : callable instanceof ConstructorDeclaration ? ((ConstructorDeclaration) callable).getBody() : null;
      if (body != null) {
        Fragment f = statement(body, new Context(), null); edge(entry, f.entry, "normal"); connect(f.exits, normalExit, "normal");
      } else edge(entry, normalExit, "no-body");
      Map<String,Object> stateResult = analyzeStates();
      return map("version", 2, "methodId", methodId, "orderedSteps", steps,
          "flowGraph", map("entryNodeId", entry, "exitNodeIds", List.of(normalExit, exceptionalExit), "nodes", nodes, "edges", edges,
              "conditions", predicates.entrySet().stream().map(e -> map("id", e.getKey(), "expression", e.getValue().toString(), "lineRange", range(e.getValue()))).toList(),
              "completionSemantics", "Finally entry pushes a frame token; resume edges require that token and clear it. Abrupt finally completion overrides pending frames."),
          "symbols", symbols.values().stream().map(Symbol::json).toList(), "states", stateResult.get("states"),
          "coverage", map("status", unsupported.isEmpty() && Boolean.TRUE.equals(stateResult.get("complete")) ? "complete" : "partial",
              "sourceScope", "explicit-source-method-local", "unsupportedNodes", unsupported, "stateAnalysis", stateResult.get("analysis"),
              "limits", List.of("No interprocedural/heap alias analysis or implicit resource-close/constructor operations",
                  "Unknown callee effects retain possible exception paths and invalidate tracked field null states", "No automatic null-dereference warnings")));
    }

    private boolean belongs(Node node) {
      for (Node n = node; n != null && n != callable; n = n.getParentNode().orElse(null)) {
        if (n instanceof LambdaExpr || n instanceof TypeDeclaration<?> || (n instanceof CallableDeclaration<?> && n != callable)) return false;
      }
      return contains(callable, node);
    }

    private void collectSymbols() {
      for (Parameter p : callable.getParameters()) addSymbol(p, p.getNameAsString(), p.getTypeAsString(), "parameter", callable, p.getType().isPrimitiveType(), "parameter");
      for (VariableDeclarator v : callable.findAll(VariableDeclarator.class)) if (belongs(v)) {
        Node scope = variableScope(v); String binding = scope instanceof ForEachStmt ? "iteration" : "local";
        addSymbol(v, v.getNameAsString(), v.getTypeAsString(), "local", scope, v.getType().isPrimitiveType(), binding);
      }
      for (CatchClause c : callable.findAll(CatchClause.class)) if (belongs(c)) {
        Parameter p = c.getParameter(); addSymbol(p, p.getNameAsString(), p.getTypeAsString(), "catch", c.getBody(), false, "catch");
      }
    }

    private Node variableScope(VariableDeclarator v) {
      Node parent = v.getParentNode().orElse(v);
      Node owner = parent.getParentNode().orElse(parent);
      if (owner instanceof ForStmt || owner instanceof ForEachStmt || owner instanceof TryStmt) return owner;
      return v.findAncestor(BlockStmt.class).map(n -> (Node)n).orElse(callable);
    }

    private Symbol addSymbol(Node declaration, String name, String type, String kind, Node scope, boolean primitive, String binding) {
      Symbol existing = declarationSymbols.get(declaration); if (existing != null) return existing;
      Node nameNode = declaration instanceof VariableDeclarator ? ((VariableDeclarator) declaration).getName()
          : declaration instanceof Parameter ? ((Parameter) declaration).getName() : declaration;
      Symbol symbol = new Symbol(methodId + ":symbol:" + position(nameNode) + ":" + name, name, type, kind, declaration, scope, primitive, binding);
      symbols.put(symbol.id, symbol); declarationSymbols.put(declaration, symbol); return symbol;
    }

    private Symbol symbol(Expression expression) {
      expression = unwrap(expression);
      if (expression instanceof NameExpr) {
        String name = ((NameExpr)expression).getNameAsString(); Symbol best = null;
        for (Symbol candidate : symbols.values()) if (!candidate.kind.equals("field") && candidate.name.equals(name) && inScope(candidate, expression)) {
          if (best == null || depth(candidate.scope) > depth(best.scope)
              || (depth(candidate.scope) == depth(best.scope) && begin(candidate.declaration) > begin(best.declaration))) best = candidate;
        }
        if (best != null) return best;
      }
      if (expression instanceof NameExpr || expression instanceof FieldAccessExpr) {
        try {
          var value = expression instanceof NameExpr ? ((NameExpr)expression).resolve() : ((FieldAccessExpr)expression).resolve();
          if (value.isField()) {
            ResolvedFieldDeclaration field = value.asField();
            String receiver = expression instanceof FieldAccessExpr ? ((FieldAccessExpr) expression).getScope().toString() : "this";
            // Only this/static storage has a stable receiver in this method-local model.
            // Two occurrences of factory().field or reassignedLocal.field must not alias by text.
            boolean stable=field.isStatic()||!(expression instanceof FieldAccessExpr)||((FieldAccessExpr)expression).getScope() instanceof ThisExpr||((FieldAccessExpr)expression).getScope() instanceof SuperExpr;
            String identity=field.isStatic()?"static":stable?"this":receiver+":"+position(expression);
            String id = field.declaringType().getQualifiedName() + "#" + field.getName() + "@" + identity;
            return symbols.computeIfAbsent(id, k -> new Symbol(id, field.getName(), field.getType().describe(), "field", field.toAst().map(n -> (Node)n).orElse(callable), callable,
                field.getType().isPrimitive(), receiver));
          }
        } catch (RuntimeException ignored) { /* Explicit unresolved target remains visible in effects. */ }
      }
      return null;
    }

    private boolean inScope(Symbol symbol, Node use) {
      if (!contains(symbol.scope, use)) return false;
      if (symbol.kind.equals("parameter") || symbol.kind.equals("catch")) return true;
      if (begin(symbol.declaration) > begin(use)) return false;
      if (symbol.scope instanceof TryStmt) {
        TryStmt t = (TryStmt)symbol.scope;
        return contains(t.getTryBlock(), use) || t.getResources().stream().anyMatch(r -> contains(r, use));
      }
      return true;
    }

    private int depth(Node node) { int n = 0; for (; node != null; node = node.getParentNode().orElse(null)) n++; return n; }
    private long begin(Node node) { return node.getBegin().map(p -> ((long)p.line << 32) + p.column).orElse(-1L); }

    private String control(String role, Node source) {
      String id = methodId + ":flow:" + role + ":" + position(source) + ":" + syntheticSequence++;
      Map<String,Object> node = map("id", id, "kind", role, "lineRange", range(source)); nodes.add(node); nodeById.put(id,node); return id;
    }

    private Map<String,Object> step(String kind, Node source, Context context) {
      Map<String,Map<String,Object>> roles = canonical.computeIfAbsent(source, n -> new LinkedHashMap<>());
      Map<String,Object> prior = roles.get(kind);
      if (prior != null) return prior;
      String id = methodId + ":v2:" + kind + ":" + position(source);
      String nodeId = id + ":flow";
      Map<String,Object> s = map("id", id, "kind", kind, "snippet", source.toString(), "lineRange", range(source),
          "flowNodeId", nodeId, "branchPath", context.branches, "guards", context.guards,
          "guardRefs", context.guards.stream().map(g -> g.get("id")).toList(),
          "guardStatus", context.guards.isEmpty() ? "flow-dependent" : "conditional");
      Map<String,Object> n = map("id", nodeId, "kind", kind, "stepId", id, "lineRange", range(source));
      roles.put(kind,s); steps.add(s); nodes.add(n); nodeById.put(nodeId,n); stepByNode.put(nodeId,s); return s;
    }
    private String node(Map<String,Object> step) { return (String)step.get("flowNodeId"); }
    private Fragment single(Map<String,Object> step) { String id = node(step); return new Fragment(id,List.of(id)); }
    private void edge(String from, String to, String kind) { edge(from,to,kind,Map.of()); }
    private void edge(String from, String to, String kind, Map<String,Object> extra) {
      Map<String,Object> e = map("from", from, "to", to, "kind", kind); e.putAll(extra); edges.add(e);
    }
    private void connect(Collection<String> from, String to, String kind) { from.forEach(n -> edge(n,to,kind)); }
    private Fragment sequence(Fragment first, Fragment next) {
      if (first == null) return next; if (next == null) return first;
      connect(first.exits,next.entry,"normal"); return new Fragment(first.entry, first.exits.isEmpty() ? List.of() : next.exits);
    }
    private Fragment empty(Node source) { String id=control("empty",source); return new Fragment(id,List.of(id)); }
    private Map<String,Object> guard(Expression expression, boolean when) {
      String id=methodId+":condition:"+position(expression); predicates.putIfAbsent(id,expression);
      return map("id",id+":"+when,"conditionId",id,"expression",expression.toString(),"when",when,"lineRange",range(expression));
    }
    private void conditionEdge(Collection<String> tails, String to, Expression expression, boolean when) {
      Map<String,Object> g=guard(expression,when);
      // Outcome ports already carry facts established at the time the operand was evaluated.
      // Reapplying a whole && expression here would restore facts invalidated by its RHS calls.
      for(String tail:tails) edge(tail,to,when?"condition:true":"condition:false",map("conditionId",g.get("conditionId"),"when",when,"refine",false));
    }

    private Fragment statement(Statement statement, Context context, String label) {
      if(statement instanceof BlockStmt) {
        Fragment result=null;
        for(Statement child:((BlockStmt)statement).getStatements()) {
          if(result!=null&&result.exits.isEmpty()) break;
          result=sequence(result,statement(child,context,null));
        }
        return result==null?empty(statement):result;
      }
      if(statement instanceof LabeledStmt) {
        LabeledStmt l=(LabeledStmt)statement; Statement body=l.getStatement();
        if(body instanceof WhileStmt||body instanceof ForStmt||body instanceof ForEachStmt||body instanceof DoStmt)
          return statement(body,context,l.getLabel().asString());
        String after=control("label:after",statement);
        Fragment f=statement(body,context.target(new Target(statement,after,null,l.getLabel().asString())),null);
        connect(f.exits,after,"normal");return new Fragment(f.entry,List.of(after));
      }
      if(statement instanceof IfStmt) {
        IfStmt s=(IfStmt)statement; Fragment marker=single(step("branch",s,context)); Condition c=condition(s.getCondition(),context);
        connect(marker.exits,c.entry,"normal");
        Fragment yes=statement(s.getThenStmt(),context.guard(guard(s.getCondition(),true),"if:true"),null);
        String after=control("if:after",s); conditionEdge(c.yes,yes.entry,s.getCondition(),true);connect(yes.exits,after,"normal");
        if(s.getElseStmt().isPresent()) {Fragment no=statement(s.getElseStmt().get(),context.guard(guard(s.getCondition(),false),"if:false"),null);conditionEdge(c.no,no.entry,s.getCondition(),false);connect(no.exits,after,"normal");}
        else conditionEdge(c.no,after,s.getCondition(),false);
        boolean normal=!yes.exits.isEmpty()||s.getElseStmt().isEmpty()||hasIncoming(after);
        return new Fragment(marker.entry,normal?List.of(after):List.of());
      }
      if(statement instanceof ForStmt) return forLoop((ForStmt)statement,context,label);
      if(statement instanceof WhileStmt) return whileLoop((WhileStmt)statement,context,label);
      if(statement instanceof DoStmt) return doLoop((DoStmt)statement,context,label);
      if(statement instanceof ForEachStmt) return foreachLoop((ForEachStmt)statement,context,label);
      if(statement instanceof SwitchStmt) return switchStatement((SwitchStmt)statement,context,label);
      if(statement instanceof TryStmt) return tryStatement((TryStmt)statement,context);
      if(statement instanceof SynchronizedStmt) {
        SynchronizedStmt s=(SynchronizedStmt)statement;Fragment lock=expression(s.getExpression(),context);
        Fragment marker=single(step("synchronized",s,context));Fragment body=statement(s.getBody(),context.branch("synchronized:"+position(s)),null);
        return sequence(sequence(lock,marker),body);
      }
      if(statement instanceof ExpressionStmt) return expression(((ExpressionStmt)statement).getExpression(),context);
      if(statement instanceof ExplicitConstructorInvocationStmt) {
        ExplicitConstructorInvocationStmt s=(ExplicitConstructorInvocationStmt)statement;Fragment result=null;
        if(s.getExpression().isPresent()) result=expression(s.getExpression().get(),context);
        for(Expression arg:s.getArguments())result=sequence(result,expression(arg,context));
        Map<String,Object> call=step("constructor-call",s,context);call.put("invocationKind",s.isThis()?"this-constructor":"super-constructor");
        Map<String,Object> invocationRange=range(s);if(invocationRange.get("endColumn") instanceof Integer)invocationRange.put("endColumn",(Integer)invocationRange.get("endColumn")-1);call.put("lineRange",invocationRange);call.put("snippet",s.toString().stripTrailing().replaceFirst(";$",""));nodeById.get(node(call)).put("lineRange",invocationRange);
        try {var d=s.resolve();call.put("call",map("methodName","<init>","resolvedClassId",d.declaringType().getQualifiedName(),"resolvedMethodId",d.declaringType().getQualifiedName()+"#<init>("+java.util.stream.IntStream.range(0,d.getNumberOfParams()).mapToObj(i->d.getParam(i).getType().describe()).collect(Collectors.joining(", "))+")"));}catch(RuntimeException error){call.put("resolutionStatus","unresolved");}
        possibleExceptions(node(call),context);return sequence(result,single(call));
      }
      if(statement instanceof ContinueStmt || statement instanceof BreakStmt) {
        boolean continuing=statement instanceof ContinueStmt;
        Optional<com.github.javaparser.ast.expr.SimpleName> name=continuing?((ContinueStmt)statement).getLabel():((BreakStmt)statement).getLabel();
        Target target=context.targets.stream().filter(t->name.isPresent()?name.get().asString().equals(t.label):continuing?t.continueNode!=null:t.continueNode!=null||t.owner instanceof SwitchStmt).findFirst().orElse(null);
        Map<String,Object> s=step(continuing?"continue":"break",statement,context);
        if(target==null||(continuing&&target.continueNode==null)) {unsupported(statement,"Unresolved control-transfer target");route(node(s),exceptionalExit,null,context,"unresolved-control");}
        else {String destination=continuing?target.continueNode:target.breakNode;s.put("transition",map("kind",continuing?"continue":"break","targetNodeId",destination,"targetRange",range(target.owner),"label",target.label));route(node(s),destination,target.owner,context,continuing?"continue":"break");}
        return new Fragment(node(s),List.of());
      }
      if(statement instanceof ReturnStmt) {
        ReturnStmt s=(ReturnStmt)statement; Fragment result=s.getExpression().map(e->expression(e,context)).orElse(null);Map<String,Object> step=step("return",s,context);
        result=sequence(result,single(step));route(node(step),normalExit,null,context,"return");return new Fragment(result.entry,List.of());
      }
      if(statement instanceof ThrowStmt) {
        ThrowStmt s=(ThrowStmt)statement;Fragment value=expression(s.getExpression(),context);Map<String,Object> step=step("throw",s,context);
        Fragment result=sequence(value,single(step));Handler h=matchingHandler(s.getExpression(),context.handlers);
        if(h!=null)route(node(step),h.node,h.clause,context,"throw");else route(node(step),exceptionalExit,null,context,"throw");
        return new Fragment(result.entry,List.of());
      }
      if(statement instanceof LocalClassDeclarationStmt) return single(step("local-type",statement,context));
      if(statement instanceof EmptyStmt) return empty(statement);
      unsupported(statement,"Statement is not represented by this execution model");return single(step("unsupported",statement,context));
    }

    private boolean hasIncoming(String node) {return edges.stream().anyMatch(e->node.equals(e.get("to")));}

    private Fragment forLoop(ForStmt s,Context context,String label) {
      Fragment result=single(step("loop",s,context));for(Expression init:s.getInitialization())result=sequence(result,expression(init,context));
      String head=control("for:condition",s),update=control("for:update",s),after=control("for:after",s);connect(result.exits,head,"normal");
      Context loop=context.target(new Target(s,after,update,label));
      Condition comparison=s.getCompare().map(c->condition(c,context)).orElse(null);
      Context bodyContext=s.getCompare().map(c->loop.guard(guard(c,true),"for:body")).orElseGet(()->loop.branch("for:body"));
      Fragment body=statement(s.getBody(),bodyContext,null);
      if(comparison!=null){Expression test=s.getCompare().orElseThrow();edge(head,comparison.entry,"normal");conditionEdge(comparison.yes,body.entry,test,true);conditionEdge(comparison.no,after,test,false);}
      else edge(head,body.entry,"normal");
      connect(body.exits,update,"normal");Fragment updates=null;for(Expression expr:s.getUpdate())updates=sequence(updates,expression(expr,loop.branch("for:update")));
      if(updates==null)edge(update,head,"loop-back");else{edge(update,updates.entry,"normal");connect(updates.exits,head,"loop-back");}
      return new Fragment(result.entry,List.of(after));
    }

    private Fragment whileLoop(WhileStmt s,Context context,String label) {
      Fragment marker=single(step("loop",s,context));String head=control("while:condition",s),after=control("while:after",s);connect(marker.exits,head,"normal");
      Condition c=condition(s.getCondition(),context);edge(head,c.entry,"normal");Context loop=context.target(new Target(s,after,head,label));
      Fragment body=statement(s.getBody(),loop.guard(guard(s.getCondition(),true),"while:body"),null);
      conditionEdge(c.yes,body.entry,s.getCondition(),true);conditionEdge(c.no,after,s.getCondition(),false);connect(body.exits,head,"loop-back");return new Fragment(marker.entry,List.of(after));
    }

    private Fragment doLoop(DoStmt s,Context context,String label) {
      Fragment marker=single(step("loop",s,context));String head=control("do:condition",s),after=control("do:after",s);Context loop=context.target(new Target(s,after,head,label));
      Fragment body=statement(s.getBody(),loop.branch("do:body"),null);connect(marker.exits,body.entry,"normal");connect(body.exits,head,"normal");
      Condition c=condition(s.getCondition(),context.branch("do:condition"));edge(head,c.entry,"normal");conditionEdge(c.yes,body.entry,s.getCondition(),true);conditionEdge(c.no,after,s.getCondition(),false);return new Fragment(marker.entry,List.of(after));
    }

    private Fragment foreachLoop(ForEachStmt s,Context context,String label) {
      Fragment result=sequence(single(step("loop",s,context)),expression(s.getIterable(),context));String head=control("for-each:advance",s),after=control("for-each:after",s);connect(result.exits,head,"normal");
      Context loop=context.target(new Target(s,after,head,label)).branch("for-each:body");Fragment binding=declaration(s.getVariable().getVariable(0),loop,true);
      Fragment body=statement(s.getBody(),loop,null);edge(head,binding.entry,"iteration:next");edge(head,after,"iteration:end");connect(binding.exits,body.entry,"normal");connect(body.exits,head,"loop-back");return new Fragment(result.entry,List.of(after));
    }

    private Fragment switchStatement(SwitchStmt s,Context context,String label) {
      Fragment result=sequence(expression(s.getSelector(),context),single(step("branch",s,context)));String after=control("switch:after",s);Context branch=context.target(new Target(s,after,null,label));List<String> prior=List.of();boolean hasDefault=false;
      for(SwitchEntry item:s.getEntries()) {
        if(item.getType()!=SwitchEntry.Type.STATEMENT_GROUP)unsupported(item,"Only Java 8 switch statement groups are modeled");
        String caseNode=control("switch:case",item);edge(result.exits.get(0),caseNode,"switch:select",map("labels",item.getLabels().stream().map(Node::toString).toList(),"default",item.getLabels().isEmpty()));connect(prior,caseNode,"switch:fallthrough");
        Fragment contents=null;for(Statement child:item.getStatements()){if(contents!=null&&contents.exits.isEmpty())break;contents=sequence(contents,statement(child,branch.branch("switch:"+item.getLabels()),null));}
        if(contents==null)prior=List.of(caseNode);else{edge(caseNode,contents.entry,"normal");prior=contents.exits;}hasDefault|=item.getLabels().isEmpty();
      }
      connect(prior,after,"normal");if(!hasDefault)connect(result.exits,after,"switch:unmatched");return new Fragment(result.entry,List.of(after));
    }

    private Fragment tryStatement(TryStmt s,Context context) {
      String after=control("try:after",s);FinallyRegion region=s.getFinallyBlock().map(b->new FinallyRegion(s,b,methodId+":finally:"+position(s),control("finally:entry",b))).orElse(null);
      List<Handler> handlers=s.getCatchClauses().stream().map(c->new Handler(c,control("catch:entry",c))).toList();Context protectedContext=context.protect(handlers,region).branch("try:body");
      Fragment resources=single(step("branch",s,context));for(Expression resource:s.getResources())resources=sequence(resources,expression(resource,protectedContext));
      Fragment body=statement(s.getTryBlock(),protectedContext,null);connect(resources.exits,body.entry,"normal");normalThrough(body.exits,region,after);
      for(Handler handler:handlers){Context c=context.catchBody(region).branch("catch:"+handler.clause.getParameter().getTypeAsString());Map<String,Object> binding=step("binding",handler.clause.getParameter(),c);Symbol symbol=declarationSymbols.get(handler.clause.getParameter());if(symbol!=null){binding.put("symbolId",symbol.id);writes.put(node(binding),symbol.id);initialBindings.put(node(binding),true);}edge(handler.node,node(binding),"normal");Fragment caught=statement(handler.clause.getBody(),c,null);edge(node(binding),caught.entry,"normal");normalThrough(caught.exits,region,after);}
      if(region!=null){Fragment fin=statement(region.body,context.finallyBody(region),null);edge(region.entry,fin.entry,"normal");String dispatch=control("finally:dispatch",region.body);connect(fin.exits,dispatch,"normal");for(Pending pending:new ArrayList<>(region.pending)){Map<String,Object> extra=map("requiresCompletion",map("frameId",region.frameId,"token",pending.token),"completionActions",new ArrayList<>(List.of(map("action","clear","frameId",region.frameId))));routeThrough(dispatch,pending.target,pending.remaining,pending.kind,extra);}}
      return new Fragment(resources.entry,hasIncoming(after)?List.of(after):List.of());
    }

    private void normalThrough(List<String> tails,FinallyRegion region,String after){for(String tail:tails){if(region==null)edge(tail,after,"normal");else routeThrough(tail,after,List.of(region),"normal",new LinkedHashMap<>());}}

    private void route(String from,String target,Node targetOwner,Context context,String kind) {
      List<FinallyRegion> through=context.finalizers.stream().filter(f->targetOwner==null||!contains(f.owner,targetOwner)).toList();
      List<Map<String,Object>> clear=context.activeFinalizers.stream().filter(f->targetOwner==null||!contains(f.body,targetOwner)).map(f->map("action","clear","frameId",f.frameId)).toList();
      routeThrough(from,target,through,kind,map("completionActions",new ArrayList<>(clear)));
    }

    @SuppressWarnings("unchecked")
    private void routeThrough(String from,String target,List<FinallyRegion> through,String kind,Map<String,Object> extra) {
      if(through.isEmpty()){edge(from,target,kind,extra);return;}
      FinallyRegion first=through.get(0);String token=methodId+":completion:"+completionSequence++;
      List<Map<String,Object>> actions=new ArrayList<>((List<Map<String,Object>>)extra.getOrDefault("completionActions",List.of()));actions.add(map("action","set","frameId",first.frameId,"token",token));
      extra.put("completionActions",actions);extra.put("pendingKind",kind);extra.put("resumeTarget",target);edge(from,first.entry,"finally:enter",extra);
      first.pending.add(new Pending(token,target,List.copyOf(through.subList(1,through.size())),kind));
    }

    private Handler matchingHandler(Expression thrown,List<Handler> handlers) {
      Set<String> typeNames=new LinkedHashSet<>();
      try {ResolvedType type=thrown.calculateResolvedType();if(type.isReferenceType()){typeNames.add(type.asReferenceType().getQualifiedName());type.asReferenceType().getAllAncestors().forEach(a->typeNames.add(a.getQualifiedName()));}}catch(RuntimeException ignored){}
      for(Handler h:handlers){List<String> names=h.clause.getParameter().getType() instanceof UnionType?((UnionType)h.clause.getParameter().getType()).getElements().stream().map(Node::toString).toList():List.of(h.clause.getParameter().getTypeAsString());
        for(String n:names){if(n.equals("Throwable")||n.equals("java.lang.Throwable")||typeNames.stream().anyMatch(t->t.equals(n)||t.endsWith("."+n)))return h;}}
      return null;
    }

    private void possibleExceptions(String from,Context context) {
      callNodes.add(from);
      for(Handler h:context.handlers)route(from,h.node,h.clause,context,"exception:possible");
      route(from,exceptionalExit,null,context,"exception:possible");
    }

    private Condition condition(Expression expression,Context context) {
      expression=unwrap(expression);
      if(expression instanceof UnaryExpr&&((UnaryExpr)expression).getOperator()==UnaryExpr.Operator.LOGICAL_COMPLEMENT){Condition c=condition(((UnaryExpr)expression).getExpression(),context);return new Condition(c.entry,c.no,c.yes);}
      if(expression instanceof BinaryExpr){BinaryExpr b=(BinaryExpr)expression;
        if(b.getOperator()==BinaryExpr.Operator.AND||b.getOperator()==BinaryExpr.Operator.OR){boolean and=b.getOperator()==BinaryExpr.Operator.AND;Condition left=condition(b.getLeft(),context);Condition right=condition(b.getRight(),context.guard(guard(b.getLeft(),and),and?"short-circuit:and:true":"short-circuit:or:false"));conditionEdge(and?left.yes:left.no,right.entry,b.getLeft(),and);List<String> yes=new ArrayList<>(right.yes),no=new ArrayList<>(right.no);if(and)no.addAll(left.no);else yes.addAll(left.yes);return new Condition(left.entry,yes,no);}}
      Fragment value=expression(expression,context);Map<String,Object> test=step("condition",expression,context);String id=(String)guard(expression,true).get("conditionId");test.put("conditionId",id);connect(value.exits,node(test),"normal");
      String yes=control("condition:true",expression),no=control("condition:false",expression);
      boolean literal=expression.isBooleanLiteralExpr();
      if(!literal||expression.asBooleanLiteralExpr().getValue())edge(node(test),yes,"condition:true",map("conditionId",id,"when",true));
      if(!literal||!expression.asBooleanLiteralExpr().getValue())edge(node(test),no,"condition:false",map("conditionId",id,"when",false));
      return new Condition(value.entry,literal&&!expression.asBooleanLiteralExpr().getValue()?List.of():List.of(yes),literal&&expression.asBooleanLiteralExpr().getValue()?List.of():List.of(no));
    }

    private Fragment declaration(VariableDeclarator variable,Context context,boolean binding) {
      Symbol symbol=declarationSymbols.get(variable);Map<String,Object> declared=step("declaration",variable,context);
      Node source=declarationSource(variable);declared.put("lineRange",range(source));declared.put("snippet",source.toString());nodeById.get(node(declared)).put("lineRange",range(source));
      declared.put("declaration",map("symbolId",symbol==null?null:symbol.id,"name",variable.getNameAsString(),"declaredType",variable.getTypeAsString(),"hasInitializer",variable.getInitializer().isPresent(),"initializationKind",binding?"iteration":"local","nameRange",range(variable.getName()),"variableRange",range(variable),"initializerRange",variable.getInitializer().map(JavaExecutionModelExtractor::range).orElse(null)));
      if(symbol!=null){writes.put(node(declared),symbol.id);initialBindings.put(node(declared),binding);}
      Fragment result=single(declared);
      if(variable.getInitializer().isPresent()){
        Expression initializer=variable.getInitializer().get();result=sequence(result,expression(initializer,context));Map<String,Object> assigned=step("assignment",variable,context);
        assigned.put("assignmentKind","initialization");assigned.put("symbolId",symbol==null?null:symbol.id);assigned.put("valueRange",range(initializer));
        if(symbol!=null){writes.put(node(assigned),symbol.id);assignedValues.put(node(assigned),initializer);}result=sequence(result,single(assigned));
      }
      return result;
    }

    private Fragment expression(Expression expr,Context context) {
      Expression e=unwrap(expr);
      if(e instanceof VariableDeclarationExpr){Fragment result=null;for(VariableDeclarator v:((VariableDeclarationExpr)e).getVariables())result=sequence(result,declaration(v,context,false));return result==null?empty(e):result;}
      if(e instanceof BinaryExpr){BinaryExpr b=(BinaryExpr)e;if(b.getOperator()==BinaryExpr.Operator.AND||b.getOperator()==BinaryExpr.Operator.OR){Condition c=condition(b,context);String merge=control("boolean:value",e);conditionEdge(c.yes,merge,e,true);conditionEdge(c.no,merge,e,false);return new Fragment(c.entry,List.of(merge));}return sequence(expression(b.getLeft(),context),expression(b.getRight(),context));}
      if(e instanceof ConditionalExpr){ConditionalExpr c=(ConditionalExpr)e;Fragment marker=single(step("branch",e,context));Condition test=condition(c.getCondition(),context);connect(marker.exits,test.entry,"normal");Fragment yes=expression(c.getThenExpr(),context.guard(guard(c.getCondition(),true),"ternary:true")),no=expression(c.getElseExpr(),context.guard(guard(c.getCondition(),false),"ternary:false"));String merge=control("ternary:value",e);conditionEdge(test.yes,yes.entry,c.getCondition(),true);conditionEdge(test.no,no.entry,c.getCondition(),false);connect(yes.exits,merge,"normal");connect(no.exits,merge,"normal");return new Fragment(marker.entry,List.of(merge));}
      if(e instanceof AssignExpr){AssignExpr a=(AssignExpr)e;Fragment target=targetEvaluation(a.getTarget(),context);Fragment value=expression(a.getValue(),context);Map<String,Object> assigned=step("assignment",e,context);Symbol symbol=symbol(a.getTarget());assigned.put("assignmentKind",a.getOperator()==AssignExpr.Operator.ASSIGN?"write":"read-modify-write");assigned.put("operator",a.getOperator().asString());assigned.put("target",targetInfo(a.getTarget(),symbol));if(symbol!=null){writes.put(node(assigned),symbol.id);assignedValues.put(node(assigned),a.getValue());if(a.getOperator()!=AssignExpr.Operator.ASSIGN)mutationNodes.add(node(assigned));}return sequence(sequence(target,value),single(assigned));}
      if(e instanceof UnaryExpr){UnaryExpr u=(UnaryExpr)e;boolean mut=List.of(UnaryExpr.Operator.POSTFIX_INCREMENT,UnaryExpr.Operator.POSTFIX_DECREMENT,UnaryExpr.Operator.PREFIX_INCREMENT,UnaryExpr.Operator.PREFIX_DECREMENT).contains(u.getOperator());if(mut){Fragment target=targetEvaluation(u.getExpression(),context);Map<String,Object> changed=step("mutation",e,context);Symbol symbol=symbol(u.getExpression());boolean postfix=u.getOperator()==UnaryExpr.Operator.POSTFIX_INCREMENT||u.getOperator()==UnaryExpr.Operator.POSTFIX_DECREMENT;changed.put("effects",List.of(map("operation",u.getOperator().asString(),"operator",u.getOperator().name(),"target",targetInfo(u.getExpression(),symbol),"reads",true,"writes",true,"resultMode",postfix?"previous-value":"updated-value","evaluationCount",1)));if(symbol!=null){writes.put(node(changed),symbol.id);mutationNodes.add(node(changed));}return sequence(target,single(changed));}return expression(u.getExpression(),context);}
      if(e instanceof MethodCallExpr){MethodCallExpr c=(MethodCallExpr)e;Fragment result=c.getScope().map(s->expression(s,context)).orElse(null);for(Expression arg:c.getArguments())result=sequence(result,expression(arg,context));Map<String,Object> call=step("call",e,context);call.put("call",callInfo(c));possibleExceptions(node(call),context);return sequence(result,single(call));}
      if(e instanceof ObjectCreationExpr){ObjectCreationExpr c=(ObjectCreationExpr)e;Fragment result=c.getScope().map(s->expression(s,context)).orElse(null);for(Expression arg:c.getArguments())result=sequence(result,expression(arg,context));Map<String,Object> created=step("instantiate",e,context);possibleExceptions(node(created),context);return sequence(result,single(created));}
      if(e instanceof ArrayCreationExpr){ArrayCreationExpr a=(ArrayCreationExpr)e;Fragment result=null;for(var level:a.getLevels())if(level.getDimension().isPresent())result=sequence(result,expression(level.getDimension().get(),context));if(a.getInitializer().isPresent())result=sequence(result,expression(a.getInitializer().get(),context));return sequence(result,single(step("instantiate-array",e,context)));}
      if(e instanceof ArrayInitializerExpr){Fragment result=null;for(Expression value:((ArrayInitializerExpr)e).getValues())result=sequence(result,expression(value,context));return result==null?empty(e):result;}
      if(e instanceof ArrayAccessExpr){ArrayAccessExpr a=(ArrayAccessExpr)e;return sequence(sequence(expression(a.getName(),context),expression(a.getIndex(),context)),single(step("array-read",e,context)));}
      if(e instanceof FieldAccessExpr){FieldAccessExpr a=(FieldAccessExpr)e;Fragment scope=expression(a.getScope(),context);Map<String,Object> read=step("field-read",e,context);Symbol symbol=symbol(e);if(symbol!=null)read.put("symbolId",symbol.id);return sequence(scope,single(read));}
      if(e instanceof NameExpr){Map<String,Object> read=step("read",e,context);Symbol symbol=symbol(e);if(symbol!=null)read.put("symbolId",symbol.id);return single(read);}
      if(e instanceof CastExpr)return expression(((CastExpr)e).getExpression(),context);
      if(e instanceof InstanceOfExpr)return expression(((InstanceOfExpr)e).getExpression(),context);
      if(e instanceof LambdaExpr)return single(step("lambda",e,context));
      if(e instanceof MethodReferenceExpr)return sequence(expression(((MethodReferenceExpr)e).getScope(),context),single(step("method-reference",e,context)));
      if(e instanceof LiteralExpr||e instanceof ThisExpr||e instanceof SuperExpr||e instanceof ClassExpr||e instanceof TypeExpr)return single(step("value",e,context));
      unsupported(e,"Expression is not represented by this execution model");return single(step("unsupported",e,context));
    }

    private Fragment targetEvaluation(Expression target,Context context){target=unwrap(target);if(target instanceof FieldAccessExpr)return expression(((FieldAccessExpr)target).getScope(),context);if(target instanceof ArrayAccessExpr){ArrayAccessExpr a=(ArrayAccessExpr)target;return sequence(expression(a.getName(),context),expression(a.getIndex(),context));}if(target instanceof NameExpr)return null;return expression(target,context);}

    private Map<String,Object> targetInfo(Expression target,Symbol symbol){target=unwrap(target);Map<String,Object> info=map("symbolId",symbol==null?null:symbol.id,"expression",target.toString(),"lineRange",range(target),"resolutionStatus",symbol==null?(target instanceof ArrayAccessExpr?"array-element":"unresolved"):"resolved");if(symbol==null)info.put("reason",target instanceof ArrayAccessExpr?"Indexed storage is preserved; heap element aliases are not inferred":"No declaration could be resolved for this target");if(target instanceof FieldAccessExpr){Expression receiver=((FieldAccessExpr)target).getScope();info.put("receiver",receiver.toString());info.put("receiverEvaluation",evaluationReference(receiver));}if(target instanceof ArrayAccessExpr){ArrayAccessExpr a=(ArrayAccessExpr)target;info.put("receiver",a.getName().toString());info.put("index",a.getIndex().toString());info.put("receiverEvaluation",evaluationReference(a.getName()));info.put("indexEvaluation",evaluationReference(a.getIndex()));}return info;}

    private Map<String,Object> evaluationReference(Expression source){List<String> ids=new ArrayList<>();for(Map.Entry<Node,Map<String,Map<String,Object>>> entry:canonical.entrySet())if(contains(source,entry.getKey()))for(Map<String,Object> step:entry.getValue().values())ids.add((String)step.get("flowNodeId"));return map("expression",source.toString(),"lineRange",range(source),"flowNodeIds",ids,"evaluationCount",1);}

    private Map<String,Object> callInfo(MethodCallExpr call){Map<String,Object> result=map("methodName",call.getNameAsString(),"targetText",call.getScope().map(s->s+".").orElse("")+call.getNameAsString());try{ResolvedMethodDeclaration d=call.resolve();result.put("resolvedClassId",d.declaringType().getQualifiedName());result.put("resolvedMethodId",d.declaringType().getQualifiedName()+"#"+d.getName()+"("+java.util.stream.IntStream.range(0,d.getNumberOfParams()).mapToObj(i->d.getParam(i).getType().describe()).collect(Collectors.joining(", "))+")");result.put("resolutionStatus","resolved");}catch(RuntimeException error){result.put("resolutionStatus","unresolved");}return result;}
    private void unsupported(Node node,String reason){unsupported.add(map("kind",node.getClass().getSimpleName(),"lineRange",range(node),"reason",reason));}

    private Map<String,String> tokens(Map<String,Object> edge,Map<String,String> incoming){
      @SuppressWarnings("unchecked")Map<String,Object> required=(Map<String,Object>)edge.get("requiresCompletion");
      if(required!=null&&!Objects.equals(incoming.get(required.get("frameId")),required.get("token")))return null;
      Map<String,String> result=new TreeMap<>(incoming);
      @SuppressWarnings("unchecked")List<Map<String,Object>> actions=(List<Map<String,Object>>)edge.getOrDefault("completionActions",List.of());
      for(Map<String,Object> action:actions){String frame=(String)action.get("frameId");if("clear".equals(action.get("action")))result.remove(frame);else result.put(frame,(String)action.get("token"));}
      return result;
    }

    private Map<String,Object> analyzeStates(){
      Map<String,List<Map<String,Object>>> outgoing=new HashMap<>();for(Map<String,Object> e:edges)outgoing.computeIfAbsent((String)e.get("from"),k->new ArrayList<>()).add(e);
      Map<String,Map<String,ValueState>> inputs=new LinkedHashMap<>(),outputs=new LinkedHashMap<>();Map<String,Map<String,String>> completionStates=new HashMap<>();Map<String,String> stateNode=new HashMap<>();
      Map<String,ValueState> initial=new LinkedHashMap<>();for(Symbol s:symbols.values())if(s.kind.equals("parameter"))initial.put(s.id,new ValueState("initialized",s.primitive?"not-applicable":"unknown"));
      String start=entry+"|{}";inputs.put(start,initial);completionStates.put(start,Map.of());stateNode.put(start,entry);Deque<String> queue=new ArrayDeque<>();queue.add(start);Set<String> queued=new HashSet<>(queue);int iterations=0,budget=Math.max(2000,nodes.size()*Math.max(16,symbols.size()+2)*16);
      while(!queue.isEmpty()&&iterations++<budget){String key=queue.removeFirst();queued.remove(key);String node=stateNode.get(key);Map<String,ValueState> before=inputs.get(key),after=transfer(node,before);outputs.put(key,after);
        for(Map<String,Object> e:outgoing.getOrDefault(node,List.of())){Map<String,String> nextTokens=tokens(e,completionStates.get(key));if(nextTokens==null)continue;Map<String,ValueState> next=refine(after,e);if(next==null)continue;String target=(String)e.get("to"),nextKey=target+"|"+nextTokens;Map<String,ValueState> previous=inputs.get(nextKey),joined=previous==null?new LinkedHashMap<>(next):join(previous,next);if(previous==null||!previous.equals(joined)){inputs.put(nextKey,joined);completionStates.put(nextKey,nextTokens);stateNode.put(nextKey,target);if(queued.add(nextKey))queue.addLast(nextKey);}}
      }
      boolean complete=queue.isEmpty();Map<String,Map<String,ValueState>> inByNode=new LinkedHashMap<>(),outByNode=new LinkedHashMap<>();
      for(String key:inputs.keySet()){String node=stateNode.get(key);inByNode.merge(node,inputs.get(key),this::join);if(outputs.containsKey(key))outByNode.merge(node,outputs.get(key),this::join);}
      List<Map<String,Object>> snapshots=new ArrayList<>();for(Map<String,Object> n:nodes){String id=(String)n.get("id");snapshots.add(map("nodeId",id,"reachable",inByNode.containsKey(id),"before",statesJson(inByNode.getOrDefault(id,Map.of())),"after",statesJson(outByNode.getOrDefault(id,Map.of()))));}
      return map("complete",complete,"states",snapshots,"analysis",map("status",complete?"complete":"partial","iterations",iterations,"budget",budget,"completionSensitive",true,"concreteValueCalculation",false));
    }

    private Map<String,Object> statesJson(Map<String,ValueState> states){Map<String,Object> result=new LinkedHashMap<>();states.forEach((k,v)->result.put(k,v.json()));return result;}

    private Map<String,ValueState> transfer(String node,Map<String,ValueState> input){Map<String,ValueState> out=new LinkedHashMap<>(input);Map<String,Object> step=stepByNode.get(node);String id=writes.get(node);if(id!=null){Symbol s=symbols.get(id);String kind=step==null?"":(String)step.get("kind");if(kind.equals("declaration")){boolean binding=initialBindings.getOrDefault(node,false);out.put(id,new ValueState(binding?"initialized":"uninitialized",s.primitive?"not-applicable":"unknown"));}else if(kind.equals("binding"))out.put(id,new ValueState("initialized",s.primitive?"not-applicable":"non-null"));else if(mutationNodes.contains(node))out.put(id,new ValueState("initialized",s.primitive?"not-applicable":"non-null"));else out.put(id,new ValueState("initialized",s.primitive?"not-applicable":nullability(assignedValues.get(node),input)));}
      if(callNodes.contains(node))for(Symbol s:symbols.values())if(s.kind.equals("field")&&out.containsKey(s.id))out.put(s.id,new ValueState(out.get(s.id).initialization,s.primitive?"not-applicable":"unknown"));return out;}

    private String nullability(Expression value,Map<String,ValueState> state){if(value==null)return "unknown";value=unwrap(value);if(value instanceof NullLiteralExpr)return "null";if(value instanceof ObjectCreationExpr||value instanceof ArrayCreationExpr||value instanceof StringLiteralExpr||value instanceof ThisExpr||value instanceof ClassExpr||value instanceof LambdaExpr||value instanceof MethodReferenceExpr)return "non-null";if(value instanceof CastExpr)return nullability(((CastExpr)value).getExpression(),state);if(value instanceof ConditionalExpr){ConditionalExpr c=(ConditionalExpr)value;return mergeNull(nullability(c.getThenExpr(),state),nullability(c.getElseExpr(),state));}Symbol s=symbol(value);if(s!=null)return state.getOrDefault(s.id,new ValueState("unknown",s.primitive?"not-applicable":"unknown")).nullability;return "unknown";}

    private Map<String,ValueState> refine(Map<String,ValueState> input,Map<String,Object> edge){String conditionId=(String)edge.get("conditionId");if(Boolean.FALSE.equals(edge.get("refine"))||conditionId==null||!(edge.get("when") instanceof Boolean))return new LinkedHashMap<>(input);Expression e=predicates.get(conditionId);if(e==null)return new LinkedHashMap<>(input);return refineExpression(input,e,(Boolean)edge.get("when"));}
    private Map<String,ValueState> refineExpression(Map<String,ValueState> input,Expression expr,boolean when){Expression e=unwrap(expr);if(e instanceof UnaryExpr&&((UnaryExpr)e).getOperator()==UnaryExpr.Operator.LOGICAL_COMPLEMENT)return refineExpression(input,((UnaryExpr)e).getExpression(),!when);if(e instanceof BooleanLiteralExpr)return ((BooleanLiteralExpr)e).getValue()==when?new LinkedHashMap<>(input):null;
      if(e instanceof BinaryExpr){BinaryExpr b=(BinaryExpr)e;if(b.getOperator()==BinaryExpr.Operator.AND&&when){Map<String,ValueState> left=refineExpression(input,b.getLeft(),true);return left==null?null:refineExpression(left,b.getRight(),true);}if(b.getOperator()==BinaryExpr.Operator.OR&&!when){Map<String,ValueState> left=refineExpression(input,b.getLeft(),false);return left==null?null:refineExpression(left,b.getRight(),false);}if(b.getOperator()==BinaryExpr.Operator.EQUALS||b.getOperator()==BinaryExpr.Operator.NOT_EQUALS){Expression target=b.getLeft().isNullLiteralExpr()?b.getRight():b.getRight().isNullLiteralExpr()?b.getLeft():null;if(target!=null)return refinedNull(input,target,when==(b.getOperator()==BinaryExpr.Operator.EQUALS)?"null":"non-null");}}
      if(e instanceof InstanceOfExpr&&when)return refinedNull(input,((InstanceOfExpr)e).getExpression(),"non-null");return new LinkedHashMap<>(input);}
    private Map<String,ValueState> refinedNull(Map<String,ValueState> input,Expression expression,String value){Symbol s=symbol(expression);Map<String,ValueState> result=new LinkedHashMap<>(input);if(s==null||s.primitive)return result;ValueState old=input.getOrDefault(s.id,new ValueState("unknown","unknown"));if((old.nullability.equals("null")||old.nullability.equals("non-null"))&&!old.nullability.equals(value))return null;result.put(s.id,new ValueState(old.initialization,value));return result;}
    private Map<String,ValueState> join(Map<String,ValueState> first,Map<String,ValueState> second){Map<String,ValueState> result=new LinkedHashMap<>();Set<String> ids=new LinkedHashSet<>(first.keySet());ids.addAll(second.keySet());for(String id:ids){Symbol s=symbols.get(id);ValueState a=first.getOrDefault(id,new ValueState("unknown",s!=null&&s.primitive?"not-applicable":"unknown")),b=second.getOrDefault(id,new ValueState("unknown",s!=null&&s.primitive?"not-applicable":"unknown"));String init=a.initialization.equals(b.initialization)?a.initialization:a.initialization.equals("unknown")||b.initialization.equals("unknown")?"unknown":"maybe-uninitialized";result.put(id,new ValueState(init,mergeNull(a.nullability,b.nullability)));}return result;}
    private String mergeNull(String a,String b){if(a.equals(b))return a;if(a.equals("unknown")||b.equals("unknown"))return "unknown";if(a.equals("not-applicable")||b.equals("not-applicable"))return "unknown";return "maybe-null";}
  }
}
