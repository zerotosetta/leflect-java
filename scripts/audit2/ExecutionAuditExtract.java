import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.*;
import javax.tools.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.io.*;

public class ExecutionAuditExtract {
  public static void main(String[] args) throws Exception {
    Path source = Path.of(args[0]);
    var compiler = ToolProvider.getSystemJavaCompiler();
    var diagnostics = new DiagnosticCollector<JavaFileObject>();
    var sources = Files.walk(source.resolve("src/main/java")).filter(p -> p.toString().endsWith(".java")).sorted().toList();
    try (var manager = compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8);
         var writer = Files.newBufferedWriter(Path.of(args[2]), StandardCharsets.UTF_8)) {
      JavacTask task = (JavacTask) compiler.getTask(null, manager, diagnostics,
          List.of("--release", "8", "-proc:none", "-classpath", args[1]), null, manager.getJavaFileObjectsFromPaths(sources));
      List<CompilationUnitTree> units = new ArrayList<>();
      for (var unit : task.parse()) units.add(unit);
      Trees trees = Trees.instance(task);
      var positions = trees.getSourcePositions();
      Set<MethodTree> explicitMethods = Collections.newSetFromMap(new IdentityHashMap<>());
      for (var unit : units) new TreeScanner<Void, Void>() {
        @Override public Void visitMethod(MethodTree node, Void unused) { explicitMethods.add(node); return super.visitMethod(node, unused); }
      }.scan(unit, null);
      task.analyze();
      for (var unit : units) {
        String file = source.relativize(Path.of(unit.getSourceFile().toUri())).toString().replace('\\', '/');
        String code = Files.readString(Path.of(unit.getSourceFile().toUri()));
        new TreePathScanner<Void, Void>() {
          MethodTree method;
          String methodName = "", owner = "";
          long methodStart = -1;
          String encode(String value) { return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8)); }
          String owner(Element element) { return element != null && element.getEnclosingElement() instanceof TypeElement t ? t.getQualifiedName().toString() : ""; }
          void emit(String kind, Tree node, String extra) {
            long start = positions.getStartPosition(unit, node), end = positions.getEndPosition(unit, node);
            if (start < 0 || end <= start) return;
            List<String> guards = new ArrayList<>();
            Tree child = node;
            for (TreePath current = getCurrentPath().getParentPath(); current != null; current = current.getParentPath()) {
              Tree parent = current.getLeaf();
              if (parent instanceof MethodTree) break;
              if (parent instanceof BinaryTree binary && (binary.getKind() == Tree.Kind.CONDITIONAL_AND || binary.getKind() == Tree.Kind.CONDITIONAL_OR) && binary.getRightOperand() == child)
                guards.add(binary.getKind()+"@"+positions.getStartPosition(unit, binary)+":"+binary.getLeftOperand());
              child = parent;
            }
            var lines = unit.getLineMap();
            try { writer.write(String.join("\t", kind, file, owner, methodName, Long.toString(methodStart),
                Long.toString(start), Long.toString(end), Long.toString(lines.getLineNumber(start)), Long.toString(lines.getColumnNumber(start)),
                Long.toString(lines.getLineNumber(end-1)), Long.toString(lines.getColumnNumber(end-1)),
                encode(code.substring((int)start, (int)end)), encode(extra), encode(String.join(" | ", guards)))+"\n"); }
            catch (IOException error) { throw new RuntimeException(error); }
          }
          @Override public Void visitMethod(MethodTree node, Void unused) {
            if (!explicitMethods.contains(node)) return null;
            var oldMethod = method; String oldName = methodName, oldOwner = owner; long oldStart = methodStart;
            method = node; methodName = node.getName().toString(); owner = owner(trees.getElement(getCurrentPath())); methodStart = positions.getStartPosition(unit, node);
            emit("method", node, node.getBody() == null ? "no-body" : "body");
            super.visitMethod(node, unused);
            method = oldMethod; methodName = oldName; owner = oldOwner; methodStart = oldStart; return null;
          }
          @Override public Void visitMethodInvocation(MethodInvocationTree node, Void unused) {
            String name = node.getMethodSelect() instanceof IdentifierTree id ? id.getName().toString() : "";
            Element symbol = trees.getElement(getCurrentPath());
            super.visitMethodInvocation(node, unused);
            emit(name.equals("super") || name.equals("this") ? "constructor-call" : "call", node, owner(symbol)+"#"+(symbol == null ? "" : symbol.toString()));
            return null;
          }
          @Override public Void visitNewClass(NewClassTree node, Void unused) { emit("instantiate", node, ""); return super.visitNewClass(node, unused); }
          @Override public Void visitAssignment(AssignmentTree node, Void unused) {
            Element target = trees.getElement(new TreePath(getCurrentPath(), node.getVariable()));
            emit("assignment", node, (target == null ? "" : target.getKind()+":"+owner(target)+"#"+target.getSimpleName()));
            return super.visitAssignment(node, unused);
          }
          @Override public Void visitCompoundAssignment(CompoundAssignmentTree node, Void unused) { emit("compound-assignment", node, node.getKind().toString()); return super.visitCompoundAssignment(node, unused); }
          @Override public Void visitUnary(UnaryTree node, Void unused) {
            if (Set.of(Tree.Kind.PREFIX_INCREMENT,Tree.Kind.POSTFIX_INCREMENT,Tree.Kind.PREFIX_DECREMENT,Tree.Kind.POSTFIX_DECREMENT).contains(node.getKind())) emit("mutation", node, node.getKind().toString());
            return super.visitUnary(node, unused);
          }
          @Override public Void visitVariable(VariableTree node, Void unused) {
            Element symbol = trees.getElement(getCurrentPath());
            if (method != null && symbol != null && (symbol.getKind() == ElementKind.LOCAL_VARIABLE || symbol.getKind() == ElementKind.RESOURCE_VARIABLE))
              emit(node.getInitializer()==null ? (getCurrentPath().getParentPath().getLeaf() instanceof EnhancedForLoopTree ? "foreach-variable" : "uninitialized-local") : "local-variable", node, node.getName().toString());
            return super.visitVariable(node, unused);
          }
          @Override public Void visitReturn(ReturnTree node, Void unused) { emit("return", node, ""); return super.visitReturn(node, unused); }
          @Override public Void visitThrow(ThrowTree node, Void unused) { emit("throw", node, ""); return super.visitThrow(node, unused); }
          @Override public Void visitIf(IfTree node, Void unused) { emit("if", node, ""); return super.visitIf(node, unused); }
          @Override public Void visitConditionalExpression(ConditionalExpressionTree node, Void unused) { emit("ternary", node, ""); return super.visitConditionalExpression(node, unused); }
          @Override public Void visitTry(TryTree node, Void unused) { emit("try", node, "resources:"+node.getResources().size()+";catches:"+node.getCatches().size()+";finally:"+(node.getFinallyBlock()!=null)); return super.visitTry(node, unused); }
          @Override public Void visitForLoop(ForLoopTree node, Void unused) { emit("for", node, ""); return super.visitForLoop(node, unused); }
          @Override public Void visitEnhancedForLoop(EnhancedForLoopTree node, Void unused) { emit("for-each", node, ""); return super.visitEnhancedForLoop(node, unused); }
          @Override public Void visitWhileLoop(WhileLoopTree node, Void unused) { emit("while", node, ""); return super.visitWhileLoop(node, unused); }
          @Override public Void visitDoWhileLoop(DoWhileLoopTree node, Void unused) { emit("do", node, ""); return super.visitDoWhileLoop(node, unused); }
          @Override public Void visitSwitch(SwitchTree node, Void unused) { emit("switch", node, ""); return super.visitSwitch(node, unused); }
          @Override public Void visitSynchronized(SynchronizedTree node, Void unused) { emit("synchronized", node, ""); return super.visitSynchronized(node, unused); }
          @Override public Void visitLambdaExpression(LambdaExpressionTree node, Void unused) { emit("lambda", node, ""); return super.visitLambdaExpression(node, unused); }
          @Override public Void visitMemberReference(MemberReferenceTree node, Void unused) { emit("method-reference", node, ""); return super.visitMemberReference(node, unused); }
          @Override public Void visitBreak(BreakTree node, Void unused) { emit("break", node, ""); return super.visitBreak(node, unused); }
          @Override public Void visitContinue(ContinueTree node, Void unused) { emit("continue", node, ""); return super.visitContinue(node, unused); }
        }.scan(unit, null);
      }
      long errors = diagnostics.getDiagnostics().stream().filter(d -> d.getKind()==Diagnostic.Kind.ERROR).count();
      System.out.println("Source files="+sources.size()+", compiler errors="+errors);
      for (var diagnostic : diagnostics.getDiagnostics()) if (diagnostic.getKind()==Diagnostic.Kind.ERROR) System.err.println(diagnostic);
      if (errors != 0) System.exit(1);
    }
  }
}
