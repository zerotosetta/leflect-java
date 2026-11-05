package io.lefectjava.worker.parser;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ReflectionTypeSolver;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.*;

class JavaExecutionModelTest {
  private Map<String,Object> model(String source) {
    var parser=new JavaParser(new ParserConfiguration().setSymbolResolver(new JavaSymbolSolver(new ReflectionTypeSolver())));
    var unit=parser.parse(source).getResult().orElseThrow();
    MethodDeclaration method=unit.findAll(MethodDeclaration.class).stream().filter(m->m.getNameAsString().equals("run")).findFirst().orElseThrow();
    return new JavaExecutionModelExtractor().extract(method,"Example#run");
  }

  @SuppressWarnings("unchecked") private static Map<String,Object> obj(Object value){return (Map<String,Object>)value;}
  @SuppressWarnings("unchecked") private static List<Map<String,Object>> list(Object value){return (List<Map<String,Object>>)value;}
  private static List<Map<String,Object>> steps(Map<String,Object> m){return list(m.get("orderedSteps"));}
  private static List<Map<String,Object>> edges(Map<String,Object> m){return list(obj(m.get("flowGraph")).get("edges"));}
  private static Map<String,Object> find(Map<String,Object> m,String kind,String snippet){return steps(m).stream().filter(s->kind.equals(s.get("kind"))&&snippet.equals(s.get("snippet"))).findFirst().orElseThrow(()->new AssertionError("Missing "+kind+" "+snippet));}
  private static Map<String,Object> call(Map<String,Object> m,String name){return steps(m).stream().filter(s->"call".equals(s.get("kind"))&&name.equals(obj(s.get("call")).get("methodName"))).findFirst().orElseThrow();}
  private static Map<String,Object> snapshot(Map<String,Object> m,Map<String,Object> step){return list(m.get("states")).stream().filter(s->step.get("flowNodeId").equals(s.get("nodeId"))).findFirst().orElseThrow();}
  private static Map<String,Object> state(Map<String,Object> m,Map<String,Object> step,String moment,String id){return obj(obj(snapshot(m,step).get(moment)).get(id));}
  private static String symbol(Map<String,Object> m,String name){return (String)list(m.get("symbols")).stream().filter(s->name.equals(s.get("name"))).findFirst().orElseThrow().get("id");}
  private static void complete(Map<String,Object> m){assertEquals(2,m.get("version"));assertEquals("complete",obj(m.get("coverage")).get("status"),()->obj(m.get("coverage")).toString());}

  @Test void declarationsSeparateInitializationNullabilityAndSiblingScopes() {
    var m=model("""
      class Example {
        void use(Object... values) {} String external() { return null; }
        void run(boolean flag) {
          String sql;
          String x = null;
          if(flag) sql = "text";
          use(sql, x);
          { String value = "first"; use(value); }
          { String value = null; use(value); }
          String a, b = null;
          x = external();
          use(x);
        }
      }
      """);
    complete(m);
    var sql=steps(m).stream().filter(s->"declaration".equals(s.get("kind"))&&"sql".equals(obj(s.get("declaration")).get("name"))).findFirst().orElseThrow();
    String sqlId=(String)obj(sql.get("declaration")).get("symbolId");
    assertEquals("String sql;",sql.get("snippet"));
    assertTrue((Integer)obj(sql.get("lineRange")).get("startColumn")<(Integer)obj(obj(sql.get("declaration")).get("nameRange")).get("startColumn"));
    assertEquals("uninitialized",state(m,sql,"after",sqlId).get("initialization"));
    assertFalse(steps(m).stream().anyMatch(s->"assignment".equals(s.get("kind"))&&sql.get("id").equals(s.get("id"))));
    var use=find(m,"call","use(sql, x)");
    assertEquals("maybe-uninitialized",state(m,use,"before",sqlId).get("initialization"));
    assertEquals(Map.of("initialization","initialized","nullability","null"),state(m,use,"before",symbol(m,"x")));
    var values=list(m.get("symbols")).stream().filter(s->"value".equals(s.get("name"))).toList();
    assertEquals(2,values.size());assertNotEquals(values.get(0).get("id"),values.get(1).get("id"));
    var valueReads=steps(m).stream().filter(s->"read".equals(s.get("kind"))&&"value".equals(s.get("snippet"))).toList();
    assertEquals(values.stream().map(s->s.get("id")).toList(),valueReads.stream().map(s->s.get("symbolId")).toList());
    assertEquals("unknown",state(m,find(m,"call","use(x)"),"before",symbol(m,"x")).get("nullability"));
    assertEquals(6,steps(m).stream().filter(s->"declaration".equals(s.get("kind"))).count());
  }

  @Test void nullJoinReassignmentAndInitialBindingsRemainDistinct() {
    var m=model("""
      class Example {
        void use(Object x) {} String external() { return null; }
        void run(boolean flag, Iterable<String> values) {
          String x;
          if(flag) x = null; else x = new String();
          use(x);
          if(x != null) { x = external(); use(x); }
          for(String item: values) use(item);
          try { throw new IllegalStateException(); } catch(RuntimeException ex) { use(ex); }
        }
      }
      """);
    complete(m);String x=symbol(m,"x");
    var uses=steps(m).stream().filter(s->"call".equals(s.get("kind"))&&"use(x)".equals(s.get("snippet"))).toList();
    assertEquals("initialized",state(m,uses.get(0),"before",x).get("initialization"));
    assertEquals("maybe-null",state(m,uses.get(0),"before",x).get("nullability"));
    assertEquals("unknown",state(m,uses.get(1),"before",x).get("nullability"));
    assertEquals("initialized",state(m,find(m,"call","use(item)"),"before",symbol(m,"item")).get("initialization"));
    assertEquals(Map.of("initialization","initialized","nullability","non-null"),state(m,find(m,"call","use(ex)"),"before",symbol(m,"ex")));
  }

  @Test void shortCircuitCallsHaveExactGuardsAndNullSafePathsButEagerOperatorsDoNot() {
    var m=model("""
      class Example {
        void use() {} boolean eager() { return true; } boolean eager2() { return false; }
        void run(String id, boolean flag) {
          if(id == null || !id.startsWith("X")) use();
          if(flag && (id != null && id.isEmpty())) use();
          if(flag & eager()) use();
          if(flag | eager2()) use();
        }
      }
      """);
    complete(m);
    var starts=call(m,"startsWith");var guards=list(starts.get("guards"));
    assertEquals(1,guards.size());assertEquals("id == null",guards.get(0).get("expression"));assertEquals(false,guards.get(0).get("when"));
    assertEquals("non-null",state(m,starts,"before",symbol(m,"id")).get("nullability"));
    var empty=call(m,"isEmpty");assertEquals(2,list(empty.get("guards")).size());
    assertEquals("non-null",state(m,empty,"before",symbol(m,"id")).get("nullability"));
    assertTrue(list(call(m,"eager").get("guards")).isEmpty());assertTrue(list(call(m,"eager2").get("guards")).isEmpty());
    assertEquals(1,steps(m).stream().filter(s->"call".equals(s.get("kind"))&&"startsWith".equals(obj(s.get("call")).get("methodName"))).count());
    // The false null-check outcome is the only normal entrance into the right call.
    String condition=(String)guards.get(0).get("conditionId");
    assertTrue(edges(m).stream().anyMatch(e->condition.equals(e.get("conditionId"))&&Boolean.FALSE.equals(e.get("when"))));
  }

  @Test void nullGuardFactsAreNotReinstatedAfterRightSideEffects() {
    var m=model("""
      class Example {
        String field; boolean change() { field = null; return true; } void use(String x) {}
        void run() { if(field != null && change()) use(field); }
      }
      """);
    complete(m);String field=symbol(m,"field");
    assertEquals("non-null",state(m,call(m,"change"),"before",field).get("nullability"));
    assertEquals("unknown",state(m,call(m,"use"),"before",field).get("nullability"));
  }

  @Test void mutationsEvaluateTargetsOnceInArgumentOrderAndDistinguishReturnedValues() {
    var m=model("""
      class Example {
        int value; int[] array() { return null; } int index() { return 0; } Example box() { return this; }
        void consume(int... x) {}
        void run(int i) {
          consume(i++, ++i, i--, --i);
          array()[index()]++;
          box().value--;
        }
      }
      """);
    complete(m);
    var mutations=steps(m).stream().filter(s->"mutation".equals(s.get("kind"))).toList();assertEquals(6,mutations.size());
    assertEquals(List.of("previous-value","updated-value","previous-value","updated-value"),mutations.subList(0,4).stream().map(s->obj(list(s.get("effects")).get(0)).get("resultMode")).toList());
    assertTrue(mutations.stream().allMatch(s->list(s.get("effects")).size()==1));
    for(String name:List.of("array","index","box"))assertEquals(1,steps(m).stream().filter(s->"call".equals(s.get("kind"))&&name.equals(obj(s.get("call")).get("methodName"))).count());
    assertTrue(steps(m).indexOf(call(m,"array"))<steps(m).indexOf(call(m,"index")));
    assertTrue(steps(m).indexOf(call(m,"index"))<steps(m).indexOf(mutations.get(4)));
    assertTrue(steps(m).indexOf(mutations.get(3))<steps(m).indexOf(call(m,"consume")));
    var arrayTarget=obj(list(mutations.get(4).get("effects")).get(0).get("target"));
    assertEquals("array-element",arrayTarget.get("resolutionStatus"));assertEquals(1,obj(arrayTarget.get("receiverEvaluation")).get("evaluationCount"));assertEquals(1,obj(arrayTarget.get("indexEvaluation")).get("evaluationCount"));
    assertFalse(steps(m).stream().anyMatch(s->"assignment".equals(s.get("kind"))));
  }

  @Test void labeledForContinueRunsFinallyThenUpdateWithoutRemainingBody() {
    var m=model("""
      class Example {
        void clean() {} void after() {} void work() {}
        void run(boolean skip) {
          outer: for(int i=0;i<3;i++) {
            while(skip) {
              try { if(skip) continue outer; work(); } finally { clean(); }
              after();
            }
          }
        }
      }
      """);
    complete(m);var transfer=steps(m).stream().filter(s->"continue".equals(s.get("kind"))).findFirst().orElseThrow();
    var transition=obj(transfer.get("transition"));String update=(String)transition.get("targetNodeId");assertTrue(update.contains("for:update"));assertEquals("outer",transition.get("label"));
    assertTrue(edges(m).stream().anyMatch(e->transfer.get("flowNodeId").equals(e.get("from"))&&"finally:enter".equals(e.get("kind"))));
    assertTrue(reachable(m,(String)transfer.get("flowNodeId"),(String)call(m,"clean").get("flowNodeId"),e->true));
    assertTrue(reachable(m,(String)transfer.get("flowNodeId"),update,e->true));
    assertFalse(reachable(m,(String)transfer.get("flowNodeId"),(String)call(m,"after").get("flowNodeId"),e->!update.equals(e.get("to"))));
    assertEquals(1,steps(m).stream().filter(s->"call".equals(s.get("kind"))&&"clean".equals(obj(s.get("call")).get("methodName"))).count());
    assertTrue(edges(m).stream().anyMatch(e->e.containsKey("requiresCompletion")));
  }

  @Test void abruptFinallyCompletionOverridesPendingContinueAndReturn() {
    var m=model("""
      class Example {
        int run(boolean skip) {
          for(int i=0;i<3;i++) {
            try { if(skip) continue; return 1; } finally { return 2; }
          }
          return 3;
        }
      }
      """);
    complete(m);var continuing=steps(m).stream().filter(s->"continue".equals(s.get("kind"))).findFirst().orElseThrow();String update=(String)obj(continuing.get("transition")).get("targetNodeId");
    assertFalse(reachable(m,(String)continuing.get("flowNodeId"),update,e->true));
    assertTrue(reachable(m,(String)continuing.get("flowNodeId"),(String)find(m,"return","return 2;").get("flowNodeId"),e->true));
    assertFalse(reachable(m,(String)find(m,"return","return 1;").get("flowNodeId"),update,e->true));
    assertTrue(edges(m).stream().filter(e->find(m,"return","return 2;").get("flowNodeId").equals(e.get("from"))).anyMatch(e->!list(e.get("completionActions")).isEmpty()));
  }

  @Test void loopKindsAndNestedTargetsUseTheirJavaContinuationPoints() {
    var m=model("""
      class Example {
        void run(boolean flag, Iterable<String> values) {
          while(flag) { continue; }
          do { continue; } while(flag);
          for(String item:values) { continue; }
          for(int i=0;flag;i++) { while(flag) { break; } continue; }
        }
      }
      """);
    complete(m);var transfers=steps(m).stream().filter(s->"continue".equals(s.get("kind"))).toList();assertEquals(4,transfers.size());
    assertTrue(((String)obj(transfers.get(0).get("transition")).get("targetNodeId")).contains("while:condition"));
    assertTrue(((String)obj(transfers.get(1).get("transition")).get("targetNodeId")).contains("do:condition"));
    assertTrue(((String)obj(transfers.get(2).get("transition")).get("targetNodeId")).contains("for-each:advance"));
    assertTrue(((String)obj(transfers.get(3).get("transition")).get("targetNodeId")).contains("for:update"));
  }

  @Test void forEvaluationOrderIsInitializerConditionBodyAndUpdate() {
    var m=model("""
      class Example {
        void init() {} boolean test() { return true; } void update() {} void body() {}
        void run() { for(init();test();update()) { body(); continue; } }
      }
      """);
    complete(m);
    assertEquals(List.of("init","test","body","update"),steps(m).stream().filter(s->"call".equals(s.get("kind"))).map(s->obj(s.get("call")).get("methodName")).toList());
    var continuing=steps(m).stream().filter(s->"continue".equals(s.get("kind"))).findFirst().orElseThrow();
    assertTrue(reachable(m,(String)continuing.get("flowNodeId"),(String)call(m,"update").get("flowNodeId"),e->true));
    assertFalse(reachable(m,(String)continuing.get("flowNodeId"),(String)call(m,"body").get("flowNodeId"),e->!call(m,"update").get("flowNodeId").equals(e.get("to"))));
  }

  @Test void nestedBodiesAndImplicitResourceCloseAreExcludedAndUnsupportedSyntaxIsLocated() {
    var m=model("""
      class Example {
        void hidden() {} AutoCloseable resource() { return null; }
        void run() throws Exception {
          Runnable action = () -> hidden();
          class Local { void nested() { hidden(); } }
          try(AutoCloseable r = resource()) { action.run(); }
        }
      }
      """);
    complete(m);assertFalse(steps(m).stream().anyMatch(s->"call".equals(s.get("kind"))&&List.of("hidden","close").contains(obj(s.get("call")).get("methodName"))));
    var partial=model("class Example { void run(boolean flag) { assert flag; } }");
    assertEquals("partial",obj(partial.get("coverage")).get("status"));var unsupported=list(obj(partial.get("coverage")).get("unsupportedNodes"));
    assertEquals(1,unsupported.size());assertEquals("AssertStmt",unsupported.get(0).get("kind"));assertFalse(obj(unsupported.get(0).get("lineRange")).isEmpty());
  }

  /** Follow completion tokens, including filtering impossible finally resume edges. */
  private static boolean reachable(Map<String,Object> m,String from,String to,Predicate<Map<String,Object>> permitted) {
    record Cursor(String node,Map<String,String> tokens){}
    Deque<Cursor> pending=new ArrayDeque<>();pending.add(new Cursor(from,Map.of()));Set<Cursor> seen=new HashSet<>();
    while(!pending.isEmpty()){
      Cursor current=pending.removeFirst();if(!seen.add(current))continue;if(current.node.equals(to))return true;
      for(var edge:edges(m))if(current.node.equals(edge.get("from"))&&permitted.test(edge)&&!"exception:possible".equals(edge.get("kind"))){
        Map<String,Object> required=obj(edge.get("requiresCompletion"));if(required!=null&&!Objects.equals(current.tokens.get(required.get("frameId")),required.get("token")))continue;
        Map<String,String> tokens=new TreeMap<>(current.tokens);for(var action:list(edge.getOrDefault("completionActions",List.of()))){String frame=(String)action.get("frameId");if("clear".equals(action.get("action")))tokens.remove(frame);else tokens.put(frame,(String)action.get("token"));}
        pending.addLast(new Cursor((String)edge.get("to"),tokens));
      }
    }
    return false;
  }
}
