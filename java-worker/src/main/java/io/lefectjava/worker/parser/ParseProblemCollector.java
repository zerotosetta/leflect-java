package io.lefectjava.worker.parser;

import com.github.javaparser.ParseResult;
import com.github.javaparser.Problem;
import com.github.javaparser.Range;
import io.lefectjava.worker.model.ParseProblemRecord;
import io.lefectjava.worker.model.SourceLocation;

import java.util.ArrayList;
import java.util.List;

public class ParseProblemCollector {
  public List<ParseProblemRecord> collect(String sourcePath, String sourceContent, ParseResult<?> result) {
    List<ParseProblemRecord> records = new ArrayList<>();
    for (Problem problem : result.getProblems()) {
      ParseProblemRecord record = new ParseProblemRecord(
          "java-parse",
          "error",
          sourcePath,
          "java.parse.problem",
          "Java parse problem",
          problem.getVerboseMessage()
      );
      record.detail = problem.getMessage();
      record.hint = "Inspect the Java syntax near the reported location.";
      record.rawCause = problem.getCause().map(Throwable::toString).orElse(null);
      record.location = problem
          .getLocation()
          .flatMap(location -> location.toRange())
          .map(this::toSourceLocation)
          .orElse(null);
      record.snippet = buildSnippet(sourceContent, record.location);
      records.add(record);
    }
    return records;
  }

  private SourceLocation toSourceLocation(Range range) {
    return new SourceLocation(
        range.begin.line,
        range.begin.column,
        range.end.line,
        range.end.column
    );
  }

  private String buildSnippet(String sourceContent, SourceLocation location) {
    if (location == null || location.line == null) {
      return null;
    }

    String[] lines = sourceContent.split("\\R", -1);
    int index = location.line - 1;
    if (index < 0 || index >= lines.length) {
      return null;
    }

    return lines[index].trim();
  }
}
