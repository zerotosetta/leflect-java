package io.lefectjava.worker.parser;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ast.CompilationUnit;
import io.lefectjava.worker.model.AstFileResult;
import io.lefectjava.worker.model.ParseProblemRecord;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public class JavaAstExporter {
  private final JavaParser parser;
  private final JavaSummaryExtractor summaryExtractor;
  private final ParseProblemCollector problemCollector;

  public JavaAstExporter() {
    this(
        ParserFactory.createJavaParser(),
        new JavaSummaryExtractor(),
        new ParseProblemCollector()
    );
  }

  public JavaAstExporter(
      JavaParser parser,
      JavaSummaryExtractor summaryExtractor,
      ParseProblemCollector problemCollector
  ) {
    this.parser = parser;
    this.summaryExtractor = summaryExtractor;
    this.problemCollector = problemCollector;
  }

  public ExportResult export(Path source, String relativePath, String sourceKind) throws IOException {
    String content = Files.readString(source);
    ParseResult<CompilationUnit> result = parser.parse(content);
    List<ParseProblemRecord> problems = problemCollector.collect(relativePath, result);
    CompilationUnit unit = result.getResult().orElseGet(CompilationUnit::new);
    AstFileResult ast = summaryExtractor.extract(relativePath, unit, sourceKind);
    return new ExportResult(ast, problems);
  }

  public static class ExportResult {
    public final AstFileResult ast;
    public final List<ParseProblemRecord> problems;

    public ExportResult(AstFileResult ast, List<ParseProblemRecord> problems) {
      this.ast = ast;
      this.problems = problems;
    }
  }
}
