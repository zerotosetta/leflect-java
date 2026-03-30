package io.lefectjava.worker.parser;

import com.github.javaparser.ParseResult;
import com.github.javaparser.Problem;
import com.github.javaparser.Range;
import io.lefectjava.worker.model.ParseProblemRecord;
import io.lefectjava.worker.model.ParseProblemSupport;
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
      record.location = problem
          .getLocation()
          .flatMap(location -> location.toRange())
          .map(this::toSourceLocation)
          .orElse(null);
      record.snippet = ParseProblemSupport.buildSnippet(sourceContent, record.location);
      problem.getCause().ifPresent(cause -> ParseProblemSupport.populateThrowableDetails(record, cause, null));
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

}
