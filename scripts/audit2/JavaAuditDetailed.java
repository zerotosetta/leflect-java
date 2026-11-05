
import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.*;
import javax.lang.model.type.*;
import javax.tools.*;
import java.nio.file.*;
import java.io.*;
import java.util.*;

class JavaAuditDetailed {
  public static void main(String[] args) throws Exception {
    Path root = Paths.get(args[0]);
    String classpath = args[1];
    var compiler = ToolProvider.getSystemJavaCompiler();
    var diagnostics = new DiagnosticCollector<JavaFileObject>();
    var allSources = Files.walk(root.resolve("src/main/java"))
        .filter(p -> p.toString().endsWith(".java")).sorted().toList();
    try (var fileManager = compiler.getStandardFileManager(diagnostics, null, java.nio.charset.StandardCharsets.UTF_8);
         var out = new PrintWriter(Files.newBufferedWriter(Paths.get(args[2])))) {
      JavacTask task = (JavacTask) compiler.getTask(null, fileManager, diagnostics,
          List.of("--release","8","-proc:none","-classpath",classpath), null,
          fileManager.getJavaFileObjectsFromPaths(allSources));
      List<CompilationUnitTree> units = new ArrayList<>();
      for (var unit : task.parse()) units.add(unit);
      task.analyze();
      Trees trees = Trees.instance(task);
      var positions = trees.getSourcePositions();
      var types = task.getTypes();
      for (var unit : units) {
        String file = root.relativize(Paths.get(unit.getSourceFile().toUri())).toString().replace('\\','/');
        new TreePathScanner<Void, Void>() {
          void row(String kind, Tree node, String target, String signature, String erased, String args) {
            long start = positions.getStartPosition(unit,node);
            long end = positions.getEndPosition(unit,node);
            if (start < 0 || end < start) return;
            var map = unit.getLineMap();
            out.printf("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s%n",kind,file,
                map.getLineNumber(start),map.getColumnNumber(start),
                map.getLineNumber(end-1),map.getColumnNumber(end-1),target,signature,erased,args);
          }
          String owner(Element element) {
            return element != null && element.getEnclosingElement() instanceof TypeElement e
                ? e.getQualifiedName().toString() : "";
          }
          String executableSignature(Element symbol, boolean erase) {
            if (!(symbol instanceof ExecutableElement e)) return "";
            List<String> params = new ArrayList<>();
            for (VariableElement p : e.getParameters()) {
              TypeMirror type = p.asType();
              params.add((erase ? types.erasure(type) : type).toString());
            }
            return e.getSimpleName()+"("+String.join(",",params)+")";
          }
          void emitCall(String kind, Tree node, String syntacticName) {
            Element symbol = trees.getElement(getCurrentPath());
            row(kind,node,owner(symbol),executableSignature(symbol,false),executableSignature(symbol,true),syntacticName);
          }
          @Override public Void visitMethodInvocation(MethodInvocationTree node, Void ignore) {
            var select = node.getMethodSelect();
            String syntacticName = select instanceof MemberSelectTree m ? m.getIdentifier().toString()
                : select instanceof IdentifierTree i ? i.getName().toString() : select.toString();
            emitCall("call",node,syntacticName);
            TypeMirror resultType=trees.getTypeMirror(getCurrentPath());
            Element callElement=trees.getElement(getCurrentPath());
            row("callDeclaredType",node,callElement instanceof ExecutableElement e?e.getReturnType().toString():"",executableSignature(callElement,false),executableSignature(callElement,true),syntacticName);
            row("callType",node,resultType==null?"":resultType.toString(),executableSignature(callElement,false),executableSignature(callElement,true),syntacticName);
            int argIndex=0;
            for(ExpressionTree argument:node.getArguments()) {
              TypeMirror argumentType=trees.getTypeMirror(new TreePath(getCurrentPath(),argument));
              row("argument",argument,argumentType==null?"":argumentType.toString(),owner(callElement),executableSignature(callElement,true),Integer.toString(argIndex++));
            }
            TreePath ownerPath=getCurrentPath();
            MethodTree caller=null;
            ClassTree callerType=null;
            BlockTree initializer=null;
            for (TreePath current=ownerPath.getParentPath(); current!=null; current=current.getParentPath()) {
              if (current.getLeaf() instanceof MethodTree m && caller==null) caller=m;
              if (current.getLeaf() instanceof BlockTree b && current.getParentPath().getLeaf() instanceof ClassTree) initializer=b;
              if (current.getLeaf() instanceof ClassTree c) { callerType=c; ownerPath=current; break; }
            }
            Element typeElement=trees.getElement(ownerPath);
            String callerOwner=typeElement instanceof TypeElement te ? te.getQualifiedName().toString():"";
            String methodName=caller!=null?caller.getName().toString():initializer!=null?(initializer.isStatic()?"<clinit>":"<initializer>"):"";
            long callerLine=caller!=null?unit.getLineMap().getLineNumber(positions.getStartPosition(unit,caller)):0;
            row("origin",node,callerOwner,methodName,Long.toString(callerLine),syntacticName);
            return super.visitMethodInvocation(node,ignore);
          }
          @Override public Void visitNewClass(NewClassTree node, Void ignore) {
            emitCall("new",node,node.getIdentifier().toString().replace('\t',' '));
            Element symbol = trees.getElement(getCurrentPath());
            row("newType",node.getIdentifier(),owner(symbol),executableSignature(symbol,false),
                executableSignature(symbol,true),node.getIdentifier().toString().replace('\t',' '));
            return super.visitNewClass(node,ignore);
          }
          @Override public Void visitMemberReference(MemberReferenceTree node, Void ignore) {
            emitCall("methodRef",node,node.getName().toString());
            return super.visitMemberReference(node,ignore);
          }
          void typeUse(Tree tree, String spelling) {
            Element element=trees.getElement(getCurrentPath());
            if (!(element instanceof TypeElement type) || type.asType().getKind()==TypeKind.ERROR) return;
            for (TreePath parent=getCurrentPath().getParentPath(); parent!=null; parent=parent.getParentPath()) {
              if (parent.getLeaf() instanceof ImportTree) return;
            }
            Tree parent=getCurrentPath().getParentPath().getLeaf();
            boolean annotation=parent instanceof AnnotationTree annotationTree && annotationTree.getAnnotationType()==tree;
            boolean staticQualifier=parent instanceof MemberSelectTree member && member.getExpression()==tree &&
                !(trees.getElement(getCurrentPath().getParentPath()) instanceof TypeElement);
            row(annotation?"annotation":staticQualifier?"qualifier":"reference",tree,type.getQualifiedName().toString(),"","",spelling);
            row("typeRole",tree,type.getQualifiedName().toString(),parent.getKind().toString(),"",spelling);
          }
          @Override public Void visitIdentifier(IdentifierTree node, Void ignore) {
            typeUse(node,node.getName().toString());
            return super.visitIdentifier(node,ignore);
          }
          @Override public Void visitMemberSelect(MemberSelectTree node, Void ignore) {
            typeUse(node,node.toString());
            return super.visitMemberSelect(node,ignore);
          }
          @Override public Void visitImport(ImportTree node, Void ignore) {
            row("import",node,node.getQualifiedIdentifier().toString(),"","","");
            return super.visitImport(node,ignore);
          }
          @Override public Void visitClass(ClassTree node, Void ignore) {
            if (!node.getSimpleName().toString().isEmpty()) {
              Element e = trees.getElement(getCurrentPath());
              row("type",node, e instanceof TypeElement t ? t.getQualifiedName().toString() : "","","",node.getSimpleName().toString());
            }
            if (node.getExtendsClause()!=null) {
              TypeMirror parentType=trees.getTypeMirror(new TreePath(getCurrentPath(),node.getExtendsClause()));
              row("extends",node.getExtendsClause(),parentType.toString(),"","",node.getExtendsClause().toString());
            }
            for(Tree parent:node.getImplementsClause()) {
              TypeMirror parentType=trees.getTypeMirror(new TreePath(getCurrentPath(),parent));
              row("implements",parent,parentType.toString(),"","",parent.toString());
            }
            return super.visitClass(node,ignore);
          }
          @Override public Void visitAssignment(AssignmentTree node, Void ignore) {
            TreePath targetPath=new TreePath(getCurrentPath(),node.getVariable());
            Element target=trees.getElement(targetPath);
            row("assignment",node,owner(target),target==null?"":target.getSimpleName().toString(),target==null?"":target.getKind().toString(),node.getVariable().toString());
            return super.visitAssignment(node,ignore);
          }
          @Override public Void visitSynchronized(SynchronizedTree node, Void ignore) {
            row("synchronized",node,"","","",node.getExpression().toString());
            return super.visitSynchronized(node,ignore);
          }
          @Override public Void visitVariable(VariableTree node, Void ignore) {
            if (getCurrentPath().getParentPath().getLeaf() instanceof ClassTree) {
              Element symbol=trees.getElement(getCurrentPath());
              row("field",node,owner(symbol),symbol==null?node.getName().toString():symbol.getSimpleName().toString(),symbol==null?"":symbol.asType().toString(),node.getType().toString());
            }
            return super.visitVariable(node,ignore);
          }
          @Override public Void visitMethod(MethodTree node, Void ignore) {
            Element symbol = trees.getElement(getCurrentPath());
            row("method",node,owner(symbol),executableSignature(symbol,false),executableSignature(symbol,true),node.getName().toString());
            row("methodReturn",node,symbol instanceof ExecutableElement e?e.getReturnType().toString():"",executableSignature(symbol,false),executableSignature(symbol,true),node.getReturnType()==null?"void":node.getReturnType().toString());
            return super.visitMethod(node,ignore);
          }
        }.scan(unit,null);
      }
    }
    int errors = 0;
    for (var diag : diagnostics.getDiagnostics()) {
      if (diag.getKind() == Diagnostic.Kind.ERROR) { errors++; System.err.println(diag); }
    }
    System.out.println("javac source count=" + allSources.size() + "; errors=" + errors);
    if (errors > 0) System.exit(1);
  }
}



